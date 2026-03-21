import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { evaluateDocsQuality, renderDocsQualityReport } from '../../src/panoramic/docs-quality-evaluator.js';
import type { ArchitectureNarrativeOutput, BatchGeneratedDocSummary } from '../../src/panoramic/architecture-narrative.js';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import type { ComponentViewOutput, DynamicScenariosOutput } from '../../src/panoramic/component-view-model.js';
import type { AdrIndexOutput } from '../../src/panoramic/adr-decision-pipeline.js';
import type { RuntimeTopologyOutput } from '../../src/panoramic/runtime-topology-generator.js';

const tempDirs: string[] = [];

describe('evaluateDocsQuality', () => {
  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('聚合 explanation docs 的 provenance，并在缺失 manifest 时降级为 partial', () => {
    const projectRoot = createTempProjectRoot('quality-provenance-');
    const outputDir = path.join(projectRoot, 'specs');
    const report = evaluateDocsQuality({
      projectRoot,
      outputDir,
      projectContext: createProjectContext(projectRoot, 'single'),
      generatedDocs: createGeneratedDocs(outputDir, [
        'architecture-narrative',
        'architecture-overview',
        'runtime-topology',
        'component-view',
        'dynamic-scenarios',
        'docs/adr/index',
      ]),
      architectureNarrative: createArchitectureNarrative(),
      componentView: createComponentViewOutput(),
      dynamicScenarios: createDynamicScenariosOutput(),
      runtimeTopology: createRuntimeTopologyOutput(),
      adrIndex: createAdrIndexOutput(),
      dependencyWarnings: ['未找到 docs-bundle manifest，将以 partial 模式降级 required-doc 的发布覆盖校验。'],
    });

    expect(report.status).toBe('partial');
    expect(report.bundleCoverage).toBe('partial');
    expect(report.provenance).toHaveLength(4);
    expect(report.provenance.find((record) => record.documentId === 'architecture-narrative')?.coverage).not.toBe('missing');
    expect(report.provenance.find((record) => record.documentId === 'component-view')?.sourceTypes).toEqual(
      expect.arrayContaining(['code', 'spec', 'config']),
    );
    expect(report.requiredDocs.find((doc) => doc.docId === 'runtime-topology')?.coverage).toBe('covered');
    expect(renderDocsQualityReport(report)).toContain('## Provenance Coverage');
  });

  it('对 README / current-spec 的高价值主题冲突输出 conflict records', () => {
    const projectRoot = createTempProjectRoot('quality-conflicts-');
    const outputDir = path.join(projectRoot, 'specs');
    fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Product\nThis plugin runs in a serverless environment.\n', 'utf-8');
    fs.mkdirSync(path.join(projectRoot, 'specs', 'products', 'demo'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'specs', 'products', 'demo', 'current-spec.md'),
      '# Current Spec\nThis SDK is delivered via Docker Compose containers.\n',
      'utf-8',
    );

    const report = evaluateDocsQuality({
      projectRoot,
      outputDir,
      projectContext: createProjectContext(projectRoot, 'single'),
      generatedDocs: createGeneratedDocs(outputDir, ['architecture-narrative', 'runtime-topology']),
      architectureNarrative: createArchitectureNarrative(),
      runtimeTopology: createRuntimeTopologyOutput(),
      dependencyWarnings: ['未找到 docs-bundle manifest，将以 partial 模式降级 required-doc 的发布覆盖校验。'],
    });

    expect(report.conflicts.map((conflict) => conflict.topic)).toEqual(
      expect.arrayContaining(['product-positioning', 'runtime-hosting']),
    );
    expect(report.conflicts.find((conflict) => conflict.topic === 'product-positioning')?.sources.length)
      .toBeGreaterThanOrEqual(2);
  });

  it('按项目类型输出不同 required-doc 集合，并在 manifest 存在但 bundle 缺文档时标记 partial', () => {
    const projectRoot = createTempProjectRoot('quality-required-docs-');
    const outputDir = path.join(projectRoot, 'specs');
    const report = evaluateDocsQuality({
      projectRoot,
      outputDir,
      projectContext: createProjectContext(projectRoot, 'monorepo'),
      generatedDocs: createGeneratedDocs(outputDir, [
        'architecture-narrative',
        'architecture-overview',
        'pattern-hints',
        'docs/adr/index',
        'api-surface',
        'data-model',
        'workspace-index',
        'cross-package-analysis',
      ]),
      architectureNarrative: createArchitectureNarrative(),
      adrIndex: createAdrIndexOutput(),
      docsBundleManifest: {
        sourcePath: 'specs/docs-bundle.yaml',
        version: 1,
        generatedAt: '2026-03-21T10:00:00.000Z',
        profiles: [
          {
            id: 'architecture-review',
            title: 'Architecture Review',
            documentIds: ['architecture-narrative', 'architecture-overview', 'docs/adr/index'],
            navigation: [],
          },
        ],
      },
    });

    expect(report.requiredDocs.map((doc) => doc.docId)).toEqual(expect.arrayContaining([
      'architecture-narrative',
      'architecture-overview',
      'pattern-hints',
      'docs/adr/index',
      'api-surface',
      'data-model',
      'workspace-index',
      'cross-package-analysis',
    ]));
    expect(report.requiredDocs.find((doc) => doc.docId === 'pattern-hints')?.coverage).toBe('partial');
    expect(report.requiredDocs.find((doc) => doc.docId === 'workspace-index')?.coverage).toBe('partial');
    expect(report.requiredDocs.some((doc) => doc.docId === 'runtime-topology')).toBe(false);
  });
});

function createTempProjectRoot(prefix: string): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(projectRoot);
  fs.mkdirSync(path.join(projectRoot, 'specs'), { recursive: true });
  return projectRoot;
}

function createProjectContext(projectRoot: string, workspaceType: ProjectContext['workspaceType']): ProjectContext {
  return {
    projectRoot,
    configFiles: new Map(),
    packageManager: 'npm',
    workspaceType,
    detectedLanguages: ['ts-js'],
    existingSpecs: [],
  };
}

function createGeneratedDocs(outputDir: string, docIds: string[]): BatchGeneratedDocSummary[] {
  return docIds.map((docId) => ({
    generatorId: docId === 'docs/adr/index'
      ? 'adr-pipeline'
      : (docId === 'cross-package-analysis' ? 'cross-package-deps' : docId),
    writtenFiles: [path.join(outputDir, relativeOutputPath(docId))],
    warnings: [],
  }));
}

function relativeOutputPath(docId: string): string {
  if (docId === 'docs/adr/index') {
    return path.join('docs', 'adr', 'index.md');
  }
  return `${docId}.md`;
}

function createArchitectureNarrative(): ArchitectureNarrativeOutput {
  return {
    title: '技术架构说明: sample-app',
    generatedAt: '2026-03-21',
    projectName: 'sample-app',
    executiveSummary: ['This SDK uses a Docker Compose runtime and query client.'],
    repositoryMap: [],
    keyModules: [
      {
        sourceTarget: 'src/query/client.ts',
        displayName: 'client.ts',
        role: 'core',
        relatedFiles: ['src/query/client.ts'],
        confidence: 'high',
        intentSummary: '负责 SDK 的查询入口。',
        businessSummary: '通过 transport 向 runtime 服务发起请求。',
        dependencySummary: '依赖 transport/client.ts 与 parser/result.ts。',
        keySymbols: [],
        keyMethods: [],
        inferred: false,
      },
    ],
    keySymbols: [
      {
        moduleName: 'src/query/client.ts',
        name: 'QueryClient',
        kind: 'class',
        signature: 'class QueryClient',
        note: 'SDK query entrypoint',
        inferred: false,
      },
    ],
    keyMethods: [
      {
        moduleName: 'src/query/client.ts',
        ownerName: 'QueryClient',
        name: 'query',
        kind: 'method',
        signature: 'query(input: string)',
        note: 'sends request over http transport',
        inferred: false,
      },
    ],
    observations: ['系统通过 Docker Compose 部署。'],
    supportingDocs: [
      {
        generatorId: 'architecture-overview',
        title: 'Architecture Overview',
        path: 'specs/architecture-overview.md',
      },
    ],
  };
}

function createComponentViewOutput(): ComponentViewOutput {
  return {
    title: '组件视图: sample-app',
    generatedAt: '2026-03-21',
    warnings: [],
    mermaidDiagram: 'flowchart LR\nA-->B',
    model: {
      projectName: 'sample-app',
      generatedAt: '2026-03-21',
      summary: ['component summary'],
      groups: [],
      components: [
        {
          id: 'query-client',
          name: 'QueryClient',
          category: 'query',
          subsystem: 'sdk',
          summary: 'query entry',
          responsibilities: ['accept query input'],
          relatedFiles: ['src/query/client.ts'],
          keyMethods: [],
          upstreamIds: [],
          downstreamIds: ['transport-client'],
          confidence: 'high',
          inferred: false,
          evidence: [
            { sourceType: 'architecture-ir', ref: 'element:QueryClient' },
            { sourceType: 'module-spec', ref: 'src/query/client.ts' },
            { sourceType: 'runtime-topology', ref: 'service:api' },
          ],
        },
      ],
      relationships: [
        {
          fromId: 'query-client',
          toId: 'transport-client',
          kind: 'calls',
          label: 'issues request',
          confidence: 'medium',
          evidence: [
            { sourceType: 'baseline-skeleton', ref: 'method:query' },
          ],
        },
      ],
      warnings: [],
      stats: {
        totalComponents: 1,
        totalRelationships: 1,
        highConfidenceComponents: 1,
        sourceCount: 3,
      },
    },
  };
}

function createDynamicScenariosOutput(): DynamicScenariosOutput {
  return {
    title: '动态链路: sample-app',
    generatedAt: '2026-03-21',
    warnings: [],
    model: {
      projectName: 'sample-app',
      generatedAt: '2026-03-21',
      scenarios: [
        {
          id: 'request-flow',
          title: 'Primary Request Flow',
          category: 'request-flow',
          trigger: 'query(input)',
          participants: ['QueryClient', 'HttpTransport'],
          summary: '主查询链路',
          steps: [
            {
              index: 1,
              actorId: 'query-client',
              actor: 'QueryClient',
              action: 'query',
              targetId: 'transport-client',
              target: 'HttpTransport',
              detail: 'dispatch over http',
              confidence: 'high',
              inferred: false,
              evidence: [
                { sourceType: 'architecture-ir', ref: 'relationship:query->transport' },
              ],
            },
          ],
          outcome: 'response parsed',
          confidence: 'high',
          inferred: false,
          evidence: [
            { sourceType: 'module-spec', ref: 'src/query/client.ts' },
          ],
        },
      ],
      warnings: [],
      stats: {
        totalScenarios: 1,
        highConfidenceScenarios: 1,
        totalSteps: 1,
      },
    },
  };
}

function createAdrIndexOutput(): AdrIndexOutput {
  return {
    title: 'ADR 决策索引: sample-app',
    generatedAt: '2026-03-21',
    projectName: 'sample-app',
    summary: ['adr summary'],
    draftCount: 1,
    warnings: [],
    drafts: [
      {
        decisionId: 'ADR-0001',
        slug: 'query-transport',
        title: '使用 query transport 作为协议边界',
        status: 'proposed',
        category: 'protocol',
        confidence: 'high',
        inferred: false,
        sourceTypes: ['architecture-narrative', 'current-spec'],
        summary: '统一 query transport 边界。',
        decision: 'Use query transport.',
        context: ['sdk uses transport'],
        consequences: ['stable boundary'],
        alternatives: ['direct calls'],
        evidence: [
          {
            sourceType: 'architecture-narrative',
            label: 'executive-summary',
            excerpt: 'Query transport is the protocol boundary.',
            path: 'specs/architecture-narrative.md',
          },
        ],
      },
    ],
  };
}

function createRuntimeTopologyOutput(): RuntimeTopologyOutput {
  return {
    title: '运行时拓扑: sample-app',
    generatedAt: '2026-03-21',
    topology: {
      projectName: 'sample-app',
      services: [
        {
          name: 'api',
          sourceFile: 'docker-compose.yml',
          containerName: 'sample-api',
          image: 'sample-app:runtime',
          buildContext: '.',
          dockerfilePath: 'Dockerfile',
          targetStage: 'runtime',
          stageNames: ['build', 'runtime'],
          command: 'node dist/server.js',
          entrypoint: undefined,
          environment: [],
          envFiles: [],
          ports: [],
          volumes: [],
          dependsOn: [],
        },
      ],
      images: [],
      containers: [],
      stages: [],
      configHints: [],
      sourceFiles: ['docker-compose.yml', 'Dockerfile'],
    },
    stats: {
      totalServices: 1,
      totalImages: 0,
      totalContainers: 0,
      totalStages: 0,
      totalDependencies: 0,
      totalConfigHints: 0,
    },
    warnings: [],
  };
}
