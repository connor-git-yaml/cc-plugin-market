/**
 * LLM token 提取链路真实集成测试（Feature 133 P0-1）
 *
 * Phase 2 集成回归发现：所有 module spec frontmatter 的 tokenUsage 全为 0，
 * 但 LLM 真调用了。根因之一是 cli-proxy.ts 的 StreamMessage 类型把
 * input_tokens/output_tokens 当作 result 类型 message 的顶层字段，但 Claude
 * CLI 实际嵌套在 usage.* 下；mock-only 测试沿用相同错误假设导致单测全过却
 * 生产失败。
 *
 * 这个集成测试覆盖范围（post-review 修复后澄清）：
 * - **SDK 路径**：在 ANTHROPIC_API_KEY 设置时 callLLM 走 callLLMviaSdk，
 *   验证 Anthropic SDK 返回的 response.usage.* 能传递到上层 LLMResponse
 *   并最终写入 frontmatter
 * - **cli-proxy 路径不在此覆盖**：当 ANTHROPIC_API_KEY 设置时，detectAuth
 *   优先走 SDK，cli-proxy 不会被触发；cli-proxy 的嵌套 usage 解析逻辑由
 *   tests/unit/cli-proxy.test.ts 的 3 个 mock case 覆盖（嵌套优先 / 顶层
 *   兼容 / 缺失返回 0）
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
