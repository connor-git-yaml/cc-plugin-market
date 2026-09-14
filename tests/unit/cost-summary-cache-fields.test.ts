/**
 * M11 卡 E：batch 成本汇总把 cache_creation / cache_read 单列
 * ——CLI 路径下「input」是 input + cache_creation + cache_read 的和，三者单价相差 12.5×，
 * 混在一起既看不出 harness 开销，也让成本估算虚高（缓存读按全价计）。
 */
import { describe, it, expect } from 'vitest';
import { aggregateCostSummary, renderSummaryCostSection } from '../../src/batch/cost-summary.js';

const rec = (name: string, input: number, output: number, cacheCreation?: number, cacheRead?: number) => ({
  moduleName: name,
  loc: 100,
  cost: {
    tokenUsage: { input, output, ...(cacheCreation !== undefined ? { cacheCreation } : {}), ...(cacheRead !== undefined ? { cacheRead } : {}) },
    durationMs: 1000,
    llmModel: 'claude-sonnet-4-6',
    fallbackReason: null,
  },
});

describe('cost-summary：cache 字段单列（M11 卡 E）', () => {
  it('aggregateCostSummary 汇总 cacheCreation / cacheRead；缺字段的记录按 0 计', () => {
    const s = aggregateCostSummary([rec('a', 70000, 4000, 40000, 26000), rec('b', 5000, 500)]);
    expect(s.totalInputTokens).toBe(75000);
    expect(s.totalCacheCreationTokens).toBe(40000);
    expect(s.totalCacheReadTokens).toBe(26000);
  });

  it('renderSummaryCostSection 输出「总 cache_creation tokens」「总 cache_read tokens」两行，供 baseline-collect 解析', () => {
    const md = renderSummaryCostSection(aggregateCostSummary([rec('a', 70000, 4000, 40000, 26000)]));
    expect(md).toMatch(/\| 总 input tokens \| 70,000 \|/);
    expect(md).toMatch(/\| 总 cache_creation tokens \| 40,000 \|/);
    expect(md).toMatch(/\| 总 cache_read tokens \| 26,000 \|/);
  });

  it('没有任何 cache 数据时两行仍输出为 0（机器可读的固定形态，不靠"有没有这一行"传语义）', () => {
    const md = renderSummaryCostSection(aggregateCostSummary([rec('a', 1000, 100)]));
    expect(md).toMatch(/\| 总 cache_creation tokens \| 0 \|/);
    expect(md).toMatch(/\| 总 cache_read tokens \| 0 \|/);
  });
});
