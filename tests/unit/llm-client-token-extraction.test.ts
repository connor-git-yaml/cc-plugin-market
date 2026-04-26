/**
 * llm-client SDK token 提取单元测试（Fix 134）
 *
 * 验证 callLLMviaSdk 通过 Anthropic SDK 调用时，inputTokens 累加 cache
 * 子字段（input_tokens + cache_creation_input_tokens + cache_read_input_tokens）。
 *
 * 根因：prompt caching 启用时主输入会进 cache_read_input_tokens，
 * input_tokens 主字段只剩"非 cached"增量；只读主字段会严重低估 input。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

// ============================================================
// Mock 依赖
// ============================================================

// Mock @anthropic-ai/sdk
const mockCreate: Mock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  const Anthropic = vi.fn(() => ({
    messages: { create: mockCreate },
  }));
  return { default: Anthropic };
});

// Mock auth-detector，强制走 api-key 分支
vi.mock('../../src/auth/auth-detector.js', () => ({
  detectAuth: vi.fn().mockReturnValue({
    preferred: { type: 'api-key', provider: 'claude' },
  }),
}));

// Mock model-selection（避免读真实 spec-driver.config.yaml）
vi.mock('../../src/core/model-selection.js', () => ({
  resolveReverseSpecModel: vi.fn().mockReturnValue({ model: 'claude-sonnet-4-6' }),
  resolveCodexExecutionConfig: vi.fn().mockReturnValue({ model: 'claude-sonnet-4-6' }),
}));

import { callLLM } from '../../src/core/llm-client.js';
import type { AssembledContext } from '../../src/core/context-assembler.js';

const TEST_PROMPT: AssembledContext = {
  prompt: 'irrelevant in mock',
  tokenCount: 50,
  truncated: false,
};

describe('llm-client - SDK 路径 token 提取（Fix 134）', () => {
  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'test-api-key';
    mockCreate.mockReset();
  });

  afterEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('累加 input_tokens + cache_creation_input_tokens + cache_read_input_tokens（prompt caching 真实场景）', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'reply' }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 300,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 1500,
      },
    });

    const response = await callLLM(TEST_PROMPT);

    // 100 + 200 + 1500 = 1800
    expect(response.inputTokens).toBe(1800);
    expect(response.outputTokens).toBe(300);
    expect(response.content).toBe('reply');
  });

  it('cache 子字段缺失时退化为 input_tokens 主字段（向后兼容旧响应）', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'r' }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 2000,
        output_tokens: 500,
      },
    });

    const response = await callLLM(TEST_PROMPT);

    // 2000 + 0 + 0 = 2000
    expect(response.inputTokens).toBe(2000);
    expect(response.outputTokens).toBe(500);
  });

  it('cache 子字段为 null 时退化为 0（与 Anthropic SDK 类型定义对齐）', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'r' }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 500,
        output_tokens: 100,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    });

    const response = await callLLM(TEST_PROMPT);

    // 500 + 0 (null→0) + 0 (null→0) = 500
    expect(response.inputTokens).toBe(500);
    expect(response.outputTokens).toBe(100);
  });

  it('仅有 cache_read_input_tokens 时仍累加（input_tokens=0 边界）', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'reply' }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 800,
      },
    });

    const response = await callLLM(TEST_PROMPT);

    // 0 + 0 + 800 = 800
    expect(response.inputTokens).toBe(800);
    expect(response.outputTokens).toBe(50);
  });
});
