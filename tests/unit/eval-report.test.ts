import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

interface ReportModule {
  parseArgs: (argv: string[]) => Record<string, unknown>;
  scanFixtures: (dir: string) => {
    spectraClass: Array<{ project: string; tool: string; fx: Record<string, unknown> }>;
    specDriverClass: Array<{ task: string; tool: string; fx: Record<string, unknown> }>;
  };
  aggregateMetrics: (scanned: ReturnType<ReportModule['scanFixtures']>) => {
    fixtureCount: number;
    spectraCount: number;
    specDriverCount: number;
    cumulativeCost: number;
    budgetRemaining: number;
    projects: string[];
    spectraTools: string[];
    tasks: string[];
    driverTools: string[];
    stale: Array<{ daysLeft: number; staleAfter: string }>;
  };
  detectInsights: (scanned: ReturnType<ReportModule['scanFixtures']>) => Array<{
    kind: string;
    spread: number;
    leader: string;
    laggard: string;
  }>;
  renderMarkdown: (
    scanned: ReturnType<ReportModule['scanFixtures']>,
    agg: ReturnType<ReportModule['aggregateMetrics']>,
    insights: ReturnType<ReportModule['detectInsights']>,
  ) => string;
  renderJson: (
    scanned: ReturnType<ReportModule['scanFixtures']>,
    agg: ReturnType<ReportModule['aggregateMetrics']>,
    insights: ReturnType<ReportModule['detectInsights']>,
  ) => string;
}

async function loadReport(): Promise<ReportModule> {
  const url = pathToFileURL(resolve('scripts/eval-report.mjs')).href;
  return (await import(url)) as ReportModule;
}

function writeFixture(dir: string, fx: Record<string, unknown>) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'full.json'), JSON.stringify(fx, null, 2));
}

describe('eval-report', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'eval-report-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseArgs', () => {
    it('rejects unknown format', async () => {
      const { parseArgs } = await loadReport();
      expect(() => parseArgs(['--format', 'xml'])).toThrow(/--format must be/);
    });

    it('defaults to markdown', async () => {
      const { parseArgs } = await loadReport();
      const r = parseArgs([]);
      expect(r.format).toBe('markdown');
    });
  });

  describe('scanFixtures', () => {
    it('classifies into spectraClass and specDriverClass by path', async () => {
      const { scanFixtures } = await loadReport();
      writeFixture(join(tempDir, 'micrograd', 'spectra'), {
        schemaVersion: '1.1',
        meta: { tool: 'spectra' },
        perf: { totalWallMs: 1000, estimatedCostUsd: 0.5 },
      });
      writeFixture(join(tempDir, 'tasks', 'T1-tanh', 'control'), {
        schemaVersion: '1.1',
        meta: { tool: 'control' },
        taskExecution: { tool: 'control', wallMs: 5000, primaryOracle: { passed: true }, rubricJudgeScore: 6 },
      });
      const r = scanFixtures(tempDir);
      expect(r.spectraClass).toHaveLength(1);
      expect(r.specDriverClass).toHaveLength(1);
      expect(r.spectraClass[0].project).toBe('micrograd');
      expect(r.specDriverClass[0].task).toBe('T1-tanh');
    });

    it('skips non-fixture dirs gracefully', async () => {
      const { scanFixtures } = await loadReport();
      writeFixture(join(tempDir, 'micrograd', 'spectra'), { schemaVersion: '1.1' });
      mkdirSync(join(tempDir, '.workspaces'), { recursive: true });
      writeFileSync(join(tempDir, 'README.md'), 'test');
      const r = scanFixtures(tempDir);
      expect(r.spectraClass).toHaveLength(1);
    });
  });

  describe('aggregateMetrics', () => {
    it('sums cost and counts fixtures', async () => {
      const { scanFixtures, aggregateMetrics } = await loadReport();
      writeFixture(join(tempDir, 'p1', 'spectra'), {
        meta: { tool: 'spectra' }, perf: { estimatedCostUsd: 5 },
      });
      writeFixture(join(tempDir, 'p2', 'spectra'), {
        meta: { tool: 'spectra' }, perf: { estimatedCostUsd: 3 },
      });
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver'), {
        meta: { tool: 'spec-driver' }, taskExecution: { tool: 'spec-driver', costUsd: 0.5 },
      });
      const agg = aggregateMetrics(scanFixtures(tempDir));
      expect(agg.fixtureCount).toBe(3);
      expect(agg.cumulativeCost).toBe(8.5);
      expect(agg.budgetRemaining).toBe(111.5);
      expect(agg.projects).toEqual(['p1', 'p2']);
    });

    it('flags stale fixtures', async () => {
      const { scanFixtures, aggregateMetrics } = await loadReport();
      const past = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      writeFixture(join(tempDir, 'p1', 'spectra'), {
        meta: { tool: 'spectra', staleAfterDate: past, frozenFixture: true },
      });
      const agg = aggregateMetrics(scanFixtures(tempDir));
      expect(agg.stale).toHaveLength(1);
      expect(agg.stale[0].daysLeft).toBeLessThan(0);
    });
  });

  describe('detectInsights', () => {
    it('detects spec-quality spread ≥ 2 between tools', async () => {
      const { scanFixtures, detectInsights } = await loadReport();
      writeFixture(join(tempDir, 'p1', 'spectra'), {
        meta: { tool: 'spectra' }, quality: { judgeSpecQuality: { score: 7 } },
      });
      writeFixture(join(tempDir, 'p1', 'graphify'), {
        meta: { tool: 'graphify' }, quality: { judgeSpecQuality: { score: 1 } },
      });
      const insights = detectInsights(scanFixtures(tempDir));
      const sq = insights.find((i) => i.kind === 'spec-quality-spread');
      expect(sq).toBeTruthy();
      expect(sq!.leader).toBe('spectra');
      expect(sq!.spread).toBe(6);
    });

    it('detects task-spread ≥ 1 between tools', async () => {
      const { scanFixtures, detectInsights } = await loadReport();
      writeFixture(join(tempDir, 'tasks', 'T1', 'gstack'), {
        meta: { tool: 'gstack' }, taskExecution: { tool: 'gstack', rubricJudgeScore: 5.5 },
      });
      writeFixture(join(tempDir, 'tasks', 'T1', 'control'), {
        meta: { tool: 'control' }, taskExecution: { tool: 'control', rubricJudgeScore: 4 },
      });
      const insights = detectInsights(scanFixtures(tempDir));
      const ts = insights.find((i) => i.kind === 'task-spread');
      expect(ts).toBeTruthy();
      expect(ts!.leader).toBe('gstack');
      expect(ts!.spread).toBe(1.5);
    });

    it('returns empty when no significant spread', async () => {
      const { scanFixtures, detectInsights } = await loadReport();
      writeFixture(join(tempDir, 'p1', 'spectra'), {
        meta: { tool: 'spectra' }, quality: { judgeSpecQuality: { score: 6 } },
      });
      writeFixture(join(tempDir, 'p1', 'graphify'), {
        meta: { tool: 'graphify' }, quality: { judgeSpecQuality: { score: 5.5 } },
      });
      const insights = detectInsights(scanFixtures(tempDir));
      expect(insights.filter((i) => i.kind === 'spec-quality-spread')).toHaveLength(0);
    });
  });

  describe('renderMarkdown', () => {
    it('emits固定章节 + tables', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'p1', 'spectra'), {
        schemaVersion: '1.1',
        meta: { tool: 'spectra' },
        perf: { totalWallMs: 1000, estimatedCostUsd: 1, llmCallCount: 1, tokensInput: 100, tokensOutput: 50 },
        output: { graphNodeCount: 10, graphEdgeCount: 5 },
        quality: { judgeSpecQuality: { score: 6 }, specStructure: { modulesWithAllFour: 4, moduleCount: 5 } },
      });
      const scanned = scanFixtures(tempDir);
      const agg = aggregateMetrics(scanned);
      const insights = detectInsights(scanned);
      const md = renderMarkdown(scanned, agg, insights);
      expect(md).toContain('# Spectra & Spec Driver 评估自动报告');
      expect(md).toContain('## 1. Coverage');
      expect(md).toContain('## 2. Cost Summary');
      expect(md).toContain('## 3. Spectra 类对比');
      expect(md).toContain('## 4. Spec Driver 类任务矩阵');
      expect(md).toContain('## 5. Differentiation Insights');
      expect(md).toContain('## 6. Stale Fixture');
      expect(md).toContain('## 7. SC 验收快照');
    });
  });

  describe('renderJson', () => {
    it('emits valid JSON', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderJson } = await loadReport();
      writeFixture(join(tempDir, 'p1', 'spectra'), { meta: { tool: 'spectra' } });
      const scanned = scanFixtures(tempDir);
      const agg = aggregateMetrics(scanned);
      const insights = detectInsights(scanned);
      const j = renderJson(scanned, agg, insights);
      const parsed = JSON.parse(j);
      expect(parsed.aggregate).toBeTruthy();
      expect(parsed.fixtures.spectraClass).toHaveLength(1);
    });
  });
});
