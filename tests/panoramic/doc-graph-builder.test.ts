import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ModuleGraph } from '../../src/knowledge-graph/module-derivation.js';
import type { ModuleSpec } from '../../src/models/module-spec.js';
import {
  buildDocGraph,
  scanExistingSpecDocuments,
  scanStoredModuleSpecs,
} from '../../src/panoramic/builders/doc-graph-builder.js';

describe('DocGraphBuilder', () => {
  let tmpDir: string;
  let specsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-graph-builder-'));
    specsDir = path.join(tmpDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sourceKind=bundle_copy 的 spec 被 scanStoredModuleSpecs 过滤掉', () => {
    // canonical spec
    writeSpecFile(path.join(specsDir, 'auth.spec.md'), {
      sourceTarget: 'src/auth',
      relatedFiles: [],
      linked: false,
    });

    // bundle_copy spec — 应被过滤
    const bundleDir = path.join(specsDir, 'bundles', 'developer-onboarding', 'docs', 'modules');
    fs.mkdirSync(bundleDir, { recursive: true });
    writeSpecFileWithSourceKind(path.join(bundleDir, 'auth.spec.md'), {
      sourceTarget: 'src/auth',
      relatedFiles: [],
      linked: false,
      sourceKind: 'bundle_copy',
      derivedFrom: 'specs/modules/auth.spec.md',
    });

    const results = scanStoredModuleSpecs(specsDir, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]?.specPath).toBe('specs/auth.spec.md');
  });

  it('sourceKind=derived 的 spec 被 scanStoredModuleSpecs 过滤掉', () => {
    writeSpecFile(path.join(specsDir, 'core.spec.md'), {
      sourceTarget: 'src/core',
      relatedFiles: [],
      linked: false,
    });
    writeSpecFileWithSourceKind(path.join(specsDir, 'core-derived.spec.md'), {
      sourceTarget: 'src/core',
      relatedFiles: [],
      linked: false,
      sourceKind: 'derived',
      derivedFrom: 'specs/core.spec.md',
    });

    const results = scanStoredModuleSpecs(specsDir, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]?.specPath).toBe('specs/core.spec.md');
  });

  it('缺失 sourceKind 的历史 spec 视为 canonical 保留（向后兼容）', () => {
    // 两个没有 sourceKind 字段的历史 spec
    writeSpecFile(path.join(specsDir, 'auth.spec.md'), {
      sourceTarget: 'src/auth',
      relatedFiles: [],
      linked: false,
    });
    writeSpecFile(path.join(specsDir, 'api.spec.md'), {
      sourceTarget: 'src/api',
      relatedFiles: [],
      linked: false,
    });

    const results = scanStoredModuleSpecs(specsDir, tmpDir);
    // 两个都应保留，因为缺失 sourceKind 默认视为 canonical
    expect(results).toHaveLength(2);
  });

  it('聚合源码映射、交叉引用、缺口与未互链 spec', () => {
    writeSpecFile(path.join(specsDir, 'auth.spec.md'), {
      sourceTarget: 'src/auth',
      relatedFiles: ['src/auth/service.ts'],
      linked: false,
    });
    writeSpecFile(path.join(specsDir, 'api.spec.md'), {
      sourceTarget: 'src/api',
      relatedFiles: ['src/api/routes.ts', 'src/api/controller.ts'],
      linked: false,
    });
    fs.writeFileSync(
      path.join(specsDir, '_index.spec.md'),
      `---
type: architecture-index
version: v1
generatedBy: spectra
projectRoot: ${tmpDir}
totalModules: 2
lastUpdated: 2026-03-20T00:00:00.000Z
---
`,
      'utf-8',
    );

    const existingSpecs = scanExistingSpecDocuments(specsDir, tmpDir);
    const storedSpecs = scanStoredModuleSpecs(specsDir, tmpDir);
    const docGraph = buildDocGraph({
      projectRoot: tmpDir,
      dependencyGraph: createGraph(tmpDir),
      moduleSpecs: [
        createModuleSpec({
          outputPath: path.join(specsDir, 'api.spec.md'),
          sourceTarget: 'src/api',
          relatedFiles: ['src/api/routes.ts', 'src/api/controller.ts'],
        }),
      ],
      existingSpecs,
    });

    expect(existingSpecs).toHaveLength(2);
    expect(storedSpecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specPath: 'specs/auth.spec.md',
          skeletonHash: 'a'.repeat(64),
          intentSummary: 'src/auth intent',
        }),
      ]),
    );
    expect(docGraph.specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specPath: 'specs/api.spec.md',
          currentRun: true,
          linked: true,
        }),
        expect.objectContaining({
          specPath: 'specs/auth.spec.md',
          currentRun: false,
          linked: false,
        }),
      ]),
    );
    expect(docGraph.sourceToSpec).toContainEqual({
      sourcePath: 'src/auth/service.ts',
      specPath: 'specs/auth.spec.md',
      sourceTarget: 'src/auth',
      matchType: 'related-file',
    });
    expect(docGraph.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'same-module',
          fromSpecPath: 'specs/api.spec.md',
          toSpecPath: 'specs/api.spec.md',
          evidenceCount: 1,
        }),
        expect.objectContaining({
          kind: 'cross-module',
          fromSpecPath: 'specs/api.spec.md',
          toSpecPath: 'specs/auth.spec.md',
          evidenceCount: 1,
        }),
      ]),
    );
    expect(docGraph.missingSpecs).toEqual([
      { sourcePath: 'src/legacy/job.ts', reason: 'no-spec-owner' },
    ]);
    expect(docGraph.unlinkedSpecs).toEqual([
      { specPath: 'specs/auth.spec.md', sourceTarget: 'src/auth' },
    ]);
  });
});

function createGraph(projectRoot: string): ModuleGraph {
  return {
    projectRoot,
    modules: [
      createNode('src/api/routes.ts'),
      createNode('src/api/controller.ts'),
      createNode('src/auth/service.ts'),
      createNode('src/legacy/job.ts'),
    ],
    edges: [
      {
        from: 'src/api/routes.ts',
        to: 'src/api/controller.ts',
        isCircular: false,
        importType: 'static',
      },
      {
        from: 'src/api/controller.ts',
        to: 'src/auth/service.ts',
        isCircular: false,
        importType: 'static',
      },
    ],
    topologicalOrder: [
      'src/auth/service.ts',
      'src/api/controller.ts',
      'src/api/routes.ts',
      'src/legacy/job.ts',
    ],
    sccs: [],
    totalModules: 4,
    totalEdges: 2,
    analyzedAt: '2026-03-20T00:00:00.000Z',
    mermaidSource: 'graph TD',
  };
}

function createNode(source: string) {
  return {
    source,
    isOrphan: false,
    inDegree: 0,
    outDegree: 0,
    level: 0,
  };
}

function createModuleSpec(options: {
  outputPath: string;
  sourceTarget: string;
  relatedFiles: string[];
}): ModuleSpec {
  return {
    frontmatter: {
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'spectra v3.0.1',
      sourceTarget: options.sourceTarget,
      relatedFiles: options.relatedFiles,
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
      filePath: options.relatedFiles[0] ?? options.sourceTarget,
      language: 'typescript',
      loc: 10,
      exports: [],
      imports: [],
      hash: 'a'.repeat(64),
      analyzedAt: '2026-03-20T00:00:00.000Z',
      parserUsed: 'ts-morph',
    },
    outputPath: options.outputPath,
  };
}

function writeSpecFileWithSourceKind(
  specPath: string,
  options: {
    sourceTarget: string;
    relatedFiles: string[];
    linked: boolean;
    sourceKind: 'canonical' | 'derived' | 'bundle_copy';
    derivedFrom?: string | null;
  },
): void {
  const marker = options.linked
    ? '\n<!-- cross-reference-index: auto generatedAt=2026-03-20T00:00:00.000Z same=0 cross=0 -->\n'
    : '\n';

  const derivedFromLine = options.derivedFrom != null
    ? `\nderivedFrom: ${JSON.stringify(options.derivedFrom)}`
    : '';

  fs.writeFileSync(
    specPath,
    `---
type: module-spec
version: v1
generatedBy: spectra
sourceTarget: ${options.sourceTarget}
relatedFiles:
${options.relatedFiles.map((item) => `  - ${item}`).join('\n') || '  []'}
lastUpdated: 2026-03-20T00:00:00.000Z
confidence: high
skeletonHash: ${'a'.repeat(64)}
sourceKind: ${options.sourceKind}${derivedFromLine}
---

# ${options.sourceTarget}
## 1. 意图
${options.sourceTarget} intent
${marker}
`,
    'utf-8',
  );
}

function writeSpecFile(
  specPath: string,
  options: {
    sourceTarget: string;
    relatedFiles: string[];
    linked: boolean;
  },
): void {
  const marker = options.linked
    ? '\n<!-- cross-reference-index: auto generatedAt=2026-03-20T00:00:00.000Z same=0 cross=0 -->\n'
    : '\n';

  fs.writeFileSync(
    specPath,
    `---
type: module-spec
version: v1
generatedBy: spectra
sourceTarget: ${options.sourceTarget}
relatedFiles:
${options.relatedFiles.map((item) => `  - ${item}`).join('\n')}
lastUpdated: 2026-03-20T00:00:00.000Z
confidence: high
skeletonHash: ${'a'.repeat(64)}
---

# ${options.sourceTarget}
## 1. 意图
${options.sourceTarget} intent
${marker}
`,
    'utf-8',
  );
}
