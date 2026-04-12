/**
 * 跨社区异常边发现 + betweenness 近似采样
 * 参考 Graphify analyze.py 的 surprising_connections 策略
 * 复合评分：跨社区加成 + 置信度权重 + betweenness centrality
 */

import type { UndirectedGraph } from 'graphology';
import type { ConfidenceLevel } from '../graph/graph-types.js';

// ============================================================
// 类型定义
// ============================================================

/** 异常边描述 */
export interface SurprisingEdge {
  /** 来源节点 ID */
  source: string;
  /** 目标节点 ID */
  target: string;
  /** 关系类型 */
  relation: string;
  /** 置信度标签 */
  confidence: string;
  /** 是否跨社区 */
  crossCommunity: boolean;
  /** 复合惊奇度评分（越高越"意外"） */
  score: number;
}

/** 发现选项 */
export interface SurprisingEdgesOptions {
  /** betweenness 采样的源节点数（默认 1000） */
  sampleSize?: number;
  /** 返回 Top N 条异常边（默认 10） */
  topN?: number;
}

// ============================================================
// 常量
// ============================================================

/** 置信度惊奇权重：低置信度 = 更意外 */
const CONFIDENCE_SURPRISE_WEIGHT: Record<string, number> = {
  AMBIGUOUS: 3,
  INFERRED: 2,
  EXTRACTED: 1,
};

// ============================================================
// 公共函数
// ============================================================

/**
 * 发现跨社区异常边
 * 评分策略：
 * 1. 跨社区加成（+3）
 * 2. 置信度权重（AMBIGUOUS=3, INFERRED=2, EXTRACTED=1）
 * 3. betweenness centrality 采样归一化加成
 *
 * @param graph - graphology 图实例
 * @param nodeCommunityMap - 节点 → 社区 ID 映射
 * @param options - 采样和返回数量配置
 * @returns 异常边列表（按评分降序）
 */
export function findSurprisingEdges(
  graph: UndirectedGraph,
  nodeCommunityMap: Map<string, number>,
  options?: SurprisingEdgesOptions,
): SurprisingEdge[] {
  const topN = options?.topN ?? 10;
  const sampleSize = options?.sampleSize ?? 1000;

  if (graph.size === 0) return [];

  // 计算边 betweenness（采样近似）
  const edgeBetweenness = approximateEdgeBetweenness(graph, sampleSize);

  // 归一化 betweenness（避免 spread 大 Map 导致栈溢出）
  let maxBetweenness = 1;
  for (const v of edgeBetweenness.values()) {
    if (v > maxBetweenness) maxBetweenness = v;
  }

  const candidates: SurprisingEdge[] = [];

  graph.forEachEdge((_edge, attrs, source, target) => {
    const sourceCommunity = nodeCommunityMap.get(source);
    const targetCommunity = nodeCommunityMap.get(target);
    const crossCommunity = sourceCommunity !== undefined
      && targetCommunity !== undefined
      && sourceCommunity !== targetCommunity;

    // 仅保留跨社区边或低置信度边
    const confidence = (attrs['confidence'] as ConfidenceLevel) ?? 'EXTRACTED';
    if (!crossCommunity && confidence === 'EXTRACTED') return;

    // 排除纯结构边
    const relation = (attrs['relation'] as string) ?? 'unknown';
    if (relation === 'contains') return;

    // 复合评分
    let score = 0;
    if (crossCommunity) score += 3;
    score += CONFIDENCE_SURPRISE_WEIGHT[confidence] ?? 1;

    // betweenness 归一化加成（0-2 分）
    const edgeKey = [source, target].sort().join('|');
    const betweenness = edgeBetweenness.get(edgeKey) ?? 0;
    score += (betweenness / maxBetweenness) * 2;

    candidates.push({
      source,
      target,
      relation,
      confidence,
      crossCommunity,
      score: Math.round(score * 100) / 100,
    });
  });

  // 按评分降序，取 Top N
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, topN);
}

// ============================================================
// 内���函数
// ============================================================

/**
 * 近似边 betweenness centrality（BFS 采样）
 * 从随机采样的源节点出发做 BFS，统计每条边被最短路径经过的次数
 *
 * @param graph - graphology 图实例
 * @param sampleSize - 采样的源节点数
 * @returns Map<edgeKey, betweenness count>
 */
function approximateEdgeBetweenness(
  graph: UndirectedGraph,
  sampleSize: number,
): Map<string, number> {
  const betweenness = new Map<string, number>();
  const allNodes = graph.nodes();

  if (allNodes.length === 0) return betweenness;

  // 随机采样源节点
  const sampledSources = sampleNodes(allNodes, Math.min(sampleSize, allNodes.length));

  for (const source of sampledSources) {
    // BFS 计算从 source 到所有节点的最短路径
    const dist = new Map<string, number>();
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const queue: string[] = [source];

    dist.set(source, 0);
    sigma.set(source, 1);

    while (queue.length > 0) {
      const v = queue.shift()!;
      const dv = dist.get(v)!;

      graph.forEachNeighbor(v, (w) => {
        if (!dist.has(w)) {
          dist.set(w, dv + 1);
          queue.push(w);
        }
        if (dist.get(w) === dv + 1) {
          sigma.set(w, (sigma.get(w) ?? 0) + (sigma.get(v) ?? 1));
          const preds = pred.get(w) ?? [];
          preds.push(v);
          pred.set(w, preds);
        }
      });
    }

    // 反向累加 betweenness
    const delta = new Map<string, number>();
    // 按距离降序处理节点
    const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);

    for (const [w] of sorted) {
      if (w === source) continue;
      const dw = delta.get(w) ?? 0;
      const sigmaW = sigma.get(w) ?? 1;

      for (const v of pred.get(w) ?? []) {
        const sigmaV = sigma.get(v) ?? 1;
        const contribution = (sigmaV / sigmaW) * (1 + dw);
        delta.set(v, (delta.get(v) ?? 0) + contribution);

        // 累加到边 betweenness
        const edgeKey = [v, w].sort().join('|');
        betweenness.set(edgeKey, (betweenness.get(edgeKey) ?? 0) + contribution);
      }
    }
  }

  return betweenness;
}

/**
 * 从数组中随机采样 N 个元素（Fisher-Yates 部分洗牌）
 */
function sampleNodes(nodes: string[], n: number): string[] {
  const copy = [...nodes];
  for (let i = copy.length - 1; i > copy.length - 1 - n && i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(copy.length - n);
}
