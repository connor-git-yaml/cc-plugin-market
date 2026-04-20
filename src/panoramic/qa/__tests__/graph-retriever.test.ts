/**
 * graph-retriever.test.ts
 * T-014 单元测试：BFS + hyperedge 扩展 + fallback 逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retrieveGraphContext } from '../graph-retriever.js';
import type { GraphQueryEngine } from '../../graph/graph-query.js';

// ============================================================
// Mock 工厂函数
// ============================================================

/**
 * 创建 GraphQueryEngine mock，支持自定义返回节点数量和 hyperedges
 */
function createMockEngine(overrides?: {
  nodeCount?: number;
  hyperedges?: Array<{ id: string; label: string; nodes: string[]; rationale: string; confidence: 'INFERRED' }>;
}): GraphQueryEngine {
  const nodeCount = overrides?.nodeCount ?? 5;
  const hyperedges = overrides?.hyperedges ?? [];

  // 生成 nodeCount 个假节点
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `node-${i}`,
    kind: 'module' as const,
    label: `Module${i}`,
    metadata: {},
  }));

  return {
    query: vi.fn().mockReturnValue({
      nodes,
      edges: [],
      summary: `找到 ${nodeCount} 个相关节点`,
      truncated: false,
      totalMatches: nodeCount,
    }),
    getHyperedges: vi.fn().mockReturnValue(hyperedges),
    // 满足 GraphQueryEngine 类型，其余方法暂不使用
  } as unknown as GraphQueryEngine;
}

// ============================================================
// 测试套件
// ============================================================

describe('retrieveGraphContext', () => {
  describe('正常命中路径（≥ 3 个节点）', () => {
    it('应返回 bfsNodes 列表且 fallbackMode 为 undefined', () => {
      const engine = createMockEngine({ nodeCount: 5 });
      const ctx = retrieveGraphContext('什么调用了认证模块', engine);

      expect(ctx.bfsNodes).toHaveLength(5);
      expect(ctx.fallbackMode).toBeUndefined();
    });

    it('应调用 engine.query 并传入问题文本', () => {
      const engine = createMockEngine({ nodeCount: 5 });
      retrieveGraphContext('认证流程', engine, { budget: 10, depth: 3 });

      expect(engine.query).toHaveBeenCalledWith('认证流程', {
        budget: 10,
        mode: 'bfs',
        depth: 3,
      });
    });

    it('应调用 getHyperedges 做 label 匹配', () => {
      const engine = createMockEngine({ nodeCount: 5 });
      retrieveGraphContext('认证流程测试', engine);

      // label query 为前 30 字符
      expect(engine.getHyperedges).toHaveBeenCalledWith(
        expect.objectContaining({ label: expect.any(String) }),
      );
    });
  });

  describe('fallback 触发（< 3 个节点）', () => {
    it('BFS 命中 2 个节点时应设 fallbackMode = rag-only', () => {
      const engine = createMockEngine({ nodeCount: 2 });
      const ctx = retrieveGraphContext('罕见模块查询', engine);

      expect(ctx.bfsNodes).toHaveLength(2);
      expect(ctx.fallbackMode).toBe('rag-only');
    });

    it('BFS 命中 0 个节点时应设 fallbackMode = rag-only', () => {
      const engine = createMockEngine({ nodeCount: 0 });
      const ctx = retrieveGraphContext('完全不匹配的查询', engine);

      expect(ctx.bfsNodes).toHaveLength(0);
      expect(ctx.fallbackMode).toBe('rag-only');
    });

    it('BFS 恰好命中 3 个节点时 fallbackMode 应为 undefined', () => {
      const engine = createMockEngine({ nodeCount: 3 });
      const ctx = retrieveGraphContext('边界条件', engine);

      expect(ctx.bfsNodes).toHaveLength(3);
      expect(ctx.fallbackMode).toBeUndefined();
    });
  });

  describe('hyperedge 合并去重', () => {
    it('应将 label 匹配和 nodeId 匹配的 hyperedge 合并去重', () => {
      const sharedHyperedge = {
        id: 'he-1',
        label: '认证流程',
        nodes: ['node-0', 'node-1', 'node-2'],
        rationale: '跨模块认证协作',
        confidence: 'INFERRED' as const,
      };

      const engine = createMockEngine({
        nodeCount: 5,
        hyperedges: [sharedHyperedge],
      });

      const ctx = retrieveGraphContext('认证流程', engine);

      // 两种方式都返回同一个 hyperedge，去重后应只有 1 条
      expect(ctx.hyperedges).toHaveLength(1);
      expect(ctx.hyperedges[0]?.id).toBe('he-1');
    });

    it('不同 hyperedge 应全部保留（不过度去重）', () => {
      const he1 = {
        id: 'he-1',
        label: '登录流程',
        nodes: ['node-0', 'node-1', 'node-2'],
        rationale: '登录相关',
        confidence: 'INFERRED' as const,
      };
      const he2 = {
        id: 'he-2',
        label: '注销流程',
        nodes: ['node-0', 'node-2', 'node-3'],
        rationale: '注销相关',
        confidence: 'INFERRED' as const,
      };

      const engine = {
        query: vi.fn().mockReturnValue({
          nodes: Array.from({ length: 4 }, (_, i) => ({
            id: `node-${i}`,
            kind: 'module',
            label: `Module${i}`,
            metadata: {},
          })),
          edges: [],
          summary: '找到 4 个节点',
          truncated: false,
          totalMatches: 4,
        }),
        // label 匹配返回 he1，nodeId 匹配返回 he2
        getHyperedges: vi.fn()
          .mockReturnValueOnce([he1])    // label 查询
          .mockReturnValue([he2]),        // nodeId 查询（每个节点）
      } as unknown as GraphQueryEngine;

      const ctx = retrieveGraphContext('认证', engine);

      // he1 和 he2 都应出现
      const ids = ctx.hyperedges.map((h) => h.id);
      expect(ids).toContain('he-1');
      expect(ids).toContain('he-2');
    });
  });

  describe('topChunks 初始值', () => {
    it('topChunks 应初始为空数组（由 rag-reranker 填充）', () => {
      const engine = createMockEngine({ nodeCount: 5 });
      const ctx = retrieveGraphContext('测试', engine);

      expect(ctx.topChunks).toEqual([]);
    });
  });
});
