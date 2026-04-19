/**
 * debt-scanner 的 SimpleLLMClient 适配器
 *
 * - AnthropicLLMClient：生产实现，直接包装 @anthropic-ai/sdk
 * - StubLLMClient：测试用，返回预设响应
 */
import Anthropic from '@anthropic-ai/sdk';
import type { SimpleLLMClient, SimpleLLMInput, SimpleLLMOutput } from './design-docs/llm-topic-inferrer.js';

export interface AnthropicClientOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

/** 生产实现：直接用 Anthropic SDK */
export class AnthropicLLMClient implements SimpleLLMClient {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly timeoutMs: number;

  constructor(opts: AnthropicClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) throw new Error('AnthropicLLMClient 需要 ANTHROPIC_API_KEY');
    this.model = opts.model ?? 'claude-haiku-4-5';
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.client = new Anthropic({ apiKey, timeout: this.timeoutMs });
  }

  async complete(input: SimpleLLMInput): Promise<SimpleLLMOutput> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: input.maxOutputTokens,
      system: input.systemPrompt,
      messages: [{ role: 'user', content: input.userPrompt }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return {
      text,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      model: res.model,
    };
  }

  estimateTokens(text: string): number {
    // 粗略估算：英文 ~4 char/token，中文 ~2 char/token。
    // 对 budget 预检来说 ±20% 误差可以接受。
    return Math.ceil(text.length / 3.5);
  }
}

/** 测试实现：按预设脚本返回响应 */
export class StubLLMClient implements SimpleLLMClient {
  readonly model = 'stub-llm';
  public calls: SimpleLLMInput[] = [];
  constructor(
    private readonly responder: (input: SimpleLLMInput) => SimpleLLMOutput | Promise<SimpleLLMOutput>,
  ) {}

  async complete(input: SimpleLLMInput): Promise<SimpleLLMOutput> {
    this.calls.push(input);
    return this.responder(input);
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
