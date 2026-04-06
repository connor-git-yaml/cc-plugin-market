/**
 * Architecture IR shared model
 *
 * Feature 056 将现有 panoramic 架构事实统一为一份中间表示，
 * 供 JSON / Structurizr DSL / Mermaid 互通导出复用。
 */

export type ArchitectureIRSourceTag =
  | 'architecture-overview'
  | 'runtime-topology'
  | 'workspace-index'
  | 'cross-package-deps';

export type ArchitectureIRElementKind =
  | 'software-system'
  | 'container'
  | 'component'
  | 'deployment-node'
  | 'infrastructure-node'
  | 'external-system'
  | 'image';

export type ArchitectureIRRelationshipKind =
  | 'contains'
  | 'depends-on'
  | 'deploys'
  | 'uses-image'
  | 'groups';

export type ArchitectureIRViewKind = 'system-context' | 'deployment' | 'component';
export type ArchitectureIRMermaidSectionKind = 'system-context' | 'deployment' | 'layered';

export interface ArchitectureIREvidence {
  source: ArchitectureIRSourceTag;
  ref: string;
  note?: string;
}

export interface ArchitectureIRElement {
  id: string;
  name: string;
  kind: ArchitectureIRElementKind;
  description?: string;
  technology?: string;
  tags: string[];
  sourceTags: ArchitectureIRSourceTag[];
  evidence: ArchitectureIREvidence[];
  metadata: Record<string, unknown>;
}

export interface ArchitectureIRRelationship {
  id: string;
  sourceId: string;
  destinationId: string;
  kind: ArchitectureIRRelationshipKind;
  description: string;
  technology?: string;
  tags: string[];
  sourceTags: ArchitectureIRSourceTag[];
  evidence: ArchitectureIREvidence[];
  metadata: Record<string, unknown>;
}

export interface ArchitectureIRView {
  id: ArchitectureIRViewKind;
  kind: ArchitectureIRViewKind;
  title: string;
  available: boolean;
  description?: string;
  mermaidSection: ArchitectureIRMermaidSectionKind;
  elementIds: string[];
  relationshipIds: string[];
  warnings: string[];
  metadata: Record<string, unknown>;
}

export interface ArchitectureIRStats {
  totalElements: number;
  totalRelationships: number;
  totalViews: number;
  availableViews: number;
  totalWarnings: number;
  sourceCount: number;
}

export interface ArchitectureIR {
  projectName: string;
  generatedAt: string;
  sourceTags: ArchitectureIRSourceTag[];
  warnings: string[];
  elements: ArchitectureIRElement[];
  relationships: ArchitectureIRRelationship[];
  views: ArchitectureIRView[];
  stats: ArchitectureIRStats;
  metadata: Record<string, unknown>;
}

export interface ArchitectureIRMermaidSection {
  kind: ArchitectureIRMermaidSectionKind;
  title: string;
  diagram: string;
}

export interface ArchitectureIRMermaidExport {
  sections: ArchitectureIRMermaidSection[];
  combinedDiagram?: string;
}

export interface ArchitectureIRExportBundle {
  json: ArchitectureIR;
  structurizrDsl?: string;
  mermaid: ArchitectureIRMermaidExport;
}

export function summarizeArchitectureIR(
  ir: Pick<ArchitectureIR, 'elements' | 'relationships' | 'views' | 'warnings' | 'sourceTags'>,
): ArchitectureIRStats {
  return {
    totalElements: ir.elements.length,
    totalRelationships: ir.relationships.length,
    totalViews: ir.views.length,
    availableViews: ir.views.filter((view) => view.available).length,
    totalWarnings: ir.warnings.length,
    sourceCount: ir.sourceTags.length,
  };
}

export function getArchitectureIRView(
  ir: ArchitectureIR,
  kind: ArchitectureIRViewKind,
): ArchitectureIRView | undefined {
  return ir.views.find((view) => view.kind === kind);
}
