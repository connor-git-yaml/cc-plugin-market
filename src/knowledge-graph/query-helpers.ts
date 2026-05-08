/**
 * Feature 155 — Agent-Context MCP Tools 的查询基建。
 *
 * 暴露给 src/mcp/agent-context-tools.ts 的工具函数：
 *   - bfsTraverse：反向 / 正向 BFS，遍历前 budget 截断（FR-012）
 *   - canonicalizeSymbolId：把用户传入的 symbol id 归一到 graph 实际 id
 *   - findFuzzyMatches：symbol-not-found 时返回最多 N 个候选
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
 * 失败返回 null，调用方按 symbol-not-found 处理（建议同时调 findFuzzyMatches 提候选）。
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
// fuzzy match
// ============================================================

/**
 * 当 symbolId 找不到时，返回最多 limit 个相似候选。
 *
 * 算法（轻量、无外部依赖）：
 *   - 把 query 拆 token（按 `::` `/` `.` `-` `_` 拆分，过滤空 token）
 *   - 给每个 graph node id 打分：
 *       * 命中 token 数 +1 / token
 *       * id 含 query 子串 +0.5
 *   - 按分数降序，取前 limit 个 id
 *
 * 不实现 Levenshtein（避免引入新依赖）；substring + token 命中已足够给 LLM agent
 * 第二次正确输入的提示。
 */
export function findFuzzyMatches(
  graphData: Readonly<GraphJSON>,
  queryId: string,
  limit: number,
): string[] {
  if (limit <= 0 || queryId.length === 0) return [];
  const tokens = queryId
    .toLowerCase()
    .split(/[:/.\-_]+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return [];
  const lowerQuery = queryId.toLowerCase();

  const scored: Array<{ id: string; score: number }> = [];
  for (const node of graphData.nodes) {
    const lowerId = node.id.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (lowerId.includes(t)) score += 1;
    }
    if (lowerId.includes(lowerQuery)) score += 0.5;
    if (score > 0) {
      scored.push({ id: node.id, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.id);
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
 * 取节点的 module file 部分（symbol id 中 `::` 之前的段）。
 * 模块节点本身（id 不含 `::`）→ 返回 id 自身。
 */
export function moduleFileFromId(nodeId: string): string {
  const idx = nodeId.indexOf('::');
  return idx >= 0 ? nodeId.slice(0, idx) : nodeId;
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
