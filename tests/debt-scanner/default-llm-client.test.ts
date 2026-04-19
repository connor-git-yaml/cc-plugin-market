/**
 * 回归测试（Codex review Finding 1）：
 * tryCreateDefaultLLMClient 在 ANTHROPIC_API_KEY 存在时自动构造默认 client，
 * 确保 CLI 批量路径不必显式 wire 也能启用 LLM 主题推断。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { tryCreateDefaultLLMClient } from '../../src/debt-scanner/llm-clients.js';

const ENV_KEY = 'ANTHROPIC_API_KEY';

describe('tryCreateDefaultLLMClient', () => {
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  it('ANTHROPIC_API_KEY 未设置时返回 undefined', () => {
    delete process.env[ENV_KEY];
    expect(tryCreateDefaultLLMClient()).toBeUndefined();
  });

  it('ANTHROPIC_API_KEY 存在时返回 SimpleLLMClient 实例', () => {
    process.env[ENV_KEY] = 'sk-test-not-real';
    const client = tryCreateDefaultLLMClient();
    expect(client).toBeDefined();
    expect(client?.model).toBeTypeOf('string');
    expect(typeof client?.complete).toBe('function');
    expect(typeof client?.estimateTokens).toBe('function');
  });
});
