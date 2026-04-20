/**
 * EmbeddingProvider 工厂函数
 * 根据 SPECTRA_EMBEDDING_PROVIDER 环境变量选择提供方
 *
 * 支持的值：
 *   - 'local'（默认）：使用 @huggingface/transformers 本地推理
 *   - 'openai'：使用 OpenAI text-embedding-3-small API
 *
 * 设计决策：
 *   - 不自动 fallback（NFR-002）：local 加载失败时抛出含安装指引的错误；
 *     openai 缺 API key 时抛出提示切换的错误
 *   - 未知 provider 名称时立即抛错，防止静默降级导致行为不一致
 */
import type { EmbeddingProvider } from '../embedding-provider.js';
import { LocalEmbeddingProvider } from './local-provider.js';
import { createOpenAIProvider } from './openai-provider.js';

// ============================================================
// 公开类型
// ============================================================

export type EmbeddingProviderName = 'local' | 'openai';

export interface EmbeddingProviderFactoryOptions {
  /** 显式指定 provider 名称（覆盖环境变量） */
  providerName?: EmbeddingProviderName | string;
  /** 显式传入 OpenAI API key（覆盖 OPENAI_API_KEY 环境变量） */
  openaiApiKey?: string;
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建 EmbeddingProvider 实例
 *
 * 选择优先级：
 * 1. options.providerName（显式参数）
 * 2. process.env.SPECTRA_EMBEDDING_PROVIDER（环境变量）
 * 3. 默认值 'local'
 *
 * @throws Error 当 provider 名称无效时（有效值：local | openai）
 * @throws Error 当选择 openai 但 API key 不可用时
 * @throws Error 当选择 local 但 @huggingface/transformers 不可用时（在 embed() 调用时抛出）
 */
export function createEmbeddingProvider(
  options: EmbeddingProviderFactoryOptions = {},
): EmbeddingProvider {
  // 确定 provider 名称（选项 > 环境变量 > 默认值）
  const raw = options.providerName ?? process.env.SPECTRA_EMBEDDING_PROVIDER ?? 'local';
  const name = raw.toLowerCase();

  if (name === 'local') {
    // local provider 的依赖缺失错误将在 embed() 首次调用时才会抛出（lazy load）
    return new LocalEmbeddingProvider();
  }

  if (name === 'openai') {
    // API key 缺失时 createOpenAIProvider 内部会抛出清晰错误
    return createOpenAIProvider({ apiKey: options.openaiApiKey });
  }

  // 未知 provider 名称：立即抛错，不静默降级
  throw new Error(
    `未知的 EmbeddingProvider: "${raw}"。有效值：local | openai（通过 SPECTRA_EMBEDDING_PROVIDER 环境变量设置）`,
  );
}
