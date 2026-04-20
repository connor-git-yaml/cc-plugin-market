/**
 * OpenAIEmbeddingProvider — text-embedding-3-small via fetch 实现
 * 不依赖任何 openai SDK，直接调用 https://api.openai.com/v1/embeddings
 * tokenUsage 记录：
 *   - llmModel: 'text-embedding-3-small'
 *   - inputTokens: API 返回的 usage.prompt_tokens（真实计数）
 *   - outputTokens: 0（embedding 无输出）
 *   - durationMs: 从请求发出到响应解析完成的耗时
 *
 * API key 缺失时构造器即抛清晰错误（FR-010）
 */
import type { EmbeddingProvider, EmbedResult, EmbeddingTokenUsage } from '../embedding-provider.js';

// ============================================================
// OpenAI API 响应类型（精简，仅包含所需字段）
// ============================================================

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// ============================================================
// OpenAIEmbeddingProvider
// ============================================================

/**
 * 基于 OpenAI text-embedding-3-small 的 embedding 提供方
 * 向量维度 1536，直接通过 fetch 调用 OpenAI Embeddings API
 *
 * 特性：
 * - API key 缺失时在构造阶段立即抛出清晰错误（FR-010）
 * - tokenUsage 使用 API 返回的真实 prompt_tokens（非粗估）
 * - 按 index 排序保证输出向量顺序与输入 texts 对应
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'openai' as const;
  readonly llmModelLabel = 'text-embedding-3-small';
  readonly dimensions = 1536;

  private static readonly MODEL = 'text-embedding-3-small';
  private static readonly ENDPOINT = 'https://api.openai.com/v1/embeddings';

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY 未设置。请通过环境变量提供，或设置 SPECTRA_EMBEDDING_PROVIDER=local',
      );
    }
  }

  /**
   * 批量 embed 文本，调用 OpenAI Embeddings API
   * @param texts 待 embed 的文本列表（非空数组）
   * @throws Error 当 API 请求失败（HTTP 非 200）或网络异常时
   */
  async embed(texts: string[]): Promise<EmbedResult> {
    // 与 LocalEmbeddingProvider 统一使用 performance.now()（亚毫秒精度）
    const startedAt = performance.now();

    const response = await fetch(OpenAIEmbeddingProvider.ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: OpenAIEmbeddingProvider.MODEL,
        input: texts,
        encoding_format: 'float',
      }),
    });

    if (!response.ok) {
      // 读取响应体以提供更详细的错误信息（读取失败时降级为占位符）
      const errorBody = await response.text().catch(() => '<no body>');
      throw new Error(`OpenAI embeddings 调用失败（HTTP ${response.status}）：${errorBody}`);
    }

    const payload = (await response.json()) as OpenAIEmbeddingResponse;

    // 按 index 排序，确保输出向量顺序与输入 texts 严格对应
    const vectors = payload.data
      .sort((a, b) => a.index - b.index)
      .map((item) => Float32Array.from(item.embedding));

    const tokenUsage: EmbeddingTokenUsage = {
      llmModel: OpenAIEmbeddingProvider.MODEL,
      // 使用 API 返回的真实 token 计数，而非字符数粗估
      inputTokens: payload.usage.prompt_tokens,
      outputTokens: 0,
      durationMs: performance.now() - startedAt,
    };

    return { vectors, tokenUsage };
  }
}

// ============================================================
// 工厂入口（供 factory.ts 使用）
// ============================================================

/**
 * 创建 OpenAIEmbeddingProvider 实例
 * 优先使用 options.apiKey，其次从 OPENAI_API_KEY 环境变量读取
 * @throws Error 当 API key 不可用时
 */
export function createOpenAIProvider(options: { apiKey?: string } = {}): OpenAIEmbeddingProvider {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  return new OpenAIEmbeddingProvider(apiKey);
}
