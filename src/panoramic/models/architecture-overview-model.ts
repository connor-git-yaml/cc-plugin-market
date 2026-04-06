/**
 * Architecture overview shared model
 *
 * Feature 045 负责生产这份结构化架构视图模型，Feature 050 直接消费它。
 * 本文件只承载共享实体与 helper，不包含 Markdown/模板细节。
 */

export type ArchitectureSourceKind = 'runtime-topology' | 'workspace-index' | 'cross-package';
export type ArchitectureSectionKind = 'system-context' | 'deployment' | 'layered';
export type ArchitectureNodeKind =
  | 'project'
  | 'service'
  | 'container'
  | 'image'
  | 'module-group'
  | 'package'
  | 'external';
export type ArchitectureRelationKind =
  | 'contains'
  | 'depends-on'
  | 'deploys'
  | 'uses-image'
  | 'groups';

export interface ArchitectureEvidence {
  source: ArchitectureSourceKind;
  ref: string;
  note?: string;
}

export interface ArchitectureViewNode {
  id: string;
  label: string;
  kind: ArchitectureNodeKind;
  description?: string;
  evidence: ArchitectureEvidence[];
}

export interface ArchitectureViewEdge {
  from: string;
  to: string;
  relation: ArchitectureRelationKind;
  evidence: ArchitectureEvidence[];
}

export interface ArchitectureViewSection {
  kind: ArchitectureSectionKind;
  title: string;
  available: boolean;
  description?: string;
  nodes: ArchitectureViewNode[];
  edges: ArchitectureViewEdge[];
  mermaidDiagram?: string;
  missingReason?: string;
}

export interface ArchitectureModuleSummary {
  groupName: string;
  packageName: string;
  path: string;
  language: string;
  responsibility: string;
  dependencies: string[];
}

export interface DeploymentUnitSummary {
  serviceName: string;
  containerName?: string;
  imageName?: string;
  targetStage?: string;
  dependsOn: string[];
  ports: string[];
  volumes: string[];
}

export interface ArchitectureOverviewStats {
  totalSections: number;
  availableSections: number;
  totalNodes: number;
  totalEdges: number;
  totalModules: number;
  totalDeploymentUnits: number;
  totalWarnings: number;
}

export interface ArchitectureOverviewModel {
  projectName: string;
  sections: ArchitectureViewSection[];
  moduleSummaries: ArchitectureModuleSummary[];
  deploymentUnits: DeploymentUnitSummary[];
  warnings: string[];
  stats: ArchitectureOverviewStats;
}

export function createArchitectureEvidence(
  source: ArchitectureSourceKind,
  ref: string,
  note?: string,
): ArchitectureEvidence {
  return { source, ref, note };
}

export function inferModuleResponsibility(
  packageName: string,
  description: string,
  packagePath: string,
): string {
  const normalized = description.trim();
  if (normalized.length > 0) {
    return normalized;
  }

  return `[推断] ${packageName}（${packagePath}）未声明 description，职责基于包名/路径推断`;
}

export function summarizeArchitectureOverview(
  model: Pick<ArchitectureOverviewModel, 'sections' | 'moduleSummaries' | 'deploymentUnits' | 'warnings'>,
): ArchitectureOverviewStats {
  return {
    totalSections: model.sections.length,
    availableSections: model.sections.filter((section) => section.available).length,
    totalNodes: model.sections.reduce((sum, section) => sum + section.nodes.length, 0),
    totalEdges: model.sections.reduce((sum, section) => sum + section.edges.length, 0),
    totalModules: model.moduleSummaries.length,
    totalDeploymentUnits: model.deploymentUnits.length,
    totalWarnings: model.warnings.length,
  };
}

export function getArchitectureSection(
  model: ArchitectureOverviewModel,
  kind: ArchitectureSectionKind,
): ArchitectureViewSection | undefined {
  return model.sections.find((section) => section.kind === kind);
}
