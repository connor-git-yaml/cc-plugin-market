/**
 * M11 卡 E 对抗审查回补（C-1）：Claude Code 自报的 total_cost_usd 是成本真值（已含正确的缓存 TTL 定价），
 * 按模块累加进 costMetadata.reportedCostUsd，再汇总成一行机器可读的「CLI 报告成本 (USD)」。
 */
import { describe, it, expect } from 'vitest';
import { aggregateCostSummary, renderSummaryCostSection, type ModuleCostRecord } from '../../src/batch/cost-summary.js';

function record(moduleName: string, input: number, output: number, reportedCostUsd?: number): ModuleCostRecord {
  return {
    moduleName,
    loc: 10,
    cost: {
      tokenUsage: { input, output },
      durationMs: 100,
      llmModel: 'claude-sonnet-4-6',
      fallbackReason: null,
      ...(reportedCostUsd === undefined ? {} : { reportedCostUsd }),
    },
  };
}

describe('CLI 报告成本汇总', () => {
  it('有报告成本的模块累加为 totalReportedCostUsd，并渲染成「CLI 报告成本 (USD)」行（6 位小数）', () => {
    const summary = aggregateCostSummary([record('a', 100, 10, 0.2345), record('b', 100, 10, 0.1)]);
    expect(summary.totalReportedCostUsd).toBeCloseTo(0.3345, 6);
    const md = renderSummaryCostSection(summary);
    expect(md).toMatch(/\| CLI 报告成本 \(USD\) \| 0\.334500 \|/);
  });

  it('没有任何模块报告成本（SDK / Codex 路径）→ 字段缺席、不渲染该行；部分模块缺席时只累加有值的并标注覆盖数', () => {
    const none = aggregateCostSummary([record('a', 100, 10), record('b', 100, 10)]);
    expect(none.totalReportedCostUsd).toBeUndefined();
    expect(renderSummaryCostSection(none)).not.toMatch(/CLI 报告成本/);

    const partial = aggregateCostSummary([record('a', 100, 10, 0.5), record('b', 100, 10)]);
    expect(partial.totalReportedCostUsd).toBeCloseTo(0.5, 6);
    expect(partial.reportedCostModuleCount).toBe(1);
    expect(renderSummaryCostSection(partial)).toMatch(/\| CLI 报告成本 \(USD\) \| 0\.500000（1\/2 个模块有报告） \|/);
  });
});
