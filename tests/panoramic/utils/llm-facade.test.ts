/**
 * llm-facade 单元测试
 *
 * 覆盖 Codex implement 审查修复轮 W1：panoramic llm-facade 的 codex 分支不得再
 * 无条件退化为固定字面量模型——`PANORAMIC_LLM_MODEL` 或调用方显式指定时照常传
 * model（required）；默认态（无任何显式来源）不得向 proxy 传 model，交还
 * `getDefaultCodexCLIProxyConfig()` 自身的 delegate 判定（与 llm-client.ts 的
 * C1 同一模式）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock 依赖模块（vi.mock 会被 vitest 提升到文件顶部）
vi.mock('../../../src/auth/auth-detector.js');
vi.mock('../../../src/auth/cli-proxy.js');
vi.mock('../../../src/auth/codex-proxy.js');

import { detectAuth } from '../../../src/auth/auth-detector.js';
import type { AuthDetectionResult } from '../../../src/auth/auth-detector.js';
import { callLLMviaCodex } from '../../../src/auth/codex-proxy.js';
import { callLLM } from '../../../src/panoramic/utils/llm-facade.js';

const mockDetectAuth = vi.mocked(detectAuth);
const mockCallLLMviaCodex = vi.mocked(callLLMviaCodex);

const CODEX_AUTH_RESULT: AuthDetectionResult = {
  methods: [],
  preferred: { type: 'cli-proxy', provider: 'codex', available: true, details: '' },
  diagnostics: [],
};

describe('llm-facade — codex 分支 model 传递（Codex implement 审查修复轮 W1）', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['PANORAMIC_LLM_MODEL'];
    delete process.env['REVERSE_SPEC_MODEL'];
    vi.clearAllMocks();
    mockDetectAuth.mockReturnValue(CODEX_AUTH_RESULT);
    mockCallLLMviaCodex.mockResolvedValue({
      content: 'ok',
      model: 'gpt-5.4',
      inputTokens: 1,
      outputTokens: 1,
      duration: 1,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('PANORAMIC_LLM_MODEL 显式设置 → 传给 codexProxyCall 的 config 含该 model 字面量', async () => {
    process.env['PANORAMIC_LLM_MODEL'] = 'gpt-5.6-sol';

    await callLLM('测试 prompt');

    expect(mockCallLLMviaCodex).toHaveBeenCalledTimes(1);
    const [, config] = mockCallLLMviaCodex.mock.calls[0]!;
    expect(config).toMatchObject({ model: 'gpt-5.6-sol' });
  });

  it('无任何显式来源（未设置 PANORAMIC_LLM_MODEL、无 spec-driver.config.yaml 覆盖）→ codexProxyCall 的 config 不含 model 字段（交还 proxy 自身 delegate 判定）', async () => {
    const tempCwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-for-llm-facade-test');

    try {
      await callLLM('测试 prompt');

      expect(mockCallLLMviaCodex).toHaveBeenCalledTimes(1);
      const [, config] = mockCallLLMviaCodex.mock.calls[0]!;
      expect(config).not.toHaveProperty('model');
    } finally {
      tempCwdSpy.mockRestore();
    }
  });
});
