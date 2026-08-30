/**
 * prompt-builder.test.ts
 * T-018 单元测试：prompt 组装 + citation 内联格式 + hyperedge 候选列表
 */
import { describe, it, expect } from 'vitest';
import { buildQnAPrompt } from '../../../src/panoramic/qa/prompt-builder.js';
import type { GraphContext, Citation } from '../../../src/panoramic/qa/types.js';

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
  it('应返回 systemPrompt 和 userPrompt 字段，且均为非空字符串并包含真实内容', () => {
    // F272 ⑦-B7：原用例仅 `toBeTruthy()` 两处，虽能拒绝空串/undefined，但未验证
    // 「字段」本身的具体结构（是否为 string 类型、是否携带调用方传入的问题文本）。
    // 与下方已有 toContain 断言合并，改为同时验证类型 + 结构性内容（userPrompt 应
    // 包含调用时传入的原始问题）。
    const ctx = makeGraphCtx();
    const question = '什么调用了认证模块';
    const result = buildQnAPrompt(ctx, makeCitations(), question);

    expect(typeof result.systemPrompt).toBe('string');
    expect(typeof result.userPrompt).toBe('string');
    expect(result.systemPrompt.length).toBeGreaterThan(0);
    expect(result.userPrompt).toContain(question);
  });

  it('systemPrompt 应包含 citation 格式要求', () => {
    const result = buildQnAPrompt(makeGraphCtx(), [], '测试问题');
    expect(result.systemPrompt).toContain('[来源：');
    expect(result.systemPrompt).toContain('100%');
  });

  it('systemPrompt 应要求返回 JSON 格式', () => {
    const result = buildQnAPrompt(makeGraphCtx(), [], '测试问题');
    expect(result.systemPrompt).toContain('JSON');
    expect(result.systemPrompt).toContain('"answer"');
    expect(result.systemPrompt).toContain('"citations"');
  });

  it('userPrompt 应包含原始问题文本', () => {
    const question = '什么调用了认证模块的 login 函数';
    const result = buildQnAPrompt(makeGraphCtx(), [], question);
    expect(result.userPrompt).toContain(question);
  });

  it('userPrompt 应包含所有 citation 的内联格式', () => {
    const result = buildQnAPrompt(makeGraphCtx(), makeCitations(), '测试');
    expect(result.userPrompt).toContain('specs/auth/login.md:10-20');
    expect(result.userPrompt).toContain('graph-hyperedge');
  });

  it('citation excerpt 应出现在 prompt 中', () => {
    const result = buildQnAPrompt(makeGraphCtx(), makeCitations(), '测试');
    expect(result.userPrompt).toContain('登录验证流程说明');
  });

  it('userPrompt 应包含超边候选列表区块', () => {
    const result = buildQnAPrompt(makeGraphCtx(), [], '测试');
    expect(result.userPrompt).toContain('超边候选列表');
  });

  it('userPrompt 应包含 hyperedge 的 label', () => {
    const result = buildQnAPrompt(makeGraphCtx(), [], '测试');
    expect(result.userPrompt).toContain('登录流程');
  });

  it('hyperedge rationale 应出现在候选列表中', () => {
    const result = buildQnAPrompt(makeGraphCtx(), [], '测试');
    expect(result.userPrompt).toContain('用户登录时依次调用认证');
  });

  it('空超边时应有占位说明', () => {
    const ctx = makeGraphCtx({ hyperedges: [] });
    const result = buildQnAPrompt(ctx, [], '测试');
    expect(result.userPrompt).toContain('无超边数据');
  });

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

  it('userPrompt 应包含 BFS 节点信息', () => {
    const result = buildQnAPrompt(makeGraphCtx(), [], '测试');
    expect(result.userPrompt).toContain('认证模块');
    expect(result.userPrompt).toContain('数据库层');
  });

  it('空 BFS 节点时应有占位说明', () => {
    const ctx = makeGraphCtx({ bfsNodes: [] });
    const result = buildQnAPrompt(ctx, [], '测试');
    expect(result.userPrompt).toContain('无相关节点');
  });
});
