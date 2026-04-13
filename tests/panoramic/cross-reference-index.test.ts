import { describe, expect, it } from 'vitest';
import type { ModuleSpec } from '../../src/models/module-spec.js';
import { buildCrossReferenceIndex } from '../../src/panoramic/cross-reference-index.js';
import type { DocGraph } from '../../src/panoramic/builders/doc-graph-builder.js';

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

  it('从 skeleton imports 补充跨模块引用（适用于无相对 import 的 Python 项目）', () => {
    // 模拟 Python 项目：docGraph.references 为空，但 skeleton 有绝对 import
    const moduleSpec: ModuleSpec = {
      ...createModuleSpec(),
      frontmatter: {
        ...createModuleSpec().frontmatter,
        sourceTarget: 'graphify/analyzers',
      },
      baselineSkeleton: {
        filePath: 'graphify/analyzers/__init__.py',
        language: 'python',
        loc: 20,
        exports: [],
        imports: [
          {
            moduleSpecifier: 'graphify.core',
            isRelative: false,
            resolvedPath: null,
            namedImports: ['Parser'],
            isTypeOnly: false,
          },
          {
            moduleSpecifier: 'requests',
            isRelative: false,
            resolvedPath: null,
            isTypeOnly: false,
          },
        ],
        hash: 'b'.repeat(64),
        analyzedAt: '2026-03-20T00:00:00.000Z',
        parserUsed: 'tree-sitter',
      },
      outputPath: '/project/specs/graphify-analyzers.spec.md',
    };

    const docGraph: DocGraph = {
      projectRoot: '/project',
      generatedAt: '2026-03-20T00:00:00.000Z',
      specs: [
        {
          specPath: 'specs/graphify-analyzers.spec.md',
          sourceTarget: 'graphify/analyzers',
          relatedFiles: ['graphify/analyzers/__init__.py'],
          linked: true,
          currentRun: true,
        },
        {
          specPath: 'specs/graphify-core.spec.md',
          sourceTarget: 'graphify/core',
          relatedFiles: ['graphify/core/__init__.py', 'graphify/core/parser.py'],
          linked: true,
          currentRun: false,
        },
      ],
      sourceToSpec: [],
      references: [],  // Python 项目无相对 import，docGraph.references 为空
      missingSpecs: [],
      unlinkedSpecs: [],
    };

    const index = buildCrossReferenceIndex(moduleSpec, docGraph);

    // graphify.core import 应被识别为跨模块出站引用
    expect(index.crossModule).toHaveLength(1);
    expect(index.crossModule[0]).toMatchObject({
      label: 'graphify/core',
      direction: 'outbound',
    });
    // requests 是第三方包，不应产生跨模块链接
    expect(index.crossModule.some((link) => link.label.includes('requests'))).toBe(false);
  });

  it('skeleton imports 补充不重复已有 docGraph.references 中的跨模块引用', () => {
    const moduleSpec = createModuleSpec();
    const docGraph: DocGraph = {
      projectRoot: '/project',
      generatedAt: '2026-03-20T00:00:00.000Z',
      specs: [
        {
          specPath: 'specs/api.spec.md',
          sourceTarget: 'src/api',
          relatedFiles: ['src/api/routes.ts'],
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
          kind: 'cross-module',
          fromSpecPath: 'specs/api.spec.md',
          toSpecPath: 'specs/auth.spec.md',
          fromSourceTarget: 'src/api',
          toSourceTarget: 'src/auth',
          evidenceCount: 5,
          evidenceSamples: [{ fromSource: 'src/api/routes.ts', toSource: 'src/auth/service.ts' }],
        },
      ],
      missingSpecs: [],
      unlinkedSpecs: [],
    };

    // skeleton 也导入了 src.auth（与 docGraph.references 重叠）
    const specWithImport: ModuleSpec = {
      ...moduleSpec,
      baselineSkeleton: {
        ...moduleSpec.baselineSkeleton,
        imports: [{ moduleSpecifier: 'src.auth', isRelative: false, resolvedPath: null, isTypeOnly: false }],
      },
    };

    const index = buildCrossReferenceIndex(specWithImport, docGraph);

    // 应只有一条跨模块链接（不重复计数）
    expect(index.crossModule).toHaveLength(1);
    // evidenceCount 应来自 docGraph.references，skeleton 补充不叠加
    expect(index.crossModule[0]!.evidenceCount).toBe(5);
  });
});

function createModuleSpec(): ModuleSpec {
  return {
    frontmatter: {
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'spectra v3.0.1',
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
