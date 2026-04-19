/**
 * Feature 127: batch 成本聚合 + 渲染测试
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateCostSummary,
  renderSummaryCostSection,
  renderQualityCostSection,
  type ModuleCostRecord,
} from '../../src/batch/cost-summary.js';

function makeRecord(
  moduleName: string,
  input: number,
  output: number,
  opts: {
    durationMs?: number;
    llmModel?: string;
    fallbackReason?: string | null;
    loc?: number;
  } = {},
): ModuleCostRecord {
  return {
    moduleName,
    loc: opts.loc ?? 100,
    cost: {
      tokenUsage: { input, output },
      durationMs: opts.durationMs ?? 1000,
      llmModel: opts.llmModel ?? 'claude-opus-4-7',
      fallbackReason: opts.fallbackReason ?? null,
    },
  };
}

describe('aggregateCostSummary', () => {
  it('空输入时返回全零 summary', () => {
    const s = aggregateCostSummary([]);
    expect(s.totalInputTokens).toBe(0);
    expect(s.totalOutputTokens).toBe(0);
    expect(s.totalDurationMs).toBe(0);
    expect(s.byModule).toEqual([]);
    expect(s.byGenerator).toEqual([]);
  });

  it('正常聚合：模块按 token 数降序', () => {
    const records = [
      makeRecord('small', 100, 30),
      makeRecord('big', 10000, 3000),
      makeRecord('mid', 1000, 300),
    ];
    const s = aggregateCostSummary(records);
    expect(s.totalInputTokens).toBe(11100);
    expect(s.totalOutputTokens).toBe(3330);
    expect(s.byModule[0]!.moduleName).toBe('big');
    expect(s.byModule[1]!.moduleName).toBe('mid');
    expect(s.byModule[2]!.moduleName).toBe('small');
  });

  it('按生成器分组：不同 llmModel 各自聚合', () => {
    const records = [
      makeRecord('a', 1000, 300, { llmModel: 'claude-opus-4-7' }),
      makeRecord('b', 500, 150, { llmModel: 'claude-opus-4-7' }),
      makeRecord('c', 200, 60, { llmModel: 'claude-sonnet-4-6' }),
    ];
    const s = aggregateCostSummary(records);
    expect(s.byGenerator).toHaveLength(2);
    const opus = s.byGenerator.find((g) => g.generator === 'claude-opus-4-7')!;
    expect(opus.moduleCount).toBe(2);
    expect(opus.input).toBe(1500);
    // 占比 = (1500+450) / (1500+450+200+60) = 1950 / 2210 ≈ 88.2%
    expect(opus.share).toBeCloseTo(88.2, 1);
  });

  it('AST-only 降级模块归入 "ast-only" 生成器', () => {
    const records = [
      makeRecord('good', 1000, 300, { llmModel: 'claude-opus-4-7' }),
      makeRecord('fallback', 0, 0, {
        llmModel: '',
        fallbackReason: 'LLM 不可用',
        durationMs: 0,
      }),
    ];
    const s = aggregateCostSummary(records);
    expect(s.byGenerator.find((g) => g.generator === 'ast-only')).toBeDefined();
    expect(s.byModule.find((m) => m.moduleName === 'fallback')?.fallbackReason).toBe(
      'LLM 不可用',
    );
  });

  it('预估对比：actualVsEstimatedDelta 偏差计算正确', () => {
    const records = [makeRecord('a', 1000, 300)];
    const estimated = { totalInput: 800, totalOutput: 200, assumption: 'output ≈ 0.3 × input' };
    const s = aggregateCostSummary(records, estimated);
    // actual=1300, est=1000 → delta = (1300-1000)/1000 = 30%
    expect(s.actualVsEstimatedDelta).toBe(30);
  });
});

describe('renderSummaryCostSection', () => {
  it('零成本时输出降级说明', () => {
    const s = aggregateCostSummary([]);
    const md = renderSummaryCostSection(s);
    expect(md).toContain('LLM 成本汇总');
    expect(md).toContain('未调用 LLM');
  });

  it('正常场景包含总表、按生成器、按模块', () => {
    const records = [
      makeRecord('auth', 5000, 1500, { loc: 300 }),
      makeRecord('api', 2000, 600, { loc: 200 }),
    ];
    const s = aggregateCostSummary(records);
    const md = renderSummaryCostSection(s);
    expect(md).toContain('总 input tokens');
    expect(md).toContain('按生成器分组');
    expect(md).toContain('按模块分组');
    expect(md).toContain('auth');
    expect(md).toContain('api');
    expect(md).toContain('tokens / kLOC');
  });

  it('预估偏差 > 20% 时带 warning', () => {
    const records = [makeRecord('a', 1500, 500)];
    const estimated = { totalInput: 800, totalOutput: 200, assumption: 'x' };
    const s = aggregateCostSummary(records, estimated);
    const md = renderSummaryCostSection(s);
    expect(md).toContain('偏差');
    expect(md).toContain('估算模型需调整');
  });
});

describe('renderQualityCostSection', () => {
  it('零成本时输出"成本为 0"', () => {
    const s = aggregateCostSummary([]);
    const md = renderQualityCostSection(s);
    expect(md).toContain('LLM 成本与预算');
    expect(md).toContain('成本为 0');
  });

  it('正常场景含性价比 tokens/kLOC', () => {
    const records = [makeRecord('a', 1000, 300, { loc: 500 })];
    const s = aggregateCostSummary(records);
    const md = renderQualityCostSection(s);
    expect(md).toContain('性价比');
    expect(md).toContain('tokens / kLOC');
  });

  it('偏差 > 20% 时追加可靠性低告警', () => {
    const records = [makeRecord('a', 1500, 500)];
    const estimated = { totalInput: 500, totalOutput: 150, assumption: 'x' };
    const s = aggregateCostSummary(records, estimated);
    const md = renderQualityCostSection(s);
    expect(md).toContain('估算可靠性低');
  });
});
