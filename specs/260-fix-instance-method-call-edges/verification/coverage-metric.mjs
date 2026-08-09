#!/usr/bin/env node
/**
 * F260 calls 入边覆盖率重算器（数字产物必配重算器）。
 *
 * 用法：node specs/260-fix-instance-method-call-edges/verification/coverage-metric.mjs [graph.json]
 * 默认读 specs/_meta/graph.json。
 *
 * ## 为什么有两套口径，以及为什么主口径不是「所有 Class.method 节点」
 *
 * F260 立项时引用的 `4.5% vs 49.6%（11×）` 是「`::` 之后含 `.`」这一纯字符串判据算出来的，
 * 对抗审查实证该分母**不公允**：3449 个所谓 `Class.method` 节点里 2891 个（83.8%）的
 * `memberKind === 'property'`，绝大多数是 interface 字段声明（如 `IndexableModuleSpec.frontmatter`），
 * **本就不可能有 calls 入边**；对照侧 2803 个「普通符号」里也有 574 interface + 228 type + 399 const
 * 同样不可调用，把基准压低了近一半。两侧噪声方向相反，差距因此被放大约 3.7 倍。
 *
 * 因此本重算器同时输出两套口径，**主口径（headline）是可调用对可调用**：
 *   - 分子侧：`memberKind === 'method'`（类方法）
 *   - 对照侧：`exportKind === 'function'`（顶层函数）
 * `legacy` 口径保留原字符串判据，仅用于与立项文案的历史数字对账，**不作为验收依据**。
 *
 * 「有 calls 入边」= 存在 relation==='calls' 且 target === 该节点 id 的边。
 */
import fs from 'node:fs';

const file = process.argv[2] ?? 'specs/_meta/graph.json';
const g = JSON.parse(fs.readFileSync(file, 'utf8'));
const links = g.links ?? g.edges;
const calls = links.filter((e) => e.relation === 'calls');
const inCalls = new Set(calls.map((e) => e.target));

const pct = (a, b) => (b === 0 ? null : +((100 * a) / b).toFixed(1));

/** 累加器：{total, withInEdge} 按任意分组键。 */
const bump = (bucket, key, hit) => {
  bucket[key] ??= { total: 0, withInEdge: 0 };
  bucket[key].total++;
  if (hit) bucket[key].withInEdge++;
};

const memberByKind = {};
const symbolByKind = {};
let legacyCm = 0, legacyCmIn = 0, legacyPlain = 0, legacyPlainIn = 0;

for (const n of g.nodes) {
  if (n.metadata?.unifiedKind !== 'symbol') continue;
  const idx = n.id.indexOf('::');
  if (idx < 0) continue;
  const sym = n.id.slice(idx + 2);
  const hit = inCalls.has(n.id);
  if (sym.includes('.')) {
    legacyCm++; if (hit) legacyCmIn++;
    bump(memberByKind, n.metadata?.memberKind ?? '(none)', hit);
  } else {
    legacyPlain++; if (hit) legacyPlainIn++;
    bump(symbolByKind, n.metadata?.exportKind ?? '(none)', hit);
  }
}

const withPct = (bucket) =>
  Object.fromEntries(
    Object.entries(bucket)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([k, v]) => [k, { ...v, pct: pct(v.withInEdge, v.total) }]),
  );

const method = memberByKind.method ?? { total: 0, withInEdge: 0 };
const fn = symbolByKind.function ?? { total: 0, withInEdge: 0 };
const methodPct = pct(method.withInEdge, method.total);
const fnPct = pct(fn.withInEdge, fn.total);

console.log(JSON.stringify({
  graph: file,
  sourceCommit: g.graph?.sourceCommit ?? null,
  nodes: g.nodes.length,
  edges: links.length,
  callsEdges: calls.length,

  // ── 主口径（验收依据）：可调用 vs 可调用 ──
  headline: {
    methodNodes: method.total,
    methodWithInEdge: method.withInEdge,
    methodCoveragePct: methodPct,
    functionNodes: fn.total,
    functionWithInEdge: fn.withInEdge,
    functionCoveragePct: fnPct,
    gapPct: methodPct === null || fnPct === null ? null : +(fnPct - methodPct).toFixed(1),
    gapRatio: methodPct ? +(fnPct / methodPct).toFixed(2) : null,
  },

  // ── 分组明细（口径可审计）──
  memberNodesByKind: withPct(memberByKind),
  symbolNodesByExportKind: withPct(symbolByKind),

  // ── legacy 口径：仅用于与立项文案数字对账，不作验收依据 ──
  legacy: {
    classMethodNodes: legacyCm,
    classMethodWithInEdge: legacyCmIn,
    classMethodCoveragePct: pct(legacyCmIn, legacyCm),
    plainSymbolNodes: legacyPlain,
    plainSymbolWithInEdge: legacyPlainIn,
    plainSymbolCoveragePct: pct(legacyPlainIn, legacyPlain),
  },
}, null, 2));
