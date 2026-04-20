/**
 * qa/llm-caller.ts
 * Step 7：Budget-gate 注入 + Anthropic SDK 调用
 *
 * 职责：
 * - 用 estimateFast() 预估 token 消耗
 * - 调用 runBudgetGate({ budget: Infinity, preset: 'continue' }) 实现 record-only 模式（Q2 / FR-017）
 *   - budget = Infinity 保证永不触发阻断
 *   - 超额判断：若 totalEstimate > HARDCODE_LIMIT_TOKENS，标记 overBudget=true 并记录 warn
 * - 调用 Anthropic SDK messages.create()（模型 ID 从项目配置读取，不硬编码）
 * - 解析响应：提取 answer + citations + tokenUsage
 *
 * 注意：HARDCODE_LIMIT_TOKENS 约为 $0.05/query：
 *   claude-sonnet 输入约 $3/1M tokens → $0.05 / $0.000003 ≈ 16,666 input tokens
 *   加上 ~3,333 output tokens（~$10/1M × $0.05 / $0.00001）
 *   这里保守取 5k input + 1k output = ~6000 tokens 作为提示性 hardcode 上限
 */
import Anthropic from '@anthropic-ai/sdk';
import { estimateFast } from '../../core/token-counter.js';
import { runBudgetGate } from '../../batch/budget-gate.js';
import { resolveReverseSpecModel } from '../../core/model-selection.js';
import type { Citation } from './types.js';
import type { QnAPrompt } from './prompt-builder.js';

// ============================================================
// 常量
// ============================================================

/**
 * 单次问答 token 消耗的 hardcode 上限（约 $0.05/query）
 * 以 claude-sonnet input $3/1M 计算：$0.05 / $0.000003 ≈ 16,666 input tokens
 * 此处保守取较小值（5000 + 1000 = 6000 tokens）触发 warn 提示
 */
const HARDCODE_LIMIT_TOKENS = 6000;

// ============================================================
// 类型定义
// ============================================================

/** LLM 调用选项 */
export interface QnALlmOptions {
  /** 最大输出 token 数（默认 2048） */
  maxTokens?: number;
  /** 采样温度（默认 0.3） */
  temperature?: number;
  /** 超时毫秒（默认 60_000） */
  timeoutMs?: number;
}

/** LLM 调用结果 */
export interface QnALlmResult {
  /** 回答文本（来自 LLM 响应的 answer 字段） */
  answer: string;
  /** 从 LLM 响应解析出的 citations */
  parsedCitations: Citation[];
  /** token 使用记录 */
  tokenUsage: {
    input: number;
    output: number;
    /** true = 超过 hardcode 上限（record-only，不阻断） */
    overBudget: boolean;
  };
}

// ============================================================
// 响应解析
// ============================================================

/**
 * 从 LLM 返回的文本中解析 QnA JSON 结果
 * 容错：JSON 解析失败时返回 answer=rawText, citations=[]
 */
function parseLlmResponse(rawText: string): { answer: string; citations: Citation[] } {
  // 尝试从 markdown 代码块中提取 JSON
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : rawText.trim();

  try {
    const parsed = JSON.parse(jsonStr ?? rawText.trim()) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'answer' in parsed &&
      typeof (parsed as Record<string, unknown>)['answer'] === 'string'
    ) {
      const obj = parsed as Record<string, unknown>;
      const answer = String(obj['answer']);
      const rawCitations = Array.isArray(obj['citations']) ? (obj['citations'] as unknown[]) : [];

      // 解析 citations 数组
      const citations: Citation[] = rawCitations
        .filter((c): c is Record<string, unknown> =>
          typeof c === 'object' && c !== null,
        )
        .map((c) => ({
          specPath: String(c['specPath'] ?? ''),
          lineRange: {
            startLine: typeof c['startLine'] === 'number' ? c['startLine'] : 0,
            endLine: typeof c['endLine'] === 'number' ? c['endLine'] : 0,
          },
          excerpt: String(c['excerpt'] ?? ''),
        }));

      return { answer, citations };
    }
  } catch {
    // JSON 解析失败：将原始文本作为 answer 返回
  }

  return { answer: rawText.trim(), citations: [] };
}

// ============================================================
// 主函数
// ============================================================

/**
 * 调用 LLM 完成问答
 *
 * @param prompt - buildQnAPrompt 输出的 { systemPrompt, userPrompt }
 * @param options - 调用选项（maxTokens、temperature、timeoutMs）
 * @returns QnALlmResult（含 answer、parsedCitations、tokenUsage）
 * @throws LLM 调用失败时抛出 Error（不吞掉异常，由 index.ts 处理）
 */
export async function callQnALlm(
  prompt: QnAPrompt,
  options?: QnALlmOptions,
): Promise<QnALlmResult> {
  const maxTokens = options?.maxTokens ?? 2048;
  const temperature = options?.temperature ?? 0.3;
  const timeoutMs = options?.timeoutMs ?? 60_000;

  // ── Step 7a：budget gate（record-only 模式）────────────────
  const inputEstimate = estimateFast(prompt.userPrompt + prompt.systemPrompt);
  const outputEstimate = Math.round(inputEstimate * 0.3);
  const totalEstimate = inputEstimate + outputEstimate;

  // budget = Infinity 保证永不触发阻断（record-only 语义）
  await runBudgetGate({
    baseEstimate: totalEstimate,
    budget: Infinity,
    preset: 'continue',
    isTTY: false,
  });

  // 超额判断：超过 hardcode 上限时记录 warn（不阻断）
  const overBudget = totalEstimate > HARDCODE_LIMIT_TOKENS;
  if (overBudget) {
    console.warn(
      `[warn] qna token cost over hardcode limit, recorded only. ` +
      `estimate=${totalEstimate} tokens, limit=${HARDCODE_LIMIT_TOKENS} tokens`,
    );
  }

  // ── Step 7b：从项目配置读取模型 ID（不硬编码）─────────────
  const modelId = resolveReverseSpecModel().model;

  // ── Step 7c：Anthropic SDK 调用──────────────────────────
  const client = new Anthropic({
    apiKey: process.env['ANTHROPIC_API_KEY'],
    timeout: timeoutMs,
  });

  const response = await client.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    temperature,
    system: prompt.systemPrompt,
    messages: [{ role: 'user', content: prompt.userPrompt }],
  });

  // ── Step 7d：提取文本内容 ──────────────────────────────
  const rawText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  // 实际 token 使用量（来自 API 响应）
  const actualInput = response.usage?.input_tokens ?? inputEstimate;
  const actualOutput = response.usage?.output_tokens ?? outputEstimate;
  const actualTotal = actualInput + actualOutput;
  const actualOverBudget = overBudget || actualTotal > HARDCODE_LIMIT_TOKENS;

  // ── Step 7e：解析响应结构 ─────────────────────────────
  const { answer, citations } = parseLlmResponse(rawText);

  return {
    answer,
    parsedCitations: citations,
    tokenUsage: {
      input: actualInput,
      output: actualOutput,
      overBudget: actualOverBudget,
    },
  };
}
