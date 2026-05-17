#!/usr/bin/env node
/**
 * Feature 158 — SWE-Bench Grounding Eval 主脚本（Batch 3 实现）
 *
 * 用途：
 *   驱动 3 组对比实验（A: bare baseline / B: spec.md push / C: MCP pull），
 *   对每个 SWE-Bench Lite Python 子集 fixture 跑 N 次重复，产出 run-N.json。
 *
 * 三组对比设计（spec.md FR-C-001 / 002 / 003）：
 *   - Group A: 仅以 fixture.prompt 调用 claude，零额外 context，不启用 MCP
 *   - Group B: 注入 Spectra spec.md 作为 system prompt 前缀（spec-driver-spectra 风格）
 *             —— 若目标仓库 baseline 不存在则降级为 A（specPushDegraded: true）
 *   - Group C: claude --mcp-config <tmp.json> --strict-mcp-config，agent 通过
 *             mcp__spectra__{impact,context,detect_changes} 按需 pull context；
 *             配合 src/mcp/agent-context-tools.ts 的 telemetry hook 采集
 *             mcpToolCallCount / mcpResponseBytes 写入 run-N.json。
 *
 * 关键复用（FR-B-001）：
 *   import { prepareWorktree, runTask, runPrimaryOracle, captureProductMetrics }
 *     from './eval-task-runner.mjs'
 *   不复用 loadSpectraContext —— runner 内部 target map 不含 SWE-Bench 仓库；
 *   本脚本自实现 loadSpectraContextForSweBench()。
 *
 * 用法：
 *   node scripts/eval-mcp-augmented.mjs --group A|B|C --task <taskId> [--repeat N]
 *                                       [--dry-run] [--stop-loss USD]
 *                                       [--max-judge-calls N] [--keep-temp]
 *                                       [--all-fixtures]
 *
 * 退出码（FR-B-007）：
 *   0  — 正常结束（含部分 oracle fail / dry-run / stop-loss 触发）
 *   非0 — 脚本自身 infrastructure error（fixture 解析失败 / claude spawn 抛错等）
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  prepareWorktree,
  runPrimaryOracle,
  captureProductMetrics,
} from './eval-task-runner.mjs';
// Feature 162 FR-027 入口位点 1/3：runForTaskList 之前 self-judge hard-fail 检查
import { assertNoSelfJudge } from './lib/llm-backend-dispatcher.mjs';
import { DEFAULT_JUDGES } from './eval-judge-jury.mjs';

// Feature 162 Phase C：quota state store + subAgentMeta 双轨采集（plan §2.3 / §2.4.5）
import {
  reserveQuota,
  acquirePerRunLock,
  classifyRuns,
  validateAcceptRestartPartial,
  applyPartialDecision,
  writeRunStarted,
  writeRunFinalizedSuccess,
  writeRunFinalizedFailed,
  EX_USAGE,
} from './lib/eval-quota-store.mjs';
import {
  injectSubAgentMetaEnv,
  readEnvInjectedMeta,
  parseSubAgentSelfReport,
  mergeSubAgentMeta,
  deriveInheritanceStatus,
} from './lib/sub-agent-meta.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(
  PROJECT_ROOT,
  'tests/baseline/swe-bench-lite/fixtures',
);
const RUNS_DIR = path.join(PROJECT_ROOT, 'tests/baseline/swe-bench-lite/runs');
const MCP_DIST_ENTRY = path.join(PROJECT_ROOT, 'dist/cli/index.js');
const MCP_SRC_DIR = path.join(PROJECT_ROOT, 'src/mcp');

const DRY_RUN_COST_PER_RUN_USD = 0.25; // 估算（FR-B-005 / FR-B-008）
const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 min hard ceiling，沿用 runner 默认

// Feature 162 Phase C：quota state store 路径（plan §2.3.1）
const QUOTA_HOME = path.join(
  process.env.HOME ?? os.tmpdir(),
  '.cache',
  'spectra',
  'eval-quota',
);
const QUOTA_STORE_PATH = path.join(QUOTA_HOME, 'feature-162.json');
const QUOTA_LOCK_PATH = path.join(QUOTA_HOME, 'feature-162.lock');
const QUOTA_HISTORY_PATH = path.join(QUOTA_HOME, 'feature-162-history.jsonl');
const DEFAULT_MAX_RUNS_PER_DAY = 150; // pilot T055 后再校准；先设保守默认

// SWE-Bench target → baseline 目录名（不复用 runner 的硬编码 map）
const SWEBENCH_TARGET_MAP = {
  'sympy/sympy': 'sympy',
  'astropy/astropy': 'astropy',
  'pytest-dev/pytest': 'pytest',
};

// ───────────────────────────────────────────────────────────
// Feature 165 — Graph Injection（Cohort C）+ 前置断言（Cohort A/B）
// ───────────────────────────────────────────────────────────

// graph 文件在 baseline 仓库 + worktree 内部的统一相对路径
export const GRAPH_FILENAME = 'specs/_meta/graph.json';

/**
 * RUNTIME_SPECTRA_VERSION
 * 探测优先级：(1) spectra CLI --version 探测 →
 *           (2) package.json.version fallback →
 *           (3) 'unknown' safe-fail（所有 graph 注入会因 version mismatch 失败）
 * 在文件顶层 IIFE 中执行一次，避免每 run 重复探测。
 */
export const RUNTIME_SPECTRA_VERSION = (() => {
  // 优先 CLI 探测（代表当前 runtime）
  try {
    const out = execFileSync('node', [MCP_DIST_ENTRY, '--version'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = out.trim().match(/(\d+\.\d+\.\d+)/);
    if (m) return m[1];
  } catch {
    /* fallback below */
  }
  // fallback 1：package.json
  try {
    const pkgPath = path.join(PROJECT_ROOT, 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
  } catch {
    // fallback 2：safe-fail
    return 'unknown';
  }
})();

/**
 * 计算文件的 SHA256 hex hash，用于 atomic copy 完整性校验
 * @param {string} filePath
 * @returns {string} hex 摘要
 */
export function computeFileHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * validateGraphSchema(graphPath, runtimeSpectraVersion)
 * 校验 graph.json 的 schema 合法性 + version 匹配。
 * 用于注入前（source）和注入后（dest）两次校验，FR-011 双阶段合同。
 * @returns {{ ok: true } | { ok: false, errorCode: string, reason: string }}
 */
export function validateGraphSchema(graphPath, runtimeSpectraVersion) {
  let raw;
  try {
    raw = fs.readFileSync(graphPath, 'utf-8');
  } catch (e) {
    return { ok: false, errorCode: 'graph-not-built', reason: `read error: ${e.message}` };
  }
  let g;
  try {
    g = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errorCode: 'graph-not-built', reason: `parse error: ${e.message}` };
  }
  if (!g || typeof g !== 'object') {
    return { ok: false, errorCode: 'graph-schema-mismatch', reason: 'not an object' };
  }
  // Codex GATE_VERIFY WARNING #3 修复：除字段存在性外，必须验证 nodes/links/callSites 全是数组
  // 防止 graph.json 把 nodes/links/callSites 写成 object/number/string 等非数组类型
  if (!Array.isArray(g.nodes) || !Array.isArray(g.links) || !Array.isArray(g.callSites)) {
    return { ok: false, errorCode: 'graph-schema-mismatch', reason: 'nodes/links/callSites must be arrays' };
  }
  if (g.callSites.length === 0) {
    return { ok: false, errorCode: 'payload-empty', reason: 'callSites empty' };
  }
  const gv = g.graphSchemaVersion ?? g.spectraVersion ?? null;
  if (gv !== runtimeSpectraVersion) {
    return {
      ok: false,
      errorCode: 'graph-schema-mismatch',
      reason: `version mismatch: graph=${gv} runtime=${runtimeSpectraVersion}`,
    };
  }
  return { ok: true };
}

/**
 * injectGraph({ taskFixture, wtDir, runtimeSpectraVersion })
 * Cohort C 注入：source 校验 → atomic copy（写 tmp + fsync(tmpFd) + rename +
 * fsync(dirFd）→ dest 二次校验。返回 graphInjection telemetry 对象。
 * @returns {object} 形如 { status, sourcePath, destPath, sourceHash, destHash?,
 *                          spectraVersion, graphSchemaVersion, errorCode?, reason? }
 */
export function injectGraph({ taskFixture, wtDir, runtimeSpectraVersion }) {
  const baselineHome = process.env.SPECTRA_BASELINE_HOME
    ?? path.join(os.homedir(), '.spectra-baselines');
  const baselineName = SWEBENCH_TARGET_MAP[taskFixture.target];

  // 未知 target：source 不存在的特殊形式
  const sourcePath = baselineName
    ? path.join(baselineHome, baselineName, GRAPH_FILENAME)
    : path.join(baselineHome, '__unknown__', GRAPH_FILENAME);
  const destPath = path.join(wtDir, GRAPH_FILENAME);

  // ── ① source schema validate ─────────────────────────────
  const srcValid = validateGraphSchema(sourcePath, runtimeSpectraVersion);
  if (!srcValid.ok) {
    return {
      status: 'failed',
      sourcePath,
      destPath,
      errorCode: srcValid.errorCode,
      reason: srcValid.reason,
      spectraVersion: null,
      graphSchemaVersion: null,
      sourceHash: null,
    };
  }

  const g = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
  const graphSchemaVersion = g.graphSchemaVersion ?? g.spectraVersion ?? runtimeSpectraVersion;
  const sourceHash = computeFileHash(sourcePath);

  // ── ② atomic copy（write tmp → fsync(tmpFd) → rename → fsync(dirFd)）─
  const tmpPath = `${destPath}.tmp.${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const buf = fs.readFileSync(sourcePath);
    const tmpFd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeSync(tmpFd, buf);
      fs.fsyncSync(tmpFd);
    } finally {
      fs.closeSync(tmpFd);
    }
    fs.renameSync(tmpPath, destPath);
    // POSIX 合同：父目录 fsync 确保 rename 元数据落盘
    const dirFd = fs.openSync(path.dirname(destPath), 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return {
      status: 'failed',
      sourcePath,
      destPath,
      errorCode: 'copy-integrity-failed',
      reason: `copy failed: ${e.message}`,
      spectraVersion: g.spectraVersion ?? null,
      graphSchemaVersion,
      sourceHash,
    };
  }

  // ── ③ dest 二次校验（hash + schema） ──────────────────────
  const destHash = computeFileHash(destPath);
  if (destHash !== sourceHash) {
    return {
      status: 'failed',
      sourcePath,
      destPath,
      errorCode: 'copy-integrity-failed',
      reason: `hash mismatch: src=${sourceHash} dest=${destHash}`,
      spectraVersion: g.spectraVersion ?? null,
      graphSchemaVersion,
      sourceHash,
    };
  }
  const destValid = validateGraphSchema(destPath, runtimeSpectraVersion);
  if (!destValid.ok) {
    // Codex W-4 修复：dest 二次校验失败统一返回 copy-integrity-failed，
    // 原始 source-stage errorCode 放进 causeErrorCode 保留诊断信息
    return {
      status: 'failed',
      sourcePath,
      destPath,
      errorCode: 'copy-integrity-failed',
      causeErrorCode: destValid.errorCode,
      reason: `dest re-validate: ${destValid.reason}`,
      spectraVersion: g.spectraVersion ?? null,
      graphSchemaVersion,
      sourceHash,
      destHash,
    };
  }

  return {
    status: 'success',
    sourcePath,
    destPath,
    sourceHash,
    destHash,
    spectraVersion: g.spectraVersion ?? runtimeSpectraVersion,
    graphSchemaVersion,
  };
}

/**
 * assertNoGraphInWorktree(wtDir)
 * Cohort A/B 前置断言：worktree 中不得存在 specs/_meta/graph.json；
 * 发现残留即抛出，调用方应 return { ok: false, ... }。
 */
/**
 * computeT053Status — run-level T053 判定（Feature 165 SC-002 充要标准）
 *
 * 判定规则（仅 group === 'C' 适用；其他 group 始终 'na'）：
 *   1. graphInjection.status !== 'success' → fail（注入失败）
 *   2. detectChangesCallCount < 1 → fail（driver 未调用 detect_changes）
 *   3. detectChangesSummaries 中无 changedSymbolsCount > 0 → fail（payload-empty）
 *   4. 以上全过 → pass
 *
 * 注：9-run 层面 T053 判定（spec SC-002 a-e）在 post-hoc 聚合阶段汇总此 run-level 结果。
 *
 * NOTE (Codex GATE_VERIFY WARNING #4, accepted as documented limitation):
 * 本 helper 不检查 detect_changes 调用本身的 errorCode（如个别 detect_changes call
 * 失败但其他成功的情况）。原因：graphInjection.status='success' 路径下 errorCode
 * 永远为 undefined（由 injectGraph 实现保证），因此不存在 "success path 同时有
 * positive summary + errorCode" 的混合状态需要拦截。如未来 telemetry schema 演进
 * 允许 success path 携带非阻断错误码（warning code），届时再扩展此函数读取
 * detectChangesSummaries 中每次调用的 errorCode 状态。
 */
export function computeT053Status({ group, graphInjection, detectChangesCallCount, detectChangesSummaries }) {
  if (group !== 'C') {
    return { status: 'na', failReason: null };
  }
  if (!graphInjection || graphInjection.status !== 'success') {
    return {
      status: 'fail',
      failReason: `graphInjection.status=${graphInjection?.status ?? 'undefined'} errorCode=${graphInjection?.errorCode ?? 'unknown'}`,
    };
  }
  if (detectChangesCallCount < 1) {
    return {
      status: 'fail',
      failReason: 'detectChangesCallCount=0 (driver 未调用 detect_changes)',
    };
  }
  const hasChangedSymbols = Array.isArray(detectChangesSummaries)
    && detectChangesSummaries.some((s) => typeof s?.changedSymbolsCount === 'number' && s.changedSymbolsCount > 0);
  if (!hasChangedSymbols) {
    return {
      status: 'fail',
      failReason: 'no detect_changes call returned changedSymbolsCount > 0 (payload-empty 路径)',
    };
  }
  return { status: 'pass', failReason: null };
}

export function assertNoGraphInWorktree(wtDir) {
  const dest = path.join(wtDir, GRAPH_FILENAME);
  if (fs.existsSync(dest)) {
    throw new Error(
      `[Cohort A/B] graph 污染检测：${dest} 已存在，请检查 worktree 隔离（EC-008）`,
    );
  }
}

/**
 * extractConsumptionSignals({ changedSymbols, mcpToolCalls, stdout, patchText })
 * 提取 driver 是否消费 detect_changes 返回的 changedSymbols 的三类机械化信号：
 *   - patch-diff-literal：git patch 内含 symbolName 或 filePath
 *   - derived-mcp-call：后续 mcp__spectra__context/impact 调用的 arguments 含 symbolId/filePath
 *   - reasoning-trace-mention：stdout 内含 symbolName/filePath 或因果短语
 * 同 signalType + evidenceLocation 去重（首次保留）。
 * @returns {Array<{ signalType, matchedSymbol?, matchedFilePath?, evidenceLocation, evidenceTextSnippet? }>}
 */
export function extractConsumptionSignals({ changedSymbols, mcpToolCalls, stdout, patchText }) {
  const signals = [];
  if (!Array.isArray(changedSymbols) || changedSymbols.length === 0) return signals;

  // 提取所有 symbolName / filePath（支持两种 symbols 表示：string 或 { symbolName }）
  const symbolNames = [];
  const filePaths = [];
  for (const c of changedSymbols) {
    if (c?.filePath) filePaths.push(c.filePath);
    if (Array.isArray(c?.symbols)) {
      for (const s of c.symbols) {
        if (typeof s === 'string') {
          symbolNames.push(s);
        } else if (s && typeof s.symbolName === 'string') {
          symbolNames.push(s.symbolName);
        }
      }
    }
  }
  // 去重 — 同 symbolName 多次出现时避免重复扫描
  const uniqueSymbols = Array.from(new Set(symbolNames));
  const uniqueFilePaths = Array.from(new Set(filePaths));

  // ── 类型 1：patch-diff-literal ───────────────────────────
  if (typeof patchText === 'string' && patchText.length > 0) {
    const patchLines = patchText.split('\n');
    for (const sym of uniqueSymbols) {
      const lineIdx = patchLines.findIndex((l) => l.includes(sym));
      if (lineIdx >= 0) {
        signals.push({
          signalType: 'patch-diff-literal',
          matchedSymbol: sym,
          evidenceLocation: `patch:line ${lineIdx + 1}`,
        });
      }
    }
    for (const fp of uniqueFilePaths) {
      const base = path.basename(fp);
      const lineIdx = patchLines.findIndex((l) => l.includes(base));
      if (lineIdx >= 0) {
        signals.push({
          signalType: 'patch-diff-literal',
          matchedFilePath: fp,
          evidenceLocation: `patch:line ${lineIdx + 1}`,
        });
      }
    }
  }

  // ── 类型 2：derived-mcp-call ─────────────────────────────
  const postCalls = (Array.isArray(mcpToolCalls) ? mcpToolCalls : []).filter((c) =>
    c?.tool === 'mcp__spectra__context' || c?.tool === 'mcp__spectra__impact',
  );
  for (let idx = 0; idx < postCalls.length; idx += 1) {
    const call = postCalls[idx];
    const argStr = typeof call.arguments === 'string'
      ? call.arguments
      : JSON.stringify(call.arguments ?? {});
    for (const sym of uniqueSymbols) {
      if (argStr.includes(sym)) {
        signals.push({
          signalType: 'derived-mcp-call',
          matchedSymbol: sym,
          evidenceLocation: `mcpToolCalls[${idx}]`,
        });
      }
    }
    for (const fp of uniqueFilePaths) {
      if (argStr.includes(fp)) {
        signals.push({
          signalType: 'derived-mcp-call',
          matchedFilePath: fp,
          evidenceLocation: `mcpToolCalls[${idx}]`,
        });
      }
    }
  }

  // ── 类型 3：reasoning-trace-mention ──────────────────────
  if (typeof stdout === 'string' && stdout.length > 0) {
    const causalPhrases = [
      '根据 detect_changes',
      '按照 changedSymbols',
      'changedSymbols',
      'detect_changes 返回',
    ];
    const lines = stdout.split('\n');
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      for (const sym of uniqueSymbols) {
        if (line.includes(sym)) {
          signals.push({
            signalType: 'reasoning-trace-mention',
            matchedSymbol: sym,
            evidenceLocation: `messages[${idx}].content`,
            evidenceTextSnippet: line.slice(0, 120),
          });
        }
      }
      for (const fp of uniqueFilePaths) {
        if (line.includes(fp)) {
          signals.push({
            signalType: 'reasoning-trace-mention',
            matchedFilePath: fp,
            evidenceLocation: `messages[${idx}].content`,
            evidenceTextSnippet: line.slice(0, 120),
          });
        }
      }
      for (const phrase of causalPhrases) {
        if (line.includes(phrase)) {
          signals.push({
            signalType: 'reasoning-trace-mention',
            matchedSymbol: null,
            evidenceLocation: `messages[${idx}].content`,
            evidenceTextSnippet: line.slice(0, 120),
          });
        }
      }
    }
  }

  // 去重：同 signalType + evidenceLocation 只保留第一个
  const seen = new Set();
  return signals.filter((s) => {
    const key = `${s.signalType}::${s.evidenceLocation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ───────────────────────────────────────────────────────────
// argv 解析（T-040）
// ───────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const args = {
    group: null,
    task: null,
    repeat: 3,
    dryRun: false,
    stopLoss: 40,
    maxJudgeCalls: 20,
    keepTemp: false,
    allFixtures: false,
    help: false,
    // Feature 162 Phase C：quota state store + partial run 处理
    maxRunsPerDay: DEFAULT_MAX_RUNS_PER_DAY,
    acceptPartial: false,
    restartPartial: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--group':
        args.group = argv[++i];
        break;
      case '--task':
        args.task = argv[++i];
        break;
      case '--repeat':
        args.repeat = Number.parseInt(argv[++i], 10);
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--stop-loss': {
        const v = Number.parseFloat(argv[++i]);
        if (!Number.isNaN(v)) args.stopLoss = v;
        break;
      }
      case '--max-judge-calls': {
        const v = Number.parseInt(argv[++i], 10);
        if (!Number.isNaN(v)) args.maxJudgeCalls = v;
        break;
      }
      case '--keep-temp':
        args.keepTemp = true;
        break;
      case '--all-fixtures':
        args.allFixtures = true;
        break;
      // Feature 162 Phase C：quota state store flags（plan §2.3.7）
      case '--max-runs-per-day': {
        const v = Number.parseInt(argv[++i], 10);
        if (!Number.isNaN(v) && v >= 0) args.maxRunsPerDay = v;
        break;
      }
      case '--accept-partial':
        args.acceptPartial = true;
        break;
      case '--restart-partial':
        args.restartPartial = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (a.startsWith('--')) {
          throw new Error(`unknown flag: ${a}`);
        }
    }
  }
  return args;
}

function printUsage() {
  process.stdout.write(
    [
      'Usage: node scripts/eval-mcp-augmented.mjs --group A|B|C --task <taskId> [options]',
      '',
      'Required:',
      '  --group A|B|C        对照组（A: bare / B: spec-push / C: mcp-pull）',
      '  --task <taskId>      fixture taskId（与 SWE-L00X 文件名 stem 一致）',
      '',
      'Options:',
      '  --repeat N           重复次数（默认 3）',
      '  --dry-run            不调真实 claude API；输出预估 cost / run 次数',
      '  --stop-loss USD      累计成本超过即停止（默认 40）',
      '  --max-judge-calls N  Opus judge 调用上限（默认 20，预留）',
      '  --keep-temp          调试用：保留 /tmp/spectra-mcp-*.json + telemetry JSONL',
      '  --all-fixtures       遍历 fixtures/ 全部 task（仅 dry-run 安全使用）',
      '',
      'Feature 162 Phase C — quota state store:',
      '  --max-runs-per-day N daily quota 上限，达上限优雅 exit 0（默认 150）',
      '  --accept-partial     续跑时把 partialStale run 视为已完成，append 到 quota.run_ids',
      '  --restart-partial    续跑时删除 partialStale run-N.json + lock（互斥于 --accept-partial）',
      '',
      '  --help, -h           本帮助',
      '',
      'Output:',
      '  tests/baseline/swe-bench-lite/runs/<group>/<taskId>/run-<N>.json',
      '',
    ].join('\n'),
  );
}

function validateArgs(args) {
  const errors = [];
  if (!args.allFixtures && !args.task) {
    errors.push('--task required (或加 --all-fixtures 遍历所有 fixture)');
  }
  if (!['A', 'B', 'C'].includes(args.group)) {
    errors.push('--group must be one of A / B / C');
  }
  if (args.repeat <= 0 || Number.isNaN(args.repeat)) {
    errors.push('--repeat must be > 0');
  }
  return errors;
}

// ───────────────────────────────────────────────────────────
// fixture 加载
// ───────────────────────────────────────────────────────────

function loadFixtureByTaskId(taskId) {
  // 支持两种命名（Feature 162 T050 bug fix）：
  //   (1) full stem: 'SWE-L001-pytest-module-imported-twice-under'（历史约定）
  //   (2) short ID:  'SWE-L001'（calibration-fixture-list.json + spec FR-030 + pilot-27-batch.sh 用此）
  // 优先匹配 (1) — 完整文件名存在即直读；否则 (2) prefix match
  let fp = path.join(FIXTURES_DIR, `${taskId}.json`);
  if (!fs.existsSync(fp)) {
    const matches = fs
      .readdirSync(FIXTURES_DIR)
      .filter((f) => f.startsWith(`${taskId}-`) && f.endsWith('.json'));
    if (matches.length === 0) {
      throw new Error(`fixture not found: ${fp} (also tried prefix match for '${taskId}-*.json')`);
    }
    if (matches.length > 1) {
      throw new Error(`ambiguous fixture for '${taskId}': matches ${matches.join(', ')}`);
    }
    fp = path.join(FIXTURES_DIR, matches[0]);
  }
  const raw = fs.readFileSync(fp, 'utf-8');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`fixture parse failed: ${fp}: ${err.message}`);
  }
  return json;
}

function listAllFixtureTaskIds() {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((n) => /^SWE-L\d+.*\.json$/.test(n))
    .map((n) => n.replace(/\.json$/, ''))
    .sort();
}

// ───────────────────────────────────────────────────────────
// loadSpectraContextForSweBench（T-041 / FR-C-002）
// ───────────────────────────────────────────────────────────

/**
 * 与 runner 内部 loadSpectraContext 相似的相关性排序，但 target map 是 SWE-Bench 专用。
 * 返回 string（spec.md 拼接内容）或 null（modulesDir 不存在 → 触发 specPushDegraded）。
 */
export function loadSpectraContextForSweBench(target, options = {}) {
  const { maxBytes = 12000, maxFiles = 3, taskTargetFiles = [] } = options;
  const baselineName = SWEBENCH_TARGET_MAP[target];
  if (!baselineName) return null;
  const baselineHome =
    process.env['SPECTRA_BASELINE_HOME'] ?? path.join(os.homedir(), '.spectra-baselines');
  const modulesDir = path.join(
    baselineHome,
    `${baselineName}-output`,
    'spectra-full',
    'modules',
  );
  if (!fs.existsSync(modulesDir)) return null;
  const allSpecs = fs
    .readdirSync(modulesDir)
    .filter((n) => n.endsWith('.spec.md'));
  if (allSpecs.length === 0) return null;
  const targetBasenames = taskTargetFiles
    .map((f) => path.basename(f).replace(/\.\w+$/, ''))
    .filter(Boolean);
  const score = (specName) => {
    const stem = specName.replace(/\.spec\.md$/, '');
    if (targetBasenames.includes(stem)) return 100;
    if (targetBasenames.some((b) => stem.includes(b))) return 50;
    if (stem === '_index') return 10;
    return 0;
  };
  const sorted = allSpecs
    .map((n) => ({ name: n, s: score(n) }))
    .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name))
    .slice(0, maxFiles);
  let content = '';
  for (const { name } of sorted) {
    const sample = fs
      .readFileSync(path.join(modulesDir, name), 'utf-8')
      .slice(0, 4000);
    content += `### ${name}\n\n${sample}\n\n---\n\n`;
    if (content.length > maxBytes) break;
  }
  return content.slice(0, maxBytes);
}

// ───────────────────────────────────────────────────────────
// claude CLI 版本 / 副产品
// ───────────────────────────────────────────────────────────

function captureClaudeCliVersion() {
  // FR-B-006 / EC-14：每次 run 启动时捕获，便于报告复现
  try {
    const r = spawnSync('claude', ['--version'], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    if (r.status === 0) {
      return (r.stdout ?? '').trim() || 'unknown';
    }
    return `unavailable (exit=${r.status})`;
  } catch (err) {
    return `unavailable (${err.code ?? 'unknown'})`;
  }
}

// ───────────────────────────────────────────────────────────
// EC-13 build 缓存检查（仅 Group C 启动时）
// ───────────────────────────────────────────────────────────

function ensureMcpDistFresh() {
  if (!fs.existsSync(MCP_DIST_ENTRY)) {
    throw new Error(
      `dist/cli/index.js 不存在；请先运行 \`npm run build\` (EC-13)`,
    );
  }
  const distMtime = fs.statSync(MCP_DIST_ENTRY).mtimeMs;
  if (!fs.existsSync(MCP_SRC_DIR)) {
    return; // 极端环境：src/mcp 不存在但 dist 存在 — 视为可用
  }
  const stack = [MCP_SRC_DIR];
  let latestSrcMtime = 0;
  while (stack.length > 0) {
    const cur = stack.pop();
    const ents = fs.readdirSync(cur, { withFileTypes: true });
    for (const ent of ents) {
      const sub = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(sub);
        continue;
      }
      if (!ent.name.endsWith('.ts')) continue;
      const m = fs.statSync(sub).mtimeMs;
      if (m > latestSrcMtime) latestSrcMtime = m;
    }
  }
  if (latestSrcMtime > distMtime) {
    throw new Error(
      `dist/cli/index.js mtime 早于 src/mcp/*.ts 最新 mtime；请先运行 \`npm run build\` (EC-13)`,
    );
  }
}

// ───────────────────────────────────────────────────────────
// Group C — MCP config 临时文件 + telemetry JSONL 解析
// ───────────────────────────────────────────────────────────

function buildRunId({ taskId, group, repeatIndex }) {
  // plan.md Schema 3 — 唯一段：<taskId>-<group>-<repeatIndex>-<pid>-<Date.now()>-<rand>
  // 修 Codex W3：仅用 Date.now() 同毫秒并行会撞，加 PID + 4-byte 随机段保证全局唯一
  const rand = Math.random().toString(36).slice(2, 6);
  return `${taskId}-${group}-${repeatIndex}-${process.pid}-${Date.now()}-${rand}`;
}

/**
 * 替换 fixture oracle.checks 中的 <SPECTRA_REPO_ROOT> 占位符为实际仓库根路径。
 * 修 Codex C1：fixture oracle 引用 eval-diff-fuzzy-match.mjs / .goldpatch.diff 时
 * 需要绝对路径，因 oracle 在 worktree cwd 执行（非 cc-plugin-market 仓库）。
 */
function resolveOracleChecksPaths(oracle, repoRoot) {
  if (oracle === null || oracle === undefined || oracle.checks === undefined) return oracle;
  const replaced = {
    ...oracle,
    checks: oracle.checks.map((check) => {
      if (typeof check === 'string') {
        return check.replaceAll('<SPECTRA_REPO_ROOT>', repoRoot);
      }
      if (typeof check === 'object' && check !== null && typeof check.cmd === 'string') {
        return { ...check, cmd: check.cmd.replaceAll('<SPECTRA_REPO_ROOT>', repoRoot) };
      }
      return check;
    }),
  };
  return replaced;
}

function buildMcpConfigFile({ runId, wtDir }) {
  const cfgPath = path.join(os.tmpdir(), `spectra-mcp-${runId}.json`);
  const telemetryPath = path.join(os.tmpdir(), `mcp-telemetry-${runId}.jsonl`);
  const config = {
    mcpServers: {
      spectra: {
        command: 'node',
        args: [MCP_DIST_ENTRY, 'mcp-server'],
        env: {
          SPECTRA_PROJECT_ROOT: wtDir,
          SPECTRA_MCP_TELEMETRY_PATH: telemetryPath,
          SPECTRA_MCP_RUN_ID: runId,
        },
      },
    },
  };
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8');
  return { cfgPath, telemetryPath };
}

export function parseTelemetryJsonl(telemetryPath) {
  // Feature 162 plan §2.4.4：返回 canonical schema { mcpToolCalls: Array<{tool, success, error, responseBytes, timestamp}> }
  // legacy 派生字段（mcpToolCallCount / mcpResponseBytes）由调用方计算
  const mcpToolCalls = [];
  if (!fs.existsSync(telemetryPath)) return { mcpToolCalls };
  let raw;
  try {
    raw = fs.readFileSync(telemetryPath, 'utf-8');
  } catch {
    return { mcpToolCalls };
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      // canonical entry：{ tool, success, error, responseBytes, timestamp }
      // W-3 修复（Feature 164）：writeTelemetry 写入 errorCode 而非 error；
      // 需同时读取 errorCode 判断 success（j.error 在 TelemetryEntry 中不存在）
      const errorVal = j.error ?? j.errorCode ?? null;
      // Feature 165 FR-012: 解析 detect_changes 写入的 responseSummary.changedSymbolsCount
      // 类型校验（Codex round 2）：仅接受 plain object 且过滤掉非 number 值
      let parsedSummary = null;
      if (
        j.responseSummary &&
        typeof j.responseSummary === 'object' &&
        !Array.isArray(j.responseSummary)
      ) {
        const cleaned = {};
        for (const [k, v] of Object.entries(j.responseSummary)) {
          if (typeof v === 'number' && Number.isFinite(v)) cleaned[k] = v;
        }
        if (Object.keys(cleaned).length > 0) parsedSummary = cleaned;
      }
      // Feature 165 FR-012 round 3 (GATE_VERIFY CRITICAL 修复)：
      // 解析 responseSamples.{symbols, files} 给 consumption signal extractor 用
      let parsedSamples = null;
      if (j.responseSamples && typeof j.responseSamples === 'object' && !Array.isArray(j.responseSamples)) {
        const samples = {};
        if (Array.isArray(j.responseSamples.symbols)) {
          samples.symbols = j.responseSamples.symbols.filter((s) => typeof s === 'string');
        }
        if (Array.isArray(j.responseSamples.files)) {
          samples.files = j.responseSamples.files.filter((s) => typeof s === 'string');
        }
        if (Object.keys(samples).length > 0) parsedSamples = samples;
      }
      mcpToolCalls.push({
        tool: typeof j.toolName === 'string' ? `mcp__spectra__${j.toolName}` : (j.tool ?? null),
        success: typeof j.success === 'boolean' ? j.success : (errorVal == null),
        error: errorVal,
        responseBytes: typeof j.responseSize === 'number' ? j.responseSize : 0,
        timestamp: j.timestamp ?? j.ts ?? null,
        responseSummary: parsedSummary,
        responseSamples: parsedSamples,
      });
    } catch {
      // 忽略坏行（telemetry 写入失败的部分行）
    }
  }
  return { mcpToolCalls };
}

/** legacy 派生：mcpToolCalls.length */
function deriveMcpToolCallCount(mcpToolCalls) {
  return Array.isArray(mcpToolCalls) ? mcpToolCalls.length : 0;
}

/** legacy 派生：sum(responseBytes) */
function deriveMcpResponseBytes(mcpToolCalls) {
  if (!Array.isArray(mcpToolCalls)) return 0;
  return mcpToolCalls.reduce((s, c) => s + (typeof c?.responseBytes === 'number' ? c.responseBytes : 0), 0);
}

function cleanupTempFiles({ cfgPath, telemetryPath, keepTemp }) {
  if (keepTemp) return;
  for (const p of [cfgPath, telemetryPath]) {
    if (p && fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        // 静默
      }
    }
  }
}

// ───────────────────────────────────────────────────────────
// claude args 构造（含 Group C MCP）
// ───────────────────────────────────────────────────────────

/**
 * 自实现而不修改 runner 的 buildClaudeArgs（runner 没有 mcp-config 参数）。
 * 与 runner 输出形态保持一致：[--print, --model, --output-format, --permission-mode, ..., prompt]
 */
function buildClaudeArgsWithMcp({ prompt, mcpConfigPath = null }) {
  const args = [
    '--print',
    '--model',
    'claude-sonnet-4-6',
    '--output-format',
    'text',
    '--permission-mode',
    'bypassPermissions',
    '--dangerously-skip-permissions',
  ];
  if (mcpConfigPath) {
    args.push('--mcp-config', mcpConfigPath, '--strict-mcp-config');
  }
  args.push(prompt);
  return args;
}

// ───────────────────────────────────────────────────────────
// prompt 构造
// ───────────────────────────────────────────────────────────

function buildGroupAPrompt(taskFixture) {
  // FR-C-001 — 仅 fixture.prompt，无任何前缀
  return taskFixture.prompt;
}

function buildGroupBPrompt({ taskFixture, spectraContext }) {
  // FR-C-002 — spec.md 作为 system 前缀；degraded 时退化为 A
  if (!spectraContext || spectraContext.trim().length === 0) {
    return taskFixture.prompt;
  }
  return [
    '请利用以下 spectra 预先生成的 spec.md context 指导你修复以下任务。',
    '',
    '## Spectra-generated context',
    '',
    spectraContext,
    '',
    '---',
    '',
    '## Task',
    '',
    taskFixture.prompt,
  ].join('\n');
}

export function buildGroupCPrompt(taskFixture) {
  // FR-C-003 v2 — 修复 Feature 164：原 prompt 以 mcp__spectra__context 为首个强制调用，
  // 但 context 需要 symbolId 参数；prompt 未提供 symbolId 推断指导，导致 Claude 跳过工具。
  // 修复：改用 mcp__spectra__detect_changes（只需 baseRef，无需 symbolId）作为首个必须调用；
  // 明确处理 graph-not-built 预期错误，告知 Claude 记录错误后继续。
  return [
    '【MCP grounding 集成验证实验】',
    '',
    '你有以下 spectra MCP tools 可调用（已通过 --mcp-config 挂载）：',
    '- mcp__spectra__detect_changes：分析 git diff 影响哪些 symbols（参数：baseRef 或 diff 字符串）',
    '- mcp__spectra__context：获取 symbol 360° 上下文（参数：symbolId, projectRoot）',
    '- mcp__spectra__impact：分析 symbol 改动的 blast radius（参数：target, projectRoot）',
    '',
    '**【必须执行的前置步骤，不可跳过，即使工具返回错误也要完成调用】**',
    '',
    '步骤 1：调用 mcp__spectra__detect_changes，参数为 {"baseRef": "HEAD~1"}',
    '  - 如果工具返回 "graph-not-built" 错误：记录错误信息后直接执行步骤 3',
    '  - 如果工具成功但 changedSymbols 为空数组：直接执行步骤 3',
    '  - 如果工具成功且 changedSymbols 非空：记录结果并执行步骤 2',
    '',
    '步骤 2（仅当步骤 1 成功且 changedSymbols 非空时）：',
    '  对步骤 1 返回的第一个 changedSymbol 调用 mcp__spectra__context',
    '  参数：{"symbolId": "<changedSymbols[0].symbols[0]，即第一个文件变更的第一个 symbol ID 字符串>"}',
    '  即使返回错误，记录后继续步骤 3',
    '',
    '步骤 3：根据步骤 1/2 的信息（含错误信息）完成 Task 要求的代码修复',
    '',
    '**注意**：spectra 工具可能因目标仓库缺少预生成 graph 而返回 "graph-not-built"，',
    '这是预期行为。**无论步骤 1 是否报错，都必须先执行调用再继续。**',
    '',
    '---',
    '',
    '## Task',
    '',
    taskFixture.prompt,
  ].join('\n');
}

// ───────────────────────────────────────────────────────────
// runResult 写入
// ───────────────────────────────────────────────────────────

function writeRunResult({ group, taskId, repeatIndex, payload }) {
  const dir = path.join(RUNS_DIR, group, taskId);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `run-${repeatIndex}.json`);
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return fp;
}

// ───────────────────────────────────────────────────────────
// runTask wrapper（不修改 runner — 自实现支持 Group C mcp-config）
// ───────────────────────────────────────────────────────────

/**
 * 实跑 claude（非 dry-run）—— 通过 `child.on('exit')` 等子进程退出
 * 再返回，避免 telemetry JSONL race condition（plan.md §race condition）。
 *
 * iter-2 C-2 修复：spawn env 显式合并 envExtras（subAgentMeta 注入）。
 * 调用方负责通过 injectSubAgentMetaEnv 构造 envExtras，确保 sub-agent 能读到。
 */
async function spawnClaudeAndWait({ args, wtDir, timeoutMs, envExtras = {} }) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const env = { ...process.env, ...envExtras };
    if (env.ANTHROPIC_API_KEY === '') delete env.ANTHROPIC_API_KEY;
    const child = spawn('claude', args, {
      cwd: wtDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (b) => {
      stdout += b.toString('utf-8');
    });
    child.stderr.on('data', (b) => {
      stderr += b.toString('utf-8');
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const wallMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
      resolve({
        wallMs,
        stdout,
        stderr,
        exitCode: code,
        signal,
        timedOut: timedOut || signal === 'SIGTERM',
        claudeArgs: args,
        spawnEnv: env, // iter-2 C-2: 回传供 finalize 读 SPECTRA_PLUGIN_* 注入字段
      });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      const wallMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
      resolve({
        wallMs,
        stdout,
        stderr,
        exitCode: null,
        timedOut: false,
        spawnError: err.message,
        claudeArgs: args,
        spawnEnv: env,
      });
    });
  });
}

// ───────────────────────────────────────────────────────────
// 单 run 执行（A / B / C）
// ───────────────────────────────────────────────────────────

async function runOne({ group, taskFixture, repeatIndex, args, claudeCliVersion }) {
  const taskId = taskFixture.taskId;
  const runId = buildRunId({ taskId, group, repeatIndex });
  const timestamp = new Date().toISOString();

  // dry-run 模式：构造命令但不 spawn claude（FR-B-005）
  if (args.dryRun) {
    let cmdPreview;
    let envPreview = {};
    let mcpConfigPath = null;
    let telemetryPath = null;
    let prompt;
    let specPushDegraded = null;

    if (group === 'A') {
      prompt = buildGroupAPrompt(taskFixture);
      cmdPreview = buildClaudeArgsWithMcp({ prompt });
    } else if (group === 'B') {
      const ctx = loadSpectraContextForSweBench(taskFixture.target);
      specPushDegraded = ctx === null;
      prompt = buildGroupBPrompt({ taskFixture, spectraContext: ctx });
      cmdPreview = buildClaudeArgsWithMcp({ prompt });
    } else {
      // Group C dry-run：构造 mcp-config 路径预览 + telemetry env 预览
      // dry-run 不实际写 cfg 文件、不执行 build 检查（避免 dry-run 在未 build 时报错）
      // 但必须输出 SPECTRA_MCP_TELEMETRY_PATH= 字样（SC-009a）
      mcpConfigPath = path.join(os.tmpdir(), `spectra-mcp-${runId}.json`);
      telemetryPath = path.join(os.tmpdir(), `mcp-telemetry-${runId}.jsonl`);
      envPreview = {
        SPECTRA_MCP_TELEMETRY_PATH: telemetryPath,
        SPECTRA_MCP_RUN_ID: runId,
      };
      prompt = buildGroupCPrompt(taskFixture);
      cmdPreview = buildClaudeArgsWithMcp({ prompt, mcpConfigPath });
    }

    // 关键：dry-run 输出必须显式打印 env 行（SC-009a）
    process.stdout.write(
      `[dry-run] group=${group} task=${taskId} repeat=${repeatIndex}\n`,
    );
    if (group === 'C') {
      process.stdout.write(
        `[dry-run] env: SPECTRA_MCP_TELEMETRY_PATH=${telemetryPath}\n`,
      );
      process.stdout.write(
        `[dry-run] env: SPECTRA_MCP_RUN_ID=${runId}\n`,
      );
      process.stdout.write(
        `[dry-run] mcp-config preview path: ${mcpConfigPath}\n`,
      );
    }
    if (group === 'B') {
      process.stdout.write(
        `[dry-run] specPushDegraded=${specPushDegraded}\n`,
      );
    }
    // 仅打印命令长度（避免上千字节 prompt 噪声）
    const argsPreview = cmdPreview.slice(0, -1); // 去掉末尾 prompt
    process.stdout.write(
      `[dry-run] claude args: ${argsPreview.join(' ')} <prompt:${cmdPreview[cmdPreview.length - 1].length}B>\n`,
    );

    // iter-2 W-1：canonical schema = perf.mcpToolCalls[]
    const perf = {
      wallMs: 0,
      ...(group === 'C'
        ? {
            mcpToolCalls: [],
            mcpToolCallCount: 0,
            mcpResponseBytes: 0,
          }
        : {}),
    };
    return {
      ok: true,
      costUsd: DRY_RUN_COST_PER_RUN_USD,
      runResult: {
        group,
        taskId,
        repeatIndex,
        runId,
        timestamp,
        dryRun: true,
        oracleResult: null,
        perf,
        costUsd: DRY_RUN_COST_PER_RUN_USD,
        claudeCliVersion,
        ...(group === 'B' ? { specPushDegraded } : {}),
        ...(group === 'C' ? { telemetryPathPreview: telemetryPath } : {}),
      },
    };
  }

  // ─── 实跑路径 ───────────────────────────────────────────
  // 注意：本 batch 不实际 spawn claude（spec 要求 Batch 3 仅 dry-run 集成测试）；
  // 但实跑骨架完整保留，便于 Stage 7a/7b 直接运行。

  // EC-11 worktree 唯一性：runner 的 prepareWorktree 用 (taskId, tool) 作为路径段；
  // 这里把 tool 段替换为 `<group>-<repeatIndex>-<runId-tail>` 保证多 worktree 并行不撞。
  const toolSegment = `${group}-${repeatIndex}-${runId.split('-').pop()}`;
  const worktreeStartCommit = taskFixture.startCommit;

  let wt;
  try {
    wt = prepareWorktree({
      taskId,
      tool: toolSegment,
      target: taskFixture.target,
      startCommit: worktreeStartCommit,
    });
  } catch (err) {
    return {
      ok: false,
      costUsd: 0,
      error: `prepareWorktree failed: ${err.message}`,
    };
  }

  // ── Feature 165 — Cohort C graph injection / Cohort A/B 前置断言 ──
  // 设计：在 prepareWorktree 返回之后、Group C build 检查之前执行；
  // C 注入失败不阻断流程（fallback 路径），但 telemetry 标记 status='failed'，
  // 该 run 视为 T053 单次失败（FR-004）。A/B 残留视为污染，fail-fast 返回。
  let graphInjection = null;
  if (group === 'C') {
    graphInjection = injectGraph({
      taskFixture,
      wtDir: wt.wtDir,
      runtimeSpectraVersion: RUNTIME_SPECTRA_VERSION,
    });
  } else {
    try {
      assertNoGraphInWorktree(wt.wtDir);
    } catch (err) {
      return {
        ok: false,
        costUsd: 0,
        error: `graph 污染断言失败: ${err.message}`,
      };
    }
  }

  // Group C build 检查
  let mcpConfigPath = null;
  let telemetryPath = null;
  if (group === 'C') {
    try {
      ensureMcpDistFresh();
    } catch (err) {
      return { ok: false, costUsd: 0, error: err.message };
    }
    const built = buildMcpConfigFile({ runId, wtDir: wt.wtDir });
    mcpConfigPath = built.cfgPath;
    telemetryPath = built.telemetryPath;
  }

  // 选 prompt
  let prompt;
  let specPushDegraded = null;
  if (group === 'A') {
    prompt = buildGroupAPrompt(taskFixture);
  } else if (group === 'B') {
    const ctx = loadSpectraContextForSweBench(taskFixture.target);
    specPushDegraded = ctx === null;
    prompt = buildGroupBPrompt({ taskFixture, spectraContext: ctx });
  } else {
    prompt = buildGroupCPrompt(taskFixture);
  }

  const claudeArgs = buildClaudeArgsWithMcp({ prompt, mcpConfigPath });

  // iter-2 C-2 修复：spawn 前真正构造 SPECTRA_PLUGIN_* env 注入，传给 sub-agent。
  // frontmatterTools 与 loadSource 可由调用层注入；当前阶段还没有动态发现机制，
  // 先按 plugin.json 规范的稳定值显式声明（与 plugins/spec-driver/.claude-plugin/plugin.json 对齐）。
  const envExtras = injectSubAgentMetaEnv({
    specDriverVersion: '4.1.0',
    frontmatterTools: ['Read', 'Edit', 'Bash'],
    loadSource: 'plugin-cache-or-worktree',
  });

  let runOutcome;
  try {
    runOutcome = await spawnClaudeAndWait({
      args: claudeArgs,
      wtDir: wt.wtDir,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      envExtras,
    });
  } catch (err) {
    cleanupTempFiles({
      cfgPath: mcpConfigPath,
      telemetryPath,
      keepTemp: args.keepTemp,
    });
    return { ok: false, costUsd: 0, error: `spawn failed: ${err.message}` };
  }

  // oracle — 替换 <SPECTRA_REPO_ROOT> 占位符为绝对路径（修 Codex C1）
  let oracleResult;
  try {
    const resolvedOracle = resolveOracleChecksPaths(taskFixture.primaryOracle, PROJECT_ROOT);
    oracleResult = runPrimaryOracle({
      wtDir: wt.wtDir,
      oracle: resolvedOracle,
    });
  } catch (err) {
    cleanupTempFiles({
      cfgPath: mcpConfigPath,
      telemetryPath,
      keepTemp: args.keepTemp,
    });
    return {
      ok: false,
      costUsd: 0,
      error: `oracle exec failed: ${err.message}`,
    };
  }

  const productMetrics = captureProductMetrics(wt.wtDir);

  // Group C telemetry 累计（child 已 exit，可安全读 JSONL）
  // Feature 162 plan §2.4.4：canonical schema 双写
  let mcpToolCalls = null;
  let mcpToolCallCount = null;
  let mcpResponseBytes = null;
  let detectChangesCallCount = 0;
  let detectChangesSummaries = []; // Feature 165 FR-012 round 2：各次 detect_changes 的 changedSymbolsCount
  if (group === 'C' && telemetryPath) {
    const t = parseTelemetryJsonl(telemetryPath);
    mcpToolCalls = t.mcpToolCalls;
    mcpToolCallCount = deriveMcpToolCallCount(mcpToolCalls);
    mcpResponseBytes = deriveMcpResponseBytes(mcpToolCalls);
    const detectChangesCalls = mcpToolCalls.filter(
      (c) => c?.tool === 'mcp__spectra__detect_changes',
    );
    detectChangesCallCount = detectChangesCalls.length;
    // Feature 165 FR-012 round 2：聚合 responseSummary.changedSymbolsCount per call
    detectChangesSummaries = detectChangesCalls
      .filter((c) => c.success === true && c.responseSummary)
      .map((c) => ({
        changedSymbolsCount: typeof c.responseSummary.changedSymbolsCount === 'number'
          ? c.responseSummary.changedSymbolsCount
          : 0,
      }));
  }

  // ── Feature 165 — Cohort C consumptionSignals 提取（FR-012）──
  // 注入成功且 telemetry 可读时，从 stdout + git diff + telemetry samples 派生三类消费信号；
  // 注入失败 / 非 C cohort 时跳过。
  if (group === 'C' && graphInjection?.status === 'success') {
    let patchText = '';
    try {
      const diffR = spawnSync('git', ['-C', wt.wtDir, 'diff', 'HEAD~1'], { encoding: 'utf-8' });
      patchText = diffR.stdout ?? '';
    } catch {
      /* patch 提取失败不阻断 */
    }
    // Feature 165 FR-012 round 3（GATE_VERIFY CRITICAL 修复）：
    // 从 detect_changes telemetry 的 responseSamples 聚合 changedSymbols
    // sample 已在 MCP server 端 bounded (N=10)，避免 telemetry 膨胀
    const aggregatedChangedSymbols = [];
    for (const call of (mcpToolCalls ?? [])) {
      if (call?.tool !== 'mcp__spectra__detect_changes') continue;
      if (!call.success || !call.responseSamples) continue;
      const files = Array.isArray(call.responseSamples.files) ? call.responseSamples.files : [];
      const symbols = Array.isArray(call.responseSamples.symbols) ? call.responseSamples.symbols : [];
      // 每个 file 关联一个 entry，symbols 全部 attach 到 entry（简化结构 — 真实 spec 中 per-file 拆分）
      if (files.length > 0) {
        for (const f of files) {
          aggregatedChangedSymbols.push({ filePath: f, symbols: symbols.map((s) => ({ symbolName: s })) });
        }
      } else if (symbols.length > 0) {
        // 只有 symbols 没 files 的情况
        aggregatedChangedSymbols.push({ filePath: null, symbols: symbols.map((s) => ({ symbolName: s })) });
      }
    }
    const signals = extractConsumptionSignals({
      changedSymbols: aggregatedChangedSymbols,
      mcpToolCalls: mcpToolCalls ?? [],
      stdout: runOutcome.stdout ?? '',
      patchText,
    });
    graphInjection.detectChangesCallCount = detectChangesCallCount;
    graphInjection.detectChangesSummaries = detectChangesSummaries; // FR-012 round 2
    graphInjection.consumptionSignals = signals;
    graphInjection.consumptionStatus = signals.length > 0
      ? 'consumed'
      : 'payload-injected-but-not-consumed';
  }

  // ── Feature 165 — t053Status 顶层字段（Codex W-5 修复 + Round 2 重构）──
  // 抽为 export 的 stateless helper 以便单测覆盖
  const t053Result = computeT053Status({
    group,
    graphInjection,
    detectChangesCallCount,
    detectChangesSummaries,
  });
  const t053Status = t053Result.status;
  const t053FailReason = t053Result.failReason;
  if (graphInjection) {
    graphInjection.t053Status = t053Status;
    if (t053FailReason) graphInjection.t053FailReason = t053FailReason;
  }

  // 清理 tmp（finally 语义）
  cleanupTempFiles({
    cfgPath: mcpConfigPath,
    telemetryPath,
    keepTemp: args.keepTemp,
  });

  // 估算 cost：实跑暂置 null 待未来 LLM token usage 集成（FR-B-006）
  const realCostUsd = null;

  const oracleResultMapped = oracleResult.passed ? 'pass' : 'fail';

  // iter-2 W-1 修复：canonical schema 是 perf.mcpToolCalls[]，不在 runResult 顶层
  // spec FR-037 + plan §2.4 明确 perf 子对象嵌套。同时透出 spawnEnv / subAgentStdout
  // 供上层 finalize 阶段读 SPECTRA_PLUGIN_* env 注入和 self-report 解析（C-2）。
  const perf = {
    wallMs: runOutcome.wallMs,
    ...(group === 'C'
      ? {
          mcpToolCalls,
          mcpToolCallCount,
          mcpResponseBytes,
        }
      : {}),
  };

  return {
    ok: true,
    costUsd: realCostUsd ?? DRY_RUN_COST_PER_RUN_USD,
    spawnEnv: runOutcome.spawnEnv ?? null, // 供 readEnvInjectedMeta 读
    subAgentStdout: runOutcome.stdout ?? null, // 供 parseSubAgentSelfReport 解析
    runResult: {
      group,
      taskId,
      repeatIndex,
      runId,
      oracleResult: oracleResultMapped,
      oracleError: null,
      perf,
      timestamp,
      costUsd: realCostUsd,
      claudeCliVersion,
      worktreePath: wt.wtDir,
      productMetrics,
      claudeExit: runOutcome.exitCode,
      claudeTimedOut: runOutcome.timedOut,
      ...(group === 'B' ? { specPushDegraded } : {}),
      // Feature 165 — Cohort C 注入 telemetry（FR-013：每 run 写入，无论成功失败）
      ...(group === 'C' ? { graphInjection } : {}),
      // Feature 165 — Codex W-5 修复：run-level T053 状态顶层字段
      // 注：runLevel 命名说明本字段表达单 run 状态；9-run 层面 T053 判定在 post-hoc 聚合阶段
      // 计算逻辑见上方 t053Status 块；非 C cohort 始终为 'na'
      runLevelT053Status: t053Status,
      ...(t053FailReason ? { runLevelT053FailReason: t053FailReason } : {}),
    },
  };
}

// ───────────────────────────────────────────────────────────
// 主流程：枚举 (taskIds × repeats)，含 stop-loss
// ───────────────────────────────────────────────────────────

async function runForTaskList({ args, taskIds, claudeCliVersion }) {
  let cumulativeCost = 0;
  let runsCompleted = 0;
  let runsAttempted = 0;
  let quotaExhausted = false;
  const failures = [];
  const stopLossTriggered = { value: false };

  outer: for (const taskId of taskIds) {
    let taskFixture;
    try {
      taskFixture = loadFixtureByTaskId(taskId);
    } catch (err) {
      // fixture 解析失败 → infrastructure error（FR-B-007）
      throw new Error(`fixture load failed for ${taskId}: ${err.message}`);
    }
    for (let i = 1; i <= args.repeat; i += 1) {
      runsAttempted += 1;
      // stop-loss 预检（FR-B-008）
      if (cumulativeCost >= args.stopLoss) {
        process.stderr.write(
          `[stop-loss] cumulative=$${cumulativeCost.toFixed(2)} >= threshold=$${args.stopLoss}; 已停止\n`,
        );
        stopLossTriggered.value = true;
        break outer;
      }

      // ─────────────────────────────────────────────────────
      // Feature 162 Phase C：reserveQuota 短锁 + per-run lock + finally 兜底
      // ─────────────────────────────────────────────────────
      const runId = `${taskId}-${args.group}-${i}`;
      let runLockHandle = null;
      let startedAt = null;
      const cohortRunDir = path.join(RUNS_DIR, args.group, taskId);
      const runFilePath = path.join(cohortRunDir, `run-${runId}.json`);
      const runLockPath = path.join(cohortRunDir, `run-${runId}.lock`);

      if (!args.dryRun) {
        const reservation = await reserveQuota({
          storePath: QUOTA_STORE_PATH,
          lockPath: QUOTA_LOCK_PATH,
          runId,
          maxRunsPerDay: args.maxRunsPerDay,
          historyPath: QUOTA_HISTORY_PATH,
        });
        if (!reservation.reserved) {
          if (reservation.reason === 'quota_exceeded') {
            process.stdout.write(
              `[quota] reached max=${reservation.maxRuns}/day（current=${reservation.currentRuns}）；优雅退出\n`,
            );
            quotaExhausted = true;
            break outer;
          }
          if (reservation.reason === 'duplicate_run_id') {
            process.stdout.write(
              `[quota] duplicate runId=${runId}（已在 quota.run_ids），跳过\n`,
            );
            continue;
          }
          process.stderr.write(
            `[quota] reservation 失败 runId=${runId} reason=${reservation.reason}\n`,
          );
          continue;
        }
        // 拿 per-run lock + 写 started_at
        fs.mkdirSync(cohortRunDir, { recursive: true });
        runLockHandle = await acquirePerRunLock({ runLockPath });
        startedAt = new Date().toISOString();
        writeRunStarted({ runFilePath, runId, extra: { group: args.group, taskId, repeatIndex: i } });
      }

      // ─────────────────────────────────────────────────────
      // PHASE: LLM spawn + oracle（catch 兜底写 finalized+failed，plan §2.3.3 iter-4 W-9）
      // ─────────────────────────────────────────────────────
      let currentPhase = 'init';
      let result;
      try {
        currentPhase = 'driver';
        result = await runOne({
          group: args.group,
          taskFixture,
          repeatIndex: i,
          args,
          claudeCliVersion,
        });
        currentPhase = 'finalize';
      } catch (originalError) {
        if (!args.dryRun && runLockHandle) {
          // catch 兜底：写 finalized_at + status='failed' + error.phase
          // nested try-catch 二级防御：兜底写盘失败时 log 双错误并 rethrow originalError
          try {
            writeRunFinalizedFailed({
              runFilePath,
              runId,
              startedAt,
              errorPhase: currentPhase,
              error: originalError,
            });
          } catch (writeFallbackError) {
            process.stderr.write(
              `[CRITICAL][runOne] driver 抛错 + 兜底 finalize 写盘失败:\n` +
                `  Original error (run=${runId} phase=${currentPhase}): ${originalError?.message ?? originalError}\n` +
                `  Fallback write error (path=${runFilePath}): ${writeFallbackError?.message ?? writeFallbackError}\n`,
            );
          }
          runLockHandle.release();
        }
        throw originalError; // 始终向上抛
      }

      if (!result.ok) {
        failures.push({ taskId, repeatIndex: i, error: result.error });
        if (!args.dryRun) {
          process.stderr.write(`[run-failure] ${taskId} run=${i}: ${result.error}\n`);
          // 视为 failed-finalized：兜底写 status='failed'
          if (runLockHandle) {
            try {
              writeRunFinalizedFailed({
                runFilePath,
                runId,
                startedAt,
                errorPhase: 'oracle',
                error: new Error(result.error ?? 'unknown'),
              });
            } catch (e) {
              process.stderr.write(`[CRITICAL] 兜底写 failed-finalized 失败 ${runFilePath}: ${e.message}\n`);
            }
            runLockHandle.release();
          }
        }
        continue;
      }

      cumulativeCost += result.costUsd ?? 0;

      // 成功：写 finalized_at + status='success'（plan §2.3.3 step 13）
      if (!args.dryRun && runLockHandle) {
        // iter-2 C-2 修复：env 读源是 spawn env（含 SPECTRA_PLUGIN_* 注入）而非 process.env；
        // self-report 解析读 sub-agent stdout（spawnClaudeAndWait 的 stdout）。
        const envMeta = readEnvInjectedMeta({ env: result.spawnEnv ?? process.env });
        const selfReportMeta = parseSubAgentSelfReport({
          subAgentStdout: result.subAgentStdout ?? null,
        });
        const merged = mergeSubAgentMeta({ envMeta, selfReportMeta });
        // iter-2 W-1：mcpToolCalls 从 perf 子对象读
        const inheritance = deriveInheritanceStatus({
          subAgentMeta: merged.meta,
          mcpToolCalls: result.runResult?.perf?.mcpToolCalls ?? [],
        });

        try {
          // iter-2 W-1：subAgentMeta 落在 perf 子对象，保持 canonical schema 一致
          const perfWithMeta = {
            ...(result.runResult?.perf ?? {}),
            subAgentMeta: merged.meta,
          };
          writeRunFinalizedSuccess({
            runFilePath,
            runId,
            startedAt,
            payload: {
              ...result.runResult,
              perf: perfWithMeta,
              inheritance_status: inheritance,
              ...(merged.collectIssues.length > 0 ? { collectIssues: merged.collectIssues } : {}),
            },
          });
          process.stdout.write(`[run] wrote ${path.relative(PROJECT_ROOT, runFilePath)}\n`);
        } catch (writeErr) {
          process.stderr.write(
            `[CRITICAL] 写 finalized-success 失败 ${runFilePath}: ${writeErr.message}\n`,
          );
        } finally {
          runLockHandle.release();
        }
      } else if (args.dryRun) {
        // dry-run 路径：保留旧 writeRunResult 路径以兼容 Stage 7a 重现
        // （但 spec FR-B-005 明确 dry-run 不写 — 当前实现尊重该约定）
      }

      runsCompleted += 1;
    }
  }

  return {
    runsAttempted,
    runsCompleted,
    cumulativeCost,
    failures,
    stopLossTriggered: stopLossTriggered.value,
    quotaExhausted,
  };
}

// ───────────────────────────────────────────────────────────
// 入口
// ───────────────────────────────────────────────────────────

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n\n`);
    printUsage();
    process.exit(1);
  }
  if (args.help) {
    printUsage();
    process.exit(0);
  }
  const errors = validateArgs(args);
  if (errors.length > 0) {
    for (const e of errors) {
      process.stderr.write(`Error: ${e}\n`);
    }
    process.stderr.write('\n');
    printUsage();
    process.exit(1);
  }

  // 决定运行哪些 taskIds
  let taskIds;
  if (args.allFixtures) {
    taskIds = listAllFixtureTaskIds();
    if (taskIds.length === 0) {
      process.stderr.write(`Error: no fixtures found in ${FIXTURES_DIR}\n`);
      process.exit(1);
    }
  } else {
    taskIds = [args.task];
  }

  // Feature 162 FR-027 入口位点 1/3：parseArgs 之后、runForTaskList 之前
  //   driver model：SPECTRA_EVAL_EXECUTOR 覆盖默认 'codex:gpt-5.5'
  //   judges：DEFAULT_JUDGES（args 当前未承载 --judges，沿用 jury 默认）
  //   触发时机：所有 batch 启动前一次性检查；fail-fast 退出码 1
  try {
    const driverModel = process.env.SPECTRA_EVAL_EXECUTOR || 'codex:gpt-5.5';
    assertNoSelfJudge({ driver: driverModel, judges: DEFAULT_JUDGES });
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }

  // iter-2 W-2 修复：互斥校验对 dry-run 也生效（语义校验与是否真跑无关）
  // 这样 `--dry-run --accept-partial --restart-partial` 也会按 EX_USAGE=64 拒绝
  try {
    validateAcceptRestartPartial({
      acceptPartial: args.acceptPartial,
      restartPartial: args.restartPartial,
    });
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(err.exitCode ?? EX_USAGE);
  }

  // Feature 162 Phase C：classify + partial 处置仅在非 dry-run 路径生效
  if (!args.dryRun) {
    // classify 已有 runs（Group C runDir 为单一 cohort；plan 中 4 类只在 quota.run_ids 联动）
    // iter-2 C-1：runs 实际落在 RUNS_DIR/<group>/<taskId>/run-N.json（双层），需递归扫描
    const cohortRunDir = path.join(RUNS_DIR, args.group);
    if (fs.existsSync(cohortRunDir)) {
      const classified = classifyRuns({ runDir: cohortRunDir, recursive: true });
      process.stdout.write(
        `[quota] classify ${args.group}: finalized=${classified.finalized.length}` +
          ` partialRunning=${classified.partialRunning.length}` +
          ` partialStale=${classified.partialStale.length}` +
          ` failedFinalized=${classified.failedFinalized.length}\n`,
      );
      const mode = args.acceptPartial ? 'accept' : args.restartPartial ? 'restart' : null;
      if (mode && classified.partialStale.length > 0) {
        const decision = applyPartialDecision({
          runDir: cohortRunDir,
          partialStaleList: classified.partialStale,
          mode,
          quotaStorePath: QUOTA_STORE_PATH,
        });
        process.stdout.write(
          `[quota] partial decision mode=${mode} processed=${decision.processed.length}\n`,
        );
      } else if (classified.partialStale.length > 0) {
        process.stdout.write(
          `[quota] partialStale=${classified.partialStale.length}（用 --accept-partial / --restart-partial 决定如何处理）\n`,
        );
      }
    }

    // 配额上限早期检查：maxRunsPerDay=0 立即优雅退出
    if (args.maxRunsPerDay === 0) {
      process.stdout.write(`[quota] --max-runs-per-day=0，跳过本次跑批；exit 0\n`);
      process.exit(0);
    }
  }

  const claudeCliVersion = args.dryRun ? '(dry-run)' : captureClaudeCliVersion();

  // dry-run 输出：预估 cost / runs（FR-B-005）
  if (args.dryRun) {
    const totalRuns = taskIds.length * args.repeat;
    const estimatedCost = totalRuns * DRY_RUN_COST_PER_RUN_USD;
    process.stdout.write(
      `[dry-run] group=${args.group} tasks=${taskIds.length} repeat=${args.repeat} total-runs=${totalRuns}\n`,
    );
    process.stdout.write(
      `[dry-run] estimated cost=$${estimatedCost.toFixed(2)} (assume $${DRY_RUN_COST_PER_RUN_USD}/run)\n`,
    );
    process.stdout.write(
      `[dry-run] stop-loss=$${args.stopLoss} max-judge-calls=${args.maxJudgeCalls}\n`,
    );
  }

  let summary;
  try {
    summary = await runForTaskList({ args, taskIds, claudeCliVersion });
  } catch (err) {
    // infrastructure error（FR-B-007）→ 退出码非零
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `[summary] attempted=${summary.runsAttempted} completed=${summary.runsCompleted} failed=${summary.failures.length} cost=$${summary.cumulativeCost.toFixed(2)}\n`,
  );
  if (summary.stopLossTriggered) {
    process.stdout.write(`[summary] stop-loss triggered\n`);
  }
  if (summary.quotaExhausted) {
    process.stdout.write(`[summary] quota exhausted (--max-runs-per-day=${args.maxRunsPerDay})\n`);
  }

  // FR-B-007：oracle fail 不影响退出码；脚本 infra error 才退出码非零
  // dry-run 时即使有 failures（如 fixture 不存在）也已转为 infra error 在 runForTaskList 抛出
  process.exit(0);
}

const isCliEntry =
  process.argv[1] && process.argv[1].endsWith('eval-mcp-augmented.mjs');
if (isCliEntry) {
  main().catch((err) => {
    process.stderr.write(`Unhandled: ${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
