/**
 * Cosine 相似度计算 + 阈值过滤
 * 使用 Float32Array 优化计算性能
 * 阈值过滤：similarity >= threshold（含边界值，FR-012）
 */

// ============================================================
// 类型定义
// ============================================================

/**
 * 相似对（Chunk × CodeNode）
 */
export interface SimilarPair {
  /** chunk 在输入数组中的索引 */
  chunkIndex: number;
  /** 代码节点 ID */
  nodeId: string;
  /** 余弦相似度得分（0.0 到 1.0） */
  similarity: number;
}

// ============================================================
// Cosine 相似度
// ============================================================

/**
 * 计算两个 Float32Array 向量的余弦相似度
 * 假设向量已归一化（all-MiniLM-L6-v2 输出已 normalize=true）
 * 若未归一化则计算点积 / (||a|| × ||b||)
 *
 * @param a 向量 a
 * @param b 向量 b
 * @returns 余弦相似度，范围 [-1, 1]（已归一化向量为 [0, 1]）
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    // Float32Array 的 TypedArray 访问：使用 || 0 兜底（noUncheckedIndexedAccess 不影响 TypedArray）
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dot / denominator;
}

// ============================================================
// 阈值过滤
// ============================================================

/**
 * 对所有 (chunkIndex, nodeId) 组合批量计算余弦相似度，
 * 过滤出 similarity >= threshold 的对（含边界值，FR-012）
 *
 * @param chunkVectors  各 chunk 的 embedding 向量列表（顺序与 chunks 对应）
 * @param nodeVectors   代码节点 ID → embedding 向量的 Map
 * @param threshold     相似度阈值（默认 0.75，含边界）
 * @returns 所有满足阈值的相似对，按 similarity 降序排列
 */
export function filterByThreshold(
  chunkVectors: Float32Array[],
  nodeVectors: Map<string, Float32Array>,
  threshold: number,
): SimilarPair[] {
  // 空向量列表直接返回空数组（FR-015 降级）
  if (chunkVectors.length === 0 || nodeVectors.size === 0) {
    return [];
  }

  const pairs: SimilarPair[] = [];

  for (let i = 0; i < chunkVectors.length; i++) {
    const chunkVec = chunkVectors[i];
    if (!chunkVec) continue;

    for (const [nodeId, nodeVec] of nodeVectors) {
      if (!nodeVec) continue;
      const similarity = cosineSimilarity(chunkVec, nodeVec);
      // 含边界：>= threshold（FR-012）
      if (similarity >= threshold) {
        pairs.push({ chunkIndex: i, nodeId, similarity });
      }
    }
  }

  // 按相似度降序排列（方便下游使用）
  pairs.sort((a, b) => b.similarity - a.similarity);

  return pairs;
}
