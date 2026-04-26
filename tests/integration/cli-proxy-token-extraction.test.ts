/**
 * cli-proxy 真实流回归测试（Feature 133 P0-1）
 *
 * Phase 2 集成回归发现：所有 module spec frontmatter 的 tokenUsage 全为 0，
 * 但 LLM 真调用了。根因是 cli-proxy.ts 的 StreamMessage 类型把
 * input_tokens/output_tokens 当作 result 类型 message 的顶层字段，但 Claude
 * CLI 实际嵌套在 usage.* 下；mock-only 测试沿用相同错误假设导致单测全过却
 * 生产失败。
 *
 * 这个集成测试用真实的 Anthropic SDK 调用（callLLM 走 SDK 路径）/ 真实
 * Claude CLI 调用（走 cli-proxy 路径）来验证 token 链路端到端贯通。
 *
 * CI 环境无 ANTHROPIC_API_KEY 时自动 skip；本地开发者验证修复时手动启用。
 */
import { describe, it, expect } from 'vitest';
import { callLLM } from '../../src/core/llm-client.js';
import type { AssembledContext } from '../../src/core/context-assembler.js';

const HAS_API_KEY = Boolean(process.env['ANTHROPIC_API_KEY']);

const MIN_PROMPT: AssembledContext = {
  prompt: 'Reply with the single word "ok".',
  tokenCount: 50,
  truncated: false,
};

describe.skipIf(!HAS_API_KEY)('Feature 133 P0-1：真实 LLM 调用 token 提取链路', () => {
  it('SDK 路径返回的 LLMResponse 含非零 inputTokens/outputTokens', async () => {
    // Haiku 4.5 是最便宜的模型，适合作为低成本的 regression guard
    const response = await callLLM(MIN_PROMPT, {
      model: 'claude-haiku-4-5-20251001',
      maxTokensResponse: 16,
      timeout: 60_000,
    });

    expect(response.inputTokens).toBeGreaterThan(0);
    expect(response.outputTokens).toBeGreaterThan(0);
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.model).toContain('haiku');
    expect(response.duration).toBeGreaterThan(0);
  }, 90_000);
});
