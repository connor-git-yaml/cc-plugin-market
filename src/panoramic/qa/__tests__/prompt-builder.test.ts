/**
 * prompt-builder.test.ts
 * T-018 单元测试：prompt 组装 + citation 内联格式 + hyperedge 候选列表
 */
import { describe, it, expect } from 'vitest';
import { buildQnAPrompt } from '../prompt-builder.js';
import type { GraphContext, Citation } from '../types.js';

// ============================================================
// 测试数据工厂
// ============================================================

function makeGraphCtx(overrides?: Partial<GraphContext>): GraphContext {
  return {
    bfsNodes: [
      { id: 'node-auth', label: '认证模块', kind: 'module' },
      { id: 'node-db', label: '数据库层', kind: 'module' },
    ],
    topChunks: [],
    hyperedges: [
      {
        id: 'he-1',
        label: '登录流程',
        nodes: ['node-auth', 'node-db', 'node-session'],
        rationale: '用户登录时依次调用认证、数据库和会话管理',
        confidence: 'INFERRED',
      },
    ],
    ...overrides,
  };
}

function makeCitations(): Citation[] {
  return [
    {
      specPath: 'specs/auth/login.md',
      lineRange: { startLine: 10, endLine: 20 },
      excerpt: '登录验证流程说明',
      nodeId: 'node-auth',
      similarity: 0.85,
    },
    {
      specPath: '[graph hyperedge]',
      lineRange: { startLine: 0, endLine: 0 },
      excerpt: '登录流程跨模块协作',
    },
  ];
}

// ============================================================
// 测试套件
// ============================================================

describe('buildQnAPrompt', () => {
  describe('基础结构检查', () => {
    it('应返回 systemPrompt 和 userPrompt 字段', () => {
      const ctx = makeGraphCtx();
      const citations = makeCitations();
      const result = buildQnAPrompt(ctx, citations, '什么调用了认证模块');

      expect(result.systemPrompt).toBeTruthy();
      expect(result.userPrompt).toBeTruthy();
      expect(typeof result.systemPrompt).toBe('string');
      expect(typeof result.userPrompt).toBe('string');
    });

    it('systemPrompt 应包含 citation 格式要求', () => {
      const ctx = makeGraphCtx();
      const result = buildQnAPrompt(ctx, [], '测试问题');

      expect(result.systemPrompt).toContain('[来源：');
      expect(result.systemPrompt).toContain('100%');
    });

    it('systemPrompt 应要求返回 JSON 格式', () => {
      const ctx = makeGraphCtx();
      const result = buildQnAPrompt(ctx, [], '测试问题');

      expect(result.systemPrompt).toContain('JSON');
      expect(result.systemPrompt).toContain('"answer"');
      expect(result.systemPrompt).toContain('"citations"');
    });
  });

  describe('用户问题注入', () => {
    it('userPrompt 应包含原始问题文本', () => {
      const ctx = makeGraphCtx();
      const question = '什么调用了认证模块的 login 函数';
      const result = buildQnAPrompt(ctx, [], question);

      expect(result.userPrompt).toContain(question);
    });
  });

  describe('Citation 内联格式', () => {
    it('userPrompt 应包含所有 citation 的内联格式', () => {
      const ctx = makeGraphCtx();
      const citations = makeCitations();
      const result = buildQnAPrompt(ctx, citations, '测试');

      // 应包含 specs/auth/login.md 的引用
      expect(result.userPrompt).toContain('specs/auth/login.md:10-20');
      // 应包含 graph-hyperedge 引用
      expect(result.userPrompt).toContain('graph-hyperedge');
    });

    it('citation excerpt 应出现在 prompt 中', () => {
      const ctx = makeGraphCtx();
      const citations = makeCitations();
      const result = buildQnAPrompt(ctx, citations, '测试');

      expect(result.userPrompt).toContain('登录验证流程说明');
    });
  });

  describe('Hyperedge 候选列表', () => {
    it('userPrompt 应包含超边候选列表区块', () => {
      const ctx = makeGraphCtx();
      const result = buildQnAPrompt(ctx, [], '测试');

      // 应有超边候选列表相关标题
      expect(result.userPrompt).toContain('超边候选列表');
    });

    it('userPrompt 应包含 hyperedge 的 label', () => {
      const ctx = makeGraphCtx();
      const result = buildQnAPrompt(ctx, [], '测试');

      // hyperedge label "登录流程" 应出现在 prompt 中
      expect(result.userPrompt).toContain('登录流程');
    });

    it('hyperedge rationale 应出现在候选列表中', () => {
      const ctx = makeGraphCtx();
      const result = buildQnAPrompt(ctx, [], '测试');

      expect(result.userPrompt).toContain('用户登录时依次调用认证');
    });

    it('空超边时应有占位说明', () => {
      const ctx = makeGraphCtx({ hyperedges: [] });
      const result = buildQnAPrompt(ctx, [], '测试');

      expect(result.userPrompt).toContain('无超边数据');
    });
  });

  describe('fallback 模式提示', () => {
    it('fallbackMode=rag-only 时 userPrompt 应包含降级提示', () => {
      const ctx = makeGraphCtx({ fallbackMode: 'rag-only' });
      const result = buildQnAPrompt(ctx, [], '测试');

      expect(result.userPrompt).toContain('rag-only');
      expect(result.userPrompt).toContain('降级模式');
    });

    it('无 fallbackMode 时不应包含降级提示', () => {
      const ctx = makeGraphCtx({ fallbackMode: undefined });
      const result = buildQnAPrompt(ctx, [], '测试');

      expect(result.userPrompt).not.toContain('降级模式');
    });
  });

  describe('BFS 节点摘要', () => {
    it('userPrompt 应包含 BFS 节点信息', () => {
      const ctx = makeGraphCtx();
      const result = buildQnAPrompt(ctx, [], '测试');

      // 节点 label 应出现在 userPrompt 中
      expect(result.userPrompt).toContain('认证模块');
      expect(result.userPrompt).toContain('数据库层');
    });

    it('空 BFS 节点时应有占位说明', () => {
      const ctx = makeGraphCtx({ bfsNodes: [] });
      const result = buildQnAPrompt(ctx, [], '测试');

      expect(result.userPrompt).toContain('无相关节点');
    });
  });
});
