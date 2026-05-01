/**
 * Feature 147 Sprint 1 — Cross-LLM Jury SDK integration smoke test
 *
 * 验证 callJudgeViaSdk 实际调用 Anthropic SDK 的 response shape 与单元测试
 * mock 假设一致。Mock-only 测试存在风险：SDK 升版改 content array shape 或
 * usage 字段，mock 仍 pass 但实跑爆。
 *
 * 用最便宜模型（haiku），最小 prompt（让 LLM 输出 score=5），消耗 < $0.01。
 *
 * CI 环境无 ANTHROPIC_API_KEY 时自动 skip；本地开发者验证 SDK 改动时手动启用。
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HAS_API_KEY = Boolean(process.env['ANTHROPIC_API_KEY']);

interface JuryModule {
  callJudgeViaSdk: (input: { model: string; prompt: string }) => Promise<{
    judge: string;
    score: number | null;
    rationale: string;
    issues: string[];
    promptTokens: number | null;
    completionTokens: number | null;
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

describe.skipIf(!HAS_API_KEY)('Feature 147 Sprint 1: cross-LLM jury SDK smoke', () => {
  it('callJudgeViaSdk: real haiku call → 解析 JSON → 返回 score + usage', async () => {
    const { callJudgeViaSdk } = await loadJury();
    const r = await callJudgeViaSdk({
      model: 'claude-haiku-4-5-20251001',
      prompt: MINIMAL_JUDGE_PROMPT,
    });
    expect(r.judge).toBe('claude-haiku-4-5-20251001');
    expect(typeof r.score).toBe('number');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(10);
    expect(typeof r.rationale).toBe('string');
    expect(r.rationale.length).toBeGreaterThan(0);
    expect(Array.isArray(r.issues)).toBe(true);
    // SDK shape sanity (catch v0.39 → vNext breaking changes)
    expect(r.promptTokens).toBeGreaterThan(0);
    expect(r.completionTokens).toBeGreaterThan(0);
  }, 60000);
});
