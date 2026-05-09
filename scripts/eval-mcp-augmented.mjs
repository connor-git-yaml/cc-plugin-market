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
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  prepareWorktree,
  runPrimaryOracle,
  captureProductMetrics,
} from './eval-task-runner.mjs';

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

// SWE-Bench target → baseline 目录名（不复用 runner 的硬编码 map）
const SWEBENCH_TARGET_MAP = {
  'sympy/sympy': 'sympy',
  'astropy/astropy': 'astropy',
  'pytest-dev/pytest': 'pytest',
};

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
  // 文件名 stem 与 taskId 一致：SWE-L001-pytest-module-imported-twice-under.json
  const fp = path.join(FIXTURES_DIR, `${taskId}.json`);
  if (!fs.existsSync(fp)) {
    throw new Error(`fixture not found: ${fp}`);
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

function parseTelemetryJsonl(telemetryPath) {
  // FR-G-003：Group C 每次 run 结束后解析，累计 toolCall / responseSize
  const out = { mcpToolCallCount: 0, mcpResponseBytes: 0 };
  if (!fs.existsSync(telemetryPath)) return out;
  let raw;
  try {
    raw = fs.readFileSync(telemetryPath, 'utf-8');
  } catch {
    return out;
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      out.mcpToolCallCount += 1;
      if (typeof j.responseSize === 'number') {
        out.mcpResponseBytes += j.responseSize;
      }
    } catch {
      // 忽略坏行（telemetry 写入失败的部分行）
    }
  }
  return out;
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

function buildGroupCPrompt(taskFixture) {
  // FR-C-003 — mandatory tool use instruction
  return [
    '你有以下 MCP tools 可用：',
    '- mcp__spectra__impact: 分析修改一个 symbol 的 blast radius',
    '- mcp__spectra__context: 获取 symbol 的 360° 定义 / callers / callees',
    '- mcp__spectra__detect_changes: 分析 diff 影响哪些 symbols',
    '',
    '在开始修复前，**必须**先调用 mcp__spectra__context 确认要修改的 symbol 定义，',
    '再调 mcp__spectra__impact 评估影响范围，最后再写代码修复并验证。',
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
 */
async function spawnClaudeAndWait({ args, wtDir, timeoutMs }) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const env = { ...process.env };
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
        wallMs: 0,
        costUsd: DRY_RUN_COST_PER_RUN_USD,
        claudeCliVersion,
        ...(group === 'B' ? { specPushDegraded } : {}),
        ...(group === 'C'
          ? {
              mcpToolCallCount: 0,
              mcpResponseBytes: 0,
              telemetryPathPreview: telemetryPath,
            }
          : {}),
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

  let runOutcome;
  try {
    runOutcome = await spawnClaudeAndWait({
      args: claudeArgs,
      wtDir: wt.wtDir,
      timeoutMs: DEFAULT_TIMEOUT_MS,
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
  let mcpToolCallCount = null;
  let mcpResponseBytes = null;
  if (group === 'C' && telemetryPath) {
    const t = parseTelemetryJsonl(telemetryPath);
    mcpToolCallCount = t.mcpToolCallCount;
    mcpResponseBytes = t.mcpResponseBytes;
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

  return {
    ok: true,
    costUsd: realCostUsd ?? DRY_RUN_COST_PER_RUN_USD,
    runResult: {
      group,
      taskId,
      repeatIndex,
      runId,
      oracleResult: oracleResultMapped,
      oracleError: null,
      wallMs: runOutcome.wallMs,
      timestamp,
      costUsd: realCostUsd,
      claudeCliVersion,
      worktreePath: wt.wtDir,
      productMetrics,
      claudeExit: runOutcome.exitCode,
      claudeTimedOut: runOutcome.timedOut,
      ...(group === 'B' ? { specPushDegraded } : {}),
      ...(group === 'C'
        ? {
            mcpToolCallCount,
            mcpResponseBytes,
          }
        : {}),
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
      const result = await runOne({
        group: args.group,
        taskFixture,
        repeatIndex: i,
        args,
        claudeCliVersion,
      });
      if (!result.ok) {
        failures.push({ taskId, repeatIndex: i, error: result.error });
        if (!args.dryRun) {
          // 实跑失败 → 不视为退出码非零的 infrastructure error，按 spec 继续
          process.stderr.write(
            `[run-failure] ${taskId} run=${i}: ${result.error}\n`,
          );
        }
        continue;
      }
      cumulativeCost += result.costUsd ?? 0;
      // 写 run-N.json（dry-run 也写，便于 Stage 7a 重现 — 但放 runs/<group>/<taskId>/dry-run-<N>.json）
      // Spec FR-B-005: dry-run 不写 run-N.json（避免污染 fixtures runs/ 目录）
      if (!args.dryRun) {
        const fp = writeRunResult({
          group: args.group,
          taskId,
          repeatIndex: i,
          payload: result.runResult,
        });
        process.stdout.write(`[run] wrote ${path.relative(PROJECT_ROOT, fp)}\n`);
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
