import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ModuleGroup } from '../../src/batch/module-grouper.js';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import type { DocGraph } from '../../src/panoramic/doc-graph-builder.js';
import { CoverageAuditor } from '../../src/panoramic/coverage-auditor.js';
import { GeneratorRegistry } from '../../src/panoramic/generator-registry.js';

describe('CoverageAuditor', () => {
  let tmpDir: string;
  let outputDir: string;

  beforeEach(() => {
    GeneratorRegistry.resetInstance();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-auditor-'));
    outputDir = path.join(tmpDir, 'specs');
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(path.join(tmpDir, 'config.yaml'), 'port: 3000\n', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), 'FROM node:20\n', 'utf-8');
    fs.writeFileSync(
      path.join(tmpDir, 'docker-compose.yml'),
      'services:\n  app:\n    build: .\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(tmpDir, 'openapi.json'), '{"openapi":"3.0.0","paths":{}}', 'utf-8');

    fs.writeFileSync(
      path.join(outputDir, 'api.spec.md'),
      [
        '---',
        'type: module-spec',
        'version: v1',
        'generatedBy: reverse-spec',
        'sourceTarget: src/api',
        'relatedFiles:',
        '  - src/api/routes.ts',
        '  - src/api/controller.ts',
        'lastUpdated: 2026-03-20T00:00:00.000Z',
        'confidence: high',
        `skeletonHash: ${'a'.repeat(64)}`,
        '---',
        '',
        '<a id="module-spec"></a>',
        '# src/api',
        '',
        '[broken](missing.spec.md#module-spec)',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(outputDir, 'auth.spec.md'),
      [
        '---',
        'type: module-spec',
        'version: v1',
        'generatedBy: reverse-spec',
        'sourceTarget: src/auth',
        'relatedFiles:',
        '  - src/auth/service.ts',
        'lastUpdated: 2026-03-20T00:00:00.000Z',
        'confidence: low',
        `skeletonHash: ${'b'.repeat(64)}`,
        '---',
        '',
        '<a id="module-spec"></a>',
        '# src/auth',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(outputDir, 'cli.spec.md'),
      [
        '---',
        'type: module-spec',
        'version: v1',
        'generatedBy: reverse-spec',
        'sourceTarget: cli.ts',
        'relatedFiles:',
        '  - cli.ts',
        'lastUpdated: 2026-03-20T00:00:00.000Z',
        'confidence: high',
        `skeletonHash: ${'c'.repeat(64)}`,
        '---',
        '',
        '<a id="module-spec"></a>',
        '# cli.ts',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(path.join(outputDir, 'data-model.md'), '# data model\n', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    GeneratorRegistry.resetInstance();
  });

  it('聚合模块 coverage、断链、低置信度和 generator coverage', async () => {
    const auditor = new CoverageAuditor();
    const audit = await auditor.audit({
      projectRoot: tmpDir,
      outputDir,
      projectContext: createProjectContext(tmpDir),
      docGraph: createDocGraph(tmpDir),
      moduleGroups: createModuleGroups(),
    });

    expect(audit.summary.totalModules).toBe(4);
    expect(audit.summary.documentedModules).toBe(1);
    expect(audit.summary.moduleCoveragePct).toBe(25);
    expect(audit.summary.missingDocCount).toBe(1);
    expect(audit.summary.missingLinkCount).toBe(1);
    expect(audit.summary.danglingLinkCount).toBe(1);
    expect(audit.summary.lowConfidenceCount).toBe(1);

    expect(audit.missingDocModules.map((entry) => entry.moduleName)).toEqual(['jobs']);
    expect(audit.attentionModules.map((entry) => entry.moduleName)).toEqual(['api', 'auth']);
    expect(audit.danglingLinks[0]).toMatchObject({
      specPath: 'specs/api.spec.md',
      href: 'missing.spec.md#module-spec',
      reason: 'missing-file',
    });
    expect(audit.lowConfidenceSpecs).toEqual([
      {
        specPath: 'specs/auth.spec.md',
        sourceTarget: 'src/auth',
        confidence: 'low',
      },
    ]);

    const moduleSpecCoverage = audit.generatorCoverage.find((entry) => entry.generatorId === 'module-spec');
    expect(moduleSpecCoverage).toMatchObject({
      scope: 'module',
      expectedCount: 4,
      generatedCount: 3,
      missingCount: 1,
      coveragePct: 75,
    });

    const dataModelCoverage = audit.generatorCoverage.find((entry) => entry.generatorId === 'data-model');
    expect(dataModelCoverage).toMatchObject({
      scope: 'project',
      expectedCount: 1,
      generatedCount: 1,
      missingCount: 0,
      coveragePct: 100,
    });

    const configCoverage = audit.generatorCoverage.find((entry) => entry.generatorId === 'config-reference');
    expect(configCoverage).toMatchObject({
      generatedCount: 0,
      missingCount: 1,
      coveragePct: 0,
    });

    const markdown = auditor.render(audit);
    expect(markdown).toContain('## Generator Coverage');
    expect(markdown).toContain('## 缺失文档模块');
    expect(markdown).toContain('missing.spec.md#module-spec');
  });
});

function createProjectContext(projectRoot: string): ProjectContext {
  return {
    projectRoot,
    configFiles: new Map<string, string>([
      ['config.yaml', path.join(projectRoot, 'config.yaml')],
      ['Dockerfile', path.join(projectRoot, 'Dockerfile')],
      ['docker-compose.yml', path.join(projectRoot, 'docker-compose.yml')],
      ['openapi.json', path.join(projectRoot, 'openapi.json')],
    ]),
    packageManager: 'unknown',
    workspaceType: 'single',
    detectedLanguages: ['typescript'],
    existingSpecs: [
      path.join(projectRoot, 'specs', 'api.spec.md'),
      path.join(projectRoot, 'specs', 'auth.spec.md'),
      path.join(projectRoot, 'specs', 'cli.spec.md'),
    ],
  };
}

function createDocGraph(projectRoot: string): DocGraph {
  return {
    projectRoot,
    generatedAt: '2026-03-20T00:00:00.000Z',
    specs: [
      {
        specPath: 'specs/api.spec.md',
        sourceTarget: 'src/api',
        relatedFiles: ['src/api/routes.ts', 'src/api/controller.ts'],
        linked: true,
        confidence: 'high',
        currentRun: true,
      },
      {
        specPath: 'specs/auth.spec.md',
        sourceTarget: 'src/auth',
        relatedFiles: ['src/auth/service.ts'],
        linked: false,
        confidence: 'low',
        currentRun: false,
      },
      {
        specPath: 'specs/cli.spec.md',
        sourceTarget: 'cli.ts',
        relatedFiles: ['cli.ts'],
        linked: true,
        confidence: 'high',
        currentRun: true,
      },
    ],
    sourceToSpec: [
      {
        sourcePath: 'src/api/routes.ts',
        specPath: 'specs/api.spec.md',
        sourceTarget: 'src/api',
        matchType: 'related-file',
      },
      {
        sourcePath: 'src/api/controller.ts',
        specPath: 'specs/api.spec.md',
        sourceTarget: 'src/api',
        matchType: 'related-file',
      },
      {
        sourcePath: 'src/auth/service.ts',
        specPath: 'specs/auth.spec.md',
        sourceTarget: 'src/auth',
        matchType: 'related-file',
      },
      {
        sourcePath: 'cli.ts',
        specPath: 'specs/cli.spec.md',
        sourceTarget: 'cli.ts',
        matchType: 'related-file',
      },
    ],
    references: [],
    missingSpecs: [{ sourcePath: 'jobs/worker.ts', reason: 'no-spec-owner' }],
    unlinkedSpecs: [{ specPath: 'specs/auth.spec.md', sourceTarget: 'src/auth' }],
  };
}

function createModuleGroups(): ModuleGroup[] {
  return [
    {
      name: 'api',
      dirPath: 'src/api',
      files: ['src/api/routes.ts', 'src/api/controller.ts'],
    },
    {
      name: 'auth',
      dirPath: 'src/auth',
      files: ['src/auth/service.ts'],
    },
    {
      name: 'jobs',
      dirPath: 'src/jobs',
      files: ['jobs/worker.ts'],
    },
    {
      name: 'root',
      dirPath: '.',
      files: ['cli.ts'],
    },
  ];
}
