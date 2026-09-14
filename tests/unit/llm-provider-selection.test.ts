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
    // Fix 134：spec-driver.config.yaml preset 从 quality-first 改为 balanced，
    // 默认 model 从 opus 升级到 sonnet（与 PRESET_MODEL_MAP.balanced 对齐）。
    // 本测试核心意图：Codex 环境走 API Key 时仍使用 Claude 模型而非 Codex 模型，
    // 具体模型名跟随当前默认配置即可。
    expect(request.model).toBe('claude-sonnet-4-6');
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
    expect(config.model).toBe('gpt-5.6-sol');
    expect(config.reasoningEffort).toBe('xhigh');
    expect(config.serviceTier).toBe('fast');
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
    expect(mocks.callLLMviaCli).not.toHaveBeenCalled();
  });

  it('Claude CLI 路径：系统提示走 config.systemPrompt，第一参数只有用户内容（M11 卡 E：与 SDK 路径对齐，不再整段拼接）', async () => {
    delete process.env['CODEX_THREAD_ID'];
    mocks.detectAuth.mockReturnValue({
      methods: [{ type: 'cli-proxy', provider: 'claude', available: true, details: '已登录' }],
      preferred: { type: 'cli-proxy', provider: 'claude', available: true, details: '已登录' },
      diagnostics: [],
    });
    mocks.callLLMviaCli.mockResolvedValue({ content: 'ok', model: 'claude-sonnet-4-6', inputTokens: 10, outputTokens: 5, duration: 100 });

    await callLLM({ prompt: 'USER-CONTENT-ONLY' } as any);

    expect(mocks.callLLMviaCli).toHaveBeenCalledTimes(1);
    const [userPrompt, config] = mocks.callLLMviaCli.mock.calls[0]!;
    expect(userPrompt).toBe('USER-CONTENT-ONLY');
    expect(typeof config.systemPrompt).toBe('string');
    expect(config.systemPrompt.length).toBeGreaterThan(100);
    expect(config.model).toBe('claude-sonnet-4-6');
  });

  it('M11 卡 E 回补（W-8）：context.systemPrompt 存在时两条路径都用它做系统提示（semantic-diff 不再拿到 spec-generation 的「必须输出 9 个章节」）', async () => {
    delete process.env['CODEX_THREAD_ID'];
    mocks.detectAuth.mockReturnValue({
      methods: [{ type: 'cli-proxy', provider: 'claude', available: true, details: '已登录' }],
      preferred: { type: 'cli-proxy', provider: 'claude', available: true, details: '已登录' },
      diagnostics: [],
    });
    mocks.callLLMviaCli.mockResolvedValue({ content: 'ok', model: 'claude-sonnet-4-6', inputTokens: 10, outputTokens: 5, duration: 100 });
    await callLLM({ prompt: 'USER', systemPrompt: 'CUSTOM-SYSTEM' } as any);
    expect(mocks.callLLMviaCli.mock.calls[0]![1].systemPrompt).toBe('CUSTOM-SYSTEM');

    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    mocks.detectAuth.mockReturnValue({
      methods: [{ type: 'api-key', provider: 'anthropic', available: true, details: '已设置' }],
      preferred: { type: 'api-key', provider: 'anthropic', available: true, details: '已设置' },
      diagnostics: [],
    });
    mocks.anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], model: 'claude-sonnet-4-6', usage: { input_tokens: 1, output_tokens: 1 } });
    await callLLM({ prompt: 'USER', systemPrompt: 'CUSTOM-SYSTEM' } as any);
    expect(mocks.anthropicCreate.mock.calls[0]![0].system).toBe('CUSTOM-SYSTEM');
  });
});
