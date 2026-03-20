import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CodeSkeleton, ExportSymbol, ImportReference } from '../../../src/models/code-skeleton.js';
import type { ModuleSpec } from '../../../src/models/module-spec.js';
import type { ArchitectureIR, ArchitectureIREvidence, ArchitectureIRRelationship, ArchitectureIRView } from '../../../src/panoramic/architecture-ir-model.js';
import { summarizeArchitectureIR } from '../../../src/panoramic/architecture-ir-model.js';
import type { EventSurfaceOutput } from '../../../src/panoramic/event-surface-generator.js';
import type { RuntimeTopologyOutput } from '../../../src/panoramic/runtime-topology-generator.js';
import { loadStoredModuleSpecs, type StoredModuleSpecRecord } from '../../../src/panoramic/stored-module-specs.js';
import { renderSpec } from '../../../src/generator/spec-renderer.js';

export interface ComponentDynamicFixture {
  projectRoot: string;
  outputDir: string;
  storedModules: StoredModuleSpecRecord[];
  architectureIR: ArchitectureIR;
  eventSurface: EventSurfaceOutput;
  runtime: RuntimeTopologyOutput;
}

export function setupComponentDynamicFixture(): ComponentDynamicFixture {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'component-dynamic-'));
  const outputDir = path.join(projectRoot, 'specs');
  fs.mkdirSync(outputDir, { recursive: true });

  writeSourceFile(projectRoot, 'src/client/query.ts', 'export class Query {}');
  writeSourceFile(projectRoot, 'src/transport/subprocess-cli.ts', 'export class SubprocessCLITransport {}');
  writeSourceFile(projectRoot, 'src/parser/message-parser.ts', 'export class MessageParser {}');
  writeSourceFile(projectRoot, 'src/session/store.ts', 'export class SessionStore {}');
  writeSourceFile(projectRoot, 'tests/query.test.ts', 'export class TestQuery {}');

  writeModuleSpec(
    outputDir,
    createModuleSpec({
      sourceTarget: 'src/client/query.ts',
      relatedFiles: ['src/client/query.ts'],
      intent: '负责 SDK 请求入口与主链路编排。',
      businessLogic: '接收 query/connect 请求，协调 transport、parser 与 session 组件。',
      dependencies: '依赖 transport、parser 与 session 子系统。',
      baselineSkeleton: createSkeleton(projectRoot, 'src/client/query.ts', [
        {
          name: 'Query',
          kind: 'class',
          signature: 'class Query',
          isDefault: false,
          startLine: 1,
          endLine: 120,
          members: [
            {
              name: 'connect',
              kind: 'method',
              signature: 'connect(): Promise<void>',
              isStatic: false,
            },
            {
              name: 'query',
              kind: 'method',
              signature: 'query(prompt: string): Promise<Result>',
              isStatic: false,
            },
            {
              name: 'interrupt',
              kind: 'method',
              signature: 'interrupt(): Promise<void>',
              isStatic: false,
            },
          ],
        },
      ], [
        createImport(projectRoot, './transport/subprocess-cli', 'src/transport/subprocess-cli.ts'),
        createImport(projectRoot, './parser/message-parser', 'src/parser/message-parser.ts'),
        createImport(projectRoot, './session/store', 'src/session/store.ts'),
      ]),
    }),
  );

  writeModuleSpec(
    outputDir,
    createModuleSpec({
      sourceTarget: 'src/transport/subprocess-cli.ts',
      relatedFiles: ['src/transport/subprocess-cli.ts'],
      intent: '负责子进程 transport 与 IO dispatch。',
      businessLogic: '发送请求、接收流式响应，并把原始 payload 交给 parser。',
      dependencies: '依赖 parser 处理 message payload。',
      baselineSkeleton: createSkeleton(projectRoot, 'src/transport/subprocess-cli.ts', [
        {
          name: 'SubprocessCLITransport',
          kind: 'class',
          signature: 'class SubprocessCLITransport',
          isDefault: false,
          startLine: 1,
          endLine: 100,
          members: [
            {
              name: 'send',
              kind: 'method',
              signature: 'send(payload: string): Promise<void>',
              isStatic: false,
            },
            {
              name: 'streamResponse',
              kind: 'method',
              signature: 'streamResponse(): AsyncIterable<string>',
              isStatic: false,
            },
          ],
        },
      ], [
        createImport(projectRoot, '../parser/message-parser', 'src/parser/message-parser.ts'),
      ]),
    }),
  );

  writeModuleSpec(
    outputDir,
    createModuleSpec({
      sourceTarget: 'src/parser/message-parser.ts',
      relatedFiles: ['src/parser/message-parser.ts'],
      intent: '负责把底层 message payload 解析成上层结构。',
      businessLogic: '解析流式 chunk 与最终结果消息。',
      dependencies: '被 query/transport 调用。',
      baselineSkeleton: createSkeleton(projectRoot, 'src/parser/message-parser.ts', [
        {
          name: 'MessageParser',
          kind: 'class',
          signature: 'class MessageParser',
          isDefault: false,
          startLine: 1,
          endLine: 80,
          members: [
            {
              name: 'parseMessage',
              kind: 'method',
              signature: 'parseMessage(raw: string): ParsedMessage',
              isStatic: false,
            },
          ],
        },
      ], []),
    }),
  );

  writeModuleSpec(
    outputDir,
    createModuleSpec({
      sourceTarget: 'src/session/store.ts',
      relatedFiles: ['src/session/store.ts'],
      intent: '负责 session 状态读取与持久化。',
      businessLogic: '在主链路结束后保存 transcript，并支持恢复既有会话。',
      dependencies: '依赖本地文件系统。',
      baselineSkeleton: createSkeleton(projectRoot, 'src/session/store.ts', [
        {
          name: 'SessionStore',
          kind: 'class',
          signature: 'class SessionStore',
          isDefault: false,
          startLine: 1,
          endLine: 80,
          members: [
            {
              name: 'loadSession',
              kind: 'method',
              signature: 'loadSession(sessionId: string): SessionData',
              isStatic: false,
            },
            {
              name: 'saveSession',
              kind: 'method',
              signature: 'saveSession(sessionId: string, payload: ParsedMessage): void',
              isStatic: false,
            },
          ],
        },
      ], []),
    }),
  );

  writeModuleSpec(
    outputDir,
    createModuleSpec({
      sourceTarget: 'tests/query.test.ts',
      relatedFiles: ['tests/query.test.ts'],
      intent: '负责 Query 的测试覆盖。',
      businessLogic: '覆盖 query 主链路的测试断言。',
      dependencies: '依赖测试框架。',
      baselineSkeleton: createSkeleton(projectRoot, 'tests/query.test.ts', [
        {
          name: 'TestQuery',
          kind: 'class',
          signature: 'class TestQuery',
          isDefault: false,
          startLine: 1,
          endLine: 40,
          members: [
            {
              name: 'test_query',
              kind: 'method',
              signature: 'test_query(): void',
              isStatic: false,
            },
          ],
        },
      ], []),
      confidence: 'medium',
    }),
  );

  return {
    projectRoot,
    outputDir,
    storedModules: loadStoredModuleSpecs(outputDir, projectRoot),
    architectureIR: createArchitectureIRFixture(),
    eventSurface: createEventSurfaceFixture(),
    runtime: createRuntimeFixture(),
  };
}

export function cleanupComponentDynamicFixture(fixture: Pick<ComponentDynamicFixture, 'projectRoot'>): void {
  fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
}

function writeSourceFile(projectRoot: string, relativePath: string, content: string): void {
  const filePath = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function writeModuleSpec(outputDir: string, moduleSpec: ModuleSpec): void {
  const fileName = path.basename(moduleSpec.frontmatter.sourceTarget).replace(/\.[^.]+$/, '.spec.md');
  fs.writeFileSync(path.join(outputDir, fileName), renderSpec(moduleSpec), 'utf-8');
}

function createModuleSpec(input: {
  sourceTarget: string;
  relatedFiles: string[];
  intent: string;
  businessLogic: string;
  dependencies: string;
  baselineSkeleton: CodeSkeleton;
  confidence?: 'high' | 'medium' | 'low';
}): ModuleSpec {
  return {
    frontmatter: {
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'reverse-spec v2.2.0',
      sourceTarget: input.sourceTarget,
      relatedFiles: input.relatedFiles,
      lastUpdated: '2026-03-21T00:00:00.000Z',
      confidence: input.confidence ?? 'high',
      skeletonHash: input.baselineSkeleton.hash,
    },
    sections: {
      intent: input.intent,
      interfaceDefinition: `${input.sourceTarget} interface definition`,
      businessLogic: input.businessLogic,
      dataStructures: `${input.sourceTarget} data structures`,
      constraints: `${input.sourceTarget} constraints`,
      edgeCases: `${input.sourceTarget} edge cases`,
      technicalDebt: `${input.sourceTarget} technical debt`,
      testCoverage: `${input.sourceTarget} test coverage`,
      dependencies: input.dependencies,
    },
    fileInventory: input.relatedFiles.map((filePath) => ({
      path: filePath,
      loc: 20,
      purpose: `${filePath} implementation`,
    })),
    baselineSkeleton: input.baselineSkeleton,
    outputPath: path.posix.join('specs', path.basename(input.sourceTarget).replace(/\.[^.]+$/, '.spec.md')),
  };
}

function createSkeleton(
  projectRoot: string,
  filePath: string,
  exports: ExportSymbol[],
  imports: ImportReference[],
): CodeSkeleton {
  return {
    filePath,
    language: 'typescript',
    loc: 60,
    exports,
    imports,
    hash: createHash('sha256').update(`${filePath}:${exports.map((item) => item.name).join(',')}`).digest('hex'),
    analyzedAt: '2026-03-21T00:00:00.000Z',
    parserUsed: 'baseline',
  };
}

function createImport(
  projectRoot: string,
  moduleSpecifier: string,
  resolvedPath: string,
): ImportReference {
  return {
    moduleSpecifier,
    isRelative: true,
    resolvedPath: path.join(projectRoot, resolvedPath),
    namedImports: [],
    defaultImport: null,
    isTypeOnly: false,
  };
}

function createArchitectureIRFixture(): ArchitectureIR {
  const views: ArchitectureIRView[] = [
    {
      id: 'system-context',
      kind: 'system-context',
      title: 'System Context',
      available: true,
      description: 'system context',
      mermaidSection: 'system-context',
      elementIds: ['group:sdk', 'package:@fixture/client', 'package:@fixture/transport', 'package:@fixture/parser', 'package:@fixture/session'],
      relationshipIds: [
        'group:sdk|contains|package:@fixture/client',
        'group:sdk|contains|package:@fixture/transport',
        'group:sdk|contains|package:@fixture/parser',
        'group:sdk|contains|package:@fixture/session',
      ],
      warnings: [],
      metadata: {},
    },
    {
      id: 'component',
      kind: 'component',
      title: 'Component',
      available: true,
      description: 'component',
      mermaidSection: 'layered',
      elementIds: ['group:sdk', 'package:@fixture/client', 'package:@fixture/transport', 'package:@fixture/parser', 'package:@fixture/session'],
      relationshipIds: [
        'package:@fixture/client|depends-on|package:@fixture/transport',
        'package:@fixture/client|depends-on|package:@fixture/parser',
        'package:@fixture/client|depends-on|package:@fixture/session',
        'package:@fixture/transport|depends-on|package:@fixture/parser',
      ],
      warnings: [],
      metadata: {},
    },
    {
      id: 'deployment',
      kind: 'deployment',
      title: 'Deployment',
      available: false,
      description: 'deployment',
      mermaidSection: 'deployment',
      elementIds: [],
      relationshipIds: [],
      warnings: [],
      metadata: {},
    },
  ];

  const evidence = createIrEvidence('src/client/query.ts');
  const relationships: ArchitectureIRRelationship[] = [
    createIrRelationship('group:sdk', 'package:@fixture/client', 'contains', evidence),
    createIrRelationship('group:sdk', 'package:@fixture/transport', 'contains', createIrEvidence('src/transport/subprocess-cli.ts')),
    createIrRelationship('group:sdk', 'package:@fixture/parser', 'contains', createIrEvidence('src/parser/message-parser.ts')),
    createIrRelationship('group:sdk', 'package:@fixture/session', 'contains', createIrEvidence('src/session/store.ts')),
    createIrRelationship('package:@fixture/client', 'package:@fixture/transport', 'depends-on', evidence),
    createIrRelationship('package:@fixture/client', 'package:@fixture/parser', 'depends-on', evidence),
    createIrRelationship('package:@fixture/client', 'package:@fixture/session', 'depends-on', evidence),
    createIrRelationship('package:@fixture/transport', 'package:@fixture/parser', 'depends-on', createIrEvidence('src/transport/subprocess-cli.ts')),
  ];

  const ir: ArchitectureIR = {
    projectName: 'component-fixture',
    generatedAt: '2026-03-21T00:00:00.000Z',
    sourceTags: ['workspace-index', 'cross-package-deps'],
    warnings: [],
    elements: [
      {
        id: 'group:sdk',
        name: 'sdk',
        kind: 'component',
        description: 'SDK group',
        technology: 'Workspace Group',
        tags: ['Module Group'],
        sourceTags: ['workspace-index'],
        evidence: [createIrEvidence('sdk')],
        metadata: {
          originalKind: 'module-group',
          packageCount: 4,
          packages: ['@fixture/client', '@fixture/transport', '@fixture/parser', '@fixture/session'],
        },
      },
      {
        id: 'package:@fixture/client',
        name: '@fixture/client',
        kind: 'component',
        description: 'TypeScript | src/client',
        technology: 'TypeScript',
        tags: ['Workspace Package'],
        sourceTags: ['workspace-index', 'cross-package-deps'],
        evidence: [createIrEvidence('src/client')],
        metadata: {
          path: 'src/client',
          language: 'TypeScript',
          group: 'sdk',
          dependencies: ['@fixture/transport', '@fixture/parser', '@fixture/session'],
        },
      },
      {
        id: 'package:@fixture/transport',
        name: '@fixture/transport',
        kind: 'component',
        description: 'TypeScript | src/transport',
        technology: 'TypeScript',
        tags: ['Workspace Package'],
        sourceTags: ['workspace-index', 'cross-package-deps'],
        evidence: [createIrEvidence('src/transport')],
        metadata: {
          path: 'src/transport',
          language: 'TypeScript',
          group: 'sdk',
          dependencies: ['@fixture/parser'],
        },
      },
      {
        id: 'package:@fixture/parser',
        name: '@fixture/parser',
        kind: 'component',
        description: 'TypeScript | src/parser',
        technology: 'TypeScript',
        tags: ['Workspace Package'],
        sourceTags: ['workspace-index'],
        evidence: [createIrEvidence('src/parser')],
        metadata: {
          path: 'src/parser',
          language: 'TypeScript',
          group: 'sdk',
          dependencies: [],
        },
      },
      {
        id: 'package:@fixture/session',
        name: '@fixture/session',
        kind: 'component',
        description: 'TypeScript | src/session',
        technology: 'TypeScript',
        tags: ['Workspace Package'],
        sourceTags: ['workspace-index'],
        evidence: [createIrEvidence('src/session')],
        metadata: {
          path: 'src/session',
          language: 'TypeScript',
          group: 'sdk',
          dependencies: [],
        },
      },
    ],
    relationships,
    views,
    stats: summarizeArchitectureIR({
      elements: [],
      relationships: [],
      views,
      warnings: [],
      sourceTags: ['workspace-index', 'cross-package-deps'],
    }),
    metadata: {},
  };

  ir.stats = summarizeArchitectureIR(ir);
  return ir;
}

function createIrRelationship(
  sourceId: string,
  destinationId: string,
  kind: ArchitectureIRRelationship['kind'],
  evidence: ArchitectureIREvidence,
): ArchitectureIRRelationship {
  return {
    id: `${sourceId}|${kind}|${destinationId}`,
    sourceId,
    destinationId,
    kind,
    description: kind,
    tags: [],
    sourceTags: ['workspace-index'],
    evidence: [evidence],
    metadata: {},
  };
}

function createIrEvidence(ref: string): ArchitectureIREvidence {
  return {
    source: 'workspace-index',
    ref,
  };
}

function createEventSurfaceFixture(): EventSurfaceOutput {
  return {
    title: '事件面文档: component-fixture',
    generatedAt: '2026-03-21T00:00:00.000Z',
    projectName: 'component-fixture',
    channels: [
      {
        channelName: 'query.completed',
        kind: 'event',
        publishers: [
          {
            role: 'publisher',
            sourceFile: 'src/client/query.ts',
            symbolName: 'Query',
            methodName: 'query',
            payloadFields: ['sessionId', 'message'],
          },
        ],
        subscribers: [
          {
            role: 'subscriber',
            sourceFile: 'src/session/store.ts',
            symbolName: 'SessionStore',
            methodName: 'saveSession',
            payloadFields: ['sessionId', 'message'],
          },
        ],
        messageFields: ['sessionId', 'message'],
        payloadSamples: ['{ sessionId, message }'],
      },
    ],
    totalChannels: 1,
    totalPublishers: 1,
    totalSubscribers: 1,
    warnings: [],
    eventFlowMermaid: undefined,
    stateAppendixMermaid: undefined,
    stateAppendixConfidence: undefined,
  };
}

function createRuntimeFixture(): RuntimeTopologyOutput {
  return {
    title: '运行时拓扑: component-fixture',
    generatedAt: '2026-03-21T00:00:00.000Z',
    topology: {
      projectName: 'component-fixture',
      services: [
        {
          name: 'gateway',
          sourceFile: 'docker-compose.yml',
          containerName: 'gateway',
          image: 'node:20-alpine',
          buildContext: '.',
          dockerfilePath: 'Dockerfile',
          targetStage: 'runtime',
          stageNames: ['builder', 'runtime'],
          command: 'node dist/index.js',
          entrypoint: undefined,
          environment: [],
          envFiles: [],
          ports: [{ published: 3000, target: 3000, protocol: 'tcp' }],
          volumes: [],
          dependsOn: [],
        },
      ],
      images: [
        {
          name: 'node:20-alpine',
          sourceFile: 'Dockerfile',
          stages: ['builder', 'runtime'],
        },
      ],
      containers: [
        {
          name: 'gateway',
          sourceFile: 'docker-compose.yml',
          service: 'gateway',
          image: 'node:20-alpine',
          command: 'node dist/index.js',
          entrypoint: undefined,
        },
      ],
      stages: [
        {
          name: 'builder',
          sourceFile: 'Dockerfile',
          baseImage: 'node:20-alpine',
          role: 'build',
          commands: ['npm run build'],
          env: [],
          copiesFrom: [],
          exposedPorts: [],
          volumes: [],
        },
        {
          name: 'runtime',
          sourceFile: 'Dockerfile',
          baseImage: 'node:20-alpine',
          role: 'runtime',
          commands: ['node dist/index.js'],
          env: [],
          copiesFrom: ['builder'],
          exposedPorts: ['3000'],
          volumes: [],
        },
      ],
      warnings: [],
      stats: {
        totalServices: 1,
        totalImages: 1,
        totalContainers: 1,
        totalStages: 2,
        totalWarnings: 0,
      },
    },
    warnings: [],
  };
}
