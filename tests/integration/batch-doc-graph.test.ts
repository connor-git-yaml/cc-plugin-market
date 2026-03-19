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

describe('runBatch 文档图谱接入', () => {
  let projectRoot: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-doc-graph-'));

    fs.mkdirSync(path.join(projectRoot, 'src', 'api'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'api', 'routes.ts'),
      `
import { handler } from './controller';
import { authorize } from '../auth/service';

export function route(): string {
  return authorize(handler());
}
`.trim(),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'api', 'controller.ts'),
      `
export function handler(): string {
  return 'ok';
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

      const moduleSpec = createModuleSpec(projectRoot, specPath, moduleName);
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

  it('批量生成后会回写相关 Spec 链接并输出 doc graph json', async () => {
    const result = await runBatch(projectRoot, {
      force: true,
      maxRetries: 1,
    });

    expect(result.failed).toHaveLength(0);
    expect(result.docGraphPath).toBe('specs/_doc-graph.json');

    const apiSpecContent = fs.readFileSync(path.join(projectRoot, 'specs', 'api.spec.md'), 'utf-8');
    expect(apiSpecContent).toContain('## 相关 Spec');
    expect(apiSpecContent).toContain('[src/auth](auth.spec.md#module-spec)');
    expect(apiSpecContent).toContain('<!-- cross-reference-index: auto');

    const docGraph = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'specs', '_doc-graph.json'), 'utf-8'),
    ) as {
      references: Array<{ fromSpecPath: string; toSpecPath: string; kind: string }>;
    };

    expect(docGraph.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'cross-module',
          fromSpecPath: 'specs/api.spec.md',
          toSpecPath: 'specs/auth.spec.md',
        }),
      ]),
    );
  });
});

function createModuleSpec(projectRoot: string, outputPath: string, moduleName: string): ModuleSpec {
  const relatedFiles = moduleName === 'api'
    ? ['src/api/routes.ts', 'src/api/controller.ts']
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
      filePath: path.relative(projectRoot, path.join(projectRoot, relatedFiles[0]!)),
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
