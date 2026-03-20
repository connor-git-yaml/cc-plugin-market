/**
 * Architecture IR Mermaid interoperability adapter
 */
import {
  getArchitectureIRView,
  type ArchitectureIR,
  type ArchitectureIRElement,
  type ArchitectureIRExportBundle,
  type ArchitectureIRMermaidExport,
  type ArchitectureIRMermaidSection,
  type ArchitectureIRRelationship,
  type ArchitectureIRView,
} from './architecture-ir-model.js';
import { sanitizeMermaidId } from './utils/mermaid-helpers.js';

export function buildArchitectureIRMermaidExport(ir: ArchitectureIR): ArchitectureIRMermaidExport {
  const sections: ArchitectureIRMermaidSection[] = [];

  for (const kind of ['system-context', 'deployment', 'component'] as const) {
    const view = getArchitectureIRView(ir, kind);
    if (!view || !view.available || view.elementIds.length === 0) {
      continue;
    }

    const section = buildMermaidSection(ir, view);
    if (section) {
      sections.push(section);
    }
  }

  return {
    sections,
    combinedDiagram: sections.length > 0
      ? sections
        .map((section) => `%% ${section.kind}\n${section.diagram}`)
        .join('\n\n%% ----\n\n')
      : undefined,
  };
}

function buildMermaidSection(ir: ArchitectureIR, view: ArchitectureIRView): ArchitectureIRMermaidSection | undefined {
  const elementById = new Map(ir.elements.map((element) => [element.id, element]));
  const relationshipById = new Map(ir.relationships.map((relationship) => [relationship.id, relationship]));
  const elements = view.elementIds
    .map((id) => elementById.get(id))
    .filter((element): element is ArchitectureIRElement => element !== undefined);
  const relationships = view.relationshipIds
    .map((id) => relationshipById.get(id))
    .filter((relationship): relationship is ArchitectureIRRelationship => relationship !== undefined);

  if (elements.length === 0) {
    return undefined;
  }

  const lines: string[] = ['graph TD'];
  const classMap = new Map<string, string[]>();

  for (const element of elements) {
    const mermaidId = sanitizeMermaidId(element.id);
    lines.push(`    ${mermaidId}["${escapeMermaidLabel(buildElementLabel(element))}"]`);
    const className = toMermaidClassName(element.kind);
    if (!classMap.has(className)) {
      classMap.set(className, []);
    }
    classMap.get(className)!.push(mermaidId);
  }

  if (relationships.length === 0) {
    lines.push('    %% no relationships');
  } else {
    for (const relationship of relationships) {
      lines.push(
        `    ${sanitizeMermaidId(relationship.sourceId)} -->|${escapeMermaidLabel(relationship.kind)}| ${sanitizeMermaidId(relationship.destinationId)}`,
      );
    }
  }

  for (const [className, members] of classMap.entries()) {
    if (members.length === 0) {
      continue;
    }
    lines.push(`    class ${members.join(',')} ${className}`);
  }

  lines.push('    classDef softwareSystem fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px');
  lines.push('    classDef container fill:#dcfce7,stroke:#15803d,stroke-width:1px');
  lines.push('    classDef component fill:#fef3c7,stroke:#b45309,stroke-width:1px');
  lines.push('    classDef deploymentNode fill:#fee2e2,stroke:#b91c1c,stroke-width:1px');
  lines.push('    classDef infrastructureNode fill:#ede9fe,stroke:#6d28d9,stroke-width:1px');
  lines.push('    classDef externalSystem fill:#f3f4f6,stroke:#4b5563,stroke-dasharray: 4 2');
  lines.push('    classDef image fill:#e0f2fe,stroke:#0369a1,stroke-width:1px');

  return {
    kind: view.mermaidSection,
    title: view.title,
    diagram: lines.join('\n'),
  };
}

function buildElementLabel(element: ArchitectureIRElement): string {
  const kindLabel = element.kind.replace(/-/g, ' ');
  return `${element.name}\\n(${kindLabel})`;
}

function toMermaidClassName(kind: ArchitectureIRElement['kind']): string {
  switch (kind) {
    case 'software-system':
      return 'softwareSystem';
    case 'deployment-node':
      return 'deploymentNode';
    case 'external-system':
      return 'externalSystem';
    case 'infrastructure-node':
      return 'infrastructureNode';
    default:
      return kind;
  }
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/"/g, '\\"');
}
