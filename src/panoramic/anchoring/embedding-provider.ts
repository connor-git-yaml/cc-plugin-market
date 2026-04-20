/**
 * EmbeddingProvider 接口及相关类型定义
 * 采用 Strategy Pattern 隔离 Local/OpenAI embedding 实现
 * tokenUsage 格式与 BudgetGate（F1）保持一致
 */

// ============================================================
// TokenUsage 格式（与 BudgetGate F1 对齐）
// ============================================================

/**
 * Embedding 调用的 token 使用记录
 * - Local 模式：inputTokens 为字符数/4 粗估；outputTokens 固定为 0
 * - OpenAI 模式：inputTokens 来自 API 响应的实际计数
 */
export interface EmbeddingTokenUsage {
  /** 模型标识（'local-embedding' 或 'text-embedding-3-small'） */
  llmModel: string;
  /** 输入 token 数（Local 模式为粗估，OpenAI 模式为实际值） */
  inputTokens?: number;
  /** 输出 token 数（embedding 无输出，固定为 0） */
  outputTokens?: number;
  /** 推理耗时（毫秒，performance.now() 精确计时） */
  durationMs: number;
}

// ============================================================
// Embed 结果类型
// ============================================================

/**
 * EmbeddingProvider.embed() 的返回值
 * - vectors：各输入文本对应的 embedding 向量（Float32Array 节省内存）
 * - tokenUsage：本次调用的 token 使用记录
 */
export interface EmbedResult {
  /** 各输入文本对应的 embedding 向量，顺序与输入 texts 对应 */
  vectors: Float32Array[];
  /** 本次 embed 调用的 token 使用记录 */
  tokenUsage: EmbeddingTokenUsage;
}

// ============================================================
// EmbeddingProvider 接口（Strategy Pattern）
// ============================================================

/**
 * Embedding 提供方接口
 * 具体实现：LocalEmbeddingProvider（@huggingface/transformers）、OpenAIEmbeddingProvider
 * 通过 providers/factory.ts 的 createEmbeddingProvider() 按环境变量选择
 */
export interface EmbeddingProvider {
  /** 提供方名称（用于日志/诊断） */
  readonly providerName: 'local' | 'openai';
  /** LLM 模型标签（写入 tokenUsage.llmModel） */
  readonly llmModelLabel: string;
  /** 向量维度（Local: 384，OpenAI: 1536） */
  readonly dimensions: number;
  /**
   * 批量 embed 文本
   * @param texts 待 embed 的文本列表（非空数组）
   * @returns EmbedResult（vectors 与 texts 顺序对应）
   */
  embed(texts: string[]): Promise<EmbedResult>;
}
