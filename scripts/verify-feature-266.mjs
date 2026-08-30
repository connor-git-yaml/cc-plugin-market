#!/usr/bin/env node
/**
 * Feature 266 — 独立验收脚本（SC-003 / SC-006 / FR-014）
 *
 * 两种模式：
 *
 * ① `--mode byte-stable --target <path>`（SC-006 / FR-014）
 *    同一 target 上连续两次跑 `spectra batch --mode graph-only`，比较两次 graph.json 的
 *    sha256。本卡不改 producer，预期恒等——但"预期不改"与"实际没改"是两回事，必须实跑。
 *    不一致时定位并打印**首个**差异的 JSON path（只给第一个：差异往往成片出现，全量打印
 *    会把真正的起点淹没）。
 *
 * ② `--mode mcp-ab --target <path> --before <graph.json> --after <graph.json> --symbols <list.json>`
 *    （SC-003）逐符号对比 `impact` / `context` / `detect_changes` 在改动前后两份图上的
 *    结果集合，唯一允许的 diff 是新增 `honesty` 键。任何 affected / callers / callees /
 *    topImpacted 元素级差异都判失败。
 *
 * 用法：
 *   npm run build
 *   node scripts/verify-feature-266.mjs --help
 *   node scripts/verify-feature-266.mjs --mode byte-stable --target .
 *   node scripts/verify-feature-266.mjs --mode mcp-ab --target . \
 *     --before /tmp/f266-before.json --after /tmp/f266-after.json --symbols /tmp/f266-symbols.json
 *
 * 退出码：
 *   0 = 该模式的判据全部通过
 *   1 = 判据未通过（发现差异）
 *   2 = 参数错误 / 前置条件不满足（无法完成判定）
 *   3 = 核心比对逻辑尚未实现（T002 骨架态；T017 补全后不再出现）
 *
 * T017 已补全两种模式的核心比对；exit 3 保留为"判定不可达"的诚实出口（如 dist 缺失），
 * 绝不把"跑不成"渲染成"通过"——那正是本卡要根治的那类失真。
 *
 * ## mcp-ab 的能力边界（如实登记，勿当成它没做的事做过了）
 *
 * 本脚本**不执行改动前的那一版二进制**：那需要 checkout / 另建 worktree，属交付流程的权限，
 * 不属验收脚本。它验的是两件可在当前进程内证伪的事：
 *   (a) **结果集不随图快照以外的因素漂移**——同一份代码在 `--before` / `--after` 两份 graph.json
 *       上跑出的 `affected`/`callers`/`callees`/`topImpacted` 必须逐元素相等（两份图相同即
 *       determinism 验证；两份图不同则是真 A/B）；
 *   (b) **追加式兼容**——去掉 `honesty` 后的顶层键集合必须与冻结的 F155/F170c 契约键集合完全一致。
 *       少一个键 / 改一个名 / 多一个 `honesty` 以外的新键，都判失败。
 * (b) 才是"既有消费方零影响"的承重判据：它锚定的是改动前就已冻结的契约，不依赖旧二进制在场。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const EXIT_OK = 0;
const EXIT_MISMATCH = 1;
const EXIT_USAGE = 2;
const EXIT_NOT_IMPLEMENTED = 3;

const SUPPORTED_MODES = ['byte-stable', 'mcp-ab'];

const USAGE = `用法：node scripts/verify-feature-266.mjs --mode <mode> [options]

Modes:
  byte-stable   同一 target 连续两次 \`spectra batch --mode graph-only\`，比较 graph.json sha256
  mcp-ab        逐符号对比改动前后两份图上 impact/context/detect_changes 的结果集合

Options:
  --mode <mode>       byte-stable | mcp-ab（必填）
  --target <path>     被验证的项目根目录（必填，两种模式都需要 git 上下文）
  --before <file>     mcp-ab：改动前的 graph.json
  --after <file>      mcp-ab：改动后的 graph.json
  --symbols <file>    mcp-ab：symbol id 清单 JSON（数组，或 { symbols: [...] }）
  --out <file.json>   验证摘要写入此文件（默认仅 stdout）
  --help, -h          显示此帮助

退出码:
  0 = 判据全部通过
  1 = 发现差异（判据未通过）
  2 = 参数错误 / 前置条件不满足
  3 = 判定不可达（如 dist 缺失 / 建图失败），绝不当作通过`;

/** 解析 argv；`--help` 直接打印用法并 exit 0，其余错误交给调用方按 exit 2 处理。 */
function parseArgs(argv) {
  const out = { errors: [] };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    switch (key) {
      case '--mode':
        out.mode = argv[++i];
        break;
      case '--target':
        out.target = argv[++i];
        break;
      case '--before':
        out.before = argv[++i];
        break;
      case '--after':
        out.after = argv[++i];
        break;
      case '--symbols':
        out.symbols = argv[++i];
        break;
      case '--out':
        out.out = argv[++i];
        break;
      case '--help':
      case '-h':
        console.log(USAGE);
        process.exit(EXIT_OK);
        break;
      default:
        out.errors.push(`未识别的参数：${key}`);
    }
  }
  return out;
}

/**
 * 参数校验按模式分别进行，缺项一次性全部报出。
 *
 * 只校验"该模式必须有"的参数，不校验多余参数——多给一个 --symbols 跑 byte-stable 无害，
 * 报错反而增加使用摩擦。
 */
function validateArgs(args) {
  const errors = [...args.errors];

  if (!args.mode) {
    errors.push(`缺少 --mode（可选值：${SUPPORTED_MODES.join(' | ')}）`);
  } else if (!SUPPORTED_MODES.includes(args.mode)) {
    errors.push(`--mode 取值非法：${args.mode}（可选值：${SUPPORTED_MODES.join(' | ')}）`);
  }

  if (!args.target) {
    errors.push('缺少 --target <path>');
  } else if (!fs.existsSync(args.target)) {
    errors.push(`--target 路径不存在：${args.target}`);
  }

  if (args.mode === 'mcp-ab') {
    for (const key of ['before', 'after', 'symbols']) {
      if (!args[key]) {
        errors.push(`mcp-ab 模式缺少 --${key} <file>`);
      } else if (!fs.existsSync(args[key])) {
        errors.push(`--${key} 文件不存在：${args[key]}`);
      }
    }
  }

  return errors;
}

/** 每次运行必变的字段（与 `graph-builder.ts` 的 `VOLATILE_FIELD_NAMES` 同源，勿分叉） */
const VOLATILE_FIELD_NAMES = new Set(['generatedAt', 'lastUpdated', 'timestamp', 'currentRun']);

/** 递归剥除易变字段后做稳定序列化（键序按字典序，消除对象键顺序噪声） */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => !VOLATILE_FIELD_NAMES.has(k)).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * 逐层遍历定位**首个**差异 JSON path。
 *
 * 只给第一个：差异往往成片出现（一个节点漏了会连带几十条边），全量打印会把真正的起点淹没。
 */
function firstJsonDiffPath(a, b, prefix = '$') {
  if (a === b) return null;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) return { path: prefix, reason: `类型不同（${ta} vs ${tb}）`, a: summarize(a), b: summarize(b) };
  if (ta === 'array') {
    if (a.length !== b.length) {
      return { path: prefix, reason: `数组长度不同（${a.length} vs ${b.length}）`, a: a.length, b: b.length };
    }
    for (let i = 0; i < a.length; i++) {
      const d = firstJsonDiffPath(a[i], b[i], `${prefix}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (ta === 'object') {
    const ka = Object.keys(a).filter((k) => !VOLATILE_FIELD_NAMES.has(k)).sort();
    const kb = Object.keys(b).filter((k) => !VOLATILE_FIELD_NAMES.has(k)).sort();
    const onlyA = ka.filter((k) => !kb.includes(k));
    const onlyB = kb.filter((k) => !ka.includes(k));
    if (onlyA.length > 0 || onlyB.length > 0) {
      return { path: prefix, reason: '键集合不同', a: onlyA, b: onlyB };
    }
    for (const k of ka) {
      const d = firstJsonDiffPath(a[k], b[k], `${prefix}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return { path: prefix, reason: '标量取值不同', a: summarize(a), b: summarize(b) };
}

function summarize(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return typeof s === 'string' && s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

/** 解析出 target 的 graph.json 路径（与生产者 `writeKnowledgeGraph` 同约定） */
function graphJsonPathOf(target) {
  return path.join(path.resolve(target), 'specs', '_meta', 'graph.json');
}

/** 跑一次 `spectra batch --mode graph-only`（走本仓 dist，不依赖 PATH 上可能陈旧的全局安装） */
function runGraphOnly(target, cliEntry) {
  const r = spawnSync(process.execPath, [cliEntry, 'batch', '--mode', 'graph-only'], {
    cwd: path.resolve(target),
    encoding: 'utf-8',
    timeout: 10 * 60_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    status: r.status,
    stderrTail: (r.stderr ?? '').split('\n').filter(Boolean).slice(-5).join('\n'),
  };
}

/**
 * SC-006 / FR-014：graph.json 连续两次生成的稳定性。
 *
 * 判据用**剥除易变字段后**的 sha256：磁盘上的 graph.json 带真实 `generatedAt` 墙钟，
 * 裸文件 sha 两次必然不同——拿它当判据会让本护栏恒红并被当噪声关掉。
 * 裸 sha 仍一并输出（`rawSha256`），供人核对"差异确实只来自时间戳"。
 */
function runByteStable(args) {
  const target = path.resolve(args.target);
  const cliEntry = path.resolve(process.cwd(), 'dist/cli/index.js');
  if (!fs.existsSync(cliEntry)) {
    return { mode: 'byte-stable', target, implemented: false, reason: `dist 缺失（${cliEntry}），先跑 npm run build` };
  }
  const graphPath = graphJsonPathOf(target);
  const snapshots = [];
  const runs = [];
  for (let i = 0; i < 2; i++) {
    const run = runGraphOnly(target, cliEntry);
    runs.push(run);
    if (run.status !== 0) {
      return {
        mode: 'byte-stable',
        target,
        implemented: false,
        reason: `第 ${i + 1} 次 graph-only 建图失败（exit ${run.status}）：${run.stderrTail}`,
      };
    }
    if (!fs.existsSync(graphPath)) {
      return { mode: 'byte-stable', target, implemented: false, reason: `第 ${i + 1} 次跑完仍无 ${graphPath}` };
    }
    const raw = fs.readFileSync(graphPath, 'utf-8');
    const snapPath = path.join(os.tmpdir(), `f266-byte-stable-${process.pid}-${i}.json`);
    fs.writeFileSync(snapPath, raw, 'utf-8');
    snapshots.push({ snapPath, raw, parsed: JSON.parse(raw) });
  }

  const [a, b] = snapshots;
  const stableA = sha256(stableStringify(a.parsed));
  const stableB = sha256(stableStringify(b.parsed));
  const passed = stableA === stableB;
  const summary = {
    mode: 'byte-stable',
    target,
    implemented: true,
    passed,
    runs: 2,
    stableSha256: [stableA, stableB],
    rawSha256: [sha256(a.raw), sha256(b.raw)],
    snapshots: snapshots.map((s) => s.snapPath),
    note: 'stableSha256 为剥除 generatedAt 等易变字段后的判据；rawSha256 仅供人核对差异来源',
  };
  if (!passed) {
    summary.firstDiff = firstJsonDiffPath(a.parsed, b.parsed) ?? { path: '$', reason: '序列化不同但逐层遍历未定位到差异（键序？）' };
  }
  return summary;
}

/** F155 / F170c 冻结的三工具顶层键契约——本卡之前就已存在的字段，一个都不许少 */
const LEGACY_TOP_LEVEL_KEYS = {
  impact: [
    'affected', 'summary', 'effectiveDepth', 'effectiveMinConfidence', 'effectiveBudget',
    'effectiveDirection', 'topImpacted', 'nextStepHint',
  ],
  context: ['definition', 'callers', 'callees', 'imports', 'topRelevantCallers', 'nextStepHint'],
  detect_changes: [
    'changedSymbols', 'affectedSymbols', 'riskSummary', 'unmappedFiles', 'effectiveBudget',
    'effectiveDepth', 'effectiveMinConfidence', 'riskTier', 'topImpacted', 'nextStepHint',
  ],
};

/** 本卡唯一允许新增的键 */
const ALLOWED_NEW_KEYS = new Set(['honesty']);

/** 把一份 graph.json 安置到独立临时 project root，供 handler 按 projectRoot 加载 */
function stageGraph(graphFile, label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `f266-${label}-`));
  fs.mkdirSync(path.join(root, 'specs', '_meta'), { recursive: true });
  fs.copyFileSync(path.resolve(graphFile), path.join(root, 'specs', '_meta', 'graph.json'));
  return root;
}

function parseEnvelope(result) {
  if (result.isError) return { error: JSON.parse(result.content[0].text) };
  return { data: JSON.parse(result.content[0].text) };
}

/** 取结果集（不含 honesty / 不含文案），供逐元素比对 */
function resultSetOf(tool, data) {
  if (data === undefined) return null;
  if (tool === 'impact') {
    return {
      affected: (data.affected ?? []).map((x) => `${x.id}@${x.depth}`),
      topImpacted: (data.topImpacted ?? []).map((x) => `${x.id}@${x.score}`),
      summary: data.summary ?? null,
    };
  }
  if (tool === 'context') {
    return {
      callers: (data.callers ?? []).map((x) => x.id),
      callees: (data.callees ?? []).map((x) => x.id),
      imports: (data.imports ?? []).map((x) => x.moduleId),
      topRelevantCallers: (data.topRelevantCallers ?? []).map((x) => x.id),
    };
  }
  return {
    changedSymbols: (data.changedSymbols ?? []).map((x) => `${x.file}:${x.symbols.join(',')}`),
    affectedSymbols: (data.affectedSymbols ?? []).map((x) => `${x.id}@${x.depth}`),
    topImpacted: (data.topImpacted ?? []).map((x) => `${x.id}@${x.score}`),
    riskSummary: data.riskSummary ?? null,
  };
}

/** 顶层键集合审计：缺失既有键 / 出现 honesty 之外的新键 → 判失败 */
function auditKeys(tool, data) {
  if (data === undefined) return [];
  const actual = new Set(Object.keys(data));
  const problems = [];
  for (const k of LEGACY_TOP_LEVEL_KEYS[tool]) {
    if (!actual.has(k)) problems.push(`${tool}: 既有键缺失 ${k}`);
  }
  for (const k of actual) {
    if (LEGACY_TOP_LEVEL_KEYS[tool].includes(k)) continue;
    if (ALLOWED_NEW_KEYS.has(k)) continue;
    // warnings / resolvedFrom 等条件字段属既有可选面，逐个列白名单反而脆弱，这里只拦"不认识的新键"
    if (['warnings', 'resolvedFrom', 'resolvedTo', 'resolvedConfidence', 'relatedSpec', '_enrichmentDegraded'].includes(k)) continue;
    problems.push(`${tool}: 出现非预期新键 ${k}`);
  }
  return problems;
}

/**
 * SC-003：两份图快照上三工具结果集合逐元素相等 + 追加式兼容审计。
 *
 * 能力边界见文件头：本函数不执行改动前的二进制，(b) 的键集合契约才是"既有消费方零影响"
 * 的承重判据。
 */
async function runMcpAb(args) {
  const target = path.resolve(args.target);
  const distTools = path.resolve(process.cwd(), 'dist/mcp/agent-context-tools.js');
  if (!fs.existsSync(distTools)) {
    return { mode: 'mcp-ab', target, implemented: false, reason: `dist 缺失（${distTools}），先跑 npm run build` };
  }
  const mod = await import(pathToFileURL(distTools).href);
  const honestyMod = await import(pathToFileURL(path.resolve(process.cwd(), 'dist/mcp/lib/graph-honesty.js')).href);
  const graphMod = await import(pathToFileURL(path.resolve(process.cwd(), 'dist/mcp/graph-tools.js')).href);

  const rawSymbols = JSON.parse(fs.readFileSync(path.resolve(args.symbols), 'utf-8'));
  const symbols = Array.isArray(rawSymbols) ? rawSymbols : (rawSymbols.symbols ?? []);
  if (symbols.length === 0) {
    return { mode: 'mcp-ab', target, implemented: false, reason: '--symbols 清单为空' };
  }

  const beforeRoot = stageGraph(args.before, 'before');
  const afterRoot = stageGraph(args.after, 'after');

  const problems = [];
  let honestyPresent = 0;
  let comparisons = 0;

  for (const symbolId of symbols) {
    for (const tool of ['impact', 'context']) {
      const call = tool === 'impact'
        ? (root) => mod.handleImpact({ target: symbolId, projectRoot: root })
        : (root) => mod.handleContext({ symbolId, projectRoot: root });
      honestyMod.__resetHonestyCache();
      graphMod.reloadGraph();
      const before = parseEnvelope(await call(beforeRoot));
      honestyMod.__resetHonestyCache();
      graphMod.reloadGraph();
      const after = parseEnvelope(await call(afterRoot));

      if ((before.error === undefined) !== (after.error === undefined)) {
        problems.push(`${tool}(${symbolId}): 成功/失败状态不一致`);
        continue;
      }
      if (before.error !== undefined) continue; // 两侧同为错误（如 symbol 不在图内），不参与结果集比对
      comparisons++;
      if (after.data.honesty !== undefined) honestyPresent++;

      const bs = JSON.stringify(resultSetOf(tool, before.data));
      const as = JSON.stringify(resultSetOf(tool, after.data));
      if (bs !== as) problems.push(`${tool}(${symbolId}): 结果集不相等\n  before=${bs}\n  after =${as}`);
      problems.push(...auditKeys(tool, after.data));
    }
  }

  // detect_changes 与单个 symbol 无关，用**自带 diff** 跑（staged root 不是 git 仓库，
  // baseRef 模式在这里必然 rev-parse 失败——那验的是 git 探测而非本卡的返回面）。
  const probeFile = symbols[0].includes('::') ? symbols[0].split('::')[0] : symbols[0];
  const syntheticDiff = `diff --git a/${probeFile} b/${probeFile}\n--- a/${probeFile}\n+++ b/${probeFile}\n`;
  for (const [label, root] of [['before', beforeRoot], ['after', afterRoot]]) {
    honestyMod.__resetHonestyCache();
    graphMod.reloadGraph();
    const dc = parseEnvelope(await mod.handleDetectChanges({ diff: syntheticDiff, projectRoot: root }));
    if (dc.data === undefined) {
      problems.push(`detect_changes(${label}): 期望成功响应，实得 ${JSON.stringify(dc.error)}`);
      continue;
    }
    comparisons++;
    if (dc.data.honesty !== undefined) honestyPresent++;
    problems.push(...auditKeys('detect_changes', dc.data));
  }

  fs.rmSync(beforeRoot, { recursive: true, force: true });
  fs.rmSync(afterRoot, { recursive: true, force: true });

  return {
    mode: 'mcp-ab',
    target,
    before: path.resolve(args.before),
    after: path.resolve(args.after),
    symbols: path.resolve(args.symbols),
    implemented: true,
    passed: problems.length === 0,
    symbolCount: symbols.length,
    comparisons,
    honestyPresent,
    problems,
    note: '不执行改动前的二进制（见文件头能力边界）；键集合契约为承重判据',
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const errors = validateArgs(args);
  if (errors.length > 0) {
    console.error(errors.map((e) => `[error] ${e}`).join('\n'));
    console.error(`\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }

  const summary = args.mode === 'byte-stable' ? runByteStable(args) : await runMcpAb(args);

  const rendered = JSON.stringify(summary, null, 2);
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, `${rendered}\n`, 'utf-8');
    console.error(`[verify-266] 摘要已写入: ${args.out}`);
  }
  console.log(rendered);

  if (!summary.implemented) {
    console.error(`[verify-266] ${summary.reason}`);
    process.exit(EXIT_NOT_IMPLEMENTED);
  }
  process.exit(summary.passed ? EXIT_OK : EXIT_MISMATCH);
}

main().catch((err) => {
  // 脚本自身异常 MUST NOT 静默成 exit 0：跑不成就要看得见
  console.error(`[verify-266] 验证脚本异常：${err?.stack ?? String(err)}`);
  process.exit(EXIT_USAGE);
});
