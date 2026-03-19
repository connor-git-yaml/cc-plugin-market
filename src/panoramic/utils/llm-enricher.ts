/**
 * LLM 语义增强工具函数
 *
 * 为空 description 的数据模型字段和配置项批量调用 LLM 推断说明。
 * 所有 LLM 推断的 description 以 [AI] 前缀标注，与人工注释明确区分。
 *
 * 导出函数：
 * - enrichFieldDescriptions: 数据模型字段语义增强
 * - enrichConfigDescriptions: 配置项语义增强
 *
 * 降级策略：LLM 不可用时静默降级，不抛异常，返回原始数据。
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { DataModel } from '../data-model-generator.js';
import type { ConfigFileResult } from '../config-reference-generator.js';
import { detectAuth } from '../../auth/auth-detector.js';
import { callLLMviaCli } from '../../auth/cli-proxy.js';

// ============================================================
// Zod Schema（LLM 返回值验证）
// ============================================================

/** 单个字段/配置项的 LLM 推断结果 */
export const EnrichFieldResultSchema = z.object({
  name: z.string(),
  description: z.string(),
});

/** LLM 批量推断结果数组 */
export const EnrichBatchResultSchema = z.array(EnrichFieldResultSchema);

// ============================================================
// [AI] 前缀常量
// ============================================================

/** LLM 推断说明的前缀标注 */
const AI_PREFIX = '[AI] ';

// ============================================================
// 默认模型配置
// ============================================================

/** 默认 LLM 模型（使用 sonnet 确保 Agent SDK 环境兼容） */
const DEFAULT_MODEL = 'sonnet';

/** LLM 调用超时（毫秒） */
const LLM_TIMEOUT = 60_000;

/** LLM temperature（低温用于事实性推断） */
const LLM_TEMPERATURE = 0.3;

// ============================================================
// 内部函数：callLLMSimple
// ============================================================

/**
 * 轻量级 LLM 调用（不依赖 AssembledContext）
 * 内部使用，不导出。
 *
 * 使用 detectAuth() 获取认证方式：
 * - API Key 可用时直接使用 Anthropic SDK
 * - CLI 代理可用时调用 callLLMviaCli
 * - 均不可用时返回 null（调用方负责降级）
 *
 * @param systemPrompt - 系统提示词
 * @param userPrompt - 用户提示词
 * @returns LLM 响应文本，不可用时返回 null
 */
async function callLLMSimple(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  const authResult = detectAuth();

  // 无可用认证方式 → 静默降级
  if (!authResult.preferred) {
    return null;
  }

  const model = process.env['PANORAMIC_LLM_MODEL'] ?? DEFAULT_MODEL;

  if (authResult.preferred.type === 'api-key') {
    // SDK 直接调用
    const client = new Anthropic({
      apiKey: process.env['ANTHROPIC_API_KEY'],
      timeout: LLM_TIMEOUT,
    });

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      temperature: LLM_TEMPERATURE,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return text || null;
  }

  // CLI 代理调用
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
  const cliResponse = await callLLMviaCli(fullPrompt, {
    model,
    timeout: LLM_TIMEOUT,
  });

  return cliResponse.content || null;
}

// ============================================================
// Prompt 模板
// ============================================================

/** 数据模型字段增强的 system prompt */
const FIELD_SYSTEM_PROMPT = `你是一个代码分析专家。根据提供的数据模型字段信息（字段名、类型、所属模型名、源文件路径），
为每个字段推断一条简洁的中文说明（10-30 字）。

要求：
1. 说明应描述字段的业务含义，而非重复类型信息
2. 基于字段名称和上下文推断语义
3. 不确定时使用保守的描述

严格输出 JSON 数组，每个元素包含 name 和 description 字段。不要输出任何其他内容。`;

/** 配置项增强的 system prompt */
const CONFIG_SYSTEM_PROMPT = `你是一个配置文件分析专家。根据提供的配置项信息（键路径、当前值、类型、所属配置文件），
为每个配置项推断一条简洁的中文说明（10-30 字）。

要求：
1. 说明应描述配置项的作用和影响
2. 基于键名、值和上下文推断语义
3. 不确定时使用保守的描述

严格输出 JSON 数组，每个元素包含 name 和 description 字段。不要输出任何其他内容。`;

// ============================================================
// JSON 响应提取辅助
// ============================================================

/**
 * 从 LLM 响应中提取 JSON 数组
 * 支持包含 markdown 代码块的响应
 */
function extractJsonArray(text: string): unknown {
  // 尝试直接解析
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
// 公开 API：enrichFieldDescriptions
// ============================================================

/**
 * 批量为空 description 的数据模型字段调用 LLM 推断说明
 *
 * 处理逻辑：
 * 1. 深拷贝 models 数组（不修改原数据）
 * 2. 收集 description === null 且不以 [AI] 开头的字段
 * 3. 若无空字段，直接返回
 * 4. 检查 LLM 可用性，不可用则静默返回原数据
 * 5. 按模型分组，每个模型发一次 LLM 调用
 * 6. 解析响应，匹配回字段，添加 [AI] 前缀
 * 7. 单个模型调用失败时 catch 并跳过
 *
 * @param models - DataModel 数组（含待增强的字段）
 * @returns 增强后的 DataModel 数组（深拷贝，不修改原数组）
 */
export async function enrichFieldDescriptions(
  models: DataModel[],
): Promise<DataModel[]> {
  // 深拷贝，不修改原数组
  const enriched: DataModel[] = JSON.parse(JSON.stringify(models));

  // 收集需要增强的字段（description 为 null 且不以 [AI] 开头）
  const modelsWithEmptyFields = enriched.filter((model) =>
    model.fields.some(
      (f) => f.description === null || (typeof f.description === 'string' && f.description === ''),
    ),
  );

  // 无空字段，直接返回
  if (modelsWithEmptyFields.length === 0) {
    return enriched;
  }

  // 检查 LLM 可用性（提前返回避免无谓的循环）
  const authResult = detectAuth();
  if (!authResult.preferred) {
    return enriched;
  }

  // 按模型逐个调用 LLM
  for (const model of modelsWithEmptyFields) {
    try {
      // 收集该模型中需要增强的字段
      const emptyFields = model.fields.filter(
        (f) =>
          (f.description === null || f.description === '') &&
          !(typeof f.description === 'string' && f.description.startsWith(AI_PREFIX)),
      );

      if (emptyFields.length === 0) continue;

      // 构造 user prompt
      const userPrompt = JSON.stringify({
        model: model.name,
        file: model.filePath,
        fields: emptyFields.map((f) => ({
          name: f.name,
          type: f.typeStr,
        })),
      });

      const response = await callLLMSimple(FIELD_SYSTEM_PROMPT, userPrompt);
      if (!response) continue;

      // 解析并验证响应
      const rawParsed = extractJsonArray(response);
      const parsed = EnrichBatchResultSchema.safeParse(rawParsed);
      if (!parsed.success) continue;

      // 匹配回字段并添加 [AI] 前缀
      for (const result of parsed.data) {
        const field = model.fields.find((f) => f.name === result.name);
        if (field && (field.description === null || field.description === '')) {
          field.description = `${AI_PREFIX}${result.description}`;
        }
      }
    } catch {
      // 单个模型失败时静默跳过，不中断其他模型
      continue;
    }
  }

  return enriched;
}

// ============================================================
// 公开 API：enrichConfigDescriptions
// ============================================================

/**
 * 批量为空 description 的配置项调用 LLM 推断说明
 *
 * 处理逻辑与 enrichFieldDescriptions 类似，按配置文件分组。
 *
 * @param files - ConfigFileResult 数组
 * @returns 增强后的 ConfigFileResult 数组（深拷贝）
 */
export async function enrichConfigDescriptions(
  files: ConfigFileResult[],
): Promise<ConfigFileResult[]> {
  // 深拷贝，不修改原数组
  const enriched: ConfigFileResult[] = JSON.parse(JSON.stringify(files));

  // 收集需要增强的文件（包含 description 为空字符串的配置项）
  const filesWithEmptyDesc = enriched.filter((file) =>
    file.entries.some(
      (e) => e.description === '' && !e.description.startsWith(AI_PREFIX),
    ),
  );

  // 无空 description，直接返回
  if (filesWithEmptyDesc.length === 0) {
    return enriched;
  }

  // 检查 LLM 可用性
  const authResult = detectAuth();
  if (!authResult.preferred) {
    return enriched;
  }

  // 按文件逐个调用 LLM
  for (const file of filesWithEmptyDesc) {
    try {
      // 收集该文件中需要增强的配置项
      const emptyEntries = file.entries.filter(
        (e) => e.description === '' && !e.description.startsWith(AI_PREFIX),
      );

      if (emptyEntries.length === 0) continue;

      // 构造 user prompt
      const userPrompt = JSON.stringify({
        file: file.filePath,
        format: file.format,
        entries: emptyEntries.map((e) => ({
          name: e.keyPath,
          defaultValue: e.defaultValue,
          type: e.type,
        })),
      });

      const response = await callLLMSimple(CONFIG_SYSTEM_PROMPT, userPrompt);
      if (!response) continue;

      // 解析并验证响应
      const rawParsed = extractJsonArray(response);
      const parsed = EnrichBatchResultSchema.safeParse(rawParsed);
      if (!parsed.success) continue;

      // 匹配回配置项并添加 [AI] 前缀
      for (const result of parsed.data) {
        const entry = file.entries.find((e) => e.keyPath === result.name);
        if (entry && entry.description === '') {
          entry.description = `${AI_PREFIX}${result.description}`;
        }
      }
    } catch {
      // 单个文件失败时静默跳过
      continue;
    }
  }

  return enriched;
}
