/**
 * LLM 调用统一门面
 *
 * 收敛 auth 检测 → 路由 → 降级 的重复逻辑，
 * 供 pattern-hints-generator、llm-enricher 等调用方复用。
 *
 * 导出：
 * - LLMCallOptions：调用选项接口
 * - callLLM：统一 LLM 调用入口
 * - extractJsonArray：从 LLM 响应中提取 JSON 数组
 * - isLLMAvailable：同步检测 LLM 是否可用
 */

import Anthropic from '@anthropic-ai/sdk';
import { detectAuth } from '../../auth/auth-detector.js';
import { callLLMviaCli } from '../../auth/cli-proxy.js';
import { callLLMviaCodex } from '../../auth/codex-proxy.js';
import { resolveReverseSpecModel } from '../../core/model-selection.js';

// ============================================================
// 接口定义
// ============================================================

/**
 * LLM 调用选项
 * 所有字段均可选，未指定时使用 callLLM 内部默认值
 */
export interface LLMCallOptions {
  /** 系统提示词 */
  systemPrompt?: string;
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 采样温度（0~1） */
  temperature?: number;
}

// ============================================================
// 公开 API：callLLM
// ============================================================

/**
 * 统一 LLM 调用门面
 *
 * 内部路由逻辑：
 * 1. detectAuth() 获取首选认证方式
 * 2. 无可用认证 → 静默返回 null
 * 3. api-key → Anthropic SDK 直接调用
 * 4. cli-proxy (codex) → callLLMviaCodex
 * 5. cli-proxy (claude) → callLLMviaCli
 *
 * 所有异常 catch 后返回 null（调用方负责降级）。
 *
 * @param prompt - 用户提示词
 * @param options - 调用选项（systemPrompt、maxTokens、timeout、temperature）
 * @returns LLM 响应文本，不可用时返回 null
 */
export async function callLLM(
  prompt: string,
  options?: LLMCallOptions,
): Promise<string | null> {
  const authResult = detectAuth();

  // 无可用认证方式 → 静默降级
  if (!authResult.preferred) {
    return null;
  }

  // 确定运行时提供方，用于模型选择
  const providerRuntime =
    authResult.preferred.type === 'cli-proxy' && authResult.preferred.provider === 'codex'
      ? 'codex'
      : 'claude';

  // PANORAMIC_LLM_MODEL 环境变量优先级最高
  const model =
    process.env['PANORAMIC_LLM_MODEL'] ??
    resolveReverseSpecModel({ provider: providerRuntime }).model;

  const timeout = options?.timeout ?? 60_000;
  const maxTokens = options?.maxTokens ?? 4096;
  const temperature = options?.temperature ?? 0.3;

  try {
    if (authResult.preferred.type === 'api-key') {
      // Anthropic SDK 直接调用
      const client = new Anthropic({
        apiKey: process.env['ANTHROPIC_API_KEY'],
        timeout,
      });

      const messageParams: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: prompt }],
      };

      if (options?.systemPrompt) {
        messageParams.system = options.systemPrompt;
      }

      const response = await client.messages.create(messageParams);

      const text = (response as Anthropic.Message).content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      return text || null;
    }

    // CLI 代理调用：将 systemPrompt 和 userPrompt 合并为 fullPrompt
    const fullPrompt = options?.systemPrompt
      ? `${options.systemPrompt}\n\n---\n\n${prompt}`
      : prompt;

    const cliResponse =
      authResult.preferred.provider === 'codex'
        ? await callLLMviaCodex(fullPrompt, { model, timeout })
        : await callLLMviaCli(fullPrompt, { model, timeout });

    return cliResponse.content || null;
  } catch {
    // 所有异常静默返回 null，调用方负责降级
    return null;
  }
}

// ============================================================
// 公开 API：extractJsonArray
// ============================================================

/**
 * 从 LLM 响应中提取 JSON 数组
 *
 * 支持以下格式：
 * 1. markdown 代码块（```json ... ``` 或 ``` ... ```）
 * 2. 文本中的第一个 [...] 数组
 * 3. 纯 JSON 文本直接解析
 *
 * @param text - LLM 返回的原始文本
 * @returns 解析结果（调用方自行类型断言）
 * @throws SyntaxError 若无法解析 JSON
 */
export function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();

  // 尝试从 markdown 代码块中提取
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1]!.trim());
  }

  // 尝试找到第一个 [ 开始的 JSON 数组
  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
  }

  // 直接尝试解析全文
  return JSON.parse(trimmed);
}

// ============================================================
// 公开 API：isLLMAvailable
// ============================================================

/**
 * 同步检测当前环境 LLM 是否可用
 *
 * 封装 detectAuth()，供调用方在启动阶段提前判断，
 * 避免对不可用的 LLM 发起昂贵的批量调用。
 *
 * @returns true 表示存在可用的认证方式
 */
export function isLLMAvailable(): boolean {
  const authResult = detectAuth();
  return authResult.preferred !== null;
}
