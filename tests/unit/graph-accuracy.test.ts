import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

interface GraphAccuracyResult {
  language: string;
  coverageMethod: string;
  truthSet: { filesAnalyzed: number; imports: number; callsTotal: number; uniqueCallTargets: number } | null;
  graph: { totalEdges: number; callEdges: number; containmentEdges: number; otherEdges: number } | null;
  accuracy: {
    graphCalleeCount: number;
    truthCalleeCount: number;
    hits: number;
    callPrecision: number | null;
    callRecall: number | null;
    sampleHits: string[];
    sampleMissed: string[];
    sampleFalsePositives: string[];
  } | null;
  notes: string[];
  _skipped?: string;
}

interface GraphAccuracyModule {
  analyzeGraphAccuracy: (input: { sourceRoot: string; graphPath: string; language?: string }) => GraphAccuracyResult;
}

async function loadGraphAccuracy(): Promise<GraphAccuracyModule> {
  const url = pathToFileURL(resolve('scripts/graph-accuracy.mjs')).href;
  return (await import(url)) as GraphAccuracyModule;
}

describe('graph-accuracy (Sprint 3 Phase B.1)', () => {
  // Feature 150 修订（Phase 4 阶段 A）：原合同把 non-Python 语言返回 _skipped 对象，
  // 现已升级为 strict dispatch — 已知但未实现的 language（ts/go/java）抛 "not yet implemented"，
  // 未知 language（含旧的 'typescript' 字符串）抛 "Unsupported language"。
  it('rejects non-canonical language string (e.g. "typescript") as Unsupported', async () => {
    const { analyzeGraphAccuracy } = await loadGraphAccuracy();
    expect(() =>
      analyzeGraphAccuracy({
        sourceRoot: '/tmp/non-existent',
        graphPath: '/tmp/non-existent.json',
        language: 'typescript',
      }),
    ).toThrow(/Unsupported language: "typescript"/);
  });

  it('throws "not yet implemented" for canonical ts/go/java language codes', async () => {
    const { analyzeGraphAccuracy } = await loadGraphAccuracy();
    for (const lang of ['ts', 'go', 'java'] as const) {
      expect(() =>
        analyzeGraphAccuracy({
          sourceRoot: '/tmp/non-existent',
          graphPath: '/tmp/non-existent.json',
          language: lang,
        }),
      ).toThrow(/not yet implemented/);
    }
  });

  it('extracts truth set from minimal Python source and matches against graph', async () => {
    const { analyzeGraphAccuracy } = await loadGraphAccuracy();
    const tempDir = mkdtempSync(join(tmpdir(), 'graph-accuracy-test-'));
    const srcRoot = join(tempDir, 'src');
    mkdirSync(srcRoot);
    writeFileSync(join(srcRoot, 'main.py'), 'import os\n\ndef foo():\n    bar()\n    baz()\n', 'utf-8');

    // graph.json 用 NetworkX node-link 格式
    const graphPath = join(tempDir, 'graph.json');
    writeFileSync(
      graphPath,
      JSON.stringify({
        directed: true,
        nodes: [
          { id: 'main', label: 'main.py' },
          { id: 'foo', label: 'foo' },
          { id: 'bar', label: 'bar' },
          { id: 'baz', label: 'baz' },
          { id: 'qux', label: 'qux' }, // false positive callee
        ],
        links: [
          { source: 'foo', target: 'bar', relation: 'calls' },
          { source: 'foo', target: 'qux', relation: 'calls' },
          { source: 'main', target: 'foo', relation: 'contains' },
        ],
      }),
      'utf-8'
    );

    const result = analyzeGraphAccuracy({ sourceRoot: srcRoot, graphPath, language: 'python' });
    expect(result.language).toBe('python');
    expect(result.truthSet?.callsTotal).toBeGreaterThanOrEqual(2); // bar() + baz()
    expect(result.graph?.callEdges).toBe(2);
    expect(result.graph?.containmentEdges).toBe(1);
    // accuracy: 1 of 2 graph callees (bar) hits truth; qux is false positive; baz missed
    expect(result.accuracy?.graphCalleeCount).toBe(2);
    expect(result.accuracy?.hits).toBe(1);
    expect(result.accuracy?.callPrecision).toBeCloseTo(0.5, 2);
    expect(result.accuracy?.sampleHits).toContain('bar');
    expect(result.accuracy?.sampleFalsePositives).toContain('qux');
  });

  it('handles contains-only graph (spectra v4.x) gracefully — recall=0, precision=null', async () => {
    const { analyzeGraphAccuracy } = await loadGraphAccuracy();
    const tempDir = mkdtempSync(join(tmpdir(), 'graph-accuracy-spectra-'));
    const srcRoot = join(tempDir, 'src');
    mkdirSync(srcRoot);
    writeFileSync(join(srcRoot, 'a.py'), 'def x():\n    y()\n', 'utf-8');

    const graphPath = join(tempDir, 'graph.json');
    writeFileSync(
      graphPath,
      JSON.stringify({
        nodes: [{ id: 'a', label: 'a.py' }, { id: 'x', label: 'x' }],
        links: [{ source: 'a', target: 'x', relation: 'contains' }],
      }),
      'utf-8'
    );

    const result = analyzeGraphAccuracy({ sourceRoot: srcRoot, graphPath, language: 'python' });
    expect(result.graph?.callEdges).toBe(0);
    expect(result.graph?.containmentEdges).toBe(1);
    expect(result.accuracy?.callPrecision).toBeNull(); // 没 call edges 时 precision = null
    expect(result.accuracy?.callRecall).toBe(0); // 真实 calls 存在但 graph 没覆盖
    expect(result.notes.some((n) => n.includes('contains-only'))).toBe(true);
  });
});
