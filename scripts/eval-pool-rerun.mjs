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
 * 断点续跑（--resume）：读 --output 既有结果，(task,repeat) 已达能力终态
 * （success / gen_timeout / error）的跳过，仅重跑 infra（可重试类）与缺失项。
 * fail-closed：连续 2 个 task 的 run 全部剔除类（infra+error+oracle_error）→ 中止，
 * 已跑数据落盘（partial 标记），exit 2 —— 同 eval-calibrate F206 fix B 语义。
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

/**
 * --resume 过滤：能力终态（success/gen_timeout/error）跳过；infra（可重试）与缺失项重跑。
 * key = task__rN。返回 { skip: Map<key, priorResult>, rerunKeys: Set<key> }
 */
export function partitionResumed(priorResults, taskId, repeats) {
  const skip = new Map();
  const CAPABILITY_FINAL = new Set(['success', 'gen_timeout', 'error']);
  for (const r of priorResults ?? []) {
    if (r.task !== taskId) continue;
    if (CAPABILITY_FINAL.has(r.status)) skip.set(`${r.task}__r${r.repeatNo}`, r);
  }
  const rerunKeys = new Set();
  for (let i = 1; i <= repeats; i++) {
    const k = `${taskId}__r${i}`;
    if (!skip.has(k)) rerunKeys.add(k);
  }
  return { skip, rerunKeys };
}

/** 单 task 的 run 结果是否"全剔除类"（infra/error 或 oracle_error），供 fail-closed 计数。 */
export function isTaskFullyExcluded(taskResults, resolveOutcome) {
  if (taskResults.length === 0) return false;
  return taskResults.every((r) => {
    if (r.status === 'infra' || r.status === 'error') return true;
    if (r.status === 'success') return resolveOutcome(r) === 'oracle_error';
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
  // 分桶口径与 computeValidationStats 严格一致：infra/error/oracle_error 剔除、
  // null(oracle_missing) 剔分母单列、gen_timeout 计 fail 入分母。
  return [...byTask.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([task, rs]) => {
    let pass = 0, fail = 0, genTimeout = 0, excluded = 0, oracleMissing = 0;
    for (const r of rs) {
      if (r.status === 'infra' || r.status === 'error') { excluded++; continue; }
      if (r.status === 'gen_timeout') { genTimeout++; fail++; continue; }
      const o = resolveOutcome(r);
      if (o === 'oracle_error') { excluded++; continue; }
      if (o === null) { oracleMissing++; continue; }
      if (o === true) pass++; else fail++;
    }
    const denom = pass + fail;
    return { task, nRuns: rs.length, pass, fail, genTimeout, excluded, oracleMissing,
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
  console.log(`[pool-rerun] 池 taskSetHash: ${computeTaskSetHash(taskIds).slice(0, 16)}… (${taskIds.length} tasks)`);

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

  // --resume：装载既有结果
  const outPath = path.resolve(PROJECT_ROOT, args.output);
  let priorResults = [];
  if (args.resume && fs.existsSync(outPath)) {
    try {
      priorResults = JSON.parse(fs.readFileSync(outPath, 'utf-8')).results ?? [];
      console.log(`[pool-rerun] --resume：载入 ${priorResults.length} 条既有结果`);
    } catch (e) {
      console.error(`[pool-rerun] ❌ --resume 但 output 不可读（${e.message}）——拒绝静默覆盖，请检查或换 --output`);
      process.exit(2);
    }
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
  const warmupResults = await serialWarmup(warmupJobs, { budgetMs: 40 * 60 * 1000, runTimeoutMs: 25 * 60 * 1000 });
  const safeWarmup = Array.isArray(warmupResults) ? warmupResults : [];
  const warmupFailed = safeWarmup.filter((r) => r && r.status !== 'success');
  if (warmupFailed.length > 0 || safeWarmup.length === 0) {
    console.warn(`[pool-rerun] ⚠️  预热未全暖（${warmupFailed.map((r) => `${r.envKey ?? r.task}:${r.status}`).join(', ') || '无结果'}），后续可能 cold-build，不阻断。`);
  }

  const resolveOutcome = (r) => (r.fixturePath ? readOracleOutcome(r.fixturePath) : null);
  const allResults = [...priorResults];
  const wallStart = Date.now();
  let spentMs = 0;
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
        generatedAt: new Date().toISOString(), wallMs: Date.now() - wallStart,
        partial, abortReason,
      },
      stats, perTask: rows, results: allResults,
    }, null, 2));
  };

  for (const taskId of taskIds) {
    const { skip, rerunKeys } = partitionResumed(allResults, taskId, args.repeats);
    // 从 allResults 中移除本 task 将被重跑的 infra 旧条目（避免双计）
    for (let i = allResults.length - 1; i >= 0; i--) {
      const r = allResults[i];
      if (r.task === taskId && rerunKeys.has(`${r.task}__r${r.repeatNo}`)) allResults.splice(i, 1);
    }
    const jobs = buildTaskJobs(taskId, args.cohort, args.repeats)
      .filter((j) => rerunKeys.has(`${j.task}__r${j.repeatNo}`));
    if (jobs.length === 0) {
      console.log(`[pool-rerun] ${taskId}: 已完成（resume 跳过 ${skip.size} run）`);
      continue;
    }
    const remainingMs = args.budgetMs - spentMs;
    if (remainingMs <= args.runTimeoutMs) {
      abortReason = `整批预算耗尽（已用 ${(spentMs / 3600000).toFixed(1)}h）——已跑数据保留，--resume 续跑`;
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
