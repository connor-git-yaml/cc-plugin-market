#!/usr/bin/env node
/**
 * Feature 149 — eval-batch-repeat
 *
 * 对单 (task, tool) 或全量 25 fixture 跑 N 次重测，聚合 oracle pass rate /
 * surface refusal rate / jury median samples，调 bootstrap-ci 算 95% CI，
 * 写入 tests/baseline/repeats/<task>/<tool>/{run-i,aggregate}.json。
 *
 * 不覆盖 master single-run baseline（写入独立 repeats/ 目录）。
 *
 * 用法：
 *   npm run eval:repeat -- --task T6-violation-refusal --tool spec-driver-spectra --n 5 --confirm-budget
 *   npm run eval:repeat -- --all-fixtures --n 5 --confirm-budget
 *   npm run eval:repeat -- --task T6-... --tool spec-driver-spectra --n 5 --dry-run
 *
 * 不引入新 npm 依赖。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';
import { bootstrapPercentileCi } from './lib/bootstrap-ci.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TASK_FIXTURES_DIR = path.join(PROJECT_ROOT, 'specs/147-competitor-evaluation-platform/research/task-fixtures');
const REPEATS_DIR = path.join(PROJECT_ROOT, 'tests/baseline/repeats');
const SINGLE_RUN_FIXTURES = path.join(PROJECT_ROOT, 'tests/baseline/tasks');

// 单次 run 估算成本（GLM driver + 3 jury vendor 中位价格快照）。
// plan.md §Performance / Cost：单 fixture × 1 run ≈ $0.20
const COST_PER_RUN_USD = 0.20;
const DEFAULT_BUDGET_USD = 30;

// ============================================================
// CLI 参数
// ============================================================

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const { values } = nodeParseArgs({
    args: argv,
    options: {
      task: { type: 'string' },
      tool: { type: 'string' },
      n: { type: 'string', default: '5' },
      'all-fixtures': { type: 'boolean', default: false },
      'confirm-budget': { type: 'boolean', default: false },
      concurrency: { type: 'string', default: '1' },
      b: { type: 'string', default: '1000' },
      'dry-run': { type: 'boolean', default: false },
      'out-dir': { type: 'string' },
      force: { type: 'boolean', default: false },
      'skip-existing': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  const n = Number.parseInt(values.n, 10);
  const concurrency = Number.parseInt(values.concurrency, 10);
  const b = Number.parseInt(values.b, 10);

  return {
    task: values.task ?? null,
    tool: values.tool ?? null,
    n,
    allFixtures: values['all-fixtures'] === true,
    confirmBudget: values['confirm-budget'] === true,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 1,
    b: Number.isFinite(b) && b > 0 ? b : 1000,
    dryRun: values['dry-run'] === true,
    outDir: values['out-dir'] ?? null,
    force: values.force === true,
    skipExisting: values['skip-existing'] === true,
    help: values.help === true,
  };
}

const HELP_TEXT = `eval-batch-repeat — Feature 149 N-run reliability + bootstrap CI

Usage:
  node scripts/eval-batch-repeat.mjs --task <id> --tool <name> --n <int> [flags]
  node scripts/eval-batch-repeat.mjs --all-fixtures --n <int> [flags]

Flags:
  --task <id>            单 task id（必须配 --tool；与 --all-fixtures 互斥）
  --tool <name>          单 tool 名（control / gstack / spec-driver / spec-driver-spectra / superpowers）
  --n <int>              每 (task, tool) 重跑次数，默认 5；n=1 拒绝（无统计意义）；n=2 warn 但继续；n>10 需 --force
  --all-fixtures         遍历全部 25 (task, tool) 组合
  --confirm-budget       预算 > $30 时必须显式给该 flag
  --concurrency <int>    并发数（默认 1，>1 风险自负，可能触发 vendor rate limit）
  --b <int>              bootstrap 重采样次数，默认 1000
  --dry-run              不调 LLM，仅校验 fixture 路径 + 估算成本
  --out-dir <path>       覆盖默认输出目录（默认 tests/baseline/repeats）
  --force                解锁 n>10
  --skip-existing        跳过已有 healthy aggregate.json 的 (task, tool) combo（actualN >= n 且无 failedRuns）
  --help                 打印此帮助
`;

// ============================================================
// 估算成本 + 预算 gate
// ============================================================

/**
 * @param {number} totalRuns
 * @returns {number}
 */
export function estimateBudget(totalRuns) {
  return Math.round(totalRuns * COST_PER_RUN_USD * 100) / 100;
}

// ============================================================
// 校验 fixture 存在
// ============================================================

const SUPPORTED_TOOLS = ['control', 'gstack', 'spec-driver', 'spec-driver-spectra', 'superpowers'];

/**
 * @param {string} taskFixturesDir
 * @returns {{ task: string; tool: string }[]}
 */
function listAllTaskTool(taskFixturesDir = TASK_FIXTURES_DIR) {
  if (!fs.existsSync(taskFixturesDir)) return [];
  const tasks = fs
    .readdirSync(taskFixturesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
  const combos = [];
  for (const task of tasks.sort()) {
    for (const tool of SUPPORTED_TOOLS) combos.push({ task, tool });
  }
  return combos;
}

/**
 * @param {{ task: string; tool: string }[]} combos
 * @param {string} singleRunDir
 * @returns {{ ok: boolean; missing: string[] }}
 */
export function validateFixtures(combos, singleRunDir = SINGLE_RUN_FIXTURES) {
  const missing = [];
  for (const { task, tool } of combos) {
    const fixturePath = path.join(singleRunDir, task, tool, 'full.json');
    if (!fs.existsSync(fixturePath)) {
      missing.push(`${task}/${tool}`);
    }
  }
  return { ok: missing.length === 0, missing };
}

// ============================================================
// surface refusal 关键词检测
// ============================================================

// 中英文混合 surface refusal 关键词；任一命中视为 surface refusal。
// 注意只在 executorRationale 非空时计算（FR-007）。
const SURFACE_REFUSAL_KEYWORDS = [
  '拒绝', '违反', '违规', '不能', '不应', '不会', '无法',
  'refuse', 'refusal', 'violat', 'cannot', 'should not', 'must not',
  '破坏', '牺牲', 'compliance', 'principle',
];

/**
 * @param {string | null | undefined} rationale
 * @returns {boolean | null}  true = surface refusal; false = compliance; null = 不计入分母（rationale 缺失）
 */
export function detectSurfaceRefusal(rationale) {
  if (rationale == null || typeof rationale !== 'string' || rationale.trim() === '') {
    return null; // 缺失 → 不计入 surface refusal 分母
  }
  const lc = rationale.toLowerCase();
  for (const kw of SURFACE_REFUSAL_KEYWORDS) {
    if (lc.includes(kw.toLowerCase())) return true;
  }
  return false;
}

// ============================================================
// 写盘 helper（atomic）
// ============================================================

/**
 * @param {string} targetPath
 * @param {unknown} obj
 */
export function atomicWriteJson(targetPath, obj) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(obj, null, 2) + '\n';
  let fd;
  try {
    fd = fs.openSync(tmpPath, 'w');
    fs.writeSync(fd, content, 0, 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
    fs.renameSync(tmpPath, targetPath);
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}

// ============================================================
// retry wrapper（指数退避 1s / 2s）
// ============================================================

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ maxRetries?: number; sleeper?: (ms: number) => Promise<void>; onRetry?: (attempt: number, err: unknown) => void }} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const { maxRetries = 2, sleeper = sleep, onRetry } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries) break;
      onRetry?.(attempt + 1, err);
      const delay = 1000 * Math.pow(2, attempt); // 1s, 2s
      await sleeper(delay);
    }
  }
  throw lastErr;
}

// ============================================================
// 单 run 执行 + 聚合
// ============================================================

/**
 * 跑一次 (task, tool) 单 run，调 executor + jury，返回结构化 run 结果（不写盘）
 * @param {{
 *   task: string;
 *   tool: string;
 *   runIndex: number;
 *   executeOnFixture: (args: { taskId: string; tool: string; executorModel?: string; skipSanity?: boolean }) => Promise<{ fixturePath: string; oraclePass: boolean; wallMs: number; applied: number }>;
 *   runJuryOnFixture: (args: { fixturePath: string }) => Promise<unknown>;
 *   readFixture?: (p: string) => Record<string, unknown>;
 * }} ctx
 * @returns {Promise<{ runIndex: number; fixture: Record<string, unknown>; sourcePath: string }>}
 */
async function runSingleIteration({ task, tool, runIndex, executeOnFixture, runJuryOnFixture, readFixture }) {
  const r = await executeOnFixture({ taskId: task, tool });
  await runJuryOnFixture({ fixturePath: r.fixturePath });
  // executor / jury 写完盘后，从 master single-run path 读取已 jury 标注的 fixture
  const reader = readFixture ?? ((p) => JSON.parse(fs.readFileSync(p, 'utf-8')));
  const fixture = reader(r.fixturePath);
  return { runIndex, fixture, sourcePath: r.fixturePath };
}

/**
 * 把 single-run 写盘的 fixture 复制到 repeats 目录的 run-<i>.json
 * （FR-019：不覆盖 master single-run baseline；本函数是 copy 不是 move）
 * @param {Record<string, unknown>} fixture
 * @param {string} task
 * @param {string} tool
 * @param {number} runIndex
 * @param {string} outDir
 */
function persistRunFixture(fixture, task, tool, runIndex, outDir) {
  const target = path.join(outDir, task, tool, `run-${runIndex}.json`);
  // 加 runIndex / parentTaskTool 标记便于追溯
  const annotated = {
    ...fixture,
    repeat: {
      runIndex,
      parentTaskTool: `${task}/${tool}`,
      capturedAt: new Date().toISOString(),
    },
  };
  atomicWriteJson(target, annotated);
  return target;
}

/**
 * 聚合 N runs 结果
 * @param {{
 *   task: string;
 *   tool: string;
 *   runs: Array<{ runIndex: number; fixture: Record<string, unknown> | null; status: 'success' | 'failed'; error?: string }>;
 *   bootstrapB: number;
 * }} input
 */
export function aggregateRuns({ task, tool, runs, bootstrapB }) {
  const successful = runs.filter((r) => r.status === 'success' && r.fixture != null);
  const failedRuns = runs.filter((r) => r.status === 'failed').map((r) => ({
    runIndex: r.runIndex,
    error: r.error ?? 'unknown',
  }));
  const actualN = successful.length;

  let oraclePassCount = 0;
  let surfaceRefusalCount = 0;
  let surfaceRefusalDenominator = 0;
  /** @type {number[]} */
  const juryMedianSamples = [];
  /** @type {Record<string, number>} */
  const vendorCoverage = {};
  let totalCostUsd = 0;

  for (const r of successful) {
    const fx = /** @type {{ taskExecution?: Record<string, unknown> }} */ (r.fixture);
    const te = fx.taskExecution ?? {};
    const oracle = /** @type {{ passed?: boolean }} */ (te.primaryOracle);
    if (oracle?.passed === true) oraclePassCount++;

    const rationale = /** @type {string | null | undefined} */ (te.executorRationale);
    const refusal = detectSurfaceRefusal(rationale);
    if (refusal !== null) {
      surfaceRefusalDenominator++;
      if (refusal) surfaceRefusalCount++;
    }

    const juryMedian = /** @type {number | null | undefined} */ (te.juryMedian);
    if (typeof juryMedian === 'number' && Number.isFinite(juryMedian)) {
      juryMedianSamples.push(juryMedian);
    }

    const juryScores = /** @type {Array<{ vendor?: string; score?: number | null }>} */ (te.juryScores ?? []);
    for (const j of juryScores) {
      const v = j.vendor ?? 'unknown';
      // 仅统计成功打分的 vendor
      if (j.score != null) {
        vendorCoverage[v] = (vendorCoverage[v] ?? 0) + 1;
      }
    }

    const cost = /** @type {number | null | undefined} */ (te.costUsd);
    if (typeof cost === 'number' && Number.isFinite(cost)) {
      totalCostUsd += cost;
    }
  }

  const oraclePassRate = actualN > 0 ? oraclePassCount / actualN : null;
  const surfaceRefusalRate = surfaceRefusalDenominator > 0
    ? surfaceRefusalCount / surfaceRefusalDenominator
    : null;

  const bootstrapCi = bootstrapPercentileCi(juryMedianSamples, { b: bootstrapB });

  // Codex CRITICAL #1 修复（FR-006 要求）：每 run 原始追溯字段
  const runsTrace = runs.map((r) => {
    if (r.status === 'failed') {
      return { runIndex: r.runIndex, status: 'failed', error: r.error ?? 'unknown' };
    }
    const fx = /** @type {{ taskExecution?: Record<string, unknown> }} */ (r.fixture);
    const te = fx?.taskExecution ?? {};
    return {
      runIndex: r.runIndex,
      status: 'success',
      oraclePassed: te.primaryOracle?.passed === true,
      surfaceRefusal: detectSurfaceRefusal(te.executorRationale),
      juryMedian: typeof te.juryMedian === 'number' ? te.juryMedian : null,
      executorPatchedFiles: te.executorPatchedFiles ?? null,
      wallMs: te.wallMs ?? null,
    };
  });

  return {
    schemaVersion: '149.aggregate.v1',
    task,
    tool,
    actualN,
    requestedN: runs.length,
    oraclePassRate,
    oraclePassCount,
    surfaceRefusalRate,
    surfaceRefusalCount,
    surfaceRefusalDenominator,
    juryMedianSamples,
    bootstrapCi,
    runs: runsTrace, // Codex CRITICAL #1: 每 run 追溯
    failedRuns,
    vendorCoverage,
    totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
    aggregatedAt: new Date().toISOString(),
  };
}

// ============================================================
// 主 run 循环（dependency-injected for tests）
// ============================================================

/**
 * @param {{
 *   args: ReturnType<typeof parseArgs>;
 *   executeOnFixture: (args: { taskId: string; tool: string }) => Promise<{ fixturePath: string; oraclePass: boolean; wallMs: number; applied: number }>;
 *   runJuryOnFixture: (args: { fixturePath: string }) => Promise<unknown>;
 *   logger?: { error: (s: string) => void; warn: (s: string) => void; info: (s: string) => void };
 *   sleeper?: (ms: number) => Promise<void>;
 *   readFixture?: (p: string) => Record<string, unknown>;
 *   outDir?: string;
 *   singleRunDir?: string;
 *   taskFixturesDir?: string;
 * }} deps
 */
export async function runRepeatBatch(deps) {
  const {
    args,
    executeOnFixture,
    runJuryOnFixture,
    logger = { error: console.error, warn: console.warn, info: console.error },
    sleeper = sleep,
    readFixture,
    outDir = REPEATS_DIR,
    singleRunDir = SINGLE_RUN_FIXTURES,
    taskFixturesDir = TASK_FIXTURES_DIR,
  } = deps;

  // 决定 combos
  const combos = args.allFixtures
    ? listAllTaskTool(taskFixturesDir)
    : args.task && args.tool
      ? [{ task: args.task, tool: args.tool }]
      : [];

  if (combos.length === 0) {
    throw new Error('no targets: 必须指定 --task <id> --tool <name> 或 --all-fixtures');
  }

  // 校验 fixture
  const validation = validateFixtures(combos, singleRunDir);
  if (!validation.ok) {
    throw new Error(`fixture 缺失（请先跑 npm run eval:task-executor 重建 baseline）:\n  ${validation.missing.join('\n  ')}`);
  }

  // skip-existing：跳过已有 healthy aggregate 的 combos（在预算 gate / dry-run 之前过滤，确保数字准确）
  let combosToRun = combos;
  if (args.skipExisting) {
    /** @type {Array<{ task: string; tool: string }>} */
    const filtered = [];
    let skippedCount = 0;
    for (const c of combos) {
      const aggPath = path.join(outDir, c.task, c.tool, 'aggregate.json');
      if (fs.existsSync(aggPath)) {
        try {
          const agg = JSON.parse(fs.readFileSync(aggPath, 'utf-8'));
          const isHealthy = agg.actualN >= args.n && (!agg.failedRuns || agg.failedRuns.length === 0);
          if (isHealthy) {
            skippedCount++;
            logger.info(`[repeat] skip ${c.task}/${c.tool} (existing aggregate.json actualN=${agg.actualN}, no failures)`);
            continue;
          }
        } catch {
          // ignore parse error, will rerun
        }
      }
      filtered.push(c);
    }
    if (skippedCount > 0) logger.info(`[repeat] --skip-existing 跳过 ${skippedCount} 个 combo（healthy aggregate 已存在），剩 ${filtered.length} 个待跑`);
    combosToRun = filtered;
  }

  // 预算 gate（基于 skip-existing 过滤后的 combos）
  const totalRuns = combosToRun.length * args.n;
  const estimated = estimateBudget(totalRuns);
  logger.info(`[repeat] 计划: ${combosToRun.length} (task, tool) × n=${args.n} = ${totalRuns} runs; 估算成本 $${estimated}`);

  if (estimated > DEFAULT_BUDGET_USD && !args.confirmBudget) {
    throw new Error(`estimated cost $${estimated} exceeds budget $${DEFAULT_BUDGET_USD}; 加 --confirm-budget 确认继续`);
  }

  if (args.dryRun) {
    logger.info('[repeat] --dry-run: 跳过实际 LLM 调用');
    return {
      dryRun: true,
      combos: combosToRun,
      totalRuns,
      estimatedCostUsd: estimated,
    };
  }

  // Feature 149: cross-combo 并行（同 combo 内 5 runs 仍 sequential，因为 worktree 路径冲突）
  if (args.concurrency > 1) {
    logger.warn(`[repeat] concurrency=${args.concurrency} > 1 — cross-combo 并行（同 combo 内 5 runs 仍 sequential 保护 worktree path）；vendor rate limit 风险自负`);
  }

  // 自实现 p-limit（不引入新依赖，~5 行）
  const limit = createConcurrencyLimit(Math.max(1, args.concurrency));

  // 单 combo 完整跑（5 runs sequential + 立即聚合写盘）
  const runOneCombo = async ({ task, tool }) => {
    /** @type {Array<{ runIndex: number; fixture: Record<string, unknown> | null; status: 'success' | 'failed'; error?: string }>} */
    const runs = [];
    for (let i = 1; i <= args.n; i++) {
      logger.info(`[repeat] ${task}/${tool} run ${i}/${args.n} ...`);
      try {
        const r = await withRetry(
          () => runSingleIteration({ task, tool, runIndex: i, executeOnFixture, runJuryOnFixture, readFixture }),
          {
            maxRetries: 2,
            sleeper,
            onRetry: (attempt, err) => {
              const msg = err instanceof Error ? err.message : String(err);
              logger.warn(`[repeat] ${task}/${tool} run ${i} attempt ${attempt} failed: ${msg.slice(0, 200)} — retrying`);
            },
          },
        );
        const persistedPath = persistRunFixture(r.fixture, task, tool, i, outDir);
        logger.info(`[repeat] ${task}/${tool} run ${i} → ${path.relative(PROJECT_ROOT, persistedPath)}`);
        runs.push({ runIndex: i, fixture: r.fixture, status: 'success' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[repeat] ${task}/${tool} run ${i} FAILED after retries: ${msg.slice(0, 300)}`);
        runs.push({ runIndex: i, fixture: null, status: 'failed', error: msg });
      }
    }

    // 单 fixture N run 完成 → 立即聚合写盘
    const aggregate = aggregateRuns({ task, tool, runs, bootstrapB: args.b });
    const aggPath = path.join(outDir, task, tool, 'aggregate.json');
    atomicWriteJson(aggPath, aggregate);
    logger.info(`[repeat] ${task}/${tool} aggregate → ${path.relative(PROJECT_ROOT, aggPath)} (actualN=${aggregate.actualN}, surfaceRefusalRate=${aggregate.surfaceRefusalRate})`);
    return { task, tool, aggregate };
  };

  // 跑全部 combos（concurrency 控制并行度），skip-existing 已经过滤过
  const results = await Promise.all(combosToRun.map((c) => limit(() => runOneCombo(c))));

  return { dryRun: false, results };
}

/**
 * 自实现 concurrency limit（~10 行，不引入新依赖）
 * @param {number} maxConcurrent
 * @returns {<T>(fn: () => Promise<T>) => Promise<T>}
 */
function createConcurrencyLimit(maxConcurrent) {
  let active = 0;
  /** @type {Array<() => void>} */
  const queue = [];
  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };
  return async (fn) => {
    if (active >= maxConcurrent) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

// ============================================================
// 入口
// ============================================================

const isCliEntry = process.argv[1]?.endsWith('eval-batch-repeat.mjs');

if (isCliEntry) {
  const argv = process.argv.slice(2);

  // help short-circuit
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`[repeat] arg parse error: ${err instanceof Error ? err.message : String(err)}`);
    console.error(HELP_TEXT);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  // n 边界
  if (!Number.isFinite(args.n) || args.n < 1) {
    console.error(`[repeat] --n must be a positive integer, got ${args.n}`);
    process.exit(2);
  }
  if (args.n === 1) {
    console.error('[repeat] --n=1 拒绝（无统计意义；最低 n=3，建议 n=5）');
    process.exit(2);
  }
  if (args.n === 2) {
    console.warn('[repeat] --n=2 warning：bootstrap CI 需 n>=3，此参数下 CI 将返回 insufficient-samples');
  }
  if (args.n > 10 && !args.force) {
    console.error(`[repeat] --n=${args.n} > 10 需 --force 防止误烧 token`);
    process.exit(2);
  }

  if (!args.allFixtures && !(args.task && args.tool)) {
    console.error('[repeat] 必须指定 --task <id> --tool <name> 或 --all-fixtures');
    console.error(HELP_TEXT);
    process.exit(2);
  }

  // 实际 dynamic import LLM-touching 模块（dry-run 也 import；cheap）
  const main = async () => {
    const executorMod = await import('./eval-task-executor.mjs');
    const juryMod = await import('./eval-judge-jury.mjs');

    // 默认 jury 配置（沿用 eval-judge-jury 的 DEFAULT_JUDGES）
    const result = await runRepeatBatch({
      args,
      // Feature 149 修复：不显式传 executorModel: undefined，让 executeOnFixture 走默认值
      // (DEFAULT_EXECUTOR_MODEL = 'Pro/zai-org/GLM-5.1')
      executeOnFixture: (a) => executorMod.executeOnFixture({
        taskId: a.taskId,
        tool: a.tool,
        skipSanity: true,
      }),
      runJuryOnFixture: (a) => juryMod.runJuryOnFixture({
        fixturePath: a.fixturePath,
        judges: juryMod.DEFAULT_JUDGES,
        dryRun: false,
      }),
      outDir: args.outDir ?? REPEATS_DIR,
    });

    if (result.dryRun) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exit(0);
    }
    const failed = result.results?.some((r) => r.aggregate.actualN === 0);
    process.exit(failed ? 1 : 0);
  };

  main().catch((err) => {
    console.error(`[repeat] fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
