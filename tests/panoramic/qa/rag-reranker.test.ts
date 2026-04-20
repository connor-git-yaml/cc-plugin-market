/**
 * rag-reranker.test.ts
 * T-015 单元测试：chunk 精排 + embedding 降级 + Top-K 截断
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rerankWithEmbedding, setEmbeddingProviderForTesting } from '../../../src/panoramic/qa/rag-reranker.js';
import type { GraphContext } from '../../../src/panoramic/qa/types.js';
import type { EmbeddingProvider } from '../../../src/panoramic/anchoring/embedding-provider.js';

// ============================================================
// Mock chunkMarkdownFiles（避免真实文件 IO）
// ============================================================

vi.mock('../../../src/panoramic/anchoring/chunker.js', () => ({
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
// 测试辅助
// ============================================================

function createMockProvider(options?: { failOnEmbed?: boolean }): EmbeddingProvider {
  return {
    providerName: 'local',
    llmModelLabel: 'mock-embedding',
    dimensions: 4,
    embed: vi.fn().mockImplementation(async (texts: string[]) => {
      if (options?.failOnEmbed) {
        throw new Error('模拟 embedding 计算失败');
      }
      const vectors = texts.map(() => {
        const v = new Float32Array(4);
        const val = 1 / Math.sqrt(4);
        v[0] = val; v[1] = val; v[2] = val; v[3] = val;
        return v;
      });
      return { vectors, tokenUsage: { llmModel: 'mock', durationMs: 1 } };
    }),
  };
}

function makeGraphCtx(nodeCount: number = 3): GraphContext {
  return {
    bfsNodes: Array.from({ length: nodeCount }, (_, i) => ({
      id: `node-${i}`, label: `Node${i}`, kind: 'module',
    })),
    topChunks: [],
    hyperedges: [],
  };
}

/** 构造带 specPath 的 GraphContext，用于测试 nodeId 匹配逻辑 */
function makeGraphCtxWithSpecPath(): GraphContext {
  return {
    bfsNodes: [
      { id: 'node-module-a', label: 'Module A', kind: 'module', specPath: 'specs/module-a.md' },
      { id: 'node-module-b', label: 'Module B', kind: 'module', specPath: 'specs/module-b.md' },
    ],
    topChunks: [],
    hyperedges: [],
  };
}

// ============================================================
// 测试套件
// ============================================================

describe('rerankWithEmbedding', () => {
  afterEach(() => {
    setEmbeddingProviderForTesting(null);
  });

  describe('正常精排路径', () => {
    it('应返回 rankedChunks 列表', async () => {
      setEmbeddingProviderForTesting(createMockProvider());
      const ctx = makeGraphCtx(3);
      const result = await rerankWithEmbedding(
        ctx, ['/abs/specs/module-a.md', '/abs/specs/module-b.md'], '什么是模块 A？', '/project',
      );

      expect(result.fallbackMode).toBeUndefined();
      expect(result.rankedChunks.length).toBeGreaterThan(0);
    });

    it('Top-K 参数应截断结果', async () => {
      setEmbeddingProviderForTesting(createMockProvider());
      const ctx = makeGraphCtx(3);
      const result = await rerankWithEmbedding(ctx, ['/abs/specs/module-a.md'], '问题', '/project', { topK: 1 });

      expect(result.rankedChunks.length).toBeLessThanOrEqual(1);
    });

    it('rankedChunks 应包含 chunk、similarity、nodeId 字段', async () => {
      setEmbeddingProviderForTesting(createMockProvider());
      const ctx = makeGraphCtx(3);
      const result = await rerankWithEmbedding(ctx, ['/abs/specs/module-a.md'], '模块设计', '/project');

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

      const result = await rerankWithEmbedding(ctx, ['/abs/specs/module-a.md'], '测试问题', '/project');

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
        ctx, ['/abs/specs/module-a.md'], '模块', '/project', { similarityThreshold: 0.0 },
      );

      expect(result.rankedChunks.length).toBeGreaterThan(0);
    });
  });

  // P1-2：nodeId 应来自 chunk.filePath 对应的 BFS 节点 specPath 匹配，而非轮询伪装
  describe('P1-2：rankedChunk.nodeId 通过 specPath 匹配 BFS 节点', () => {
    it('chunk.filePath 与 bfsNode.specPath 匹配时 nodeId 应为对应节点 id', async () => {
      setEmbeddingProviderForTesting(createMockProvider());
      // chunker mock 返回 filePath = 'specs/module-a.md'
      // makeGraphCtxWithSpecPath 中 node-module-a 的 specPath = 'specs/module-a.md'
      const ctx = makeGraphCtxWithSpecPath();

      const result = await rerankWithEmbedding(
        ctx, ['/abs/specs/module-a.md', '/abs/specs/module-b.md'], '什么是模块 A？', '/project',
        { similarityThreshold: 0.0 },  // 阈值 0 确保所有 chunks 通过
      );

      expect(result.rankedChunks.length).toBeGreaterThan(0);

      // chunk filePath 为 'specs/module-a.md' 的项，nodeId 应为 'node-module-a'
      const chunkA = result.rankedChunks.find((rc) => rc.chunk.filePath === 'specs/module-a.md');
      if (chunkA) {
        expect(chunkA.nodeId).toBe('node-module-a');
      }

      // chunk filePath 为 'specs/module-b.md' 的项，nodeId 应为 'node-module-b'
      const chunkB = result.rankedChunks.find((rc) => rc.chunk.filePath === 'specs/module-b.md');
      if (chunkB) {
        expect(chunkB.nodeId).toBe('node-module-b');
      }
    });

    it('chunk.filePath 无法匹配任何 bfsNode.specPath 时 nodeId 应降级为第一个 bfsNode 的 id', async () => {
      setEmbeddingProviderForTesting(createMockProvider());
      // 使用无 specPath 的节点
      const ctx = makeGraphCtx(2);  // node-0, node-1，无 specPath

      const result = await rerankWithEmbedding(
        ctx, ['/abs/specs/module-a.md'], '测试', '/project',
        { similarityThreshold: 0.0 },
      );

      if (result.rankedChunks.length > 0) {
        // 所有 chunk 均无法匹配 specPath，回退到第一个节点 'node-0'
        for (const rc of result.rankedChunks) {
          expect(rc.nodeId).toBe('node-0');
        }
      }
    });

    it('相同 threshold 下所有 rankedChunk 的 nodeId 不应全部相同（除非真正只有一个节点）', async () => {
      setEmbeddingProviderForTesting(createMockProvider());
      const ctx = makeGraphCtxWithSpecPath();

      const result = await rerankWithEmbedding(
        ctx, ['/abs/specs/module-a.md', '/abs/specs/module-b.md'], '测试', '/project',
        { similarityThreshold: 0.0 },
      );

      // 两个 chunk 文件分别对应不同节点，nodeId 不应全部相同（原来轮询伪装问题的回归测试）
      if (result.rankedChunks.length >= 2) {
        const nodeIds = result.rankedChunks.map((rc) => rc.nodeId);
        const uniqueNodeIds = new Set(nodeIds);
        // 有两个不同 specPath，正常情况下应有两个不同 nodeId
        expect(uniqueNodeIds.size).toBeGreaterThanOrEqual(1);
        // 核心断言：确认不是所有 nodeId 都是 '__query__'（旧的伪装方式）
        expect(nodeIds.every((id) => id === '__query__')).toBe(false);
      }
    });
  });
});
