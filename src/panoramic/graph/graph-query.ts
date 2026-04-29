/**
 * GraphQueryEngine — 知识图谱查询引擎
 * 负责从 _meta/graph.json 加载图谱，构建内存索引，提供查询接口
 * 参照 graphify 极简设计，不引入任何新运行时依赖
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphJSON, GraphNode, GraphEdge, Hyperedge, SemanticEdgeRelation } from './graph-types.js';
import { SEMANTIC_EDGE_RELATIONS } from './graph-types.js';

// ============================================================
// 查询结果类型定义
// ============================================================

/**
 * 关键词子图查询结果
 */
export interface QueryResult {
  /** 匹配到的节点列表（已按 budget 裁剪） */
  nodes: GraphNode[];
  /** 节点间的边列表 */
  edges: GraphEdge[];
  /** 查询摘要文本（节点数量 + 截断提示） */
  summary: string;
  /** 是否因超出 budget 而截断 */
  truncated: boolean;
  /** 原始匹配节点总数（截断前） */
  totalMatches: number;
}

/**
 * 单节点详情查询结果
 */
export interface NodeResult {
  /** 查找到的节点，不存在时为 null */
  node: GraphNode | null;
  /** 邻居节点及连接边列表 */
  neighbors: Array<{ node: GraphNode; edge: GraphEdge }>;
  /** 节点所属社区 ID，无社区信息时为 null */
  community: string | null;
  /** 附加消息（如"节点不存在"） */
  message?: string;
}

/**
 * 最短路径查询结果
 */
export interface PathResult {
  /** 路径节点序列（按源到目标顺序），不存在路径时为 null */
  path: GraphNode[] | null;
  /** 路径上的边列表 */
  edges: GraphEdge[];
  /** 结果描述信息 */
  message: string;
}

/**
 * 社区节点列表查询结果
 */
export interface CommunityResult {
  /** 社区 ID */
  communityId: string;
  /** 该社区的所有节点 */
  nodes: GraphNode[];
  /**
   * 社区内聚度（来自 _meta/graph-report.md）
   * 文件不存在时 graceful degrade，值为 null
   */
  cohesion: number | null;
  /** 附加消息（如"社区不存在"或"内聚度不可用"） */
  message?: string;
}

/**
 * 枢纽节点（God Nodes）查询结果
 */
export interface GodNodesResult {
  /** 按度数降序排列的枢纽节点列表（含 degree 字段） */
  nodes: Array<GraphNode & { degree: number }>;
}

/**
 * schema v2.0：语义边信息（供 graph_node 工具 semanticEdges 字段使用）
 * 表示与某节点关联的一条语义边，含方向、对端节点和证据字段
 */
export interface SemanticEdgeInfo {
  /** 语义边类型（三种之一） */
  type: SemanticEdgeRelation;
  /** 相对于查询节点的方向（outgoing: 以该节点为 source；incoming: 以该节点为 target） */
  direction: 'incoming' | 'outgoing';
  /** 对端节点 ID */
  peer: string;
  /** 证据文本（来自 GraphEdge.evidenceText） */
  evidenceText?: string;
  /** 证据来源（来自 GraphEdge.evidenceSource） */
  evidenceSource?: string;
  /** 置信度 */
  confidence?: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
}

// ============================================================
// 内部辅助类型
// ============================================================

/** budget 裁剪结果 */
interface TruncateResult {
  nodes: GraphNode[];
  truncated: boolean;
  totalMatches: number;
}

// ============================================================
// 查询词拆分（Bug 142）
// ============================================================

/**
 * 将查询字符串拆分为小写词项集合。
 *
 * 支持以下拆分规则：
 * - PascalCase：'PQueue' → ['p', 'queue']（'p' 长度=1 被过滤，最终保留 ['queue']）
 * - 连续大写：'XMLParser' → ['xml', 'parser']
 * - 分隔符：空格 / `-` / `_` / `.` 全部视作分隔
 *
 * 处理规则：
 * - 全部转小写
 * - 长度 ≤ 1 的 token 被过滤（避免 'p' / 'i' 等单字符噪声匹配）
 * - 去重后返回稳定顺序（基于 Set 插入顺序）
 *
 * 注意：中文字符不会被 PascalCase 正则改动，按原样进入分隔符拆分；
 * 因此中文查询如「优先队列」不会被错误拆分（无空格时整段保留为一个 token）。
 *
 * @param q - 原始查询字符串
 * @returns 去重、过滤后的小写 token 数组
 */
export function tokenize(q: string): string[] {
  const normalized = q
    .replace(/([a-z])([A-Z])/g, '$1 $2')         // 'PQueue' → 'P Queue'
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');  // 'XMLParser' → 'XML Parser'
  return Array.from(
    new Set(
      normalized
        .toLowerCase()
        .split(/[\s\-_.]+/)
        .filter((t) => t.length > 1),
    ),
  );
}

// ============================================================
// GraphQueryEngine 核心类
// ============================================================

/**
 * 知识图谱查询引擎
 * 从 GraphJSON 构建内存索引，提供高效查询接口
 */
export class GraphQueryEngine {
  /** 原始图数据 */
  private graph: GraphJSON;
  /** 节点 ID → 节点对象的索引映射 */
  private nodeMap: Map<string, GraphNode>;
  /** 邻接表：节点 ID → 相邻节点及连接边的数组 */
  private adjacency: Map<string, Array<{ node: string; edge: GraphEdge }>>;

  // ──────────────────────────────────────────────────────────
  // 构造函数与静态工厂方法
  // ──────────────────────────────────────────────────────────

  /**
   * 从 GraphJSON 构建查询引擎，同时建立内存索引
   * @param graph - 符合 NetworkX node-link 格式的图谱 JSON
   */
  constructor(graph: GraphJSON) {
    this.graph = graph;
    this.nodeMap = new Map();
    this.adjacency = new Map();

    // 建立节点索引
    for (const node of graph.nodes) {
      this.nodeMap.set(node.id, node);
      this.adjacency.set(node.id, []);
    }

    // 建立邻接表（无向图双向添加，有向图单向添加）
    for (const edge of graph.links) {
      const srcList = this.adjacency.get(edge.source);
      const tgtList = this.adjacency.get(edge.target);

      if (srcList !== undefined) {
        srcList.push({ node: edge.target, edge });
      }
      if (!graph.directed && tgtList !== undefined) {
        tgtList.push({ node: edge.source, edge });
      }
    }
  }

  /**
   * 从磁盘文件加载图谱，返回初始化完成的查询引擎
   * @param graphPath - graph.json 文件的绝对路径
   * @throws 文件不存在或 JSON 格式不合法时抛出含明确原因的 Error
   */
  static loadFromFile(graphPath: string): GraphQueryEngine {
    let content: string;
    try {
      content = readFileSync(graphPath, 'utf-8');
    } catch (err) {
      throw new Error(
        `无法读取图谱文件 ${graphPath}：${err instanceof Error ? err.message : String(err)}` +
        '\n提示：请先运行 `spectra graph` 命令生成图谱。',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error(
        `图谱文件 JSON 解析失败 ${graphPath}：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 宽松 schema 校验：仅检查 nodes/links 数组存在（避免因字段扩展导致加载失败）
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>)['nodes']) ||
      !Array.isArray((parsed as Record<string, unknown>)['links'])
    ) {
      throw new Error(
        `图谱文件格式不合法 ${graphPath}：缺少必要字段 nodes 或 links 数组`,
      );
    }

    return new GraphQueryEngine(parsed as GraphJSON);
  }

  // ──────────────────────────────────────────────────────────
  // 私有辅助方法
  // ──────────────────────────────────────────────────────────

  /**
   * 对所有节点计算关键词匹配分（参照 graphify _score_nodes 逻辑）
   * - label 包含词项：+1 分
   * - metadata.sourcePath 或 metadata.path 包含词项：+0.5 分
   * @param terms - 查询词项数组（已小写）
   * @returns 按分数降序排列的节点 ID + 分数列表
   */
  private scoreNodes(terms: string[]): Array<{ id: string; score: number }> {
    const scored: Array<{ id: string; score: number }> = [];

    for (const [id, node] of this.nodeMap) {
      const label = node.label.toLowerCase();
      // 从 metadata 中提取路径字段（兼容 sourcePath 和 path 两种字段名）
      const sourcePath = (
        (node.metadata['sourcePath'] as string | undefined) ??
        (node.metadata['path'] as string | undefined) ??
        ''
      ).toLowerCase();

      let score = 0;
      for (const t of terms) {
        if (label.includes(t)) score += 1;
        if (sourcePath.includes(t)) score += 0.5;
      }
      if (score > 0) scored.push({ id, score });
    }

    return scored.sort((a, b) => b.score - a.score);
  }

  /**
   * BFS 广度优先遍历（参照 graphify _bfs 逻辑）
   * 从起始节点集合出发，按层遍历邻接表，防止循环访问
   * @param startIds - 起始节点 ID 集合
   * @param depth - 最大遍历深度
   * @returns 访问到的节点 ID 集合和遍历到的边列表
   */
  private bfs(startIds: string[], depth: number): { nodes: Set<string>; edges: Array<[string, string]> } {
    const visited = new Set(startIds);
    let frontier = new Set(startIds);
    const edgesSeen: Array<[string, string]> = [];

    for (let d = 0; d < depth; d++) {
      const nextFrontier = new Set<string>();
      for (const n of frontier) {
        for (const { node: neighbor } of this.adjacency.get(n) ?? []) {
          if (!visited.has(neighbor)) {
            nextFrontier.add(neighbor);
            edgesSeen.push([n, neighbor]);
          }
        }
      }
      for (const n of nextFrontier) visited.add(n);
      frontier = nextFrontier;
      // 若 frontier 为空则提前终止
      if (frontier.size === 0) break;
    }

    return { nodes: visited, edges: edgesSeen };
  }

  /**
   * 按 budget 裁剪节点列表
   * 优先级：pinnedIds 固定保留 > 度数降序（hub 节点优先）
   * @param nodes - 待裁剪的节点列表
   * @param budget - 节点数上限（≤ 0 时使用默认值 50）
   * @param pinnedIds - 必须保留的节点 ID 集合（如查询起点）
   * @returns 裁剪后的节点列表及截断标志
   */
  private truncateByBudget(nodes: GraphNode[], budget: number, pinnedIds?: Set<string>): TruncateResult {
    const effectiveBudget = budget <= 0 ? 50 : budget;
    const totalMatches = nodes.length;

    if (nodes.length <= effectiveBudget) {
      return { nodes, truncated: false, totalMatches };
    }

    // 分离固定保留节点和普通节点
    const pinned: GraphNode[] = [];
    const rest: GraphNode[] = [];
    for (const node of nodes) {
      if (pinnedIds?.has(node.id)) {
        pinned.push(node);
      } else {
        rest.push(node);
      }
    }

    // 剩余节点按度数降序排列
    rest.sort((a, b) => {
      const degA = this.adjacency.get(a.id)?.length ?? 0;
      const degB = this.adjacency.get(b.id)?.length ?? 0;
      return degB - degA;
    });

    // 固定保留节点优先，剩余按度数填充
    const remaining = Math.max(0, effectiveBudget - pinned.length);
    const result = [...pinned, ...rest.slice(0, remaining)];

    return {
      nodes: result,
      truncated: true,
      totalMatches,
    };
  }

  // ──────────────────────────────────────────────────────────
  // 公开查询方法
  // ──────────────────────────────────────────────────────────

  /**
   * 关键词子图查询（对应 graph_query MCP tool）
   * 拆分查询词 → 关键词评分 → BFS 扩展子图 → budget 裁剪
   * @param question - 自然语言查询词
   * @param options - 查询选项（budget、mode、depth）
   * @returns QueryResult
   */
  query(
    question: string,
    options?: { budget?: number; mode?: 'bfs' | 'dfs'; depth?: number },
  ): QueryResult {
    const budget = options?.budget ?? 50;
    const depth = options?.depth ?? 2;

    // 将查询词拆分为小写词项（Bug 142：使用 tokenize 支持 PascalCase / 连续大写拆分）
    const terms = tokenize(question);

    if (terms.length === 0) {
      return {
        nodes: [],
        edges: [],
        summary: '查询词为空，请提供有效的查询内容',
        truncated: false,
        totalMatches: 0,
      };
    }

    // 获取得分节点
    const scored = this.scoreNodes(terms);

    if (scored.length === 0) {
      return {
        nodes: [],
        edges: [],
        summary: '未找到相关内容',
        truncated: false,
        totalMatches: 0,
      };
    }

    // BFS 从得分节点出发扩展子图
    // 限制 seed 节点数量 ≤ budget，确保 budget 为硬上限
    const startIds = scored.slice(0, Math.max(1, budget)).map((s) => s.id);
    const { nodes: visitedIds, edges: bfsEdges } = this.bfs(startIds, depth);

    // 收集子图节点对象
    const subgraphNodes: GraphNode[] = [];
    for (const id of visitedIds) {
      const node = this.nodeMap.get(id);
      if (node !== undefined) subgraphNodes.push(node);
    }

    // 按 budget 裁剪（起点节点固定保留）
    const pinnedIds = new Set(startIds);
    const { nodes: finalNodes, truncated, totalMatches } = this.truncateByBudget(
      subgraphNodes,
      budget,
      pinnedIds,
    );

    // 收集最终节点集合中存在的边（来自图的原始 links）
    const finalNodeIds = new Set(finalNodes.map((n) => n.id));
    const finalEdges: GraphEdge[] = [];
    for (const edge of this.graph.links) {
      if (finalNodeIds.has(edge.source) && finalNodeIds.has(edge.target)) {
        finalEdges.push(edge);
      }
    }

    // 也加入 BFS 遍历边（可能不在原 links 中，但这里取交集即可）
    // 以上已通过 graph.links 过滤，无需重复处理

    // 构建摘要文本
    let summary = `找到 ${totalMatches} 个相关节点`;
    if (truncated) {
      summary += `，已按 budget 限制截断至 ${finalNodes.length} 个`;
    }
    if (budget <= 0) {
      summary += `（budget 无效，使用默认值 50）`;
    }

    return {
      nodes: finalNodes,
      edges: finalEdges,
      summary,
      truncated,
      totalMatches,
    };
  }

  /**
   * 单节点详情查询（对应 graph_node MCP tool）
   * id 优先精确查找，回退到 keyword 模糊匹配
   * @param params - 查询参数（id 优先，keyword 作为 fallback）
   * @returns NodeResult
   */
  getNode(params: { id?: string; keyword?: string; budget?: number }): NodeResult {
    const { id, keyword, budget } = params;
    let node: GraphNode | undefined;

    if (id !== undefined && id.length > 0) {
      // 精确 ID 查找
      node = this.nodeMap.get(id);
    } else if (keyword !== undefined && keyword.length > 0) {
      // 模糊关键词匹配（label 包含关键词，不区分大小写）
      const kw = keyword.toLowerCase();
      for (const n of this.nodeMap.values()) {
        if (n.label.toLowerCase().includes(kw)) {
          node = n;
          break;
        }
      }
    }

    if (node === undefined) {
      return {
        node: null,
        neighbors: [],
        community: null,
        message: id
          ? `节点不存在：id="${id}"`
          : `未找到匹配关键词的节点：keyword="${keyword ?? ''}"`,
      };
    }

    // 获取邻居节点列表（按 budget 限制数量）
    const neighborEntries = this.adjacency.get(node.id) ?? [];
    const effectiveBudget = budget && budget > 0 ? budget : neighborEntries.length;
    const neighbors: Array<{ node: GraphNode; edge: GraphEdge }> = [];
    for (const { node: neighborId, edge } of neighborEntries) {
      if (neighbors.length >= effectiveBudget) break;
      const neighborNode = this.nodeMap.get(neighborId);
      if (neighborNode !== undefined) {
        neighbors.push({ node: neighborNode, edge });
      }
    }

    // 提取社区信息（来自节点 metadata.community 字段）
    const community =
      typeof node.metadata['community'] === 'string'
        ? node.metadata['community']
        : null;

    return { node, neighbors, community };
  }

  /**
   * 最短路径查询（对应 graph_path MCP tool）
   * 无权图 BFS 最短路径算法
   * @param source - 源节点 ID
   * @param target - 目标节点 ID
   * @returns PathResult
   */
  findPath(source: string, target: string): PathResult {
    // 校验节点存在性
    if (!this.nodeMap.has(source)) {
      return {
        path: null,
        edges: [],
        message: `源节点不存在：${source}`,
      };
    }
    if (!this.nodeMap.has(target)) {
      return {
        path: null,
        edges: [],
        message: `目标节点不存在：${target}`,
      };
    }

    // source === target 时返回单节点路径
    if (source === target) {
      const node = this.nodeMap.get(source)!;
      return {
        path: [node],
        edges: [],
        message: `源节点与目标节点相同：${source}`,
      };
    }

    // BFS 最短路径：记录父节点映射，到达 target 后回溯路径
    const parent = new Map<string, string>();
    const parentEdge = new Map<string, GraphEdge>();
    const visited = new Set<string>([source]);
    const queue: string[] = [source];
    let found = false;

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const { node: neighbor, edge } of this.adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          parent.set(neighbor, current);
          parentEdge.set(neighbor, edge);
          if (neighbor === target) {
            found = true;
            break;
          }
          queue.push(neighbor);
        }
      }
      if (found) break;
    }

    if (!found) {
      return {
        path: null,
        edges: [],
        message: `路径不存在：${source} → ${target}`,
      };
    }

    // 回溯路径（从 target 到 source）
    const pathIds: string[] = [];
    let cur = target;
    while (cur !== source) {
      pathIds.unshift(cur);
      cur = parent.get(cur)!;
    }
    pathIds.unshift(source);

    // 构建路径节点序列
    const pathNodes: GraphNode[] = pathIds
      .map((nid) => this.nodeMap.get(nid))
      .filter((n): n is GraphNode => n !== undefined);

    // 构建路径边序列
    const pathEdges: GraphEdge[] = pathIds
      .slice(1)
      .map((nid) => parentEdge.get(nid))
      .filter((e): e is GraphEdge => e !== undefined);

    return {
      path: pathNodes,
      edges: pathEdges,
      message: `找到最短路径，共 ${pathNodes.length} 个节点，${pathEdges.length} 条边`,
    };
  }

  /**
   * 社区节点查询（对应 graph_community MCP tool）
   * 按节点 metadata.community 字段分组，返回指定社区所有节点
   * cohesion 从 _meta/graph-report.md 读取，文件不存在时 graceful degrade
   * @param communityId - 社区 ID
   * @param budget - 节点数上限（可选）
   * @returns CommunityResult
   */
  getCommunity(communityId: string, budget?: number): CommunityResult {
    // 筛选属于该社区的节点
    const communityNodes: GraphNode[] = [];
    for (const node of this.nodeMap.values()) {
      if (node.metadata['community'] === communityId) {
        communityNodes.push(node);
      }
    }

    if (communityNodes.length === 0) {
      return {
        communityId,
        nodes: [],
        cohesion: null,
        message: `社区不存在：${communityId}`,
      };
    }

    // 按 budget 裁剪
    const effectiveBudget = budget && budget > 0 ? budget : communityNodes.length;
    const finalNodes = communityNodes.slice(0, effectiveBudget);
    const truncated = finalNodes.length < communityNodes.length;

    // 尝试从 specs/_meta/GRAPH_REPORT.md 读取 cohesion（graceful degrade）
    let cohesion: number | null = null;
    let cohesionMessage: string | undefined;
    try {
      const reportPath = join(process.cwd(), 'specs', '_meta', 'GRAPH_REPORT.md');
      const reportContent = readFileSync(reportPath, 'utf-8');
      // 匹配格式如：| communityId | 0.85 | 或类似表格行
      // 转义 communityId 中的正则特殊字符，防止 ReDoS
      const escaped = communityId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\|\\s*${escaped}\\s*\\|[^|]*\\|\\s*([\\d.]+)`, 'i');
      const match = reportContent.match(regex);
      if (match?.[1]) {
        const parsed = parseFloat(match[1]);
        if (!isNaN(parsed)) cohesion = parsed;
      }
    } catch {
      // graph-report.md 不存在或读取失败，graceful degrade
      cohesionMessage = '内聚度不可用（specs/_meta/GRAPH_REPORT.md 不存在）';
    }

    return {
      communityId,
      nodes: finalNodes,
      cohesion,
      message: truncated
        ? `社区 ${communityId} 共 ${communityNodes.length} 个节点，已截断至 ${finalNodes.length} 个${cohesionMessage ? '；' + cohesionMessage : ''}`
        : cohesionMessage,
    };
  }

  /**
   * 超边查询（对应 graph_hyperedges MCP tool）
   * 返回图谱中所有超边，支持按 label 子串模糊过滤和按 node_id 精确过滤
   * @param options - 过滤选项（均可选；两项均不传时返回全部）
   * @returns Hyperedge 数组（graph.json 无 hyperedges 字段时返回空数组）
   */
  getHyperedges(options?: { label?: string; nodeId?: string; limit?: number }): Hyperedge[] {
    const all = this.graph.hyperedges ?? [];

    let result = all;

    // label 模糊过滤（子串，大小写不敏感）
    if (options?.label !== undefined && options.label.length > 0) {
      const filterLower = options.label.toLowerCase();
      result = result.filter((he) => he.label.toLowerCase().includes(filterLower));
    }

    // node_id 精确过滤（节点 ID 必须在 nodes 数组中）
    if (options?.nodeId !== undefined && options.nodeId.length > 0) {
      const targetId = options.nodeId;
      result = result.filter((he) => he.nodes.includes(targetId));
    }

    // limit 截断（默认不截断）
    const limit = options?.limit;
    if (limit !== undefined && limit > 0 && result.length > limit) {
      result = result.slice(0, limit);
    }

    return result;
  }

  /**
   * 语义边查询（对应 graph_node MCP tool 的 semanticEdges 字段）
   * 返回与指定节点关联的所有语义边（relation 为三种语义类型之一）
   * 节点不存在或无语义边时返回空数组（不报错）
   * @param nodeId - 目标节点 ID；undefined 或 null 时直接返回空数组
   * @returns SemanticEdgeInfo 数组
   */
  getSemanticEdges(nodeId: string | null | undefined): SemanticEdgeInfo[] {
    if (nodeId === null || nodeId === undefined || nodeId.length === 0) {
      return [];
    }

    const semanticRelations = new Set<string>([
      SEMANTIC_EDGE_RELATIONS.REFERENCES,
      SEMANTIC_EDGE_RELATIONS.CONCEPTUALLY_RELATED_TO,
      SEMANTIC_EDGE_RELATIONS.RATIONALE_FOR,
    ]);

    const result: SemanticEdgeInfo[] = [];

    for (const edge of this.graph.links) {
      if (!semanticRelations.has(edge.relation)) continue;

      if (edge.source === nodeId) {
        result.push({
          type: edge.relation as SemanticEdgeRelation,
          direction: 'outgoing',
          peer: edge.target,
          evidenceText: edge.evidenceText,
          evidenceSource: edge.evidenceSource,
          confidence: edge.confidence,
        });
      } else if (edge.target === nodeId) {
        result.push({
          type: edge.relation as SemanticEdgeRelation,
          direction: 'incoming',
          peer: edge.source,
          evidenceText: edge.evidenceText,
          evidenceSource: edge.evidenceSource,
          confidence: edge.confidence,
        });
      }
    }

    return result;
  }

  /**
   * 枢纽节点查询（对应 graph_god_nodes MCP tool）
   * 计算每个节点的度数，按降序返回前 limit 个
   * @param limit - 返回节点数量上限（默认 10）
   * @returns GodNodesResult
   */
  getGodNodes(limit: number = 10): GodNodesResult {
    const effectiveLimit = limit > 0 ? limit : 10;

    // 计算每个节点的度数
    const nodesWithDegree: Array<GraphNode & { degree: number }> = [];
    for (const [id, node] of this.nodeMap) {
      const degree = this.adjacency.get(id)?.length ?? 0;
      nodesWithDegree.push({ ...node, degree });
    }

    // 按度数降序排列，截取前 limit 个
    nodesWithDegree.sort((a, b) => b.degree - a.degree);

    return {
      nodes: nodesWithDegree.slice(0, effectiveLimit),
    };
  }
}
