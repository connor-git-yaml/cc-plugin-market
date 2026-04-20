/**
 * qa/rag-reranker.ts
 * Step 3：chunk 切分 + embedding 精排
 *
 * 职责：
 * - 对候选节点对应的 spec 文件做 Markdown chunk 切分
 * - 用 embedding provider 对 chunks 和问题做向量化
 * - 通过 filterByThreshold 筛选 Top-K 最相关 chunks
 * - embedding 加载失败时降级为 bfs-only（R2 缓解）
 *
 * 设计决策：
 * - embedding provider 采用模块级 singleton（R2 缓解）：按环境配置复用同一实例，
 *   避免每次问答重复初始化 @huggingface/transformers 模型（首次加载 5-15 秒）
 */
import { chunkMarkdownFiles } from '../anchoring/chunker.js';
import { createEmbeddingProvider } from '../anchoring/providers/factory.js';
import { filterByThreshold } from '../anchoring/similarity.js';
import type { EmbeddingProvider } from '../anchoring/embedding-provider.js';
import type { DocChunk } from '../anchoring/chunker.js';
import type { GraphContext } from './types.js';

// ============================================================
// 类型定义
// ============================================================

/** Top-K 精排结果单元 */
export interface RankedChunk {
  /** 对应的 DocChunk 对象（含 filePath, startLine, endLine, text） */
  chunk: DocChunk;
  /** 余弦相似度得分 */
  similarity: number;
  /** 对应节点 ID（来自 filterByThreshold 的 nodeId 字段） */
  nodeId: string;
}

/** rag-reranker 的输入选项 */
export interface RerankOptions {
  /** embedding 精排相似度阈值（默认 0.70） */
  similarityThreshold?: number;
  /** Top-K 截断数量（默认 10） */
  topK?: number;
}

/** rag-reranker 的输出结果 */
export interface RerankResult {
  /** Top-K 精排后的 chunk 列表（按 similarity 降序） */
  rankedChunks: RankedChunk[];
  /** 降级模式：embedding 加载失败时设为 bfs-only */
  fallbackMode?: 'bfs-only';
}

// ============================================================
// 模块级 singleton：按 providerName 缓存 embedding provider
// ============================================================

/** 模块级 embedding provider 缓存（R2 缓解：避免重复初始化） */
let _cachedProvider: EmbeddingProvider | null = null;

/**
 * 获取 embedding provider（模块级 singleton 策略）
 * 首次调用时初始化，后续复用同一实例
 * 测试中可通过 setEmbeddingProviderForTesting() 注入 mock
 */
function getEmbeddingProvider(): EmbeddingProvider {
  if (!_cachedProvider) {
    _cachedProvider = createEmbeddingProvider();
  }
  return _cachedProvider;
}

/**
 * 测试专用：注入 mock embedding provider（覆盖模块级缓存）
 * @param provider - mock 实现；传 null 时重置缓存
 */
export function setEmbeddingProviderForTesting(provider: EmbeddingProvider | null): void {
  _cachedProvider = provider;
}

// ============================================================
// 主函数
// ============================================================

/**
 * 对候选节点对应的 spec 文件做 chunk 切分 + embedding 精排
 *
 * @param graphCtx - graph-retriever 输出的图谱上下文（含 bfsNodes）
 * @param specPaths - 候选节点对应的 spec 文件绝对路径列表
 * @param questionText - 用户问题文本（用于 query embedding）
 * @param projectRoot - 项目根目录（用于计算 repo-relative 路径）
 * @param options - 精排选项（threshold、topK）
 * @returns RerankResult（含精排 chunks 和可选 fallbackMode）
 */
export async function rerankWithEmbedding(
  graphCtx: GraphContext,
  specPaths: string[],
  questionText: string,
  projectRoot: string,
  options?: RerankOptions,
): Promise<RerankResult> {
  const threshold = options?.similarityThreshold ?? 0.70;
  const topK = options?.topK ?? 10;

  // specPaths 为空时直接降级（无 spec 文件可精排）
  if (specPaths.length === 0) {
    return { rankedChunks: [] };
  }

  // Step 3a：Markdown chunk 切分
  const chunks = chunkMarkdownFiles(specPaths, projectRoot);

  if (chunks.length === 0) {
    return { rankedChunks: [] };
  }

  // Step 3b：获取 embedding provider（singleton）
  let provider: EmbeddingProvider;
  try {
    provider = getEmbeddingProvider();
  } catch (err) {
    // embedding provider 初始化失败：降级为 bfs-only（R2）
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[warn] qa/rag-reranker: embedding provider 加载失败，降级为 bfs-only。原因：${message}`);
    return { rankedChunks: [], fallbackMode: 'bfs-only' };
  }

  // Step 3c：批量 embed chunks + 问题
  const chunkTexts = chunks.map((c) => c.text);
  const allTexts = [...chunkTexts, questionText];

  let allVectors: Float32Array[];
  try {
    const embedResult = await provider.embed(allTexts);
    allVectors = embedResult.vectors;
  } catch (err) {
    // embed() 调用失败：降级为 bfs-only（R2）
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[warn] qa/rag-reranker: embedding 计算失败，降级为 bfs-only。原因：${message}`);
    return { rankedChunks: [], fallbackMode: 'bfs-only' };
  }

  // 分离 chunk 向量和 query 向量（最后一个为 query）
  const chunkVectors = allVectors.slice(0, chunks.length);
  const queryVector = allVectors[chunks.length];

  if (!queryVector) {
    console.warn('[warn] qa/rag-reranker: 未能获取 query embedding 向量，降级为 bfs-only');
    return { rankedChunks: [], fallbackMode: 'bfs-only' };
  }

  // Step 3d：以 query 为唯一代理节点，计算 chunk-query 相似度（单一排序维度）
  // 使用 __query__ 作为虚拟节点 ID，避免 chunk × bfsNode 笛卡尔积的语义伪装
  const nodeVectors = new Map<string, Float32Array>();
  nodeVectors.set('__query__', queryVector);

  // Step 3e：filterByThreshold 筛选相似度达标的 pairs（按 chunk-query 相似度排序）
  const pairs = filterByThreshold(chunkVectors, nodeVectors, threshold);

  // Step 3f：将 pairs 映射到 RankedChunk，按 similarity 降序取 Top-K
  // nodeId 来自 chunk.filePath 对应的 BFS 节点（通过 specPath 匹配）
  // 匹配失败时保底使用第一个 bfsNode 的 id
  const fallbackNodeId = graphCtx.bfsNodes[0]?.id ?? '__unknown__';
  const topPairs = pairs.slice(0, topK);

  const rankedChunks: RankedChunk[] = topPairs
    .map((pair) => {
      const chunk = chunks[pair.chunkIndex];
      if (!chunk) return null;

      // 按 specPath 匹配 chunk.filePath 来源所属的 BFS 节点
      const matchedNode = graphCtx.bfsNodes.find(
        (n) => n.specPath !== undefined && (
          // 支持绝对路径和 repo-relative 路径两种情况
          n.specPath === chunk.filePath ||
          chunk.filePath.endsWith(n.specPath) ||
          n.specPath.endsWith(chunk.filePath)
        ),
      );

      return {
        chunk,
        similarity: pair.similarity,
        nodeId: matchedNode?.id ?? fallbackNodeId,
      };
    })
    .filter((item): item is RankedChunk => item !== null);

  return { rankedChunks };
}
