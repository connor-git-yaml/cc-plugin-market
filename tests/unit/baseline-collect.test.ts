import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

interface CollectorModule {
  parseArgs: (argv: string[]) => {
    target: string | null;
    mode: string;
    commit: string | null;
    verifyArtifacts: boolean;
    output: string | null;
    skipBatch: boolean;
  };
  parseTargetFiles: (targetDir: string) => {
    fileCountsByType: { ts: number; tsx: number; py: number; md: number; other: number };
    locEstimate: number;
  };
  findLatestBatchSummary: (metaDir: string) => string | null;
  parseBatchSummary: (summaryPath: string) => {
    specModuleCount: number | null;
    specSuccessCount: number | null;
    specFailedCount: number | null;
    specSkippedCount: number | null;
    tokensInput: number | null;
    tokensOutput: number | null;
    llmTotalDurationMs: number | null;
  };
  parseGraph: (metaDir: string) => {
    graphNodeCount: number | null;
    graphEdgeCount: number | null;
    graphHyperedgeCount: number | null;
    graphSizeBytes: number | null;
  };
  parseLlmCalls: (stdoutLog: string) => {
    llmCallCount: number | null;
    llmCallDurationsMs: { p50: number; p95: number; min: number; max: number; samplesCount: number } | null;
    _extractionNote: string | null;
  };
  parseTimeStderr: (stderr: string) => number | null;
  verifyArtifacts: (opts: { rootDir: string }) => { ok: boolean; errors: string[] };
}

async function loadCollector(): Promise<CollectorModule> {
  const url = pathToFileURL(resolve('scripts/baseline-collect.mjs')).href;
  return (await import(url)) as CollectorModule;
}

describe('baseline-collect', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'baseline-collect-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseArgs', () => {
    it('parses target / mode / commit', async () => {
      const { parseArgs } = await loadCollector();
      const r = parseArgs(['--target', 'self-dogfood', '--mode', 'reading', '--commit', 'abc123']);
      expect(r.target).toBe('self-dogfood');
      expect(r.mode).toBe('reading');
      expect(r.commit).toBe('abc123');
      expect(r.verifyArtifacts).toBe(false);
    });

    it('sets verifyArtifacts when --verify-artifacts present', async () => {
      const { parseArgs } = await loadCollector();
      const r = parseArgs(['--verify-artifacts']);
      expect(r.verifyArtifacts).toBe(true);
    });

    it('throws on unknown flag', async () => {
      const { parseArgs } = await loadCollector();
      expect(() => parseArgs(['--unknown'])).toThrow(/unknown flag/);
    });

    it('defaults mode to full', async () => {
      const { parseArgs } = await loadCollector();
      const r = parseArgs(['--target', 'x']);
      expect(r.mode).toBe('full');
    });
  });

  describe('parseTargetFiles', () => {
    it('counts file types and accumulates LOC for ts/py', async () => {
      const { parseTargetFiles } = await loadCollector();
      writeFileSync(join(tempDir, 'a.ts'), 'line1\nline2\nline3\n');
      writeFileSync(join(tempDir, 'b.tsx'), 'x\ny\n');
      writeFileSync(join(tempDir, 'c.py'), 'def f():\n    pass\n');
      writeFileSync(join(tempDir, 'd.md'), '# title\n');
      writeFileSync(join(tempDir, 'e.bin'), 'data');
      const r = parseTargetFiles(tempDir);
      expect(r.fileCountsByType.ts).toBe(1);
      expect(r.fileCountsByType.tsx).toBe(1);
      expect(r.fileCountsByType.py).toBe(1);
      expect(r.fileCountsByType.md).toBe(1);
      expect(r.fileCountsByType.other).toBe(1);
      // split('\n') 对 trailing newline 算 1 个空元素：4 + 3 + 3 = 10
      expect(r.locEstimate).toBe(10);
    });

    it('skips node_modules and .git', async () => {
      const { parseTargetFiles } = await loadCollector();
      mkdirSync(join(tempDir, 'node_modules'));
      writeFileSync(join(tempDir, 'node_modules', 'lib.ts'), 'x');
      mkdirSync(join(tempDir, '.git'));
      writeFileSync(join(tempDir, '.git', 'config'), 'data');
      writeFileSync(join(tempDir, 'real.ts'), 'a\nb\n');
      const r = parseTargetFiles(tempDir);
      expect(r.fileCountsByType.ts).toBe(1);
    });
  });

  describe('parseBatchSummary', () => {
    it('extracts module counts and tokens from markdown table', async () => {
      const { parseBatchSummary } = await loadCollector();
      const summary = `# 批处理摘要日志

## 统计

| 指标 | 数值 |
|------|------|
| 总模块数 | 21 |
| 成功 | 18 |
| 失败 | 1 |
| 跳过 | 2 |
| 降级 | 0 |

## 详情

## LLM 成本汇总

| 指标 | 数值 |
|------|------|
| 总 input tokens | 234,567 |
| 总 output tokens | 45,678 |
| 总 token 数 | 280,245 |
| LLM 总耗时 | 123.4s |
`;
      const summaryPath = join(tempDir, 'batch-summary-1.md');
      writeFileSync(summaryPath, summary);
      const r = parseBatchSummary(summaryPath);
      expect(r.specModuleCount).toBe(21);
      expect(r.specSuccessCount).toBe(18);
      expect(r.specFailedCount).toBe(1);
      expect(r.specSkippedCount).toBe(2);
      expect(r.tokensInput).toBe(234567);
      expect(r.tokensOutput).toBe(45678);
      expect(r.llmTotalDurationMs).toBe(123400);
    });
  });

  describe('findLatestBatchSummary', () => {
    it('returns null if metaDir missing', async () => {
      const { findLatestBatchSummary } = await loadCollector();
      expect(findLatestBatchSummary(join(tempDir, 'nope'))).toBeNull();
    });

    it('picks the latest by sorted timestamp suffix', async () => {
      const { findLatestBatchSummary } = await loadCollector();
      mkdirSync(join(tempDir, '_meta'));
      writeFileSync(join(tempDir, '_meta', 'batch-summary-1000.md'), '');
      writeFileSync(join(tempDir, '_meta', 'batch-summary-2000.md'), '');
      writeFileSync(join(tempDir, '_meta', 'batch-summary-3000.md'), '');
      writeFileSync(join(tempDir, '_meta', 'unrelated.md'), '');
      const r = findLatestBatchSummary(join(tempDir, '_meta'));
      expect(r).toBe(join(tempDir, '_meta', 'batch-summary-3000.md'));
    });
  });

  describe('parseGraph', () => {
    it('returns null counts if graph.json absent', async () => {
      const { parseGraph } = await loadCollector();
      mkdirSync(join(tempDir, '_meta'));
      const r = parseGraph(join(tempDir, '_meta'));
      expect(r.graphNodeCount).toBeNull();
      expect(r.graphSizeBytes).toBeNull();
    });

    it('counts nodes / edges / hyperedges and reports size', async () => {
      const { parseGraph } = await loadCollector();
      mkdirSync(join(tempDir, '_meta'));
      const graph = {
        nodes: Array.from({ length: 10 }, (_, i) => ({ id: i })),
        edges: Array.from({ length: 25 }, (_, i) => ({ from: i, to: i + 1 })),
        hyperedges: [{ id: 'h1' }, { id: 'h2' }],
      };
      const graphPath = join(tempDir, '_meta', 'graph.json');
      writeFileSync(graphPath, JSON.stringify(graph));
      const r = parseGraph(join(tempDir, '_meta'));
      expect(r.graphNodeCount).toBe(10);
      expect(r.graphEdgeCount).toBe(25);
      expect(r.graphHyperedgeCount).toBe(2);
      expect(r.graphSizeBytes).toBeGreaterThan(0);
    });

    it('hyperedges absent → 0', async () => {
      const { parseGraph } = await loadCollector();
      mkdirSync(join(tempDir, '_meta'));
      writeFileSync(join(tempDir, '_meta', 'graph.json'), JSON.stringify({ nodes: [], edges: [] }));
      const r = parseGraph(join(tempDir, '_meta'));
      expect(r.graphHyperedgeCount).toBe(0);
    });
  });

  describe('parseLlmCalls', () => {
    it('returns null + extraction note when no LLM lines found', async () => {
      const { parseLlmCalls } = await loadCollector();
      const r = parseLlmCalls('random log lines\nno llm here');
      expect(r.llmCallCount).toBeNull();
      expect(r._extractionNote).toBe('stderr-format-unrecognized');
    });

    it('extracts duration list and computes p50/p95 (matches batch-orchestrator stderr format)', async () => {
      const { parseLlmCalls } = await loadCollector();
      // 实际格式（src/batch/batch-orchestrator.ts:912）：
      //   `[<moduleName>] AST: 0.1s | context: 0.2s | LLM#1: 12.3s | enrich: 0.4s | ...`
      const log = [
        '[moduleA] AST: 0.1s | context: 0.2s | LLM#1: 0.1s | enrich: 0.0s | render: 0.0s | total: 0.5s',
        '[moduleB] AST: 0.1s | context: 0.2s | LLM#1: 0.2s | enrich: 0.0s | render: 0.0s | total: 0.6s',
        '[moduleC] AST: 0.1s | context: 0.2s | LLM#1: 0.3s | enrich: 0.0s | render: 0.0s | total: 0.7s',
        '[moduleD] AST: 0.1s | context: 0.2s | LLM#1: 0.4s | enrich: 0.0s | render: 0.0s | total: 0.8s',
      ].join('\n');
      const r = parseLlmCalls(log);
      expect(r.llmCallCount).toBe(4);
      expect(r.llmCallDurationsMs).not.toBeNull();
      expect(r.llmCallDurationsMs!.min).toBe(100);
      expect(r.llmCallDurationsMs!.max).toBe(400);
      expect(r.llmCallDurationsMs!.samplesCount).toBe(4);
    });
  });

  describe('parseTimeStderr', () => {
    it('parses GNU time -v Linux format (kbytes)', async () => {
      const { parseTimeStderr } = await loadCollector();
      const stderr = '\tMaximum resident set size (kbytes): 524288\n';
      expect(parseTimeStderr(stderr)).toBe(524288);
    });

    it('parses BSD time -l macOS format (bytes → kbytes)', async () => {
      const { parseTimeStderr } = await loadCollector();
      const stderr = '       536870912  maximum resident set size\n';
      expect(parseTimeStderr(stderr)).toBe(524288);
    });

    it('returns null when not found', async () => {
      const { parseTimeStderr } = await loadCollector();
      expect(parseTimeStderr('no time output')).toBeNull();
    });
  });

  describe('verifyArtifacts', () => {
    function validFixture(): Record<string, unknown> {
      return {
        schemaVersion: '1.0',
        meta: {
          targetCommit: 'abc1234567',
          targetFileCountsByType: { ts: 600, tsx: 0, py: 0, md: 0, other: 0 },
        },
        perf: { totalWallMs: 1000, tokensInput: 100, tokensOutput: 50 },
      };
    }

    it('returns ok when both required projects exist with valid schema + ≥500 files + commit', async () => {
      const { verifyArtifacts } = await loadCollector();
      const baselineDir = join(tempDir, 'tests', 'baseline');
      for (const proj of ['continue', 'khoj']) {
        mkdirSync(join(baselineDir, proj), { recursive: true });
        writeFileSync(join(baselineDir, proj, 'full.json'), JSON.stringify(validFixture()));
      }
      const r = verifyArtifacts({ rootDir: tempDir });
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
    });

    it('fails when required fixture missing', async () => {
      const { verifyArtifacts } = await loadCollector();
      const r = verifyArtifacts({ rootDir: tempDir });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e: string) => e.includes('missing fixture'))).toBe(true);
    });

    it('fails when schemaVersion mismatch', async () => {
      const { verifyArtifacts } = await loadCollector();
      const baselineDir = join(tempDir, 'tests', 'baseline');
      for (const proj of ['continue', 'khoj']) {
        mkdirSync(join(baselineDir, proj), { recursive: true });
        const f = validFixture();
        f.schemaVersion = '99.0';
        writeFileSync(join(baselineDir, proj, 'full.json'), JSON.stringify(f));
      }
      const r = verifyArtifacts({ rootDir: tempDir });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e: string) => e.includes('schemaVersion mismatch'))).toBe(true);
    });

    it('fails when key field is null', async () => {
      const { verifyArtifacts } = await loadCollector();
      const baselineDir = join(tempDir, 'tests', 'baseline');
      for (const proj of ['continue', 'khoj']) {
        mkdirSync(join(baselineDir, proj), { recursive: true });
        const f = validFixture();
        (f.perf as Record<string, unknown>).totalWallMs = null;
        (f.perf as Record<string, unknown>).tokensInput = null;
        writeFileSync(join(baselineDir, proj, 'full.json'), JSON.stringify(f));
      }
      const r = verifyArtifacts({ rootDir: tempDir });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e: string) => e.includes('null perf.totalWallMs'))).toBe(true);
    });

    it('fails when target file count < SC-001 minimum 500 (spec §2.1)', async () => {
      const { verifyArtifacts } = await loadCollector();
      const baselineDir = join(tempDir, 'tests', 'baseline');
      for (const proj of ['continue', 'khoj']) {
        mkdirSync(join(baselineDir, proj), { recursive: true });
        const f = validFixture();
        (f.meta as { targetFileCountsByType: { ts: number } }).targetFileCountsByType.ts = 100;
        writeFileSync(join(baselineDir, proj, 'full.json'), JSON.stringify(f));
      }
      const r = verifyArtifacts({ rootDir: tempDir });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e: string) => e.includes('< SC-001 minimum 500'))).toBe(true);
    });

    it('fails when meta.targetCommit missing (spec §6 reproducibility)', async () => {
      const { verifyArtifacts } = await loadCollector();
      const baselineDir = join(tempDir, 'tests', 'baseline');
      for (const proj of ['continue', 'khoj']) {
        mkdirSync(join(baselineDir, proj), { recursive: true });
        const f = validFixture();
        delete (f.meta as { targetCommit?: string }).targetCommit;
        writeFileSync(join(baselineDir, proj, 'full.json'), JSON.stringify(f));
      }
      const r = verifyArtifacts({ rootDir: tempDir });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e: string) => e.includes('missing meta.targetCommit'))).toBe(true);
    });
  });
});
