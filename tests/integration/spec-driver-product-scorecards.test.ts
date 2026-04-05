import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseYamlDocument } from '../../src/panoramic/parsers/yaml-config-parser.js';

const SCRIPT_PATH = resolve('plugins/spec-driver/scripts/generate-product-scorecards.mjs');

describe('generate-product-scorecards.mjs', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'spec-driver-scorecards-'));
    execFileSync('git', ['init', '--initial-branch=master'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/demo.git'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master'], { cwd: projectRoot, stdio: 'ignore' });
    mkdirSync(join(projectRoot, 'specs', 'products', 'reverse-spec'), { recursive: true });
    mkdirSync(join(projectRoot, 'specs', 'products', 'spec-driver'), { recursive: true });
    mkdirSync(join(projectRoot, 'docs', 'shared'), { recursive: true });

    writeFileSync(join(projectRoot, 'README.md'), '# Demo Repo\n', 'utf-8');
    writeFileSync(join(projectRoot, 'AGENTS.md'), '<!-- BEGIN SHARED SECTION: branch-sync-policy -->', 'utf-8');
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '<!-- BEGIN SHARED SECTION: branch-sync-policy -->', 'utf-8');
    writeFileSync(
      join(projectRoot, 'docs', 'shared', 'agent-branch-sync-policy.md'),
      '- `feature/*` 提交前使用 `git rebase master`\n',
      'utf-8',
    );

    writeFileSync(
      join(projectRoot, 'specs', 'products', 'product-mapping.yaml'),
      [
        'products:',
        '  reverse-spec:',
        '    description: "Reverse-Spec 文档平台"',
        '    specs:',
        '      - id: "001-core"',
        '        type: FEATURE',
        '        summary: "核心能力"',
        '      - id: "002-draft-debt"',
        '        type: FEATURE',
        '        summary: "历史草稿债"',
        '  spec-driver:',
        '    description: "Spec Driver 编排器"',
        '    specs:',
        '      - id: "011-driver"',
        '        type: FEATURE',
        '        summary: "驱动能力"',
        '      - id: "012-blueprint"',
        '        type: BLUEPRINT',
        '        summary: "治理蓝图"',
      ].join('\n'),
      'utf-8',
    );

    mkdirSync(join(projectRoot, 'specs', '001-core', 'verification'), { recursive: true });
    writeFileSync(join(projectRoot, 'specs', '001-core', 'spec.md'), '# 001 Core\n\n**Status**: Implemented\n', 'utf-8');
    writeFileSync(
      join(projectRoot, 'specs', '001-core', 'verification', 'verification-report.md'),
      '# Verification\n\n- Status: PASS\n',
      'utf-8',
    );

    mkdirSync(join(projectRoot, 'specs', '002-draft-debt'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'specs', '002-draft-debt', 'spec.md'),
      '# 002 Draft Debt\n\n**Status**: Draft\n',
      'utf-8',
    );

    mkdirSync(join(projectRoot, 'specs', '011-driver', 'verification'), { recursive: true });
    writeFileSync(join(projectRoot, 'specs', '011-driver', 'spec.md'), '# 011 Driver\n\n**Status**: Implemented\n', 'utf-8');
    writeFileSync(
      join(projectRoot, 'specs', '011-driver', 'verification', 'verification-report.md'),
      '# Verification\n\n- Status: PASS\n',
      'utf-8',
    );

    mkdirSync(join(projectRoot, 'specs', '012-blueprint'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'specs', '012-blueprint', 'blueprint.md'),
      '# 012 Blueprint\n\n**状态**: Implemented\n',
      'utf-8',
    );

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

    utimesSync(join(projectRoot, 'specs', 'products', 'reverse-spec', 'current-spec.md'), new Date(), new Date(Date.now() + 1000));
    utimesSync(join(projectRoot, 'specs', 'products', 'spec-driver', 'current-spec.md'), new Date(), new Date(Date.now() + 1000));

    writeFileSync(
      join(projectRoot, 'specs', 'products', 'reverse-spec', 'entity.yaml'),
      [
        'id: "reverse-spec"',
        'name: "Reverse-Spec"',
        'kind: "library-tooling"',
        'docs:',
        '  - id: "current-spec"',
        '    available: true',
        'workflowRefs:',
        '  - "reverse-spec.generate"',
        '  - "reverse-spec.batch"',
        'quality:',
        '  report:',
        '    path: "specs/quality-report.json"',
        '    status: "warn"',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', 'entity.yaml'),
      [
        'id: "spec-driver"',
        'name: "Spec Driver"',
        'kind: "plugin"',
        'docs:',
        '  - id: "current-spec"',
        '    available: true',
        'workflowRefs:',
        '  - "spec-driver-feature"',
        '  - "spec-driver-story"',
        '  - "spec-driver-fix"',
        '  - "spec-driver-resume"',
        '  - "spec-driver-sync"',
        '  - "spec-driver-doc"',
        'quality:',
        '  report:',
        '    path: "specs/quality-report.json"',
        '    status: "warn"',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'catalog-index.yaml'),
      [
        'schemaVersion: 1',
        'products:',
        '  - id: "reverse-spec"',
        '    entityPath: "specs/products/reverse-spec/entity.yaml"',
        '    qualityStatus: "warn"',
        '  - id: "spec-driver"',
        '    entityPath: "specs/products/spec-driver/entity.yaml"',
        '    qualityStatus: "warn"',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', 'workflow-index.json'),
      JSON.stringify({
        workflows: [
          { id: 'spec-driver-feature' },
          { id: 'spec-driver-story' },
          { id: 'spec-driver-fix' },
          { id: 'spec-driver-resume' },
          { id: 'spec-driver-sync' },
          { id: 'spec-driver-doc' },
        ],
        goldenPaths: [{ id: 'new-feature-delivery' }],
      }, null, 2),
      'utf-8',
    );
    writeFileSync(
      join(projectRoot, 'specs', 'quality-report.json'),
      JSON.stringify({
        status: 'warn',
        stats: {
          totalRequiredDocs: 12,
          coveredRequiredDocs: 12,
        },
        conflicts: [],
        requiredDocs: [],
      }, null, 2),
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('为产品生成 scorecard 报告，并回写 entity/catalog 摘要', () => {
    const stdout = execFileSync('node', [SCRIPT_PATH, '--project-root', projectRoot, '--json'], {
      encoding: 'utf-8',
    });
    const payload = JSON.parse(stdout) as {
      scorecardIndexPath: string;
      products: Array<{ id: string; markdownPath: string }>;
      warnings: string[];
    };

    expect(payload.scorecardIndexPath).toBe('specs/products/scorecard-index.yaml');
    expect(payload.warnings).toEqual([]);
    expect(payload.products).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'reverse-spec',
        markdownPath: 'specs/products/reverse-spec/scorecard-report.md',
      }),
      expect.objectContaining({
        id: 'spec-driver',
        markdownPath: 'specs/products/spec-driver/scorecard-report.md',
      }),
    ]));

    const reverseReport = JSON.parse(
      readFileSync(join(projectRoot, 'specs', 'products', 'reverse-spec', 'scorecard-report.json'), 'utf-8'),
    ) as {
      rules: Array<{ id: string; status: string; evidence: Record<string, unknown> }>;
    };
    expect(reverseReport.rules.find((rule) => rule.id === 'docs-coverage')?.status).toBe('pass');
    expect(reverseReport.rules.find((rule) => rule.id === 'verification-freshness')?.status).toBe('pass');
    expect(reverseReport.rules.find((rule) => rule.id === 'verification-freshness')?.evidence).toEqual(
      expect.objectContaining({
        totalFeatures: 1,
        ignored: expect.objectContaining({
          nonImplemented: ['002-draft-debt'],
        }),
      }),
    );

    const specDriverReport = readFileSync(
      join(projectRoot, 'specs', 'products', 'spec-driver', 'scorecard-report.md'),
      'utf-8',
    );
    expect(specDriverReport).toContain('# Spec Driver Scorecard Report');
    expect(specDriverReport).toContain('Workflow 就绪度');
    const specDriverReportJson = JSON.parse(
      readFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', 'scorecard-report.json'), 'utf-8'),
    ) as {
      rules: Array<{ id: string; evidence: Record<string, unknown> }>;
    };
    expect(specDriverReportJson.rules.find((rule) => rule.id === 'verification-freshness')?.evidence).toEqual(
      expect.objectContaining({
        totalFeatures: 1,
        ignored: expect.objectContaining({
          blueprint: ['012-blueprint'],
        }),
      }),
    );

    const reverseEntity = parseYamlDocument(
      readFileSync(join(projectRoot, 'specs', 'products', 'reverse-spec', 'entity.yaml'), 'utf-8'),
    ) as {
      quality: { scorecard: { path: string; status: string } };
    };
    expect(reverseEntity.quality.scorecard.path).toBe('specs/products/reverse-spec/scorecard-report.json');
    expect(reverseEntity.quality.scorecard.status).toBe('pass');

    const catalogIndex = parseYamlDocument(
      readFileSync(join(projectRoot, 'specs', 'products', 'catalog-index.yaml'), 'utf-8'),
    ) as {
      products: Array<{ id: string; scorecardStatus: string }>;
    };
    expect(catalogIndex.products).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'reverse-spec',
        scorecardStatus: 'pass',
      }),
      expect.objectContaining({
        id: 'spec-driver',
        scorecardStatus: 'pass',
      }),
    ]));

    const scorecardIndex = parseYamlDocument(
      readFileSync(join(projectRoot, 'specs', 'products', 'scorecard-index.yaml'), 'utf-8'),
    ) as {
      productCount: number;
      products: Array<{ id: string; reportPath: string }>;
    };
    expect(scorecardIndex.productCount).toBe(2);
    expect(scorecardIndex.products).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'reverse-spec',
        reportPath: 'specs/products/reverse-spec/scorecard-report.json',
      }),
      expect.objectContaining({
        id: 'spec-driver',
        reportPath: 'specs/products/spec-driver/scorecard-report.json',
      }),
    ]));
  });
});
