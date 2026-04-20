/**
 * createEmbeddingProvider 工厂函数单元测试
 * 验证：默认 local / env=openai / env=local / env=invalid 抛错 四个分支
 *
 * 策略：
 * - 通过 vi.mock 完全 mock local-provider，避免真实加载 @huggingface/transformers
 * - 通过 vi.mock 完全 mock openai-provider，避免真实 HTTP 调用
 * - 每个测试独立设置/恢复环境变量，防止测试间污染
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock 依赖，避免真实加载触发下载或 HTTP 请求
vi.mock(
  '../../../../src/panoramic/anchoring/providers/local-provider.js',
  () => ({
    LocalEmbeddingProvider: vi.fn().mockImplementation(() => ({
      providerName: 'local' as const,
      llmModelLabel: 'local-embedding',
      dimensions: 384,
      embed: vi.fn(),
    })),
    LOAD_ERROR_MSG: '无法加载 @huggingface/transformers',
    _setTransformersImporter: vi.fn(),
    _resetPipelineForTest: vi.fn(),
  }),
);

vi.mock(
  '../../../../src/panoramic/anchoring/providers/openai-provider.js',
  () => ({
    OpenAIEmbeddingProvider: vi.fn().mockImplementation(() => ({
      providerName: 'openai' as const,
      llmModelLabel: 'text-embedding-3-small',
      dimensions: 1536,
      embed: vi.fn(),
    })),
    createOpenAIProvider: vi.fn().mockReturnValue({
      providerName: 'openai' as const,
      llmModelLabel: 'text-embedding-3-small',
      dimensions: 1536,
      embed: vi.fn(),
    }),
  }),
);

// 必须在 vi.mock 之后导入（Vitest 会 hoist vi.mock 调用）
import { createEmbeddingProvider } from '../../../../src/panoramic/anchoring/providers/factory.js';

// ============================================================
// 测试前保存并在测试后恢复环境变量
// ============================================================

const ENV_KEY = 'SPECTRA_EMBEDDING_PROVIDER';

function withEnv(value: string | undefined, fn: () => void): void {
  const original = process.env[ENV_KEY];
  if (value !== undefined) {
    process.env[ENV_KEY] = value;
  } else {
    delete process.env[ENV_KEY];
  }
  try {
    fn();
  } finally {
    if (original !== undefined) {
      process.env[ENV_KEY] = original;
    } else {
      delete process.env[ENV_KEY];
    }
  }
}

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// 测试用例
// ============================================================

describe('createEmbeddingProvider（factory）', () => {
  it('测试用例 1：SPECTRA_EMBEDDING_PROVIDER 未设置时，默认返回 local provider', () => {
    withEnv(undefined, () => {
      const provider = createEmbeddingProvider();
      expect(provider.providerName).toBe('local');
    });
  });

  it('测试用例 2：SPECTRA_EMBEDDING_PROVIDER=local 时，返回 local provider', () => {
    withEnv('local', () => {
      const provider = createEmbeddingProvider();
      expect(provider.providerName).toBe('local');
    });
  });

  it('测试用例 3：SPECTRA_EMBEDDING_PROVIDER=openai 时，返回 openai provider', () => {
    withEnv('openai', () => {
      // 不传 openaiApiKey，由 mock 处理（不实际验证 API key）
      const provider = createEmbeddingProvider();
      expect(provider.providerName).toBe('openai');
    });
  });

  it('测试用例 4：未知 provider 名称（如 "voyage"）时，抛出包含有效值提示的错误', () => {
    withEnv('voyage', () => {
      expect(() => createEmbeddingProvider()).toThrow('未知的 EmbeddingProvider');
      expect(() => createEmbeddingProvider()).toThrow('voyage');
      expect(() => createEmbeddingProvider()).toThrow('local | openai');
    });
  });

  it('providerName 大小写不敏感：OPENAI 应视为 openai', () => {
    withEnv('OPENAI', () => {
      const provider = createEmbeddingProvider();
      expect(provider.providerName).toBe('openai');
    });
  });

  it('options.providerName 优先于环境变量', () => {
    withEnv('openai', () => {
      // 显式指定 local，应覆盖环境变量中的 openai
      const provider = createEmbeddingProvider({ providerName: 'local' });
      expect(provider.providerName).toBe('local');
    });
  });
});
