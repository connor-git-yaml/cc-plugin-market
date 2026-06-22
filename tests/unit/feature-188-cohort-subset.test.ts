/**
 * Feature 188 — cohort 子集（manifest.cohorts）单测。
 *
 * 用户约定：cohort 触发率/完成率对比默认只跑 c1/c3 最小集（60 runs），不跑全 5（150）。
 * 验证 resolveCohorts 解析 + buildRunMatrix 按子集裁剪，且向后兼容（默认全 5）。
 */
import { describe, expect, it } from 'vitest';
import { resolveCohorts, buildRunMatrix } from '../../scripts/swe-bench-verified-cohort-batch.mjs';
import { COHORT_IDS } from '../../scripts/lib/cohort-aggregate.mjs';

describe('resolveCohorts（manifest.cohorts 解析）', () => {
  it('null/缺省 → 全 5 cohort（向后兼容）', () => {
    expect(resolveCohorts(undefined)).toEqual(COHORT_IDS);
    expect(resolveCohorts({})).toEqual(COHORT_IDS);
    expect(resolveCohorts({ cohorts: null })).toEqual(COHORT_IDS);
  });
  it('c1/c3 子集 → 仅这两组（保持 registry 顺序）', () => {
    const sub = resolveCohorts({ cohorts: ['spec-driver-spectra-mcp', 'baseline-claude'] });
    expect(sub).toEqual(['baseline-claude', 'spec-driver-spectra-mcp']); // registry 顺序，非输入顺序
  });
  it('非法 cohort id → throw', () => {
    expect(() => resolveCohorts({ cohorts: ['baseline-claude', 'bogus-cohort'] })).toThrow(/非法 cohort/);
  });
  it('空数组 → throw（拒绝静默跑零组）', () => {
    expect(() => resolveCohorts({ cohorts: [] })).toThrow(/非空数组/);
  });
});

describe('buildRunMatrix（cohort 子集裁剪）', () => {
  const tasks = ['T1', 'T2', 'T3'];
  it('默认全 5 cohort：tasks × 5 × repeats', () => {
    const m = buildRunMatrix('full', tasks, null, 3);
    expect(m.length).toBe(3 * 5 * 3); // 45
    expect(new Set(m.map((x) => x.cohort)).size).toBe(5);
  });
  it('c1/c3 子集：tasks × 2 × repeats（最小集口径）', () => {
    const c13 = ['baseline-claude', 'spec-driver-spectra-mcp'];
    const m = buildRunMatrix('full', tasks, null, 3, c13);
    expect(m.length).toBe(3 * 2 * 3); // 18；10 task 时 = 60
    expect(new Set(m.map((x) => x.cohort))).toEqual(new Set(c13));
  });
  it('10 task × c1/c3 × N=3 = 60 runs（用户标准）', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `SWE-V${String(i + 1).padStart(3, '0')}`);
    const m = buildRunMatrix('full', ten, null, 3, ['baseline-claude', 'spec-driver-spectra-mcp']);
    expect(m.length).toBe(60);
  });
});
