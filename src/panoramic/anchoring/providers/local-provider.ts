/**
 * LocalEmbeddingProvider — @huggingface/transformers 实现
 * 使用 all-MiniLM-L6-v2 模型，动态导入避免包缺失时同步 crash
 * tokenUsage 记录：llmModel='local-embedding'，inputTokens=字符数/4，outputTokens=0，durationMs=精确计时
 *
 * 设计：将动态 import 抽取为可替换的 _importTransformers 函数，便于测试注入
 */
import type { EmbeddingProvider, EmbedResult, EmbeddingTokenUsage } from '../embedding-provider.js';

// ============================================================
// 加载失败错误信息
// ============================================================

export const LOAD_ERROR_MSG =
  '无法加载 @huggingface/transformers，请执行 npm install @huggingface/transformers 或切换 SPECTRA_EMBEDDING_PROVIDER=openai';

// ============================================================
// Singleton Pipeline 缓存
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedPipeline: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelineLoading: Promise<any> | null = null;

// ============================================================
// 可替换的 import 函数（便于测试注入）
// ============================================================

/**
 * 默认的动态 import 函数
 * 测试中可通过 setTransformersImporter 替换为 mock
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TransformersImporter = () => Promise<any>;

let _transformersImporter: TransformersImporter = async () => {
  try {
    // @ts-ignore — @huggingface/transformers 为 optionalDependencies，类型声明不保证存在
    return await import('@huggingface/transformers');
  } catch {
    throw new Error(LOAD_ERROR_MSG);
  }
};

/**
 * 设置自定义的 transformers 加载函数（仅供测试使用）
 */
export function _setTransformersImporter(importer: TransformersImporter): void {
  _transformersImporter = importer;
}

/**
 * 重置 singleton 状态（仅供测试使用）
 */
export function _resetPipelineForTest(): void {
  cachedPipeline = null;
  pipelineLoading = null;
  // 重置为默认加载函数
  _transformersImporter = async () => {
    try {
      // @ts-ignore — @huggingface/transformers 为 optionalDependencies
      return await import('@huggingface/transformers');
    } catch {
      throw new Error(LOAD_ERROR_MSG);
    }
  };
}

// ============================================================
// LocalEmbeddingProvider
// ============================================================

/**
 * 基于 @huggingface/transformers 的本地 embedding 提供方
 * 使用 all-MiniLM-L6-v2 模型，向量维度 384
 *
 * 特性：
 * - lazy load pipeline：首次调用时加载，后续复用 singleton
 * - 依赖缺失时抛出含安装指引的清晰错误（FR-011）
 * - tokenUsage 记录与 BudgetGate F1 格式对齐（FR-016）
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'local' as const;
  readonly llmModelLabel = 'local-embedding';
  readonly dimensions = 384;

  /**
   * 批量 embed 文本
   * @throws Error 当 @huggingface/transformers 不可用时
   */
  async embed(texts: string[]): Promise<EmbedResult> {
    const startMs = performance.now();

    // 动态加载 @huggingface/transformers（lazy，首次调用时）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipe: (text: string, opts: Record<string, unknown>) => Promise<any> =
      await this.loadPipeline();

    // 计算粗估 inputTokens：字符总数 / 4
    const inputTokens = Math.ceil(
      texts.reduce((sum, t) => sum + t.length, 0) / 4,
    );

    // 批量推理
    const vectors: Float32Array[] = [];
    for (const text of texts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output: any = await pipe(text, { pooling: 'mean', normalize: true });
      // 兼容不同版本的 output 格式（.data 或 .ort_tensor.cpuData 或直接 Float32Array）
      vectors.push(extractVector(output));
    }

    const durationMs = performance.now() - startMs;

    const tokenUsage: EmbeddingTokenUsage = {
      llmModel: this.llmModelLabel,
      inputTokens,
      outputTokens: 0,
      durationMs,
    };

    return { vectors, tokenUsage };
  }

  /**
   * 获取 singleton pipeline（lazy load）
   * 通过 _transformersImporter 加载（测试可注入 mock）
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async loadPipeline(): Promise<any> {
    if (cachedPipeline !== null) {
      return cachedPipeline;
    }

    // 防止并发重复加载
    if (pipelineLoading) {
      return pipelineLoading;
    }

    pipelineLoading = (async () => {
      // 通过可替换的 importer 加载 transformers 模块
      const transformersModule = await _transformersImporter();

      cachedPipeline = await transformersModule.pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
      );

      return cachedPipeline;
    })();

    try {
      return await pipelineLoading;
    } finally {
      // 清除 loading promise（成功或失败都清除以允许重试）
      if (!cachedPipeline) {
        pipelineLoading = null;
      }
    }
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 从不同版本 transformers 的输出中提取 Float32Array
 * 兼容：output.data、output.ort_tensor.cpuData、直接 Float32Array
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractVector(output: any): Float32Array {
  if (output instanceof Float32Array) {
    return output;
  }
  // transformers v3 Tensor 格式：{ data: Float32Array, dims: number[] }
  if (output?.data instanceof Float32Array) {
    return output.data as Float32Array;
  }
  // 数组格式（某些版本返回嵌套数组）
  if (Array.isArray(output)) {
    return new Float32Array((output as unknown[]).flat() as number[]);
  }
  // ort_tensor 格式（旧版本兼容）
  if (output?.ort_tensor?.cpuData instanceof Float32Array) {
    return output.ort_tensor.cpuData as Float32Array;
  }
  // 兜底：返回空向量
  return new Float32Array(0);
}
