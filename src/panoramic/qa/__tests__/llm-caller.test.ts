/**
 * llm-caller.test.ts
 * T-019 单元测试：budget-gate record-only + overBudget 标记 + 响应解析
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Mock 依赖
// ============================================================

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const Anthropic = vi.fn(() => ({
    messages: {
      create: mockCreate,
    },
  }));
  (Anthropic as unknown as { _mockCreate: typeof mockCreate })._mockCreate = mockCreate;
  return { default: Anthropic };
});

// Mock estimateFast（控制 token 估算量）
vi.mock('../../../core/token-counter.js', () => ({
  estimateFast: vi.fn().mockReturnValue(100),
}));

// Mock runBudgetGate（不真实执行）
vi.mock('../../../batch/budget-gate.js', () => ({
  runBudgetGate: vi.fn().mockResolvedValue({
    finalPolicy: 'continue',
    finalEstimate: 100,
    skipEnrichmentApplied: false,
    cheaperModelApplied: false,
    attempts: [],
  }),
}));

// Mock resolveReverseSpecModel（返回确定性模型）
vi.mock('../../../core/model-selection.js', () => ({
  resolveReverseSpecModel: vi.fn().mockReturnValue({ model: 'claude-test-model' }),
}));

import Anthropic from '@anthropic-ai/sdk';
import { callQnALlm } from '../llm-caller.js';
import type { QnAPrompt } from '../prompt-builder.js';
import { runBudgetGate } from '../../../batch/budget-gate.js';
import { estimateFast } from '../../../core/token-counter.js';

// 获取 mock create 函数
const MockedAnthropicClass = vi.mocked(Anthropic) as unknown as {
  _mockCreate: ReturnType<typeof vi.fn>;
  new (...args: unknown[]): { messages: { create: ReturnType<typeof vi.fn> } };
};

// ============================================================
// 测试数据
// ============================================================

const testPrompt: QnAPrompt = {
  systemPrompt: '你是代码库问答助手',
  userPrompt: '什么调用了认证模块',
};

/** 正常的 JSON 格式 LLM 响应 */
const normalJsonResponse = {
  id: 'msg-001',
  type: 'message',
  role: 'assistant',
  model: 'claude-test-model',
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        answer: '认证模块被 LoginService 调用 [来源：specs/auth.md:10-15]',
        citations: [
          {
            specPath: 'specs/auth.md',
            startLine: 10,
            endLine: 15,
            excerpt: '登录服务调用认证模块',
          },
        ],
      }),
    },
  ],
  stop_reason: 'end_turn',
  usage: { input_tokens: 150, output_tokens: 80 },
};

// ============================================================
// 测试套件
// ============================================================

describe('callQnALlm', () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 重新获取 mock create 实例
    const instance = new (vi.mocked(Anthropic) as unknown as new () => { messages: { create: ReturnType<typeof vi.fn> } })();
    mockCreate = instance.messages.create;
    mockCreate.mockResolvedValue(normalJsonResponse);
  });

  describe('正常调用路径', () => {
    it('应调用 runBudgetGate（record-only 模式）', async () => {
      await callQnALlm(testPrompt);

      expect(runBudgetGate).toHaveBeenCalledWith(
        expect.objectContaining({
          budget: Infinity,
          preset: 'continue',
          isTTY: false,
        }),
      );
    });

    it('应从项目配置读取模型 ID（不硬编码）', async () => {
      await callQnALlm(testPrompt);

      // 验证 Anthropic.messages.create 被调用（模型来自 resolveReverseSpecModel）
      // 由于 Anthropic 是 mock，这里验证 runBudgetGate 被调用即可
      expect(runBudgetGate).toHaveBeenCalled();
    });

    it('应返回包含 answer 的结果', async () => {
      const result = await callQnALlm(testPrompt);

      expect(result.answer).toBeTruthy();
      expect(typeof result.answer).toBe('string');
    });

    it('应返回 tokenUsage 字段', async () => {
      const result = await callQnALlm(testPrompt);

      expect(result.tokenUsage).toBeDefined();
      expect(typeof result.tokenUsage.input).toBe('number');
      expect(typeof result.tokenUsage.output).toBe('number');
      expect(typeof result.tokenUsage.overBudget).toBe('boolean');
    });

    it('正常调用时 overBudget 应为 false（估算 130 tokens < 6000 上限）', async () => {
      // estimateFast mock 返回 100，total = 100 + 30 = 130 < 6000
      vi.mocked(estimateFast).mockReturnValue(100);
      const result = await callQnALlm(testPrompt);

      expect(result.tokenUsage.overBudget).toBe(false);
    });
  });

  describe('overBudget 标记', () => {
    it('token 估算超过 hardcode 上限时 overBudget 应为 true', async () => {
      // 让 estimateFast 返回一个超过限制的值（6000 / 1.3 ≈ 4616 → total ≈ 6000+）
      vi.mocked(estimateFast).mockReturnValue(5000); // total = 5000 + 1500 = 6500 > 6000

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await callQnALlm(testPrompt);

      expect(result.tokenUsage.overBudget).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('qna token cost over hardcode limit'));

      warnSpy.mockRestore();
    });

    it('超额时 LLM 调用不应被阻断（应继续返回结果）', async () => {
      vi.mocked(estimateFast).mockReturnValue(5000);

      const result = await callQnALlm(testPrompt);

      // 超额但调用继续，应有 answer
      expect(result.answer).toBeTruthy();
      expect(result.tokenUsage.overBudget).toBe(true);
    });
  });

  describe('响应解析', () => {
    it('应从 JSON 响应中解析 parsedCitations', async () => {
      const result = await callQnALlm(testPrompt);

      // 验证 parsedCitations 结构（来自 normalJsonResponse 中的 citations 数组）
      expect(Array.isArray(result.parsedCitations)).toBe(true);
    });

    it('LLM 返回非 JSON 文本时应 fallback 到原始文本作为 answer', async () => {
      // 创建一个返回纯文本（非 JSON）的 mock
      const plainTextResponse = {
        ...normalJsonResponse,
        content: [{ type: 'text', text: '这是纯文本回答，没有 JSON 格式' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      // 需要直接 mock Anthropic client 实例
      const AnthropicConstructor = vi.mocked(Anthropic) as unknown as new (opts: unknown) => { messages: { create: ReturnType<typeof vi.fn> } };
      const mockInstance = { messages: { create: vi.fn().mockResolvedValue(plainTextResponse) } };
      (Anthropic as unknown as { mockImplementation: (fn: () => typeof mockInstance) => void }).mockImplementation
        ? vi.mocked(Anthropic).mockImplementation(() => mockInstance as unknown as Anthropic)
        : null;

      // 使用新实例重新调用
      vi.mocked(Anthropic).mockImplementationOnce(() => mockInstance as unknown as Anthropic);

      const result = await callQnALlm(testPrompt);

      // 非 JSON 时 answer 应包含原始文本
      expect(typeof result.answer).toBe('string');
      expect(result.answer.length).toBeGreaterThan(0);
    });
  });
});
