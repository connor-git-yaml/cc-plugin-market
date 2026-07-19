#!/usr/bin/env node
/**
 * @fileoverview F212 headline — F206 全池（11 task）单 cohort × N 重复 复测薄驱动。
 *
 * 定位（与 188 的 eval-offline-rejudge 同先例）：**零新增判分语义**——runner 链
 * （eval-task-runner + --swebench-oracle）、oracle、聚合口径（computeValidationStats +
 * readOracleOutcome，含 F210/T0 的 oracle_error 剔分母）全部复用既有导出；本文件只做
 * "任务清单 × 重复数" 的编排 + 逐 task 分块断点续跑。eval-validate 跑不了全池是因为它
 * 固定 REPEATS=1 且每次 invocation 复用同 runId 会覆盖上一轮 run 现场（取证保护红线）。
 *
 * 跑法：
 *   node scripts/eval-pool-rerun.mjs \
 *     --pool specs/212-eval-rerun-m8-closeout/pool-11.json \
 *     --cohort c3 --repeats 3 --concurrency 1 \
 *     --output .pool-rerun/f208-headline.json [--resume] [--dry-run]
 *
 * 断点续跑（--resume）：读 --output 既有结果并**硬校验 meta**（poolTaskSetHash/cohort/tool/
 * repeats/driverModel 全匹配，防错拿别的批的 output 交叉污染）；(task,tool,cohort,repeat)
 * 已达能力终态（success / gen_timeout）的跳过，infra 与 error（均为聚合剔分母的基础设施类）
 * 与缺失项重跑。fail-closed：连续 2 个 task 的 run 全部剔除类（infra+error+oracle_error+
 * oracle_missing）→ 中止，已跑数据落盘（partial 标记），exit 2 —— 同 eval-calibrate F206
 * fix B 语义。起批前跑 F197 同款 prereg 三重门（oracleSpecHash/promptSha256/
 * fixtureContentHash/gitState + F176 taskSet 锚），任一不符拒跑。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ParallelRunPool, serialWarmup, DEFAULT_DRIVER_MODEL } from './lib/parallel-run-pool.mjs';
import { planWarmupJobs } from './lib/warmup-planner.mjs';
import { preflightClaudeConnectivity } from './lib/generation-infra.mjs';
import { computeFixtureContentHash } from './lib/preregistration-check.mjs';
import { computeValidationStats, readOracleOutcome } from './eval-validate.mjs';
import { CALIBRATION_COHORT_TO_TOOL, CALIBRATION_DATASET } from './eval-calibrate.mjs';
import { computeTaskSetHash } from './eval-split-sets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const POOL_RERUN_PARAMS = {
  REPEATS: 3,
  CONCURRENCY: 1,                       // F206 结算实跑 concurrency 1（内存教训：并发 docker race）
  BUDGET_MS: 8 * 60 * 60 * 1000,        // 整批 8h（F206 结算 33 run 实测 6.3hr）
  RUN_TIMEOUT_MS: 20 * 60 * 1000,       // 单 run 20min（与 validate/校准同款）
  QUOTA_REMINDER_EVERY: 6,              // 每 6 run 打配额人工提醒（同 cohort-batch 口径）
  CONSECUTIVE_BROKEN_ABORT: 2,          // 连续 N 个 task 全剔除 → fail-closed 中止
};

export function parseArgs(argv) {
  const args = {
    pool: 'specs/212-eval-rerun-m8-closeout/pool-11.json',
    cohort: 'c3',
    repeats: POOL_RERUN_PARAMS.REPEATS,
    concurrency: POOL_RERUN_PARAMS.CONCURRENCY,
    budgetMs: POOL_RERUN_PARAMS.BUDGET_MS,
    runTimeoutMs: POOL_RERUN_PARAMS.RUN_TIMEOUT_MS,
    output: null,
    dryRun: false,
    resume: false,
    skipPreflight: false,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--pool': args.pool = argv[++i]; break;
      case '--cohort': args.cohort = argv[++i]; break;
      case '--repeats': args.repeats = Number(argv[++i]); break;
      case '--concurrency': args.concurrency = Number(argv[++i]); break;
      case '--budget-ms': args.budgetMs = Number(argv[++i]); break;
      case '--run-timeout-ms': args.runTimeoutMs = Number(argv[++i]); break;
      case '--output': args.output = argv[++i]; break;
      case '--dry-run': args.dryRun = true; break;
      case '--resume': args.resume = true; break;
      case '--skip-preflight': args.skipPreflight = true; break;
      default: throw new Error(`未知参数: ${argv[i]}`);
    }
  }
  if (!Number.isInteger(args.repeats) || args.repeats < 1) throw new Error('--repeats 须为 ≥1 整数');
  return args;
}

/**
 * 构建单 task 的 repeats 个 job（repeatNo 隔离 fixture 路径，runId=task__tool__rN 互不覆盖）。
 * 与 eval-calibrate 的 job 形状一致（pool._buildRunnerArgs 消费）。
 */
export function buildTaskJobs(taskId, cohort, repeats) {
  const tool = CALIBRATION_COHORT_TO_TOOL[cohort];
  return Array.from({ length: repeats }, (_, i) => ({
    task: taskId, tool, cohort, repeatNo: i + 1, extraArgs: ['--swebench-oracle'],
  }));
}

/** resume/重跑用的 run 身份键：task__tool__cohort__rN（codex HIGH：只有 task__rN 会被
 * 错 output 里的异 cohort/tool 条目冒名跳过）。 */
export function runKey(r) {
  return `${r.task}__${r.tool}__${r.cohort}__r${r.repeatNo}`;
}

/**
 * --resume 过滤：能力终态（success/gen_timeout）跳过；infra 与 error（两者在聚合里都
 * 剔分母、均属可修复的基础设施类：OAuth/代理 vs flag 错配/dist 门禁）与缺失项重跑。
 * key = runKey（含 tool/cohort）。返回 { skip: Map<key, priorResult>, rerunKeys: Set<key> }
 */
export function partitionResumed(priorResults, taskId, cohort, tool, repeats) {
  const skip = new Map();
  const CAPABILITY_FINAL = new Set(['success', 'gen_timeout']);
  for (const r of priorResults ?? []) {
    if (r.task !== taskId || r.cohort !== cohort || r.tool !== tool) continue;
    if (CAPABILITY_FINAL.has(r.status)) skip.set(runKey(r), r);
  }
  const rerunKeys = new Set();
  for (let i = 1; i <= repeats; i++) {
    const k = runKey({ task: taskId, tool, cohort, repeatNo: i });
    if (!skip.has(k)) rerunKeys.add(k);
  }
  return { skip, rerunKeys };
}

/**
 * 单 task 的 run 结果是否"全剔除类"（infra/error/oracle_error/oracle_missing(null)），
 * 供 fail-closed 计数。codex MED：oracle_missing 也计剔除——系统性 oracle 读不到
 * （runner schema 回归类）时应尽早中止，而非烧完整批最后 n_valid=0。
 */
export function isTaskFullyExcluded(taskResults, resolveOutcome) {
  if (taskResults.length === 0) return false;
  return taskResults.every((r) => {
    if (r.status === 'infra' || r.status === 'error') return true;
    if (r.status === 'success') {
      const o = resolveOutcome(r);
      return o === 'oracle_error' || o === null;
    }
    return false; // gen_timeout = 能力 fail，非剔除
  });
}

/** 逐 task 聚合行（对照 campaign-2 报告"任务级"格式）。 */
export function perTaskRows(results, resolveOutcome) {
  const byTask = new Map();
  for (const r of results) {
    if (!byTask.has(r.task)) byTask.set(r.task, []);
    byTask.get(r.task).push(r);
  }
  // 分桶口径与 computeValidationStats 严格一致，且五桶独立成列（codex MED：合并 excluded
  // 会让诊断分不清 runner error vs oracle 仪器坏）：infra / error / oracleError 剔除、
  // oracleMissing(null) 剔分母单列、genTimeout 计 fail 入分母。excluded 为派生和（显示用）。
  return [...byTask.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([task, rs]) => {
    let pass = 0, fail = 0, genTimeout = 0, infra = 0, error = 0, oracleError = 0, oracleMissing = 0;
    for (const r of rs) {
      if (r.status === 'infra') { infra++; continue; }
      if (r.status === 'error') { error++; continue; }
      if (r.status === 'gen_timeout') { genTimeout++; fail++; continue; }
      const o = resolveOutcome(r);
      if (o === 'oracle_error') { oracleError++; continue; }
      if (o === null) { oracleMissing++; continue; }
      if (o === true) pass++; else fail++;
    }
    const denom = pass + fail;
    return { task, nRuns: rs.length, pass, fail, genTimeout, infra, error, oracleError, oracleMissing,
             excluded: infra + error + oracleError,
             score: denom > 0 ? `${pass}/${denom}` : 'n/a' };
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (!CALIBRATION_COHORT_TO_TOOL[args.cohort]) {
    console.error(`[pool-rerun] 未知 cohort "${args.cohort}"（支持: ${Object.keys(CALIBRATION_COHORT_TO_TOOL).join(', ')}）`);
    process.exit(1);
  }
  if (!args.output && !args.dryRun) {
    console.error('[pool-rerun] 必须传 --output <result.json>（断点续跑与取证依赖）');
    process.exit(1);
  }

  const poolSpec = JSON.parse(fs.readFileSync(path.resolve(PROJECT_ROOT, args.pool), 'utf-8'));
  const taskIds = poolSpec.taskIds;
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    console.error('[pool-rerun] pool 文件缺 taskIds');
    process.exit(1);
  }

  // ── 硬前置：fixture 在位 + F176 子集内容锚精确比对（防"换池/换 fixture 跑分"）────────
  const fixturesDir = path.join(PROJECT_ROOT, 'tests/baseline/swe-bench-verified/fixtures');
  const missing = taskIds.filter((t) => !fs.existsSync(path.join(fixturesDir, `${t}.json`)));
  if (missing.length > 0) {
    console.error(`[pool-rerun] ❌ fixture 缺失 ${missing.length} 个：${missing.join(', ')}\n    先按 POOL-RECOVERY.md 重导入。`);
    process.exit(2);
  }
  const f176Ids = taskIds.filter((t) => /^SWE-V[0-9]{3}-/.test(t));
  const frozenHash = poolSpec.frozenRef?.f176FixtureContentHash;
  if (frozenHash && f176Ids.length > 0) {
    const h = computeFixtureContentHash(f176Ids, fixturesDir);
    if (h !== frozenHash) {
      console.error(`[pool-rerun] ❌ F176 子集 fixtureContentHash 不符（算得 ${h.slice(0, 12)}… ≠ 冻结 ${frozenHash.slice(0, 12)}…）→ 疑似 fixture 漂移，拒跑`);
      process.exit(2);
    }
    console.log(`[pool-rerun] F176 子集内容锚比对 ✅ (${f176Ids.length} fixtures == ${frozenHash.slice(0, 12)}…)`);
  }
  // pool-11 自身锚：F176 taskSetHash + frozen/validation 集合锚前缀 + 成员（防池清单被篡改后跑分）
  const ref = poolSpec.frozenRef ?? {};
  console.log(`[pool-rerun] 池 taskSetHash: ${computeTaskSetHash(taskIds).slice(0, 16)}… (${taskIds.length} tasks)`);
  {
    const { computeTaskSetHash: preregTaskSetHash } = await import('./lib/preregistration-check.mjs');
    const frozenSet = ['SWE-V005-sympy-collect-factor-and-dimension', 'SWE-V001-sympy-the-evaluate-false-parameter', 'SWE-V003-sympy-polyelement-as-expr-not'];
    const validationSet = ['SWE-VB003-astropy-in-v5-nddataref-mask', 'SWE-V008-sympy-contains-as-set-returns', 'SWE-V009-sympy-physics-hep-kahane-simplify'];
    const tOk = !ref.f176TaskSetHash || preregTaskSetHash(f176Ids) === ref.f176TaskSetHash;
    const fOk = !ref.frozenSetAnchorPrefix || computeTaskSetHash(frozenSet).startsWith(ref.frozenSetAnchorPrefix);
    const vOk = !ref.validationSetAnchorPrefix || computeTaskSetHash(validationSet).startsWith(ref.validationSetAnchorPrefix);
    const memberOk = [...frozenSet, ...validationSet].every((t) => taskIds.includes(t));
    if (!tOk || !fOk || !vOk || !memberOk) {
      console.error(`[pool-rerun] ❌ 池锚校验失败（f176TaskSet=${tOk} frozen=${fOk} validation=${vOk} member=${memberOk}）→ 池清单疑似被改，拒跑`);
      process.exit(2);
    }
    console.log('[pool-rerun] F176 taskSet 锚 + frozen/validation 集合锚 + 池成员校验 ✅');
  }

  // ── F197 同款 prereg 三重门（codex HIGH：oracleSpecHash/promptSha256/gitState 全比对）────
  // 注：oracleSpecHash 冻结输入含 swebenchTimeoutMs=300000（cohort-batch 链口径）；本 pool 链
  // runner 实际 --swebench-timeout-ms = runTimeoutMs（与 F206 全池结算同值 —— 188 P1 已归档的
  // 同款 lineage deviation）——语义模块/prompt/fixture 三锚不受影响，meta 里显式记录。
  if (!args.dryRun) {
    const [{ checkPreregistration, parsePreregistration }, cb, { computeDriverPromptSha256 }] = await Promise.all([
      import('./lib/preregistration-check.mjs'),
      import('./swe-bench-verified-cohort-batch.mjs'),
      import('./eval-task-runner.mjs'),
    ]);
    const preregRel = 'specs/176-swe-bench-verified-cross-cohort/verification/preregistration.md';
    const preregPath = path.join(PROJECT_ROOT, preregRel);
    const manifest = cb.loadExperimentManifest(path.join(PROJECT_ROOT, 'specs/212-eval-rerun-m8-closeout/ab-manifest.json'));
    const pre = parsePreregistration(fs.readFileSync(preregPath, 'utf-8'));
    const gitState = cb.computePreregGitState({ projectRoot: PROJECT_ROOT, preregRel, frozenGitCommit: pre.gitCommit });
    const check = checkPreregistration(pre.taskIds, preregPath, {
      oracleKind: 'swebench-execution',
      oracleSpecInput: cb.buildLiveOracleSpecInput(manifest),
      manifest,
      promptSha256: computeDriverPromptSha256(),
      fixtureContentHash: computeFixtureContentHash(pre.taskIds, fixturesDir),
      gitState,
    });
    if (!check.ok) {
      console.error(`[pool-rerun] ❌ prereg 三重门失败：${check.reason} → 拒跑（禁跑前换判分/带脏树跑批）`);
      process.exit(2);
    }
    console.log('[pool-rerun] prereg 三重门（oracleSpec/prompt/fixture/gitState/taskSet）✅');
  }

  const totalRuns = taskIds.length * args.repeats;
  console.log(`[pool-rerun] 计划 ${taskIds.length} task × cohort=${args.cohort}(${CALIBRATION_COHORT_TO_TOOL[args.cohort]}) × N=${args.repeats} = ${totalRuns} runs, budget=${(args.budgetMs / 3600000).toFixed(1)}h, driver=${DEFAULT_DRIVER_MODEL}`);

  if (args.dryRun) {
    for (const t of taskIds) {
      for (const j of buildTaskJobs(t, args.cohort, args.repeats)) {
        console.log(`[pool-rerun][dry-run] ${j.task} × ${j.tool} r${j.repeatNo}`);
      }
    }
    console.log('PASSRATE=DRY_RUN');
    return;
  }

  // --resume：装载既有结果 + meta 硬校验（codex HIGH：错拿别的批的 output 会交叉污染——
  // 用 c1 的 success 冒名跳过 c3、写出 c3 meta + c1 results）
  const outPath = path.resolve(PROJECT_ROOT, args.output);
  const expectedTool = CALIBRATION_COHORT_TO_TOOL[args.cohort];
  let priorResults = [];
  if (args.resume && fs.existsSync(outPath)) {
    let prior;
    try {
      prior = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    } catch (e) {
      console.error(`[pool-rerun] ❌ --resume 但 output 不可读（${e.message}）——拒绝静默覆盖，请检查或换 --output`);
      process.exit(2);
    }
    const m = prior.meta ?? {};
    const mismatches = [];
    if (m.poolTaskSetHash !== computeTaskSetHash(taskIds)) mismatches.push('poolTaskSetHash');
    if (m.cohort !== args.cohort) mismatches.push('cohort');
    if (m.tool !== expectedTool) mismatches.push('tool');
    if (m.repeats !== args.repeats) mismatches.push('repeats');
    if (m.driverModel !== DEFAULT_DRIVER_MODEL) mismatches.push('driverModel');
    if (mismatches.length > 0) {
      console.error(`[pool-rerun] ❌ --resume meta 不匹配 [${mismatches.join(', ')}]——这不是本批的 output，拒绝续跑（防交叉污染）`);
      process.exit(2);
    }
    priorResults = (prior.results ?? []).filter((r) => r.cohort === args.cohort && r.tool === expectedTool);
    if (priorResults.length !== (prior.results ?? []).length) {
      console.error(`[pool-rerun] ❌ output 内含异 cohort/tool 条目（${(prior.results ?? []).length - priorResults.length} 条）——output 被污染，拒绝续跑`);
      process.exit(2);
    }
    console.log(`[pool-rerun] --resume：meta 校验 ✅，载入 ${priorResults.length} 条既有结果`);
  } else if (!args.resume && fs.existsSync(outPath)) {
    console.error(`[pool-rerun] ❌ output 已存在且未传 --resume——拒绝覆盖取证现场（F206 血泪：runId 复用覆盖 run_artifacts）`);
    process.exit(2);
  }

  // 起批硬门禁：真连一次 driver（Surge 陷阱 / OAuth 过期当场拒，不烧批）
  if (!args.skipPreflight) {
    console.log(`[pool-rerun] API 连接门禁（claude --print ${DEFAULT_DRIVER_MODEL}）...`);
    const pf = await preflightClaudeConnectivity({ model: DEFAULT_DRIVER_MODEL });
    if (!pf.ok) {
      console.error(`[pool-rerun] ❌ 连接门禁失败：${pf.detail}\n    常见：代理未运行 / claude /login 过期。`);
      process.exit(2);
    }
    console.log('[pool-rerun] 连接门禁 OK');
  }

  // 串行 env 预热（与 validate 同款；已有镜像秒过，缺的 cold-build 一次）
  const warmupFixtures = taskIds.map((t) => {
    try { return JSON.parse(fs.readFileSync(path.join(fixturesDir, `${t}.json`), 'utf-8')); }
    catch { return t; }
  });
  const warmupJobs = planWarmupJobs(warmupFixtures, {
    cohort: args.cohort, tool: 'control', datasetName: CALIBRATION_DATASET,
    onDegrade: (err) => console.warn(`[pool-rerun] ⚠️  env 解析降级 repo-only：${err.message}`),
  });
  console.log(`[pool-rerun] 串行预热 ${warmupJobs.length} 个 unique env：${warmupJobs.map((j) => j.envKey).join(', ')}`);
  const warmupStart = Date.now();
  const warmupResults = await serialWarmup(warmupJobs, { budgetMs: 40 * 60 * 1000, runTimeoutMs: 25 * 60 * 1000 });
  const warmupMs = Date.now() - warmupStart;
  const safeWarmup = Array.isArray(warmupResults) ? warmupResults : [];
  const warmupFailed = safeWarmup.filter((r) => r && r.status !== 'success');
  if (warmupFailed.length > 0 || safeWarmup.length === 0) {
    console.warn(`[pool-rerun] ⚠️  预热未全暖（${warmupFailed.map((r) => `${r.envKey ?? r.task}:${r.status}`).join(', ') || '无结果'}），后续可能 cold-build，不阻断。`);
  }

  const resolveOutcome = (r) => (r.fixturePath ? readOracleOutcome(r.fixturePath) : null);
  const allResults = [...priorResults];
  const wallStart = Date.now();
  // codex HIGH：warmup 计入总预算（否则 8h 变 8h40m）
  let spentMs = warmupMs;
  let completedNew = 0;
  let consecutiveBroken = 0;
  let abortReason = null;

  const flush = (partial) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const stats = computeValidationStats(allResults, resolveOutcome);
    const rows = perTaskRows(allResults, resolveOutcome);
    fs.writeFileSync(outPath, JSON.stringify({
      meta: {
        pool: args.pool, poolTaskSetHash: computeTaskSetHash(taskIds),
        cohort: args.cohort, tool: CALIBRATION_COHORT_TO_TOOL[args.cohort],
        repeats: args.repeats, driverModel: DEFAULT_DRIVER_MODEL,
        // lineage deviation 显式记录：pool 链 runner 实际 --swebench-timeout-ms = runTimeoutMs
        // （F206 全池结算同值）；prereg 冻结 oracleSpecHash 的 timeout=300000 是 cohort-batch 链口径
        swebenchTimeoutMsActual: args.runTimeoutMs,
        swebenchTimeoutNote: 'pool 链沿 F206 结算口径（runTimeoutMs 透传 --swebench-timeout-ms）；prereg 冻结 300000 属 cohort-batch 链（188 P1 同款 lineage deviation）',
        preregGatePassed: !args.dryRun,
        generatedAt: new Date().toISOString(), wallMs: Date.now() - wallStart, warmupMs,
        partial, abortReason,
      },
      stats, perTask: rows, results: allResults,
    }, null, 2));
  };

  // 预算护栏余量（codex HIGH：chunk 内 run 被 pool budget SIGKILL 会被 classifyExitStatus
  // 伪装成 gen_timeout 入分母算 fail——要求 chunk 全额预算 + 5min guard，杜绝 mid-chunk 预算杀）
  const CHUNK_BUDGET_GUARD_MS = 5 * 60 * 1000;
  for (const taskId of taskIds) {
    const { skip, rerunKeys } = partitionResumed(allResults, taskId, args.cohort, expectedTool, args.repeats);
    // 从 allResults 中移除本 task 将被重跑的 infra/error 旧条目（避免双计）
    for (let i = allResults.length - 1; i >= 0; i--) {
      if (rerunKeys.has(runKey(allResults[i]))) allResults.splice(i, 1);
    }
    const jobs = buildTaskJobs(taskId, args.cohort, args.repeats)
      .filter((j) => rerunKeys.has(runKey(j)));
    if (jobs.length === 0) {
      console.log(`[pool-rerun] ${taskId}: 已完成（resume 跳过 ${skip.size} run）`);
      continue;
    }
    const remainingMs = args.budgetMs - spentMs;
    const chunkWorstMs = jobs.length * args.runTimeoutMs + CHUNK_BUDGET_GUARD_MS;
    if (remainingMs < chunkWorstMs) {
      abortReason = `整批预算不足以完整跑下一 task（余 ${(remainingMs / 60000).toFixed(0)}min < 需 ${(chunkWorstMs / 60000).toFixed(0)}min）——已跑数据保留，--resume 续跑`;
      console.error(`[pool-rerun] ⏸  ${abortReason}`);
      break;
    }
    console.log(`[pool-rerun] ▶ ${taskId}（${jobs.length} run${skip.size ? `，resume 跳过 ${skip.size}` : ''}）`);
    const pool = new ParallelRunPool({
      concurrency: args.concurrency,
      budgetMs: remainingMs,
      runTimeoutMs: args.runTimeoutMs,
      onProgress: (res, done, total) => {
        completedNew++;
        console.log(`[pool-rerun]   ${res.task} r${res.repeatNo ?? '?'}: ${res.status}（本批新完成 ${completedNew}）`);
        if (completedNew % POOL_RERUN_PARAMS.QUOTA_REMINDER_EVERY === 0) {
          console.log(`[pool-rerun] 💰 已新跑 ${completedNew} runs — 人工检查 Claude Max 配额面板；≥60% weekly 请中断（Ctrl-C），--resume 可续`);
        }
      },
    });
    const chunkStart = Date.now();
    const chunkResults = await pool.run(jobs);
    spentMs += Date.now() - chunkStart;
    allResults.push(...chunkResults);
    flush(true);

    if (isTaskFullyExcluded(chunkResults, resolveOutcome)) {
      consecutiveBroken++;
      console.warn(`[pool-rerun] ⚠️  ${taskId}: 本 task 全剔除类（infra/error/oracle_error）`);
      if (consecutiveBroken >= POOL_RERUN_PARAMS.CONSECUTIVE_BROKEN_ABORT) {
        abortReason = `连续 ${consecutiveBroken} 个 task 全剔除 — 疑似系统性故障（代理挂 / OAuth 过期 / docker 僵死 / dist 门禁），中止。修复后 --resume。`;
        console.error(`[pool-rerun] ❌ ${abortReason}`);
        break;
      }
    } else {
      consecutiveBroken = 0;
    }
  }

  flush(Boolean(abortReason));
  const stats = computeValidationStats(allResults, resolveOutcome);
  console.log('\n[pool-rerun] ===== 逐任务 =====');
  for (const row of perTaskRows(allResults, resolveOutcome)) {
    console.log(`  ${row.task.padEnd(48)} ${row.score}${row.genTimeout ? ` (gen_timeout×${row.genTimeout})` : ''}${row.excluded ? ` [剔除×${row.excluded}]` : ''}`);
  }
  const rateStr = stats.passRate == null ? 'n/a' : stats.passRate.toFixed(4);
  console.log(`[pool-rerun] 总计 pass ${stats.n_pass}/${stats.n_valid} infra=${stats.n_infra} error=${stats.n_error} oracle_error=${stats.n_oracle_error} oracle_missing=${stats.n_oracle_missing} wall=${((Date.now() - wallStart) / 3600000).toFixed(2)}h`);
  console.log(`PASSRATE=${rateStr}`);
  if (abortReason) process.exit(2);
  if (stats.n_valid === 0) {
    console.error('[pool-rerun] ❌ 无有效样本 → exit 2');
    process.exit(2);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((e) => { console.error(`[pool-rerun] ❌ ${e.stack ?? e}`); process.exit(1); });
}
