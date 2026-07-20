/**
 * Louvain 社区检测 + oversized 社区分裂
 * 参考 Graphify cluster.py 的分裂策略，简化为 graphology + louvain 纯 JS 实现
 */

import { UndirectedGraph } from 'graphology';
import type { Attributes } from 'graphology-types';
import louvainImport from 'graphology-communities-louvain';
import type { GraphJSON } from '../graph/graph-types.js';

// CJS 互操作
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const louvain = (typeof louvainImport === 'function' ? louvainImport : (louvainImport as any).default) as (
  graph: UndirectedGraph,
) => { [node: string]: number };

// ============================================================
// 类型定义
// ============================================================

/** 单个社区的元数据 */
export interface CommunityInfo {
  /** 社区 ID（从 0 开始，按节点数降序排列） */
  id: number;
  /** 社区内节点 ID 列表 */
  nodes: string[];
  /** 核心节点 Top 3（度数最高） */
  coreNodes: string[];
  /** 内聚度评分：社区内边数 / 最大可能边数 */
  cohesion: number;
}

/** 社区检测结果 */
export interface CommunityResult {
  /** 社区列表（按节点数降序） */
  communities: CommunityInfo[];
  /** 节点 → 社区 ID 映射 */
  nodeCommunityMap: Map<string, number>;
}

/** 检测选项 */
export interface DetectOptions {
  /** 最小社区节点数过滤（默认不过滤） */
  minSize?: number;
}

// ============================================================
// 常量
// ============================================================

/** oversized 社区阈值：占总节点的比例 */
const MAX_COMMUNITY_FRACTION = 0.25;
/** oversized 社区最小节点数 */
const MIN_SPLIT_SIZE = 10;

// ============================================================
// 公共函数
// ============================================================

/**
 * 从 GraphJSON（NetworkX node-link 格式）加载 graphology 无向图
 */
export function loadGraph(graphJson: GraphJSON): UndirectedGraph {
  const graph = new UndirectedGraph();

  for (const node of graphJson.nodes) {
    graph.addNode(node.id, {
      label: node.label,
      kind: node.kind,
      ...node.metadata,
    });
  }

  for (const edge of graphJson.links) {
    // Feature 214 NFR-008 / GATE_DESIGN #4：contains 是纯结构边，不得计入耦合度/聚类度数统计。
    // 在此剔除，使 community/god-node 口径不因新增 contains 边漂移（不改 GraphQueryEngine —
    // graph_node 邻居仍须保留 contains 供 US1 层级遍历）。
    if (edge.relation === 'contains') continue;
    // 跳过悬空边（source/target 不在节点集合中）
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    // 跳过已存在的边（无向图 a-b 与 b-a 等价）
    if (graph.hasEdge(edge.source, edge.target)) continue;
    graph.addEdge(edge.source, edge.target, {
      relation: edge.relation,
      confidence: edge.confidence,
      confidenceScore: edge.confidenceScore,
    });
  }

  return graph;
}

/**
 * 执行 Louvain 社区检测
 * 1. 运行 Louvain 算法分配 communityId
 * 2. 对 oversized 社区执行二次分裂
 * 3. 计算内聚度和核心节点
 */
export function detectCommunities(graph: UndirectedGraph, options?: DetectOptions): CommunityResult {
  const nodeCount = graph.order;

  // 空图或单节点：直接返回
  if (nodeCount <= 1) {
    const nodes = graph.nodes();
    const communities: CommunityInfo[] = nodes.length === 1
      ? [{ id: 0, nodes, coreNodes: nodes, cohesion: 1 }]
      : [];
    const nodeCommunityMap = new Map<string, number>();
    for (const n of nodes) nodeCommunityMap.set(n, 0);
    return { communities, nodeCommunityMap };
  }

  // 运行 Louvain
  const assignments = louvain(graph);

  // 按社区 ID 分组节点
  const communityGroups = new Map<number, string[]>();
  for (const [nodeId, commId] of Object.entries(assignments)) {
    const id = typeof commId === 'number' ? commId : Number(commId);
    let group = communityGroups.get(id);
    if (!group) {
      group = [];
      communityGroups.set(id, group);
    }
    group.push(nodeId);
  }

  // 对 oversized 社区执行二次分裂
  const splitThreshold = Math.max(MIN_SPLIT_SIZE, Math.floor(nodeCount * MAX_COMMUNITY_FRACTION));
  const finalGroups: string[][] = [];

  for (const [, nodes] of communityGroups) {
    if (nodes.length > splitThreshold && nodes.length >= MIN_SPLIT_SIZE) {
      const subGroups = splitCommunity(graph, nodes);
      finalGroups.push(...subGroups);
    } else {
      finalGroups.push(nodes);
    }
  }

  // 按节点数降序排序，生成最终社区 ID
  finalGroups.sort((a, b) => b.length - a.length);

  // 应用 minSize 过滤
  const minSize = options?.minSize ?? 0;
  const filteredGroups = finalGroups.filter(g => g.length >= minSize);

  const nodeCommunityMap = new Map<string, number>();
  const communities: CommunityInfo[] = filteredGroups.map((nodes, idx) => {
    for (const n of nodes) nodeCommunityMap.set(n, idx);
    return {
      id: idx,
      nodes: nodes.sort(),
      coreNodes: getTopNodesByDegree(graph, nodes, 3),
      cohesion: computeCohesion(graph, nodes),
    };
  });

  return { communities, nodeCommunityMap };
}

// ============================================================
// 内部函数
// ============================================================

/**
 * 对 oversized 社区子图执行二次 Louvain 分裂
 * 失败时返回原社区不分裂
 */
function splitCommunity(graph: UndirectedGraph, nodes: string[]): string[][] {
  try {
    // 构建子图
    const subGraph = new UndirectedGraph();
    for (const n of nodes) {
      subGraph.addNode(n, graph.getNodeAttributes(n));
    }
    const nodeSet = new Set(nodes);
    for (const n of nodes) {
      graph.forEachNeighbor(n, (neighbor) => {
        if (nodeSet.has(neighbor) && !subGraph.hasEdge(n, neighbor)) {
          try {
            subGraph.addEdge(n, neighbor, graph.getEdgeAttributes(graph.edge(n, neighbor)!));
          } catch {
            // 边已存在
          }
        }
      });
    }

    // 子图上运行 Louvain
    const subAssignments = louvain(subGraph);
    const subGroups = new Map<number, string[]>();
    for (const [nodeId, commId] of Object.entries(subAssignments)) {
      const id = typeof commId === 'number' ? commId : Number(commId);
      let group = subGroups.get(id);
      if (!group) {
        group = [];
        subGroups.set(id, group);
      }
      group.push(nodeId);
    }

    // 仅在分裂产生 >= 2 个社区时接受结果
    if (subGroups.size >= 2) {
      return [...subGroups.values()];
    }
    return [nodes];
  } catch {
    return [nodes];
  }
}

/**
 * 取社区内度数最高的 Top N 节点
 */
function getTopNodesByDegree(graph: UndirectedGraph, nodes: string[], topN: number): string[] {
  return nodes
    .map(n => ({ id: n, degree: graph.degree(n) }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, topN)
    .map(n => n.id);
}

/**
 * 计算社区内聚度：社区内边数 / 最大可能边数
 * 参考 Graphify cohesion_score
 */
function computeCohesion(graph: UndirectedGraph, nodes: string[]): number {
  const n = nodes.length;
  if (n <= 1) return 1;

  const maxPossible = (n * (n - 1)) / 2;
  const nodeSet = new Set(nodes);
  let internalEdges = 0;

  for (const node of nodes) {
    graph.forEachNeighbor(node, (neighbor) => {
      if (nodeSet.has(neighbor)) {
        internalEdges++;
      }
    });
  }

  // 无向图每条边被计数两次
  internalEdges = internalEdges / 2;

  return Math.round((internalEdges / maxPossible) * 1000) / 1000;
}
