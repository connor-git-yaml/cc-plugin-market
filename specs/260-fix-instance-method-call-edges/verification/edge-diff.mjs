#!/usr/bin/env node
/**
 * F260 逐边 diff 重算器（plan §5 变更 #15 / tasks T002）。
 *
 * 用法：
 *   node edge-diff.mjs <before-graph.json> <after-graph.json> [选项]
 *   node edge-diff.mjs --self-test        # 内置 fixture 自验（T002 验收）
 *
 * 选项：
 *   --phase P2|P4|P5     按 plan §6 阶段表套用期望方向与上限（不传则只报数不判定）
 *   --skeletons <file>   exports 快照（dump-skeletons.mjs 产出），启用断言 2 的
 *                        「成员来自那个 kind==='class' 的 export 条目自己的 members」严判
 *   --json               只输出 JSON（默认输出人类可读摘要 + JSON）
 *   --limit N            清单摘要每类最多打印 N 条（默认 40）
 *
 * ## 比较口径（plan §6「验证口径的统一约定」1 + D4）
 *
 * 比较键 = `source | relation | target | confidence` 四元组，**多重集计数**（非集合去重）。
 * 多重集是刻意的：同键边在最终图里被 graph-builder 第五路 dedup 折叠成一条，若这里也去重，
 * 「一条真边被顶掉、另一条同键假边补位」这类替换会在 diff 上完全隐形。
 *
 * ## 实现的四项判据
 *
 * 1. **retarget 配对**（P2 / P4 例外口径）：新增边与减少边按 `source + relation + calleeName`
 *    分组，组内一增一减配对 = 一对 retarget（「同 source + 同 calleeName、仅 target 变」）。
 *    组内配不上的余量就是「不成对新增 / 不成对减少」——那是停工排查的信号。
 * 2. **断言 2（exportKind 两跳）**：新增 calls 边的 target
 *    - symbol 节点（`file::Sym`）→ 要求 `metadata.exportKind === 'class'`；
 *    - member 节点（`file::Cls.name`）→ 先定位所属 symbol 节点 `file::Cls`，要求其
 *      `exportKind === 'class'`，**且**该成员来自那个 `kind==='class'` 的 export 条目自己的
 *      `members`（不得由同名 interface 条目提供，对齐 A6 / R10b）。
 *      第二跳需要 skeleton 事实，只有传 `--skeletons` 才可判；未传时该腿记为
 *      `notEvaluated` 并在结论里显式声明（不静默按通过处理）。
 * 3. **断言 3（悬空边）**：新增边的 source 与 target 必须都在 after 图的节点集中。
 * 4. **B5 提示**：任何非零 diff 都附带提示——`graph-builder.ts:422-437` 第五路 dedup 是
 *    first-write-wins 且从不更新 confidence，与前四路 confidence-max-wins 方向相反，
 *    归因到本阶段之前必须先排除该顺序敏感性。
 */
import fs from 'node:fs';

const RETARGET_LIMITS = { P2: null, P3: null, P4: 308, P5: null };
const PHASE_EXPECT = { P2: 'only-decrease', P3: 'no-removal', P4: 'only-increase', P5: 'only-increase' };
/** 裁决 P2-2：断言 2 只对 P4 / P5 新分支与 MRO 分支产出的 calls 边生效。 */
const ASSERTION2_PHASES = new Set(['P4', 'P5']);

const SEP = '\x00';

/** 边的比较键：source|relation|target|confidence 四元组。 */
const edgeKey = (e) => [e.source, e.relation, e.target, e.confidence].join(SEP);
const parseEdgeKey = (k) => {
  const [source, relation, target, confidence] = k.split(SEP);
  return { source, relation, target, confidence };
};

/**
 * 从 target id 取被调用名：先切最后一个 `::`（分开文件路径与符号），再切符号内最后一个 `.`
 * （分开类名与成员名）。文件路径自带的 `.`（`a.mjs`）因此不会污染结果。
 */
function calleeNameOf(targetId) {
  const symIdx = targetId.lastIndexOf('::');
  const sym = symIdx < 0 ? targetId : targetId.slice(symIdx + 2);
  const dotIdx = sym.lastIndexOf('.');
  return dotIdx < 0 ? sym : sym.slice(dotIdx + 1);
}

function loadGraph(file) {
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  return normalizeGraph(g);
}

function normalizeGraph(g) {
  return { nodes: g.nodes ?? [], links: g.links ?? g.edges ?? [] };
}

/** 多重集计数：key → 出现次数。 */
function countEdges(links) {
  const m = new Map();
  for (const e of links) m.set(edgeKey(e), (m.get(edgeKey(e)) ?? 0) + 1);
  return m;
}

/** 展开成 {key, n} 的增/减清单（n 为该键净增/净减条数）。 */
function multisetDiff(beforeCount, afterCount) {
  const added = [];
  const removed = [];
  for (const [k, n] of afterCount) {
    const delta = n - (beforeCount.get(k) ?? 0);
    if (delta > 0) added.push({ key: k, n: delta, ...parseEdgeKey(k) });
  }
  for (const [k, n] of beforeCount) {
    const delta = n - (afterCount.get(k) ?? 0);
    if (delta > 0) removed.push({ key: k, n: delta, ...parseEdgeKey(k) });
  }
  return { added, removed };
}

/** 把 {key,n} 清单摊平成逐条记录（多重集下 n 可能 >1）。 */
function explode(list) {
  const out = [];
  for (const item of list) {
    for (let i = 0; i < item.n; i++) {
      out.push({ source: item.source, relation: item.relation, target: item.target, confidence: item.confidence });
    }
  }
  return out;
}

/**
 * retarget 配对：按 `source + relation + calleeName` 分组，组内新增 / 减少一一配对。
 * 返回 { pairs, unpairedAdded, unpairedRemoved }。
 */
function pairRetargets(addedEdges, removedEdges) {
  const groupKey = (e) => [e.source, e.relation, calleeNameOf(e.target)].join(SEP);
  const removedByGroup = new Map();
  for (const e of removedEdges) {
    const g = groupKey(e);
    if (!removedByGroup.has(g)) removedByGroup.set(g, []);
    removedByGroup.get(g).push(e);
  }
  const pairs = [];
  const unpairedAdded = [];
  for (const a of addedEdges) {
    const bucket = removedByGroup.get(groupKey(a));
    if (bucket && bucket.length > 0) {
      const r = bucket.shift();
      pairs.push({
        source: a.source,
        relation: a.relation,
        calleeName: calleeNameOf(a.target),
        fromTarget: r.target,
        toTarget: a.target,
        fromConfidence: r.confidence,
        toConfidence: a.confidence,
        confidenceChanged: r.confidence !== a.confidence,
      });
    } else {
      unpairedAdded.push(a);
    }
  }
  const unpairedRemoved = [];
  for (const bucket of removedByGroup.values()) unpairedRemoved.push(...bucket);
  return { pairs, unpairedAdded, unpairedRemoved };
}

/**
 * 断言 2 —— 新增 calls 边的 target 必须落在 class 声明上。
 * exportsIndex 为 null 时第二跳（成员来源条目）不可判，逐条记 notEvaluated。
 */
function checkClassTargets(addedCallsEdges, afterNodes, exportsIndex) {
  const nodeById = new Map(afterNodes.map((n) => [n.id, n]));
  const violations = [];
  const notEvaluated = [];
  let ok = 0;
  for (const e of addedCallsEdges) {
    const node = nodeById.get(e.target);
    if (!node) {
      // 悬空由断言 3 单独报，这里不重复计为「非 class」违规
      notEvaluated.push({ ...e, reason: 'target-node-missing（见断言 3）' });
      continue;
    }
    const symIdx = e.target.lastIndexOf('::');
    const file = symIdx < 0 ? '' : e.target.slice(0, symIdx);
    const sym = symIdx < 0 ? e.target : e.target.slice(symIdx + 2);
    const dotIdx = sym.lastIndexOf('.');
    if (dotIdx < 0) {
      // 第一跳：symbol 节点
      if (node.metadata?.exportKind === 'class') ok++;
      else violations.push({ ...e, reason: `symbol 节点 exportKind=${node.metadata?.exportKind ?? '(none)'}` });
      continue;
    }
    // 第二跳：member 节点 file::Cls.name
    const clsName = sym.slice(0, dotIdx);
    const memberName = sym.slice(dotIdx + 1);
    const clsNode = nodeById.get(`${file}::${clsName}`);
    if (!clsNode) {
      violations.push({ ...e, reason: `所属 symbol 节点 ${file}::${clsName} 不存在` });
      continue;
    }
    if (clsNode.metadata?.exportKind !== 'class') {
      violations.push({ ...e, reason: `所属 symbol 节点 exportKind=${clsNode.metadata?.exportKind ?? '(none)'}` });
      continue;
    }
    if (!exportsIndex) {
      notEvaluated.push({ ...e, reason: '未传 --skeletons，成员来源条目（A6）不可判' });
      continue;
    }
    const entries = (exportsIndex[file] ?? []).filter((x) => x.name === clsName && x.kind === 'class');
    const fromClassEntry = entries.some((x) => (x.members ?? []).includes(memberName));
    if (fromClassEntry) ok++;
    else violations.push({ ...e, reason: `成员 ${memberName} 不来自 ${file} 的 kind==='class' 条目 ${clsName}（A6）` });
  }
  return { ok, violations, notEvaluated };
}

/**
 * 裁决 P2-1 + **M4 收口** —— 新增边的**机械**分类（不靠人眼分类）。
 *
 * 1. `retarget`：与某条减少边构成「同 source + 同 `calleeName`、仅 target 变」的配对；
 * 2. `new-symbol`：**source 与 target 两端都**是本阶段新增的节点 —— 只有这一形态是
 *    「新增源码符号自身带来的边」这句话的机械等价物（新文件内部的 contains / 自调用 /
 *    新符号之间的 depends-on），可以在没有人眼参与时判为**自证**；
 * 3. `new-endpoint-manual`：两端**只有一端**是本阶段新增节点。**必须人工回源码核对**，
 *    verdict 里标 `notEvaluated`，绝不当成「已核实为真」；
 * 4. `phase-expected`：该阶段「期望 diff」显式允许的净增（P4 新分支 / P5 MRO 的 calls 边）。
 *
 * 都不沾的记 `unclassified` —— 那是**停工排查**的信号，不是可以四舍五入的余量。
 *
 * ## 为什么第 2 类要同时要求 source 侧也是新节点（M4，两个方向一起收口）
 *
 * 裁决 P2-1 第 2 类的原文是「target 为本阶段新增节点，**且该边经回源码核对为真实调用**」，
 * 工具此前只机械化了前半句：
 *
 * - **fail-open 方向**：一条**凭空捏造**的假边（source 既有、target 指向本阶段新增符号）
 *   照样落进 `new-symbol` ⇒ `unclassified = 0` ⇒ `allPass = true`。
 *   「未被归入 unclassified」被当成了「已核实为真」，门禁在这一维度整体放行。
 * - **假阳性方向（W4）**：「新文件里的函数调用既有符号」这条完全正常的新增边
 *   （source 新、target 旧）会被判成 `unclassified` 而误报停工。
 *
 * 两个方向的根因是同一个：**只看 target 一端**。收口后单端新增一律进人工核对清单，
 * 机械层只保留「两端全新」这个真正自证的子集。
 *
 * @param addedEdges - 摊平后的新增边
 * @param unpairedAddedCalls - `pairRetargets` 判出的**未**配对新增 calls 边（对象引用，用于反查已配对）
 * @param beforeNodes - 上一阶段基线的节点集
 * @param phase - 阶段标签，决定是否放行第 4 类
 */
function classifyAddedEdges(addedEdges, unpairedAddedCalls, beforeNodes, phase) {
  const beforeIds = new Set(beforeNodes.map((n) => n.id));
  const unpaired = new Set(unpairedAddedCalls);
  const netIncreaseAllowed = phase === 'P4' || phase === 'P5';
  const buckets = {
    retarget: [],
    'new-symbol': [],
    'new-endpoint-manual': [],
    'phase-expected': [],
    unclassified: [],
  };
  for (const e of addedEdges) {
    const sourceIsNew = !beforeIds.has(e.source);
    const targetIsNew = !beforeIds.has(e.target);
    let cls;
    if (e.relation === 'calls' && !unpaired.has(e)) cls = 'retarget';
    else if (sourceIsNew && targetIsNew) cls = 'new-symbol';
    else if (sourceIsNew || targetIsNew) cls = 'new-endpoint-manual';
    else if (netIncreaseAllowed && e.relation === 'calls') cls = 'phase-expected';
    else cls = 'unclassified';
    buckets[cls].push({ ...e, addedEdgeClass: cls, sourceIsNew, targetIsNew });
  }
  return buckets;
}

/** 断言 3 —— 新增边端点必须都在 after 图节点集中。 */
function checkDangling(addedEdges, afterNodes) {
  const ids = new Set(afterNodes.map((n) => n.id));
  const dangling = [];
  for (const e of addedEdges) {
    const missing = [];
    if (!ids.has(e.source)) missing.push('source');
    if (!ids.has(e.target)) missing.push('target');
    if (missing.length > 0) dangling.push({ ...e, missing });
  }
  return dangling;
}

// ───────────────────────────────────────────────────────────
// 主流程
// ───────────────────────────────────────────────────────────

export function diffGraphs(before, after, options = {}) {
  const beforeCount = countEdges(before.links);
  const afterCount = countEdges(after.links);
  const { added, removed } = multisetDiff(beforeCount, afterCount);
  const addedEdges = explode(added);
  const removedEdges = explode(removed);

  const addedCalls = addedEdges.filter((e) => e.relation === 'calls');
  const removedCalls = removedEdges.filter((e) => e.relation === 'calls');

  const retarget = pairRetargets(addedCalls, removedCalls);
  const classCheck = checkClassTargets(addedCalls, after.nodes, options.exportsIndex ?? null);
  const dangling = checkDangling(addedEdges, after.nodes);

  const phase = options.phase ?? null;
  const addedClasses = classifyAddedEdges(addedEdges, retarget.unpairedAdded, before.nodes, phase);
  const retargetLimit = phase ? RETARGET_LIMITS[phase] : null;
  const expect = phase ? PHASE_EXPECT[phase] : null;

  const verdicts = [];
  if (expect === 'only-decrease') {
    verdicts.push({
      id: 'P2-只减不增（例外：retarget 对）',
      pass: retarget.unpairedAdded.length === 0,
      detail: `不成对新增边 = ${retarget.unpairedAdded.length}（须为 0）；retarget 对 = ${retarget.pairs.length}`,
    });
  }
  if (expect === 'only-increase') {
    verdicts.push({
      id: `${phase}-只增不减（例外：成对 retarget${retargetLimit ? ` ≤${retargetLimit}` : ''}）`,
      pass:
        retarget.unpairedRemoved.length === 0 &&
        (retargetLimit === null || retarget.pairs.length <= retargetLimit),
      detail: `不成对减少边 = ${retarget.unpairedRemoved.length}（须为 0）；retarget 对 = ${retarget.pairs.length}${retargetLimit ? `（上限 ${retargetLimit}）` : ''}`,
    });
  }
  if (expect === 'no-removal') {
    verdicts.push({
      id: 'P3-边集不得有减少（抽取层只加字段，resolver 未接线）',
      pass: removedEdges.length === 0,
      detail: `减少边 = ${removedEdges.length}（须为 0）`,
    });
  }
  // 裁决 P2-1：新增边逐条归类，无法归类即停工
  verdicts.push({
    id: '裁决 P2-1 — 新增边逐条归入分类（retarget / 两端全新自证 / 单端新增待人工 / 阶段期望）',
    pass: addedClasses.unclassified.length === 0,
    detail:
      `retarget ${addedClasses.retarget.length} / 两端全新自证 ${addedClasses['new-symbol'].length} / ` +
      `单端新增待人工核对 ${addedClasses['new-endpoint-manual'].length} / ` +
      `阶段期望 ${addedClasses['phase-expected'].length} / **无法归类 ${addedClasses.unclassified.length}**（须为 0）`,
  });
  // M4：单端新增边机械层不可判 —— 显式标 notEvaluated，禁止把它算进「已核实为真」
  verdicts.push({
    id: 'M4 — 单端新增边（source/target 只有一端是本阶段新增）须**人工回源码核对**',
    notEvaluated: true,
    pass: true,
    detail:
      `待人工核对 ${addedClasses['new-endpoint-manual'].length} 条 —— ` +
      '本项为 **notEvaluated**：机械层只判「归得了类」，**不构成「已核实为真」的证据**。' +
      'unclassified = 0 ≠ 已核实；清单见 lists.addedManualAuditEdges，必须逐条回源码核对后写进 attribution。',
  });
  // 裁决 P2-2：断言 2 的作用域限定为 P4 / P5 新分支与 MRO 分支产出的边。
  // 不适用时**不静默按通过处理**——照旧算出违规数并写进 detail，只是不计入 allPass。
  const assertion2Applies = phase === null || ASSERTION2_PHASES.has(phase);
  verdicts.push({
    id: '断言 2 — 新增 calls 边 target 落在非 class 声明上的条数 = 0',
    applicable: assertion2Applies,
    pass: assertion2Applies ? classCheck.violations.length === 0 : true,
    detail:
      (assertion2Applies
        ? ''
        : `【裁决 P2-2：本断言只对 P4 / P5 新分支与 MRO 分支产出的 calls 边生效，${phase} 不适用；下列为信息项】`) +
      `违规 ${classCheck.violations.length} / 通过 ${classCheck.ok} / 未判定 ${classCheck.notEvaluated.length}` +
      (options.exportsIndex ? '' : '（未传 --skeletons：A6 第二跳未判定）'),
  });
  verdicts.push({
    id: '断言 3 — 无悬空新增边',
    pass: dangling.length === 0,
    detail: `悬空新增边 = ${dangling.length}`,
  });

  const nonZero = addedEdges.length > 0 || removedEdges.length > 0;

  return {
    beforeEdges: before.links.length,
    afterEdges: after.links.length,
    beforeCallsEdges: before.links.filter((e) => e.relation === 'calls').length,
    afterCallsEdges: after.links.filter((e) => e.relation === 'calls').length,
    addedTotal: addedEdges.length,
    removedTotal: removedEdges.length,
    addedCalls: addedCalls.length,
    removedCalls: removedCalls.length,
    addedByRelation: tally(addedEdges),
    removedByRelation: tally(removedEdges),
    retargetPairs: retarget.pairs.length,
    retargetPairsWithConfidenceChange: retarget.pairs.filter((p) => p.confidenceChanged).length,
    unpairedAddedCalls: retarget.unpairedAdded.length,
    unpairedRemovedCalls: retarget.unpairedRemoved.length,
    assertion2: {
      ok: classCheck.ok,
      violations: classCheck.violations.length,
      notEvaluated: classCheck.notEvaluated.length,
      exportsIndexSupplied: Boolean(options.exportsIndex),
    },
    assertion3: { danglingAdded: dangling.length },
    addedEdgeClasses: {
      retarget: addedClasses.retarget.length,
      'new-symbol': addedClasses['new-symbol'].length,
      'new-endpoint-manual': addedClasses['new-endpoint-manual'].length,
      'phase-expected': addedClasses['phase-expected'].length,
      unclassified: addedClasses.unclassified.length,
    },
    /** M4：机械层未判定的条数 —— 消费方必须把它当成「尚未核实」，不是「已通过」。 */
    manualAuditRequired: addedClasses['new-endpoint-manual'].length + classCheck.notEvaluated.length,
    verdicts,
    allPass: verdicts.every((v) => v.pass),
    /**
     * M4：`allPass` 只代表**机械判据**全过。本标志为 true 时它**不等于**
     * 「本阶段 diff 已核实为真」——结论必须由 attribution 里的人工核对补齐。
     */
    machineVerdictOnly:
      addedClasses['new-endpoint-manual'].length > 0 || classCheck.notEvaluated.length > 0,
    dedupOrderHint: nonZero
      ? '非零 diff：归因到本阶段前须先排除 graph-builder.ts:422-437 第五路 dedup 的 first-write-wins 顺序敏感性（B5）'
      : null,
    lists: {
      retargetPairs: retarget.pairs,
      unpairedAddedCalls: retarget.unpairedAdded,
      unpairedRemovedCalls: retarget.unpairedRemoved,
      addedNonCalls: addedEdges.filter((e) => e.relation !== 'calls'),
      removedNonCalls: removedEdges.filter((e) => e.relation !== 'calls'),
      assertion2Violations: classCheck.violations,
      assertion2NotEvaluated: classCheck.notEvaluated,
      danglingAdded: dangling,
      addedNewSymbolEdges: addedClasses['new-symbol'],
      addedManualAuditEdges: addedClasses['new-endpoint-manual'],
      addedUnclassifiedEdges: addedClasses.unclassified,
    },
  };
}

function tally(edges) {
  const m = {};
  for (const e of edges) m[e.relation] = (m[e.relation] ?? 0) + 1;
  return m;
}

// ───────────────────────────────────────────────────────────
// self-test（T002 验收：零差 / retarget 识别 / 悬空识别）
// ───────────────────────────────────────────────────────────

function selfTest() {
  const mkNode = (id, exportKind) => ({ id, metadata: { unifiedKind: 'symbol', ...(exportKind ? { exportKind } : {}) } });
  const baseNodes = [
    mkNode('a.ts::Foo', 'class'),
    mkNode('a.ts::Foo.run'),
    mkNode('b.ts::Foo', 'class'),
    mkNode('b.ts::Foo.run'),
    mkNode('c.ts::Bar', 'interface'),
    mkNode('c.ts::Bar.run'),
    mkNode('u.ts::use', 'function'),
  ];
  const g = (links, nodes = baseNodes) => ({ nodes, links });
  const E = (source, target, confidence = 'medium', relation = 'calls') => ({ source, target, relation, confidence, directional: true });

  const results = [];
  const assert = (name, cond, extra = '') => results.push({ name, pass: Boolean(cond), extra });

  // 1) 两份内容相同 → 零差
  const same = g([E('u.ts::use', 'a.ts::Foo.run'), E('u.ts::use', 'a.ts::Foo.run')]);
  const r1 = diffGraphs(same, JSON.parse(JSON.stringify(same)));
  assert('相同图零差', r1.addedTotal === 0 && r1.removedTotal === 0, `added=${r1.addedTotal} removed=${r1.removedTotal}`);

  // 2) 一增一减（同 source 同 calleeName，仅 target 变）→ 识别为 retarget 对
  const beforeR = g([E('u.ts::use', 'b.ts::Foo.run')]);
  const afterR = g([E('u.ts::use', 'a.ts::Foo.run')]);
  const r2 = diffGraphs(beforeR, afterR, { phase: 'P2' });
  assert(
    'retarget 对识别',
    r2.retargetPairs === 1 && r2.unpairedAddedCalls === 0 && r2.unpairedRemovedCalls === 0,
    `pairs=${r2.retargetPairs} unpairedAdd=${r2.unpairedAddedCalls} unpairedRm=${r2.unpairedRemovedCalls}`,
  );
  assert('retarget 场景下 P2 判定通过', r2.verdicts[0].pass === true, r2.verdicts[0].detail);

  // 3) 不成对新增 → P2 判定失败
  const r3 = diffGraphs(g([]), g([E('u.ts::use', 'a.ts::Foo.run')]), { phase: 'P2' });
  assert('不成对新增被 P2 拦下', r3.verdicts[0].pass === false && r3.unpairedAddedCalls === 1, r3.verdicts[0].detail);

  // 4) 悬空新增边 → 断言 3 失败
  const r4 = diffGraphs(g([]), g([E('u.ts::use', 'z.ts::Ghost.run')]));
  assert('悬空新增边被识别', r4.assertion3.danglingAdded === 1, JSON.stringify(r4.lists.danglingAdded));

  // 5) target 落在 interface 上 → 断言 2 失败
  const r5 = diffGraphs(g([]), g([E('u.ts::use', 'c.ts::Bar.run')]));
  assert('interface-target 被断言 2 拦下', r5.assertion2.violations === 1, JSON.stringify(r5.lists.assertion2Violations));

  // 6) A6 严判：成员只来自同名 interface 条目 → 违规
  const exportsIndex = {
    'a.ts': [
      { name: 'Foo', kind: 'interface', members: ['onlyOnInterface'] },
      { name: 'Foo', kind: 'class', members: ['run'] },
    ],
  };
  const nodes6 = [...baseNodes, mkNode('a.ts::Foo.onlyOnInterface')];
  const r6a = diffGraphs(g([], nodes6), g([E('u.ts::use', 'a.ts::Foo.run')], nodes6), { exportsIndex });
  assert('A6 严判：class 条目成员放行', r6a.assertion2.violations === 0 && r6a.assertion2.ok === 1, JSON.stringify(r6a.assertion2));
  const r6b = diffGraphs(g([], nodes6), g([E('u.ts::use', 'a.ts::Foo.onlyOnInterface')], nodes6), { exportsIndex });
  assert('A6 严判：interface 条目成员拦下', r6b.assertion2.violations === 1, JSON.stringify(r6b.lists.assertion2Violations));

  // 7) 未传 --skeletons 时 member 边记 notEvaluated 而非静默通过
  const r7 = diffGraphs(g([]), g([E('u.ts::use', 'a.ts::Foo.run')]));
  assert(
    '缺 skeletons 时 A6 腿记 notEvaluated',
    r7.assertion2.notEvaluated === 1 && r7.assertion2.exportsIndexSupplied === false,
    JSON.stringify(r7.assertion2),
  );

  // 8) 多重集：同键 2 条 → 1 条应报减少 1（集合去重会漏）
  const r8 = diffGraphs(
    g([E('u.ts::use', 'a.ts::Foo.run'), E('u.ts::use', 'a.ts::Foo.run')]),
    g([E('u.ts::use', 'a.ts::Foo.run')]),
  );
  assert('多重集计数（同键重复）', r8.removedTotal === 1 && r8.addedTotal === 0, `removed=${r8.removedTotal}`);

  // 9) P4 retarget 上限
  const r9 = diffGraphs(beforeR, afterR, { phase: 'P4' });
  assert('P4 成对 retarget 放行', r9.verdicts[0].pass === true, r9.verdicts[0].detail);

  // 10) M4 收口后：source 既有、target 新增 ⇒ **不再**自动算「自证」，进人工核对清单
  const newSymNodes = [...baseNodes, mkNode('n.ts::brandNew', 'function')];
  const r10 = diffGraphs(
    g([], baseNodes),
    g([E('u.ts::use', 'n.ts::brandNew')], newSymNodes),
    { phase: 'P3' },
  );
  assert(
    'M4 — 单端新增（target 新 / source 旧）进人工核对清单而非自证',
    r10.addedEdgeClasses['new-endpoint-manual'] === 1 &&
      r10.addedEdgeClasses['new-symbol'] === 0 &&
      r10.addedEdgeClasses.unclassified === 0 &&
      r10.machineVerdictOnly === true,
    JSON.stringify(r10.addedEdgeClasses),
  );
  assert(
    'M4 — 单端新增时 verdict 标 notEvaluated 且明说 unclassified=0 不等于已核实',
    (() => {
      const v = r10.verdicts.find((x) => x.id.startsWith('M4'));
      return v?.notEvaluated === true && v.detail.includes('不构成') && r10.manualAuditRequired >= 1;
    })(),
    JSON.stringify(r10.verdicts.find((x) => x.id.startsWith('M4'))),
  );

  // 10b) M4 fail-open 构造验证（§13 原文的攻击形态）：一条**凭空捏造**的假边，
  //      source 既有、target 指向本阶段新增符号 —— 旧口径下 unclassified=0 且 allPass=true。
  //      收口后它必须落进人工核对清单，且 machineVerdictOnly=true 明示「未核实」。
  const forgedNodes = [...baseNodes, mkNode('n.ts::brandNew', 'function')];
  const r10b = diffGraphs(
    g([], baseNodes),
    g([E('c.ts::Bar.run', 'n.ts::brandNew')], forgedNodes), // 源码里根本不存在的调用
    { phase: 'P3' },
  );
  assert(
    'M4 — 捏造假边（target 新）不得被机械层判成已核实',
    r10b.addedEdgeClasses['new-symbol'] === 0 &&
      r10b.addedEdgeClasses['new-endpoint-manual'] === 1 &&
      r10b.machineVerdictOnly === true,
    JSON.stringify(r10b.addedEdgeClasses),
  );

  // 10c) M4 反向假阳性（W4）：**新文件里的函数调用既有符号** —— source 新、target 旧。
  //      旧口径下会被误判 unclassified 而误报停工；收口后进人工核对清单。
  const newFileNodes = [...baseNodes, mkNode('n.ts::newCaller', 'function')];
  const r10c = diffGraphs(
    g([], baseNodes),
    g([E('n.ts::newCaller', 'a.ts::Foo.run')], newFileNodes),
    { phase: 'P3' },
  );
  assert(
    'M4/W4 — 新文件调用既有符号不得被误判 unclassified',
    r10c.addedEdgeClasses.unclassified === 0 && r10c.addedEdgeClasses['new-endpoint-manual'] === 1,
    JSON.stringify(r10c.addedEdgeClasses),
  );

  // 10d) 两端全新 ⇒ 唯一可机械自证的子集（新文件内部的边）
  const bothNewNodes = [...baseNodes, mkNode('n.ts::newCaller', 'function'), mkNode('n.ts::newCallee', 'function')];
  const r10d = diffGraphs(
    g([], baseNodes),
    g([E('n.ts::newCaller', 'n.ts::newCallee')], bothNewNodes),
    { phase: 'P3' },
  );
  assert(
    'M4 — 两端全新才算「新符号自证」，且不产生 notEvaluated',
    r10d.addedEdgeClasses['new-symbol'] === 1 &&
      r10d.addedEdgeClasses['new-endpoint-manual'] === 0 &&
      r10d.manualAuditRequired === 0 &&
      r10d.machineVerdictOnly === false,
    JSON.stringify({ cls: r10d.addedEdgeClasses, manual: r10d.manualAuditRequired }),
  );

  // 11) 反例：target **早已存在**于基线节点集 ⇒ 不得混进「新符号自证」，P3 下判无法归类
  const r11 = diffGraphs(g([]), g([E('u.ts::use', 'a.ts::Foo.run')]), { phase: 'P3' });
  assert(
    '既有节点的新增边不得被当成新符号自证',
    r11.addedEdgeClasses['new-symbol'] === 0 && r11.addedEdgeClasses.unclassified === 1,
    JSON.stringify(r11.addedEdgeClasses),
  );
  assert(
    '无法归类的新增边让判定失败',
    r11.verdicts.some((v) => v.id.startsWith('裁决 P2-1') && v.pass === false),
    JSON.stringify(r11.verdicts.map((v) => [v.id, v.pass])),
  );

  // 12) P4 下同一条边落「阶段期望净增」而非「无法归类」
  const r12 = diffGraphs(g([]), g([E('u.ts::use', 'a.ts::Foo.run')]), { phase: 'P4' });
  assert(
    'P4 净增 calls 边归入阶段期望',
    r12.addedEdgeClasses['phase-expected'] === 1 && r12.addedEdgeClasses.unclassified === 0,
    JSON.stringify(r12.addedEdgeClasses),
  );

  // 13) 裁决 P2-2：断言 2 在 P2 / P3 不适用，但违规数照旧算出并写进 detail（不静默）
  const r13 = diffGraphs(g([]), g([E('u.ts::use', 'c.ts::Bar.run')]), { phase: 'P3' });
  const a2 = r13.verdicts.find((v) => v.id.startsWith('断言 2'));
  assert(
    'P3 下断言 2 标记不适用但不静默',
    a2.applicable === false && a2.pass === true && r13.assertion2.violations === 1 && a2.detail.includes('裁决 P2-2'),
    JSON.stringify({ applicable: a2.applicable, violations: r13.assertion2.violations }),
  );
  const r13b = diffGraphs(g([]), g([E('u.ts::use', 'c.ts::Bar.run')]), { phase: 'P4' });
  assert(
    'P4 下断言 2 照旧生效',
    r13b.verdicts.find((v) => v.id.startsWith('断言 2')).pass === false,
    JSON.stringify(r13b.assertion2),
  );

  // 14) P3 期望：边集不得有减少
  const r14 = diffGraphs(g([E('u.ts::use', 'a.ts::Foo.run')]), g([]), { phase: 'P3' });
  assert(
    'P3 减少边被拦下',
    r14.verdicts.some((v) => v.id.startsWith('P3-') && v.pass === false),
    JSON.stringify(r14.verdicts.map((v) => [v.id, v.pass])),
  );

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.extra ? ` — ${r.extra}` : ''}`);
  console.log(`\nself-test: ${results.length - failed.length}/${results.length} 通过`);
  return failed.length === 0 ? 0 : 1;
}

// ───────────────────────────────────────────────────────────
// CLI
// ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { positional: [], limit: 40 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') opts.selfTest = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--phase') opts.phase = argv[++i];
    else if (a === '--skeletons') opts.skeletons = argv[++i];
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else opts.positional.push(a);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.selfTest) process.exit(selfTest());

  const [beforeFile, afterFile] = opts.positional;
  if (!beforeFile || !afterFile) {
    console.error('用法: node edge-diff.mjs <before-graph.json> <after-graph.json> [--phase P2|P3|P4|P5] [--skeletons exports.json] [--json]');
    process.exit(2);
  }
  if (opts.phase && !PHASE_EXPECT[opts.phase]) {
    console.error(`--phase 只接受 P2 / P3 / P4 / P5，收到 ${opts.phase}`);
    process.exit(2);
  }

  let exportsIndex = null;
  if (opts.skeletons) {
    const raw = JSON.parse(fs.readFileSync(opts.skeletons, 'utf8'));
    exportsIndex = raw.exportsIndex ?? raw;
  }

  const before = loadGraph(beforeFile);
  const after = loadGraph(afterFile);
  const result = diffGraphs(before, after, { phase: opts.phase ?? null, exportsIndex });

  if (!opts.json) {
    const L = opts.limit;
    console.log(`# F260 逐边 diff\n`);
    console.log(`before: ${beforeFile}  (${result.beforeEdges} 边 / ${result.beforeCallsEdges} calls)`);
    console.log(`after : ${afterFile}  (${result.afterEdges} 边 / ${result.afterCallsEdges} calls)`);
    console.log(`\n新增 ${result.addedTotal} 条 ${JSON.stringify(result.addedByRelation)} / 减少 ${result.removedTotal} 条 ${JSON.stringify(result.removedByRelation)}`);
    console.log(`retarget 对 ${result.retargetPairs}（其中 confidence 也变 ${result.retargetPairsWithConfidenceChange}）`);
    console.log(`不成对新增 calls ${result.unpairedAddedCalls} / 不成对减少 calls ${result.unpairedRemovedCalls}`);
    console.log(`新增边三分类（裁决 P2-1）: ${JSON.stringify(result.addedEdgeClasses)}`);
    if (result.dedupOrderHint) console.log(`\n⚠ ${result.dedupOrderHint}`);
    const dump = (title, arr) => {
      if (arr.length === 0) return;
      console.log(`\n## ${title}（${arr.length} 条，最多列 ${L}）`);
      for (const e of arr.slice(0, L)) console.log('  ' + JSON.stringify(e));
      if (arr.length > L) console.log(`  … 其余 ${arr.length - L} 条见 --json 输出`);
    };
    dump('retarget 对', result.lists.retargetPairs);
    dump('不成对新增 calls 边', result.lists.unpairedAddedCalls);
    dump('不成对减少 calls 边', result.lists.unpairedRemovedCalls);
    dump('新增非 calls 边', result.lists.addedNonCalls);
    dump('减少非 calls 边', result.lists.removedNonCalls);
    dump('新增边 — 两端全新自证（裁决 P2-1 第 2 类，M4 收口后）', result.lists.addedNewSymbolEdges);
    dump('新增边 — **单端新增，须人工回源码核对**（M4，notEvaluated）', result.lists.addedManualAuditEdges);
    dump('新增边 — **无法归类**（须为空，否则停工排查）', result.lists.addedUnclassifiedEdges);
    dump('断言 2 违规', result.lists.assertion2Violations);
    dump('断言 2 未判定', result.lists.assertion2NotEvaluated);
    dump('断言 3 悬空新增边', result.lists.danglingAdded);
    console.log('\n## 判定');
    for (const v of result.verdicts) {
      const mark = v.notEvaluated ? '?' : v.pass ? '✓' : '✗';
      console.log(`  ${mark} ${v.id} — ${v.detail}`);
    }
    console.log(`\n结论（**机械判据**）: ${result.allPass ? 'PASS' : 'FAIL'}`);
    if (result.machineVerdictOnly) {
      console.log(
        `⚠ 存在 ${result.manualAuditRequired} 条机械层 notEvaluated 的项 —— ` +
          'PASS **不代表**已核实为真，必须在 attribution 里逐条人工回源码核对（M4）',
      );
    }
    console.log('\n--- JSON ---');
  }
  console.log(JSON.stringify(result, null, 2));
  // 用 exitCode 而非 process.exit()：后者会截断尚未 flush 的 stdout，
  // 管道消费方会拿到半截 JSON 而误判成产物损坏。
  process.exitCode = result.allPass ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
