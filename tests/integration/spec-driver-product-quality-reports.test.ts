import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseYamlDocument } from '../../src/panoramic/parsers/yaml-config-parser.js';

const SCRIPT_PATH = resolve('plugins/spec-driver/scripts/generate-product-quality-reports.mjs');

describe('generate-product-quality-reports.mjs', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'spec-driver-product-quality-'));
    mkdirSync(join(projectRoot, 'specs', 'products', 'reverse-spec'), { recursive: true });
    mkdirSync(join(projectRoot, 'specs', 'products', 'spec-driver'), { recursive: true });
    mkdirSync(join(projectRoot, 'specs', 'products', 'reverse-spec', '_generated'), { recursive: true });
    mkdirSync(join(projectRoot, 'specs', 'products', 'spec-driver', '_generated'), { recursive: true });
    mkdirSync(join(projectRoot, 'specs', 'products', '_generated'), { recursive: true });

    writeFileSync(
      join(projectRoot, 'specs', 'products', 'product-mapping.yaml'),
      [
        'products:',
        '  reverse-spec:',
        '    description: "Reverse-Spec 文档平台"',
        '    specs: []',
        '  spec-driver:',
        '    description: "Spec Driver 编排器"',
        '    specs: []',
      ].join('\n'),
      'utf-8',
    );

    writeFileSync(join(projectRoot, 'README.md'), '# Demo Repo\n', 'utf-8');

    writeFileSync(
      join(projectRoot, 'specs', 'products', 'reverse-spec', 'current-spec.md'),
      '# Reverse-Spec\n\n> **状态**: 活跃\n',
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', 'current-spec.md'),
      '# Spec Driver\n\n> **状态**: 活跃\n',
      'utf-8',
    );

    writeFileSync(
      join(projectRoot, 'specs', 'products', 'reverse-spec', '_generated', 'scorecard-report.json'),
      JSON.stringify({ status: 'pass', stats: { score: 100 } }, null, 2),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'scorecard-report.json'),
      JSON.stringify({ status: 'pass', stats: { score: 100 } }, null, 2),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'workflow-index.json'),
      JSON.stringify({ workflows: [{ id: 'spec-driver-sync' }], goldenPaths: [{ id: 'sync-governance' }] }, null, 2),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'adoption-report.json'),
      JSON.stringify({ status: 'healthy', totalRuns: 5 }, null, 2),
      'utf-8',
    );

    writeFileSync(
      join(projectRoot, 'specs', 'products', 'reverse-spec', '_generated', 'entity.yaml'),
      [
        'id: "reverse-spec"',
        'name: "Reverse-Spec"',
        'kind: "library-tooling"',
        'docs:',
        '  - id: "current-spec"',
        '    path: "specs/products/reverse-spec/current-spec.md"',
        '    available: true',
        '  - id: "readme"',
        '    path: "README.md"',
        '    available: true',
        'quality:',
        '  report:',
        '    path: null',
        '    status: "unavailable"',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'entity.yaml'),
      [
        'id: "spec-driver"',
        'name: "Spec Driver"',
        'kind: "plugin"',
        'docs:',
        '  - id: "current-spec"',
        '    path: "specs/products/spec-driver/current-spec.md"',
        '    available: true',
        '  - id: "readme"',
        '    path: "README.md"',
        '    available: true',
        'workflowRefs:',
        '  - "spec-driver-sync"',
        'quality:',
        '  report:',
        '    path: null',
        '    status: "unavailable"',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', '_generated', 'catalog-index.yaml'),
      [
        'schemaVersion: 1',
        'products:',
        '  - id: "reverse-spec"',
        '    entityPath: "specs/products/reverse-spec/_generated/entity.yaml"',
        '    qualityStatus: "unavailable"',
        '  - id: "spec-driver"',
        '    entityPath: "specs/products/spec-driver/_generated/entity.yaml"',
        '    qualityStatus: "unavailable"',
      ].join('\n'),
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('为产品生成 quality report，并回写 entity/catalog 摘要', () => {
    const stdout = execFileSync('node', [SCRIPT_PATH, '--project-root', projectRoot, '--json'], {
      encoding: 'utf-8',
    });
    const payload = JSON.parse(stdout) as {
      qualityReportIndexPath: string;
      products: Array<{ id: string; status: string; reportPath: string }>;
    };

    expect(payload.qualityReportIndexPath).toBe('specs/products/_generated/quality-report-index.yaml');
    expect(payload.products).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'reverse-spec',
        status: 'pass',
        reportPath: 'specs/products/reverse-spec/_generated/quality-report.json',
      }),
      expect.objectContaining({
        id: 'spec-driver',
        status: 'pass',
        reportPath: 'specs/products/spec-driver/_generated/quality-report.json',
      }),
    ]));

    const reverseReport = JSON.parse(
      readFileSync(join(projectRoot, 'specs', 'products', 'reverse-spec', '_generated', 'quality-report.json'), 'utf-8'),
    ) as {
      stats: { totalRequiredDocs: number; coveredRequiredDocs: number };
      conflicts: unknown[];
    };
    expect(reverseReport.stats.totalRequiredDocs).toBe(3);
    expect(reverseReport.stats.coveredRequiredDocs).toBe(3);
    expect(reverseReport.conflicts).toEqual([]);

    const specDriverReport = JSON.parse(
      readFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', '_generated', 'quality-report.json'), 'utf-8'),
    ) as {
      stats: { totalRequiredDocs: number; coveredRequiredDocs: number };
    };
    expect(specDriverReport.stats.totalRequiredDocs).toBe(5);
    expect(specDriverReport.stats.coveredRequiredDocs).toBe(5);

    const reverseEntity = parseYamlDocument(
      readFileSync(join(projectRoot, 'specs', 'products', 'reverse-spec', '_generated', 'entity.yaml'), 'utf-8'),
    ) as {
      quality: { report: { path: string; status: string } };
    };
    expect(reverseEntity.quality.report.path).toBe('specs/products/reverse-spec/_generated/quality-report.json');
    expect(reverseEntity.quality.report.status).toBe('pass');

    const catalogIndexRaw = readFileSync(
      join(projectRoot, 'specs', 'products', '_generated', 'catalog-index.yaml'),
      'utf-8',
    );
    expect(catalogIndexRaw).toContain('qualityStatus: "pass"');
    expect(catalogIndexRaw).toContain('qualityReportPath: "specs/products/reverse-spec/_generated/quality-report.json"');
    expect(catalogIndexRaw).toContain('qualityReportPath: "specs/products/spec-driver/_generated/quality-report.json"');
  });
});
