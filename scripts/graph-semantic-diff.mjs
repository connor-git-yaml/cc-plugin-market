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
  // F261 D3：`graph.graph` 承载三维 provenance（sourceCommit / fingerprint / builder），
  // 两图比较时必须一并读出，否则"差异其实来自工具版本"这条解释在本工作流里不可见。
  const meta = g.graph !== null && typeof g.graph === 'object' && !Array.isArray(g.graph) ? g.graph : {};
  return { nodes: g.nodes ?? [], links: g.links ?? g.edges ?? [], meta };
}

// ─────────────────── F261 D3：provenance banner ───────────────────

/**
 * 十六进制值域闸口：只有真正的小写 hex 才被渲染，其余一律折叠成 `unrecognized`。
 *
 * 与 `src/panoramic/graph/builder-stamp.ts` 的 `COMMIT_VALUE_PATTERN` /
 * `DIST_SHA256_VALUE_PATTERN` 同一理由（F261 复审 F3 实证）：这些值来自**外部 graph.json**，
 * 会被原样打印到终端；`commit = ESC[2J ESC[H` 在真终端里清屏 + 光标归位，能抹掉上方全部输出。
 */
function hexOrNull(value, min, max) {
  if (typeof value !== 'string') return null;
  return new RegExp(`^[0-9a-f]{${min},${max}}$`).test(value) ? value : null;
}

/**
 * 键序无关的规范化序列化：banner 的判据必须只对**语义差异**触发。
 *
 * 直接用 `JSON.stringify` 会**键序敏感**——两份字段完全相同、只是书写顺序不同的 fingerprint
 * （手工编辑过的图、或另一个序列化器产出的图）会被判为"不同"，打出一条纯噪声的 banner。
 * 本函数递归按键名排序后再序列化，把这一类假阳性消掉。
 */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/**
 * 两个值在**顶层键**上的差异集合（键名已消毒，见下）。
 *
 * 为什么需要（对抗复审 W1）：判据比对**整个对象**，渲染却只暴露一两个字段——`describeFingerprint`
 * 只打 `behaviorVersion`、`describeBuilderRecord` 只打 `commit`/`dist`。差异落在未渲染字段时，
 * banner 会声称"provenance 不同"，紧接着的证据行两侧**一模一样**，读者最可能的反应是判定工具
 * 有 bug 并忽略整条提示 —— 比不打 banner 更糟。
 *
 * 这不是边角形态：`CollectorFingerprint` 的 `extensionSurface` 变化会自动改指纹而**不**需要
 * bump `behaviorVersion`（F249 的设计口径，F243 `.mjs/.cjs`、F250 `.pyi` 都走这条），所以
 * "跨版本两图 fingerprint 不同"的最常见真实形态恰好渲染成 `behaviorVersion=7 → behaviorVersion=7`。
 *
 * 键名来自**外部 graph.json**，与值一样是数据流出口：只放行常规标识符字符，其余整体折叠成
 * `<非常规字段名>`，并限量输出（同 `hexOrNull` 的理由）。
 */
function diffTopLevelKeys(a, b) {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(a) || !isObj(b)) return [];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const differing = keys.filter((k) => canonicalJson(a[k]) !== canonicalJson(b[k]));
  const safe = differing.map((k) => (/^[A-Za-z0-9_.-]{1,40}$/.test(k) ? k : '<非常规字段名>'));
  return safe.length > 5 ? [...safe.slice(0, 5), `…共 ${safe.length} 项`] : safe;
}

/** builder 记录的人读身份；三种"没有可用身份"的形态刻意分列（与 graph-quality advisory 同口径）。 */
function describeBuilderRecord(builder) {
  if (builder === undefined) return 'unrecorded（本字段上线前的旧图产物）';
  if (builder === null) return 'unstamped（未盖章 build / 源码直跑写出）';
  if (typeof builder !== 'object' || Array.isArray(builder)) return 'unrecognized（记录形态不可识别）';
  const commit = hexOrNull(builder.commit, 7, 64);
  const dist = hexOrNull(builder.distSha256, 64, 64);
  if (commit === null || dist === null) return 'unrecognized（记录值不可识别）';
  return `commit ${commit.slice(0, 7)} / dist ${dist.slice(0, 12)}`;
}

/** sourceCommit 的人读形态（外部值，同样过值域闸口）。 */
function describeSourceCommit(value) {
  if (value === undefined) return 'unrecorded';
  if (value === null) return 'null（非 git 仓库 / 非 AST 重建链路）';
  const commit = hexOrNull(value, 7, 64);
  return commit === null ? 'unrecognized' : commit.slice(0, 7);
}

/** fingerprint 的人读形态：只暴露 behaviorVersion（其余字段进 banner 只是噪声）。 */
function describeFingerprint(value) {
  if (value === undefined) return 'unrecorded';
  if (value === null) return 'null';
  if (typeof value !== 'object' || Array.isArray(value)) return 'unrecognized';
  return typeof value.behaviorVersion === 'number'
    ? `behaviorVersion=${value.behaviorVersion}`
    : 'behaviorVersion=?';
}

/**
 * 两图 provenance 任一维不同 → 先打一段醒目提示，再进入三类归因明细。
 *
 * **纯输出增量**：不改 exit code、不改判定、不新增 repo:check check（F261 D3 硬约束）。
 * 理由：事故当时的真实工作流就是"两张图对比、看到 148 节点差"，而节点差最常见的解释——
 * **两张图由不同版本的工具建出**——在这条工作流里此前一个字都不出现。
 */
function printProvenanceBanner(oldMeta, newMeta) {
  // `?? null` 把"键缺失"与"显式 null"归一：两者都表示**没有可用的 build 身份**，对"节点差是不是
  // 工具版本造成的"这个问题零信息量，分开报只会制造噪声。有身份的一侧与无身份的一侧仍会触发提示。
  const dims = [];

  /**
   * 组装一维证据行。两侧渲染值**相同**时补上差异落点（W1）——否则就是一句自相矛盾的输出。
   */
  const pushDim = (name, oldValue, newValue, render) => {
    if (canonicalJson(oldValue ?? null) === canonicalJson(newValue ?? null)) return;
    const oldText = render(oldValue);
    const newText = render(newValue);
    let line = `${name}: old ${oldText} → new ${newText}`;
    if (oldText === newText) {
      const keys = diffTopLevelKeys(oldValue, newValue);
      line += keys.length > 0 ? `（差异在未展示字段：${keys.join(', ')}）` : '（差异在未展示字段）';
    }
    dims.push(line);
  };

  pushDim('builder', oldMeta.builder, newMeta.builder, describeBuilderRecord);
  pushDim('sourceCommit', oldMeta.sourceCommit, newMeta.sourceCommit, describeSourceCommit);
  pushDim('fingerprint', oldMeta.fingerprint, newMeta.fingerprint, describeFingerprint);

  if (dims.length === 0) return;

  console.log('[provenance] ⚠ 两图 provenance 不同，节点/边差异可能来自工具版本而非源码：');
  for (const d of dims) console.log(`[provenance]   ${d}`);
  console.log('[provenance] 排查建议：先用同一版 dist 重建两侧图再比对，再判断差异是否为真实源码变化。');
  console.log('');
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
  // F261 D3：provenance 提示必须在三类归因明细**之前**——读者先看见"两图可能不同版本工具建出"，
  // 才不会把工具版本造成的节点/边差异误读成源码变化。
  printProvenanceBanner(oldG.meta, newG.meta);
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
