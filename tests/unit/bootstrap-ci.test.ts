import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface BootstrapResult {
  low: number | null;
  high: number | null;
  b: number;
  samples: number;
  method: 'percentile';
  reason?: string;
}

interface BootstrapModule {
  bootstrapPercentileCi: (
    samples: number[],
    opts?: { b?: number; alpha?: number; rng?: () => number },
  ) => BootstrapResult;
  createSeededRng: (seed: number) => () => number;
}

async function loadModule(): Promise<BootstrapModule> {
  const url = pathToFileURL(resolve('scripts/lib/bootstrap-ci.mjs')).href;
  return (await import(url)) as BootstrapModule;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

describe('bootstrapPercentileCi', () => {
  describe('insufficient samples', () => {
    it('N=1 returns insufficient-samples reason', async () => {
      const { bootstrapPercentileCi } = await loadModule();
      const r = bootstrapPercentileCi([7]);
      expect(r.low).toBeNull();
      expect(r.high).toBeNull();
      expect(r.reason).toBe('insufficient-samples');
      expect(r.samples).toBe(1);
      expect(r.method).toBe('percentile');
    });

    it('N=2 returns insufficient-samples reason', async () => {
      const { bootstrapPercentileCi } = await loadModule();
      const r = bootstrapPercentileCi([7, 8]);
      expect(r.low).toBeNull();
      expect(r.high).toBeNull();
      expect(r.reason).toBe('insufficient-samples');
      expect(r.samples).toBe(2);
    });

    it('N=0 (empty) returns insufficient-samples reason', async () => {
      const { bootstrapPercentileCi } = await loadModule();
      const r = bootstrapPercentileCi([]);
      expect(r.low).toBeNull();
      expect(r.high).toBeNull();
      expect(r.reason).toBe('insufficient-samples');
      expect(r.samples).toBe(0);
    });
  });

  describe('normal cases', () => {
    it('N=3 [6,7,8] with seeded rng returns interval containing median', async () => {
      const { bootstrapPercentileCi, createSeededRng } = await loadModule();
      const samples = [6, 7, 8];
      const r = bootstrapPercentileCi(samples, { rng: createSeededRng(42), b: 1000 });
      expect(r.low).not.toBeNull();
      expect(r.high).not.toBeNull();
      const med = median(samples);
      expect(r.low!).toBeLessThanOrEqual(med);
      expect(r.high!).toBeGreaterThanOrEqual(med);
      expect(r.samples).toBe(3);
      expect(r.b).toBe(1000);
    });

    it('N=5 all-same returns degenerate interval (low === high === sample[0])', async () => {
      const { bootstrapPercentileCi } = await loadModule();
      const r = bootstrapPercentileCi([7, 7, 7, 7, 7]);
      expect(r.low).toBe(7);
      expect(r.high).toBe(7);
      expect(r.reason).toBeUndefined();
    });

    it('N=5 with outlier produces non-zero width interval', async () => {
      const { bootstrapPercentileCi, createSeededRng } = await loadModule();
      const r = bootstrapPercentileCi([6, 7, 7, 7, 9], { rng: createSeededRng(123), b: 1000 });
      expect(r.low).not.toBeNull();
      expect(r.high).not.toBeNull();
      expect(r.high! - r.low!).toBeGreaterThan(0);
      const med = median([6, 7, 7, 7, 9]);
      expect(r.low!).toBeLessThanOrEqual(med);
      expect(r.high!).toBeGreaterThanOrEqual(med);
    });
  });

  describe('invariant: low <= median(samples) <= high', () => {
    it('holds for 5 random N>=3 inputs with different seeds', async () => {
      const { bootstrapPercentileCi, createSeededRng } = await loadModule();
      const cases: number[][] = [
        [4, 5, 6, 7, 8],
        [2, 5, 8, 9, 10],
        [5.5, 6.0, 7.5, 8.0, 8.5],
        [1, 1, 5, 9, 9],
        [3, 4, 4, 5, 6, 7, 8, 9, 10],
      ];
      for (let i = 0; i < cases.length; i++) {
        const samples = cases[i];
        const med = median(samples);
        const r = bootstrapPercentileCi(samples, { rng: createSeededRng(1000 + i), b: 500 });
        expect(r.low).not.toBeNull();
        expect(r.high).not.toBeNull();
        expect(r.low!).toBeLessThanOrEqual(med);
        expect(r.high!).toBeGreaterThanOrEqual(med);
      }
    });
  });

  describe('b parameter', () => {
    it('B=100 vs B=1000 同输入 + 同 seed 仍返回合理区间', async () => {
      const { bootstrapPercentileCi, createSeededRng } = await loadModule();
      const samples = [5, 6, 7, 8, 9];
      const small = bootstrapPercentileCi(samples, { b: 100, rng: createSeededRng(7) });
      const large = bootstrapPercentileCi(samples, { b: 1000, rng: createSeededRng(7) });
      expect(small.b).toBe(100);
      expect(large.b).toBe(1000);
      const med = median(samples);
      expect(small.low!).toBeLessThanOrEqual(med);
      expect(small.high!).toBeGreaterThanOrEqual(med);
      expect(large.low!).toBeLessThanOrEqual(med);
      expect(large.high!).toBeGreaterThanOrEqual(med);
    });

    it('rejects b < 1', async () => {
      const { bootstrapPercentileCi } = await loadModule();
      expect(() => bootstrapPercentileCi([1, 2, 3], { b: 0 })).toThrow(TypeError);
    });
  });

  describe('alpha parameter', () => {
    it('alpha=0.10 (90% CI) typically narrower than alpha=0.05 (95% CI)', async () => {
      const { bootstrapPercentileCi, createSeededRng } = await loadModule();
      const samples = [3, 5, 6, 7, 8, 9, 12];
      const ci95 = bootstrapPercentileCi(samples, { alpha: 0.05, rng: createSeededRng(99), b: 1000 });
      const ci90 = bootstrapPercentileCi(samples, { alpha: 0.10, rng: createSeededRng(99), b: 1000 });
      expect(ci95.high! - ci95.low!).toBeGreaterThanOrEqual(ci90.high! - ci90.low!);
    });

    it('rejects alpha out of (0, 1)', async () => {
      const { bootstrapPercentileCi } = await loadModule();
      expect(() => bootstrapPercentileCi([1, 2, 3], { alpha: 0 })).toThrow(TypeError);
      expect(() => bootstrapPercentileCi([1, 2, 3], { alpha: 1 })).toThrow(TypeError);
    });
  });

  describe('input validation', () => {
    it('throws on NaN input', async () => {
      const { bootstrapPercentileCi } = await loadModule();
      expect(() => bootstrapPercentileCi([NaN, 7, 7])).toThrow(TypeError);
    });

    it('throws on Infinity input', async () => {
      const { bootstrapPercentileCi } = await loadModule();
      expect(() => bootstrapPercentileCi([Infinity, 7, 7])).toThrow(TypeError);
    });

    it('throws on non-array input', async () => {
      const { bootstrapPercentileCi } = await loadModule();
      // @ts-expect-error 故意传非数组
      expect(() => bootstrapPercentileCi('not-array')).toThrow(TypeError);
    });

    it('throws on non-function rng', async () => {
      const { bootstrapPercentileCi } = await loadModule();
      // @ts-expect-error 故意传非函数
      expect(() => bootstrapPercentileCi([1, 2, 3], { rng: 'not-fn' })).toThrow(TypeError);
    });
  });
});
