#!/usr/bin/env node
/**
 * @fileoverview F206 T-C3/C4：并行验证 harness + /goal 指标入口。
 *
 * 跑法：
 *   node scripts/eval-validate.mjs --sets <sets.json> [options]
 *
 * /goal 一条命令：
 *   node scripts/eval-validate.mjs --sets sets.json --goal
 *   → stdout 末行 PASSRATE=0.70 CI=[0.47,0.88]，供 /goal 解析
 *
 * 比较纪律（spec FR-007，C-4）：
 *   --baseline <prev-result.json>
 *   → 新 CI 下界 > 旧均值 + MIN_DELTA 才输出 "KEEP"，否则 "DISCARD"
 *   (防 n≈10 噪声抖动产生伪进步)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapProportionCi } from './lib/cohort-aggregate.mjs';
import { ParallelRunPool, serialWarmup, DEFAULT_DRIVER_MODEL } from './lib/parallel-run-pool.mjs';
import { planWarmupJobs } from './lib/warmup-planner.mjs';
import { preflightClaudeConnectivity } from './lib/generation-infra.mjs';
// 与校准同一 cohort 合同（单一事实源）：cohort→runner --tool 映射 + oracle 读取 + 数据集 id。
// 旧实现硬编码 tool='spec-driver'（c2，不带 Spectra）且 readOraclePassed 读不存在的字段
// （swebenchResult/...）→ /goal 度量恒 0、跑错 cohort——与校准侧 codex CRITICAL-1 同病，一并修正。
import { oraclePassedFromFixture, CALIBRATION_COHORT_TO_TOOL, CALIBRATION_DATASET } from './eval-calibrate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── 验证参数 ──────────────────────────────────────────────────────────────────
const VALIDATE_PARAMS = {
  /** 默认验证 cohort */
  DEFAULT_COHORT: 'c3',
  /** N=1（验证集每任务只跑 1 次，节省配额） */
  REPEATS: 1,
  /** 整批预算（35 min，spec FR-005） */
  BUDGET_MS: 35 * 60 * 1000,
  /** 单 run 超时（20 min，spec FR-005） */
  RUN_TIMEOUT_MS: 20 * 60 * 1000,
  /** infra 失败率上限（超过则作废本次结果，spec FR-006） */
  INFRA_FAIL_RATE_FLOOR: 0.20,
  /** /goal 比较纪律：新 CI 下界需超过旧均值 + MIN_DELTA 才算改进（spec FR-007） */
  MIN_DELTA: 0.05,
  /** 默认并发度 */
  CONCURRENCY: 4,
};

function parseArgs(argv) {
  const args = {
    sets: null,
    cohort: VALIDATE_PARAMS.DEFAULT_COHORT,
    concurrency: VALIDATE_PARAMS.CONCURRENCY,
    budgetMs: VALIDATE_PARAMS.BUDGET_MS,
    runTimeoutMs: VALIDATE_PARAMS.RUN_TIMEOUT_MS,
    dryRun: false,
    goal: false,                // /goal 模式：stdout 末行打印 PASSRATE=
    milestoneFrozen: false,     // 显式 opt-in 跑冻结集（默认不允许，CR-2）
    baseline: null,             // 前版本结果 json（比较纪律）
    output: null,               // 结果 json 输出路径
    minDelta: VALIDATE_PARAMS.MIN_DELTA,
    skipPreflight: false,       // 跳过起批前 API 连接门禁（仅调试用，不建议）
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--sets': args.sets = argv[++i]; break;
      case '--cohort': args.cohort = argv[++i]; break;
      case '--concurrency': args.concurrency = Number(argv[++i]); break;
      case '--budget-ms': args.budgetMs = Number(argv[++i]); break;
      case '--run-timeout-ms': args.runTimeoutMs = Number(argv[++i]); break;
      case '--dry-run': args.dryRun = true; break;
      case '--goal': args.goal = true; break;
      case '--milestone-frozen': args.milestoneFrozen = true; break;
      case '--baseline': args.baseline = argv[++i]; break;
      case '--output': args.output = argv[++i]; break;
      case '--min-delta': args.minDelta = Number(argv[++i]); break;
      case '--skip-preflight': args.skipPreflight = true; break;
    }
  }
  return args;
}

/**
 * 聚合 passRate + bootstrap CI。
 * 语义（CR-3 / W-4 / W-6）：
 *   - infra（exit 3）          → 剔分母（可重跑）
 *   - oracle 不可用（success 但 oracle=null）→ 剔分母，单独计 n_oracle_missing（fail-closed 依据）
 *   - oracle-error（success 但 getOraclePassed 返回 'oracle_error' 哨兵）→ 剔分母，单独计
 *     n_oracle_error（oracle 因基建/夹具问题未真正执行——"仪器坏了"，非候选 fail；不混入 fail
 *     分母避免伪装成 passRate=0.0，本次修复核心）
 *   - gen_timeout（exit 4）    → 入分母算 fail
 *   - error（其他非零）        → 入分母算 fail（W-6：与 gen_timeout 分开计数）
 *   - success + oracle 有效    → oracle passed 决定 pass/fail
 *
 * infraFailRate 含 oracle_missing + oracle_error：三者都是"无法评估"，共同决定本批是否可信
 * （FR-006 floor）。
 *
 * @param {import('./lib/parallel-run-pool.mjs').RunResult[]} results
 * @param {Function} getOraclePassed  (result) => boolean|null|'oracle_error'
 * @returns {{ passRate: number|null, ci: {low:number|null,high:number|null,samples:number,method:string}|null, n_valid: number, n_pass: number, n_infra: number, n_gen_timeout: number, n_error: number, n_oracle_missing: number, n_oracle_error: number, infraFailRate: number, n_total: number }}
 */
export function computeValidationStats(results, getOraclePassed) {
  let n_infra = 0, n_gen_timeout = 0, n_error = 0, n_pass = 0, n_valid = 0, n_oracle_missing = 0, n_oracle_error = 0;
  const passSamples = []; // 0/1 for bootstrap CI

  for (const r of results) {
    if (r.status === 'infra') { n_infra++; continue; } // 剔分母
    if (r.status === 'success') {
      const passed = getOraclePassed ? getOraclePassed(r) : null;
      if (passed === 'oracle_error') {
        // oracle 因基建/夹具问题未真正执行（仪器坏了，非候选 fail）→ 剔分母，单独计数。
        // 哨兵是 truthy 字符串，必须先于下方 if (passed) truthy 判断分流（顺序由单测锁定）。
        n_oracle_error++;
        continue;
      }
      if (passed === null) {
        // oracle 不可用 → 剔分母，单独计数（W-4 fail-closed 依据）
        n_oracle_missing++;
        continue;
      }
      n_valid++;
      if (passed) { n_pass++; passSamples.push(1); }
      else { passSamples.push(0); }
      continue;
    }
    if (r.status === 'gen_timeout') {
      // gen_timeout 入分母算 fail（能力/流程效率问题，CR-3）
      n_valid++;
      passSamples.push(0);
      n_gen_timeout++;
      continue;
    }
    // error = runner 基础设施错误（版本门禁 / flag 错配 / plugin 冲突），非能力 fail → 剔分母
    // （与 calibrate aggregateRunResults 同口径；原实现入分母曾在 dist 门禁失败时假报
    //  passRate=0.0 exit 0，而非 n_valid=0 → exit 2 "本轮无效"——/goal 会把假 0 当真实退步）
    n_error++;
  }

  const passRate = n_valid > 0 ? n_pass / n_valid : null;
  const ci = passSamples.length >= 2 ? bootstrapProportionCi(passSamples) : null;
  // infra / error / oracle_missing / oracle_error 都计入"无法评估"分子（FR-006 floor + W-4 fail-closed）
  const infraFailRate = results.length > 0 ? (n_infra + n_error + n_oracle_missing + n_oracle_error) / results.length : 0;

  return { passRate, ci, n_valid, n_pass, n_infra, n_gen_timeout, n_error, n_oracle_missing, n_oracle_error, infraFailRate,
           n_total: results.length };
}

/**
 * 比较纪律（spec FR-007/W-2，C-4）：
 * 新 CI 下界 > 旧均值 + MIN_DELTA → KEEP；否则 DISCARD。
 *
 * @param {{ passRate: number, ci: {low: number, high: number} }} current
 * @param {{ passRate: number }} baseline
 * @param {number} minDelta
 * @returns {{ verdict: 'KEEP'|'DISCARD'|'INSUFFICIENT_DATA', reason: string }}
 */
export function compareWithBaseline(current, baseline, minDelta) {
  if (!current.ci || current.ci.low === null || current.passRate === null) {
    return { verdict: 'INSUFFICIENT_DATA', reason: 'current CI missing or passRate null' };
  }
  if (!baseline || baseline.passRate == null) {
    return { verdict: 'INSUFFICIENT_DATA', reason: 'baseline passRate missing' };
  }
  const threshold = baseline.passRate + minDelta;
  if (current.ci.low > threshold) {
    return {
      verdict: 'KEEP',
      reason: `新 CI 下界 ${current.ci.low.toFixed(3)} > 旧均值 ${baseline.passRate.toFixed(3)} + MIN_DELTA ${minDelta} = ${threshold.toFixed(3)}`,
    };
  }
  return {
    verdict: 'DISCARD',
    reason: `新 CI 下界 ${current.ci.low.toFixed(3)} ≤ 阈值 ${threshold.toFixed(3)}（噪声内，不视为真改进）`,
  };
}

/**
 * 从 fixture JSON 文件读 oracle passed（经 canonical oraclePassedFromFixture：
 * runner 实写 taskExecution.primaryOracle.passed）。读失败返回 null（→ oracle_missing 桶，
 * 参与 fail-closed 统计），与 calibrate 的 false-on-error 口径不同是有意的：
 * validate 需区分"跑了但 fail"与"结果不可读"。导出供单测钉死读取路径（防再回退到死字段）。
 */
export function readOraclePassed(fixturePath) {
  try {
    return oraclePassedFromFixture(JSON.parse(fs.readFileSync(fixturePath, 'utf-8')));
  } catch { return null; }
}

/**
 * 从 fixture JSON 文件读 oracle 结果的四态 outcome（true=pass / false=候选 fail /
 * null=不可评估（fixture 不可读、无 oracle 字段、oracle 值 malformed（非对象/数组）、
 * classification 为 unavailable/未知漂移值、或 legacy 结构缺 passed 字段）/
 * 'oracle_error'=oracle 因基建/夹具问题未真正执行（primaryOracle.classification==='error'，
 * failureSource 可为 'infra' 如 venv 缺失 → dataset build 失败，或 'fixture' 如 dataset
 * mismatch；同 classifyRunForRanking 的 error 口径，但单独分桶保留诊断信息）。
 *
 * why 单独分桶而非并入 oracle_missing：oracle-error 是"仪器坏了未评估候选"，若混入普通 fail
 * 会把 infra 故障伪装成"候选全挂"（passRate=0.0 假报）——这正是本次修复的根因。
 *
 * classification 穷尽映射（codex W-2）：'pass'→true / 'fail'→false / 'error'→'oracle_error' /
 * 其他已知外值（legacy 'unavailable'、未知漂移）→null 剔分母（与 classifyRunForRanking 同口径，
 * 保守 fail-closed）。仅当 classification 字段**不存在**（legacy {kind,passed} 结构 /
 * swebenchResult fallback）才回退 passed===true 二值，行为与 readOraclePassed 一致；且仅当
 * `passed` 字段**存在**才回退（codex W-1：malformed legacy shape 如 `{}` 无 passed 字段 →
 * null 归 missing，不静默判 false 伪装成候选 fail）。
 *
 * 字段提取链与 oraclePassedFromFixture（eval-calibrate.mjs）一致（primaryOracle ??
 * swebenchResult ?? oracleResult ?? result）——两处维护主体不同，故重复书写而非跨文件复用，
 * 此注释作为可追溯锚点。
 *
 * @param {string} fixturePath
 * @returns {boolean|null|'oracle_error'}
 */
export function readOracleOutcome(fixturePath) {
  try {
    const fix = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    const oracle = fix?.taskExecution?.primaryOracle
      ?? fix?.swebenchResult ?? fix?.oracleResult ?? fix?.result;
    // malformed shape（非对象 / 数组 / null）→ 不可评估，不让 'classification' in oracle
    // 靠抛异常兜底（codex W-1：数组等某些畸形值不抛错，会静默滑入下方 legacy 回退误判 fail）
    if (oracle == null || typeof oracle !== 'object' || Array.isArray(oracle)) return null;
    if ('classification' in oracle) {
      const c = oracle.classification;
      if (c === 'pass') return true;
      if (c === 'fail') return false;
      if (c === 'error') return 'oracle_error';
      return null; // legacy 'unavailable' / 未知漂移值 → 剔分母（fail-closed）
    }
    // legacy {kind,passed}：无 classification 字段才走二值，且仅当 passed 字段真实存在
    // （codex W-1：空对象等无 passed 的畸形 legacy shape → null 归 missing，不误判 false）
    return 'passed' in oracle ? oracle.passed === true : null;
  } catch { return null; }
}

/**
 * 构建验证 jobs（纯函数，T-C9 钉死接线）：tool 必须经 CALIBRATION_COHORT_TO_TOOL 映射——
 * 旧实现硬编码 'spec-driver'（c2，不带 Spectra）→ --cohort 只是标签、实际跑错 cohort。
 */
export function buildValidationJobs(tasks, cohort) {
  return tasks.map((t, i) => ({
    task: t.taskId ?? t, tool: CALIBRATION_COHORT_TO_TOOL[cohort], cohort,
    repeatNo: i + 1, extraArgs: ['--swebench-oracle'],
  }));
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.sets) {
    console.error('[validate] 必须传 --sets <sets.json>');
    process.exit(1);
  }
  // cohort → runner --tool 必须走校准同一合同映射；未知 cohort 早失败，不烧任何配额
  if (!CALIBRATION_COHORT_TO_TOOL[args.cohort]) {
    console.error(`[validate] 未知 cohort "${args.cohort}"（支持: ${Object.keys(CALIBRATION_COHORT_TO_TOOL).join(', ')}）`);
    process.exit(1);
  }

  const setsData = JSON.parse(fs.readFileSync(args.sets, 'utf-8'));

  // held-out 防护（CR-2）：默认只接 validation；--milestone-frozen 才跑 frozen
  let tasks;
  let setLabel;
  if (args.milestoneFrozen) {
    tasks = setsData.frozen ?? [];
    setLabel = 'frozen';
    console.warn('[validate] ⚠️  --milestone-frozen: 此结果带"勿用于 /goal 迭代"标。仅用里程碑对比。');
  } else {
    tasks = setsData.validation ?? [];
    setLabel = 'validation';
  }

  if (tasks.length === 0) {
    console.error(`[validate] ${setLabel} 集为空，请先跑 eval-split-sets.mjs`);
    process.exit(1);
  }
  console.log(`[validate] 跑 ${tasks.length} 个任务 × cohort=${args.cohort} × N=${VALIDATE_PARAMS.REPEATS} (${setLabel})`);

  if (args.dryRun) {
    console.log(`[validate] --dry-run: 计划 ${tasks.length} runs（budget=${args.budgetMs / 60000}min）`);
    if (args.goal) console.log('PASSRATE=DRY_RUN CI=[0,1]');
    return;
  }

  // 起批硬门禁（F206 fix B，与 eval-calibrate 同款）：真连一次 driver 模型。
  // /goal 循环反复调本脚本，代理（Surge）中途挂掉时必须当场拒绝而非烧完一批再作废。
  if (!args.skipPreflight) {
    console.log(`[validate] 起批前 API 连接门禁（claude --print 真连一次 ${DEFAULT_DRIVER_MODEL}，~秒级）...`);
    const pf = await preflightClaudeConnectivity({ model: DEFAULT_DRIVER_MODEL });
    if (!pf.ok) {
      console.error(`[validate] ❌ API 连接门禁失败：${pf.detail}`);
      console.error('[validate]    常见原因：HTTPS_PROXY 指向的本地代理（如 Surge）未运行 / claude 未登录（claude /login）。');
      console.error('[validate]    修复后重跑；确需跳过用 --skip-preflight（不建议）。');
      process.exit(2); // 与 infra 作废同码：/goal 侧识别为"本轮无效，非 0 进步"
    }
    console.log('[validate] 连接门禁 OK');
  }

  // 串行 env 预热（C-2 合同）：按 (repo,version) 去重，每 unique env 串行建一次镜像。
  // validation 集条目仅含 taskId（无 swebenchMeta），需从 fixture 目录回载以解析 env key。
  // 稳态（calibration 已暖缓存）下预热快；首次冷启按 ~9min/env。
  if (tasks.length > 0) {
    const fixtureDir = path.join(PROJECT_ROOT, 'tests/baseline/swe-bench-verified/fixtures');
    const warmupFixtures = tasks.map((t) => {
      const taskId = t.taskId ?? t;
      const fp = path.join(fixtureDir, `${taskId}.json`);
      try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); }
      catch { return taskId; } // fixture 缺失 → 退回裸 id（planWarmupJobs 降级 repo-only）
    });
    const warmupJobs = planWarmupJobs(warmupFixtures, {
      cohort: args.cohort,
      tool: 'control', // 预热只为建 Docker env 镜像，用最便宜的 control（与 calibrate 同款）
      datasetName: CALIBRATION_DATASET, // Verified：env-key 版本解析须查对数据集，否则 DATASET_MISMATCH 降级 repo-only
      onDegrade: (err) =>
        console.warn(`[validate] ⚠️  env 解析降级 repo-only（同 repo 多 version 仍可能 cold-build race）：${err.message}`),
    });
    console.log(`[validate] 串行预热 ${warmupJobs.length} 个 unique env：${warmupJobs.map((j) => j.envKey).join(', ')}`);
    const warmupResults = await serialWarmup(warmupJobs, { budgetMs: 25 * 60 * 1000, runTimeoutMs: 20 * 60 * 1000 });
    // 预热失败 = env 镜像可能未暖 → 后续并行 run cold-build（race + 更慢）。validate 同样对 infra 剔分母，
    // 故 warn-and-continue；但显式打出未暖 env，不静默假装预热成功（codex W-2/W-3）。
    // 规范化为安全数组：空 / 非数组（防御性）也走告警分支，不静默略过（codex W-3）。
    const safeWarmup = Array.isArray(warmupResults) ? warmupResults : [];
    const warmupFailed = safeWarmup.filter((r) => r && r.status !== 'success');
    if (warmupFailed.length > 0 || safeWarmup.length === 0) {
      const detail = safeWarmup.length === 0
        ? '预热未产出任何结果（env 解析为空 / 预热被跳过 / 返回非数组）'
        : `${warmupFailed.length}/${safeWarmup.length} 个 env 预热未成功（${warmupFailed.map((r) => `${r.envKey ?? r.task}:${r.status}`).join(', ')}）`;
      console.warn(`[validate] ⚠️  ${detail}。后续并行 run 可能 cold-build（race 风险 + 更慢），不阻断验证；如担心 race 可重跑预热。`);
    }
  }

  // 并行跑验证
  const pool = new ParallelRunPool({
    concurrency: args.concurrency,
    budgetMs: args.budgetMs,
    runTimeoutMs: args.runTimeoutMs,
    onProgress: (res, done, total) => {
      console.log(`[validate] ${done}/${total} ${res.task} × ${res.cohort}: ${res.status}`);
    },
  });

  const jobs = buildValidationJobs(tasks, args.cohort);
  const wallStart = Date.now();
  const results = await pool.run(jobs);
  const wallMs = Date.now() - wallStart;

  // 聚合
  const stats = computeValidationStats(results, (r) => r.fixturePath ? readOracleOutcome(r.fixturePath) : null);

  // spec FR-006：infra（含 oracle_missing）失败率过高 → 作废本次结果
  if (stats.infraFailRate > VALIDATE_PARAMS.INFRA_FAIL_RATE_FLOOR) {
    console.error(`[validate] ❌ infraFailRate=${(stats.infraFailRate * 100).toFixed(0)}% > ${VALIDATE_PARAMS.INFRA_FAIL_RATE_FLOOR * 100}% 上限（infra=${stats.n_infra} oracle_missing=${stats.n_oracle_missing} oracle_error=${stats.n_oracle_error}）→ 本次结果作废，请重跑`);
    process.exit(2); // 非 0，可被 /goal 识别为 infra 失败
  }

  // W-4 fail-closed：无有效样本（全 infra / oracle 全缺失）→ 非 0 退出，
  // 绝不让 /goal 拿到 PASSRATE=null + exit 0 误当"0 进步"信号。
  if (stats.n_valid === 0) {
    console.error(`[validate] ❌ 无有效样本 n_valid=0（infra=${stats.n_infra} oracle_missing=${stats.n_oracle_missing} oracle_error=${stats.n_oracle_error} gen_timeout=${stats.n_gen_timeout} error=${stats.n_error}）→ 无法判定 passRate，请重跑`);
    process.exit(2);
  }

  // 机读 JSON 输出
  const output = {
    passRate: stats.passRate,
    ci: stats.ci,
    n_valid: stats.n_valid,
    n_total: stats.n_total,
    n_pass: stats.n_pass,
    n_infra: stats.n_infra,
    n_gen_timeout: stats.n_gen_timeout,
    n_error: stats.n_error,
    n_oracle_missing: stats.n_oracle_missing,
    n_oracle_error: stats.n_oracle_error,
    infraFailRate: stats.infraFailRate,
    wallClockMs: wallMs,
    cohort: args.cohort,
    setLabel,
    milestoneFrozen: args.milestoneFrozen,
    generatedAt: new Date().toISOString(),
    perTask: results.map((r) => ({ task: r.task, cohort: r.cohort, status: r.status, wallMs: r.wallMs })),
  };

  if (args.output) {
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
    console.log(`[validate] 结果: ${args.output}`);
  }

  // 摘要
  const passRateStr = stats.passRate != null ? (stats.passRate * 100).toFixed(1) + '%' : 'N/A';
  const ciStr = stats.ci && stats.ci.low !== null && stats.ci.high !== null ? `[${(stats.ci.low * 100).toFixed(1)},${(stats.ci.high * 100).toFixed(1)}]%` : '[N/A]';
  console.log(`[validate] passRate=${passRateStr} CI=${ciStr} n=${stats.n_valid} infra=${stats.n_infra} oracle_error=${stats.n_oracle_error} wall=${(wallMs/60000).toFixed(1)}min`);
  if (args.milestoneFrozen) console.log('[validate] ⚠️  frozen set — 勿用于 /goal 迭代');

  // 比较纪律（C-4，--baseline）
  if (args.baseline) {
    const prev = JSON.parse(fs.readFileSync(args.baseline, 'utf-8'));
    const { verdict, reason } = compareWithBaseline(stats, prev, args.minDelta);
    console.log(`[validate] 比较 vs baseline: ${verdict} — ${reason}`);
    output.comparison = { verdict, reason, baselinePassRate: prev.passRate };
    if (args.output) fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  }

  // /goal 末行（C-4）：PASSRATE=x CI=[lo,hi] 供 /goal 解析
  if (args.goal) {
    const pr = stats.passRate != null ? stats.passRate.toFixed(4) : 'null';
    const cilo = stats.ci && stats.ci.low !== null ? stats.ci.low.toFixed(4) : 'null';
    const cihi = stats.ci && stats.ci.high !== null ? stats.ci.high.toFixed(4) : 'null';
    console.log(`PASSRATE=${pr} CI=[${cilo},${cihi}]`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
