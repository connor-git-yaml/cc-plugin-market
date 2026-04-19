/**
 * LLM 主题推断 + budget 集成
 *
 * 职责：
 * - 接收 open question 候选（规则命中 + 问号命中）
 * - 批量 prompt LLM 判断问号候选是否为真正的 open question + 推断 1-3 个主题
 * - budget 超出或 dryRun 时降级（不调用 LLM，fallbackReason 标记原因）
 *
 * 本模块不直接依赖 src/core/llm-client.ts 的 callLLM（它以 AssembledContext 为契约），
 * 而是引入一个轻量 SimpleLLMClient 抽象便于测试注入。
 */
import type { OpenQuestionEntry, TokenUsage } from '../types.js';
import type { OpenQuestionCandidate } from './index.js';

/**
 * 轻量 LLM 客户端抽象。
 * 生产实现可用 src/debt-scanner/llm-client-adapter 包装 Anthropic SDK；
 * 测试时注入 StubLLMClient。
 */
export interface SimpleLLMClient {
  /**
   * 调用 LLM，返回原始文本 + token 使用量 + 实际模型名。
   */
  complete(input: SimpleLLMInput): Promise<SimpleLLMOutput>;
  /** 估算一段文本的 token 数（用于 budget 预检） */
  estimateTokens(text: string): number;
  /** 提供给 UI / 报告的 model 标识 */
  readonly model: string;
}

export interface SimpleLLMInput {
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
}

export interface SimpleLLMOutput {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface InferTopicsOptions {
  /** 规则命中的 confirmed 条目 */
  confirmed: OpenQuestionEntry[];
  /** 问号命中的候选 */
  llmCandidates: OpenQuestionCandidate[];
  /** LLM 客户端；为 undefined 则走 "no-llm-client" 降级 */
  llmClient?: SimpleLLMClient;
  /** 剩余 budget（input+output tokens 总量）；undefined 表示无限制 */
  budgetLimit?: number;
  /** dryRun = true 时跳过 LLM 调用 */
  dryRun?: boolean;
}

export interface InferTopicsResult {
  /** 最终的 open question 条目（规则 + LLM 判定为真的问号候选） */
  entries: OpenQuestionEntry[];
  /** 实际 token 用量 */
  tokenUsage: TokenUsage;
  /** LLM 调用次数 */
  llmCalls: number;
  /** 降级原因；未降级为 undefined */
  fallbackReason?: 'budget-exhausted' | 'dry-run' | 'no-llm-client';
  /** LLM 使用的 model 名称 */
  llmModel?: string;
}

const SYSTEM_PROMPT = [
  'You are a classifier for software-design-document open questions.',
  'For each candidate sentence, decide:',
  '1. Is this an actual OPEN QUESTION (not rhetorical)?',
  '2. If yes, return 1-3 short topic keywords (lowercase, hyphenated).',
  'Return strict JSON only: {"results":[{"id":"c1","isOpenQuestion":true,"topics":["parser","validation"]}]}',
].join('\n');

/**
 * 批量对 llmCandidates 做 LLM 推断；confirmed 直接透传（可选：给它们也补 topic）。
 */
export async function inferOpenQuestionTopics(
  opts: InferTopicsOptions,
): Promise<InferTopicsResult> {
  const tokenUsage: TokenUsage = { input: 0, output: 0 };
  const entries: OpenQuestionEntry[] = [...opts.confirmed];

  // 无候选 → 没必要调用 LLM
  if (opts.llmCandidates.length === 0) {
    return { entries, tokenUsage, llmCalls: 0 };
  }

  // dryRun 优先生效
  if (opts.dryRun) {
    return { entries, tokenUsage, llmCalls: 0, fallbackReason: 'dry-run' };
  }
  if (!opts.llmClient) {
    return { entries, tokenUsage, llmCalls: 0, fallbackReason: 'no-llm-client' };
  }

  const userPrompt = buildUserPrompt(opts.llmCandidates);
  const estimatedInput = opts.llmClient.estimateTokens(SYSTEM_PROMPT + '\n' + userPrompt);
  // 预留 output 预算：每个候选 20 token 估
  const estimatedOutput = Math.max(256, opts.llmCandidates.length * 20);
  const totalEstimate = estimatedInput + estimatedOutput;

  if (opts.budgetLimit != null && totalEstimate > opts.budgetLimit) {
    return {
      entries,
      tokenUsage,
      llmCalls: 0,
      fallbackReason: 'budget-exhausted',
      llmModel: opts.llmClient.model,
    };
  }

  let output: SimpleLLMOutput;
  try {
    output = await opts.llmClient.complete({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxOutputTokens: Math.min(estimatedOutput * 2, 2048),
    });
  } catch {
    // LLM 调用失败不中断 pipeline
    return {
      entries,
      tokenUsage,
      llmCalls: 0,
      fallbackReason: 'budget-exhausted',
      llmModel: opts.llmClient.model,
    };
  }

  tokenUsage.input += output.inputTokens;
  tokenUsage.output += output.outputTokens;

  const parsed = parseLLMJson(output.text);
  for (let idx = 0; idx < opts.llmCandidates.length; idx++) {
    const c = opts.llmCandidates[idx];
    if (!c) continue;
    // 主键用 id（c0/c1/…，LLM 难以改写的短字符串），兼容回退到 key（docPath|snippet）
    const found = parsed.byId.get('c' + idx) ?? parsed.byKey.get(c.docPath + '|' + c.snippet);
    if (!found) continue;
    if (!found.isOpenQuestion) continue;
    entries.push({
      snippet: c.snippet,
      docPath: c.docPath,
      headingPath: c.headingPath,
      source: 'llm',
      topics: found.topics.slice(0, 3),
    });
  }

  return {
    entries,
    tokenUsage,
    llmCalls: 1,
    llmModel: output.model,
  };
}

/**
 * 构造 user prompt，id 用 docPath|snippet 组合以便回填
 */
function buildUserPrompt(candidates: OpenQuestionCandidate[]): string {
  const payload = candidates.map((c, idx) => ({
    id: 'c' + idx,
    key: c.docPath + '|' + c.snippet,
    text: c.snippet,
    context: c.headingPath,
  }));
  return [
    'Candidates (JSON):',
    JSON.stringify(payload),
    '',
    'Respond with JSON only matching the system prompt schema.',
    'Use the "id" field to correlate each result; also echo "key" verbatim so the caller can align rows.',
    'Schema: {"results":[{"id":"c0","key":"...","isOpenQuestion":true,"topics":["k1","k2"]}]}',
  ].join('\n');
}

interface ParsedRow {
  isOpenQuestion: boolean;
  topics: string[];
}

interface ParsedIndex {
  byId: Map<string, ParsedRow>;
  byKey: Map<string, ParsedRow>;
}

/** 解析 LLM JSON 响应，容错：取第一段 JSON；失败返回空索引 */
function parseLLMJson(raw: string): ParsedIndex {
  const byId = new Map<string, ParsedRow>();
  const byKey = new Map<string, ParsedRow>();
  const jsonText = extractJsonBlock(raw);
  if (!jsonText) return { byId, byKey };
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    return { byId, byKey };
  }
  if (!obj || typeof obj !== 'object') return { byId, byKey };
  const results = (obj as { results?: unknown }).results;
  if (!Array.isArray(results)) return { byId, byKey };
  for (const row of results) {
    if (!row || typeof row !== 'object') continue;
    const r = row as {
      id?: unknown;
      key?: unknown;
      isOpenQuestion?: unknown;
      topics?: unknown;
    };
    const topics = Array.isArray(r.topics)
      ? r.topics.filter((t): t is string => typeof t === 'string')
      : [];
    const parsed: ParsedRow = {
      isOpenQuestion: Boolean(r.isOpenQuestion),
      topics,
    };
    if (typeof r.id === 'string' && r.id.length > 0) {
      byId.set(r.id, parsed);
    }
    if (typeof r.key === 'string' && r.key.length > 0) {
      byKey.set(r.key, parsed);
    }
  }
  return { byId, byKey };
}

/** 取第一段 {…} 或 [...] JSON，容错 markdown 围栏 */
function extractJsonBlock(text: string): string | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence?.[1]) return fence[1].trim();
  const m = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(text);
  return m ? m[0] : null;
}
