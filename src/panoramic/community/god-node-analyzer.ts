/**
 * God Node 识别 + 启发式过滤
 * 参考 Graphify analyze.py 的 god_nodes 策略
 * 排除文件级 hub（kind='package'）和纯容器节点（仅 contains 关系）
 */

import type { UndirectedGraph } from 'graphology';

// ============================================================
// 类型定义
// ============================================================

/** God Node 描述 */
export interface GodNode {
  /** 节点 ID */
  id: string;
  /** 显示标签 */
  label: string;
  /** 度数 */
  degree: number;
  /** 连接最多的关系类型 */
  primaryRelation: string;
  /** 所属社区 ID */
  communityId: number;
}

// ============================================================
// 公共函数
// ============================================================

/**
 * 识别 God Node：度数 > 均值 + 2σ，排除 package 节点和纯 contains 节点
 *
 * @param graph - graphology 图实例
 * @param nodeCommunityMap - 节点 → 社区 ID 映射
 * @returns God Node 列表（按度数降序）
 */
export function findGodNodes(
  graph: UndirectedGraph,
  nodeCommunityMap: Map<string, number>,
): GodNode[] {
  const nodes = graph.nodes();
  if (nodes.length === 0) return [];

  // 计算所有节点度数
  const degrees = nodes.map(n => graph.degree(n));
  const mean = degrees.reduce((a, b) => a + b, 0) / degrees.length;
  const variance = degrees.reduce((a, d) => a + (d - mean) ** 2, 0) / degrees.length;
  const stdDev = Math.sqrt(variance);
  const threshold = mean + 2 * stdDev;

  // 阈值至少为 2，避免稀疏图中所有节点都被标记
  const effectiveThreshold = Math.max(threshold, 2);

  const godNodes: GodNode[] = [];

  for (const nodeId of nodes) {
    const degree = graph.degree(nodeId);
    if (degree <= effectiveThreshold) continue;

    // 过滤 1：排除 kind='package' 节点
    const kind = graph.getNodeAttribute(nodeId, 'kind') as string | undefined;
    if (kind === 'package') continue;

    // 过滤 2：排除仅有 contains 关系的节点
    if (isContainsOnly(graph, nodeId)) continue;

    // 统计主要关系类型
    const primaryRelation = getPrimaryRelation(graph, nodeId);

    godNodes.push({
      id: nodeId,
      label: (graph.getNodeAttribute(nodeId, 'label') as string) ?? nodeId,
      degree,
      primaryRelation,
      communityId: nodeCommunityMap.get(nodeId) ?? -1,
    });
  }

  // 按度数降序排序
  godNodes.sort((a, b) => b.degree - a.degree);

  return godNodes;
}

// ============================================================
// 内部函数
// ============================================================

/**
 * 检查节点是否仅有 contains 关系
 */
function isContainsOnly(graph: UndirectedGraph, nodeId: string): boolean {
  let hasNonContains = false;
  graph.forEachEdge(nodeId, (_edge, attrs) => {
    if (hasNonContains) return;
    const relation = attrs['relation'] as string | undefined;
    if (relation !== 'contains') {
      hasNonContains = true;
    }
  });
  return !hasNonContains;
}

/**
 * 获取节点连接最多��关系类型
 */
function getPrimaryRelation(graph: UndirectedGraph, nodeId: string): string {
  const counts = new Map<string, number>();
  graph.forEachEdge(nodeId, (_edge, attrs) => {
    const relation = (attrs['relation'] as string) ?? 'unknown';
    counts.set(relation, (counts.get(relation) ?? 0) + 1);
  });

  let maxRelation = 'unknown';
  let maxCount = 0;
  for (const [relation, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxRelation = relation;
    }
  }
  return maxRelation;
}
