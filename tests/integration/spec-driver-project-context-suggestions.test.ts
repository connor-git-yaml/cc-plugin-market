import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseYamlDocument } from '../../src/panoramic/parsers/yaml-config-parser.js';

const SCRIPT_PATH = resolve('plugins/spec-driver/scripts/generate-project-context-suggestions.mjs');

describe('generate-project-context-suggestions.mjs', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'spec-driver-context-suggestions-'));
    mkdirSync(join(projectRoot, '.specify'), { recursive: true });
    mkdirSync(join(projectRoot, 'specs', 'products', 'spec-driver', '_generated'), { recursive: true });
    mkdirSync(join(projectRoot, 'specs', 'products', 'spectra', '_generated'), { recursive: true });

    writeFileSync(join(projectRoot, 'README.md'), '# Demo Repo\n', 'utf-8');
    writeFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', 'current-spec.md'), '# Spec Driver\n', 'utf-8');
    writeFileSync(join(projectRoot, 'specs', 'products', 'spectra', 'current-spec.md'), '# Reverse-Spec\n', 'utf-8');
    writeFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'quality-report.md'), '# Quality\n', 'utf-8');
    writeFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'scorecard-report.md'), '# Scorecard\n', 'utf-8');
    writeFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'adoption-report.md'), '# Adoption\n', 'utf-8');

    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'entity.yaml'),
      [
        'id: "spec-driver"',
        'owner:',
        '  value: "unknown"',
        '  source: "unknown"',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spectra', '_generated', 'entity.yaml'),
      [
        'id: "spectra"',
        'owner:',
        '  value: "unknown"',
        '  source: "unknown"',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'workflow-index.json'),
      JSON.stringify({
        workflows: [
          { id: 'spec-driver-feature' },
          { id: 'spec-driver-implement' },
          { id: 'spec-driver-sync' },
        ],
      }, null, 2),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'scorecard-report.json'),
      JSON.stringify({
        status: 'warn',
        score: 82,
        rules: [
          {
            id: 'verification-freshness',
            status: 'warn',
            score: 70,
            evidence: {
              coverageRatio: 0.75,
            },
          },
        ],
      }, null, 2),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'adoption-report.json'),
      JSON.stringify({
        status: 'attention',
        summary: {
          topWorkflow: {
            id: 'spec-driver-feature',
            title: '新功能研发',
            totalRuns: 4,
          },
        },
        friction: {
          verificationFailureHotspots: [
            {
              failure: 'tests-failed',
              count: 2,
            },
          ],
        },
      }, null, 2),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'quality-report.json'),
      JSON.stringify({
        status: 'warn',
        conflicts: [
          {
            topic: 'product-positioning',
            severity: 'medium',
            sources: [
              { path: 'specs/products/spec-driver/current-spec.md' },
              { path: 'README.md' },
            ],
          },
        ],
      }, null, 2),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spectra', '_generated', 'quality-report.json'),
      JSON.stringify({
        status: 'pass',
        conflicts: [],
      }, null, 2),
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('聚合治理信号并生成 context suggestions', () => {
    const stdout = execFileSync('node', [SCRIPT_PATH, '--project-root', projectRoot, '--json'], {
      encoding: 'utf-8',
    });
    const payload = JSON.parse(stdout) as {
      status: string;
      yamlPath: string;
      markdownPath: string;
      suggestionCount: number;
      criticalCount: number;
      recommendedCount: number;
    };

    expect(payload.status).toBe('attention');
    expect(payload.yamlPath).toBe('.specify/project-context.suggestions.yaml');
    expect(payload.markdownPath).toBe('.specify/project-context.suggestions.md');
    expect(payload.suggestionCount).toBe(6);
    expect(payload.criticalCount).toBe(1);
    expect(payload.recommendedCount).toBe(5);

    const yamlReport = parseYamlDocument(
      readFileSync(join(projectRoot, '.specify', 'project-context.suggestions.yaml'), 'utf-8'),
    ) as {
      contextSource: { state: string };
      suggestions: Array<{ id: string; priority: string; suggestedChanges?: Array<{ field: string }> }>;
    };

    expect(yamlReport.contextSource.state).toBe('missing');
    expect(yamlReport.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'create-project-context-yaml', priority: 'recommended' }),
      expect.objectContaining({ id: 'add-stable-reference-documents', priority: 'recommended' }),
      expect.objectContaining({ id: 'codify-workflow-preferences', priority: 'recommended' }),
      expect.objectContaining({ id: 'codify-verification-policy', priority: 'critical' }),
      expect.objectContaining({ id: 'declare-default-owner-and-reviewers', priority: 'recommended' }),
      expect.objectContaining({ id: 'protect-high-risk-paths', priority: 'recommended' }),
    ]));
    expect(
      yamlReport.suggestions.find((suggestion) => suggestion.id === 'create-project-context-yaml')?.suggestedChanges,
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'project_context.source' }),
      expect.objectContaining({ field: 'references.paths' }),
    ]));

    const markdownReport = readFileSync(
      join(projectRoot, '.specify', 'project-context.suggestions.md'),
      'utf-8',
    );
    expect(markdownReport).toContain('# Project Context Suggestions');
    expect(markdownReport).toContain('[CRITICAL] 把验证偏好固化到 Project Context');
    expect(markdownReport).toContain('specs/products/spec-driver/current-spec.md');
    expect(markdownReport).toContain('tests-failed');
  });

  it('在 yaml 与 legacy markdown 并存时给出去重建议', () => {
    writeFileSync(join(projectRoot, '.specify', 'project-context.yaml'), 'workflow_preferences: {}\n', 'utf-8');
    writeFileSync(join(projectRoot, '.specify', 'project-context.md'), '# Legacy Context\n', 'utf-8');

    execFileSync('node', [SCRIPT_PATH, '--project-root', projectRoot, '--json'], {
      encoding: 'utf-8',
    });

    const yamlReport = parseYamlDocument(
      readFileSync(join(projectRoot, '.specify', 'project-context.suggestions.yaml'), 'utf-8'),
    ) as {
      contextSource: { state: string };
      warnings: string[];
      suggestions: Array<{ id: string; priority: string }>;
    };

    expect(yamlReport.contextSource.state).toBe('dual');
    expect(yamlReport.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('同时检测到 .specify/project-context.yaml 与 .specify/project-context.md'),
    ]));
    expect(yamlReport.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dedupe-project-context-sources', priority: 'critical' }),
    ]));
  });
});
