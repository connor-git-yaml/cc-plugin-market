import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface PricingResult {
  cost: number | null;
  source: string | null;
  tier: string | null;
}

interface FixtureLike {
  taskExecution?: {
    executor?: string;
    executorPromptTokens?: number | null;
    executorCompletionTokens?: number | null;
    costUsd?: number | null;
    costUsdSource?: string;
    costUsdTier?: string;
  };
}

interface PricingModule {
  estimateCost: (usage: { inputTokens: number | null; outputTokens: number | null }, modelKey: string) => PricingResult;
  backfillTaskFixtureCost: (fx: FixtureLike) => FixtureLike;
  PRICING_TABLE: Record<string, { inputPerM: number; outputPerM: number; tier: string; source: string }>;
}

async function loadPricing(): Promise<PricingModule> {
  const url = pathToFileURL(resolve('scripts/lib/llm-pricing.mjs')).href;
  return (await import(url)) as PricingModule;
}

describe('llm-pricing (Sprint 3 Phase B.2)', () => {
  it('estimates GLM-5.1 cost from token usage with estimate tier', async () => {
    const { estimateCost } = await loadPricing();
    const result = estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'siliconflow:Pro/zai-org/GLM-5.1');
    expect(result.cost).toBeGreaterThan(0);
    expect(result.cost).toBeLessThan(10);
    expect(result.tier).toBe('estimate');
    expect(result.source).toMatch(/siliconflow/i);
  });

  it('returns null cost for unknown model', async () => {
    const { estimateCost } = await loadPricing();
    const result = estimateCost({ inputTokens: 100, outputTokens: 100 }, 'unknown:fake-model');
    expect(result.cost).toBeNull();
    expect(result.tier).toBe('unknown-model');
  });

  it('returns null when usage is missing', async () => {
    const { estimateCost } = await loadPricing();
    const result = estimateCost({ inputTokens: null, outputTokens: null }, 'siliconflow:Pro/zai-org/GLM-5.1');
    expect(result.cost).toBeNull();
  });

  it('backfills costUsd into fixture only when previously null', async () => {
    const { backfillTaskFixtureCost } = await loadPricing();
    const fx: FixtureLike = {
      taskExecution: {
        executor: 'siliconflow:Pro/zai-org/GLM-5.1',
        executorPromptTokens: 2000,
        executorCompletionTokens: 1000,
        costUsd: null,
      },
    };
    const patched = backfillTaskFixtureCost(fx);
    expect(patched.taskExecution?.costUsd).not.toBeNull();
    expect(patched.taskExecution?.costUsd).toBeGreaterThan(0);
    expect(patched.taskExecution?.costUsdTier).toBe('estimate');
    expect(patched.taskExecution?.costUsdSource).toMatch(/siliconflow/i);
  });

  it('does not overwrite existing costUsd', async () => {
    const { backfillTaskFixtureCost } = await loadPricing();
    const fx: FixtureLike = {
      taskExecution: {
        executor: 'siliconflow:Pro/zai-org/GLM-5.1',
        executorPromptTokens: 2000,
        executorCompletionTokens: 1000,
        costUsd: 0.0099, // 已有真实数据
      },
    };
    const patched = backfillTaskFixtureCost(fx);
    expect(patched.taskExecution?.costUsd).toBe(0.0099);
    expect(patched.taskExecution?.costUsdTier).toBeUndefined();
  });
});
