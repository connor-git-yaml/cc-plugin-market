/**
 * ArchitectureOverviewGenerator
 *
 * 组合 RuntimeTopology、WorkspaceIndex、CrossPackage 的结构化输出，
 * 生成系统上下文、部署视图和分层视图的统一架构概览。
 */
import * as path from 'node:path';
import type { DocumentGenerator, GenerateOptions, ProjectContext } from './interfaces.js';
import { CrossPackageAnalyzer, type CrossPackageOutput } from './cross-package-analyzer.js';
import { RuntimeTopologyGenerator, type RuntimeTopologyOutput } from './runtime-topology-generator.js';
import {
  createArchitectureEvidence,
  getArchitectureSection,
  inferModuleResponsibility,
  summarizeArchitectureOverview,
  type ArchitectureOverviewModel,
  type ArchitectureModuleSummary,
  type ArchitectureViewEdge,
  type ArchitectureViewNode,
  type ArchitectureViewSection,
  type DeploymentUnitSummary,
} from './architecture-overview-model.js';
import { WorkspaceIndexGenerator, type WorkspaceOutput } from './workspace-index-generator.js';
import { loadTemplate } from './utils/template-loader.js';
import { sanitizeMermaidId } from './utils/mermaid-helpers.js';

const PROJECT_NODE_ID = 'project';

export interface ArchitectureOverviewInput {
  projectName: string;
  runtime?: RuntimeTopologyOutput;
  workspace?: WorkspaceOutput;
  crossPackage?: CrossPackageOutput;
  warnings: string[];
}

export interface ArchitectureOverviewOutput {
  title: string;
  generatedAt: string;
  model: ArchitectureOverviewModel;
  warnings: string[];
  systemContext?: ArchitectureViewSection;
  deploymentView?: ArchitectureViewSection;
  layeredView?: ArchitectureViewSection;
}

export class ArchitectureOverviewGenerator
  implements DocumentGenerator<ArchitectureOverviewInput, ArchitectureOverviewOutput>
{
  readonly id = 'architecture-overview' as const;
  readonly name = '架构概览生成器' as const;
  readonly description = '组合运行时拓扑、workspace 和跨包依赖输出，生成系统上下文与部署视图';

  isApplicable(context: ProjectContext): boolean {
    const runtimeApplicable = new RuntimeTopologyGenerator().isApplicable(context);
    const workspaceApplicable = new WorkspaceIndexGenerator().isApplicable(context);
    return Boolean(runtimeApplicable || workspaceApplicable);
  }

  async extract(context: ProjectContext): Promise<ArchitectureOverviewInput> {
    const warnings = new Set<string>();
    const runtimeGenerator = new RuntimeTopologyGenerator();
    const workspaceGenerator = new WorkspaceIndexGenerator();
    const crossPackageAnalyzer = new CrossPackageAnalyzer();

    let runtime: RuntimeTopologyOutput | undefined;
    if (runtimeGenerator.isApplicable(context)) {
      try {
        runtime = await runtimeGenerator.generate(await runtimeGenerator.extract(context));
      } catch (error) {
        warnings.add(`运行时拓扑输入生成失败: ${String(error)}`);
      }
    } else {
      warnings.add('未检测到 Compose / Dockerfile，部署视图将按需降级');
    }

    let workspace: WorkspaceOutput | undefined;
    if (workspaceGenerator.isApplicable(context)) {
      try {
        workspace = await workspaceGenerator.generate(await workspaceGenerator.extract(context));
      } catch (error) {
        warnings.add(`Workspace 输入生成失败: ${String(error)}`);
      }
    } else {
      warnings.add('当前项目不是 monorepo，分层视图将按需降级');
    }

    let crossPackage: CrossPackageOutput | undefined;
    if (crossPackageAnalyzer.isApplicable(context)) {
      try {
        crossPackage = await crossPackageAnalyzer.generate(await crossPackageAnalyzer.extract(context));
      } catch (error) {
        warnings.add(`跨包依赖输入生成失败: ${String(error)}`);
      }
    } else if (workspace) {
      warnings.add('跨包依赖分析不适用，将仅使用 workspace 分组构建分层视图');
    }

    return {
      projectName: runtime?.topology.projectName
        ?? workspace?.projectName
        ?? crossPackage?.projectName
        ?? path.basename(context.projectRoot),
      runtime,
      workspace,
      crossPackage,
      warnings: uniqueSorted([...warnings]),
    };
  }

  async generate(
    input: ArchitectureOverviewInput,
    _options?: GenerateOptions,
  ): Promise<ArchitectureOverviewOutput> {
    const warnings = new Set<string>(input.warnings);
    const systemContext = buildSystemContextSection(
      input.projectName,
      input.runtime,
      input.workspace,
      input.crossPackage,
      warnings,
    );
    const deploymentView = buildDeploymentSection(input.runtime, warnings);
    const layeredView = buildLayeredSection(input.workspace, input.crossPackage, warnings);
    const moduleSummaries = buildModuleSummaries(input.workspace);
    const deploymentUnits = buildDeploymentUnits(input.runtime);

    const model: ArchitectureOverviewModel = {
      projectName: input.projectName,
      sections: [systemContext, deploymentView, layeredView],
      moduleSummaries,
      deploymentUnits,
      warnings: uniqueSorted([...warnings]),
      stats: {
        totalSections: 0,
        availableSections: 0,
        totalNodes: 0,
        totalEdges: 0,
        totalModules: 0,
        totalDeploymentUnits: 0,
        totalWarnings: 0,
      },
    };

    model.stats = summarizeArchitectureOverview(model);

    return {
      title: `架构概览: ${input.projectName}`,
      generatedAt: new Date().toISOString().split('T')[0]!,
      model,
      warnings: model.warnings,
      systemContext: getArchitectureSection(model, 'system-context'),
      deploymentView: getArchitectureSection(model, 'deployment'),
      layeredView: getArchitectureSection(model, 'layered'),
    };
  }

  render(output: ArchitectureOverviewOutput): string {
    const template = loadTemplate('architecture-overview.hbs', import.meta.url);
    return template(output);
  }
}

function buildSystemContextSection(
  projectName: string,
  runtime: RuntimeTopologyOutput | undefined,
  workspace: WorkspaceOutput | undefined,
  crossPackage: CrossPackageOutput | undefined,
  warnings: Set<string>,
): ArchitectureViewSection {
  const nodes = new Map<string, ArchitectureViewNode>();
  const edges = new Map<string, ArchitectureViewEdge>();

  addNode(nodes, {
    id: PROJECT_NODE_ID,
    label: projectName,
    kind: 'project',
    description: '当前项目系统边界',
    evidence: [],
  });

  if (runtime?.topology.services.length) {
    for (const service of runtime.topology.services) {
      const serviceId = `service:${service.name}`;
      const portList = service.ports
        .map((port) => `${port.published ?? '--'}->${port.target}/${port.protocol}`)
        .join(', ');

      addNode(nodes, {
        id: serviceId,
        label: service.name,
        kind: 'service',
        description: [
          service.containerName,
          service.image,
          portList.length > 0 ? `ports=${portList}` : '',
        ].filter(Boolean).join(' | '),
        evidence: [createArchitectureEvidence('runtime-topology', service.sourceFile)],
      });
      addEdge(edges, {
        from: PROJECT_NODE_ID,
        to: serviceId,
        relation: 'contains',
        evidence: [createArchitectureEvidence('runtime-topology', service.sourceFile)],
      });

      for (const dependency of service.dependsOn) {
        addEdge(edges, {
          from: serviceId,
          to: `service:${dependency.service}`,
          relation: 'depends-on',
          evidence: [createArchitectureEvidence('runtime-topology', dependency.sourceFile)],
        });
      }
    }
  }

  const groupDependencies = new Map<string, Set<string>>();
  if (workspace?.groups.length) {
    const packageToGroup = new Map<string, string>();
    for (const group of workspace.groups) {
      for (const pkg of group.packages) {
        packageToGroup.set(pkg.name, group.name);
      }
    }

    for (const group of workspace.groups) {
      const groupId = `group:${group.name}`;
      addNode(nodes, {
        id: groupId,
        label: group.name === '.' ? 'root' : group.name,
        kind: 'module-group',
        description: `${group.packages.length} 个子包`,
        evidence: [createArchitectureEvidence('workspace-index', group.name)],
      });
      addEdge(edges, {
        from: PROJECT_NODE_ID,
        to: groupId,
        relation: 'groups',
        evidence: [createArchitectureEvidence('workspace-index', group.name)],
      });

      for (const pkg of group.packages) {
        const currentGroup = group.name;
        for (const dependency of pkg.dependencies) {
          const targetGroup = packageToGroup.get(dependency);
          if (!targetGroup || targetGroup === currentGroup) {
            continue;
          }

          if (!groupDependencies.has(currentGroup)) {
            groupDependencies.set(currentGroup, new Set<string>());
          }
          groupDependencies.get(currentGroup)!.add(targetGroup);
        }
      }
    }
  }

  for (const [fromGroup, targets] of groupDependencies) {
    for (const targetGroup of targets) {
      addEdge(edges, {
        from: `group:${fromGroup}`,
        to: `group:${targetGroup}`,
        relation: 'depends-on',
        evidence: [
          createArchitectureEvidence(
            crossPackage ? 'cross-package' : 'workspace-index',
            crossPackage?.projectName ?? fromGroup,
          ),
        ],
      });
    }
  }

  const sectionNodes = [...nodes.values()];
  const sectionEdges = [...edges.values()];
  if (sectionNodes.length <= 1) {
    warnings.add('缺少运行时与 workspace 结构化输入，系统上下文视图已降级');
    return {
      kind: 'system-context',
      title: '系统上下文视图',
      available: false,
      nodes: sectionNodes,
      edges: sectionEdges,
      missingReason: '未检测到可组合的 runtime / workspace 输入',
    };
  }

  return {
    kind: 'system-context',
    title: '系统上下文视图',
    available: true,
    description: '高层展示项目边界、关键服务和主要模块组',
    nodes: sectionNodes,
    edges: sectionEdges,
    mermaidDiagram: buildMermaidDiagram(sectionNodes, sectionEdges),
  };
}

function buildDeploymentSection(
  runtime: RuntimeTopologyOutput | undefined,
  warnings: Set<string>,
): ArchitectureViewSection {
  if (!runtime || (runtime.topology.services.length === 0 && runtime.topology.images.length === 0)) {
    warnings.add('运行时拓扑不可用，部署视图已降级');
    return {
      kind: 'deployment',
      title: '部署视图',
      available: false,
      nodes: [],
      edges: [],
      missingReason: '未检测到 Compose / Dockerfile 运行时信号',
    };
  }

  const nodes = new Map<string, ArchitectureViewNode>();
  const edges = new Map<string, ArchitectureViewEdge>();

  for (const service of runtime.topology.services) {
    const serviceId = `service:${service.name}`;
    addNode(nodes, {
      id: serviceId,
      label: service.name,
      kind: 'service',
      description: `容器=${service.containerName}`,
      evidence: [createArchitectureEvidence('runtime-topology', service.sourceFile)],
    });

    addNode(nodes, {
      id: `container:${service.containerName}`,
      label: service.containerName,
      kind: 'container',
      description: service.command ? `CMD=${service.command}` : undefined,
      evidence: [createArchitectureEvidence('runtime-topology', service.sourceFile)],
    });

    addEdge(edges, {
      from: serviceId,
      to: `container:${service.containerName}`,
      relation: 'deploys',
      evidence: [createArchitectureEvidence('runtime-topology', service.sourceFile)],
    });

    if (service.image) {
      addNode(nodes, {
        id: `image:${service.image}`,
        label: service.image,
        kind: 'image',
        description: service.targetStage ? `target=${service.targetStage}` : undefined,
        evidence: [createArchitectureEvidence('runtime-topology', service.sourceFile)],
      });
      addEdge(edges, {
        from: `container:${service.containerName}`,
        to: `image:${service.image}`,
        relation: 'uses-image',
        evidence: [createArchitectureEvidence('runtime-topology', service.sourceFile)],
      });
    }

    for (const dependency of service.dependsOn) {
      addEdge(edges, {
        from: serviceId,
        to: `service:${dependency.service}`,
        relation: 'depends-on',
        evidence: [createArchitectureEvidence('runtime-topology', dependency.sourceFile)],
      });
    }
  }

  if (runtime.topology.services.length === 0) {
    for (const image of runtime.topology.images) {
      addNode(nodes, {
        id: `image:${image.name}`,
        label: image.name,
        kind: 'image',
        description: image.dockerfilePath ? `dockerfile=${image.dockerfilePath}` : undefined,
        evidence: [createArchitectureEvidence('runtime-topology', image.sourceFile)],
      });
    }
  }

  const sectionNodes = [...nodes.values()];
  const sectionEdges = [...edges.values()];
  return {
    kind: 'deployment',
    title: '部署视图',
    available: true,
    description: '展示服务、容器、镜像和关键部署依赖关系',
    nodes: sectionNodes,
    edges: sectionEdges,
    mermaidDiagram: buildMermaidDiagram(sectionNodes, sectionEdges),
  };
}

function buildLayeredSection(
  workspace: WorkspaceOutput | undefined,
  crossPackage: CrossPackageOutput | undefined,
  warnings: Set<string>,
): ArchitectureViewSection {
  if (!workspace) {
    warnings.add('Workspace 结构不可用，分层视图已降级');
    return {
      kind: 'layered',
      title: '分层视图',
      available: false,
      nodes: [],
      edges: [],
      missingReason: '当前项目不适用 workspace / cross-package 分层分析',
    };
  }

  const nodes = new Map<string, ArchitectureViewNode>();
  const edges = new Map<string, ArchitectureViewEdge>();
  const internalPackageNames = new Set(workspace.packages.map((pkg) => pkg.name));

  for (const group of workspace.groups) {
    const groupId = `group:${group.name}`;
    addNode(nodes, {
      id: groupId,
      label: group.name === '.' ? 'root' : group.name,
      kind: 'module-group',
      description: `${group.packages.length} 个子包`,
      evidence: [createArchitectureEvidence('workspace-index', group.name)],
    });

    for (const pkg of group.packages) {
      const packageId = `package:${pkg.name}`;
      addNode(nodes, {
        id: packageId,
        label: pkg.name,
        kind: 'package',
        description: `${pkg.language} | ${pkg.path}`,
        evidence: [createArchitectureEvidence('workspace-index', pkg.path)],
      });
      addEdge(edges, {
        from: groupId,
        to: packageId,
        relation: 'contains',
        evidence: [createArchitectureEvidence('workspace-index', pkg.path)],
      });

      for (const dependency of pkg.dependencies) {
        if (!internalPackageNames.has(dependency)) {
          continue;
        }
        addEdge(edges, {
          from: packageId,
          to: `package:${dependency}`,
          relation: 'depends-on',
          evidence: [
            createArchitectureEvidence(
              crossPackage ? 'cross-package' : 'workspace-index',
              crossPackage?.projectName ?? pkg.path,
            ),
          ],
        });
      }
    }
  }

  if (crossPackage?.hasCycles) {
    warnings.add(
      `检测到跨包循环依赖: ${crossPackage.cycleGroups.map((group) => group.cyclePath).join('; ')}`,
    );
  }

  return {
    kind: 'layered',
    title: '分层视图',
    available: true,
    description: '展示 workspace 分组、包级依赖和跨包层次',
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    mermaidDiagram: buildMermaidDiagram([...nodes.values()], [...edges.values()]),
  };
}

function buildModuleSummaries(workspace: WorkspaceOutput | undefined): ArchitectureModuleSummary[] {
  if (!workspace) {
    return [];
  }

  const groupByPackage = new Map<string, string>();
  for (const group of workspace.groups) {
    for (const pkg of group.packages) {
      groupByPackage.set(pkg.name, group.name);
    }
  }

  return workspace.packages
    .map((pkg) => ({
      groupName: groupByPackage.get(pkg.name) ?? '.',
      packageName: pkg.name,
      path: pkg.path,
      language: pkg.language,
      responsibility: inferModuleResponsibility(pkg.name, pkg.description, pkg.path),
      dependencies: [...pkg.dependencies].sort(),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function buildDeploymentUnits(runtime: RuntimeTopologyOutput | undefined): DeploymentUnitSummary[] {
  if (!runtime) {
    return [];
  }

  return runtime.topology.services
    .map((service) => ({
      serviceName: service.name,
      containerName: service.containerName,
      imageName: service.image,
      targetStage: service.targetStage,
      dependsOn: service.dependsOn.map((dependency) => dependency.service).sort(),
      ports: service.ports.map((port) => `${port.published ?? '--'}->${port.target}/${port.protocol}`),
      volumes: service.volumes.map((volume) => `${volume.source ?? '--'}:${volume.target}`),
    }))
    .sort((a, b) => a.serviceName.localeCompare(b.serviceName));
}

function addNode(target: Map<string, ArchitectureViewNode>, node: ArchitectureViewNode): void {
  if (!target.has(node.id)) {
    target.set(node.id, node);
  }
}

function addEdge(target: Map<string, ArchitectureViewEdge>, edge: ArchitectureViewEdge): void {
  const key = `${edge.from}|${edge.to}|${edge.relation}`;
  if (!target.has(key)) {
    target.set(key, edge);
  }
}

function buildMermaidDiagram(nodes: ArchitectureViewNode[], edges: ArchitectureViewEdge[]): string {
  const lines: string[] = ['graph TD'];

  for (const node of nodes) {
    const nodeId = sanitizeMermaidId(node.id);
    const label = escapeMermaidLabel(node.label);
    lines.push(`    ${nodeId}["${label}"]`);
  }

  if (edges.length === 0) {
    lines.push('    %% no edges');
  } else {
    for (const edge of edges) {
      const fromId = sanitizeMermaidId(edge.from);
      const toId = sanitizeMermaidId(edge.to);
      lines.push(`    ${fromId} -->|${edge.relation}| ${toId}`);
    }
  }

  return lines.join('\n');
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/"/g, '\\"');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
