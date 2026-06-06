/**
 * Feature 155 — Agent-Context MCP Tools 的查询基建。
 *
 * 暴露给 src/mcp/agent-context-tools.ts 的工具函数：
 *   - bfsTraverse：反向 / 正向 BFS，遍历前 budget 截断（FR-012）
 *   - canonicalizeSymbolId：把用户传入的 symbol id 归一到 graph 实际 id
 *   - resolveSymbolFuzzy：symbol-not-found 时分层 fuzzy 解析 + 高置信度自动 resolve（Feature 174）
 *   - computeRiskTier：按 directCallers + transitive 判定 low / medium / high
 *   - getReverseAdjacency：反向邻接表 lazy 构建 + LRU 缓存
 *
 * 输入合同：
 *   query-helpers 直接消费 GraphJSON `{nodes, links}`（与 graph.json 序列化形态一致），
 *   不依赖 UnifiedGraph in-memory 类型，避免与 build-time 路径耦合。
 *
 * 不变量：
 *   - 所有函数对 graphData 只读（禁止修改 nodes / links / metadata）
 *   - confidence 数值直接读 link.confidenceScore；缺失时尝试 link.confidence
 *     通过 CONFIDENCE_SCORES 映射；仍失败 → 跳过该边并记 'missing-confidence-score' warning
 *   - canonicalize 控制字符 / 非 UTF-8 → 返回 null（调用方按 invalid-symbol-id 处理）
 *   - reverse adjacency cache key = `${graphPath}::${mtimeMs}::${sizeBytes}::${linksLength}::${relations}`
 *     graph.json 重生成（mtime/size 必变）→ 自动 evict
 */

import path from 'node:path';
import type {
  GraphJSON,
  GraphEdge,
  GraphNode,
  ConfidenceLevel,
} from '../panoramic/graph/graph-types.js';
import { CONFIDENCE_SCORES } from '../panoramic/graph/confidence-mapper.js';

// ============================================================
// 类型定义
// ============================================================

/** BFS 方向语义 */
export type BfsDirection = 'upstream' | 'downstream' | 'both';

/** BFS 遍历输入选项 */
export interface BfsTraverseOptions {
  /** 遍历深度上限，0 表示不展开（仅返回 start node 自身的可达邻居计数为 0） */
  depth: number;
  /** 数值置信度阈值（0..1），按 link.confidenceScore >= minConfidence 过滤 */
  minConfidence: number;
  /** BFS 方向 */
  direction: BfsDirection;
  /** 输出节点上限（不含 start node），遍历前严格截断 */
  budget: number;
  /** 多 startId 共享 visited Set（detect_changes 跨 changedSymbol 共享），可选 */
  sharedVisited?: Set<string>;
  /** 用作 reverse adjacency cache key 的一部分 */
  graphPath: string;
  /** 用作 reverse adjacency cache key 的一部分（graph.json mtime） */
  graphMtimeMs: number;
  /** 用作 reverse adjacency cache key 的一部分（graph.json 字节数） */
  graphSizeBytes: number;
  /** 仅遍历指定 relation 的边（default ['calls']） */
  relations?: ReadonlyArray<string>;
}

/** BFS 输出条目 */
export interface BfsAffected {
  id: string;
  depth: number;
  confidence: number;
  reason: string;
  /** 从 start 到 self 的 ancestor 链（含 self），可选用于自动化测试 */
  path: string[];
}

/** BFS 输出 */
export interface BfsTraverseResult {
  affected: BfsAffected[];
  warnings: string[];
}

/** 反向邻接表项 */
interface ReverseAdjEntry {
  sourceId: string;
  edge: GraphEdge;
}

/** 反向邻接表（target id → 进入此节点的 inbound 边列表） */
export type ReverseAdj = Map<string, ReverseAdjEntry[]>;

// ============================================================
// 常量
// ============================================================

const DEFAULT_RELATIONS: ReadonlyArray<string> = ['calls'];

/** 控制字符正则（包含 \x00-\x1f, \x7f；保留制表符不在内是因为 git diff 路径不会含 \t） */
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

/** baseRef / symbol id 不可见字符快速校验 */
// NON_PRINTABLE_RE removed - CONTROL_CHAR_RE is sufficient

// ============================================================
// confidence 数值解析
// ============================================================

/**
 * 解析一条边的 confidence 数值。
 *
 * 优先级：edge.confidenceScore（已含数字）→ edge.confidence 走 CONFIDENCE_SCORES 映射 → null。
 *
 * 返回 null 表示"无法判定 confidence"，调用方应跳过该边并记 warning。
 */
export function resolveEdgeConfidence(edge: GraphEdge): number | null {
  if (typeof edge.confidenceScore === 'number' && Number.isFinite(edge.confidenceScore)) {
    return edge.confidenceScore;
  }
  const tier = edge.confidence as ConfidenceLevel | undefined;
  if (tier !== undefined && tier in CONFIDENCE_SCORES) {
    return CONFIDENCE_SCORES[tier];
  }
  return null;
}

// ============================================================
// canonicalize symbol id
// ============================================================

/**
 * 把用户输入的 target / symbolId 归一到 graph 实际 id。
 *
 * 归一规则（按顺序尝试，命中即返回）：
 *   1. graph.nodes 中存在字面相等的 id → 直接返回
 *   2. 把 `./prefix` `a/` `b/` 等前缀剥掉 → 再查
 *   3. 三段输入 `A::B::C` 容错为 `A::B.C` → 再查（Codex round-1 C-1 修订）
 *   4. 把绝对路径 → 仓库相对路径（按 graphData.graph?.metadata 或 projectRoot 选项）→ 再查
 *
 * 失败返回 null，调用方按 symbol-not-found 处理（建议同时调 resolveSymbolFuzzy 提候选/自动 resolve）。
 *
 * 控制字符 / 非 UTF-8 / 空字符串段输入返回 null（调用方按 invalid-symbol-id 处理）。
 */
export function canonicalizeSymbolId(
  rawTarget: string,
  graphData: Readonly<GraphJSON>,
  options: { projectRoot?: string } = {},
): { canonicalId: string | null; reason: 'ok' | 'not-found' | 'invalid' } {
  if (typeof rawTarget !== 'string') {
    return { canonicalId: null, reason: 'invalid' };
  }
  // 入口先 NFC normalize + trim，避免空白 / unicode 表示差异让用户输入被误判
  const normalized = rawTarget.normalize('NFC').trim();
  if (normalized.length === 0) {
    return { canonicalId: null, reason: 'invalid' };
  }
  if (CONTROL_CHAR_RE.test(normalized)) {
    return { canonicalId: null, reason: 'invalid' };
  }
  // 拒绝多 `::` 或空段
  const segs = normalized.split('::');
  if (segs.some((s) => s.length === 0)) {
    return { canonicalId: null, reason: 'invalid' };
  }

  // 直接命中
  if (hasNode(graphData, normalized)) {
    return { canonicalId: normalized, reason: 'ok' };
  }

  const candidates: string[] = [];

  // 剥前缀：./ a/ b/
  const stripped = normalized
    .replace(/^\.\//, '')
    .replace(/^a\//, '')
    .replace(/^b\//, '');
  if (stripped !== normalized) {
    candidates.push(stripped);
  }

  // 三段 → 两段（A::B::C → A::B.C）
  if (segs.length >= 3) {
    const merged = segs[0] + '::' + segs.slice(1).join('.');
    candidates.push(merged);
  }

  // 绝对路径 → repo-relative（按 projectRoot 截断）
  const projectRoot = options.projectRoot;
  if (projectRoot && normalized.startsWith(projectRoot)) {
    const relative = path.relative(projectRoot, normalized);
    if (relative.length > 0) {
      candidates.push(relative);
    }
  }

  // repo-relative → 绝对路径（graph 实际可能用绝对 path 形态，例如 baseline 跑出的 graph.json）
  if (projectRoot && !path.isAbsolute(normalized.split('::')[0] ?? '')) {
    const filePart = normalized.split('::')[0] ?? '';
    const symbolPart = normalized.includes('::') ? normalized.slice(filePart.length) : '';
    const abs = path.join(projectRoot, filePart) + symbolPart;
    candidates.push(abs);
  }

  for (const c of candidates) {
    if (hasNode(graphData, c)) {
      return { canonicalId: c, reason: 'ok' };
    }
  }

  return { canonicalId: null, reason: 'not-found' };
}

function hasNode(graphData: Readonly<GraphJSON>, id: string): boolean {
  for (const n of graphData.nodes) {
    if (n.id === id) return true;
  }
  return false;
}

// ============================================================
// fuzzy match — 分层解析（Feature 174）
// ============================================================

/** fuzzy match 命中层次 */
export type MatchKind = 'exact' | 'path-suffix' | 'partial-name' | 'levenshtein';

/** 单个 fuzzy match 候选结果 */
export interface SymbolCandidate {
  /** canonical symbol id */
  id: string;
  /** 置信度 0~1（各层规则见 resolveSymbolFuzzy 注释） */
  confidence: number;
  /** 命中层次 */
  matchKind: MatchKind;
}

/** resolveSymbolFuzzy 返回值 */
export interface FuzzyResolveResult {
  /** 按 confidence 降序、长度 ≤ limit 的候选；去重后唯一且高分时触发 autoResolved */
  candidates: SymbolCandidate[];
  /** 去重后唯一候选且 confidence ≥ autoResolveThreshold(默认 0.9) 时为 true */
  autoResolved: boolean;
}

/** resolveSymbolFuzzy 选项 */
export interface FuzzyResolveOptions {
  /** 透传给 canonicalizeSymbolId 做绝对↔相对路径归一 */
  projectRoot?: string;
  /** 纯函数内部候选上限（默认 10，测试可设更大值；handler 层另行 clamp 到 top-3） */
  limit?: number;
  /** 自动 resolve 阈值（默认 0.9；production handler floor 不得低于 0.9） */
  autoResolveThreshold?: number;
}

/** path-suffix 层锁定的精确常量（FR-003 边界规则：恰好满足 >= 0.9） */
const PATH_SUFFIX_CONFIDENCE = 0.9;
/** autoResolve 阈值下限（production floor，FR-012） */
const AUTO_RESOLVE_FLOOR = 0.9;
/** Levenshtein 相对距离阈值（distance/maxLen ≤ 0.35 才纳入候选） */
const LEVENSHTEIN_RATIO = 0.35;
/** 超过此长度跳过 Levenshtein 层，防 O(m×n) 退化（FR-010） */
const LEVENSHTEIN_MAX_QUERY_LEN = 512;

/**
 * 取 nodeId 文件分隔符之后的 symbol 段（无分隔符则返回整个 nodeId）。
 *
 * 兼容两种分隔符（与 moduleFileFromId 取最早分隔符一致）：
 *   - Feature 151 格式 `<file>::<symbolName>`（例 `engine.py::Value.__add__`）
 *   - 旧 panoramic 格式 `<file>#<symbolName>`（例 `engine.py#Value`）
 * 兼容 `#` 避免对旧格式 graph 的 partial-name 回归（Codex GREEN W-2）。
 */
function symbolSeg(nodeId: string): string {
  const idxColon = nodeId.indexOf('::');
  const idxHash = nodeId.indexOf('#');
  let cut = -1;
  let sepLen = 0;
  if (idxColon >= 0 && (idxHash < 0 || idxColon <= idxHash)) {
    cut = idxColon;
    sepLen = 2;
  } else if (idxHash >= 0) {
    cut = idxHash;
    sepLen = 1;
  }
  return cut >= 0 ? nodeId.slice(cut + sepLen) : nodeId;
}

/**
 * 生成 typo 比对用的多种表示集合（Feature 174 C-1 修复）。
 *
 * 不能只对完整 node.id 算 Levenshtein —— `micrograd/` 等 package 前缀会把 typo 距离
 * 推到阈值之外。这里额外提供去前缀的 `basename(file)::symbol` 与纯 symbol 表示，
 * 让拼写错误的相对距离回落到可命中范围。
 */
function nodeMatchReps(nodeId: string): string[] {
  const reps = new Set<string>([nodeId]);
  const seg = symbolSeg(nodeId);
  reps.add(seg);
  const filePart = moduleFileFromId(nodeId);
  const base = filePart.split('/').pop() ?? filePart;
  if (nodeId.includes('::')) {
    reps.add(base + '::' + seg);
  } else {
    reps.add(base);
  }
  return [...reps];
}

/** 层 (b) path-suffix：query 含路径语义（`::` 或 `/`）时，按 `/`+query 后缀匹配 */
function layerPathSuffix(graphData: Readonly<GraphJSON>, query: string): SymbolCandidate[] {
  // C-2 修复：bare 单 token（无 `::` 无 `/`）必须落到 partial-name 层，
  // 否则可能误匹配某个 `*/Value` 文件节点并以 0.9 抢先 autoResolve。
  if (!query.includes('::') && !query.includes('/')) return [];
  const lowerQuery = query.toLowerCase();
  const results: SymbolCandidate[] = [];
  for (const node of graphData.nodes) {
    const lowerId = node.id.toLowerCase();
    if (lowerId === lowerQuery || lowerId.endsWith('/' + lowerQuery)) {
      results.push({ id: node.id, confidence: PATH_SUFFIX_CONFIDENCE, matchKind: 'path-suffix' });
    }
  }
  return results;
}

/**
 * 层 (c) partial-name：query 仅含方法名/类名时按唯一性加权。
 *
 * 匹配条件：symbolSeg(node) === query 或 symbolSeg(node).endsWith('.' + query)（大小写不敏感）。
 * 打分（Open Question A 决策）：
 *   - 唯一命中（matchCount === 1）：qualified `Class.method` → 0.95，bare 单 token → 0.90
 *   - 多义（matchCount > 1）：max(0.70, 0.85 - rank * (0.15 / (matchCount - 1)))，按相对唯一性递减
 */
function layerPartialName(graphData: Readonly<GraphJSON>, query: string): SymbolCandidate[] {
  const lowerQuery = query.toLowerCase();
  const isQualified = query.includes('.');
  const matched: string[] = [];
  for (const node of graphData.nodes) {
    const seg = symbolSeg(node.id).toLowerCase();
    if (seg === lowerQuery || seg.endsWith('.' + lowerQuery)) {
      matched.push(node.id);
    }
  }
  const matchCount = matched.length;
  if (matchCount === 0) return [];
  return matched.map((id, rank) => {
    let confidence: number;
    if (matchCount === 1) {
      confidence = isQualified ? 0.95 : 0.9;
    } else {
      confidence = Math.max(0.7, 0.85 - rank * (0.15 / (matchCount - 1)));
    }
    return { id, confidence, matchKind: 'partial-name' as MatchKind };
  });
}

/**
 * 层 (d) Levenshtein：对每个 node 的多种表示取相对距离最小者（C-1 修复）。
 *
 * 仅纳入相对编辑距离 ≤ LEVENSHTEIN_RATIO 的候选；confidence 线性映射到 [0.50, 0.75]。
 */
function layerLevenshtein(graphData: Readonly<GraphJSON>, query: string): SymbolCandidate[] {
  const lowerQuery = query.toLowerCase();
  const results: SymbolCandidate[] = [];
  for (const node of graphData.nodes) {
    let bestRatio = Infinity;
    let bestConf = 0;
    for (const rep of nodeMatchReps(node.id)) {
      const r = rep.toLowerCase();
      const threshold = Math.ceil(Math.max(lowerQuery.length, r.length) * LEVENSHTEIN_RATIO);
      if (threshold === 0) continue;
      // 长度差剪枝（Codex GREEN W-1）：|len(a)-len(b)| 是编辑距离的精确下界，
      // 超阈值必然不命中，跳过 DP 计算——结果不变，避免长 nodeId 上的性能退化。
      if (Math.abs(lowerQuery.length - r.length) > threshold) continue;
      const dist = levenshtein(lowerQuery, r);
      if (dist > threshold) continue;
      const ratio = dist / threshold;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestConf = Math.max(0.5, Math.min(0.75, 0.75 - ratio * 0.25));
      }
    }
    if (bestRatio !== Infinity) {
      results.push({ id: node.id, confidence: bestConf, matchKind: 'levenshtein' });
    }
  }
  return results;
}

/** 去重：同 id 保留最高 confidence */
function deduplicateCandidates(raw: SymbolCandidate[]): SymbolCandidate[] {
  const best = new Map<string, SymbolCandidate>();
  for (const c of raw) {
    const prev = best.get(c.id);
    if (prev === undefined || c.confidence > prev.confidence) best.set(c.id, c);
  }
  return [...best.values()];
}

/**
 * 去重 → 按 confidence 降序 → 判定 autoResolved → top-N。
 *
 * C-3 修复：autoResolved 用**去重后、slice 之前**的 deduped.length 判唯一，
 * 不能用 slice(0,limit) 后的长度，否则 limit=1 会把多候选误判为唯一候选。
 */
function buildResult(raw: SymbolCandidate[], limit: number, threshold: number): FuzzyResolveResult {
  const deduped = deduplicateCandidates(raw);
  deduped.sort((a, b) => b.confidence - a.confidence);
  const autoResolved = deduped.length === 1 && deduped[0]!.confidence >= threshold;
  return { candidates: deduped.slice(0, limit), autoResolved };
}

/**
 * 分层 fuzzy 解析 symbol id（Feature 174）。
 *
 * 四层命中即停（分数递减）：
 *   (a) exact      — 复用 canonicalizeSymbolId，confidence 1.0
 *   (b) path-suffix — 文件路径后缀匹配，confidence 0.9
 *   (c) partial-name — 仅方法名/类名，按唯一性加权（唯一 ≥0.9 / 多义 0.7~0.85）
 *   (d) levenshtein — 拼写相似，confidence 0.5~0.75（query > 512 跳过）
 *
 * autoResolved = 去重后唯一候选 且 confidence ≥ max(0.9, opts.autoResolveThreshold)。
 * 空 / 纯空白 / 含控制字符 query → { candidates: [], autoResolved: false }（不抛异常）。
 * graphData 只读。
 */
export function resolveSymbolFuzzy(
  graphData: Readonly<GraphJSON>,
  query: string,
  opts: FuzzyResolveOptions = {},
): FuzzyResolveResult {
  // limit 至少为 1：display cap 不应小于 1，否则 autoResolved=true 时 candidates 被
  // slice 成空数组、与 autoResolved 语义矛盾（Codex REFACTOR review）。
  const limit = Math.max(1, opts.limit ?? 10);
  // floor：production 阈值不得低于 0.9（FR-012，防绕过 FR-003 硬阈值）
  const threshold = Math.max(AUTO_RESOLVE_FLOOR, opts.autoResolveThreshold ?? AUTO_RESOLVE_FLOOR);

  // 前置 guard：空 / 纯空白 / 控制字符
  if (typeof query !== 'string') return { candidates: [], autoResolved: false };
  const trimmed = query.trim();
  if (trimmed.length === 0 || CONTROL_CHAR_RE.test(query)) {
    return { candidates: [], autoResolved: false };
  }

  // 层 (a) exact —— 复用 canonicalizeSymbolId
  const canon = canonicalizeSymbolId(query, graphData, { projectRoot: opts.projectRoot });
  if (canon.reason === 'ok' && canon.canonicalId !== null) {
    return {
      candidates: [{ id: canon.canonicalId, confidence: 1.0, matchKind: 'exact' }],
      autoResolved: true, // exact 必然唯一且 1.0 >= threshold
    };
  }

  // 层 (b) path-suffix
  const pathSuffix = layerPathSuffix(graphData, query);
  if (pathSuffix.length > 0) return buildResult(pathSuffix, limit, threshold);

  // 层 (c) partial-name
  const partialName = layerPartialName(graphData, query);
  if (partialName.length > 0) return buildResult(partialName, limit, threshold);

  // 层 (d) Levenshtein（query 过长跳过，防性能退化）
  if (query.length <= LEVENSHTEIN_MAX_QUERY_LEN) {
    const lev = layerLevenshtein(graphData, query);
    if (lev.length > 0) return buildResult(lev, limit, threshold);
  }

  return { candidates: [], autoResolved: false };
}

/**
 * Levenshtein 编辑距离 — 标准 DP 滚动数组（O(min(m,n)) 空间）。
 * 实现照搬 src/panoramic/pipelines/adr-evidence-verifier.ts 的私有实现（Feature 174 FR-011）。
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const sm = shorter.length;
  const ln = longer.length;
  let prev: number[] = Array.from({ length: sm + 1 }, (_, i) => i);
  for (let i = 1; i <= ln; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= sm; j++) {
      const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1;
      curr.push(Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost));
    }
    prev = curr;
  }
  return prev[sm]!;
}

// ============================================================
// risk tier
// ============================================================

/**
 * 按 directCallers + transitive 节点数判定 risk tier。
 *
 * 阈值（spec FR-014）：
 *   - directCallers ≥ 10 或 transitive ≥ 50 → high
 *   - directCallers ≥ 3  或 transitive ≥ 15 → medium
 *   - 其余 → low
 */
export function computeRiskTier(
  directCallers: number,
  transitive: number,
): 'low' | 'medium' | 'high' {
  if (directCallers >= 10 || transitive >= 50) return 'high';
  if (directCallers >= 3 || transitive >= 15) return 'medium';
  return 'low';
}

// ============================================================
// reverse adjacency cache（LRU ≤ 8）
// ============================================================

const ADJ_CACHE_LIMIT = 8;

/**
 * 反向邻接表 cache（按 graphPath + mtime + size + linksLength + relations 建 key）。
 *
 * 用 Map 实现 LRU：超过 LIMIT 时按插入顺序 evict 最早条目。同 key 命中时
 * delete + set 把它放到最尾，模拟 "recently used"。
 */
const adjCache = new Map<string, ReverseAdj>();

function buildAdjKey(
  graphPath: string,
  mtimeMs: number,
  sizeBytes: number,
  linksLength: number,
  relations: ReadonlyArray<string>,
  direction: BfsDirection,
): string {
  return `${graphPath}::${mtimeMs}::${sizeBytes}::${linksLength}::${relations.join(',')}::${direction}`;
}

/**
 * 获取（或构建）反向邻接表。
 *
 * direction 决定邻接方向：
 *   - upstream：target → 进入此节点的 inbound 边（callers）
 *   - downstream：source → 离开此节点的 outbound 边（callees）
 *   - both：合并 inbound + outbound
 *
 * 仅保留 relation 在 relations 集合内的边；其他 relation 的边不进入邻接表。
 */
export function getReverseAdjacency(
  graphData: Readonly<GraphJSON>,
  graphPath: string,
  mtimeMs: number,
  sizeBytes: number,
  relations: ReadonlyArray<string>,
  direction: BfsDirection,
): ReverseAdj {
  const key = buildAdjKey(graphPath, mtimeMs, sizeBytes, graphData.links.length, relations, direction);
  const cached = adjCache.get(key);
  if (cached !== undefined) {
    // LRU：把命中的条目挪到最尾
    adjCache.delete(key);
    adjCache.set(key, cached);
    return cached;
  }
  const adj: ReverseAdj = new Map();
  const allowedRelations = new Set(relations);
  for (const link of graphData.links) {
    if (!allowedRelations.has(link.relation)) continue;
    if (direction === 'upstream' || direction === 'both') {
      // target ← source
      const list = adj.get(link.target) ?? [];
      list.push({ sourceId: link.source, edge: link });
      adj.set(link.target, list);
    }
    if (direction === 'downstream' || direction === 'both') {
      // source → target，但反向邻接表存储到 source 的 list 上以便 BFS 统一从 currentId 找下一跳
      const list = adj.get(link.source) ?? [];
      list.push({ sourceId: link.target, edge: link });
      adj.set(link.source, list);
    }
  }
  // 写入 cache，超 LIMIT 时 evict 最早
  if (adjCache.size >= ADJ_CACHE_LIMIT) {
    const oldestKey = adjCache.keys().next().value;
    if (oldestKey !== undefined) adjCache.delete(oldestKey);
  }
  adjCache.set(key, adj);
  return adj;
}

/** 测试 / debug 用：清空 reverse adjacency cache */
export function clearReverseAdjacencyCache(): void {
  adjCache.clear();
}

// ============================================================
// BFS traverse（核心）
// ============================================================

/**
 * 从 startId 出发做 BFS，返回受影响的节点列表。
 *
 * 关键合同（FR-012）：
 *   - budget 在**遍历前**应用：每次准备 enqueue 一个新节点之前，检查
 *     `affected.length + 1 > effectiveBudget`，超即停止入队并 push 'budget-truncated' warning
 *   - start node 不计入 budget；budget 仅约束 affected 数量
 *   - depth 是边数：depth=2 含 direct caller (depth=1) + 二级 caller (depth=2)
 *   - confidence 缺失：跳过 + 记 'missing-confidence-score' warning（不当作 0 静默通过）
 *   - sharedVisited 跨调用共享：detect_changes 多 changedSymbol 用同一 globalVisited
 *     去重，让 affected 不重复计入同一节点
 *
 * 返回的 warnings 是去重的：同一类 warning 多次触发只 push 一次。
 */
export function bfsTraverse(
  graphData: Readonly<GraphJSON>,
  startId: string,
  options: BfsTraverseOptions,
): BfsTraverseResult {
  const effectiveDepth = Math.max(0, Math.floor(options.depth));
  const effectiveBudget = Math.max(0, Math.floor(options.budget));
  const minConfidence = Math.max(0, Math.min(1, options.minConfidence));
  const relations = options.relations && options.relations.length > 0 ? options.relations : DEFAULT_RELATIONS;

  const warnings = new Set<string>();
  const affected: BfsAffected[] = [];

  if (effectiveDepth === 0) {
    if (options.depth !== effectiveDepth) warnings.add('depth-clamped');
    return { affected, warnings: [...warnings] };
  }
  if (effectiveBudget === 0) {
    return { affected, warnings: ['budget-zero'] };
  }

  const visited = options.sharedVisited ?? new Set<string>();
  visited.add(startId);

  const adj = getReverseAdjacency(
    graphData,
    options.graphPath,
    options.graphMtimeMs,
    options.graphSizeBytes,
    relations,
    options.direction,
  );

  /** queue 元素：当前节点 id、深度、ancestor 路径、reason 链显示用 */
  interface QueueItem {
    id: string;
    depth: number;
    path: string[];
  }
  const queue: QueueItem[] = [{ id: startId, depth: 0, path: [startId] }];

  let confidenceFiltered = 0;
  let truncated = false;

  // BFS 主循环
  while (queue.length > 0) {
    if (truncated) break;
    const cur = queue.shift()!;
    if (cur.depth >= effectiveDepth) continue;
    const neighbors = adj.get(cur.id);
    if (neighbors === undefined) continue;
    for (const ne of neighbors) {
      if (truncated) break;
      const conf = resolveEdgeConfidence(ne.edge);
      if (conf === null) {
        warnings.add('missing-confidence-score');
        continue;
      }
      if (conf < minConfidence) {
        confidenceFiltered++;
        continue;
      }
      if (visited.has(ne.sourceId)) continue;
      // budget 遍历前截断（FR-012 关键合同）
      if (affected.length + 1 > effectiveBudget) {
        warnings.add('budget-truncated');
        truncated = true;
        break;
      }
      visited.add(ne.sourceId);
      const nextDepth = cur.depth + 1;
      const nextPath = [...cur.path, ne.sourceId];
      const reason = buildReason(cur.id, ne.sourceId, ne.edge);
      affected.push({
        id: ne.sourceId,
        depth: nextDepth,
        confidence: conf,
        reason,
        path: nextPath,
      });
      // 只有还能继续展开（下一深度 < effectiveDepth）才入队
      if (nextDepth < effectiveDepth) {
        queue.push({ id: ne.sourceId, depth: nextDepth, path: nextPath });
      }
    }
  }

  if (affected.length === 0 && confidenceFiltered > 0) {
    warnings.add('confidence-filtered-all');
  }
  if (options.depth !== effectiveDepth || options.budget !== effectiveBudget) {
    warnings.add('input-clamped');
  }

  return { affected, warnings: [...warnings] };
}

function buildReason(fromId: string, toId: string, edge: GraphEdge): string {
  const fromLabel = labelFromId(fromId);
  const toLabel = labelFromId(toId);
  return `${edge.relation} via ${fromLabel} ← ${toLabel}`;
}

function labelFromId(id: string): string {
  // 取 `file::Class.method` 中最右侧 segment 作为可读 label
  const idx = id.lastIndexOf('::');
  return idx >= 0 ? id.slice(idx + 2) : id;
}

// ============================================================
// 节点 id → 节点 metadata 抽取（context tool 用）
// ============================================================

/**
 * 取节点的 module file 部分。
 *
 * 兼容两种分隔符（同一个 graph 内可能并存）：
 *   - Feature 151 新格式：`<file>::<symbolName>` 例 `micrograd/engine.py::Value.__add__`
 *   - 旧 panoramic 格式：`<file>#<symbolName>` 例 `micrograd/engine.py#Value`
 *
 * 模块节点本身（id 既不含 `::` 也不含 `#`）→ 返回 id 自身。
 * 取最早出现的分隔符位置作为 cut 点。
 */
export function moduleFileFromId(nodeId: string): string {
  const idxColon = nodeId.indexOf('::');
  const idxHash = nodeId.indexOf('#');
  const cuts = [idxColon, idxHash].filter((i) => i >= 0);
  if (cuts.length === 0) return nodeId;
  const first = Math.min(...cuts);
  return nodeId.slice(0, first);
}

/**
 * 在 graph 中找指定 node 的 GraphNode 对象。
 * O(n) — 仅小规模 graph 使用，调用频率不高（仅 context handler 的 definition 字段）。
 */
export function findNode(
  graphData: Readonly<GraphJSON>,
  id: string,
): GraphNode | null {
  for (const n of graphData.nodes) {
    if (n.id === id) return n;
  }
  return null;
}
