/**
 * llm provider 选择测试
 * 验证当前运行时与最终认证提供方解耦后，模型名仍能映射到正确 provider。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectAuth: vi.fn(),
  anthropicCreate: vi.fn(),
  callLLMviaCli: vi.fn(),
  callLLMviaCodex: vi.fn(),
}));

vi.mock('../../src/auth/auth-detector.js', () => ({
  detectAuth: mocks.detectAuth,
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mocks.anthropicCreate,
    },
  })),
}));

vi.mock('../../src/auth/cli-proxy.js', () => ({
  callLLMviaCli: mocks.callLLMviaCli,
}));

vi.mock('../../src/auth/codex-proxy.js', () => ({
  callLLMviaCodex: mocks.callLLMviaCodex,
}));

import { callLLM } from '../../src/core/llm-client.js';

describe('llm provider selection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env['CODEX_THREAD_ID'] = 'thread-1';
    delete process.env['REVERSE_SPEC_MODEL'];
    vi.clearAllMocks();
  });

  it('Codex 环境下若最终走 API Key，仍使用 Claude 模型', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    mocks.detectAuth.mockReturnValue({
      methods: [{ type: 'api-key', provider: 'anthropic', available: true, details: '已设置' }],
      preferred: { type: 'api-key', provider: 'anthropic', available: true, details: '已设置' },
      diagnostics: [],
    });
    mocks.anthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-sonnet-4-5-20250929',
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    await callLLM({ prompt: 'test prompt' } as any);

    expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
    const request = mocks.anthropicCreate.mock.calls[0]![0];
    expect(request.model).toBe('claude-opus-4-1-20250805');
    expect(mocks.callLLMviaCodex).not.toHaveBeenCalled();
  });

  it('Codex 环境下若最终走 Codex CLI，使用 Codex 模型', async () => {
    mocks.detectAuth.mockReturnValue({
      methods: [{ type: 'cli-proxy', provider: 'codex', available: true, details: '已登录' }],
      preferred: { type: 'cli-proxy', provider: 'codex', available: true, details: '已登录' },
      diagnostics: [],
    });
    mocks.callLLMviaCodex.mockResolvedValue({
      content: 'ok',
      model: 'gpt-5.3-codex',
      inputTokens: 10,
      outputTokens: 5,
      duration: 100,
    });

    await callLLM({ prompt: 'test prompt' } as any);

    expect(mocks.callLLMviaCodex).toHaveBeenCalledTimes(1);
    const [, config] = mocks.callLLMviaCodex.mock.calls[0]!;
    expect(config.model).toBe('gpt-5.4');
    expect(config.reasoningEffort).toBe('xhigh');
    expect(config.serviceTier).toBe('fast');
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
    expect(mocks.callLLMviaCli).not.toHaveBeenCalled();
  });
});
