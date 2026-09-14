/**
 * M11 卡 E：baseline-collect 的成本口径——缓存创建 1.25×、缓存读取 0.1×，不再把 cache_read 按全价计。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBatchSummary, estimateCostUsd } from '../../scripts/baseline-collect.mjs';

const summaryWith = (rows: string) => {
  const p = join(mkdtempSync(join(tmpdir(), 'pg-bs-')), 'batch-summary-1.md');
  writeFileSync(p, `## LLM 成本汇总\n\n| 指标 | 数值 |\n|------|------|\n${rows}\n`);
  return p;
};

describe('baseline-collect 成本口径（M11 卡 E）', () => {
  it('parseBatchSummary 读出 cache_creation / cache_read 两行；缺行时为 null', () => {
    const withCache = parseBatchSummary(summaryWith('| 总 input tokens | 70,000 |\n| 总 output tokens | 4,000 |\n| 总 cache_creation tokens | 40,000 |\n| 总 cache_read tokens | 26,000 |'));
    expect(withCache.tokensInput).toBe(70000);
    expect(withCache.tokensCacheCreation).toBe(40000);
    expect(withCache.tokensCacheRead).toBe(26000);
    const legacy = parseBatchSummary(summaryWith('| 总 input tokens | 70,000 |\n| 总 output tokens | 4,000 |'));
    expect(legacy.tokensCacheCreation).toBeNull();
    expect(legacy.tokensCacheRead).toBeNull();
  });

  it('parseBatchSummary 读出「CLI 报告成本 (USD)」行为 reportedCostUsd；缺行时为 null', () => {
    const withReported = parseBatchSummary(summaryWith('| 总 input tokens | 70,000 |\n| 总 output tokens | 4,000 |\n| CLI 报告成本 (USD) | 0.234517 |'));
    expect(withReported.reportedCostUsd).toBe(0.234517);
    const partial = parseBatchSummary(summaryWith('| 总 input tokens | 70,000 |\n| 总 output tokens | 4,000 |\n| CLI 报告成本 (USD) | 0.500000（1/2 个模块有报告） |'));
    expect(partial.reportedCostUsd).toBe(0.5);
    expect(parseBatchSummary(summaryWith('| 总 input tokens | 70,000 |\n| 总 output tokens | 4,000 |')).reportedCostUsd).toBeNull();
  });

  it('estimateCostUsd：有 CLI 报告成本且覆盖全部模块时直接采用（真值，含正确的缓存 TTL 定价），不看模型名', () => {
    expect(estimateCostUsd({ tokensInput: 70000, tokensOutput: 4000, tokensCacheCreation: 40000, tokensCacheRead: 26000, reportedCostUsd: 0.234517 }, 'claude-sonnet-4-6')).toBe(0.234517);
    expect(estimateCostUsd({ tokensInput: 1, tokensOutput: 1, reportedCostUsd: 0.7 }, 'claude-opus-5')).toBe(0.7);
    expect(estimateCostUsd({ tokensInput: 1, tokensOutput: 1, reportedCostUsd: 0.7, reportedCostCoverage: { covered: 3, total: 3, full: true } }, 'claude-opus-5')).toBe(0.7);
  });

  it('estimateCostUsd 覆盖率闸门（delta 复审 C-Δ2）：报告只盖住部分模块时不当整批真值，退回公式；0 / NaN 也不是真值', () => {
    const stats = { tokensInput: 70000, tokensOutput: 4000, tokensCacheCreation: 40000, tokensCacheRead: 26000 };
    expect(estimateCostUsd({ ...stats, reportedCostUsd: 0.01, reportedCostCoverage: { covered: 1, total: 50, full: false } }, 'claude-sonnet-4-6')).toBeCloseTo(0.32, 2);
    expect(estimateCostUsd({ ...stats, reportedCostUsd: 0 }, 'claude-sonnet-4-6')).toBeCloseTo(0.32, 2);
    expect(estimateCostUsd({ ...stats, reportedCostUsd: NaN }, 'claude-sonnet-4-6')).toBeCloseTo(0.32, 2);
    // 部分覆盖 + 非 sonnet 模型：公式也不适用 ⇒ null（诚实缺席，而不是把子集成本当整批）
    expect(estimateCostUsd({ ...stats, reportedCostUsd: 0.01, reportedCostCoverage: { covered: 1, total: 50, full: false } }, 'claude-opus-5')).toBeNull();
  });

  it('parseBatchSummary 解析覆盖率注解：无注解 = 全覆盖；「（1/2 个模块有报告）」= 部分；无该行 = null', () => {
    expect(parseBatchSummary(summaryWith('| 总 input tokens | 1 |\n| 总 output tokens | 1 |\n| CLI 报告成本 (USD) | 0.5 |')).reportedCostCoverage).toEqual({ covered: null, total: null, full: true });
    expect(parseBatchSummary(summaryWith('| 总 input tokens | 1 |\n| 总 output tokens | 1 |\n| CLI 报告成本 (USD) | 0.500000（1/2 个模块有报告） |')).reportedCostCoverage).toEqual({ covered: 1, total: 2, full: false });
    expect(parseBatchSummary(summaryWith('| 总 input tokens | 1 |\n| 总 output tokens | 1 |')).reportedCostCoverage).toBeNull();
    // 非数值形态（n/a）→ NaN 不会被当真值
    expect(Number.isNaN(parseBatchSummary(summaryWith('| 总 input tokens | 1 |\n| 总 output tokens | 1 |\n| CLI 报告成本 (USD) | n/a |')).reportedCostUsd)).toBe(true);
  });

  it('estimateCostUsd 回退公式：fresh = input − creation − read，缓存创建按 1 小时档 2×（Claude Code 2.1.270 的缓存写入全落 ephemeral_1h），即 3 / 6 / 0.30 / 15 美元每百万 token', () => {
    // fresh 4,000 × 3 + creation 40,000 × 6 + read 26,000 × 0.30 + output 4,000 × 15 = 0.012 + 0.24 + 0.0078 + 0.06 = 0.3198
    const cost = estimateCostUsd({ tokensInput: 70000, tokensOutput: 4000, tokensCacheCreation: 40000, tokensCacheRead: 26000, reportedCostUsd: null }, 'claude-sonnet-4-6');
    expect(cost).toBeCloseTo(0.32, 2);
  });

  it('estimateCostUsd 回退公式：没有 cache 字段时全部 input 按全价；口径自相矛盾（input < creation + read）→ null 而不是静默夹成 0', () => {
    expect(estimateCostUsd({ tokensInput: 70000, tokensOutput: 4000, tokensCacheCreation: null, tokensCacheRead: null }, 'claude-sonnet-4-6')).toBe(0.27);
    expect(estimateCostUsd({ tokensInput: 100, tokensOutput: 4000, tokensCacheCreation: 90, tokensCacheRead: 20 }, 'claude-sonnet-4-6')).toBeNull();
    expect(estimateCostUsd({ tokensInput: null, tokensOutput: 4000 }, 'claude-sonnet-4-6')).toBeNull();
    expect(estimateCostUsd({ tokensInput: 1, tokensOutput: 1 }, 'claude-opus-5')).toBeNull();
  });
});
