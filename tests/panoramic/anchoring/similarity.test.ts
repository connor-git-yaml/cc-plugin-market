/**
 * Cosine 相似度 + 阈值过滤单元测试
 * 覆盖：含边界值（0.75 生成对）、低于边界（0.7499 不生成）、空向量降级
 */
import { describe, it, expect } from 'vitest';
import { cosineSimilarity, filterByThreshold } from '../../../src/panoramic/anchoring/similarity.js';

// ============================================================
// 辅助函数
// ============================================================

/** 创建一个 n 维全 1 归一化向量 */
function onesVec(n: number): Float32Array {
  const v = new Float32Array(n).fill(1 / Math.sqrt(n));
  return v;
}

/** 创建两个余弦相似度为指定值的向量对（通过角度计算） */
function vectorsWithSimilarity(targetSimilarity: number, dims: number = 4): [Float32Array, Float32Array] {
  // a = [1, 0, ..., 0]
  const a = new Float32Array(dims);
  a[0] = 1;
  // b = [cos(θ), sin(θ), 0, ..., 0]，则 a·b = cos(θ)
  const b = new Float32Array(dims);
  const theta = Math.acos(Math.max(-1, Math.min(1, targetSimilarity)));
  b[0] = Math.cos(theta);
  b[1] = Math.sin(theta);
  return [a, b];
}

// ============================================================
// cosineSimilarity 测试
// ============================================================

describe('cosineSimilarity', () => {
  it('相同向量的余弦相似度为 1', () => {
    const v = new Float32Array([1, 0, 0, 0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('正交向量的余弦相似度为 0', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('零向量返回 0 不报错', () => {
    const zero = new Float32Array([0, 0, 0]);
    const v = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(zero, v)).toBe(0);
    expect(cosineSimilarity(zero, zero)).toBe(0);
  });

  it('空向量返回 0 不报错', () => {
    const empty = new Float32Array(0);
    expect(cosineSimilarity(empty, empty)).toBe(0);
  });
});

// ============================================================
// filterByThreshold 测试
// ============================================================

describe('filterByThreshold', () => {
  it('测试用例 1：similarity 0.80 >= threshold 0.75，生成 pair', () => {
    const [a, b] = vectorsWithSimilarity(0.8);
    const chunks = [a];
    const nodes = new Map([['node-1', b]]);

    const pairs = filterByThreshold(chunks, nodes, 0.75);

    expect(pairs.length).toBe(1);
    expect(pairs[0].chunkIndex).toBe(0);
    expect(pairs[0].nodeId).toBe('node-1');
    expect(pairs[0].similarity).toBeCloseTo(0.8, 2);
  });

  it('测试用例 2：similarity 0.75 >= threshold 0.75（含边界），生成 pair', () => {
    const [a, b] = vectorsWithSimilarity(0.75);
    const chunks = [a];
    const nodes = new Map([['node-2', b]]);

    const pairs = filterByThreshold(chunks, nodes, 0.75);

    expect(pairs.length).toBe(1);
    expect(pairs[0].similarity).toBeCloseTo(0.75, 2);
  });

  it('测试用例 3：similarity 0.7499 < threshold 0.75，不生成 pair', () => {
    const [a, b] = vectorsWithSimilarity(0.7499);
    const chunks = [a];
    const nodes = new Map([['node-3', b]]);

    const pairs = filterByThreshold(chunks, nodes, 0.75);

    expect(pairs.length).toBe(0);
  });

  it('测试用例 4：空 chunkVectors，返回 [] 不报错', () => {
    const nodes = new Map([['node-4', new Float32Array([1, 0])]]);
    const pairs = filterByThreshold([], nodes, 0.75);
    expect(pairs).toEqual([]);
  });

  it('测试用例 5：空 nodeVectors Map，返回 [] 不报错', () => {
    const chunks = [new Float32Array([1, 0])];
    const pairs = filterByThreshold(chunks, new Map(), 0.75);
    expect(pairs).toEqual([]);
  });

  it('多节点时返回所有超过阈值的 pair，按相似度降序排列', () => {
    const [a1, b1] = vectorsWithSimilarity(0.9);
    const [, b2] = vectorsWithSimilarity(0.8);
    const chunks = [a1];
    const nodes = new Map([
      ['high', b1],
      ['medium', b2],
    ]);

    const pairs = filterByThreshold(chunks, nodes, 0.75);

    expect(pairs.length).toBe(2);
    // 按相似度降序排列
    expect(pairs[0].similarity).toBeGreaterThan(pairs[1].similarity);
  });
});
