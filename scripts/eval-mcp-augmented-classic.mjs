#!/usr/bin/env node
/**
 * Feature 158 — SWE-Bench Lite Grounding Eval 入口脚本
 *
 * 3 对照组调度：
 *   - control          → tool=control               → tests/baseline/tasks/<task>/control/full.json
 *   - spectra-push     → tool=spec-driver-spectra   → tests/baseline/tasks/<task>/spec-driver-spectra/full.json
 *   - spectra-mcp-pull → tool=mcp-pull              → tests/baseline/tasks/<task>/mcp-pull/full.json
 *
 * 用法：
 *   node scripts/eval-mcp-augmented-classic.mjs --task T158-micrograd-1 --cohort all --repeats 3
 *   node scripts/eval-mcp-augmented-classic.mjs --task T158-micrograd-1,T158-micrograd-2 --cohort spectra-mcp-pull --repeats 3
 *   node scripts/eval-mcp-augmented-classic.mjs --task T158-micrograd-1 --cohort all --repeats 1 --dry-run
 *
 * 预算监控：每 run 后检查累计 costUsd；达 $35（70% 上限）主动 pause（exit 2）
 * Resume：fixture 输出 full.json 已存在则 skip 该 (task, cohort)；--force 强制覆盖
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  loadTaskFixture,
  prepareWorktree,
  runTask,
  runPrimaryOracle,
  captureProductMetrics,
  assembleTaskFixture,
  parseMcpToolCallTrace,
  parseStreamJsonUsage,
  loadSpectraContext,
  buildDriverPrompt,
  writeMcpConfig,
  runSpectraBatchInWorktree,
} from './eval-task-runner.mjs';
import { bootstrapPercentileCi } from './lib/bootstrap-ci.mjs';

function getTargetName(targetSpec) {
  const map = { 'karpathy/micrograd': 'micrograd', 'karpathy/nanoGPT': 'nanoGPT', 'self-dogfood': 'self-dogfood' };
  return map[targetSpec] ?? targetSpec.split('/').pop();
}

/**
 * Feature 158 CR-1 修订：bootstrap CI 聚合 adapter（mean-based percentile bootstrap，专为 binary pass/fail 设计）
 *
 * 设计选择（与 CR-1 原版差异说明 — Codex round-2 W-1 显式记录授权）：
 * - **CR-1 原写**"调用 bootstrapPercentileCi"，该 API 用 **median** 计 CI；对 binary 0/1 sample，
 *   median 几乎总是 0 或 1，CI 退化为 [0, 1] 无信息（已实测验证：18 sample 12 pass + 6 fail → CI=[0,1]）
 * - **本 adapter 选择 mean-based bootstrap** — 这是 CR-1 合同的偏离，但**统计学上必要**：
 *   - mean(0/1) = pass rate（直觉量）；passRate 与 CI 是同一统计量
 *   - median(0/1) ∈ {0, 1}（majority vote）；与 mean 语义不同，对 binary outcome CI 无信息量
 * - **18 sample (12 pass + 6 fail) 验证**：mean-based 给 CI [44.4%, 88.9%]（信息量正常）；median-based 给 CI [0, 1]（退化）
 * - **偏离记入 §6.4 / §6.5 报告**：未来若 CR-1 合同更新，以本注释为参考
 * - 对 N≥3 全相同样本（全 PASS 或全 FAIL），CI 收敛到 sample[0]（不退化）
 * - N<3 → 返回 ci95Lower=null, ci95Upper=null（统计功效不足）
 *
 * @param {Array<boolean|number>} samples - pass/fail 数组（true=pass, false=fail）或 0/1 数值
 * @param {{ b?: number, alpha?: number, rng?: () => number }} [opts]
 * @returns {{ passRate, ci95Lower, ci95Upper, repeats, b, method, reason? }}
 */
export function aggregateBootstrap(samples, opts = {}) {
  const numeric = samples.map((s) => (s === true ? 1 : s === false ? 0 : Number(s)));
  if (numeric.length === 0) {
    return { passRate: 0, ci95Lower: null, ci95Upper: null, repeats: 0, b: 0, method: 'mean-percentile-bootstrap', reason: 'no-samples' };
  }
  const passCount = numeric.filter((n) => n === 1).length;
  const passRate = passCount / numeric.length;

  if (numeric.length < 3) {
    return { passRate, ci95Lower: null, ci95Upper: null, repeats: numeric.length, b: 0, method: 'mean-percentile-bootstrap', reason: 'insufficient-samples' };
  }

  // 全相同样本快速路径（避免不必要 bootstrap）
  if (numeric.every((n) => n === numeric[0])) {
    return { passRate, ci95Lower: numeric[0], ci95Upper: numeric[0], repeats: numeric.length, b: 0, method: 'mean-percentile-bootstrap', reason: 'all-same-sample' };
  }

  const b = opts.b ?? 1000;
  const alpha = opts.alpha ?? 0.05;
  const rng = opts.rng ?? Math.random;
  const N = numeric.length;
  const replicates = new Array(b);
  for (let i = 0; i < b; i++) {
    let sum = 0;
    for (let j = 0; j < N; j++) {
      sum += numeric[Math.floor(rng() * N)];
    }
    replicates[i] = sum / N;
  }
  replicates.sort((a, b) => a - b);
  const lowIdx = Math.floor(b * (alpha / 2));
  const highIdx = Math.min(b - 1, Math.ceil(b * (1 - alpha / 2)) - 1);
  return {
    passRate,
    ci95Lower: replicates[lowIdx],
    ci95Upper: replicates[highIdx],
    repeats: numeric.length,
    b,
    method: 'mean-percentile-bootstrap',
    reason: null,
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BUDGET_PAUSE_THRESHOLD_USD = 35;

const COHORT_TO_TOOL = {
  'control': 'control',
  'spectra-push': 'spec-driver-spectra',
  'spectra-mcp-pull': 'mcp-pull',
};
const ALL_COHORTS = Object.keys(COHORT_TO_TOOL);

// 先验 cost 估算（用于 cost=null 时的 budget tracker 兜底；与 plan §7 预算估算对齐）
// claude --print --output-format text 不返回 modelUsage，需用此先验
const COST_PRIOR_USD = {
  'control': 0.10,                  // text mode，sonnet 4.6, ~5min, 简单 task
  'spec-driver-spectra': 0.20,      // text mode + spec.md 12KB push
  'mcp-pull': 0.40,                 // stream-json + spectra tool 多轮
};

// ============================================================
// argv
// ============================================================

export function parseArgs(argv) {
  const args = {
    tasks: null,
    cohorts: null,
    repeats: 3,
    dryRun: false,
    concurrency: 1,
    force: false,
    timeoutMs: 1800000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--task':
      case '--tasks': args.tasks = argv[++i].split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--cohort':
      case '--cohorts': {
        const v = argv[++i];
        args.cohorts = v === 'all' ? [...ALL_COHORTS] : v.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      }
      case '--repeats':
      case '-N': args.repeats = Number(argv[++i]); break;
      case '--dry-run': args.dryRun = true; break;
      case '--concurrency': {
        const n = Number(argv[++i]);
        // WARNING 1 修复：MVP 仅支持串行。> 1 抛错避免静默退化误导用户
        if (!Number.isFinite(n) || n !== 1) {
          throw new Error(`--concurrency=${n} not implemented; only --concurrency=1 (default) is supported in MVP`);
        }
        args.concurrency = 1;
        break;
      }
      case '--force': args.force = true; break;
      case '--timeout-ms': args.timeoutMs = Number(argv[++i]); break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!args.tasks || args.tasks.length === 0) throw new Error('--task <id>[,id...] required');
  if (!args.cohorts || args.cohorts.length === 0) throw new Error('--cohort all|<name>[,...] required');
  for (const c of args.cohorts) {
    if (!COHORT_TO_TOOL[c]) {
      throw new Error(`unknown cohort: ${c}; valid: ${ALL_COHORTS.join('|')}|all`);
    }
  }
  if (!Number.isFinite(args.repeats) || args.repeats < 1) throw new Error('--repeats must be a positive integer');
  return args;
}

// ============================================================
// 单 run 执行（in-process，不 spawn eval-task-runner.mjs subprocess）
// ============================================================

/**
 * 跑一次 (task, cohort) 的独立 run，产出 fixture 写到 <task>/<tool>/run-<N>/full.json
 * 不修改 <task>/<tool>/full.json（顶层聚合在 aggregateAndWriteFinal 中处理）
 */
async function runOneRun({ taskId, taskFixture, tool, runIdx, timeoutMs }) {
  const fixtureDir = path.join(PROJECT_ROOT, 'tests/baseline/tasks', taskId, tool, `run-${runIdx}`);
  fs.mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, 'full.json');

  console.log(`\n[mcp-augmented] === task=${taskId} cohort=${tool} run=${runIdx}/${'∞'} ===`);

  const wt = prepareWorktree({
    taskId,
    tool: `${tool}-r${runIdx}`,
    target: taskFixture.target,
    startCommit: taskFixture.startCommit,
  });

  // 任务级 setupHook
  if (Array.isArray(taskFixture.setupCommands) && taskFixture.setupCommands.length > 0) {
    const setupEnv = { ...process.env, SPECTRA_REPO_ROOT: PROJECT_ROOT };
    for (const cmd of taskFixture.setupCommands) {
      const r = spawnSync('bash', ['-c', cmd], { cwd: wt.wtDir, encoding: 'utf-8', env: setupEnv });
      if (r.status !== 0) throw new Error(`setup command failed: ${cmd}\nstderr: ${r.stderr}`);
    }
    spawnSync('git', ['-C', wt.wtDir, 'add', '-A'], { encoding: 'utf-8' });
    spawnSync('git', ['-C', wt.wtDir, 'commit', '-m', 'eval-bench: task setup'], { encoding: 'utf-8' });
  }

  // mcp-pull cohort：写 .mcp.json + 跑 spectra batch（首次跑后缓存到 ~/.spec-driver-bench-graph-cache，后续 run 复用）
  // WARNING 2 修复：避免每个 run 重复跑 spectra batch
  // graceful degrade：spectra batch 失败（nanoGPT 等大项目 timeout）时不阻塞 run；
  //   agent 调 spectra tool 会得到 "graph.json 不存在" 错误，oracle 仍可能 PASS（task 不强依赖 grounding）；
  //   失败 fixture 的 perf.graphMissing=true 用于 §6 分析（grounding 不可用归因）
  let graphMissing = false;
  if (tool === 'mcp-pull') {
    const graphPath = path.join(wt.wtDir, 'specs', '_meta', 'graph.json');
    if (!fs.existsSync(graphPath)) {
      const cacheKey = `${getTargetName(taskFixture.target)}-${taskFixture.startCommit}`;
      const cacheDir = path.join(os.homedir(), '.spec-driver-bench-graph-cache', cacheKey);
      if (fs.existsSync(path.join(cacheDir, 'graph.json'))) {
        console.log(`[mcp-augmented] mcp-pull: rsync cached spectra graph from ${cacheKey}`);
        const dstSpecsDir = path.join(wt.wtDir, 'specs');
        fs.mkdirSync(dstSpecsDir, { recursive: true });
        spawnSync('rsync', ['-a', `${cacheDir}/`, path.join(dstSpecsDir, '_meta') + '/'], { encoding: 'utf-8' });
      } else {
        console.log(`[mcp-augmented] mcp-pull: running spectra batch (will cache to ${cacheKey})...`);
        try {
          runSpectraBatchInWorktree(wt.wtDir, { timeoutMs: 1200000 }); // 20 min cap (nanoGPT 13 modules ~15 min)
          // 缓存 specs/_meta/ 到 home dir
          fs.mkdirSync(cacheDir, { recursive: true });
          spawnSync('rsync', ['-a', `${path.join(wt.wtDir, 'specs', '_meta')}/`, `${cacheDir}/`], { encoding: 'utf-8' });
        } catch (e) {
          console.warn(`[mcp-augmented] mcp-pull: spectra batch FAILED (${e.message.slice(0, 150)}); continuing with graphMissing=true (agent's spectra tool calls will error out)`);
          graphMissing = true; // W-4 修复：写入 run summary 让 graphMissing 可见
        }
      }
      spawnSync('git', ['-C', wt.wtDir, 'add', '-A'], { encoding: 'utf-8' });
      spawnSync('git', ['-C', wt.wtDir, 'commit', '-m', 'eval-bench: spectra graph'], { encoding: 'utf-8' });
    }
    writeMcpConfig(wt.wtDir);
  }

  // spectra context for spec-driver-spectra
  const spectraContext = tool === 'spec-driver-spectra' ? loadSpectraContext(taskFixture.target) : null;
  const prompt = buildDriverPrompt({ tool, taskPrompt: taskFixture.prompt, spectraContext });

  const runResult = runTask({ tool, prompt, wtDir: wt.wtDir, timeoutMs, bypassPermissions: true });
  console.log(`[mcp-augmented] claude done: wall=${(runResult.wallMs/1000).toFixed(1)}s, exit=${runResult.exitCode}, output=${runResult.stdout.length}B`);

  fs.writeFileSync(path.join(wt.wtDir, 'task-runner-stdout.log'), runResult.stdout, 'utf-8');
  fs.writeFileSync(path.join(wt.wtDir, 'task-runner-stderr.log'), runResult.stderr, 'utf-8');

  const oracleResult = runPrimaryOracle({ wtDir: wt.wtDir, oracle: taskFixture.primaryOracle });
  console.log(`[mcp-augmented] oracle ${oracleResult.kind}: ${oracleResult.passed ? 'PASS' : 'FAIL'}`);

  const productMetrics = captureProductMetrics(wt.wtDir);

  let mcpTrace = null;
  let w3Flag = null;
  let usage = null;
  if (tool === 'mcp-pull') {
    const expected = Array.isArray(taskFixture.expectedSpectraToolCalls) ? taskFixture.expectedSpectraToolCalls : null;
    const parsed = parseMcpToolCallTrace(runResult.stdout, expected);
    mcpTrace = parsed.trace;
    w3Flag = parsed.w3Flag;
    usage = parseStreamJsonUsage(runResult.stdout);
    const totalCalls = mcpTrace.reduce((s, t) => s + t.callCount, 0);
    console.log(`[mcp-augmented] mcp-trace: tools=${mcpTrace.length}, totalCalls=${totalCalls}, w3Flag=${w3Flag}, cost=$${(usage.costUsd ?? 0).toFixed(4)}`);
  }

  const fixture = assembleTaskFixture({
    taskId, tool, taskFixture, wtDir: wt.wtDir,
    runResult, oracleResult, productMetrics,
    claudeArgs: runResult.claudeArgs,
    mcpTrace, w3Flag, usage,
  });
  fixture.runIndex = runIdx;

  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf-8');
  console.log(`[mcp-augmented] fixture written: ${path.relative(PROJECT_ROOT, fixturePath)}`);

  // cleanup wtDir always (release disk; ephemeral by design)
  fs.rmSync(wt.wtDir, { recursive: true, force: true });

  return {
    runIdx,
    passed: oracleResult.passed,
    wallMs: runResult.wallMs,
    costUsd: fixture.taskExecution?.costUsd ?? null,
    w3Flag,
    mcpTrace, // CRITICAL 4 修复：保留 trace 详情供聚合
    usage,
    graphMissing, // W-4 修复：spectra batch 失败时让 graphMissing 进 run summary
    fixturePath,
  };
}

/**
 * 聚合 N 个 run 的结果，写入顶层 <task>/<tool>/full.json
 *
 * CRITICAL 2 修复：仅当 runs.length === requestedRepeats（全部 N 次都成功）时才写顶层 full.json；
 *                 否则写 .partial.json（不会被下次 resume skip 误判）。
 * CRITICAL 4 修复：保留每 run 的 mcpTrace 详情，并在 aggregate 中产出 trace 聚合指标。
 *
 * 输出 schema 1.2 兼容：保留单 run fixture 字段，外加：
 *   - runs: [{ runIdx, passed, wallMs, costUsd, w3Flag, mcpToolCallTrace }, ...]
 *   - aggregate: { passRate, repeats, w3FlaggedCount, totalCostUsd, totalWallMs, mcpTraceSummary, ... }
 *   bootstrap CI 由 T-012 按 cross-task 聚合层填回（单 (task, cohort) N=3 不做 bootstrap）
 */
async function aggregateAndWriteFinal({ taskId, tool, runs, requestedRepeats }) {
  const fixtureDir = path.join(PROJECT_ROOT, 'tests/baseline/tasks', taskId, tool);
  fs.mkdirSync(fixtureDir, { recursive: true });
  const fullPath = path.join(fixtureDir, 'full.json');
  const partialPath = path.join(fixtureDir, 'partial.json');

  if (runs.length === 0) {
    console.warn(`[mcp-augmented] no runs to aggregate for ${taskId} × ${tool} (all runs failed)`);
    return null;
  }

  // 取最后一次 run 的 fixture 作为 base（schema 1.2 完整字段都在）
  const lastFixturePath = runs[runs.length - 1].fixturePath;
  const baseFixture = JSON.parse(fs.readFileSync(lastFixturePath, 'utf-8'));

  // CRITICAL 4 修复：聚合 runs 摘要（保留 mcpTrace 详情）
  const runsSummary = runs.map((r) => ({
    runIdx: r.runIdx,
    passed: r.passed,
    wallMs: r.wallMs,
    costUsd: r.costUsd,
    w3Flag: r.w3Flag,
    mcpToolCallTrace: r.mcpTrace, // 保留每 run 的完整 trace
    usage: r.usage,
    graphMissing: r.graphMissing ?? false, // W-4 修复：spectra batch 失败时此 run 没有 graph 可用
  }));
  const graphMissingCount = runs.filter((r) => r.graphMissing === true).length;

  const passCount = runs.filter((r) => r.passed).length;
  const passRate = passCount / runs.length;
  const w3FlaggedCount = runs.filter((r) => r.w3Flag === true).length;
  const totalCostUsd = runs.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const totalWallMs = runs.reduce((s, r) => s + (r.wallMs ?? 0), 0);

  // CRITICAL 4 修复：mcpTrace 跨 run 聚合
  let mcpTraceSummary = null;
  if (tool === 'mcp-pull') {
    const allTraces = runs.map((r) => r.mcpTrace ?? []).filter((t) => Array.isArray(t));
    const totalCalls = allTraces.reduce((s, t) => s + t.reduce((sub, e) => sub + (e.callCount ?? 0), 0), 0);
    const avgCallsPerRun = allTraces.length > 0 ? totalCalls / allTraces.length : 0;
    const allFirstTurns = allTraces.flatMap((t) => t.map((e) => e.firstCallTurn).filter((n) => Number.isFinite(n)));
    const avgFirstCallTurn = allFirstTurns.length > 0 ? allFirstTurns.reduce((s, n) => s + n, 0) / allFirstTurns.length : null;
    const toolNameCounts = {};
    for (const trace of allTraces) {
      for (const entry of trace) {
        toolNameCounts[entry.toolName] = (toolNameCounts[entry.toolName] ?? 0) + entry.callCount;
      }
    }
    mcpTraceSummary = {
      totalCallsAcrossRuns: totalCalls,
      avgCallsPerRun,
      avgFirstCallTurn,
      toolNameCounts,
      runsWithW3Trap: w3FlaggedCount,
      w3TrapRate: runs.length > 0 ? w3FlaggedCount / runs.length : null,
    };
  }

  // Feature 158 CR-1：单 (task, cohort) N=requested runs 的 bootstrap CI（虽然 N=3 偏小，仍按 spec FR-004 要求记录）
  const bootstrap = aggregateBootstrap(runs.map((r) => r.passed === true));

  const final = {
    ...baseFixture,
    runs: runsSummary,
    aggregate: {
      repeats: runs.length,
      requestedRepeats,
      complete: runs.length === requestedRepeats,
      passRate,
      passCount,
      w3FlaggedCount,
      totalCostUsd,
      totalWallMs,
      mcpTraceSummary,
      graphMissingCount, // W-4 修复：cohort 内 run 数中 spectra batch 失败的数量
      // CR-1 修订：mean-percentile bootstrap 输出 (single-task scope，ci 偏窄；cross-task CI 在 §6 报告聚合层)
      ci95Lower: bootstrap.ci95Lower,
      ci95Upper: bootstrap.ci95Upper,
      bootstrapB: bootstrap.b,
      bootstrapMethod: bootstrap.method,
      bootstrapReason: bootstrap.reason,
    },
  };

  // CRITICAL 2 修复：partial 写到 partial.json（不会被 resume skip 误判）
  if (runs.length === requestedRepeats) {
    fs.writeFileSync(fullPath, JSON.stringify(final, null, 2) + '\n', 'utf-8');
    // 清理上次的 partial.json
    if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
    console.log(`[mcp-augmented] aggregated FULL: ${path.relative(PROJECT_ROOT, fullPath)} (passRate=${passRate.toFixed(3)}, N=${runs.length}/${requestedRepeats}, w3Flagged=${w3FlaggedCount})`);
    return { fullPath, complete: true };
  } else {
    fs.writeFileSync(partialPath, JSON.stringify(final, null, 2) + '\n', 'utf-8');
    console.warn(`[mcp-augmented] aggregated PARTIAL: ${path.relative(PROJECT_ROOT, partialPath)} (only ${runs.length}/${requestedRepeats} runs succeeded; full.json NOT written)`);
    return { partialPath, complete: false };
  }
}

// ============================================================
// 入口
// ============================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[mcp-augmented] tasks=${args.tasks.join(',')} cohorts=${args.cohorts.join(',')} repeats=${args.repeats} dryRun=${args.dryRun}`);

  let totalCost = 0;
  const summary = [];

  for (const cohort of args.cohorts) {
    const tool = COHORT_TO_TOOL[cohort];
    for (const taskId of args.tasks) {
      const fullPath = path.join(PROJECT_ROOT, 'tests/baseline/tasks', taskId, tool, 'full.json');
      if (fs.existsSync(fullPath) && !args.force) {
        const existing = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        const cnt = existing.runs?.length ?? 1;
        // 仅当已有 fixture 的 runs >= 请求的 repeats 时才 skip
        // （防止 N=1 smoke fixture 阻塞 N=3 全量重跑；--force 仍可强制覆盖）
        if (cnt >= args.repeats) {
          console.log(`[mcp-augmented] [skip-resume] ${taskId} × ${cohort}: existing full.json has ${cnt} >= ${args.repeats} runs`);
          summary.push({ taskId, cohort, status: 'skipped', runs: cnt });
          continue;
        }
        console.log(`[mcp-augmented] [resume-extend] ${taskId} × ${cohort}: existing has ${cnt} < ${args.repeats} runs — will overwrite with full ${args.repeats} runs`);
      }
      if (args.dryRun) {
        console.log(`[dry-run] would run ${taskId} × ${cohort} (tool=${tool}) N=${args.repeats}`);
        summary.push({ taskId, cohort, status: 'dry-run-planned', runs: args.repeats });
        continue;
      }

      let taskFixture;
      try {
        taskFixture = loadTaskFixture(taskId);
      } catch (e) {
        console.error(`[mcp-augmented] ERROR: cannot load ${taskId}: ${e.message}`);
        summary.push({ taskId, cohort, status: 'error', error: e.message });
        continue;
      }

      const runs = [];
      let runErrorCount = 0;
      for (let runIdx = 1; runIdx <= args.repeats; runIdx++) {
        try {
          const result = await runOneRun({ taskId, taskFixture, tool, runIdx, timeoutMs: args.timeoutMs });
          runs.push(result);
          // CR-6 修复：cost 缺失时用 cohort prior（plan §7 估算）；保证 budget tracker 总能积累
          const runCost = result.costUsd ?? COST_PRIOR_USD[tool] ?? 0.20;
          totalCost += runCost;
          if (totalCost >= BUDGET_PAUSE_THRESHOLD_USD) {
            console.error(`\n[BUDGET PAUSE] 累计成本 $${totalCost.toFixed(2)} >= $${BUDGET_PAUSE_THRESHOLD_USD}（NFR-001 70% 阈值）。停止后续 run，请评估是否继续。\n`);
            await aggregateAndWriteFinal({ taskId, tool, runs, requestedRepeats: args.repeats });
            process.exit(2);
          }
        } catch (e) {
          runErrorCount++;
          console.error(`[mcp-augmented] run ${runIdx} ERROR: ${e.message}`);
          // 不中断 — 让其他 run 继续；最终在 main 末尾汇总 error 数
        }
      }

      const aggResult = await aggregateAndWriteFinal({ taskId, tool, runs, requestedRepeats: args.repeats });
      // CRITICAL 3 修复：runs.length 完整性决定 status
      let status;
      if (runs.length === 0) {
        status = 'failed-all-runs-error';
      } else if (runs.length < args.repeats) {
        status = 'partial';
      } else {
        status = 'done';
      }
      summary.push({
        taskId,
        cohort,
        status,
        runs: runs.length,
        requested: args.repeats,
        runErrorCount,
        passRate: runs.length > 0 ? runs.filter((r) => r.passed).length / runs.length : null,
        w3FlaggedCount: runs.filter((r) => r.w3Flag === true).length,
        fullPath: aggResult?.fullPath ?? aggResult?.partialPath ?? null,
        complete: aggResult?.complete ?? false,
      });
    }
  }

  console.log('\n=== Summary ===');
  let exitErrCount = 0;
  for (const s of summary) {
    if (s.status === 'done') {
      console.log(`  ${s.taskId} × ${s.cohort}: ${s.runs}/${s.requested} runs DONE, passRate=${(s.passRate ?? 0).toFixed(3)}, w3Flagged=${s.w3FlaggedCount}`);
    } else if (s.status === 'partial') {
      console.error(`  ${s.taskId} × ${s.cohort}: PARTIAL ${s.runs}/${s.requested} (errors=${s.runErrorCount}); partial.json written, full.json NOT written`);
      exitErrCount++;
    } else if (s.status === 'failed-all-runs-error') {
      console.error(`  ${s.taskId} × ${s.cohort}: FAILED — all ${s.requested} runs threw exceptions`);
      exitErrCount++;
    } else if (s.status === 'error') {
      console.error(`  ${s.taskId} × ${s.cohort}: ERROR ${s.error ?? ''}`);
      exitErrCount++;
    } else {
      console.log(`  ${s.taskId} × ${s.cohort}: ${s.status}`);
    }
  }
  console.log(`\nTotal cost: $${totalCost.toFixed(4)}`);

  // CRITICAL 3 修复：任一 (task, cohort) partial / failed → exit nonzero
  if (exitErrCount > 0) {
    console.error(`\n[mcp-augmented] ${exitErrCount} (task, cohort) entries did not complete cleanly — exit 3 to surface to CI`);
    process.exit(3);
  }
}

const isCliEntry = process.argv[1]?.endsWith('eval-mcp-augmented-classic.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[mcp-augmented] FATAL: ${err.message}\n${err.stack}`);
    process.exit(1);
  });
}
