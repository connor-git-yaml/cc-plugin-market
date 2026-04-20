/**
 * qa/graph-retriever.ts
 * Step 1-2：Graph BFS 检索 + hyperedge 扩展
 *
 * 职责：
 * - 通过 GraphQueryEngine.query() 做 BFS 候选节点检索
 * - 通过 engine.getHyperedges() 做 label + nodeId 两种命中方式扩展
 * - 合并去重，构建 GraphContext
 * - BFS 命中 < 3 节点时设 fallbackMode = 'rag-only'（R1 / FR-014）
 */
import type { GraphQueryEngine } from '../graph/graph-query.js';
import type { Hyperedge } from '../graph/graph-types.js';
import type { GraphContext } from './types.js';

// ============================================================
// 内部类型
// ============================================================

/** graph-retriever 的输入选项 */
export interface GraphRetrieverOptions {
  /** BFS 节点预算（默认 20） */
  budget?: number;
  /** BFS 遍历深度（默认 2） */
  depth?: number;
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 对数组元素按 key 函数去重，保留首次出现的元素
 */
function dedup<T>(arr: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of arr) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

// ============================================================
// 主函数
// ============================================================

/**
 * 通过 BFS + hyperedge 扩展检索与问题相关的图谱上下文
 *
 * @param questionText - 用户问题文本
 * @param engine - GraphQueryEngine 实例
 * @param options - 检索选项（budget、depth）
 * @returns GraphContext（含 bfsNodes、hyperedges、fallbackMode）
 */
export function retrieveGraphContext(
  questionText: string,
  engine: GraphQueryEngine,
  options?: GraphRetrieverOptions,
): GraphContext {
  const budget = options?.budget ?? 20;
  const depth = options?.depth ?? 2;

  // Step 1：BFS 关键词子图检索
  const queryResult = engine.query(questionText, { budget, mode: 'bfs', depth });
  const bfsNodes = queryResult.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    specPath: (n.metadata['specPath'] as string | undefined),
  }));

  // Step 2：hyperedge 扩展（两种命中方式）

  // 方式 1：按 label 子串模糊匹配（问题含流程名时适用）
  // 截取问题前 30 字符作为 label 搜索词
  const labelQuery = questionText.slice(0, 30).trim();
  const heByLabel: Hyperedge[] = labelQuery.length > 0
    ? engine.getHyperedges({ label: labelQuery })
    : [];

  // 方式 2：按已命中的 BFS 节点 ID 精确匹配（最多取前 5 个种子节点）
  const heByNode: Hyperedge[] = [];
  for (const bfsNode of bfsNodes.slice(0, 5)) {
    const hes = engine.getHyperedges({ nodeId: bfsNode.id });
    heByNode.push(...hes);
  }

  // 合并去重（按 hyperedge.id 去重）
  const allHyperedges = dedup([...heByLabel, ...heByNode], (he) => he.id);

  // fallback 判断：BFS 命中 < 3 节点时降级为纯 RAG（R1 / FR-014）
  const fallbackMode: GraphContext['fallbackMode'] =
    bfsNodes.length < 3 ? 'rag-only' : undefined;

  return {
    bfsNodes,
    topChunks: [], // 由 rag-reranker 填充
    hyperedges: allHyperedges,
    fallbackMode,
  };
}
