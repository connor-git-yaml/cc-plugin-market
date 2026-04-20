/**
 * OpenAIEmbeddingProvider 单元测试
 * 验证：正常调用 / API key 缺失 / 网络错误 / 响应格式非 200 四个分支
 *
 * 策略：通过 vi.stubGlobal('fetch', ...) 替换全局 fetch，隔离真实 HTTP 调用
 * 每个测试后通过 vi.unstubAllGlobals() 恢复，保证测试隔离
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  OpenAIEmbeddingProvider,
  createOpenAIProvider,
} from '../../../../src/panoramic/anchoring/providers/openai-provider.js';

// ============================================================
// 每个测试后清除 stub
// ============================================================

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================
// Mock 响应构建工具
// ============================================================

/**
 * 构造一个模拟正常成功的 fetch Response
 */
function makeMockResponse(
  payload: unknown,
  options: { ok?: boolean; status?: number } = {},
): Response {
  const ok = options.ok ?? true;
  const status = options.status ?? 200;
  return {
    ok,
    status,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as unknown as Response;
}

/**
 * 构造包含单个 embedding 的标准 OpenAI API 响应
 */
function makeEmbeddingPayload(embedding: number[], promptTokens = 10) {
  return {
    data: [{ embedding, index: 0 }],
    usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
  };
}

// ============================================================
// 测试用例
// ============================================================

describe('OpenAIEmbeddingProvider', () => {
  it('测试用例 1：正常调用返回正确 EmbedResult（vectors 为 Float32Array，usage 字段正确）', async () => {
    const mockEmbedding = [0.1, 0.2, 0.3];
    const mockPayload = makeEmbeddingPayload(mockEmbedding, 42);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeMockResponse(mockPayload)));

    const provider = new OpenAIEmbeddingProvider('test-api-key');
    const result = await provider.embed(['hello world']);

    // 验证向量结构（Float32Array 存在精度损失，使用近似比较）
    expect(result.vectors).toHaveLength(1);
    expect(result.vectors[0]).toBeInstanceOf(Float32Array);
    expect(result.vectors[0]).toHaveLength(3);
    // 验证前几个值接近原始 float64 值（Float32Array 精度约 7 位有效数字）
    expect(result.vectors[0][0]).toBeCloseTo(0.1, 5);
    expect(result.vectors[0][1]).toBeCloseTo(0.2, 5);
    expect(result.vectors[0][2]).toBeCloseTo(0.3, 5);

    // 验证 tokenUsage
    expect(result.tokenUsage.llmModel).toBe('text-embedding-3-small');
    expect(result.tokenUsage.outputTokens).toBe(0);
    expect(typeof result.tokenUsage.durationMs).toBe('number');
    expect(result.tokenUsage.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('测试用例 2：tokenUsage.inputTokens 等于 API 响应中的 usage.prompt_tokens', async () => {
    const promptTokens = 77;
    const mockPayload = makeEmbeddingPayload([0.5, 0.6], promptTokens);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeMockResponse(mockPayload)));

    const provider = new OpenAIEmbeddingProvider('test-api-key');
    const result = await provider.embed(['some text input']);

    // inputTokens 必须来自 API 响应的真实计数，而非字符数粗估
    expect(result.tokenUsage.inputTokens).toBe(promptTokens);
  });

  it('测试用例 3：OPENAI_API_KEY 未设置时，构造 OpenAIEmbeddingProvider 抛出包含提示信息的错误', () => {
    // 直接用空字符串构造，模拟 API key 缺失场景
    expect(() => new OpenAIEmbeddingProvider('')).toThrow('OPENAI_API_KEY 未设置');
    expect(() => new OpenAIEmbeddingProvider('')).toThrow('SPECTRA_EMBEDDING_PROVIDER=local');
  });

  it('测试用例 4：API 请求返回非 200（HTTP 401）时，embed() 抛出包含状态码的错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('unauthorized'),
      }),
    );

    const provider = new OpenAIEmbeddingProvider('invalid-key');
    await expect(provider.embed(['test'])).rejects.toThrow('HTTP 401');
  });

  it('测试用例 5：网络错误时，embed() 向上传播异常（不静默吞掉）', async () => {
    const networkError = new Error('Network connection refused');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));

    const provider = new OpenAIEmbeddingProvider('test-api-key');
    await expect(provider.embed(['test'])).rejects.toThrow('Network connection refused');
  });

  it('多个文本输入时，vectors 按 index 排序对齐输入顺序', async () => {
    // 故意打乱返回顺序，验证实现会按 index 排序
    const mockPayload = {
      data: [
        { embedding: [0.9, 0.8], index: 1 }, // 第二个输入
        { embedding: [0.1, 0.2], index: 0 }, // 第一个输入
      ],
      usage: { prompt_tokens: 15, total_tokens: 15 },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeMockResponse(mockPayload)));

    const provider = new OpenAIEmbeddingProvider('test-api-key');
    const result = await provider.embed(['first text', 'second text']);

    expect(result.vectors).toHaveLength(2);
    // index=0 的向量应排在第一位（Float32Array 精度损失，使用近似比较）
    expect(result.vectors[0][0]).toBeCloseTo(0.1, 5);
    expect(result.vectors[0][1]).toBeCloseTo(0.2, 5);
    // index=1 的向量应排在第二位
    expect(result.vectors[1][0]).toBeCloseTo(0.9, 5);
    expect(result.vectors[1][1]).toBeCloseTo(0.8, 5);
  });

  it('providerName、llmModelLabel、dimensions 符合规范', () => {
    const provider = new OpenAIEmbeddingProvider('test-api-key');
    expect(provider.providerName).toBe('openai');
    expect(provider.llmModelLabel).toBe('text-embedding-3-small');
    expect(provider.dimensions).toBe(1536);
  });

  it('createOpenAIProvider：从 OPENAI_API_KEY 环境变量读取 key', () => {
    const originalKey = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_API_KEY = 'env-api-key';
      const provider = createOpenAIProvider();
      // 构造成功说明 key 已正确读取
      expect(provider.providerName).toBe('openai');
    } finally {
      // 恢复原始环境变量
      if (originalKey !== undefined) {
        process.env.OPENAI_API_KEY = originalKey;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
    }
  });
});
