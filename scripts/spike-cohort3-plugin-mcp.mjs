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
import { prepareSpikeFixture } from './lib/spike-fixture-prep.mjs';
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
  // 子代理归因（强信号，替代脆弱的"顺序"启发）：plugin MCP 调用所在事件带非空
  // parent_tool_use_id ⇒ 该调用发生在 Task 子代理上下文里（claude stream-json 用
  // parent_tool_use_id 把子代理活动挂到父 Task）。
  let subagentPluginCallCount = 0;
  // codex CRITICAL 修复：调用"被发起"≠"成功返回"。跟踪 plugin tool_use 的 id，
  // 匹配后续 tool_result：is_error!==true 且 content 非空才算一次成功返回。
  const pluginToolUseIds = new Set();
  let pluginResultOkCount = 0;
  let pluginResultErrorCount = 0;
  // result 事件（权威成功判定，不要正则扫整段 stdout）
  let resultEvent = null;
  for (const line of String(stdout).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let evt;
    try { evt = JSON.parse(t); } catch { continue; }
    if (evt.type === 'result') {
      resultEvent = { subtype: evt.subtype ?? null, isError: evt.is_error ?? null, apiErrorStatus: evt.api_error_status ?? null };
    }
    const lineHasParent = typeof evt.parent_tool_use_id === 'string' && evt.parent_tool_use_id.length > 0;
    for (const node of collectToolNodes(evt)) {
      if (node.kind === 'tool_use') {
        const name = node.name;
        if (name.startsWith(PLUGIN_NS_PREFIX)) {
          pluginCalls.push(name);
          if (node.id) pluginToolUseIds.add(node.id);
          if (lineHasParent) subagentPluginCallCount++;
        } else if (name.startsWith(DRIVER_NS_PREFIX)) {
          driverCalls.push(name);
        } else if (name === 'Task') {
          taskCalls.push(name);
        }
      } else if (node.kind === 'tool_result' && node.toolUseId && pluginToolUseIds.has(node.toolUseId)) {
        if (node.isError === true || node.contentEmpty) pluginResultErrorCount++;
        else pluginResultOkCount++;
      }
    }
  }
  return {
    pluginCalls, driverCalls, taskCalls,
    pluginCallCount: pluginCalls.length,
    driverCallCount: driverCalls.length,
    taskCallCount: taskCalls.length,
    subagentPluginCallCount,
    pluginResultOkCount,
    pluginResultErrorCount,
    resultEvent,
    anySpectra: pluginCalls.length + driverCalls.length > 0,
  };
}

/** 全递归：遍历事件任意层级，收集 tool_use（name+id）与 tool_result（tool_use_id+is_error+content 空判）。 */
function collectToolNodes(evt) {
  const nodes = [];
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (node.type === 'tool_use' && typeof node.name === 'string') {
      nodes.push({ kind: 'tool_use', name: node.name, id: typeof node.id === 'string' ? node.id : null });
    } else if (node.type === 'tool_result' && typeof node.tool_use_id === 'string') {
      const c = node.content;
      const contentEmpty = c == null || (typeof c === 'string' && c.trim() === '') || (Array.isArray(c) && c.length === 0);
      nodes.push({ kind: 'tool_result', toolUseId: node.tool_use_id, isError: node.is_error === true, contentEmpty });
    }
    for (const v of Array.isArray(node) ? node : Object.values(node)) {
      if (v && typeof v === 'object') visit(v);
    }
  };
  visit(evt);
  return nodes;
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
- **pluginResultOk/Error（tool_result 真实返回校验）**: ${result.pluginResultOkCount ?? 'n/a'} / ${result.pluginResultErrorCount ?? 'n/a'}
- **taskCallCount（spawn 的子代理数）**: ${result.taskCallCount ?? 'n/a'}
- **driverMcpCallCount**: ${result.driverCallCount}
- **subagentAttributable（plugin 调用在 Task 之后）**: ${result.subagentAttributable ?? 'n/a'}
- **globalSpectraPluginPresent（命名冲突风险）**: ${result.globalConflict ?? 'n/a'}
- **spectraSource（spike 实际用的 plugin）**: ${result.spectraSource ?? 'n/a'}
- **claudeVersion**: ${result.claudeVersion ?? 'n/a'}
- **source**: ${result.source}  ← synthetic/dry-run 不算真实验收 PASS（交接合同 C-3）
- **exitStatus**: ${result.exitStatus ?? 'n/a'}  **exitSignal**: ${result.exitSignal ?? 'n/a'}
${result.rootCause ? `- **rootCause**: ${result.rootCause}\n` : ''}
## claude stderr 样本（诊断关键，截断末 1500）
\`\`\`
${(result.stderrSample ?? '').slice(-1500) || '(空)'}
\`\`\`

## stdout 样本（截断）
\`\`\`
${(result.stdoutSample ?? '').slice(0, 1200)}
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

  // 重名冲突规避（首跑 ERROR_INFRA status=1 根因假设）：spectra + spec-driver 都已全局安装，
  // 再用 --plugin-dir 加同名 plugin 会重名冲突让 claude 崩溃。策略：
  //   - 默认：若全局已装 spectra（已启用，其 hook 已触发）→ 直接用全局，不加 --plugin-dir（无冲突）。
  //     这测的是 Q1「plugin-namespace MCP 是否传播到 --print sub-agent」（用旧 build 也成立）。
  //   - --local-spectra：强制用本地 F177-F181 临时 plugin（需先禁用全局 spectra，否则仍冲突）。
  //   - spec-driver 不需要：spike 用通用 Task 子代理测传播，不跑 spec-driver workflow（再去掉一个冲突源）。
  const globalConflict = detectGlobalSpectraPlugin();
  const FORCE_LOCAL = process.argv.includes('--local-spectra');
  const pluginDirArgs = [];
  let spectraSource;
  if (FORCE_LOCAL || !globalConflict) {
    const dir = makeLocalSpectraPlugin(distCli);
    pluginDirArgs.push('--plugin-dir', dir);
    spectraSource = 'local-build(F177-F181)';
    console.error(`[spike] spectra: LOCAL build → ${dir}`);
    if (globalConflict && FORCE_LOCAL) {
      console.error('[spike] ⚠️ --local-spectra 但全局 spectra 仍在 → 仍可能重名冲突；建议先禁用全局 spectra plugin 再跑。');
    }
  } else {
    spectraSource = 'global-stock(可能旧build；仅验 Q1 传播)';
    console.error('[spike] spectra: 用全局已启用 plugin（避免重名冲突）。验 Q1 传播，非 F177-F181 build；新 build 接线留待 Phase C。');
  }

  // CRITICAL-3：spike 目标是验证 SUB-AGENT 能否调 plugin MCP，不是 driver。
  // 故 prompt 显式要求：driver 自己不要调 spectra，必须 spawn 一个 Task 子代理，由子代理调用 MCP 工具。
  const prompt =
    `这是一个**专门测试 Task 子代理机制**的隔离连通性测试。测试目标：验证你 spawn 的子代理能否访问 ` +
    `mcp__plugin_spectra_spectra__* 这组 MCP 工具。规则（违反即测试无效）：\n` +
    `1. 你（主代理）**绝对不要**自己直接调用任何 mcp__plugin_spectra_spectra__* / Read / Grep 工具。` +
    `如果你自己做了，本测试就失败——必须通过子代理完成。\n` +
    `2. 你唯一要做的：用 **Task 工具** spawn 一个 general-purpose 子代理（这一步是被测对象，必须真的调用 Task 工具）。\n` +
    `3. 子代理的指令写明：调用 mcp__plugin_spectra_spectra__context 查询本仓库 src/math.ts 里的 add 符号` +
    `（该 MCP 入参是 symbolId，形如 "src/math.ts::add"，可先在子代理里 Read 确认），把返回结构原样带回。\n` +
    `4. 子代理返回后，你只转述：子代理是否成功调到该 MCP、返回了哪些字段。\n` +
    `再次强调：主代理不得自己调 MCP，必须委派给 Task 子代理——这正是本测试要验证的链路。`;
  // prompt 走 stdin（不作位置参数）——因为 --allowedTools 是 variadic，会把末尾 prompt 当成 tool 名吃掉，
  // 导致 "Input must be provided through stdin or as a prompt argument"。能跑通的 1-liner 也是 stdin 喂 prompt。
  const args = [
    '--print', '--model', 'claude-opus-4-7',
    '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    '--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions',
    ...pluginDirArgs,
    '--allowedTools',
    'mcp__plugin_spectra_spectra__context,mcp__plugin_spectra_spectra__impact,mcp__plugin_spectra_spectra__detect_changes,Read,Grep,Glob,Bash,Edit,Write,Task',
  ];
  console.error('[spike] 调 claude --print（prompt 走 stdin；强制 Task 子代理 → 子代理调 plugin spectra）…');
  console.error(`[spike] args: claude ${args.join(' ')} (prompt via stdin)`);
  const r = spawnSync('claude', args, { cwd: wtDir, input: prompt, encoding: 'utf-8', timeout: 1200000, maxBuffer: 64 * 1024 * 1024 });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  const parsed = parsePluginMcpCalls(stdout);
  const verRun = spawnSync('claude', ['--version'], { encoding: 'utf-8' });
  // 把完整 stdout/stderr 落到 gitignored 评测树，便于诊断（不入库）
  try {
    const diagDir = path.join(PROJECT_ROOT, 'tests/baseline/swe-bench-verified/spike-diag');
    fs.mkdirSync(diagDir, { recursive: true });
    fs.writeFileSync(path.join(diagDir, 'spike-stdout.log'), stdout);
    fs.writeFileSync(path.join(diagDir, 'spike-stderr.log'), stderr);
    console.error(`[spike] 完整 stdout/stderr → ${path.relative(PROJECT_ROOT, diagDir)}/`);
  } catch { /* 诊断落盘失败不阻断 */ }
  if (stderr.trim()) console.error(`[spike] claude stderr（末 800）:\n${stderr.slice(-800)}`);

  // CRITICAL-2：用权威 result 事件判进程成功（不再正则扫 stdout —— 之前 UUID 里的 "401"
  // 子串导致误判 ERROR_INFRA）。result.subtype=success & !is_error & api_error_status=null 才算成功。
  const res = parsed.resultEvent;
  const procOk = r.status === 0 && !r.signal && !r.error
    && res && res.subtype === 'success' && res.isError === false && !res.apiErrorStatus;
  let status, rootCause = null, subagentAttributable = false;
  if (!procOk) {
    status = 'ERROR_INFRA';
    if (!res) rootCause = `无 result 事件（进程未正常产出）：exitStatus=${r.status} signal=${r.signal ?? ''} error=${r.error?.message ?? ''}`;
    else if (res.isError || res.apiErrorStatus) rootCause = `result 报错：is_error=${res.isError} api_error_status=${res.apiErrorStatus}`;
    else rootCause = `进程异常：exitStatus=${r.status} signal=${r.signal ?? ''}`;
  } else if (parsed.pluginCallCount > 0 && parsed.subagentPluginCallCount > 0 && parsed.pluginResultOkCount > 0) {
    // plugin MCP 调用带 parent_tool_use_id（Task 子代理上下文）且 ≥1 次 tool_result 成功返回
    // （codex CRITICAL：调用被发起≠成功，必须校验 tool_result 非 error 非空）→ 强证 sub-agent 可达
    status = 'PASS_SUBAGENT';
    subagentAttributable = true;
    rootCause = `plugin MCP 子代理上下文调用 ${parsed.subagentPluginCallCount} 次，tool_result 成功 ${parsed.pluginResultOkCount} 次（error ${parsed.pluginResultErrorCount} 次）→ 子代理可达且真实返回数据（强归因）`;
  } else if (parsed.pluginCallCount > 0 && parsed.subagentPluginCallCount > 0) {
    // 子代理上下文调用了但没有任何成功 tool_result → 工具被调到但全部报错/空返回，不算通
    status = 'FAIL';
    rootCause = `plugin MCP 在子代理上下文被调用 ${parsed.subagentPluginCallCount} 次但 tool_result 成功 0 次（error ${parsed.pluginResultErrorCount} 次）→ 工具可被发起但未真实返回数据（检查 MCP server 启动/工具实现）`;
  } else if (parsed.pluginCallCount > 0) {
    // plugin MCP 可达但无 parent_tool_use_id → driver 直接调，未证明 sub-agent
    status = 'PASS_DRIVER_ONLY';
    rootCause = `plugin MCP 在 --print 下可达（tool_result 成功 ${parsed.pluginResultOkCount} 次），但调用无 parent_tool_use_id${parsed.taskCallCount > 0 ? `（虽见 Task 调用 ${parsed.taskCallCount} 次，plugin 调用不在其上下文）` : '、未见 Task'} ⇒ 是 driver 直接调，未证明 sub-agent（模型自述"子代理"不可信，Codex CRITICAL-3）。最大风险（plugin MCP 在 --print 完全不可用）已排除；sub-agent 路径建议用真实 spec-driver workflow 验证（smoke 即覆盖）。`;
  } else {
    status = 'FAIL';
    rootCause = parsed.driverCallCount > 0
      ? 'driver-namespace 有调用但 plugin-namespace 为 0 → plugin MCP 未以 plugin namespace 暴露'
      : '完全无 plugin spectra 调用 → 检查 plugin-dir 是否加载、子代理是否真的能访问 plugin MCP';
  }

  const result = {
    status,
    // codex WARNING 修复：source 只表达"真实 host 跑"（vs synthetic）；实际用的 plugin 看 spectraSource，
    // 之前 source 由 --stock-plugin flag 推导会与默认分支实际用全局 plugin 时矛盾
    source: 'host',
    generatedAtIso: new Date().toISOString(),
    pluginCallCount: parsed.pluginCallCount, driverCallCount: parsed.driverCallCount, taskCallCount: parsed.taskCallCount,
    subagentPluginCallCount: parsed.subagentPluginCallCount,
    pluginResultOkCount: parsed.pluginResultOkCount, pluginResultErrorCount: parsed.pluginResultErrorCount,
    subagentAttributable, globalConflict, spectraSource,
    resultSubtype: parsed.resultEvent?.subtype ?? null,
    exitStatus: r.status, exitSignal: r.signal ?? null,
    claudeVersion: (verRun.stdout ?? '').trim(), stdoutSample: stdout, stderrSample: stderr, rootCause,
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
