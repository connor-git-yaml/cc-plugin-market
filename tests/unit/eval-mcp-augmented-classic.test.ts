import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface BootstrapResult {
  passRate: number;
  ci95Lower: number | null;
  ci95Upper: number | null;
  repeats: number;
  b: number;
  method: string;
  reason?: string | null;
}

interface MaModule {
  parseArgs: (argv: string[]) => {
    tasks: string[] | null;
    cohorts: string[] | null;
    repeats: number;
    dryRun: boolean;
    concurrency: number;
    force: boolean;
  };
  aggregateBootstrap: (samples: Array<boolean | number>, opts?: { b?: number; alpha?: number }) => BootstrapResult;
}

let cached: MaModule | undefined;
async function loadMod(): Promise<MaModule> {
  if (cached) return cached;
  cached = (await import(pathToFileURL(resolve('scripts/eval-mcp-augmented-classic.mjs')).href)) as MaModule;
  return cached;
}

describe('eval-mcp-augmented.parseArgs', () => {
  it('parses --task,--cohort all,--repeats', async () => {
    const { parseArgs } = await loadMod();
    const r = parseArgs(['--task', 'T158-x,T158-y', '--cohort', 'all', '--repeats', '3']);
    expect(r.tasks).toEqual(['T158-x', 'T158-y']);
    expect(r.cohorts).toEqual(['control', 'spectra-push', 'spectra-mcp-pull']);
    expect(r.repeats).toBe(3);
    expect(r.dryRun).toBe(false);
  });

  it('parses --cohort 单一 cohort', async () => {
    const { parseArgs } = await loadMod();
    const r = parseArgs(['--task', 'T158-x', '--cohort', 'control', '--repeats', '1']);
    expect(r.cohorts).toEqual(['control']);
  });

  it('--concurrency != 1 抛错（WARNING 1 修复）', async () => {
    const { parseArgs } = await loadMod();
    expect(() => parseArgs(['--task', 'X', '--cohort', 'all', '--concurrency', '2'])).toThrow(/concurrency/);
  });

  it('未知 cohort 抛错', async () => {
    const { parseArgs } = await loadMod();
    expect(() => parseArgs(['--task', 'X', '--cohort', 'unknown'])).toThrow(/unknown cohort/);
  });

  it('缺 --task 抛错', async () => {
    const { parseArgs } = await loadMod();
    expect(() => parseArgs(['--cohort', 'all', '--repeats', '1'])).toThrow(/task/);
  });

  it('parses --dry-run / --force', async () => {
    const { parseArgs } = await loadMod();
    const r = parseArgs(['--task', 'X', '--cohort', 'control', '--dry-run', '--force']);
    expect(r.dryRun).toBe(true);
    expect(r.force).toBe(true);
  });
});

describe('eval-mcp-augmented.aggregateBootstrap (CR-1: bootstrapPercentileCi adapter)', () => {
  it('全 PASS 输入 → passRate=1, ci 边界等于 1', async () => {
    const { aggregateBootstrap } = await loadMod();
    const r = aggregateBootstrap([true, true, true]);
    expect(r.passRate).toBe(1);
    expect(r.ci95Lower).toBe(1);
    expect(r.ci95Upper).toBe(1);
    expect(r.repeats).toBe(3);
  });

  it('全 FAIL 输入 → passRate=0, ci 边界等于 0', async () => {
    const { aggregateBootstrap } = await loadMod();
    const r = aggregateBootstrap([false, false, false]);
    expect(r.passRate).toBe(0);
    expect(r.ci95Lower).toBe(0);
    expect(r.ci95Upper).toBe(0);
  });

  it('混合 0/1 → passRate ∈ (0,1) 且 ci95Lower ≤ ci95Upper 在 [0,1]', async () => {
    const { aggregateBootstrap } = await loadMod();
    const r = aggregateBootstrap([true, false, true]); // pass=2/3
    expect(r.passRate).toBeCloseTo(0.667, 2);
    expect(r.ci95Lower).toBeGreaterThanOrEqual(0);
    expect(r.ci95Upper).toBeLessThanOrEqual(1);
    expect(r.ci95Lower).toBeLessThanOrEqual(r.ci95Upper);
  });

  it('18 sample (CR-1 期望场景：6 task × N=3) → 返回正常 CI', async () => {
    const { aggregateBootstrap } = await loadMod();
    // 18 sample: 12 pass, 6 fail → passRate=2/3
    const samples = Array(12).fill(true).concat(Array(6).fill(false));
    const r = aggregateBootstrap(samples);
    expect(r.passRate).toBeCloseTo(0.667, 2);
    expect(r.repeats).toBe(18);
    expect(r.b).toBe(1000);
    expect(r.ci95Lower).toBeGreaterThan(0.3);
    expect(r.ci95Upper).toBeLessThan(0.95);
    expect(r.ci95Lower).toBeLessThanOrEqual(r.ci95Upper);
  });

  it('空数组 → 标 reason no-samples', async () => {
    const { aggregateBootstrap } = await loadMod();
    const r = aggregateBootstrap([]);
    expect(r.passRate).toBe(0);
    expect(r.ci95Lower).toBeNull();
    expect(r.ci95Upper).toBeNull();
    expect(r.reason).toBe('no-samples');
  });

  it('数值 0/1 输入与 boolean 输入等价', async () => {
    const { aggregateBootstrap } = await loadMod();
    const r1 = aggregateBootstrap([1, 0, 1]);
    const r2 = aggregateBootstrap([true, false, true]);
    expect(r1.passRate).toBe(r2.passRate);
  });

  it('支持自定义 b（小 b 加快测试）', async () => {
    const { aggregateBootstrap } = await loadMod();
    const r = aggregateBootstrap([true, true, false, false], { b: 100 });
    expect(r.b).toBe(100);
  });
});
