import { describe, expect, it } from 'vitest';
import type { ModuleSpec } from '../../src/models/module-spec.js';
import { buildCrossReferenceIndex } from '../../src/panoramic/cross-reference-index.js';
import type { DocGraph } from '../../src/panoramic/doc-graph-builder.js';

describe('CrossReferenceIndex', () => {
  it('为当前 ModuleSpec 生成同模块与跨模块链接', () => {
    const moduleSpec = createModuleSpec();
    const docGraph: DocGraph = {
      projectRoot: '/project',
      generatedAt: '2026-03-20T00:00:00.000Z',
      specs: [
        {
          specPath: 'specs/api.spec.md',
          sourceTarget: 'src/api',
          relatedFiles: ['src/api/routes.ts', 'src/api/controller.ts'],
          linked: true,
          currentRun: true,
        },
        {
          specPath: 'specs/auth.spec.md',
          sourceTarget: 'src/auth',
          relatedFiles: ['src/auth/service.ts'],
          linked: true,
          currentRun: false,
        },
      ],
      sourceToSpec: [],
      references: [
        {
          kind: 'same-module',
          fromSpecPath: 'specs/api.spec.md',
          toSpecPath: 'specs/api.spec.md',
          fromSourceTarget: 'src/api',
          toSourceTarget: 'src/api',
          evidenceCount: 1,
          evidenceSamples: [
            { fromSource: 'src/api/routes.ts', toSource: 'src/api/controller.ts' },
          ],
        },
        {
          kind: 'cross-module',
          fromSpecPath: 'specs/api.spec.md',
          toSpecPath: 'specs/auth.spec.md',
          fromSourceTarget: 'src/api',
          toSourceTarget: 'src/auth',
          evidenceCount: 2,
          evidenceSamples: [
            { fromSource: 'src/api/controller.ts', toSource: 'src/auth/service.ts' },
          ],
        },
        {
          kind: 'cross-module',
          fromSpecPath: 'specs/auth.spec.md',
          toSpecPath: 'specs/api.spec.md',
          fromSourceTarget: 'src/auth',
          toSourceTarget: 'src/api',
          evidenceCount: 1,
          evidenceSamples: [
            { fromSource: 'src/auth/service.ts', toSource: 'src/api/routes.ts' },
          ],
        },
      ],
      missingSpecs: [],
      unlinkedSpecs: [],
    };

    const index = buildCrossReferenceIndex(moduleSpec, docGraph);

    expect(index.sameModule).toHaveLength(1);
    expect(index.sameModule[0]).toMatchObject({
      href: '#module-spec',
      direction: 'internal',
      evidenceCount: 1,
    });

    expect(index.crossModule).toHaveLength(1);
    expect(index.crossModule[0]).toMatchObject({
      label: 'src/auth',
      href: 'auth.spec.md#module-spec',
      direction: 'bidirectional',
      evidenceCount: 3,
    });
    expect(index.crossModule[0]!.summary).toContain('出站 2，入站 1');
    expect(index.crossModule[0]!.summary).toContain('src/api/controller.ts -> src/auth/service.ts');
  });
});

function createModuleSpec(): ModuleSpec {
  return {
    frontmatter: {
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'reverse-spec v2.1.0',
      sourceTarget: 'src/api',
      relatedFiles: ['src/api/routes.ts', 'src/api/controller.ts'],
      lastUpdated: '2026-03-20T00:00:00.000Z',
      confidence: 'high',
      skeletonHash: 'a'.repeat(64),
    },
    sections: {
      intent: 'intent',
      interfaceDefinition: 'interface',
      businessLogic: 'logic',
      dataStructures: 'data',
      constraints: 'constraints',
      edgeCases: 'edge',
      technicalDebt: 'debt',
      testCoverage: 'coverage',
      dependencies: 'deps',
    },
    fileInventory: [],
    baselineSkeleton: {
      filePath: 'src/api/routes.ts',
      language: 'typescript',
      loc: 10,
      exports: [],
      imports: [],
      hash: 'a'.repeat(64),
      analyzedAt: '2026-03-20T00:00:00.000Z',
      parserUsed: 'ts-morph',
    },
    outputPath: '/project/specs/api.spec.md',
  };
}
