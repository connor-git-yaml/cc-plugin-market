#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { isInvokedDirectly } from './lib/is-invoked-directly.mjs';

// Feature 265（G0-4，FR-020 ~ FR-022）— Spectra MCP 工具 adoption census。
//
// 只做一件事：只读扫描本机已有的 agent transcript，按工具名聚合 `mcp__*spectra*` 的调用次数，
// 输出调用分布 + 零调用清单到 **stdout**。
//
// ## 三条刻意的不做（FR-021 / FR-022，YAGNI）
//
// 1. **不写文件**——脚本里没有任何写路径。这就是"原始 dump 不入库"的架构性保证：
//    不存在"忘了 gitignore"的风险面。要留存结果自行重定向到不受版本控制的位置。
// 2. **不做可插拔数据源抽象 / 可视化 / 历史存储 / 自动告警**——两个数据源硬编码，
//    只留一个测试用的目录覆盖入口。
// 3. **不产出结论**——本卡只交付尺子。实际数字由发布后一周的 milestone-next 回收（FR-025）。
//
// ## 它覆盖不了什么（诚实边界，勿把它当 F241 口径的替代品）
//
// 本脚本只覆盖"调用次数"这一个可脚本化维度。F241 冻结口径里的 M-1（grounding 命中率手工记账）
// 与 M-3（review 发现率人工判真伪）本质是人工协议，**不可能**被本脚本或任何自动化替代，
// 见 `docs/design/f265-graph-quality-rerun-plan.md`。
//
// ## schema 猜错的代价被限制在"漏统计"而非"崩溃"
//
// 两个数据源的 JSONL 内部结构都不是我们的合同（是 Claude Code / Codex CLI 的内部产物，
// 会随客户端版本变）。因此逐行 try/catch、字段缺失即跳过该行，绝不抛未捕获异常。
// Codex 侧的字段路径经本卡对真实样本实测确认（见下方 extractCodexToolCalls 注释），
// 不照抄 Claude 侧假设两者一致。
//
// ⚠️ 这条"绝不抛异常"的承诺**在行长维度上是有条件的**（对抗审查 W-5）：逐行缓冲天然无界，
// 一个 40MB 无换行的文件会把整行读进内存（实测 560MB RSS）。因此 `pending` 设了硬上限，
// 超限即丢弃该行并计入 `unparsableLines` —— 承诺兑现的方式是"丢一行"，不是"能扛任意行"。
//
// ## 默认不吐第三方名字（W-4）
//
// 扫描面是**全机**所有 agent transcript，unknown 桶里装的是别人的 MCP server / 工具名，
// 可能带客户标识、UUID connector、乃至被注入的构造文本。逐名清单只在 `--verbose` 下输出，
// 且过白名单字符 + 截断；默认输出只有聚合计数。路径同理走 `~` 相对形式。

const DEFAULT_CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const DEFAULT_CODEX_DIR = path.join(os.homedir(), '.codex', 'sessions');

// 两种命名空间都要认：
// - `mcp__plugin_spectra_spectra__*` 是 Claude Code plugin 环境下的规范命名（F170a 修复后的形态）
// - `mcp__spectra__*` 是非插件化直连 / 历史场景下的形态
// 捕获组即规范化后的工具短名，两种前缀聚合到同一个桶。
const SPECTRA_TOOL_RE = /^mcp__(?:plugin_spectra_spectra|spectra)__(.+)$/;
const ANY_MCP_TOOL_RE = /^mcp__/;

// 本卡冻结时 MCP server 对外注册的 17 个分析面工具。
// `server_build_info`（F265 Batch 3 新增的自省工具）**刻意不计入**：它是 doctor 的内部消费面，
// 不是用户采用率信号，计进分母会把 adoption 指标稀释成噪声。它若出现在 transcript 里会落进
// unknown 桶（计数恒可见；名字需 `--verbose` 才逐条列出），不会被静默丢弃。
const KNOWN_TOOLS = Object.freeze([
  'prepare',
  'generate',
  'batch',
  'diff',
  'panoramic-query',
  'detect_changes',
  'impact',
  'context',
  'view_file',
  'search_in_file',
  'list_directory',
  'graph_query',
  'graph_node',
  'graph_path',
  'graph_community',
  'graph_god_nodes',
  'graph_hyperedges',
]);

function parseArgs(argv) {
  const out = {
    claudeDir: DEFAULT_CLAUDE_DIR,
    codexDir: DEFAULT_CODEX_DIR,
    pretty: true,
    verbose: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--claude-dir=')) out.claudeDir = arg.slice('--claude-dir='.length);
    else if (arg.startsWith('--codex-dir=')) out.codexDir = arg.slice('--codex-dir='.length);
    else if (arg === '--compact') out.pretty = false;
    else if (arg === '--verbose') out.verbose = true;
  }
  return out;
}

/**
 * 家目录 → `~` 前缀（W-4）。输出会被贴进 report / issue / chat，绝对路径里的用户名
 * 是无谓的泄漏面；`~` 形式对读者的信息量完全等价。
 */
function toHomeRelative(p) {
  if (typeof p !== 'string') return p;
  const home = os.homedir();
  if (home.length === 0) return p;
  if (p === home) return '~';
  const prefix = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
  return p.startsWith(prefix) ? `~${path.sep}${p.slice(prefix.length)}` : p;
}

/** verbose 下工具名的受限形态：白名单字符 + 截断（W-4） */
const NAME_ALLOWED_RE = /[^A-Za-z0-9_-]/g;
const NAME_MAX_LEN = 64;

/**
 * 把一个第三方工具名压成可安全打印的形态。
 *
 * 白名单之外的字符**直接删除**（不是替换成占位符）：目的是让任何构造出来的
 * 控制序列 / 换行 / 引号在输出里不可能成形。压过之后的名字可能与原串不同，
 * 因此同时给出 `nameSanitized` 位——静默改写一个名字再当成事实呈现，
 * 本身就是另一种不诚实。
 */
function sanitizeToolName(name) {
  const filtered = String(name).replace(NAME_ALLOWED_RE, '').slice(0, NAME_MAX_LEN);
  return { name: filtered, nameSanitized: filtered !== name };
}

/** `mcp__<server>__<tool>` 里的 server 段；取不到 → null（只用于聚合计数） */
function serverSegmentOf(name) {
  const match = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(String(name));
  return match ? match[1] : null;
}

/** 递归收集 `.jsonl`。目录不存在 / 不可读一律返回已收集到的部分，不抛。 */
function collectJsonlFiles(rootDir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    // 不跟随 symlink：避免软链成环导致无限递归（isDirectory() 对 symlink 返回 false）。
    if (entry.isDirectory()) collectJsonlFiles(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) acc.push(full);
  }
  return acc;
}

/**
 * 从一条 Claude Code transcript 行里抽 MCP 工具调用。
 * 实测形态：`{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name }] } }`。
 * @returns {Array<{name: string, callId: string|null}>}
 */
function extractClaudeToolCalls(record) {
  const content = record?.message?.content;
  if (!Array.isArray(content)) return [];
  const calls = [];
  for (const block of content) {
    if (block?.type === 'tool_use' && typeof block.name === 'string') {
      calls.push({ name: block.name, callId: typeof block.id === 'string' ? block.id : null });
    }
  }
  return calls;
}

/**
 * 从一条 Codex CLI rollout 行里抽 MCP 工具调用。
 *
 * 本卡对真实 `~/.codex/sessions/**\/*.jsonl` 样本实测确认的两条路径（**不是**照抄 Claude 侧假设）：
 *  1. `{ type:'event_msg', payload:{ type:'mcp_tool_call_end', call_id, invocation:{ server, tool } } }`
 *     —— Codex 把 server 与 tool 拆成两个字段，不是 `mcp__server__tool` 扁平名，这里按同一规则重组。
 *     只认 `_end` 不认 `_begin`，避免一次调用被计两次。
 *  2. `{ type:'response_item', payload:{ type:'function_call', name, call_id } }`
 *     —— 扁平函数名，少数情况下会是 `mcp__*` 形态。
 * 任何一条路径的字段缺失都只影响那一条记录，不影响整体。
 * @returns {Array<{name: string, callId: string|null}>}
 */
function extractCodexToolCalls(record) {
  const payload = record?.payload;
  if (payload === null || typeof payload !== 'object') return [];

  if (record.type === 'event_msg' && payload.type === 'mcp_tool_call_end') {
    const server = payload.invocation?.server;
    const tool = payload.invocation?.tool;
    if (typeof server !== 'string' || typeof tool !== 'string') return [];
    return [
      {
        name: `mcp__${server}__${tool}`,
        callId: typeof payload.call_id === 'string' ? payload.call_id : null,
      },
    ];
  }

  if (record.type === 'response_item' && payload.type === 'function_call') {
    if (typeof payload.name !== 'string') return [];
    return [
      {
        name: payload.name,
        callId: typeof payload.call_id === 'string' ? payload.call_id : null,
      },
    ];
  }

  return [];
}

/**
 * JSONL 按 `\n` 逐行流式扫描。
 *
 * **刻意不用 `node:readline`**：它把 U+2028（LINE SEPARATOR）/ U+2029（PARAGRAPH SEPARATOR）
 * 也当行终止符，而这两个码位在 JSON 字符串里是**合法的裸字符**——本机真实 transcript 实测
 * 命中（279 条记录被 readline 从中间劈开，随后 JSON.parse 必然失败而被整条丢弃）。
 * JSONL 的行分隔符只有 `\n`，这里就只按 `\n` 切，并容忍 `\r\n`。
 *
 * `createReadStream` 设了 encoding 后内部走 StringDecoder，多字节字符不会在 chunk 边界被劈开。
 *
 * 🔴 行长有界（W-5）：`pending` 超过 `MAX_PENDING_CHARS` 即判定"这一行长得不像 transcript"，
 * 丢弃它、计一次 `unparsableLines`、重置缓冲，并**继续丢弃**直到遇见下一个 `\n`
 * （否则那一行的残余会被当成一条新行，同一行被反复计数）。
 */
const MAX_PENDING_CHARS = 8 * 1024 * 1024;

async function scanFile(filePath, extractCalls, state) {
  let stream;
  try {
    stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  } catch {
    state.unreadableFiles += 1;
    return;
  }

  const handleLine = (raw) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() === '') return;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      // schema 猜错 / 半截行 / 二进制噪声 → 跳过该行，不崩溃、不误计。
      state.unparsableLines += 1;
      return;
    }
    let calls;
    try {
      calls = extractCalls(record);
    } catch {
      state.unparsableLines += 1;
      return;
    }
    for (const call of calls) {
      if (!ANY_MCP_TOOL_RE.test(call.name)) continue;
      // 同一次调用可能因 session resume / sidechain 在多个文件里重复出现；有 id 时按 id 去重。
      if (call.callId !== null) {
        if (state.seenCallIds.has(call.callId)) continue;
        state.seenCallIds.add(call.callId);
      }
      const match = SPECTRA_TOOL_RE.exec(call.name);
      if (match) {
        const shortName = match[1];
        if (KNOWN_TOOLS.includes(shortName)) {
          state.spectraCounts.set(shortName, (state.spectraCounts.get(shortName) ?? 0) + 1);
        } else {
          // 冻结清单之外的 spectra 短名：按 transcript 原始全名记账（I-2）
          state.unrecognizedSpectraCounts.set(
            call.name,
            (state.unrecognizedSpectraCounts.get(call.name) ?? 0) + 1,
          );
        }
      } else {
        state.unknownCounts.set(call.name, (state.unknownCounts.get(call.name) ?? 0) + 1);
      }
    }
  };

  let pending = '';
  // 超长行丢弃中：残余部分要一路丢到下一个换行符为止
  let discardingOverlongLine = false;
  try {
    for await (const chunk of stream) {
      pending += chunk;
      for (;;) {
        const nl = pending.indexOf('\n');
        if (discardingOverlongLine) {
          if (nl === -1) {
            pending = '';
            break;
          }
          pending = pending.slice(nl + 1);
          discardingOverlongLine = false;
          continue;
        }
        if (nl === -1) {
          if (pending.length > MAX_PENDING_CHARS) {
            state.unparsableLines += 1;
            pending = '';
            discardingOverlongLine = true;
          }
          break;
        }
        handleLine(pending.slice(0, nl));
        pending = pending.slice(nl + 1);
      }
    }
    // 文件末尾没有换行符时的最后一行；正在丢弃超长行则不再处理（已计过数）
    if (!discardingOverlongLine) handleLine(pending);
  } catch {
    state.unreadableFiles += 1;
  } finally {
    stream.destroy();
  }
}

/**
 * 跑一次 census。
 * @param {{claudeDir?: string, codexDir?: string, verbose?: boolean}} [options]
 *        `verbose` 为真才输出 unknown 桶的逐名清单（默认只给聚合计数，见头注释 W-4）
 * @returns {Promise<object>} AdoptionCensusOutput
 */
export async function runCensus(options = {}) {
  const claudeDir = options.claudeDir ?? DEFAULT_CLAUDE_DIR;
  const codexDir = options.codexDir ?? DEFAULT_CODEX_DIR;
  const verbose = options.verbose === true;
  // 🔴 `~` 相对化只作用于**输出**：所有文件系统操作必须用原始绝对路径。
  // 把相对化后的串喂回 statSync 会让 sourceStatus 恒 not-found（`~` 不会被 shell 展开），
  // 于是"扫到了 200 次调用"和"目录根本不存在"可以同时成立。
  const scanDirs = [claudeDir, codexDir];
  const sourceDirs = scanDirs.map(toHomeRelative);

  const claudeFiles = collectJsonlFiles(claudeDir);
  const codexFiles = collectJsonlFiles(codexDir);

  const anyDirExists = scanDirs.some((d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });

  const state = {
    spectraCounts: new Map(),
    unrecognizedSpectraCounts: new Map(),
    unknownCounts: new Map(),
    seenCallIds: new Set(),
    unparsableLines: 0,
    unreadableFiles: 0,
  };

  for (const f of claudeFiles) await scanFile(f, extractClaudeToolCalls, state);
  for (const f of codexFiles) await scanFile(f, extractCodexToolCalls, state);

  let sourceStatus;
  if (!anyDirExists) sourceStatus = 'not-found';
  else if (claudeFiles.length + codexFiles.length === 0) sourceStatus = 'empty';
  else sourceStatus = 'found';

  const tools = KNOWN_TOOLS.map((name) => ({
    name,
    callCount: state.spectraCounts.get(name) ?? 0,
  }));

  // 已识别为 spectra 命名空间、但不在冻结的 17 个已知工具里的短名（例如工具被改名或新增），
  // 单独列出而非静默并入 unknown——否则"新增了工具但没人调"和"工具名漂移了"分不开。
  // 🔴 I-2：保留 transcript 里的**原始全名**。此前统一重写成 `mcp__spectra__<短名>`，
  // 而漂移证据恰恰在前缀上（`mcp__plugin_spectra_spectra__` vs `mcp__spectra__`）——
  // 归一化掉它等于把要找的东西擦掉了。
  const unrecognizedSpectraTools = [...state.unrecognizedSpectraCounts.entries()]
    .map(([name, callCount]) => ({ name, callCount }))
    .sort((a, b) => b.callCount - a.callCount || a.name.localeCompare(b.name));

  const unknownDetail = [...state.unknownCounts.entries()]
    .map(([name, callCount]) => ({ name, callCount }))
    .sort((a, b) => b.callCount - a.callCount || a.name.localeCompare(b.name));

  const allUnknown = [...unrecognizedSpectraTools, ...unknownDetail];
  const unknownTotal = allUnknown.reduce((sum, t) => sum + t.callCount, 0);

  // 未识别的调用归入独立 unknown 桶而非丢弃（FR-020）。
  tools.push({ name: 'unknown', callCount: unknownTotal });

  const unknownServers = new Set();
  for (const t of allUnknown) {
    const server = serverSegmentOf(t.name);
    if (server !== null) unknownServers.add(server);
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceDirs,
    sourceStatus,
    tools,
    zeroCallTools: tools.filter((t) => t.name !== 'unknown' && t.callCount === 0).map((t) => t.name),
    // 默认只给聚合：unknown 桶里的名字来自全机第三方 transcript（W-4）
    unknownCallCount: unknownTotal,
    unknownToolCount: allUnknown.length,
    unknownServerCount: unknownServers.size,
    // 逐名清单只在 --verbose 下给出，且名字过白名单 + 截断；非 verbose 时恒为 null
    // （给 `null` 而不是省略键，读者才能一眼看出"这里被折叠了"而非"这里没有数据"）
    unknownDetail: verbose
      ? allUnknown.map((t) => ({ ...sanitizeToolName(t.name), callCount: t.callCount }))
      : null,
    scanned: {
      claudeFiles: claudeFiles.length,
      codexFiles: codexFiles.length,
      unparsableLines: state.unparsableLines,
      unreadableFiles: state.unreadableFiles,
    },
  };
}

function statusHint(result) {
  if (result.sourceStatus === 'not-found') {
    return `两个数据源目录均不存在（${result.sourceDirs.join(' / ')}）——本机没有可扫描的 transcript，属正常情形，不是错误。`;
  }
  if (result.sourceStatus === 'empty') {
    return `数据源目录存在但没有任何 .jsonl（${result.sourceDirs.join(' / ')}）——无可统计样本，不是错误。`;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runCensus({
    claudeDir: args.claudeDir,
    codexDir: args.codexDir,
    verbose: args.verbose,
  });
  const hint = statusHint(result);
  if (hint !== null) console.error(`! ${hint}`);
  console.log(JSON.stringify(result, null, args.pretty ? 2 : 0));
}

// 直接执行时跑 main；被 import（测试）时只暴露 runCensus。
// 用 F246 收敛出来的共享守卫（裸词法比较挡不住 symlink 入口，会静默空转）。
if (isInvokedDirectly(import.meta.url)) {
  main().catch((err) => {
    console.error(`adoption-census 失败：${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
