import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DependencyGraph } from '../../src/models/dependency-graph.js';
import type { ModuleSpec } from '../../src/models/module-spec.js';
import {
  buildDocGraph,
  scanExistingSpecDocuments,
} from '../../src/panoramic/doc-graph-builder.js';

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
generatedBy: reverse-spec
projectRoot: ${tmpDir}
totalModules: 2
lastUpdated: 2026-03-20T00:00:00.000Z
---
`,
      'utf-8',
    );

    const existingSpecs = scanExistingSpecDocuments(specsDir, tmpDir);
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

function createGraph(projectRoot: string): DependencyGraph {
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
      generatedBy: 'reverse-spec v2.1.0',
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
generatedBy: reverse-spec
sourceTarget: ${options.sourceTarget}
relatedFiles:
${options.relatedFiles.map((item) => `  - ${item}`).join('\n')}
lastUpdated: 2026-03-20T00:00:00.000Z
confidence: high
skeletonHash: ${'a'.repeat(64)}
---

# ${options.sourceTarget}
${marker}
`,
    'utf-8',
  );
}
