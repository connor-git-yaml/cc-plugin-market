/**
 * anchoring 模块对外接口
 * 编排函数 anchorDocToCode：Chunking → Embedding → Similarity → EdgeBuilding
 * 零 chunk 降级：直接返回空结果，不调用 EmbeddingProvider（FR-015）
 * tokenUsage 记录与 BudgetGate F1 格式对齐（FR-016，AC-011）
 */
import type { GraphEdge, GraphNode } from '../graph/graph-types.js';
import type { EmbeddingProvider, EmbeddingTokenUsage } from './embedding-provider.js';
import { chunkMarkdownFiles, type DocChunkerOptions } from './chunker.js';
import { filterByThreshold } from './similarity.js';
import { buildSemanticEdges, type CodeNodeInfo } from './edge-builder.js';

// ============================================================
// 对外接口类型
// ============================================================

/**
 * anchorDocToCode 的输入选项
 */
export interface AnchorOptions {
  /** 项目根目录（绝对路径，用于计算 repo-relative 路径） */
  projectRoot: string;
  /** Markdown 文档文件绝对路径列表（空时零 chunk 降级） */
  markdownFiles: string[];
  /** 图谱中的代码节点列表（用于生成 embedding 和边） */
  graphNodes: GraphNode[];
  /** EmbeddingProvider 实例（Local 或 OpenAI） */
  provider: EmbeddingProvider;
  /** 相似度阈值（默认 0.75，含边界） */
  threshold?: number;
  /** evidenceText 最大字符数（默认 200） */
  maxEvidenceLength?: number;
  /** Chunker 选项（默认 maxTokens=512） */
  chunkerOptions?: DocChunkerOptions;
}

/**
 * anchorDocToCode 的返回值
 */
export interface AnchorResult {
  /** 生成的语义边列表 */
  edges: GraphEdge[];
  /**
   * 所有 embedding 调用的 token 使用记录列表
   * 格式与 BudgetGate F1 的 BudgetGateAttempt 兼容（含 llmModel + durationMs）
   */
  tokenUsage: EmbeddingTokenUsage[];
  /** 统计信息 */
  stats: {
    /** 处理的 chunk 数量 */
    chunksProcessed: number;
    /** 生成的语义边数量 */
    edgesGenerated: number;
    /** 总耗时（毫秒） */
    durationMs: number;
  };
}

// ============================================================
// 主函数
// ============================================================

/**
 * 文档 → 代码节点语义锚定编排函数
 *
 * 步骤：
 * 1. chunkMarkdownFiles() → DocChunk[]
 * 2. 若 chunks 为空，提前返回零结果（FR-015）
 * 3. provider.embed(chunkTexts) → chunk 向量
 * 4. provider.embed(nodeSignatures) → node 向量
 * 5. filterByThreshold() → SimilarPair[]
 * 6. buildSemanticEdges() → GraphEdge[]
 * 7. 汇总 tokenUsage
 *
 * @param options AnchorOptions
 * @returns AnchorResult
 */
export async function anchorDocToCode(options: AnchorOptions): Promise<AnchorResult> {
  const startMs = performance.now();
  const {
    projectRoot,
    markdownFiles,
    graphNodes,
    provider,
    threshold = 0.75,
    maxEvidenceLength = 200,
    chunkerOptions,
  } = options;

  const tokenUsageList: EmbeddingTokenUsage[] = [];

  // Step 1：Hybrid Chunking
  const chunks = chunkMarkdownFiles(markdownFiles, projectRoot, chunkerOptions);

  // Step 2：零 chunk 降级（FR-015）
  if (chunks.length === 0) {
    return {
      edges: [],
      tokenUsage: [],
      stats: {
        chunksProcessed: 0,
        edgesGenerated: 0,
        durationMs: performance.now() - startMs,
      },
    };
  }

  // Step 3：Embed chunks
  const chunkTexts = chunks.map(c => c.text);
  const chunkEmbedResult = await provider.embed(chunkTexts);
  tokenUsageList.push(chunkEmbedResult.tokenUsage);

  // Step 4：Embed code node signatures
  // 使用 node.id + node.label 作为代码节点签名（提升语义匹配质量）
  const codeNodes: CodeNodeInfo[] = graphNodes.map(n => ({
    id: n.id,
    name: n.label || n.id,
  }));

  let nodeVectors: Map<string, Float32Array>;

  if (codeNodes.length > 0) {
    const nodeTexts = codeNodes.map(n => `${n.name} ${n.id}`);
    const nodeEmbedResult = await provider.embed(nodeTexts);
    tokenUsageList.push(nodeEmbedResult.tokenUsage);

    // 构造 nodeId → vector Map
    nodeVectors = new Map<string, Float32Array>();
    for (let i = 0; i < codeNodes.length; i++) {
      const vec = nodeEmbedResult.vectors[i];
      const node = codeNodes[i];
      if (vec && node) {
        nodeVectors.set(node.id, vec);
      }
    }
  } else {
    nodeVectors = new Map();
  }

  // Step 5：相似度过滤
  const pairs = filterByThreshold(chunkEmbedResult.vectors, nodeVectors, threshold);

  // Step 6：生成语义边
  const edges = buildSemanticEdges({
    chunks,
    pairs,
    codeNodes,
    projectRoot,
    maxEvidenceLength,
  });

  return {
    edges,
    tokenUsage: tokenUsageList,
    stats: {
      chunksProcessed: chunks.length,
      edgesGenerated: edges.length,
      durationMs: performance.now() - startMs,
    },
  };
}

// ============================================================
// Re-exports
// ============================================================

export type { DocChunk, DocChunkerOptions } from './chunker.js';
export { chunkMarkdownFiles } from './chunker.js';
export type { EmbeddingProvider, EmbedResult, EmbeddingTokenUsage } from './embedding-provider.js';
export type { SimilarPair } from './similarity.js';
export { cosineSimilarity, filterByThreshold } from './similarity.js';
export type { BuildEdgesOptions, CodeNodeInfo } from './edge-builder.js';
export { buildSemanticEdges } from './edge-builder.js';
