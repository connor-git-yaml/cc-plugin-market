#!/usr/bin/env node
/**
 * Feature 147 Phase 3 — Worktree task runner（spec-driver / SuperPowers / GStack / control 派发）
 *
 * 流程：
 *   1. 准备 worktree：clone target → ~/.spec-driver-bench-worktrees/<task>/<tool>/
 *   2. spawn `claude --print --plugin-dir <path> "<prompt>"` 让对应工具跑任务
 *   3. 监测产物：git log / files changed / wall / tokens
 *   4. 跑 primary oracle（ast-diff / unit-test）
 *   5. 写 fixture 到 tests/baseline/tasks/<task>/<tool>/full.json
 *
 * 用法：
 *   node scripts/eval-task-runner.mjs --task T1-micrograd-add-tanh --tool spec-driver
 *   node scripts/eval-task-runner.mjs --task T1-micrograd-add-tanh --tool control --cleanup on-success
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCHEMA_VERSION = '1.2'; // Feature 158: 新增 perf.mcpToolCallTrace + perf.w3Flag（mcp-pull cohort 才填，其余 null，向后兼容）
const COLLECTOR_VERSION = '0.4.0';
export const SUPPORTED_TOOLS = ['spec-driver', 'superpowers', 'gstack', 'control', 'spec-driver-spectra', 'mcp-pull'];

// Feature 158 CR-2：fixture 查找多目录优先序（specs/158 优先，向后兼容 specs/147）
const TASK_FIXTURE_DIRS = [
  path.join(PROJECT_ROOT, 'specs/158-swe-bench-lite-grounding-eval/research/task-fixtures'),
  path.join(PROJECT_ROOT, 'specs/147-competitor-evaluation-platform/research/task-fixtures'),
];

function getBenchHome() {
  return process.env.SPEC_DRIVER_BENCH_HOME ?? path.join(os.homedir(), '.spec-driver-bench-worktrees');
}

function getBaselineHome() {
  return process.env.SPECTRA_BASELINE_HOME ?? path.join(os.homedir(), '.spectra-baselines');
}

// ============================================================
// argv
// ============================================================

export function parseArgs(argv) {
  const args = {
    task: null,
    tool: null,
    cleanup: 'on-success', // always | on-success | never
    timeoutMs: 1800000, // 30 min hard limit
    skipRun: false, // 仅生成 fixture skeleton + 不实际 spawn claude
    skipSanity: false, // 跳过 fixture sanity check（oracle 在 setup 后立即 PASS 即视为 fixture invalid）
    bypassPermissions: false, // Sprint 3 Phase D: dangerously-skip-permissions 让 agent 能 git commit + 跑 pytest
    fixtureSuffix: '', // Sprint 3 Phase D: 把结果写到 tasks/<task>/<tool>-<suffix>/full.json，避免覆盖 sprint2 single-turn 数据
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--task': args.task = argv[++i]; break;
      case '--tool': args.tool = argv[++i]; break;
      case '--cleanup': args.cleanup = argv[++i]; break;
      case '--timeout-ms': args.timeoutMs = Number(argv[++i]); break;
      case '--skip-run': args.skipRun = true; break;
      case '--skip-sanity': args.skipSanity = true; break;
      case '--bypass-permissions': args.bypassPermissions = true; break;
      case '--fixture-suffix': args.fixtureSuffix = argv[++i]; break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!args.task) throw new Error('--task required');
  if (!SUPPORTED_TOOLS.includes(args.tool)) {
    throw new Error(`--tool must be one of ${SUPPORTED_TOOLS.join('|')}`);
  }
  return args;
}

// ============================================================
// Task fixture 加载
// ============================================================

export function loadTaskFixture(taskId) {
  // Feature 158 CR-2: 多目录优先序查找（specs/158 优先；T1-T6 仍走 specs/147）
  for (const dir of TASK_FIXTURE_DIRS) {
    const p = path.join(dir, `${taskId}.json`);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  }
  throw new Error(`task fixture not found in any of: ${TASK_FIXTURE_DIRS.map((d) => path.join(d, taskId + '.json')).join(', ')}`);
}

// ============================================================
// Worktree 准备
// ============================================================

export function prepareWorktree({ taskId, tool, target, startCommit }) {
  const wtDir = path.join(getBenchHome(), taskId, tool);
  if (fs.existsSync(wtDir)) {
    fs.rmSync(wtDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(wtDir), { recursive: true });
  // 从 baseline workspace 复制（避免重新 clone）
  const sourceDir = path.join(getBaselineHome(), getTargetName(target));
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`baseline workspace ${sourceDir} not found; run baseline-collect first to clone`);
  }
  // rsync source → wtDir（含 .git，让 worktree 是独立 git 仓）
  const cp = spawnSync('rsync', ['-a', '--exclude=node_modules', `${sourceDir}/`, `${wtDir}/`], { encoding: 'utf-8' });
  if (cp.status !== 0) throw new Error(`rsync to worktree failed: ${cp.stderr}`);
  // checkout 起始 commit + 创建 task branch
  const branchName = `eval-bench/${taskId}/${tool}`;
  spawnSync('git', ['-C', wtDir, 'checkout', '-B', branchName, startCommit], { encoding: 'utf-8' });
  // 关键：clean 掉 baseline workspace 残留的非追踪文件 (e.g. .spectra-baselines, __pycache__,
  // specs/_meta artifacts)，否则后续 `git add -A` 会污染 diff，judges 看到一堆无关变更
  spawnSync('git', ['-C', wtDir, 'reset', '--hard', startCommit], { encoding: 'utf-8' });
  spawnSync('git', ['-C', wtDir, 'clean', '-ffdx'], { encoding: 'utf-8' });
  return { wtDir, branchName };
}

function getTargetName(targetSpec) {
  const map = { 'karpathy/micrograd': 'micrograd', 'karpathy/nanoGPT': 'nanoGPT', 'self-dogfood': 'self-dogfood' };
  return map[targetSpec] ?? targetSpec.split('/').pop();
}

// ============================================================
// Tool driver dispatch
// ============================================================

const SUPERPOWERS_PLUGIN_DIR = path.join(os.homedir(), '.claude/plugins/installed');
const GSTACK_SKILLS_DIR = path.join(os.homedir(), '.claude/skills/gstack');

export function buildDriverPrompt({ tool, taskPrompt, spectraContext }) {
  switch (tool) {
    case 'control':
      return taskPrompt;
    case 'mcp-pull':
      // Feature 158 spec §AUTO-RESOLVED：cohort 之间 prompt 主体保持完全一致（避免 confound）
      // grounding 区分仅靠 MCP server 注册（mcp-pull cohort 在 wtDir 写 .mcp.json + spectra graph）
      // agent 是否主动调 spectra tool 由 trigger awareness 决定 — 这是 W-3 trap 的科学测量目标
      // 不在 prompt 末尾加 hint（Codex review 1 CRITICAL 5 修复）
      return taskPrompt;
    case 'spec-driver':
      return `请使用 spec-driver-fix workflow（specify → plan → implement → verify）完成以下任务，包括严格的 spec-driven discipline + 测试覆盖：\n\n${taskPrompt}`;
    case 'spec-driver-spectra':
      // 关键对照组：spec-driver workflow + 预先注入 spectra spec.md 作为项目理解 context
      // 测试 Spectra + Spec Driver 协同价值（"AI for AI" 叙事的真正实证）
      //
      // ⚠️ Sprint 3 后修订（Feature 147 反常调查根因 1+2 修复）：
      // 旧版模板把 "严格的 spec-driven discipline + 测试覆盖" 红线 keyword 替换为
      // "spec.md context 指导你的实施决策"，导致 GLM 进入"按 spec 实施"frame，T6 上
      // n=2 fully complied（删除 test/test_engine.py）。修复策略：
      //   (a) prompt 顶部保留 "严格的 spec-driven discipline + 测试覆盖"（与 spec-driver 工具对齐）
      //   (b) prompt 末尾加 prescriptive guard rail（spec.md 是 descriptive 不是放弃纪律的许可）
      // 修订后预期：spec-driver-spectra 与 spec-driver 在 T6 上行为一致（surface refusal）
      // Codex WARNING 1 修复：空字符串 / 仅空白也应回退（?? 不覆盖空串）
      return `请使用 spec-driver-fix workflow（specify → plan → implement → verify）完成以下任务，**包括严格的 spec-driven discipline + 测试覆盖**。项目结构与关键 abstractions 已由 spectra 预先分析，请利用以下 spec.md context 指导你的实施决策：\n\n## Spectra-generated context\n\n${(spectraContext?.trim()) || '(spectra context unavailable)'}\n\n---\n\n## Task\n\n${taskPrompt}\n\n---\n\n**Constitution 提醒**：上方 spec.md 描述当前代码事实（descriptive），不是放弃 spec-driven discipline 的许可。任务若违反测试覆盖或其他 workflow 纪律红线，应主动 surface 拒绝（写 TASK_REFUSAL.md 给出理由）而非执行。`;
    case 'superpowers':
      return `请使用 SuperPowers 框架的 brainstorm → plan → execute（含 RED/GREEN TDD）方法完成以下任务：\n\n${taskPrompt}`;
    case 'gstack':
      return `请使用 GStack 风格的 plan → build → review → test → ship 工作流完成以下任务：\n\n${taskPrompt}`;
    default:
      return taskPrompt;
  }
}

/**
 * 加载 spectra spec.md 作为 context（spec-driver-spectra 对照组用）
 * 按任务相关性排序选择 spec.md：与 taskTargetFiles 名匹配的 spec.md 优先；其次 _index.spec.md；
 * 最后 fallback 到字母序前 N 个。避免 T2 改 train.py 但加载 bench/configurator spec 的 bug (Codex WARN)。
 */
export function loadSpectraContext(targetSpec, maxBytes = 12000, options = {}) {
  const { taskTargetFiles = [], maxFiles = 3 } = options;
  const targetName = { 'karpathy/micrograd': 'micrograd', 'karpathy/nanoGPT': 'nanoGPT', 'self-dogfood': 'self-dogfood' }[targetSpec];
  if (!targetName) return null;
  const modulesDir = path.join(os.homedir(), '.spectra-baselines', `${targetName}-output`, 'spectra-full', 'modules');
  if (!fs.existsSync(modulesDir)) return null;
  const allSpecs = fs.readdirSync(modulesDir).filter((n) => n.endsWith('.spec.md'));
  // 相关性排序: 与 taskTargetFiles basename (去 .py) 匹配的优先
  const targetBasenames = taskTargetFiles.map((f) => path.basename(f).replace(/\.\w+$/, '')).filter(Boolean);
  const score = (specName) => {
    const stem = specName.replace(/\.spec\.md$/, '');
    if (targetBasenames.includes(stem)) return 100;          // 直接匹配文件名（如 train.py → train.spec.md）
    if (targetBasenames.some((b) => stem.includes(b))) return 50;  // 部分匹配
    if (stem === '_index') return 10;                         // index spec 永远兜底有价值
    return 0;
  };
  const sorted = allSpecs.map((n) => ({ name: n, s: score(n) }))
    .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name))
    .slice(0, maxFiles);
  let content = '';
  for (const { name } of sorted) {
    const sample = fs.readFileSync(path.join(modulesDir, name), 'utf-8').slice(0, 4000);
    content += `### ${name}\n\n${sample}\n\n---\n\n`;
    if (content.length > maxBytes) break;
  }
  return content.slice(0, maxBytes);
}

export function findSuperPowersDir() {
  if (!fs.existsSync(SUPERPOWERS_PLUGIN_DIR)) return null;
  const entries = fs.readdirSync(SUPERPOWERS_PLUGIN_DIR);
  const match = entries.find((e) => /^superpowers/i.test(e));
  return match ? path.join(SUPERPOWERS_PLUGIN_DIR, match) : null;
}

export function buildClaudeArgs({ tool, prompt, wtDir = null, bypassPermissions = false }) {
  // 注意：--add-dir / --allowed-tools 都是 variadic（<...>），把后续 prompt 吞掉。
  // 改用 cwd: wtDir 已让 claude 访问目标目录；--allowedTools 写在 plugin-dir 之前并明确分隔。
  // Sprint 3 Phase D: 加 bypassPermissions 模式，用于 multi-turn 实跑（让 agent 能 git commit + 跑 pytest），
  // 仅在 ephemeral worktree 内安全（CLAUDE.local.md 已确认）
  // Feature 158: mcp-pull cohort 走 stream-json + --mcp-config 路径（与 spike-T2 一致）
  if (tool === 'mcp-pull') {
    if (!wtDir) {
      throw new Error('buildClaudeArgs: mcp-pull cohort 必须传入 wtDir 参数（用于定位 .mcp.json）');
    }
    const mcpArgs = [
      '--print',
      '--model', 'claude-sonnet-4-6',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose', // stream-json 需要 --verbose 才能完整 dump tool_use block
      '--permission-mode', bypassPermissions ? 'bypassPermissions' : 'acceptEdits',
      '--mcp-config', path.join(wtDir, '.mcp.json'),
      '--allowedTools', 'mcp__spectra__impact,mcp__spectra__context,mcp__spectra__detect_changes,Read,Grep,Glob,Bash,Edit,Write',
    ];
    if (bypassPermissions) mcpArgs.push('--dangerously-skip-permissions');
    mcpArgs.push(prompt);
    return mcpArgs;
  }
  const baseArgs = [
    '--print',
    '--model', 'claude-sonnet-4-6',
    '--output-format', 'text',
    '--permission-mode', bypassPermissions ? 'bypassPermissions' : 'acceptEdits',
  ];
  if (bypassPermissions) baseArgs.push('--dangerously-skip-permissions');
  if (tool === 'superpowers') {
    const dir = findSuperPowersDir();
    if (dir) baseArgs.push('--plugin-dir', dir);
  } else if (tool === 'gstack') {
    if (fs.existsSync(GSTACK_SKILLS_DIR)) baseArgs.push('--plugin-dir', GSTACK_SKILLS_DIR);
  }
  baseArgs.push(prompt);
  return baseArgs;
}

// ============================================================
// Feature 158: MCP 准备 + parseMcpToolCallTrace
// ============================================================

/**
 * 写入 .mcp.json 到 wtDir，spectra MCP server 走 dist/cli/index.js 绝对路径绕开 volta 拦截。
 * 调用方在 prepareWorktree 之后、runTask 之前调用（仅 mcp-pull cohort 需要）。
 */
export function writeMcpConfig(wtDir) {
  const distCli = path.join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
  if (!fs.existsSync(distCli)) {
    throw new Error(`[mcp-config] spectra dist/cli/index.js 不存在；请先 npm run build。`);
  }
  const config = {
    mcpServers: {
      spectra: {
        command: 'node',
        args: [distCli, 'mcp-server'],
      },
    },
  };
  const cfgPath = path.join(wtDir, '.mcp.json');
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return cfgPath;
}

/**
 * 在 wtDir 内跑 spectra batch --mode code-only 生成 specs/_meta/graph.json（mcp-pull cohort 必需）。
 * 用 dist/cli/index.js 绝对路径绕过 volta；
 * --mode code-only 跳过 LLM 增强（baseline 只测 grounding，不需 spec.md，src/cli/commands/batch.ts:65 注释 "最快分析 < 30s"）。
 */
export function runSpectraBatchInWorktree(wtDir, { timeoutMs = 600000 } = {}) {
  const distCli = path.join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
  if (!fs.existsSync(distCli)) {
    throw new Error(`[spectra-batch] spectra dist/cli/index.js 不存在；请先 npm run build。`);
  }
  const r = spawnSync('node', [distCli, 'batch', '--mode', 'code-only', '--no-html'], {
    cwd: wtDir,
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`[spectra-batch] failed in ${wtDir}: exit=${r.status}\nstderr=${(r.stderr ?? '').slice(0, 500)}`);
  }
  const graphPath = path.join(wtDir, 'specs', '_meta', 'graph.json');
  if (!fs.existsSync(graphPath)) {
    throw new Error(`[spectra-batch] graph.json 未生成: ${graphPath}`);
  }
  return graphPath;
}

/**
 * 从 stream-json stdout 末尾的 result 事件解析 cost + token 总量。
 * 仅 mcp-pull cohort 使用 stream-json；其他 cohort 走 text mode，cost/tokens 仍是 null。
 *
 * @returns {{ costUsd: number|null, tokensInput: number|null, tokensOutput: number|null, tokensCacheRead: number|null }}
 */
export function parseStreamJsonUsage(stdout) {
  const lines = stdout.split('\n');
  // 末尾几个 result/system 事件含累计 modelUsage / costUSD（Claude CLI 输出格式）
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    let evt;
    try { evt = JSON.parse(trimmed); } catch { continue; }
    // claude --print --output-format stream-json 末尾输出 `{"type":"result", ..., "modelUsage":{<model>:{...}}}` 或 sub_event 含 modelUsage
    const modelUsage = evt?.modelUsage || evt?.message?.modelUsage || (evt?.type === 'result' && evt?.modelUsage);
    if (!modelUsage) continue;
    let costUsd = 0;
    let tokensInput = 0;
    let tokensOutput = 0;
    let tokensCacheRead = 0;
    for (const model of Object.keys(modelUsage)) {
      const u = modelUsage[model] ?? {};
      costUsd += u.costUSD ?? 0;
      tokensInput += u.inputTokens ?? 0;
      tokensOutput += u.outputTokens ?? 0;
      tokensCacheRead += u.cacheReadInputTokens ?? 0;
    }
    return {
      costUsd: costUsd > 0 ? costUsd : null,
      tokensInput: tokensInput > 0 ? tokensInput : null,
      tokensOutput: tokensOutput > 0 ? tokensOutput : null,
      tokensCacheRead: tokensCacheRead > 0 ? tokensCacheRead : null,
    };
  }
  return { costUsd: null, tokensInput: null, tokensOutput: null, tokensCacheRead: null };
}

/**
 * 解析 stream-json stdout，提取所有 mcp__spectra__* tool_use 调用，返回 trace 数组 + w3Flag。
 *
 * @param {string} stdout - claude --print --output-format stream-json 输出（多行 NDJSON）
 * @param {string[]} expectedSpectraToolCalls - fixture 中声明的预期 tool 短名（如 ["impact","context"]）
 * @returns {{ trace: Array<{toolName, callCount, firstCallTurn, totalDurationMs}>, w3Flag: boolean }}
 *
 * w3Flag 规则（与 spec FR-005 / W-3 严格对齐）：
 *  - callCount === 0（没调任何 spectra tool）→ w3Flag = true
 *  - callCount > 0 但所有 toolName 都不在 expectedSpectraToolCalls（短名 endsWith 匹配）→ w3Flag = true
 *  - 至少一次 toolName 在 expectedSpectraToolCalls 中 → w3Flag = false
 *  - expectedSpectraToolCalls 为空数组或 null：当 callCount > 0 时 w3Flag = false（无 expectation 不算 trap）
 */
export function parseMcpToolCallTrace(stdout, expectedSpectraToolCalls = null) {
  const events = [];
  const lines = stdout.split('\n');
  let turnIndex = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    let evt;
    try { evt = JSON.parse(trimmed); } catch { continue; }
    // 计 turn：每个完整 assistant message 算一个 turn
    if (evt.type === 'assistant' && evt.message?.role === 'assistant') {
      turnIndex++;
      const content = evt.message?.content || [];
      for (const block of content) {
        if (block?.type === 'tool_use' && typeof block.name === 'string' && block.name.startsWith('mcp__spectra__')) {
          events.push({ name: block.name, id: block.id, turn: turnIndex, ts: Date.parse(evt.timestamp || '') || null });
        }
      }
    }
    // tool_result 用于估算 duration（简化：用相邻 ts 差值；缺 ts 时 totalDurationMs=null）
    if (evt.type === 'user' && Array.isArray(evt.message?.content)) {
      for (const block of evt.message.content) {
        if (block?.type === 'tool_result' && block.tool_use_id) {
          const target = events.find((e) => e.id === block.tool_use_id);
          if (target && evt.timestamp) {
            target.resultTs = Date.parse(evt.timestamp) || null;
          }
        }
      }
    }
  }
  // 聚合按 toolName
  const grouped = new Map();
  for (const ev of events) {
    if (!grouped.has(ev.name)) {
      grouped.set(ev.name, { toolName: ev.name, callCount: 0, firstCallTurn: ev.turn, totalDurationMs: 0, _withDuration: 0 });
    }
    const g = grouped.get(ev.name);
    g.callCount++;
    if (ev.ts && ev.resultTs) {
      g.totalDurationMs += Math.max(0, ev.resultTs - ev.ts);
      g._withDuration++;
    }
  }
  const trace = [...grouped.values()].map((g) => ({
    toolName: g.toolName,
    callCount: g.callCount,
    firstCallTurn: g.firstCallTurn,
    totalDurationMs: g._withDuration > 0 ? g.totalDurationMs : null,
  }));

  // w3Flag 计算
  const totalCalls = trace.reduce((s, t) => s + t.callCount, 0);
  let w3Flag;
  if (totalCalls === 0) {
    w3Flag = true; // 完全没调（trap 命中）
  } else if (Array.isArray(expectedSpectraToolCalls) && expectedSpectraToolCalls.length > 0) {
    // 检查至少一次匹配 expected（CL-001：endsWith 短名匹配）
    const matched = trace.some((t) =>
      expectedSpectraToolCalls.some((expected) => t.toolName.endsWith(expected))
    );
    w3Flag = !matched; // 完全 mismatch 也算 trap
  } else {
    // 无 expectation 时只要调过就视为 trigger 成功
    w3Flag = false;
  }
  return { trace, w3Flag };
}

// ============================================================
// 跑 task
// ============================================================

export function runTask({ tool, prompt, wtDir, timeoutMs, bypassPermissions = false }) {
  // Feature 158: mcp-pull 必须把 wtDir 透传给 buildClaudeArgs（用于定位 .mcp.json）
  const args = buildClaudeArgs({ tool, prompt, wtDir, bypassPermissions });
  const start = process.hrtime.bigint();
  // 不主动设 ANTHROPIC_API_KEY；让 claude CLI fallback 到 OAuth credentials
  // （之前设为 '' 会覆盖 OAuth 导致 401 auth error）
  const env = { ...process.env };
  if (env.ANTHROPIC_API_KEY === '') delete env.ANTHROPIC_API_KEY;
  const r = spawnSync('claude', args, {
    cwd: wtDir,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    env,
  });
  const wallMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
  return {
    wallMs,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    exitCode: r.status,
    claudeArgs: args, // Sprint 3 Phase D codex fix: 让真实传给 claude 的 args 可入 fixture（含 --bypass-permissions / --plugin-dir 等 flag）
    timedOut: r.signal === 'SIGTERM' || (r.error && r.error.code === 'ETIMEDOUT'),
  };
}

// ============================================================
// Oracle 验证
// ============================================================

export function runPrimaryOracle({ wtDir, oracle }) {
  // ast-diff 和 stop-condition 共享 checks 数组语义（每个 check 是 bash 命令，status=0 视为 PASS）
  if (oracle.kind === 'ast-diff' || oracle.kind === 'stop-condition') {
    let allPassed = true;
    const results = [];
    for (const cmd of oracle.checks) {
      const r = spawnSync('bash', ['-c', cmd], { cwd: wtDir, encoding: 'utf-8' });
      const passed = r.status === 0;
      if (!passed) allPassed = false;
      results.push({ cmd, passed, output: (r.stdout ?? '').slice(0, 200) });
    }
    return { kind: oracle.kind, passed: allPassed, details: results };
  } else if (oracle.kind === 'unit-test') {
    const r = spawnSync('bash', ['-c', oracle.command.replaceAll('<workspace>', wtDir)], { cwd: wtDir, encoding: 'utf-8', timeout: 60000 });
    return { kind: 'unit-test', passed: r.status === oracle.expectedExit, details: { exitCode: r.status, stdout: (r.stdout ?? '').slice(0, 1000) } };
  } else if (oracle.kind === 'functional') {
    // Functional oracle: 真跑 pytest / python / 任何 shell 命令验证功能
    // 每个 check 是 object: { cmd, mustPass=true, timeoutMs=60000, description }
    // 取代 grep-based ast-diff，让"加 stub PASS"这种假阳性被自动 catch
    let allPassed = true;
    const results = [];
    for (const rawCheck of oracle.checks) {
      const check = typeof rawCheck === 'string' ? { cmd: rawCheck } : rawCheck;
      const cmd = check.cmd;
      const mustPass = check.mustPass !== false; // 默认 true
      const timeoutMs = check.timeoutMs ?? 60000;
      const description = check.description ?? cmd;
      const r = spawnSync('bash', ['-c', cmd], { cwd: wtDir, encoding: 'utf-8', timeout: timeoutMs });
      const exited0 = r.status === 0;
      const passed = mustPass ? exited0 : !exited0;
      const timedOut = r.signal === 'SIGTERM' || (r.error && r.error.code === 'ETIMEDOUT');
      if (!passed) allPassed = false;
      results.push({
        cmd,
        description,
        mustPass,
        exitCode: r.status,
        passed,
        timedOut,
        stdout: (r.stdout ?? '').slice(0, 500),
        stderr: (r.stderr ?? '').slice(0, 500),
      });
    }
    return { kind: 'functional', passed: allPassed, details: results };
  }
  return { kind: oracle.kind, passed: false, details: 'unknown oracle kind' };
}

// ============================================================
// 测产物：commits / files changed
// ============================================================

export function captureProductMetrics(wtDir) {
  const commitLogR = spawnSync('git', ['-C', wtDir, 'log', '--oneline', '@{u}..HEAD', '||', 'true'], { encoding: 'utf-8', shell: true });
  const allCommitsR = spawnSync('git', ['-C', wtDir, 'log', '--oneline'], { encoding: 'utf-8' });
  const diffR = spawnSync('git', ['-C', wtDir, 'diff', '--stat', 'HEAD~1'], { encoding: 'utf-8' });
  const statusR = spawnSync('git', ['-C', wtDir, 'status', '--porcelain'], { encoding: 'utf-8' });

  const newCommits = (commitLogR.stdout ?? '').trim().split('\n').filter(Boolean).length;
  const filesChanged = (diffR.stdout ?? '').match(/(\d+)\s+files?\s+changed/);
  const uncommittedChanges = (statusR.stdout ?? '').trim().split('\n').filter(Boolean).length;

  return {
    commits: newCommits,
    filesChanged: filesChanged ? Number(filesChanged[1]) : 0,
    uncommittedChanges,
    diffStat: (diffR.stdout ?? '').slice(0, 2000),
  };
}

// ============================================================
// Fixture 组装
// ============================================================

function getGitCommit(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

function readSpectraVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

export function assembleTaskFixture({ taskId, tool, taskFixture, wtDir, runResult, oracleResult, productMetrics, claudeArgs = null, mcpTrace = null, w3Flag = null, usage = null }) {
  const nowIso = new Date().toISOString();
  const staleAfterDate = new Date(Date.now() + 6 * 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  // Sprint 3 Phase D codex review fix: 把真实传给 claude 的 args 入库（不含 prompt 本身），让 bypass-permissions / plugin-dir 等 flag 可审计
  const recordedArgs = claudeArgs
    ? claudeArgs.filter((a) => a !== claudeArgs[claudeArgs.length - 1]) // 去掉末尾 prompt（变长 + 含敏感任务描述）
    : ['--print', '--model', 'claude-sonnet-4-6'];
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      tool,
      spectraVersion: readSpectraVersion(),
      collectorVersion: COLLECTOR_VERSION,
      targetProject: taskFixture.target,
      targetCommit: taskFixture.startCommit,
      targetFileCountsByType: null,
      targetLocEstimate: null,
      spectraModuleCount: null,
      mode: 'task',
      model: 'claude-sonnet-4-6',
      runTimestampUtc: nowIso,
      runHostOs: process.platform,
      command: 'claude',
      args: recordedArgs,
      envAllowlist: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '<redacted>' : null },
      outputDir: wtDir,
      stdoutLogPath: path.join(wtDir, 'task-runner-stdout.log'),
      stderrLogPath: path.join(wtDir, 'task-runner-stderr.log'),
      pinnedAt: nowIso,
      staleAfterDate,
      upstreamVersion: 'unknown',
      frozenFixture: ['superpowers', 'gstack'].includes(tool),
    },
    dryRun: { estimatedTokens: null, actualTokens: null, biasRatio: null },
    perf: {
      totalWallMs: runResult.wallMs,
      llmCallCount: null,
      llmCallDurationsMs: null,
      // Feature 158 CR-6 修复：mcp-pull cohort 走 stream-json，可解析 cost/tokens；其他 cohort 仍 null
      tokensInput: usage?.tokensInput ?? null,
      tokensOutput: usage?.tokensOutput ?? null,
      tokensCacheRead: usage?.tokensCacheRead ?? null,
      estimatedCostUsd: usage?.costUsd ?? null,
      memoryPeakKb: null,
      // Feature 158 schema 1.2 新增字段（CR-6 锁定位置：perf 子对象内）
      // mcp-pull cohort：mcpTrace 是数组（可空 []），w3Flag boolean
      // 其他 cohort：两者均为 null（向后兼容 schema 1.1）
      mcpToolCallTrace: mcpTrace,
      w3Flag: w3Flag,
    },
    output: {
      graphNodeCount: null, graphEdgeCount: null, graphHyperedgeCount: 0, graphSizeBytes: null,
      specModuleCount: null, specSuccessCount: null, specSkippedCount: null, specFailedCount: null,
    },
    phases: { specGenerationMs: null, graphBuildMs: null, docsGenerationMs: null, embeddingCacheMs: null, otherMs: null, extractionMethod: 'task-execution' },
    quality: null,
    taskExecution: {
      taskId,
      tool,
      executionMode: 'non-interactive',
      wallMs: runResult.wallMs,
      // Feature 158 CR-6 修复：cost / tokens 从 stream-json 解析（仅 mcp-pull cohort 可用）
      tokensTotal: (usage?.tokensInput ?? 0) + (usage?.tokensOutput ?? 0) || null,
      costUsd: usage?.costUsd ?? null,
      userInterventions: 0,
      commits: productMetrics.commits,
      filesChanged: productMetrics.filesChanged,
      uncommittedChanges: productMetrics.uncommittedChanges,
      primaryOracle: {
        kind: oracleResult.kind,
        passed: oracleResult.passed,
        details: typeof oracleResult.details === 'string' ? oracleResult.details : JSON.stringify(oracleResult.details).slice(0, 1000),
      },
      testsPassed: null, testsFailed: null, testsBroken: null,
      rubricJudgeScore: null, // Phase 4 由 eval-judge 填
      rubricJudgeRationale: null,
      interRaterDelta: null,
      diffStat: productMetrics.diffStat,
      sonnetExitCode: runResult.exitCode,
      sonnetTimedOut: runResult.timedOut,
    },
  };
}

// ============================================================
// 入口
// ============================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const taskFixture = loadTaskFixture(args.task);

  // Sprint 3 Phase D: --fixture-suffix 让 multi-turn 实跑结果落到 <tool>-multiturn/ 而不是覆盖 sprint2 single-turn fixture
  const toolDirName = args.fixtureSuffix ? `${args.tool}-${args.fixtureSuffix}` : args.tool;
  const fixtureDir = path.join(PROJECT_ROOT, 'tests/baseline/tasks', args.task, toolDirName);
  fs.mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, 'full.json');

  if (args.skipRun) {
    console.log(`[task-runner] skip-run mode: writing fixture skeleton at ${path.relative(PROJECT_ROOT, fixturePath)}`);
    const stub = assembleTaskFixture({
      taskId: args.task, tool: args.tool, taskFixture,
      wtDir: '<not-run>',
      runResult: { wallMs: null, stdout: '', stderr: '', exitCode: null, timedOut: false },
      oracleResult: { kind: taskFixture.primaryOracle.kind, passed: false, details: 'skip-run mode' },
      productMetrics: { commits: 0, filesChanged: 0, uncommittedChanges: 0, diffStat: '' },
    });
    fs.writeFileSync(fixturePath, JSON.stringify(stub, null, 2) + '\n', 'utf-8');
    console.log(`[task-runner] stub written`);
    return;
  }

  console.log(`[task-runner] task=${args.task} tool=${args.tool} timeout=${args.timeoutMs}ms`);
  const wt = prepareWorktree({
    taskId: args.task,
    tool: args.tool,
    target: taskFixture.target,
    startCommit: taskFixture.startCommit,
  });
  console.log(`[task-runner] worktree prepared: ${wt.wtDir} (branch ${wt.branchName})`);

  // 任务级 setupHook（如 T2 strip cosine LR，T3 注入 bug，T4 写 magic number，T6 violation 设置等）
  if (Array.isArray(taskFixture.setupCommands) && taskFixture.setupCommands.length > 0) {
    console.log(`[task-runner] running ${taskFixture.setupCommands.length} setup command(s)...`);
    const setupEnv = { ...process.env, SPECTRA_REPO_ROOT: PROJECT_ROOT };
    for (const cmd of taskFixture.setupCommands) {
      const r = spawnSync('bash', ['-c', cmd], { cwd: wt.wtDir, encoding: 'utf-8', env: setupEnv });
      if (r.status !== 0) {
        throw new Error(`setup command failed: ${cmd}\nstderr: ${r.stderr}`);
      }
    }
    // setup commit（让 task 起始 state 含 setup 修改，但仍是 task pre-state）
    spawnSync('git', ['-C', wt.wtDir, 'add', '-A'], { encoding: 'utf-8' });
    spawnSync('git', ['-C', wt.wtDir, 'commit', '-m', 'eval-bench: task setup'], { encoding: 'utf-8' });
  }

  // Sanity check: oracle 不能在 setup 后立即 PASS（fail-fast catch fixture 设计错误）
  if (!args.skipSanity) {
    const sanity = runPrimaryOracle({ wtDir: wt.wtDir, oracle: taskFixture.primaryOracle });
    if (sanity.passed) {
      throw new Error(
        `❌ FIXTURE SANITY FAIL: ${args.task} 的 primaryOracle 在 startCommit + setupCommands 后立即 PASS — ` +
        `task 没有实际工作可做（fixture 设计错误），不允许跑 agent 浪费 token。\n` +
        `修复 fixture 或 --skip-sanity 强制跳过。`
      );
    }
    console.log(`[task-runner] sanity check OK (oracle FAIL on setup state)`);
  }

  // 仅 spec-driver-spectra 需要 spectra context（"AI for AI" 协同对照组）
  const spectraContext = args.tool === 'spec-driver-spectra' ? loadSpectraContext(taskFixture.target) : null;
  if (args.tool === 'spec-driver-spectra' && !spectraContext) {
    console.warn(`[task-runner] WARN: spec-driver-spectra 模式但 spectra context 不可用 (target=${taskFixture.target}); 退化为 spec-driver`);
  }

  // Feature 158: mcp-pull cohort 需要：(1) wtDir 内有 spectra graph，(2) wtDir/.mcp.json 注册 server
  if (args.tool === 'mcp-pull') {
    const graphPath = path.join(wt.wtDir, 'specs', '_meta', 'graph.json');
    if (!fs.existsSync(graphPath)) {
      console.log(`[task-runner] mcp-pull: running spectra batch in worktree (~3 min)...`);
      runSpectraBatchInWorktree(wt.wtDir);
      // 把 batch 产物 commit 进 worktree（保证 graph.json 在后续 git operations 中保留）
      spawnSync('git', ['-C', wt.wtDir, 'add', '-A'], { encoding: 'utf-8' });
      spawnSync('git', ['-C', wt.wtDir, 'commit', '-m', 'eval-bench: spectra graph for mcp-pull'], { encoding: 'utf-8' });
    } else {
      console.log(`[task-runner] mcp-pull: spectra graph already at ${path.relative(wt.wtDir, graphPath)}`);
    }
    writeMcpConfig(wt.wtDir);
    console.log(`[task-runner] mcp-pull: .mcp.json written, spectra MCP server registered`);
  }

  const prompt = buildDriverPrompt({ tool: args.tool, taskPrompt: taskFixture.prompt, spectraContext });
  console.log(`[task-runner] running claude (${args.tool})...`);
  const runResult = runTask({ tool: args.tool, prompt, wtDir: wt.wtDir, timeoutMs: args.timeoutMs, bypassPermissions: args.bypassPermissions });
  console.log(`[task-runner] claude done: wall=${(runResult.wallMs/1000).toFixed(1)}s, exit=${runResult.exitCode}, timedOut=${runResult.timedOut}, output=${runResult.stdout.length}B`);

  // 持久化 stdout/stderr
  fs.writeFileSync(path.join(wt.wtDir, 'task-runner-stdout.log'), runResult.stdout, 'utf-8');
  fs.writeFileSync(path.join(wt.wtDir, 'task-runner-stderr.log'), runResult.stderr, 'utf-8');

  // 跑 oracle
  const oracleResult = runPrimaryOracle({ wtDir: wt.wtDir, oracle: taskFixture.primaryOracle });
  console.log(`[task-runner] oracle ${oracleResult.kind}: ${oracleResult.passed ? 'PASS' : 'FAIL'}`);

  const productMetrics = captureProductMetrics(wt.wtDir);
  console.log(`[task-runner] product: commits=${productMetrics.commits}, files=${productMetrics.filesChanged}, uncommitted=${productMetrics.uncommittedChanges}`);

  // Feature 158: mcp-pull cohort 解析 stream-json，提取 mcpToolCallTrace + w3Flag + cost/tokens（CR-6 修复）
  let mcpTrace = null;
  let w3Flag = null;
  let usage = null;
  if (args.tool === 'mcp-pull') {
    const expected = Array.isArray(taskFixture.expectedSpectraToolCalls) ? taskFixture.expectedSpectraToolCalls : null;
    const parsed = parseMcpToolCallTrace(runResult.stdout, expected);
    mcpTrace = parsed.trace;
    w3Flag = parsed.w3Flag;
    usage = parseStreamJsonUsage(runResult.stdout);
    const totalCalls = mcpTrace.reduce((s, t) => s + t.callCount, 0);
    console.log(`[task-runner] mcp-trace: tools=${mcpTrace.length}, totalCalls=${totalCalls}, w3Flag=${w3Flag}, cost=$${(usage.costUsd ?? 0).toFixed(4)}`);
  }

  const fixture = assembleTaskFixture({
    taskId: args.task, tool: args.tool, taskFixture, wtDir: wt.wtDir,
    runResult, oracleResult, productMetrics,
    claudeArgs: runResult.claudeArgs, // Sprint 3 Phase D codex fix: bypass-permissions / plugin-dir flags 入 meta.args
    mcpTrace,
    w3Flag,
    usage,
  });
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf-8');
  console.log(`[task-runner] fixture written: ${path.relative(PROJECT_ROOT, fixturePath)}`);

  // Cleanup
  if (args.cleanup === 'always' || (args.cleanup === 'on-success' && oracleResult.passed)) {
    fs.rmSync(wt.wtDir, { recursive: true, force: true });
    console.log(`[task-runner] worktree cleaned up`);
  } else {
    console.log(`[task-runner] worktree retained for debug: ${wt.wtDir}`);
  }
}

const isCliEntry = process.argv[1]?.endsWith('eval-task-runner.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[task-runner] error: ${err.message}`);
    process.exit(1);
  });
}
