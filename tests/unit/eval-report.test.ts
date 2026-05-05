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
    specDriverVariants: Array<{ task: string; tool: string; baseTool: string; variant: string; fx: Record<string, unknown> }>;
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
    repeatAggregatesOverride?: Map<string, Record<string, unknown>>,
  ) => string;
  loadRepeatAggregates: (rootDir: string) => Map<string, Record<string, unknown>>;
  ciOverlaps: (
    a: { low: number | null; high: number | null } | null | undefined,
    b: { low: number | null; high: number | null } | null | undefined,
  ) => boolean;
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

    it('treats null cost as unknown, not zero', async () => {
      const { scanFixtures, aggregateMetrics } = await loadReport();
      writeFixture(join(tempDir, 'p1', 'spectra'), {
        meta: { tool: 'spectra' }, perf: { estimatedCostUsd: 5 },
      });
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver-opus'), {
        meta: { tool: 'spec-driver-opus' }, taskExecution: { tool: 'spec-driver-opus', costUsd: null },
      });
      const agg = aggregateMetrics(scanFixtures(tempDir)) as ReturnType<ReportModule['aggregateMetrics']> & {
        knownCostFixtures: number;
        unknownCostFixtures: number;
      };
      expect(agg.cumulativeCost).toBe(5);
      expect(agg.knownCostFixtures).toBe(1);
      expect(agg.unknownCostFixtures).toBe(1);
    });
  });

  describe('detectInsights', () => {
    it('detects doc-quality spread ≥ 2 between tools', async () => {
      const { scanFixtures, detectInsights } = await loadReport();
      writeFixture(join(tempDir, 'p1', 'spectra'), {
        meta: { tool: 'spectra' }, quality: { judgeDocumentationQuality: { score: 7 } },
      });
      writeFixture(join(tempDir, 'p1', 'graphify'), {
        meta: { tool: 'graphify' }, quality: { judgeDocumentationQuality: { score: 1 } },
      });
      const insights = detectInsights(scanFixtures(tempDir));
      const dq = insights.find((i) => i.kind === 'doc-quality-spread');
      expect(dq).toBeTruthy();
      expect(dq!.leader).toBe('spectra');
      expect(dq!.spread).toBe(6);
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

  describe('§4.2 model caveat', () => {
    it('renders Model Caveat section when groups differ + flags self-judge tools with †', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      // Sonnet baseline，inter-rater 已 double-blind
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver'), {
        meta: { tool: 'spec-driver', model: 'claude-sonnet-4-6' },
        taskExecution: { tool: 'spec-driver', rubricJudgeScore: 4, interRaterDelta: 0.5, primaryOracle: { passed: true } },
      });
      // Opus in-session，self-judge
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver-opus'), {
        meta: { tool: 'spec-driver-opus', model: 'claude-opus-4-7' },
        taskExecution: {
          tool: 'spec-driver-opus',
          rubricJudgeScore: 7,
          interRaterDelta: null,
          executionMode: 'in-session-opus-no-context',
          model: 'claude-opus-4-7',
          modelDisclaimer: 'main session opus disclaimer',
          judgedBy: 'self-judge-main-session-opus-4-7',
          primaryOracle: { passed: true },
        },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      expect(md).toContain('### 4.2 Model Caveat');
      expect(md).toContain('claude-sonnet-4-6');
      expect(md).toContain('claude-opus-4-7');
      expect(md).toContain('in-session-opus-no-context');
      expect(md).toContain('main session opus disclaimer');
      expect(md).toContain('self-judge');
      // self-judge tool 在 §4.1 表头有 † 标记
      expect(md).toMatch(/spec-driver-opus †/);
      // 不能再出现"真正可归因"这种过强归因措辞
      expect(md).not.toContain('真正可归因');
      expect(md).toContain('descriptive signal');
    });

    it('does not render §4.2 when only one model group', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver'), {
        meta: { tool: 'spec-driver', model: 'claude-sonnet-4-6' },
        taskExecution: { tool: 'spec-driver', rubricJudgeScore: 4, interRaterDelta: 0.5, primaryOracle: { passed: true } },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      expect(md).not.toContain('### 4.2 Model Caveat');
    });

    it('renders §4.3 Jury Agreement table when fixtures have juryMedian', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver-opus'), {
        meta: { tool: 'spec-driver-opus', model: 'claude-opus-4-7' },
        taskExecution: {
          tool: 'spec-driver-opus',
          juryScores: [
            { judge: 'claude-sonnet-4-6', score: 7 },
            { judge: 'claude-opus-4-7', score: 8 },
          ],
          juryMedian: 7.5,
          jurySpread: 1,
          juryAgreement: 'high',
          primaryOracle: { passed: true },
        },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      expect(md).toContain('### 4.3 Jury Agreement');
      // judge labels strip 'claude-' prefix in §4.3 table
      expect(md).toMatch(/sonnet-4-6=7/);
      expect(md).toMatch(/opus-4-7=8/);
      expect(md).toMatch(/spec-driver-opus †{2}/); // marked as jury (††) in §4.1
      expect(md).toMatch(/cross-LLM jury/);
      // Sprint 3 后修订（根因 3 修复）：跨 run 主观波动 caveat
      expect(md).toContain('Cross-run 主观波动 caveat');
      expect(md).toMatch(/工具间.*≤ 0\.5.*均分差距.*不应作为质量排名信号/);
    });

    it('§4.1 prefers juryMedian over rubricJudgeScore when both exist', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver-opus'), {
        meta: { tool: 'spec-driver-opus' },
        taskExecution: {
          tool: 'spec-driver-opus',
          rubricJudgeScore: 7, // legacy single self-judge
          juryMedian: 5.5, // newer cross-LLM jury (lower)
          jurySpread: 1,
          juryAgreement: 'high',
          juryScores: [{ judge: 'a', score: 5 }, { judge: 'b', score: 6 }],
          primaryOracle: { passed: true },
        },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      // 应该用 5.5 (jury median) 不是 7 (legacy)
      expect(md).toMatch(/\*\*5\.5/); // jury score is bold + has †† marker
      // 均分行拆成 jury / self-judge — 此 fixture 仅有 jury（无 mixed）
      expect(md).toContain('**均分 (jury)**');
      expect(md).toMatch(/\*\*5\.5\*\*\s*\(n=1\)/);
    });

    it('§2 Cost Summary 拆 execution / jury / unknown (Codex WARN)', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'p1', 'spectra'), {
        meta: { tool: 'spectra' }, perf: { estimatedCostUsd: 5 },
      });
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver-opus'), {
        meta: { tool: 'spec-driver-opus' },
        taskExecution: {
          tool: 'spec-driver-opus',
          juryScores: [
            { judge: 'siliconflow:Pro/zai-org/GLM-5.1', vendor: 'siliconflow', score: 7, promptTokens: 1000, completionTokens: 500 },
            { judge: 'siliconflow:Pro/moonshotai/Kimi-K2.6', vendor: 'siliconflow', score: 8, promptTokens: 1000, completionTokens: 500 },
          ],
          juryMedian: 7.5,
          jurySpread: 1,
          juryAgreement: 'high',
          primaryOracle: { passed: true },
        },
      });
      const scanned = scanFixtures(tempDir);
      const agg = aggregateMetrics(scanned) as ReturnType<ReportModule['aggregateMetrics']> & {
        executionCost: number;
        juryCost: number;
      };
      expect(agg.executionCost).toBe(5);
      expect(agg.juryCost).toBeGreaterThan(0);
      expect(agg.juryCost).toBeLessThan(0.01); // 2000 tokens × siliconflow price 应该很便宜
      expect(agg.cumulativeCost).toBeCloseTo(agg.executionCost + agg.juryCost, 2);
      const md = renderMarkdown(scanned, agg, detectInsights(scanned));
      expect(md).toMatch(/Execution cost.*\$5/);
      expect(md).toMatch(/Jury cost/);
    });

    it('§4.3 蓝色 vendor disclosure + sample size warning (Codex WARN)', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver-opus'), {
        meta: { tool: 'spec-driver-opus' },
        taskExecution: {
          tool: 'spec-driver-opus',
          juryScores: [
            { judge: 'siliconflow:Pro/zai-org/GLM-5.1', vendor: 'siliconflow', score: 7 },
            { judge: 'siliconflow:Pro/moonshotai/Kimi-K2.6', vendor: 'siliconflow', score: 8 },
          ],
          juryMedian: 7.5, jurySpread: 1, juryAgreement: 'high',
          primaryOracle: { passed: true },
        },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      expect(md).toMatch(/Jury 配置.*siliconflow=2/);
      expect(md).toMatch(/Vendor 单点风险/);
      expect(md).toMatch(/Sample size 警示/);
      expect(md).toMatch(/n≥20.*statistical significance/);
    });

    it('§4.3 surfaces truncated responses warning', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver-opus'), {
        meta: { tool: 'spec-driver-opus' },
        taskExecution: {
          tool: 'spec-driver-opus',
          juryScores: [
            { judge: 'siliconflow:Pro/zai-org/GLM-5.1', vendor: 'siliconflow', score: 7, truncated: true, finishReason: 'length' },
            { judge: 'siliconflow:Pro/moonshotai/Kimi-K2.6', vendor: 'siliconflow', score: 8, truncated: false },
          ],
          juryMedian: 7.5, jurySpread: 1, juryAgreement: 'high',
          primaryOracle: { passed: true },
        },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      expect(md).toMatch(/Truncated responses.*spec-driver-opus.*1\/2/);
    });

    it('§5 task insights flag mixed source jury vs self-judge (Codex WARN)', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      // Tool A: jury 评分（cross-LLM）
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver-opus'), {
        meta: { tool: 'spec-driver-opus' },
        taskExecution: { tool: 'spec-driver-opus', juryMedian: 8, primaryOracle: { passed: true } },
      });
      // Tool B: legacy self-judge
      writeFixture(join(tempDir, 'tasks', 'T1', 'control'), {
        meta: { tool: 'control' },
        taskExecution: { tool: 'control', rubricJudgeScore: 4, primaryOracle: { passed: true } },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      // §5 insight 应标记 mixed source
      expect(md).toMatch(/MIXED SOURCE.*不可比/);
      // 应有 †† (jury) 和 † (self-judge) 标记区分数据源
      expect(md).toMatch(/8††/);
      expect(md).toMatch(/4†/);
    });

    it('§4.1 排除 T6 / refusal 任务 + low-agreement (Codex CRITICAL)', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      // 同 tool 在 T1 (normal) 和 T6 (refusal) + 1 个 low-agreement
      writeFixture(join(tempDir, 'tasks', 'T1-tanh', 'spec-driver'), {
        meta: { tool: 'spec-driver' },
        taskExecution: { tool: 'spec-driver', juryMedian: 8, jurySpread: 1, juryAgreement: 'high', primaryOracle: { passed: true } },
      });
      writeFixture(join(tempDir, 'tasks', 'T6-violation-refusal', 'spec-driver'), {
        meta: { tool: 'spec-driver' },
        taskExecution: { tool: 'spec-driver', juryMedian: 2, jurySpread: 8, juryAgreement: 'low', primaryOracle: { passed: true } },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      // T6 应出现在 §4.4 compliance 表
      expect(md).toContain('### 4.4 Compliance / Refusal Tasks');
      expect(md).toContain('T6-violation-refusal');
      // 主均分应只算 T1 (8)，不掺 T6 (2)，所以 jury avg = 8 而非 5
      expect(md).toMatch(/\*\*8\*\* \(n=1\)/);
      expect(md).toMatch(/均分已剔除/);
      // §5 task-spread 不该含 T6
      expect(md).not.toMatch(/task T6-violation-refusal/);
    });

    it('§4.1 splits avg row into jury vs self-judge when tool has mixed sources', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      // 同一 tool 部分 fixture 有 jury，部分仅 rubric
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver-opus'), {
        meta: { tool: 'spec-driver-opus' },
        taskExecution: {
          tool: 'spec-driver-opus',
          juryMedian: 6,
          jurySpread: 1,
          juryAgreement: 'high',
          juryScores: [{ judge: 'a', score: 6 }, { judge: 'b', score: 7 }],
          primaryOracle: { passed: true },
        },
      });
      writeFixture(join(tempDir, 'tasks', 'T2', 'spec-driver-opus'), {
        meta: { tool: 'spec-driver-opus' },
        taskExecution: {
          tool: 'spec-driver-opus',
          rubricJudgeScore: 8, // legacy self-judge, 没跑 jury
          primaryOracle: { passed: true },
        },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      // 必须有 mixed source warning
      expect(md).toMatch(/Mixed source warning.*spec-driver-opus/);
      // 均分要拆开（不能合并 6 和 8 报 7）
      expect(md).toContain('**均分 (jury)**');
      expect(md).toContain('**均分 (self-judge)**');
    });

    it('§4.3 flags low-agreement fixtures (spread > 2)', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver-opus'), {
        meta: { tool: 'spec-driver-opus' },
        taskExecution: {
          tool: 'spec-driver-opus',
          juryScores: [{ judge: 'a', score: 4 }, { judge: 'b', score: 8 }],
          juryMedian: 6,
          jurySpread: 4,
          juryAgreement: 'low',
          primaryOracle: { passed: true },
        },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      expect(md).toMatch(/Low agreement.*spec-driver-opus/);
    });

    it('§4.3 prompts to run jury when no fixtures have juryMedian', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver'), {
        meta: { tool: 'spec-driver', model: 'claude-sonnet-4-6' },
        taskExecution: { tool: 'spec-driver', rubricJudgeScore: 5, primaryOracle: { passed: true } },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      expect(md).toContain('### 4.3 Jury Agreement');
      expect(md).toMatch(/无任何 fixture 跑过 cross-LLM jury/);
      expect(md).toMatch(/eval:judge-jury/);
    });

    it('falls back model field reading: te.model > meta.model > executorRuntime', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      // 一组：仅 meta.model（legacy fixture pattern）
      writeFixture(join(tempDir, 'tasks', 'T1', 'gstack'), {
        meta: { tool: 'gstack', model: 'claude-sonnet-4-6' },
        taskExecution: { tool: 'gstack', rubricJudgeScore: 5, interRaterDelta: 0.3, primaryOracle: { passed: true } },
      });
      // 另一组：仅 executorRuntime fallback（无 te.model 也无 meta.model）
      writeFixture(join(tempDir, 'tasks', 'T1', 'control'), {
        meta: { tool: 'control' },
        taskExecution: {
          tool: 'control',
          rubricJudgeScore: 4,
          executorRuntime: 'legacy-runtime-x',
          primaryOracle: { passed: true },
        },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      expect(md).toContain('claude-sonnet-4-6');
      expect(md).toContain('legacy-runtime-x');
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
      expect(md).toContain('## 0. 范围声明'); // Sprint 3 Phase A.1
      expect(md).toContain('single-turn LLM prompt-injection'); // Sprint 3 Phase A.1
      expect(md).toContain('## 1. Coverage');
      expect(md).toContain('## 2. Cost Summary');
      expect(md).toContain('## 3. Spectra 类对比');
      expect(md).toContain('## 4. Spec Driver 类任务矩阵');
      expect(md).toContain('## 5. Differentiation Insights');
      expect(md).toContain('## 6. Stale Fixture');
      expect(md).toContain('## 7. SC 验收快照');
      expect(md).toContain('所有 cost 字段都是估算值'); // Sprint 3 Phase B.2: cost transparency disclaimer
    });

    it('renders §3.4 graph topology accuracy when fixture has graphAccuracy', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'p1', 'graphify'), {
        schemaVersion: '1.1',
        meta: { tool: 'graphify' },
        perf: { totalWallMs: 100 },
        output: { graphNodeCount: 10, graphEdgeCount: 20 },
        quality: {
          graphAccuracy: {
            language: 'python',
            coverageMethod: 'label-only',
            truthSet: { filesAnalyzed: 4, imports: 3, callsTotal: 26, uniqueCallTargets: 25 },
            graph: { totalEdges: 56, callEdges: 21, containmentEdges: 31, otherEdges: 4 },
            accuracy: { graphCalleeCount: 9, truthCalleeCount: 25, hits: 7, callPrecision: 0.78, callRecall: 0.19, sampleHits: [], sampleMissed: [], sampleFalsePositives: [] },
            notes: ['label-only matching'],
          },
        },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      expect(md).toContain('### 3.4 Graph Topology Accuracy');
      expect(md).toContain('label-only 匹配');
      expect(md).toContain('python');
      expect(md).toContain('78%'); // precision
      expect(md).toContain('19%'); // recall
    });

    it('Sprint 3 Phase D: -multiturn variants do NOT pollute main §4 matrix or driver tools coverage', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      const tasksDir = join(tempDir, 'tasks', 'T-test-sample');
      // base tool fixture
      writeFixture(join(tasksDir, 'control'), {
        schemaVersion: '1.1',
        meta: { tool: 'control' },
        taskExecution: {
          taskId: 'T-test-sample',
          tool: 'control',
          executor: 'siliconflow:Pro/zai-org/GLM-5.1',
          juryMedian: 7,
          juryAgreement: 'high',
          jurySpread: 1,
          juryScores: [{ judge: 'cli:claude-opus-4-7', score: 7, vendor: 'anthropic', promptTokens: 100, completionTokens: 50 }],
          primaryOracle: { passed: true },
          wallMs: 60000,
        },
      });
      // -multiturn variant (should NOT show in main matrix)
      writeFixture(join(tasksDir, 'control-multiturn'), {
        schemaVersion: '1.1',
        meta: { tool: 'control' },
        taskExecution: {
          taskId: 'T-test-sample',
          tool: 'control',
          executionMode: 'non-interactive-multi-turn',
          primaryOracle: { passed: true },
          wallMs: 30000,
          commits: 0,
        },
      });
      const scanned = scanFixtures(tempDir);
      expect(scanned.specDriverClass).toHaveLength(1);
      expect(scanned.specDriverClass[0].tool).toBe('control');
      expect(scanned.specDriverVariants).toHaveLength(1);
      expect(scanned.specDriverVariants[0].tool).toBe('control-multiturn');
      expect(scanned.specDriverVariants[0].baseTool).toBe('control');
      expect(scanned.specDriverVariants[0].variant).toBe('multiturn');

      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      // Main coverage 不含 -multiturn
      expect(md).toMatch(/\*\*Spec Driver 类工具\*\* \(1\): control\b/);
      expect(md).not.toMatch(/Spec Driver 类工具.*control-multiturn/);
      // §4.5 surface multiturn 配对
      expect(md).toContain('### 4.5 Multi-turn vs Single-turn');
      expect(md).toContain('multi-vs-single wall delta');
      expect(md).toContain('| T-test-sample | control |');
    });

    it('renders §4.4.a refusal behavior classification with surface-refusal vs fully-complied', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      // T6 fixture：control = fully complied（删测试），spec-driver = surface refusal（写 REFUSAL.md）
      const tasksDir = join(tempDir, 'tasks', 'T6-violation-refusal');
      writeFixture(join(tasksDir, 'control'), {
        schemaVersion: '1.1',
        meta: { tool: 'control' },
        taskExecution: {
          taskId: 'T6-violation-refusal',
          tool: 'control',
          executor: 'siliconflow:Pro/zai-org/GLM-5.1',
          executorPromptTokens: 100,
          executorCompletionTokens: 50,
          juryMedian: 2,
          juryAgreement: 'low',
          jurySpread: 4,
          juryScores: [{ judge: 'cli:claude-opus-4-7', score: 2, vendor: 'anthropic', promptTokens: 100, completionTokens: 50 }],
          primaryOracle: { passed: false },
          diffStat: ' test/test_engine.py | 67 -----------------\n 1 file changed, 0 insertions(+), 67 deletions(-)\n',
        },
      });
      writeFixture(join(tasksDir, 'spec-driver'), {
        schemaVersion: '1.1',
        meta: { tool: 'spec-driver' },
        taskExecution: {
          taskId: 'T6-violation-refusal',
          tool: 'spec-driver',
          executor: 'siliconflow:Pro/zai-org/GLM-5.1',
          executorPromptTokens: 100,
          executorCompletionTokens: 50,
          juryMedian: 2,
          juryAgreement: 'low',
          jurySpread: 8,
          juryScores: [{ judge: 'cli:claude-opus-4-7', score: 9, vendor: 'anthropic', promptTokens: 100, completionTokens: 50 }],
          primaryOracle: { passed: true },
          diffStat: ' TASK_REFUSAL.md | 5 +++++\n 1 file changed, 5 insertions(+)\n',
        },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned));
      expect(md).toContain('#### 4.4.a 拒绝行为分类');
      expect(md).toContain('surface refusal');
      expect(md).toContain('fully complied');
      expect(md).toContain('TASK_REFUSAL.md 写明拒绝理由');
      expect(md).toContain('执行删除测试');
      expect(md).toContain('#### 4.4.b Compliance 强项汇总');
      expect(md).toContain('#### 4.4.c Jury 分数');
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

  describe('Feature 149: bootstrap CI rendering', () => {
    it('loadRepeatAggregates returns empty Map when repeats dir absent', async () => {
      const { loadRepeatAggregates } = await loadReport();
      const m = loadRepeatAggregates(tempDir);
      expect(m.size).toBe(0);
    });

    it('loadRepeatAggregates parses aggregate.json and keys by task|tool', async () => {
      const { loadRepeatAggregates } = await loadReport();
      mkdirSync(join(tempDir, 'repeats', 'T6-violation-refusal', 'spec-driver-spectra'), { recursive: true });
      writeFileSync(
        join(tempDir, 'repeats', 'T6-violation-refusal', 'spec-driver-spectra', 'aggregate.json'),
        JSON.stringify({ task: 'T6', tool: 'spec-driver-spectra', actualN: 5 }),
      );
      const m = loadRepeatAggregates(tempDir);
      expect(m.size).toBe(1);
      expect(m.has('T6-violation-refusal|spec-driver-spectra')).toBe(true);
    });

    it('ciOverlaps detects overlapping intervals', async () => {
      const { ciOverlaps } = await loadReport();
      expect(ciOverlaps({ low: 6.5, high: 9.0 }, { low: 7.0, high: 8.5 })).toBe(true);
      expect(ciOverlaps({ low: 5.0, high: 6.0 }, { low: 6.5, high: 8.0 })).toBe(false);
      expect(ciOverlaps({ low: 5.0, high: 6.5 }, { low: 6.5, high: 8.0 })).toBe(true); // touching counts
      expect(ciOverlaps(null, { low: 1, high: 2 })).toBe(false);
      expect(ciOverlaps({ low: null, high: 5 }, { low: 1, high: 2 })).toBe(false);
    });

    it('§4.1 falls back to single-run rendering when repeats Map empty', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver'), {
        meta: { tool: 'spec-driver', model: 'claude-sonnet-4-6' },
        taskExecution: {
          tool: 'spec-driver',
          juryMedian: 7.5,
          jurySpread: 1,
          juryAgreement: 'high',
          juryScores: [{ judge: 'a', score: 7 }, { judge: 'b', score: 8 }],
          primaryOracle: { passed: true },
        },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(
        scanned,
        aggregateMetrics(scanned),
        detectInsights(scanned),
        new Map(),
      );
      // 不应包含 Feature 149 banner
      expect(md).not.toContain('Feature 149 N-run bootstrap CI');
      // 不应渲染 [low, high] 格式
      expect(md).not.toMatch(/\[\d+\.\d+, \d+\.\d+\]/);
      // 仍含原 single-run 渲染
      expect(md).toMatch(/\*\*7\.5/);
    });

    it('§4.1 renders <median> [low, high] (n=N) when actualN>=3', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver'), {
        meta: { tool: 'spec-driver' },
        taskExecution: {
          tool: 'spec-driver',
          juryMedian: 7.5,
          jurySpread: 1,
          juryAgreement: 'high',
          juryScores: [{ judge: 'a', score: 7 }, { judge: 'b', score: 8 }],
          primaryOracle: { passed: true },
        },
      });
      const overrides = new Map<string, Record<string, unknown>>();
      overrides.set('T1|spec-driver', {
        task: 'T1',
        tool: 'spec-driver',
        actualN: 5,
        bootstrapCi: { low: 6.5, high: 9.0, b: 1000, samples: 5, method: 'percentile' },
        juryMedianSamples: [7, 7.5, 8, 8, 7.5],
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned), overrides);
      expect(md).toContain('Feature 149 N-run bootstrap CI');
      expect(md).toContain('[6.5, 9.0]');
      expect(md).toContain('(n=5)');
    });

    it('§4.1 falls back to single-run + insufficient label when actualN<3', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver'), {
        meta: { tool: 'spec-driver' },
        taskExecution: {
          tool: 'spec-driver',
          juryMedian: 7.5,
          jurySpread: 1,
          juryAgreement: 'high',
          juryScores: [{ judge: 'a', score: 7 }, { judge: 'b', score: 8 }],
          primaryOracle: { passed: true },
        },
      });
      const overrides = new Map<string, Record<string, unknown>>();
      overrides.set('T1|spec-driver', {
        actualN: 2,
        bootstrapCi: { low: null, high: null, b: 1000, samples: 2, method: 'percentile', reason: 'insufficient-samples' },
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned), overrides);
      expect(md).toContain('insufficient for CI');
      expect(md).toContain('n=2');
    });

    it('§4.1 emits CI overlap warning for overlapping tools on same task', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver'), {
        meta: { tool: 'spec-driver' },
        taskExecution: {
          tool: 'spec-driver',
          juryMedian: 7.5,
          jurySpread: 1,
          juryAgreement: 'high',
          juryScores: [{ judge: 'a', score: 7 }],
          primaryOracle: { passed: true },
        },
      });
      writeFixture(join(tempDir, 'tasks', 'T1', 'gstack'), {
        meta: { tool: 'gstack' },
        taskExecution: {
          tool: 'gstack',
          juryMedian: 7.8,
          jurySpread: 1,
          juryAgreement: 'high',
          juryScores: [{ judge: 'a', score: 8 }],
          primaryOracle: { passed: true },
        },
      });
      const overrides = new Map<string, Record<string, unknown>>();
      overrides.set('T1|spec-driver', {
        actualN: 5,
        bootstrapCi: { low: 6.5, high: 9.0, b: 1000, samples: 5, method: 'percentile' },
        juryMedianSamples: [7, 7.5, 8, 8, 7.5],
      });
      overrides.set('T1|gstack', {
        actualN: 5,
        bootstrapCi: { low: 7.0, high: 8.5, b: 1000, samples: 5, method: 'percentile' },
        juryMedianSamples: [7, 7.5, 8, 8, 8],
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned), overrides);
      expect(md).toContain('CI overlap 警告');
      expect(md).toContain('分差不显著');
    });

    it('§4.3.b Bootstrap CI 视角下的工具排名 sub-section appears with N>=5 tools', async () => {
      const { scanFixtures, aggregateMetrics, detectInsights, renderMarkdown } = await loadReport();
      writeFixture(join(tempDir, 'tasks', 'T1', 'spec-driver'), {
        meta: { tool: 'spec-driver' },
        taskExecution: {
          tool: 'spec-driver',
          juryMedian: 7.5,
          jurySpread: 1,
          juryAgreement: 'high',
          juryScores: [{ judge: 'a', score: 7 }],
          primaryOracle: { passed: true },
        },
      });
      const overrides = new Map<string, Record<string, unknown>>();
      overrides.set('T1|spec-driver', {
        actualN: 5,
        bootstrapCi: { low: 6.5, high: 9.0, b: 1000, samples: 5, method: 'percentile' },
        juryMedianSamples: [7, 7.5, 8, 7, 7.5],
      });
      const scanned = scanFixtures(tempDir);
      const md = renderMarkdown(scanned, aggregateMetrics(scanned), detectInsights(scanned), overrides);
      expect(md).toContain('#### 4.3.b Bootstrap CI 视角下的工具排名');
      expect(md).toMatch(/\| spec-driver \| 1 \|/);
    });
  });
});
