/**
 * llm-caller.test.ts
 * T-019 单元测试：budget-gate record-only + overBudget 标记 + 响应解析
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const Anthropic = vi.fn(() => ({
    messages: { create: mockCreate },
  }));
  (Anthropic as unknown as { _mockCreate: typeof mockCreate })._mockCreate = mockCreate;
  return { default: Anthropic };
});

vi.mock('../../../src/core/token-counter.js', () => ({
  estimateFast: vi.fn().mockReturnValue(100),
}));

vi.mock('../../../src/batch/budget-gate.js', () => ({
  runBudgetGate: vi.fn().mockResolvedValue({
    finalPolicy: 'continue',
    finalEstimate: 100,
    skipEnrichmentApplied: false,
    cheaperModelApplied: false,
    attempts: [],
  }),
}));

vi.mock('../../../src/core/model-selection.js', () => ({
  resolveReverseSpecModel: vi.fn().mockReturnValue({ model: 'claude-test-model' }),
}));

import Anthropic from '@anthropic-ai/sdk';
import { callQnALlm } from '../../../src/panoramic/qa/llm-caller.js';
import type { QnAPrompt } from '../../../src/panoramic/qa/prompt-builder.js';
import { runBudgetGate } from '../../../src/batch/budget-gate.js';
import { estimateFast } from '../../../src/core/token-counter.js';

// ============================================================
// 测试数据
// ============================================================

const testPrompt: QnAPrompt = {
  systemPrompt: '你是代码库问答助手',
  userPrompt: '什么调用了认证模块',
};

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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Anthropic).mockImplementation(
      () => ({ messages: { create: vi.fn().mockResolvedValue(normalJsonResponse) } }) as unknown as Anthropic,
    );
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
      vi.mocked(estimateFast).mockReturnValue(100);
      const result = await callQnALlm(testPrompt);

      expect(result.tokenUsage.overBudget).toBe(false);
    });
  });

  describe('overBudget 标记', () => {
    it('token 估算超过 hardcode 上限时 overBudget 应为 true', async () => {
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

      expect(result.answer).toBeTruthy();
      expect(result.tokenUsage.overBudget).toBe(true);
    });
  });

  describe('响应解析', () => {
    it('应从 JSON 响应中解析 parsedCitations', async () => {
      const result = await callQnALlm(testPrompt);

      expect(Array.isArray(result.parsedCitations)).toBe(true);
    });

    it('LLM 返回非 JSON 文本时应 fallback 到原始文本作为 answer', async () => {
      vi.mocked(Anthropic).mockImplementation(
        () => ({
          messages: {
            create: vi.fn().mockResolvedValue({
              ...normalJsonResponse,
              content: [{ type: 'text', text: '这是纯文本回答' }],
              usage: { input_tokens: 100, output_tokens: 50 },
            }),
          },
        }) as unknown as Anthropic,
      );

      const result = await callQnALlm(testPrompt);

      expect(typeof result.answer).toBe('string');
      expect(result.answer.length).toBeGreaterThan(0);
    });
  });
});
