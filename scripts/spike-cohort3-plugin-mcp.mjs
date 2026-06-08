#!/usr/bin/env node
/**
 * Feature 176 — cohort 3 wiring spike（最高技术风险前置验证；spec FR-A-007b，tasks T-B1）。
 *
 * 验证的核心未知：**`claude --print`（非交互）下，spec-driver workflow 的 sub-agent
 * 能否真实调用 plugin-namespace 的 spectra MCP（mcp__plugin_spectra_spectra__*）**。
 * 既有 mcp-pull cohort 是 driver 顶层 .mcp.json（mcp__spectra__*），从未验证过
 * sub-agent 继承 plugin MCP —— 这是 cohort 3 是否成立的地基。
 *
 * 两个子问题：
 *   (Q1 传播) plugin-namespace MCP 是否传播到 --print sub-agent？（最根本）
 *   (Q2 版本) 能否让该 plugin 指向 F177-F181 的本地 build？（接线细节）
 * 本 spike 直接测目标配置（temp "spectra" plugin → 本地 build）一次回答两者。
 *
 * ⚠️ 需 claude OAuth（Claude Max）—— sandbox worktree 内 claude --print 返回 401，
 * 故本 spike 的真实执行是 host runbook 第一步。sandbox 侧只能：
 *   - 跑 --dry-run（mock stream-json 验证解析逻辑）
 *   - 跑单测（tests/unit/spike-cohort3-parse.test.ts）
 * 真实 PASS/FAIL 由 host 跑出，写 spike-result.md（synthetic 不算 PASS，交接合同 C-3）。
 *
 * 用法：
 *   node scripts/spike-cohort3-plugin-mcp.mjs            # 真实跑（需 host claude OAuth）
 *   node scripts/spike-cohort3-plugin-mcp.mjs --dry-run  # sandbox 验解析逻辑（不调 claude）
 *   node scripts/spike-cohort3-plugin-mcp.mjs --stock-plugin  # 用已装 spectra plugin 测“传播”是否成立（Q1 隔离）
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareSpikeFixture, SPIKE_TASK_PROMPT } from './lib/spike-fixture-prep.mjs';
import { verifySpectraVersion } from './lib/spectra-version-gate.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_NS_PREFIX = 'mcp__plugin_spectra_spectra__';
const DRIVER_NS_PREFIX = 'mcp__spectra__';
const SPEC_DRIVER_PLUGIN = path.join(os.homedir(), '.claude/plugins/cache/cc-plugin-market/spec-driver/4.1.0');
const STOCK_SPECTRA_PLUGIN = path.join(os.homedir(), '.claude/plugins/cache/cc-plugin-market/spectra/4.1.0');

/**
 * 纯函数：从 stream-json stdout 解析工具调用。可单测（[sandbox]）。
 * 全递归遍历（codex WARNING：partial/delta/start/stop 包装层也可能携带 tool_use）。
 * 同时统计 plugin-namespace / driver-namespace spectra 调用 + Task 子代理调用（归因用）。
 * @returns {{pluginCalls, driverCalls, taskCalls, pluginCallCount, driverCallCount, taskCallCount,
 *           pluginAfterTask:boolean, anySpectra:boolean}}
 */
export function parsePluginMcpCalls(stdout) {
  const pluginCalls = [];
  const driverCalls = [];
  const taskCalls = [];
  // 记录调用出现顺序，用于"plugin MCP 是否在 Task 之后出现"的弱归因
  const order = []; // 'task' | 'plugin' | 'driver'
  for (const line of String(stdout).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let evt;
    try { evt = JSON.parse(t); } catch { continue; }
    for (const name of collectToolUseNames(evt)) {
      if (name.startsWith(PLUGIN_NS_PREFIX)) { pluginCalls.push(name); order.push('plugin'); }
      else if (name.startsWith(DRIVER_NS_PREFIX)) { driverCalls.push(name); order.push('driver'); }
      else if (name === 'Task') { taskCalls.push(name); order.push('task'); }
    }
  }
  const firstTaskIdx = order.indexOf('task');
  const firstPluginIdx = order.indexOf('plugin');
  const pluginAfterTask = firstTaskIdx >= 0 && firstPluginIdx > firstTaskIdx;
  return {
    pluginCalls, driverCalls, taskCalls,
    pluginCallCount: pluginCalls.length,
    driverCallCount: driverCalls.length,
    taskCallCount: taskCalls.length,
    pluginAfterTask,
    anySpectra: pluginCalls.length + driverCalls.length > 0,
  };
}

/** 全递归：遍历事件里任意层级的 object/array，收集所有 type==='tool_use' 的 name。 */
function collectToolUseNames(evt) {
  const names = [];
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (node.type === 'tool_use' && typeof node.name === 'string') names.push(node.name);
    for (const v of Array.isArray(node) ? node : Object.values(node)) {
      if (v && typeof v === 'object') visit(v);
    }
  };
  visit(evt);
  return names;
}

/**
 * 构造 temp "spectra" plugin dir（唯一目录，名仍为 "spectra" 以匹配
 * mcp__plugin_spectra_spectra__ 命名空间），其 MCP server 指向本地 F177-F181 build。
 */
function makeLocalSpectraPlugin(distCli) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-spectra-plugin-'));
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'spectra', version: '4.2.0-f176-local', description: 'F176 local build (F177-F181)', mcpServers: './.mcp.json' }, null, 2),
  );
  fs.writeFileSync(
    path.join(dir, '.mcp.json'),
    JSON.stringify({ mcpServers: { spectra: { command: 'node', args: [distCli, 'mcp-server'] } } }, null, 2),
  );
  return dir;
}

/** 检测全局是否已装 spectra plugin（命名冲突会让加载哪个 build 变得歧义，spike 须警示）。 */
function detectGlobalSpectraPlugin() {
  return fs.existsSync(STOCK_SPECTRA_PLUGIN);
}

const DRY_RUN = process.argv.includes('--dry-run');
const STOCK = process.argv.includes('--stock-plugin');

function writeResult(result) {
  const outDir = path.join(PROJECT_ROOT, 'specs/176-swe-bench-verified-cross-cohort/verification');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'spike-result.md');
  const body = `---
feature: 176
artifact: spike-result
status: ${result.status}
source: ${result.source}
generatedAtIso: ${result.generatedAtIso}
---

# cohort 3 plugin-MCP spike 结果

- **status**: ${result.status}
- **pluginMcpCallCount**: ${result.pluginCallCount}
- **taskCallCount（spawn 的子代理数）**: ${result.taskCallCount ?? 'n/a'}
- **driverMcpCallCount**: ${result.driverCallCount}
- **subagentAttributable（plugin 调用在 Task 之后）**: ${result.subagentAttributable ?? 'n/a'}
- **globalSpectraPluginPresent（命名冲突风险）**: ${result.globalConflict ?? 'n/a'}
- **claudeVersion**: ${result.claudeVersion ?? 'n/a'}
- **source**: ${result.source}  ← synthetic/dry-run 不算真实验收 PASS（交接合同 C-3）
${result.rootCause ? `- **rootCause**: ${result.rootCause}\n` : ''}
## stdout 样本（截断）
\`\`\`
${(result.stdoutSample ?? '').slice(0, 1500)}
\`\`\`

## 判定（状态语义）
| status | 含义 | 下一步 |
|--------|------|--------|
| PASS_SUBAGENT | Task 子代理 + plugin MCP 都出现 → sub-agent 可达 plugin MCP（cohort3 真命题成立）| 解锁 Phase C |
| PASS_DRIVER_ONLY | 只有 driver 调到 plugin MCP，未 spawn 子代理 → 未证明 sub-agent | 调 prompt 重跑 / 查 transcript，**不解锁** |
| FAIL | 无 plugin-namespace 调用 → wiring 不通 | 走 FR-A-007c 升级（区分 harness/产品）|
| ERROR_INFRA | 401/超时/进程崩溃 → 非 wiring 问题 | 先修鉴权/超时再重跑，**不判 wiring** |

**当前判定**：${
  result.status === 'PASS_SUBAGENT'
    ? '✅ sub-agent 可达 plugin-namespace MCP → cohort 3 设计可行，解锁 Phase C。' + (result.subagentAttributable ? '' : '（顺序归因偏弱，建议 host 查子代理 .jsonl transcript 确证）')
    : result.status === 'PASS_DRIVER_ONLY'
    ? '⚠️ 仅证明 driver 可达，未证明 sub-agent。调整 prompt 重跑或查 transcript，暂不解锁 Phase C。'
    : result.status === 'ERROR_INFRA'
    ? '🟡 基础设施错误（鉴权/超时），非 wiring 结论。修复后重跑。'
    : '❌ wiring 不通 → 走 spec FR-A-007c：区分 (a) harness flag 问题 / (b) 产品不传播，升级用户拍板。'
}

> ⚠️ synthetic / dry-run 结果不写本文件（交接合同 C-3）；本文件存在即代表 host 真实跑过。
`;
  fs.writeFileSync(out, body, 'utf-8');
  return out;
}

async function main() {
  // 版本门禁（真实跑必过；评测要求 clean committed build → allowDirty:false）
  const distCli = path.join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
  const gate = verifySpectraVersion(distCli, { allowDirty: false });
  if (!gate.ok && !DRY_RUN) {
    console.error(`[spike] 版本门禁未过，拒绝跑：${gate.reason}`);
    process.exit(2);
  }
  console.error(`[spike] 版本门禁：${gate.ok ? 'PASS' : (DRY_RUN ? 'SKIP(dry-run)' : 'FAIL')} — ${gate.reason}`);

  if (DRY_RUN) {
    // 用 mock stream-json 验证解析逻辑（不调 claude）
    const mock = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__plugin_spectra_spectra__context' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__plugin_spectra_spectra__impact' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ].join('\n');
    const parsed = parsePluginMcpCalls(mock);
    const res = {
      status: parsed.pluginCallCount > 0 ? 'PASS' : 'FAIL',
      source: 'dry-run(synthetic)', generatedAtIso: new Date().toISOString(),
      pluginCallCount: parsed.pluginCallCount, driverCallCount: parsed.driverCallCount,
      stdoutSample: mock, rootCause: 'dry-run 仅验解析逻辑，不代表真实 wiring',
    };
    console.error(`[spike] --dry-run 解析: pluginCalls=${parsed.pluginCallCount} driverCalls=${parsed.driverCallCount}`);
    console.error('[spike] dry-run 不写 spike-result（避免 synthetic 冒充真实 PASS）');
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }

  // ===== 真实跑（host，需 claude OAuth）=====
  console.error('[spike] 准备 fixture（wtDir + spectra graph）…');
  const { wtDir } = prepareSpikeFixture({ distCli });

  const spectraPluginDir = STOCK ? STOCK_SPECTRA_PLUGIN : makeLocalSpectraPlugin(distCli);
  const globalConflict = detectGlobalSpectraPlugin();
  console.error(`[spike] spectra plugin: ${STOCK ? 'STOCK(已装,可能旧版)' : 'LOCAL(F177-F181 build)'} → ${spectraPluginDir}`);
  if (globalConflict && !STOCK) {
    console.error('[spike] ⚠️ 检测到全局已装 spectra plugin —— 与本地同名 "spectra" plugin 可能加载歧义（结果须结合此警示判读）。');
  }

  // CRITICAL-3：spike 目标是验证 SUB-AGENT 能否调 plugin MCP，不是 driver。
  // 故 prompt 显式要求：driver 自己不要调 spectra，必须 spawn 一个 Task 子代理，由子代理调用 MCP 工具。
  const prompt =
    `这是一个隔离的连通性测试。请严格按下面做，不要做别的：\n` +
    `1. **不要**自己直接调用任何 mcp__plugin_spectra_spectra__* 工具。\n` +
    `2. 用 Task 工具 spawn 一个 general-purpose 子代理。\n` +
    `3. 在子代理的指令里，要求它调用 mcp__plugin_spectra_spectra__context（参数指向 src/math.ts 或整库）` +
    `并把返回的结构化结果原样汇报回来。\n` +
    `4. 等子代理返回后，把子代理是否成功调用到该 MCP 工具、以及返回内容摘要告诉我。\n` +
    `（任务背景：${SPIKE_TASK_PROMPT}）`;
  const args = [
    '--print', '--model', 'claude-opus-4-7',
    '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    '--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions',
    '--plugin-dir', spectraPluginDir,
    '--plugin-dir', SPEC_DRIVER_PLUGIN,
    '--allowedTools',
    'mcp__plugin_spectra_spectra__context,mcp__plugin_spectra_spectra__impact,mcp__plugin_spectra_spectra__detect_changes,Read,Grep,Glob,Bash,Edit,Write,Task',
    prompt,
  ];
  console.error('[spike] 调 claude --print（强制 Task 子代理 → 子代理调 plugin spectra）…');
  const r = spawnSync('claude', args, { cwd: wtDir, encoding: 'utf-8', timeout: 1200000, maxBuffer: 64 * 1024 * 1024 });
  const stdout = r.stdout ?? '';
  const parsed = parsePluginMcpCalls(stdout);
  const verRun = spawnSync('claude', ['--version'], { encoding: 'utf-8' });

  // CRITICAL-2：先判进程是否真的成功，再看调用计数。401/timeout/maxBuffer 溢出归为 ERROR_INFRA，不混入 FAIL。
  const procOk = r.status === 0 && !r.signal && !r.error;
  const looks401 = /401|invalid authentication|unauthor/i.test(stdout + ' ' + (r.stderr ?? ''));
  let status, rootCause = null, subagentAttributable = false;
  if (!procOk || looks401) {
    status = 'ERROR_INFRA';
    rootCause = looks401
      ? 'claude 401 鉴权失败（host OAuth 未生效）—— 非 wiring 问题，先解决鉴权再重跑'
      : `claude 进程异常退出：status=${r.status} signal=${r.signal ?? ''} error=${r.error?.message ?? ''}（超时/maxBuffer/崩溃）`;
  } else if (parsed.pluginCallCount > 0 && parsed.taskCallCount > 0) {
    // 既有 Task 又有 plugin MCP 调用 → 子代理路径成立（弱归因：pluginAfterTask 更强）
    status = 'PASS_SUBAGENT';
    subagentAttributable = parsed.pluginAfterTask;
    rootCause = parsed.pluginAfterTask
      ? 'plugin MCP 调用出现在 Task 之后 → 归因子代理较可靠'
      : 'plugin MCP 与 Task 都出现但顺序不确定 → 建议 host 查子代理 .jsonl transcript 做确证';
  } else if (parsed.pluginCallCount > 0 && parsed.taskCallCount === 0) {
    // 有 plugin MCP 但没 spawn 子代理 → 只证明 driver 能访问，未证明 sub-agent（cohort3 真命题未达）
    status = 'PASS_DRIVER_ONLY';
    rootCause = 'driver 直接调了 plugin MCP 但未 spawn Task 子代理 → 只证明 driver 层可达，未证明 sub-agent；需调整 prompt 重跑或查 transcript';
  } else {
    status = 'FAIL';
    rootCause = parsed.driverCallCount > 0
      ? 'driver-namespace 有调用但 plugin-namespace 为 0 → plugin MCP 未以 plugin namespace 暴露'
      : '完全无 plugin spectra 调用 → 检查 plugin-dir 是否加载、子代理是否真的能访问 plugin MCP';
  }

  const result = {
    status,
    source: STOCK ? 'host(stock-plugin)' : 'host(local-build)',
    generatedAtIso: new Date().toISOString(),
    pluginCallCount: parsed.pluginCallCount, driverCallCount: parsed.driverCallCount, taskCallCount: parsed.taskCallCount,
    subagentAttributable, globalConflict,
    claudeVersion: (verRun.stdout ?? '').trim(), stdoutSample: stdout, rootCause,
  };
  const outPath = writeResult(result);
  console.error(`[spike] 结果: ${status} (plugin=${parsed.pluginCallCount}, task=${parsed.taskCallCount}, driver=${parsed.driverCallCount}) → ${outPath}`);
  // 仅 PASS_SUBAGENT 视为 spike 通过解锁 Phase C；其余非 0 退出
  if (status !== 'PASS_SUBAGENT') process.exit(3);
}

// 仅在作为主模块直接运行时执行（被单测 import parsePluginMcpCalls 时不触发 claude 调用）
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((e) => { console.error('[spike] 异常:', e.message); process.exit(1); });
}
