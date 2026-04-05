import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const RECORD_SCRIPT = resolve('plugins/spec-driver/scripts/record-workflow-run.mjs');
const REPORT_SCRIPT = resolve('plugins/spec-driver/scripts/generate-adoption-insights.mjs');

describe('spec-driver adoption insights', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'spec-driver-adoption-'));
    mkdirSync(join(projectRoot, 'specs', 'products', 'spec-driver'), { recursive: true });
    mkdirSync(join(projectRoot, 'specs', 'products', 'spec-driver', '_generated'), { recursive: true });
    mkdirSync(join(projectRoot, '.specify', 'runs'), { recursive: true });

    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'workflow-index.json'),
      JSON.stringify({
        workflows: [
          { id: 'spec-driver-feature', title: '新功能研发', persona: '功能开发者' },
          { id: 'spec-driver-sync', title: '产品事实聚合', persona: '产品文档负责人' },
          { id: 'spec-driver-doc', title: '开源文档生成', persona: '开源维护者' },
        ],
        goldenPaths: [],
      }, null, 2),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'scorecard-report.json'),
      JSON.stringify({
        status: 'fail',
        score: 68,
      }, null, 2),
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('记录 run summary 并聚合 adoption / friction hotspots', () => {
    execFileSync('node', [
      RECORD_SCRIPT,
      '--project-root', projectRoot,
      '--workflow-id', 'spec-driver-feature',
      '--run-id', '063-product-entity-catalog',
      '--result', 'success',
      '--duration-ms', '120000',
      '--completed-phases', 'constitution,research,specify,clarify,plan,tasks,analyze,implement,verify',
      '--phase-duration', 'research:60000',
      '--phase-duration', 'verify:30000',
      '--artifact', 'specs/063-product-entity-catalog/spec.md',
      '--json',
    ], { encoding: 'utf-8' });

    execFileSync('node', [
      RECORD_SCRIPT,
      '--project-root', projectRoot,
      '--workflow-id', 'spec-driver-feature',
      '--run-id', '064-workflow-registry-golden-paths',
      '--result', 'failed',
      '--duration-ms', '90000',
      '--rerun',
      '--rerun-phase', 'implement',
      '--verification-failure', 'specs/064-workflow-registry-golden-paths/verification/verification-report.md::tests-failed',
      '--artifact', 'specs/064-workflow-registry-golden-paths/spec.md',
      '--json',
    ], { encoding: 'utf-8' });

    const syncPayload = JSON.parse(execFileSync('node', [
      RECORD_SCRIPT,
      '--project-root', projectRoot,
      '--workflow-id', 'spec-driver-sync',
      '--run-id', 'sync-20260405',
      '--result', 'paused',
      '--gate-pause', 'GATE_RESEARCH:research',
      '--artifact', 'specs/products/spec-driver/current-spec.md',
      '--json',
    ], { encoding: 'utf-8' })) as { jsonlPath: string };

    appendFileSync(join(projectRoot, syncPayload.jsonlPath), '{invalid jsonl}\n', 'utf-8');

    const stdout = execFileSync('node', [REPORT_SCRIPT, '--project-root', projectRoot, '--json'], {
      encoding: 'utf-8',
    });
    const payload = JSON.parse(stdout) as {
      status: string;
      totalRuns: number;
      jsonPath: string;
      markdownPath: string;
      warnings: string[];
    };

    expect(payload.status).toBe('attention');
    expect(payload.totalRuns).toBe(3);
    expect(payload.jsonPath).toBe('specs/products/spec-driver/_generated/adoption-report.json');
    expect(payload.markdownPath).toBe('specs/products/spec-driver/_generated/adoption-report.md');
    expect(payload.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('忽略损坏的 JSONL 行'),
    ]));

    const report = JSON.parse(
      readFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'adoption-report.json'), 'utf-8'),
    ) as {
      status: string;
      summary: { totalRuns: number; overallSuccessRate: number };
      workflowSummaries: Array<{ id: string; totalRuns: number; successRate: number; failureRate: number }>;
      friction: {
        rerunHotspots: Array<{ phase: string; count: number }>;
        gatePauseHotspots: Array<{ gate: string; count: number }>;
        verificationFailureHotspots: Array<{ failure: string; count: number }>;
        slowestPhases: Array<{ phase: string; averageDurationMs: number }>;
      };
      scorecardContext: { status: string; score: number } | null;
      stats: { invalidLineCount: number; runsWithPhaseDurations: number };
    };

    expect(report.status).toBe('attention');
    expect(report.summary.totalRuns).toBe(3);
    expect(report.summary.overallSuccessRate).toBeCloseTo(33.3, 1);
    expect(report.workflowSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'spec-driver-feature',
        totalRuns: 2,
        successRate: 50,
        failureRate: 50,
      }),
      expect.objectContaining({
        id: 'spec-driver-sync',
        totalRuns: 1,
      }),
    ]));
    expect(report.friction.rerunHotspots).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'implement', count: 1 }),
    ]));
    expect(report.friction.gatePauseHotspots).toEqual(expect.arrayContaining([
      expect.objectContaining({ gate: 'GATE_RESEARCH @ research', count: 1 }),
    ]));
    expect(report.friction.verificationFailureHotspots).toEqual(expect.arrayContaining([
      expect.objectContaining({ failure: 'tests-failed (specs/064-workflow-registry-golden-paths/verification/verification-report.md)', count: 1 }),
    ]));
    expect(report.friction.slowestPhases).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'research', averageDurationMs: 60000 }),
    ]));
    expect(report.scorecardContext).toEqual(expect.objectContaining({
      status: 'fail',
      score: 68,
    }));
    expect(report.stats.invalidLineCount).toBe(1);
    expect(report.stats.runsWithPhaseDurations).toBe(1);

    const markdownReport = readFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'adoption-report.md'),
      'utf-8',
    );
    expect(markdownReport).toContain('# Spec Driver Adoption Report');
    expect(markdownReport).toContain('## Workflow Usage');
    expect(markdownReport).toContain('GATE_RESEARCH @ research');
    expect(markdownReport).toContain('tests-failed');
  });

  it('在缺少 run logs 时降级生成空 adoption 报告', () => {
    rmSync(join(projectRoot, '.specify', 'runs'), { recursive: true, force: true });

    const stdout = execFileSync('node', [REPORT_SCRIPT, '--project-root', projectRoot, '--json'], {
      encoding: 'utf-8',
    });
    const payload = JSON.parse(stdout) as {
      status: string;
      totalRuns: number;
      warnings: string[];
    };

    expect(payload.status).toBe('insufficient-data');
    expect(payload.totalRuns).toBe(0);
    expect(payload.warnings).toEqual(expect.arrayContaining([
      '未找到 .specify/runs/，adoption 报告将以空样本生成',
    ]));
  });
});
