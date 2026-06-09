/**
 * Feature 176 — cross-cohort 聚合纯逻辑单测（tasks T-D5）。
 * 验证：oracle-only passRate（ORACLE-UNAVAILABLE 剔除）、lift、c3_vs_c4、
 * token-per-completed-task（TOKENS-UNAVAILABLE 剔除）、fixture matrix。
 */
import { describe, expect, it } from 'vitest';
import { aggregateCohorts, cohortStats, buildFixtureMatrix, bootstrapProportionCi } from '../../scripts/lib/cohort-aggregate.mjs';
import { createSeededRng } from '../../scripts/lib/bootstrap-ci.mjs';

function run(cohort: string, taskId: string, repeatIndex: number, oraclePassed: boolean | null, tokens: number | null) {
  return { cohort, taskId, repeatIndex, oraclePassed, tokens };
}

describe('bootstrapProportionCi (mean, not median — codex CRITICAL)', () => {
  it('0/1 样本的 CI bracket passRate（median helper 会恒返 0/1，这里必须是比例）', () => {
    const samples = [1, 1, 1, 0, 0, 0, 1, 0, 1, 0]; // passRate 0.5
    const ci = bootstrapProportionCi(samples, { rng: createSeededRng(176) });
    expect(ci.method).toBe('percentile-mean');
    expect(ci.low).toBeGreaterThan(0);
    expect(ci.high).toBeLessThan(1);
    expect(ci.low).toBeLessThanOrEqual(0.5);
    expect(ci.high).toBeGreaterThanOrEqual(0.5);
  });
  it('N<3 → insufficient-samples', () => {
    expect(bootstrapProportionCi([1, 0], {}).reason).toBe('insufficient-samples');
  });
});

describe('cohortStats', () => {
  it('passRate 只数 oracle 可得的 run，ORACLE-UNAVAILABLE 剔除分母', () => {
    const runs = [
      run('baseline-claude', 't1', 1, true, 100),
      run('baseline-claude', 't1', 2, false, 100),
      run('baseline-claude', 't1', 3, null, null), // ORACLE-UNAVAILABLE
    ];
    const s = cohortStats(runs, 'baseline-claude', { rng: createSeededRng(1) });
    expect(s.oracleAvailableCount).toBe(2);
    expect(s.oracleUnavailableCount).toBe(1);
    expect(s.passRate).toBe(0.5);
  });

  it('token-per-completed-task 仅对 oracle-pass 且 tokens 可得的 run 求均，TOKENS-UNAVAILABLE 剔除', () => {
    const runs = [
      run('spec-driver-spectra-mcp', 't1', 1, true, 200),
      run('spec-driver-spectra-mcp', 't1', 2, true, null), // pass 但 TOKENS-UNAVAILABLE
      run('spec-driver-spectra-mcp', 't1', 3, false, 999), // fail 不计入 completed
    ];
    const s = cohortStats(runs, 'spec-driver-spectra-mcp', { rng: createSeededRng(1) });
    expect(s.passCount).toBe(2);
    expect(s.tokenPerCompletedTask).toBe(200); // 只有 1 个 pass-with-tokens
    expect(s.tokensUnavailableCount).toBe(1);
  });

  it('N<3 时 CI 返回 insufficient-samples', () => {
    const runs = [run('GStack', 't1', 1, true, 10), run('GStack', 't1', 2, false, 10)];
    const s = cohortStats(runs, 'GStack', { rng: createSeededRng(1) });
    expect(s.ci95.reason).toBe('insufficient-samples');
  });

  it('jury 字段绝不污染 passRate（KD-2 防回归，codex INFO）', () => {
    // oracle fail 但带 juryPassed=true / juryScore 高 → passRate 仍只数 oracle
    const runs = [
      { cohort: 'spec-driver', taskId: 't1', repeatIndex: 1, oraclePassed: false, tokens: 1, juryPassed: true, juryScore: 9 },
      { cohort: 'spec-driver', taskId: 't1', repeatIndex: 2, oraclePassed: false, tokens: 1, juryPassed: true, juryScore: 10 },
      { cohort: 'spec-driver', taskId: 't1', repeatIndex: 3, oraclePassed: true, tokens: 1, juryPassed: false, juryScore: 1 },
    ];
    const s = cohortStats(runs as any, 'spec-driver', { rng: createSeededRng(1) });
    expect(s.passRate).toBeCloseTo(1 / 3, 5); // 只有 1 个 oracle pass，jury 不影响
  });
});

describe('aggregateCohorts', () => {
  const runs = [
    // c1 baseline: 1/3 pass
    run('baseline-claude', 't1', 1, true, 100), run('baseline-claude', 't1', 2, false, 100), run('baseline-claude', 't1', 3, false, 100),
    // c3 spectra-mcp: 3/3 pass → lift = 1.0/0.333 = 3x
    run('spec-driver-spectra-mcp', 't1', 1, true, 50), run('spec-driver-spectra-mcp', 't1', 2, true, 50), run('spec-driver-spectra-mcp', 't1', 3, true, 50),
    // c4 superpowers: 2/3 pass
    run('SuperPowers', 't1', 1, true, 80), run('SuperPowers', 't1', 2, true, 80), run('SuperPowers', 't1', 3, false, 80),
  ];

  it('lift = c3/c1（directional）', () => {
    const agg = aggregateCohorts(runs, { rng: createSeededRng(176) });
    expect(agg.lift).toBeCloseTo(3.0, 5);
    expect(agg.internalCohortOnly).toBe(true);
  });

  it('c3_vs_c4：diff + c3AtLeastC4', () => {
    const agg = aggregateCohorts(runs, { rng: createSeededRng(176) });
    expect(agg.c3_vs_c4!.c3PassRate).toBe(1);
    expect(agg.c3_vs_c4!.c4PassRate).toBeCloseTo(2 / 3, 5);
    expect(agg.c3_vs_c4!.c3AtLeastC4).toBe(true);
  });

  it('token ratio c3/c1 directional（50/100=0.5，省 token）', () => {
    const agg = aggregateCohorts(runs, { rng: createSeededRng(176) });
    expect(agg.tokenRatioC3overC1).toBeCloseTo(0.5, 5);
  });

  it('lift=null 当 c1 passRate=0（避免除零 over-claim）', () => {
    const r2 = [
      run('baseline-claude', 't1', 1, false, 1), run('baseline-claude', 't1', 2, false, 1), run('baseline-claude', 't1', 3, false, 1),
      run('spec-driver-spectra-mcp', 't1', 1, true, 1), run('spec-driver-spectra-mcp', 't1', 2, true, 1), run('spec-driver-spectra-mcp', 't1', 3, true, 1),
    ];
    expect(aggregateCohorts(r2, { rng: createSeededRng(176) }).lift).toBeNull();
  });
});

describe('buildFixtureMatrix', () => {
  it('task × cohort 的 pass/total 明细', () => {
    const runs = [
      run('baseline-claude', 't1', 1, true, 1), run('baseline-claude', 't1', 2, false, 1),
      run('baseline-claude', 't2', 1, null, null), // 不计入 total
    ];
    const m = buildFixtureMatrix(runs, ['baseline-claude']);
    expect(m.t1['baseline-claude']).toEqual({ pass: 1, total: 2 });
    expect(m.t2['baseline-claude']).toEqual({ pass: 0, total: 0 }); // ORACLE-UNAVAILABLE 剔除
  });
});
