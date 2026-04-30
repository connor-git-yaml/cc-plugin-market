import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

interface DiffResult {
  field: string;
  oldValue: number | null;
  newValue: number | null;
  deltaPct: number | null;
  severity: 'green' | 'yellow' | 'red' | 'na';
}

interface DiffOutput {
  ok: boolean;
  schemaError?: string;
  results: DiffResult[];
  overall: 'pass' | 'warn' | 'fail' | 'schema-mismatch';
}

interface DiffModule {
  parseArgs: (argv: string[]) => {
    oldPath: string;
    newPath: string;
    mode: 'regression' | 'reproducibility';
    format: 'json' | 'text';
    ignoreQuality: boolean;
  };
  diff: (opts: {
    oldPath: string;
    newPath: string;
    mode: 'regression' | 'reproducibility';
    ignoreQuality: boolean;
  }) => DiffOutput;
  loadFixture: (path: string) => Record<string, unknown>;
  REGRESSION_THRESHOLDS: Record<string, { yellowMin?: number; redMin?: number; yellowBelow?: number; redBelow?: number; twoSided?: boolean }>;
  REPRODUCIBILITY_THRESHOLDS: Record<string, { redMin?: number; twoSided?: boolean; exactMatch?: boolean }>;
}

async function loadDiff(): Promise<DiffModule> {
  const url = pathToFileURL(resolve('scripts/baseline-diff.mjs')).href;
  return (await import(url)) as DiffModule;
}

function makeFixture(overrides: Partial<{ schemaVersion: string; perf: Record<string, number>; output: Record<string, number> }>): Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    perf: {
      totalWallMs: 1000,
      tokensInput: 100,
      tokensOutput: 50,
      estimatedCostUsd: 0.1,
    },
    output: {
      graphNodeCount: 100,
      graphEdgeCount: 200,
      specModuleCount: 10,
      specSuccessCount: 10,
    },
    ...overrides,
  };
}

describe('baseline-diff', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'baseline-diff-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeFixture(name: string, content: Record<string, unknown>): string {
    const p = join(tempDir, name);
    writeFileSync(p, JSON.stringify(content));
    return p;
  }

  describe('parseArgs', () => {
    it('requires exactly 2 positional args', async () => {
      const { parseArgs } = await loadDiff();
      expect(() => parseArgs(['old.json'])).toThrow(/expected exactly 2/);
      expect(() => parseArgs(['old.json', 'new.json', 'extra.json'])).toThrow(/expected exactly 2/);
    });

    it('accepts --mode reproducibility / regression', async () => {
      const { parseArgs } = await loadDiff();
      const r = parseArgs(['old.json', 'new.json', '--mode', 'reproducibility']);
      expect(r.mode).toBe('reproducibility');
      const r2 = parseArgs(['old.json', 'new.json', '--mode=regression']);
      expect(r2.mode).toBe('regression');
    });

    it('rejects unknown mode', async () => {
      const { parseArgs } = await loadDiff();
      expect(() => parseArgs(['old.json', 'new.json', '--mode=xxx'])).toThrow(/--mode must be/);
    });
  });

  describe('regression mode', () => {
    it('green when delta within yellow threshold', async () => {
      const { diff } = await loadDiff();
      const oldP = writeFixture('old.json', makeFixture({ perf: { totalWallMs: 1000, tokensInput: 100, tokensOutput: 50, estimatedCostUsd: 0.1 } }));
      const newP = writeFixture('new.json', makeFixture({ perf: { totalWallMs: 1050, tokensInput: 100, tokensOutput: 50, estimatedCostUsd: 0.1 } })); // +5%
      const r = diff({ oldPath: oldP, newPath: newP, mode: 'regression', ignoreQuality: false });
      const wallTime = r.results.find((x) => x.field === 'perf.totalWallMs')!;
      expect(wallTime.severity).toBe('green');
      expect(r.overall).toBe('pass');
    });

    it('yellow when delta in [yellowMin, redMin)', async () => {
      const { diff } = await loadDiff();
      const oldP = writeFixture('old.json', makeFixture({ perf: { totalWallMs: 1000, tokensInput: 100, tokensOutput: 50, estimatedCostUsd: 0.1 } }));
      const newP = writeFixture('new.json', makeFixture({ perf: { totalWallMs: 1150, tokensInput: 100, tokensOutput: 50, estimatedCostUsd: 0.1 } })); // +15%
      const r = diff({ oldPath: oldP, newPath: newP, mode: 'regression', ignoreQuality: false });
      const wallTime = r.results.find((x) => x.field === 'perf.totalWallMs')!;
      expect(wallTime.severity).toBe('yellow');
      expect(r.overall).toBe('warn');
      expect(r.ok).toBe(true);
    });

    it('red when delta > redMin', async () => {
      const { diff } = await loadDiff();
      const oldP = writeFixture('old.json', makeFixture({ perf: { totalWallMs: 1000, tokensInput: 100, tokensOutput: 50, estimatedCostUsd: 0.1 } }));
      const newP = writeFixture('new.json', makeFixture({ perf: { totalWallMs: 1300, tokensInput: 100, tokensOutput: 50, estimatedCostUsd: 0.1 } })); // +30%
      const r = diff({ oldPath: oldP, newPath: newP, mode: 'regression', ignoreQuality: false });
      const wallTime = r.results.find((x) => x.field === 'perf.totalWallMs')!;
      expect(wallTime.severity).toBe('red');
      expect(r.overall).toBe('fail');
      expect(r.ok).toBe(false);
    });

    it('specSuccessRatio uses below-thresholds', async () => {
      const { diff } = await loadDiff();
      const oldP = writeFixture('old.json', makeFixture({ output: { graphNodeCount: 100, graphEdgeCount: 200, specModuleCount: 10, specSuccessCount: 10 } }));
      const newP = writeFixture('new.json', makeFixture({ output: { graphNodeCount: 100, graphEdgeCount: 200, specModuleCount: 10, specSuccessCount: 8 } })); // 80%
      const r = diff({ oldPath: oldP, newPath: newP, mode: 'regression', ignoreQuality: false });
      const ratio = r.results.find((x) => x.field === 'output.specSuccessRatio')!;
      expect(ratio.severity).toBe('red');
    });
  });

  describe('reproducibility mode', () => {
    it('treats +6% wall time as FAIL (>5% threshold)', async () => {
      const { diff } = await loadDiff();
      const oldP = writeFixture('old.json', makeFixture({ perf: { totalWallMs: 1000, tokensInput: 100, tokensOutput: 50, estimatedCostUsd: 0.1 } }));
      const newP = writeFixture('new.json', makeFixture({ perf: { totalWallMs: 1060, tokensInput: 100, tokensOutput: 50, estimatedCostUsd: 0.1 } }));
      const r = diff({ oldPath: oldP, newPath: newP, mode: 'reproducibility', ignoreQuality: false });
      const wallTime = r.results.find((x) => x.field === 'perf.totalWallMs')!;
      expect(wallTime.severity).toBe('red');
      expect(r.overall).toBe('fail');
    });

    it('treats +3% wall time as PASS (within 5%)', async () => {
      const { diff } = await loadDiff();
      const oldP = writeFixture('old.json', makeFixture({ perf: { totalWallMs: 1000, tokensInput: 100, tokensOutput: 50, estimatedCostUsd: 0.1 } }));
      const newP = writeFixture('new.json', makeFixture({ perf: { totalWallMs: 1030, tokensInput: 100, tokensOutput: 50, estimatedCostUsd: 0.1 } }));
      const r = diff({ oldPath: oldP, newPath: newP, mode: 'reproducibility', ignoreQuality: false });
      expect(r.overall).toBe('pass');
    });

    it('exactMatch fields fail on any difference', async () => {
      const { diff } = await loadDiff();
      const oldP = writeFixture('old.json', makeFixture({ output: { graphNodeCount: 100, graphEdgeCount: 200, specModuleCount: 10, specSuccessCount: 10 } }));
      const newP = writeFixture('new.json', makeFixture({ output: { graphNodeCount: 100, graphEdgeCount: 200, specModuleCount: 10, specSuccessCount: 9 } }));
      const r = diff({ oldPath: oldP, newPath: newP, mode: 'reproducibility', ignoreQuality: false });
      const succ = r.results.find((x) => x.field === 'output.specSuccessCount')!;
      expect(succ.severity).toBe('red');
    });
  });

  describe('schema compatibility', () => {
    it('rejects major version mismatch', async () => {
      const { diff } = await loadDiff();
      const oldP = writeFixture('old.json', makeFixture({ schemaVersion: '1.0' }));
      const newP = writeFixture('new.json', makeFixture({ schemaVersion: '2.0' }));
      const r = diff({ oldPath: oldP, newPath: newP, mode: 'regression', ignoreQuality: false });
      expect(r.overall).toBe('schema-mismatch');
      expect(r.schemaError).toMatch(/major version mismatch/);
    });

    it('rejects minor version mismatch unless --ignore-quality', async () => {
      const { diff } = await loadDiff();
      const oldP = writeFixture('old.json', makeFixture({ schemaVersion: '1.0' }));
      const newP = writeFixture('new.json', makeFixture({ schemaVersion: '1.1' }));
      const strict = diff({ oldPath: oldP, newPath: newP, mode: 'regression', ignoreQuality: false });
      expect(strict.overall).toBe('schema-mismatch');
      const lenient = diff({ oldPath: oldP, newPath: newP, mode: 'regression', ignoreQuality: true });
      expect(lenient.overall).toBe('pass');
    });
  });

  describe('na severity', () => {
    it('handles null values gracefully', async () => {
      const { diff } = await loadDiff();
      const oldP = writeFixture('old.json', { schemaVersion: '1.0', perf: {}, output: {} });
      const newP = writeFixture('new.json', { schemaVersion: '1.0', perf: {}, output: {} });
      const r = diff({ oldPath: oldP, newPath: newP, mode: 'regression', ignoreQuality: false });
      expect(r.results.every((x) => x.severity === 'na')).toBe(true);
      expect(r.overall).toBe('pass'); // 没有 red 即 ok
    });
  });

  describe('zero-division handling', () => {
    it('treats 0 → 0 as green (no change)', async () => {
      const { diff } = await loadDiff();
      const oldP = writeFixture('old.json', makeFixture({ output: { graphNodeCount: 0, graphEdgeCount: 0, specModuleCount: 10, specSuccessCount: 10 } }));
      const newP = writeFixture('new.json', makeFixture({ output: { graphNodeCount: 0, graphEdgeCount: 0, specModuleCount: 10, specSuccessCount: 10 } }));
      const r = diff({ oldPath: oldP, newPath: newP, mode: 'regression', ignoreQuality: false });
      const node = r.results.find((x) => x.field === 'output.graphNodeCount')!;
      expect(node.severity).toBe('green');
      expect(node.deltaPct).toBe(0);
    });

    it('treats 0 → non-zero as red (cannot compute %)', async () => {
      const { diff } = await loadDiff();
      const oldP = writeFixture('old.json', makeFixture({ output: { graphNodeCount: 0, graphEdgeCount: 0, specModuleCount: 10, specSuccessCount: 10 } }));
      const newP = writeFixture('new.json', makeFixture({ output: { graphNodeCount: 50, graphEdgeCount: 0, specModuleCount: 10, specSuccessCount: 10 } }));
      const r = diff({ oldPath: oldP, newPath: newP, mode: 'regression', ignoreQuality: false });
      const node = r.results.find((x) => x.field === 'output.graphNodeCount')!;
      expect(node.severity).toBe('red');
      expect(node.deltaPct).toBeNull();
    });
  });
});
