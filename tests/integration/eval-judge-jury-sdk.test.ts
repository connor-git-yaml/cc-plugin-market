/**
 * Feature 147 Sprint 1 — Cross-LLM Jury SDK integration smoke test
 *
 * 验证 callJudgeViaSdk 实际调用 Anthropic + OpenAI-compat (SiliconFlow) SDK 的 response shape
 * 与单元测试 mock 假设一致。Mock-only 测试存在风险：SDK 升版改 content array shape 或 usage 字段，
 * mock 仍 pass 但实跑爆。
 *
 * 用最便宜模型，最小 prompt，消耗 < $0.01 / vendor。
 *
 * CI 环境无对应 API_KEY 时自动 skip；本地开发者验证 SDK 改动时手动启用。
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HAS_ANTHROPIC = Boolean(process.env['ANTHROPIC_API_KEY']);
const HAS_SILICONFLOW = Boolean(process.env['SILICONFLOW_API_KEY']);

interface JuryModule {
  callJudgeViaSdk: (input: { model: string; prompt: string }) => Promise<{
    judge: string;
    vendor?: string | null;
    score: number | null;
    rationale: string;
    issues: string[];
    promptTokens: number | null;
    completionTokens: number | null;
    finishReason?: string | null;
    truncated?: boolean;
  }>;
}

async function loadJury(): Promise<JuryModule> {
  const url = pathToFileURL(resolve('scripts/eval-judge-jury.mjs')).href;
  return (await import(url)) as JuryModule;
}

const MINIMAL_JUDGE_PROMPT = `你是代码评审者。下面是一段 trivial 代码：

\`\`\`python
def add(a, b):
    return a + b
\`\`\`

按 0-10 评分。**严格 JSON 输出，无 markdown wrapper**：
{"score": <0-10>, "rationale": "<1 句>", "issues": ["<1 个改进点>"]}
`;

describe.skipIf(!HAS_ANTHROPIC)('Feature 147 Sprint 1: Anthropic SDK smoke', () => {
  it('callJudgeViaSdk: real haiku call → 解析 JSON → 返回 score + usage', async () => {
    const { callJudgeViaSdk } = await loadJury();
    const r = await callJudgeViaSdk({
      model: 'claude-haiku-4-5-20251001',
      prompt: MINIMAL_JUDGE_PROMPT,
    });
    expect(r.judge).toBe('claude-haiku-4-5-20251001');
    expect(r.vendor).toBe('anthropic');
    expect(typeof r.score).toBe('number');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(10);
    expect(typeof r.rationale).toBe('string');
    expect(r.rationale.length).toBeGreaterThan(0);
    expect(Array.isArray(r.issues)).toBe(true);
    expect(r.promptTokens).toBeGreaterThan(0);
    expect(r.completionTokens).toBeGreaterThan(0);
  }, 60000);
});

describe.skipIf(!HAS_SILICONFLOW)('Feature 147 Sprint 1: SiliconFlow OpenAI-compat smoke', () => {
  it('callJudgeViaSdk: real Qwen2.5-7B (cheapest) call via SiliconFlow → 解析 JSON', async () => {
    const { callJudgeViaSdk } = await loadJury();
    const r = await callJudgeViaSdk({
      model: 'siliconflow:Qwen/Qwen2.5-7B-Instruct',
      prompt: MINIMAL_JUDGE_PROMPT,
    });
    expect(r.judge).toBe('siliconflow:Qwen/Qwen2.5-7B-Instruct');
    expect(r.vendor).toBe('siliconflow');
    expect(typeof r.score).toBe('number');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(10);
    expect(typeof r.rationale).toBe('string');
    expect(Array.isArray(r.issues)).toBe(true);
    // OpenAI-compat shape sanity
    expect(r.promptTokens).toBeGreaterThan(0);
    expect(r.completionTokens).toBeGreaterThan(0);
    // finishReason / truncated 字段应该存在（即使 false）
    expect(r.truncated).toBeDefined();
  }, 90000);
});
