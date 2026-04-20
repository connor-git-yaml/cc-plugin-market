/**
 * rag-reranker.test.ts
 * T-015 单元测试：chunk 精排 + embedding 降级 + Top-K 截断
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rerankWithEmbedding, setEmbeddingProviderForTesting } from '../rag-reranker.js';
import type { GraphContext } from '../types.js';
import type { EmbeddingProvider } from '../../anchoring/embedding-provider.js';

// ============================================================
// Mock 辅助函数
// ============================================================

/**
 * 创建一个简单的 EmbeddingProvider mock
 * 对每段文本返回一个确定性的 Float32Array（用文本长度作伪向量）
 */
function createMockProvider(options?: {
  failOnEmbed?: boolean;
}): EmbeddingProvider {
  return {
    providerName: 'local',
    llmModelLabel: 'mock-embedding',
    dimensions: 4,
    embed: vi.fn().mockImplementation(async (texts: string[]) => {
      if (options?.failOnEmbed) {
        throw new Error('模拟 embedding 计算失败');
      }
      // 每段文本生成一个 4 维向量（归一化，值相同以确保高相似度）
      const vectors = texts.map(() => {
        const v = new Float32Array(4);
        const val = 1 / Math.sqrt(4); // 归一化
        v[0] = val; v[1] = val; v[2] = val; v[3] = val;
        return v;
      });
      return {
        vectors,
        tokenUsage: { llmModel: 'mock', durationMs: 1 },
      };
    }),
  };
}

/** 构造一个最小化的 GraphContext */
function makeGraphCtx(nodeCount: number = 3): GraphContext {
  return {
    bfsNodes: Array.from({ length: nodeCount }, (_, i) => ({
      id: `node-${i}`,
      label: `Node${i}`,
      kind: 'module',
    })),
    topChunks: [],
    hyperedges: [],
  };
}

// ============================================================
// Mock chunkMarkdownFiles（避免真实文件 IO）
// ============================================================

vi.mock('../../anchoring/chunker.js', () => ({
  chunkMarkdownFiles: vi.fn().mockReturnValue([
    {
      filePath: 'specs/module-a.md',
      startLine: 1,
      endLine: 10,
      headingPath: '## Overview',
      text: '这是模块 A 的概述',
      tokenCount: 20,
    },
    {
      filePath: 'specs/module-b.md',
      startLine: 1,
      endLine: 8,
      headingPath: '## Design',
      text: '这是模块 B 的设计说明',
      tokenCount: 18,
    },
  ]),
}));

// ============================================================
// 测试套件
// ============================================================

describe('rerankWithEmbedding', () => {
  afterEach(() => {
    // 重置 singleton，避免测试间相互影响
    setEmbeddingProviderForTesting(null);
  });

  describe('正常精排路径', () => {
    it('应返回 rankedChunks 列表', async () => {
      setEmbeddingProviderForTesting(createMockProvider());
      const ctx = makeGraphCtx(3);
      const result = await rerankWithEmbedding(
        ctx,
        ['/abs/specs/module-a.md', '/abs/specs/module-b.md'],
        '什么是模块 A？',
        '/project',
      );

      expect(result.fallbackMode).toBeUndefined();
      expect(result.rankedChunks.length).toBeGreaterThan(0);
    });

    it('Top-K 参数应截断结果', async () => {
      setEmbeddingProviderForTesting(createMockProvider());
      const ctx = makeGraphCtx(3);
      const result = await rerankWithEmbedding(
        ctx,
        ['/abs/specs/module-a.md'],
        '问题',
        '/project',
        { topK: 1 },
      );

      expect(result.rankedChunks.length).toBeLessThanOrEqual(1);
    });

    it('rankedChunks 应包含 chunk、similarity、nodeId 字段', async () => {
      setEmbeddingProviderForTesting(createMockProvider());
      const ctx = makeGraphCtx(3);
      const result = await rerankWithEmbedding(
        ctx,
        ['/abs/specs/module-a.md'],
        '模块设计',
        '/project',
      );

      if (result.rankedChunks.length > 0) {
        const first = result.rankedChunks[0]!;
        expect(first.chunk).toBeDefined();
        expect(first.chunk.filePath).toBeDefined();
        expect(typeof first.similarity).toBe('number');
        expect(typeof first.nodeId).toBe('string');
      }
    });
  });

  describe('embedding 加载失败降级', () => {
    it('embed() 失败时应降级为 bfs-only，不抛出异常', async () => {
      setEmbeddingProviderForTesting(createMockProvider({ failOnEmbed: true }));
      const ctx = makeGraphCtx(3);

      const result = await rerankWithEmbedding(
        ctx,
        ['/abs/specs/module-a.md'],
        '测试问题',
        '/project',
      );

      expect(result.fallbackMode).toBe('bfs-only');
      expect(result.rankedChunks).toEqual([]);
    });
  });

  describe('边界条件', () => {
    it('specPaths 为空时应直接返回空结果', async () => {
      setEmbeddingProviderForTesting(createMockProvider());
      const ctx = makeGraphCtx(3);

      const result = await rerankWithEmbedding(ctx, [], '问题', '/project');

      expect(result.rankedChunks).toEqual([]);
      expect(result.fallbackMode).toBeUndefined();
    });

    it('低相似度阈值（0.0）时应返回所有 chunks', async () => {
      setEmbeddingProviderForTesting(createMockProvider());
      const ctx = makeGraphCtx(3);

      const result = await rerankWithEmbedding(
        ctx,
        ['/abs/specs/module-a.md'],
        '模块',
        '/project',
        { similarityThreshold: 0.0 },
      );

      // 所有 chunks 都应满足阈值 0.0
      expect(result.rankedChunks.length).toBeGreaterThan(0);
    });
  });
});
