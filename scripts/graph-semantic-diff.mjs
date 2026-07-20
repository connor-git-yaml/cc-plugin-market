#!/usr/bin/env node
/**
 * Feature 214 T034a / C-2（fail-closed 重写）— graph 语义差异归因脚本
 * （落实 plan R-2/R-7 缓解，SC-005 机械归因载体）。
 *
 * 用法：
 *   node scripts/graph-semantic-diff.mjs <old.graph.json> <new.graph.json>
 *   node scripts/graph-semantic-diff.mjs --dup-check <graph.json>
 *
 * 三类预期变化 allowlist（SC-005）：
 *   (1) contains 边计数新增（区分顶层 module→symbol 与 class→member）
 *   (2) canonical ID 字面变化（`#`→`::`）+ 由此消除的成对重复节点减量
 *   (3) community/god-node 度数统计变化（contains 剔除前后，**逐节点** degree 对比）
 *
 * fail-closed 判定（C-2）：任一成立即 exit 非零：
 *   - 旧图 contains 边在新图缺失（按语义 key 的 multiplicity）
 *   - 新图仍存在 duplicate-pair（newDup > 0）或 dup 消除量为负
 *   - 非 contains 耦合边 multiset 存在未归因增减
 *   - 语义节点集合对称差 / 受控字段（kind/unifiedKind/sourceTag）出现旧图没有的新签名
 *
 * W5 语义 key = 相对文件路径 + 完整 qualified symbol path（含 class 前缀）+ symbol kind，
 * 双分隔符归一化（`#` 与 `::` 归一为同一语义 → 检出 `#`/`::` 成对重复）。
 */
import { readFileSync } from 'node:fs';

// ───────────────────────── 语义归一 ─────────────────────────

/** 把 node id 拆为 { file, sym }，`#` 与 `::` 归一（canonical :: 优先；legacy 取最后一个 #） */
function splitId(id) {
  const iColon = id.indexOf('::');
  if (iColon >= 0) return { file: id.slice(0, iColon), sym: id.slice(iColon + 2) };
  const iHash = id.lastIndexOf('#');
  if (iHash >= 0) return { file: id.slice(0, iHash), sym: id.slice(iHash + 1) };
  return { file: id, sym: '' };
}

/** 语义节点识别（file|sym，不含 kind，用于 presence / dup / degree） */
function semId(node) {
  const { file, sym } = splitId(node.id);
  return `${file}␟${sym}`;
}
/** 语义节点 presence key：file|sym|kind */
function semNodeKey(node) {
  return `${semId(node)}␟${node.kind ?? ''}`;
}
/** 受控字段签名（kind + provenance），用于检出 provenance 变异 */
function controlledSig(node) {
  const m = node.metadata ?? {};
  return `${node.kind ?? ''}|${m.unifiedKind ?? ''}|${m.sourceTag ?? ''}`;
}
/** 语义边 key：semSource→semTarget|relation */
function semEdgeKey(edge) {
  const s = splitId(edge.source);
  const t = splitId(edge.target);
  return `${s.file}␟${s.sym}→${t.file}␟${t.sym}␟${edge.relation}`;
}
/** contains 边目标是否为 class member（symbolPart 含 `.`）→ 两级；否则 module→symbol */
function isMemberContains(edge) {
  return splitId(edge.target).sym.includes('.');
}

function loadGraph(path) {
  const g = JSON.parse(readFileSync(path, 'utf-8'));
  return { nodes: g.nodes ?? [], links: g.links ?? g.edges ?? [] };
}

/** multiset：key → count */
function multiset(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function duplicatePairs(nodes) {
  const byKey = new Map();
  for (const n of nodes) {
    const key = semNodeKey(n);
    const set = byKey.get(key) ?? new Set();
    set.add(n.id);
    byKey.set(key, set);
  }
  const pairs = [];
  let count = 0;
  for (const [key, ids] of byKey) {
    if (ids.size > 1) {
      count += ids.size - 1;
      pairs.push(`${key.replace(/␟/g, '|')} => {${[...ids].join(', ')}}`);
    }
  }
  return { count, pairs };
}

// ───────────────────────── dup-check 子命令 ─────────────────────────

function runDupCheck(graphPath) {
  const { nodes } = loadGraph(graphPath);
  const { count, pairs } = duplicatePairs(nodes);
  console.log(`[dup-check] ${graphPath}`);
  console.log(`  节点总数: ${nodes.length}`);
  console.log(`  duplicate-pair count: ${count}`);
  for (const p of pairs) console.log(`    - ${p}`);
  if (count > 0) {
    console.error(`[dup-check] FAIL: 存在 ${count} 对语义重复节点（应为 0）`);
    process.exit(1);
  }
  console.log('[dup-check] PASS: duplicate-pair count = 0');
  process.exit(0);
}

// ───────────────────────── 逐节点耦合度（类3） ─────────────────────────

/** 每个语义节点的耦合度 = 关联的非 contains 边数（source 或 target 命中） */
function couplingDegree(nodes, links) {
  const deg = new Map();
  for (const n of nodes) deg.set(semId(n), 0);
  for (const e of links) {
    if (e.relation === 'contains') continue;
    const s = splitId(e.source);
    const t = splitId(e.target);
    const sk = `${s.file}␟${s.sym}`;
    const tk = `${t.file}␟${t.sym}`;
    deg.set(sk, (deg.get(sk) ?? 0) + 1);
    if (tk !== sk) deg.set(tk, (deg.get(tk) ?? 0) + 1);
  }
  return deg;
}

// ───────────────────────── 三类归因 diff ─────────────────────────

function runDiff(oldPath, newPath) {
  const oldG = loadGraph(oldPath);
  const newG = loadGraph(newPath);
  const problems = [];

  // ── 类 (1) contains 边增量 + 保留性检查（fail-closed）──
  const oldContainsMs = multiset(oldG.links.filter((e) => e.relation === 'contains'), semEdgeKey);
  const newContainsMs = multiset(newG.links.filter((e) => e.relation === 'contains'), semEdgeKey);
  const newContainsEdges = newG.links.filter((e) => e.relation === 'contains');
  const newContainsTop = newContainsEdges.filter((e) => !isMemberContains(e)).length;
  const newContainsMember = newContainsEdges.filter(isMemberContains).length;
  let addedTop = 0;
  let addedMember = 0;
  for (const e of newContainsEdges) {
    if (!oldContainsMs.has(semEdgeKey(e))) {
      if (isMemberContains(e)) addedMember += 1;
      else addedTop += 1;
    }
  }
  const missingContains = [];
  for (const [k, c] of oldContainsMs) {
    const nc = newContainsMs.get(k) ?? 0;
    if (nc < c) missingContains.push(`${k.replace(/␟/g, '|')} (old×${c} → new×${nc})`);
  }
  if (missingContains.length > 0) {
    problems.push(`旧图 contains 边在新图缺失（${missingContains.length}）: ${missingContains.slice(0, 5).join(' ; ')}`);
  }

  // ── 类 (2) canonical ID 字面变化 + 重复消除（fail-closed）──
  const oldHashNodes = oldG.nodes.filter((n) => !n.id.includes('::') && n.id.includes('#')).length;
  const newHashNodes = newG.nodes.filter((n) => !n.id.includes('::') && n.id.includes('#')).length;
  const oldDup = duplicatePairs(oldG.nodes);
  const newDup = duplicatePairs(newG.nodes);
  const dupEliminated = oldDup.count - newDup.count;
  if (newDup.count > 0) {
    problems.push(`新图仍存在 ${newDup.count} 对语义重复节点: ${newDup.pairs.slice(0, 5).join(' ; ')}`);
  }
  if (dupEliminated < 0) {
    problems.push(`dup 消除量为负（old ${oldDup.count} → new ${newDup.count}）：新图新增了重复`);
  }

  // ── 节点 presence + 受控字段（fail-closed）──
  const oldKeys = new Set(oldG.nodes.map(semNodeKey));
  const newKeys = new Set(newG.nodes.map(semNodeKey));
  const nodeOnlyOld = [...oldKeys].filter((k) => !newKeys.has(k));
  const nodeOnlyNew = [...newKeys].filter((k) => !oldKeys.has(k));
  if (nodeOnlyOld.length > 0) problems.push(`语义节点仅存于 old（${nodeOnlyOld.length}）: ${nodeOnlyOld.slice(0, 5).map((k) => k.replace(/␟/g, '|')).join(' ; ')}`);
  if (nodeOnlyNew.length > 0) problems.push(`语义节点仅存于 new（${nodeOnlyNew.length}）: ${nodeOnlyNew.slice(0, 5).map((k) => k.replace(/␟/g, '|')).join(' ; ')}`);
  const oldSigByKey = new Map();
  for (const n of oldG.nodes) {
    const k = semNodeKey(n);
    const set = oldSigByKey.get(k) ?? new Set();
    set.add(controlledSig(n));
    oldSigByKey.set(k, set);
  }
  const newSigByKey = new Map();
  for (const n of newG.nodes) {
    const k = semNodeKey(n);
    const set = newSigByKey.get(k) ?? new Set();
    set.add(controlledSig(n));
    newSigByKey.set(k, set);
  }
  const provMutations = [];
  for (const [k, sigs] of newSigByKey) {
    const oldSigs = oldSigByKey.get(k);
    if (!oldSigs) continue; // 已在 nodeOnlyNew 报告
    for (const s of sigs) {
      if (!oldSigs.has(s)) provMutations.push(`${k.replace(/␟/g, '|')} 新签名[${s}]∉old{${[...oldSigs].join(',')}}`);
    }
  }
  if (provMutations.length > 0) problems.push(`节点受控字段变异（${provMutations.length}）: ${provMutations.slice(0, 5).join(' ; ')}`);

  // ── 非 contains 耦合边 multiset（fail-closed）──
  const oldCoupMs = multiset(oldG.links.filter((e) => e.relation !== 'contains'), semEdgeKey);
  const newCoupMs = multiset(newG.links.filter((e) => e.relation !== 'contains'), semEdgeKey);
  const coupOnlyOld = [];
  const coupOnlyNew = [];
  for (const [k, c] of oldCoupMs) { const nc = newCoupMs.get(k) ?? 0; if (nc < c) coupOnlyOld.push(`${k.replace(/␟/g, '|')} (old×${c}→new×${nc})`); }
  for (const [k, c] of newCoupMs) { const oc = oldCoupMs.get(k) ?? 0; if (oc < c) coupOnlyNew.push(`${k.replace(/␟/g, '|')} (old×${oc}→new×${c})`); }
  if (coupOnlyOld.length > 0) problems.push(`未归因非-contains 边多存于 old（${coupOnlyOld.length}）: ${coupOnlyOld.slice(0, 5).join(' ; ')}`);
  if (coupOnlyNew.length > 0) problems.push(`未归因非-contains 边多存于 new（${coupOnlyNew.length}）: ${coupOnlyNew.slice(0, 5).join(' ; ')}`);

  // ── 类 (3) 逐节点耦合度对比 ──
  const oldDeg = couplingDegree(oldG.nodes, oldG.links);
  const newDeg = couplingDegree(newG.nodes, newG.links);
  const degKeys = new Set([...oldDeg.keys(), ...newDeg.keys()]);
  const degChanges = [];
  for (const k of degKeys) {
    const o = oldDeg.get(k) ?? 0;
    const n = newDeg.get(k) ?? 0;
    if (o !== n) degChanges.push({ node: k.replace(/␟/g, '|'), old: o, new: n, delta: n - o });
  }
  degChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // 报告
  console.log(`=== graph-semantic-diff (fail-closed) ===`);
  console.log(`old: ${oldPath}  (nodes=${oldG.nodes.length}, links=${oldG.links.length})`);
  console.log(`new: ${newPath}  (nodes=${newG.nodes.length}, links=${newG.links.length})`);
  console.log('');
  console.log(`[类1] contains 边增量:`);
  console.log(`  new contains 总计: ${newContainsEdges.length}（module→symbol ${newContainsTop} / class→member ${newContainsMember}）`);
  console.log(`  相对 old 新增: module→symbol +${addedTop} / class→member +${addedMember}；旧 contains 缺失: ${missingContains.length}`);
  console.log('');
  console.log(`[类2] canonical ID 字面变化 + 重复消除:`);
  console.log(`  纯 '#' 节点: old ${oldHashNodes} → new ${newHashNodes}`);
  console.log(`  duplicate-pair: old ${oldDup.count} → new ${newDup.count}（消除 ${dupEliminated}）`);
  console.log('');
  const oldCoupTotal = oldG.links.filter((e) => e.relation !== 'contains').length;
  const newCoupTotal = newG.links.filter((e) => e.relation !== 'contains').length;
  console.log(`[类3] 逐节点耦合度变化（contains 剔除后；top ${Math.min(10, degChanges.length)}）:`);
  console.log(`  非 contains 耦合边总数: old ${oldCoupTotal} → new ${newCoupTotal}`);
  console.log(`  变化节点数: ${degChanges.length}`);
  for (const c of degChanges.slice(0, 10)) console.log(`    ${c.node}: ${c.old} → ${c.new} (Δ${c.delta >= 0 ? '+' : ''}${c.delta})`);
  console.log('');

  if (problems.length > 0) {
    console.error('[FAIL] 存在三类归因之外的未归因差异（fail-closed）:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('[PASS] 全部差异归因到三类 allowlist（无未归因节点/边/ID/度数差异）');
  process.exit(0);
}

// ───────────────────────── CLI ─────────────────────────

const argv = process.argv.slice(2);
if (argv[0] === '--dup-check') {
  if (!argv[1]) { console.error('用法: node scripts/graph-semantic-diff.mjs --dup-check <graph.json>'); process.exit(2); }
  runDupCheck(argv[1]);
} else if (argv.length >= 2) {
  runDiff(argv[0], argv[1]);
} else {
  console.error('用法:');
  console.error('  node scripts/graph-semantic-diff.mjs <old.graph.json> <new.graph.json>');
  console.error('  node scripts/graph-semantic-diff.mjs --dup-check <graph.json>');
  process.exit(2);
}
