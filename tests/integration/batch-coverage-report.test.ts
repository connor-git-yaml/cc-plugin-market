import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import type { ModuleSpec } from '../../src/models/module-spec.js';

const mocks = vi.hoisted(() => ({
  generateSpec: vi.fn(),
}));

vi.mock('../../src/core/single-spec-orchestrator.js', () => ({
  generateSpec: mocks.generateSpec,
}));

import { runBatch } from '../../src/batch/batch-orchestrator.js';

describe('runBatch 覆盖率审计接入', () => {
  let projectRoot: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-coverage-report-'));

    fs.mkdirSync(path.join(projectRoot, 'src', 'api'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'api', 'routes.ts'),
      `
import { authorize } from '../auth/service';

export function route(): string {
  return authorize('ok');
}
`.trim(),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'auth', 'service.ts'),
      `
export function authorize(value: string): string {
  return value;
}
`.trim(),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    mocks.generateSpec.mockImplementation(async (targetPath: string, options: { outputDir?: string }) => {
      const moduleName = path.basename(targetPath);
      const specPath = path.join(options.outputDir ?? path.join(projectRoot, 'specs'), `${moduleName}.spec.md`);
      fs.mkdirSync(path.dirname(specPath), { recursive: true });
      fs.writeFileSync(specPath, `# ${moduleName}\n`, 'utf-8');

      const moduleSpec = createModuleSpec(specPath, moduleName);
      return {
        specPath,
        skeleton: moduleSpec.baselineSkeleton,
        tokenUsage: 0,
        confidence: 'high' as const,
        warnings: [],
        moduleSpec,
      };
    });
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    LanguageAdapterRegistry.resetInstance();
    vi.clearAllMocks();
  });

  it('batch 完成后输出 coverage markdown/json 报告', async () => {
    const result = await runBatch(projectRoot, {
      force: true,
      maxRetries: 1,
    });

    expect(result.failed).toHaveLength(0);
    expect(result.coverageReportPath).toBe('specs/_coverage-report.md');
    expect(fs.existsSync(path.join(projectRoot, 'specs', '_coverage-report.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', '_coverage-report.json'))).toBe(true);

    const markdown = fs.readFileSync(path.join(projectRoot, 'specs', '_coverage-report.md'), 'utf-8');
    expect(markdown).toContain('## 总览');
    expect(markdown).toContain('## Generator Coverage');

    const json = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'specs', '_coverage-report.json'), 'utf-8'),
    ) as {
      summary: { totalModules: number };
      generatorCoverage: Array<{ generatorId: string }>;
    };

    expect(json.summary.totalModules).toBe(2);
    expect(json.generatorCoverage.some((entry) => entry.generatorId === 'module-spec')).toBe(true);
  });
});

function createModuleSpec(outputPath: string, moduleName: string): ModuleSpec {
  const relatedFiles = moduleName === 'api'
    ? ['src/api/routes.ts']
    : ['src/auth/service.ts'];

  return {
    frontmatter: {
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'reverse-spec v2.1.0',
      sourceTarget: moduleName === 'api' ? 'src/api' : 'src/auth',
      relatedFiles,
      lastUpdated: '2026-03-20T00:00:00.000Z',
      confidence: 'high',
      skeletonHash: 'a'.repeat(64),
    },
    sections: {
      intent: `${moduleName} intent`,
      interfaceDefinition: `${moduleName} interface`,
      businessLogic: `${moduleName} logic`,
      dataStructures: `${moduleName} data`,
      constraints: `${moduleName} constraints`,
      edgeCases: `${moduleName} edge`,
      technicalDebt: `${moduleName} debt`,
      testCoverage: `${moduleName} coverage`,
      dependencies: `${moduleName} deps`,
    },
    fileInventory: relatedFiles.map((filePath) => ({
      path: filePath,
      loc: 10,
      purpose: `${moduleName} file`,
    })),
    baselineSkeleton: {
      filePath: relatedFiles[0]!,
      language: 'typescript',
      loc: 10,
      exports: [],
      imports: [],
      hash: 'a'.repeat(64),
      analyzedAt: '2026-03-20T00:00:00.000Z',
      parserUsed: 'ts-morph',
    },
    outputPath,
  };
}
