/**
 * Architecture IR builder
 *
 * 以 045 的 ArchitectureOverviewOutput 作为统一结构主入口，
 * 并用 043/040/041 的结构化输出补齐属性与证据。
 */
import type { ArchitectureOverviewOutput } from './architecture-overview-generator.js';
import type { ArchitectureViewEdge, ArchitectureViewNode, ArchitectureViewSection } from './architecture-overview-model.js';
import type { RuntimeTopologyOutput } from './runtime-topology-generator.js';
import type { CrossPackageOutput } from './cross-package-analyzer.js';
import type { WorkspaceOutput } from './workspace-index-generator.js';
import {
  summarizeArchitectureIR,
  type ArchitectureIR,
  type ArchitectureIRElement,
  type ArchitectureIRElementKind,
  type ArchitectureIREvidence,
  type ArchitectureIRRelationship,
  type ArchitectureIRRelationshipKind,
  type ArchitectureIRSourceTag,
  type ArchitectureIRView,
  type ArchitectureIRViewKind,
  type ArchitectureIRMermaidSectionKind,
} from './architecture-ir-model.js';

interface ArchitectureIRViewState {
  id: ArchitectureIRViewKind;
  kind: ArchitectureIRViewKind;
  title: string;
  available: boolean;
  description?: string;
  mermaidSection: ArchitectureIRMermaidSectionKind;
  elementIds: Set<string>;
  relationshipIds: Set<string>;
  warnings: Set<string>;
  metadata: Record<string, unknown>;
}

export interface BuildArchitectureIROptions {
  architectureOverview: ArchitectureOverviewOutput;
  runtime?: RuntimeTopologyOutput;
  workspace?: WorkspaceOutput;
  crossPackage?: CrossPackageOutput;
}

export function buildArchitectureIR(options: BuildArchitectureIROptions): ArchitectureIR {
  const warnings = new Set<string>([
    ...options.architectureOverview.warnings,
    ...(options.runtime?.warnings ?? []),
  ]);
  const elementMap = new Map<string, ArchitectureIRElement>();
  const relationshipMap = new Map<string, ArchitectureIRRelationship>();
  const viewStates = initializeViewStates(options.architectureOverview.model.sections);

  for (const section of options.architectureOverview.model.sections) {
    const viewState = viewStates.get(mapSectionToViewKind(section.kind));
    if (!viewState) {
      continue;
    }

    for (const node of section.nodes) {
      const element = upsertElementFromOverviewNode(elementMap, node, section.kind);
      viewState.elementIds.add(element.id);
    }

    for (const edge of section.edges) {
      const relationship = upsertRelationshipFromOverviewEdge(relationshipMap, edge, section.kind);
      viewState.relationshipIds.add(relationship.id);
    }
  }

  augmentFromRuntime(options.runtime, elementMap, relationshipMap, viewStates);
  augmentFromWorkspace(options.workspace, elementMap, relationshipMap, viewStates);
  augmentFromCrossPackage(options.crossPackage, elementMap, warnings);

  const views = [...viewStates.values()]
    .map((viewState) => finalizeView(viewState))
    .sort(viewSort);

  const sourceTags = uniqueSorted([
    'architecture-overview',
    ...(options.runtime ? ['runtime-topology'] : []),
    ...(options.workspace ? ['workspace-index'] : []),
    ...(options.crossPackage ? ['cross-package-deps'] : []),
  ]) as ArchitectureIRSourceTag[];

  const ir: ArchitectureIR = {
    projectName: options.architectureOverview.model.projectName,
    generatedAt: new Date().toISOString(),
    sourceTags,
    warnings: uniqueSorted([...warnings]),
    elements: [...elementMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
    relationships: [...relationshipMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
    views,
    stats: {
      totalElements: 0,
      totalRelationships: 0,
      totalViews: 0,
      availableViews: 0,
      totalWarnings: 0,
      sourceCount: 0,
    },
    metadata: {
      architectureOverviewStats: options.architectureOverview.model.stats,
      moduleSummaries: options.architectureOverview.model.moduleSummaries,
      deploymentUnits: options.architectureOverview.model.deploymentUnits,
      runtimeStats: options.runtime?.stats,
      workspace: options.workspace
        ? {
            totalPackages: options.workspace.totalPackages,
            groups: options.workspace.groups.map((group) => ({
              name: group.name,
              packages: group.packages.map((pkg) => pkg.name),
            })),
          }
        : undefined,
      crossPackage: options.crossPackage
        ? {
            hasCycles: options.crossPackage.hasCycles,
            topologicalOrder: options.crossPackage.topologicalOrder,
            levels: options.crossPackage.levels,
            cycleGroups: options.crossPackage.cycleGroups,
            stats: options.crossPackage.stats,
          }
        : undefined,
    },
  };

  ir.stats = summarizeArchitectureIR(ir);
  return ir;
}

function initializeViewStates(sections: ArchitectureViewSection[]): Map<ArchitectureIRViewKind, ArchitectureIRViewState> {
  const states = new Map<ArchitectureIRViewKind, ArchitectureIRViewState>();

  for (const section of sections) {
    const kind = mapSectionToViewKind(section.kind);
    states.set(kind, {
      id: kind,
      kind,
      title: section.title,
      available: section.available,
      description: section.description,
      mermaidSection: section.kind === 'layered' ? 'layered' : section.kind,
      elementIds: new Set<string>(),
      relationshipIds: new Set<string>(),
      warnings: new Set<string>(section.missingReason ? [section.missingReason] : []),
      metadata: {
        sourceSectionKind: section.kind,
        sourceMermaidDiagram: section.mermaidDiagram,
      },
    });
  }

  if (!states.has('component')) {
    states.set('component', {
      id: 'component',
      kind: 'component',
      title: '组件视图',
      available: false,
      mermaidSection: 'layered',
      elementIds: new Set<string>(),
      relationshipIds: new Set<string>(),
      warnings: new Set<string>(['缺少可映射的分层视图']),
      metadata: {
        sourceSectionKind: 'layered',
      },
    });
  }

  return states;
}

function finalizeView(viewState: ArchitectureIRViewState): ArchitectureIRView {
  return {
    id: viewState.id,
    kind: viewState.kind,
    title: viewState.title,
    available: viewState.available,
    description: viewState.description,
    mermaidSection: viewState.mermaidSection,
    elementIds: [...viewState.elementIds].sort((a, b) => a.localeCompare(b)),
    relationshipIds: [...viewState.relationshipIds].sort((a, b) => a.localeCompare(b)),
    warnings: [...viewState.warnings].sort((a, b) => a.localeCompare(b)),
    metadata: viewState.metadata,
  };
}

function augmentFromRuntime(
  runtime: RuntimeTopologyOutput | undefined,
  elementMap: Map<string, ArchitectureIRElement>,
  relationshipMap: Map<string, ArchitectureIRRelationship>,
  viewStates: Map<ArchitectureIRViewKind, ArchitectureIRViewState>,
): void {
  if (!runtime) {
    return;
  }

  const deploymentView = viewStates.get('deployment');
  const systemContextView = viewStates.get('system-context');
  if (deploymentView && runtime.topology.services.length > 0) {
    deploymentView.available = true;
  }

  for (const service of runtime.topology.services) {
    const serviceElement = upsertElement(elementMap, {
      id: `service:${service.name}`,
      name: service.name,
      kind: 'container',
      description: service.containerName ? `容器=${service.containerName}` : undefined,
      technology: service.image ?? 'Service',
      tags: ['Runtime Service'],
      sourceTags: ['runtime-topology'],
      evidence: [{ source: 'runtime-topology', ref: service.sourceFile }],
      metadata: {
        originalKind: 'service',
        containerName: service.containerName,
        image: service.image,
        buildContext: service.buildContext,
        dockerfilePath: service.dockerfilePath,
        targetStage: service.targetStage,
        ports: service.ports.map((port) => `${port.published ?? '--'}->${port.target}/${port.protocol}`),
        volumes: service.volumes.map((volume) => `${volume.source ?? '--'}:${volume.target}`),
        dependsOn: service.dependsOn.map((dependency) => dependency.service),
      },
    });
    deploymentView?.elementIds.add(serviceElement.id);
    systemContextView?.elementIds.add(serviceElement.id);

    const containerElement = upsertElement(elementMap, {
      id: `container:${service.containerName}`,
      name: service.containerName,
      kind: 'deployment-node',
      description: service.command ? `CMD=${service.command}` : undefined,
      technology: 'Container Runtime',
      tags: ['Runtime Container'],
      sourceTags: ['runtime-topology'],
      evidence: [{ source: 'runtime-topology', ref: service.sourceFile }],
      metadata: {
        service: service.name,
        image: service.image,
        command: service.command,
        entrypoint: service.entrypoint,
        ports: service.ports.map((port) => `${port.published ?? '--'}->${port.target}/${port.protocol}`),
        volumes: service.volumes.map((volume) => `${volume.source ?? '--'}:${volume.target}`),
      },
    });
    deploymentView?.elementIds.add(containerElement.id);

    const deploysRelationship = upsertRelationship(relationshipMap, {
      sourceId: serviceElement.id,
      destinationId: containerElement.id,
      kind: 'deploys',
      description: 'deploys',
      technology: service.targetStage ?? service.image,
      tags: ['Deployment'],
      sourceTags: ['runtime-topology'],
      evidence: [{ source: 'runtime-topology', ref: service.sourceFile }],
      metadata: {},
    });
    deploymentView?.relationshipIds.add(deploysRelationship.id);

    if (service.image) {
      const imageElement = upsertElement(elementMap, {
        id: `image:${service.image}`,
        name: service.image,
        kind: 'image',
        description: service.targetStage ? `target=${service.targetStage}` : undefined,
        technology: 'Container Image',
        tags: ['Runtime Image'],
        sourceTags: ['runtime-topology'],
        evidence: [{ source: 'runtime-topology', ref: service.sourceFile }],
        metadata: {
          service: service.name,
          targetStage: service.targetStage,
          dockerfilePath: service.dockerfilePath,
        },
      });
      deploymentView?.elementIds.add(imageElement.id);

      const imageRelationship = upsertRelationship(relationshipMap, {
        sourceId: containerElement.id,
        destinationId: imageElement.id,
        kind: 'uses-image',
        description: 'uses-image',
        technology: service.image,
        tags: ['Deployment'],
        sourceTags: ['runtime-topology'],
        evidence: [{ source: 'runtime-topology', ref: service.sourceFile }],
        metadata: {},
      });
      deploymentView?.relationshipIds.add(imageRelationship.id);
    }

    for (const dependency of service.dependsOn) {
      const dependencyRelationship = upsertRelationship(relationshipMap, {
        sourceId: serviceElement.id,
        destinationId: `service:${dependency.service}`,
        kind: 'depends-on',
        description: 'depends-on',
        technology: dependency.condition,
        tags: ['Runtime Dependency'],
        sourceTags: ['runtime-topology'],
        evidence: [{ source: 'runtime-topology', ref: dependency.sourceFile }],
        metadata: {
          dependencyCondition: dependency.condition,
        },
      });
      deploymentView?.relationshipIds.add(dependencyRelationship.id);
      systemContextView?.relationshipIds.add(dependencyRelationship.id);
    }
  }

  for (const image of runtime.topology.images) {
    const imageElement = upsertElement(elementMap, {
      id: `image:${image.name}`,
      name: image.name,
      kind: 'image',
      description: image.dockerfilePath ? `dockerfile=${image.dockerfilePath}` : undefined,
      technology: 'Container Image',
      tags: ['Runtime Image'],
      sourceTags: ['runtime-topology'],
      evidence: [{ source: 'runtime-topology', ref: image.sourceFile }],
      metadata: {
        dockerfilePath: image.dockerfilePath,
        buildContext: image.buildContext,
        targetStage: image.targetStage,
        stageNames: image.stageNames,
      },
    });
    deploymentView?.elementIds.add(imageElement.id);
  }
}

function augmentFromWorkspace(
  workspace: WorkspaceOutput | undefined,
  elementMap: Map<string, ArchitectureIRElement>,
  relationshipMap: Map<string, ArchitectureIRRelationship>,
  viewStates: Map<ArchitectureIRViewKind, ArchitectureIRViewState>,
): void {
  if (!workspace) {
    return;
  }

  const componentView = viewStates.get('component');
  const systemContextView = viewStates.get('system-context');
  if (componentView && workspace.totalPackages > 0) {
    componentView.available = true;
  }

  const internalPackages = new Set(workspace.packages.map((pkg) => pkg.name));

  for (const group of workspace.groups) {
    const groupElement = upsertElement(elementMap, {
      id: `group:${group.name}`,
      name: group.name === '.' ? 'root' : group.name,
      kind: 'component',
      description: `${group.packages.length} 个子包`,
      technology: 'Workspace Group',
      tags: ['Module Group'],
      sourceTags: ['workspace-index'],
      evidence: [{ source: 'workspace-index', ref: group.name }],
      metadata: {
        originalKind: 'module-group',
        packageCount: group.packages.length,
        packages: group.packages.map((pkg) => pkg.name),
      },
    });
    componentView?.elementIds.add(groupElement.id);
    systemContextView?.elementIds.add(groupElement.id);

    for (const pkg of group.packages) {
      const packageElement = upsertElement(elementMap, {
        id: `package:${pkg.name}`,
        name: pkg.name,
        kind: 'component',
        description: `${pkg.language} | ${pkg.path}`,
        technology: pkg.language,
        tags: ['Workspace Package'],
        sourceTags: ['workspace-index'],
        evidence: [{ source: 'workspace-index', ref: pkg.path }],
        metadata: {
          path: pkg.path,
          language: pkg.language,
          description: pkg.description,
          dependencies: pkg.dependencies,
          group: group.name,
        },
      });
      componentView?.elementIds.add(packageElement.id);

      const containment = upsertRelationship(relationshipMap, {
        sourceId: groupElement.id,
        destinationId: packageElement.id,
        kind: 'contains',
        description: 'contains',
        tags: ['Workspace'],
        sourceTags: ['workspace-index'],
        evidence: [{ source: 'workspace-index', ref: pkg.path }],
        metadata: {},
      });
      componentView?.relationshipIds.add(containment.id);

      for (const dependency of pkg.dependencies) {
        if (!internalPackages.has(dependency)) {
          continue;
        }
        const packageDependency = upsertRelationship(relationshipMap, {
          sourceId: packageElement.id,
          destinationId: `package:${dependency}`,
          kind: 'depends-on',
          description: 'depends-on',
          tags: ['Workspace Dependency'],
          sourceTags: ['workspace-index'],
          evidence: [{ source: 'workspace-index', ref: pkg.path }],
          metadata: {},
        });
        componentView?.relationshipIds.add(packageDependency.id);
      }
    }
  }
}

function augmentFromCrossPackage(
  crossPackage: CrossPackageOutput | undefined,
  elementMap: Map<string, ArchitectureIRElement>,
  warnings: Set<string>,
): void {
  if (!crossPackage) {
    return;
  }

  for (const level of crossPackage.levels) {
    for (const packageName of level.packages) {
      const element = elementMap.get(`package:${packageName}`);
      if (!element) {
        continue;
      }
      element.sourceTags = mergeSourceTags(element.sourceTags, ['cross-package-deps']);
      element.metadata.topologyLevel = level.level;
    }
  }

  if (crossPackage.hasCycles) {
    warnings.add(
      `Architecture IR 映射保留循环依赖信息: ${crossPackage.cycleGroups.map((group) => group.cyclePath).join('; ')}`,
    );
  }

  for (const [index, cycleGroup] of crossPackage.cycleGroups.entries()) {
    for (const packageName of cycleGroup.packages) {
      const element = elementMap.get(`package:${packageName}`);
      if (!element) {
        continue;
      }
      element.sourceTags = mergeSourceTags(element.sourceTags, ['cross-package-deps']);
      element.metadata.cycleGroup = index;
      element.metadata.cyclePath = cycleGroup.cyclePath;
    }
  }
}

function upsertElementFromOverviewNode(
  elementMap: Map<string, ArchitectureIRElement>,
  node: ArchitectureViewNode,
  sectionKind: ArchitectureViewSection['kind'],
): ArchitectureIRElement {
  return upsertElement(elementMap, {
    id: node.id,
    name: node.label,
    kind: mapNodeToElementKind(node.kind),
    description: node.description,
    technology: inferTechnologyFromNodeKind(node.kind),
    tags: [node.kind, `section:${sectionKind}`],
    sourceTags: mergeSourceTags(
      ['architecture-overview'],
      node.evidence.map((evidence) => mapOverviewEvidenceSource(evidence.source)),
    ),
    evidence: [
      { source: 'architecture-overview', ref: `${sectionKind}:${node.id}` },
      ...node.evidence.map(mapOverviewEvidence),
    ],
    metadata: {
      originalKind: node.kind,
      sectionKinds: [sectionKind],
    },
  });
}

function upsertRelationshipFromOverviewEdge(
  relationshipMap: Map<string, ArchitectureIRRelationship>,
  edge: ArchitectureViewEdge,
  sectionKind: ArchitectureViewSection['kind'],
): ArchitectureIRRelationship {
  return upsertRelationship(relationshipMap, {
    sourceId: edge.from,
    destinationId: edge.to,
    kind: edge.relation,
    description: edge.relation,
    tags: [`section:${sectionKind}`],
    sourceTags: mergeSourceTags(
      ['architecture-overview'],
      edge.evidence.map((evidence) => mapOverviewEvidenceSource(evidence.source)),
    ),
    evidence: [
      { source: 'architecture-overview', ref: `${sectionKind}:${edge.from}->${edge.to}` },
      ...edge.evidence.map(mapOverviewEvidence),
    ],
    metadata: {
      sectionKinds: [sectionKind],
    },
  });
}

function upsertElement(
  elementMap: Map<string, ArchitectureIRElement>,
  candidate: Omit<ArchitectureIRElement, 'sourceTags' | 'tags' | 'evidence'> & {
    sourceTags: ArchitectureIRSourceTag[];
    tags: string[];
    evidence: ArchitectureIREvidence[];
  },
): ArchitectureIRElement {
  const existing = elementMap.get(candidate.id);
  if (!existing) {
    const created: ArchitectureIRElement = {
      ...candidate,
      tags: uniqueSorted(candidate.tags),
      sourceTags: uniqueSorted(candidate.sourceTags) as ArchitectureIRSourceTag[],
      evidence: dedupeEvidence(candidate.evidence),
    };
    elementMap.set(created.id, created);
    return created;
  }

  existing.description ??= candidate.description;
  existing.technology ??= candidate.technology;
  existing.tags = uniqueSorted([...existing.tags, ...candidate.tags]);
  existing.sourceTags = mergeSourceTags(existing.sourceTags, candidate.sourceTags);
  existing.evidence = dedupeEvidence([...existing.evidence, ...candidate.evidence]);
  existing.metadata = mergeMetadata(existing.metadata, candidate.metadata);

  const sectionKinds = new Set<string>([
    ...extractStringArray(existing.metadata.sectionKinds),
    ...extractStringArray(candidate.metadata.sectionKinds),
  ]);
  if (sectionKinds.size > 0) {
    existing.metadata.sectionKinds = [...sectionKinds].sort((a, b) => a.localeCompare(b));
  }

  return existing;
}

function upsertRelationship(
  relationshipMap: Map<string, ArchitectureIRRelationship>,
  candidate: Omit<ArchitectureIRRelationship, 'id' | 'sourceTags' | 'tags' | 'evidence'> & {
    sourceTags: ArchitectureIRSourceTag[];
    tags: string[];
    evidence: ArchitectureIREvidence[];
  },
): ArchitectureIRRelationship {
  const id = buildRelationshipId(candidate.sourceId, candidate.destinationId, candidate.kind);
  const existing = relationshipMap.get(id);

  if (!existing) {
    const created: ArchitectureIRRelationship = {
      id,
      ...candidate,
      tags: uniqueSorted(candidate.tags),
      sourceTags: uniqueSorted(candidate.sourceTags) as ArchitectureIRSourceTag[],
      evidence: dedupeEvidence(candidate.evidence),
    };
    relationshipMap.set(id, created);
    return created;
  }

  existing.technology ??= candidate.technology;
  existing.tags = uniqueSorted([...existing.tags, ...candidate.tags]);
  existing.sourceTags = mergeSourceTags(existing.sourceTags, candidate.sourceTags);
  existing.evidence = dedupeEvidence([...existing.evidence, ...candidate.evidence]);
  existing.metadata = mergeMetadata(existing.metadata, candidate.metadata);

  const sectionKinds = new Set<string>([
    ...extractStringArray(existing.metadata.sectionKinds),
    ...extractStringArray(candidate.metadata.sectionKinds),
  ]);
  if (sectionKinds.size > 0) {
    existing.metadata.sectionKinds = [...sectionKinds].sort((a, b) => a.localeCompare(b));
  }

  return existing;
}

function mapNodeToElementKind(nodeKind: ArchitectureViewNode['kind']): ArchitectureIRElementKind {
  switch (nodeKind) {
    case 'project':
      return 'software-system';
    case 'service':
      return 'container';
    case 'container':
      return 'deployment-node';
    case 'image':
      return 'image';
    case 'module-group':
    case 'package':
      return 'component';
    case 'external':
      return 'external-system';
    default:
      return 'component';
  }
}

function inferTechnologyFromNodeKind(nodeKind: ArchitectureViewNode['kind']): string | undefined {
  switch (nodeKind) {
    case 'project':
      return 'Software System';
    case 'service':
      return 'Service';
    case 'container':
      return 'Container Runtime';
    case 'image':
      return 'Container Image';
    case 'module-group':
      return 'Workspace Group';
    case 'package':
      return 'Package';
    default:
      return undefined;
  }
}

function mapOverviewEvidenceSource(source: 'runtime-topology' | 'workspace-index' | 'cross-package'): ArchitectureIRSourceTag {
  switch (source) {
    case 'runtime-topology':
      return 'runtime-topology';
    case 'workspace-index':
      return 'workspace-index';
    case 'cross-package':
      return 'cross-package-deps';
    default:
      return 'architecture-overview';
  }
}

function mapOverviewEvidence(
  evidence: { source: 'runtime-topology' | 'workspace-index' | 'cross-package'; ref: string; note?: string },
): ArchitectureIREvidence {
  return {
    source: mapOverviewEvidenceSource(evidence.source),
    ref: evidence.ref,
    note: evidence.note,
  };
}

function mapSectionToViewKind(sectionKind: ArchitectureViewSection['kind']): ArchitectureIRViewKind {
  switch (sectionKind) {
    case 'layered':
      return 'component';
    default:
      return sectionKind;
  }
}

function buildRelationshipId(
  sourceId: string,
  destinationId: string,
  kind: ArchitectureIRRelationshipKind,
): string {
  return `${sourceId}|${kind}|${destinationId}`;
}

function mergeMetadata(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...base,
    ...incoming,
  };
}

function extractStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function mergeSourceTags(
  base: ArchitectureIRSourceTag[],
  incoming: ArchitectureIRSourceTag[],
): ArchitectureIRSourceTag[] {
  return uniqueSorted([...base, ...incoming]) as ArchitectureIRSourceTag[];
}

function dedupeEvidence(evidenceList: ArchitectureIREvidence[]): ArchitectureIREvidence[] {
  const seen = new Set<string>();
  const result: ArchitectureIREvidence[] = [];

  for (const evidence of evidenceList) {
    const key = `${evidence.source}|${evidence.ref}|${evidence.note ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(evidence);
  }

  return result.sort((left, right) =>
    `${left.source}|${left.ref}`.localeCompare(`${right.source}|${right.ref}`),
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function viewSort(left: ArchitectureIRView, right: ArchitectureIRView): number {
  const order: ArchitectureIRViewKind[] = ['system-context', 'deployment', 'component'];
  return order.indexOf(left.kind) - order.indexOf(right.kind);
}
