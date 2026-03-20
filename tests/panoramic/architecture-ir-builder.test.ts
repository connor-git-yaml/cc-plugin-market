import { describe, expect, it } from 'vitest';
import { buildArchitectureIR } from '../../src/panoramic/architecture-ir-builder.js';
import { getArchitectureIRView, type ArchitectureOverviewOutput } from '../../src/panoramic/index.js';
import type { RuntimeTopologyOutput } from '../../src/panoramic/runtime-topology-generator.js';
import type { WorkspaceOutput } from '../../src/panoramic/workspace-index-generator.js';
import type { CrossPackageOutput } from '../../src/panoramic/cross-package-analyzer.js';

function createArchitectureOverviewFixture(): ArchitectureOverviewOutput {
  return {
    title: '架构概览: fixture-app',
    generatedAt: '2026-03-20',
    warnings: [],
    model: {
      projectName: 'fixture-app',
      sections: [
        {
          kind: 'system-context',
          title: '系统上下文视图',
          available: true,
          description: 'system context',
          nodes: [
            { id: 'project', label: 'fixture-app', kind: 'project', evidence: [] },
            {
              id: 'service:gateway',
              label: 'gateway',
              kind: 'service',
              description: '容器=gateway-container',
              evidence: [{ source: 'runtime-topology', ref: 'docker-compose.yml' }],
            },
            {
              id: 'service:db',
              label: 'db',
              kind: 'service',
              description: '容器=db',
              evidence: [{ source: 'runtime-topology', ref: 'docker-compose.yml' }],
            },
            {
              id: 'group:apps',
              label: 'apps',
              kind: 'module-group',
              description: '1 个子包',
              evidence: [{ source: 'workspace-index', ref: 'apps' }],
            },
          ],
          edges: [
            {
              from: 'project',
              to: 'service:gateway',
              relation: 'contains',
              evidence: [{ source: 'runtime-topology', ref: 'docker-compose.yml' }],
            },
            {
              from: 'project',
              to: 'group:apps',
              relation: 'groups',
              evidence: [{ source: 'workspace-index', ref: 'apps' }],
            },
            {
              from: 'service:gateway',
              to: 'service:db',
              relation: 'depends-on',
              evidence: [{ source: 'runtime-topology', ref: 'docker-compose.yml' }],
            },
          ],
          mermaidDiagram: 'graph TD\n    project --> gateway',
        },
        {
          kind: 'deployment',
          title: '部署视图',
          available: true,
          description: 'deployment',
          nodes: [
            {
              id: 'service:gateway',
              label: 'gateway',
              kind: 'service',
              description: '容器=gateway-container',
              evidence: [{ source: 'runtime-topology', ref: 'docker-compose.yml' }],
            },
            {
              id: 'service:db',
              label: 'db',
              kind: 'service',
              description: '容器=db',
              evidence: [{ source: 'runtime-topology', ref: 'docker-compose.yml' }],
            },
            {
              id: 'container:gateway-container',
              label: 'gateway-container',
              kind: 'container',
              description: 'CMD=node server.js',
              evidence: [{ source: 'runtime-topology', ref: 'docker-compose.yml' }],
            },
            {
              id: 'image:node:20-alpine',
              label: 'node:20-alpine',
              kind: 'image',
              description: 'target=runner',
              evidence: [{ source: 'runtime-topology', ref: 'docker-compose.yml' }],
            },
          ],
          edges: [
            {
              from: 'service:gateway',
              to: 'container:gateway-container',
              relation: 'deploys',
              evidence: [{ source: 'runtime-topology', ref: 'docker-compose.yml' }],
            },
            {
              from: 'container:gateway-container',
              to: 'image:node:20-alpine',
              relation: 'uses-image',
              evidence: [{ source: 'runtime-topology', ref: 'docker-compose.yml' }],
            },
            {
              from: 'service:gateway',
              to: 'service:db',
              relation: 'depends-on',
              evidence: [{ source: 'runtime-topology', ref: 'docker-compose.yml' }],
            },
          ],
          mermaidDiagram: 'graph TD\n    gateway --> gatewayContainer',
        },
        {
          kind: 'layered',
          title: '分层视图',
          available: true,
          description: 'component',
          nodes: [
            {
              id: 'group:apps',
              label: 'apps',
              kind: 'module-group',
              description: '1 个子包',
              evidence: [{ source: 'workspace-index', ref: 'apps' }],
            },
            {
              id: 'package:@repo/api',
              label: '@repo/api',
              kind: 'package',
              description: 'TypeScript | apps/api',
              evidence: [{ source: 'workspace-index', ref: 'apps/api' }],
            },
            {
              id: 'package:@repo/core',
              label: '@repo/core',
              kind: 'package',
              description: 'TypeScript | packages/core',
              evidence: [{ source: 'workspace-index', ref: 'packages/core' }],
            },
          ],
          edges: [
            {
              from: 'group:apps',
              to: 'package:@repo/api',
              relation: 'contains',
              evidence: [{ source: 'workspace-index', ref: 'apps/api' }],
            },
            {
              from: 'package:@repo/api',
              to: 'package:@repo/core',
              relation: 'depends-on',
              evidence: [{ source: 'cross-package', ref: 'fixture-app' }],
            },
          ],
          mermaidDiagram: 'graph TD\n    api --> core',
        },
      ],
      moduleSummaries: [
        {
          groupName: 'apps',
          packageName: '@repo/api',
          path: 'apps/api',
          language: 'TypeScript',
          responsibility: 'HTTP API service',
          dependencies: ['@repo/core'],
        },
      ],
      deploymentUnits: [
        {
          serviceName: 'gateway',
          containerName: 'gateway-container',
          imageName: 'node:20-alpine',
          targetStage: 'runner',
          dependsOn: ['db'],
          ports: ['8080->8080/tcp'],
          volumes: [],
        },
      ],
      warnings: [],
      stats: {
        totalSections: 3,
        availableSections: 3,
        totalNodes: 11,
        totalEdges: 8,
        totalModules: 1,
        totalDeploymentUnits: 1,
        totalWarnings: 0,
      },
    },
    systemContext: undefined,
    deploymentView: undefined,
    layeredView: undefined,
  };
}

function createRuntimeFixture(): RuntimeTopologyOutput {
  return {
    title: '运行时拓扑: fixture-app',
    generatedAt: '2026-03-20',
    topology: {
      projectName: 'fixture-app',
      services: [
        {
          name: 'gateway',
          sourceFile: 'docker-compose.yml',
          containerName: 'gateway-container',
          image: 'node:20-alpine',
          buildContext: './apps/api',
          dockerfilePath: 'apps/api/Dockerfile',
          targetStage: 'runner',
          stageNames: ['builder', 'runner'],
          command: 'node server.js',
          entrypoint: undefined,
          environment: [],
          envFiles: [],
          ports: [{ published: 8080, target: 8080, protocol: 'tcp' }],
          volumes: [],
          dependsOn: [{ service: 'db', condition: 'service_started', sourceFile: 'docker-compose.yml' }],
        },
        {
          name: 'db',
          sourceFile: 'docker-compose.yml',
          containerName: 'db',
          image: 'postgres:15',
          buildContext: undefined,
          dockerfilePath: undefined,
          targetStage: undefined,
          stageNames: [],
          command: undefined,
          entrypoint: undefined,
          environment: [],
          envFiles: [],
          ports: [],
          volumes: [],
          dependsOn: [],
        },
      ],
      images: [
        {
          name: 'node:20-alpine',
          explicitImage: 'node:20-alpine',
          sourceFile: 'docker-compose.yml',
          buildContext: './apps/api',
          dockerfilePath: 'apps/api/Dockerfile',
          targetStage: 'runner',
          stageNames: ['builder', 'runner'],
        },
      ],
      containers: [
        {
          name: 'gateway-container',
          service: 'gateway',
          sourceFile: 'docker-compose.yml',
          image: 'node:20-alpine',
          command: 'node server.js',
          entrypoint: undefined,
          environment: [],
          ports: [{ published: 8080, target: 8080, protocol: 'tcp' }],
          volumes: [],
          dependsOn: ['db'],
        },
      ],
      stages: [],
      configHints: [],
      sourceFiles: ['docker-compose.yml', 'apps/api/Dockerfile'],
    },
    stats: {
      totalServices: 2,
      totalImages: 1,
      totalContainers: 1,
      totalStages: 0,
      totalEnvVars: 0,
      totalConfigHints: 0,
      totalSourceFiles: 2,
    },
    warnings: [],
  };
}

function createWorkspaceFixture(): WorkspaceOutput {
  return {
    title: 'Workspace 架构索引: fixture-app',
    projectName: 'fixture-app',
    generatedAt: '2026-03-20',
    packages: [
      {
        name: '@repo/api',
        path: 'apps/api',
        description: 'HTTP API service',
        language: 'TypeScript',
        dependencies: ['@repo/core'],
      },
      {
        name: '@repo/core',
        path: 'packages/core',
        description: 'Shared domain utilities',
        language: 'TypeScript',
        dependencies: [],
      },
    ],
    dependencyDiagram: 'graph TD\n    api --> core',
    totalPackages: 2,
    groups: [
      {
        name: 'apps',
        packages: [{
          name: '@repo/api',
          path: 'apps/api',
          description: 'HTTP API service',
          language: 'TypeScript',
          dependencies: ['@repo/core'],
        }],
      },
      {
        name: 'packages',
        packages: [{
          name: '@repo/core',
          path: 'packages/core',
          description: 'Shared domain utilities',
          language: 'TypeScript',
          dependencies: [],
        }],
      },
    ],
  };
}

function createCrossPackageFixture(): CrossPackageOutput {
  return {
    title: '跨包依赖分析: fixture-app',
    generatedAt: '2026-03-20',
    projectName: 'fixture-app',
    workspaceType: 'npm',
    mermaidDiagram: 'graph TD\n    api --> core',
    levels: [
      { level: 0, packages: ['@repo/core'] },
      { level: 1, packages: ['@repo/api'] },
    ],
    topologicalOrder: ['@repo/core', '@repo/api'],
    hasCycles: true,
    cycleGroups: [{ packages: ['@repo/api', '@repo/core'], cyclePath: '@repo/api -> @repo/core -> @repo/api' }],
    stats: {
      totalPackages: 2,
      totalEdges: 1,
      rootPackages: ['@repo/api'],
      leafPackages: ['@repo/core'],
    },
  };
}

describe('buildArchitectureIR', () => {
  it('将 architecture-overview 作为主入口，并补齐 runtime/workspace/cross-package 元数据', () => {
    const ir = buildArchitectureIR({
      architectureOverview: createArchitectureOverviewFixture(),
      runtime: createRuntimeFixture(),
      workspace: createWorkspaceFixture(),
      crossPackage: createCrossPackageFixture(),
    });

    expect(ir.projectName).toBe('fixture-app');
    expect(ir.sourceTags).toEqual(
      expect.arrayContaining([
        'architecture-overview',
        'runtime-topology',
        'workspace-index',
        'cross-package-deps',
      ]),
    );
    expect(ir.stats.totalViews).toBe(3);
    expect(ir.stats.availableViews).toBe(3);

    expect(ir.elements.find((element) => element.id === 'project')?.kind).toBe('software-system');
    expect(ir.elements.find((element) => element.id === 'service:gateway')?.kind).toBe('container');
    expect(ir.elements.find((element) => element.id === 'container:gateway-container')?.kind).toBe('deployment-node');
    expect(ir.elements.find((element) => element.id === 'image:node:20-alpine')?.kind).toBe('image');

    const packageCore = ir.elements.find((element) => element.id === 'package:@repo/core');
    expect(packageCore?.metadata.topologyLevel).toBe(0);
    expect(packageCore?.metadata.cyclePath).toBe('@repo/api -> @repo/core -> @repo/api');

    const sharedDependency = ir.relationships.filter(
      (relationship) =>
        relationship.sourceId === 'service:gateway'
        && relationship.destinationId === 'service:db'
        && relationship.kind === 'depends-on',
    );
    expect(sharedDependency).toHaveLength(1);
    expect(sharedDependency[0]?.sourceTags).toEqual(
      expect.arrayContaining(['architecture-overview', 'runtime-topology']),
    );

    expect(getArchitectureIRView(ir, 'system-context')?.relationshipIds).toContain(sharedDependency[0]?.id);
    expect(getArchitectureIRView(ir, 'deployment')?.relationshipIds).toContain(sharedDependency[0]?.id);
    expect(getArchitectureIRView(ir, 'component')?.mermaidSection).toBe('layered');
    expect(ir.warnings.some((warning) => warning.includes('循环依赖'))).toBe(true);
  });
});
