/**
 * Architecture IR exporters
 */
import {
  getArchitectureIRView,
  type ArchitectureIR,
  type ArchitectureIRElement,
  type ArchitectureIRRelationship,
  type ArchitectureIRView,
} from './architecture-ir-model.js';

const WORKSPACE_CONTAINER_ID = 'container:workspace';

export function exportArchitectureIRJson(ir: ArchitectureIR): ArchitectureIR {
  return ir;
}

export function exportArchitectureIRStructurizrDsl(ir: ArchitectureIR): string {
  const lines: string[] = [
    `workspace "${escapeDsl(ir.projectName)} Architecture" "Generated from panoramic ArchitectureIR" {`,
    '    !identifiers hierarchical',
    '',
    '    model {',
  ];

  const elementLines = buildModelElements(ir);
  lines.push(...elementLines.map((line) => `        ${line}`));

  const relationshipLines = buildStaticRelationships(ir);
  if (relationshipLines.length > 0) {
    lines.push('');
    lines.push(...relationshipLines.map((line) => `        ${line}`));
  }

  const deploymentLines = buildDeploymentEnvironment(ir);
  if (deploymentLines.length > 0) {
    lines.push('');
    lines.push(...deploymentLines.map((line) => `        ${line}`));
  }

  lines.push('    }');
  lines.push('');
  lines.push('    views {');

  const projectIdentifier = identifierFor('project');
  lines.push(`        systemContext ${projectIdentifier} "architecture-ir-system-context" "System context derived from ArchitectureIR" {`);
  lines.push('            include *');
  lines.push('            autolayout lr');
  lines.push('        }');

  lines.push('');
  lines.push(`        container ${projectIdentifier} "architecture-ir-containers" "Container view derived from ArchitectureIR" {`);
  lines.push('            include *');
  lines.push('            autolayout lr');
  lines.push('        }');

  if (ir.elements.some((element) => element.kind === 'component')) {
    lines.push('');
    lines.push(`        component ${identifierFor(WORKSPACE_CONTAINER_ID)} "architecture-ir-components" "Component view derived from ArchitectureIR" {`);
    lines.push('            include *');
    lines.push('            autolayout lr');
    lines.push('        }');
  }

  if ((getArchitectureIRView(ir, 'deployment')?.available ?? false) && ir.elements.some((element) => element.kind === 'deployment-node')) {
    lines.push('');
    lines.push('        deployment * "runtime" "architecture-ir-deployment" "Deployment view derived from ArchitectureIR" {');
    lines.push('            include *');
    lines.push('            autolayout lr');
    lines.push('        }');
  }

  lines.push('    }');
  lines.push('}');

  return lines.join('\n');
}

function buildModelElements(ir: ArchitectureIR): string[] {
  const lines: string[] = [];

  const project = ir.elements.find((element) => element.id === 'project' || element.kind === 'software-system');
  if (project) {
    lines.push(`${identifierFor(project.id)} = softwareSystem "${escapeDsl(project.name)}" "${escapeDsl(project.description ?? 'Source system derived from panoramic architecture facts')}" {`);
  } else {
    lines.push(`${identifierFor('project')} = softwareSystem "${escapeDsl(ir.projectName)}" "Source system derived from panoramic architecture facts" {`);
  }

  const runtimeContainers = ir.elements.filter((element) => element.kind === 'container' && !isWorkspaceProxy(element));
  for (const element of runtimeContainers) {
    lines.push(
      `    ${identifierFor(element.id)} = container "${escapeDsl(element.name)}" "${escapeDsl(element.description ?? '')}" "${escapeDsl(element.technology ?? 'Container')}"`,
    );
  }

  const workspaceComponents = ir.elements.filter((element) => element.kind === 'component');
  if (workspaceComponents.length > 0) {
    lines.push(
      `    ${identifierFor(WORKSPACE_CONTAINER_ID)} = container "Workspace" "Unified static workspace/component model" "Codebase" {`,
    );
    const groupedComponents = groupComponentsByWorkspaceGroup(workspaceComponents);

    for (const [groupName, components] of groupedComponents.entries()) {
      if (groupName !== '.') {
        lines.push(`        group "${escapeDsl(groupName)}" {`);
      }

      for (const component of components) {
        const indent = groupName !== '.' ? '            ' : '        ';
        lines.push(
          `${indent}${identifierFor(component.id)} = component "${escapeDsl(component.name)}" "${escapeDsl(component.description ?? '')}" "${escapeDsl(component.technology ?? 'Component')}"`,
        );
      }

      if (groupName !== '.') {
        lines.push('        }');
      }
    }

    lines.push('    }');
  }

  const externalSystems = ir.elements.filter((element) => element.kind === 'external-system');
  for (const element of externalSystems) {
    lines.push(
      `    ${identifierFor(element.id)} = softwareSystem "${escapeDsl(element.name)}" "${escapeDsl(element.description ?? '')}" "External System"`,
    );
  }

  lines.push('}');
  return lines;
}

function buildStaticRelationships(ir: ArchitectureIR): string[] {
  const lines: string[] = [];
  const allowedKinds = new Set(['software-system', 'container', 'component', 'external-system']);

  for (const relationship of ir.relationships) {
    const source = ir.elements.find((element) => element.id === relationship.sourceId);
    const destination = ir.elements.find((element) => element.id === relationship.destinationId);
    if (!source || !destination) {
      continue;
    }

    const sourceDslKind = mapElementKindForStaticDsl(source.kind);
    const destinationDslKind = mapElementKindForStaticDsl(destination.kind);
    if (!allowedKinds.has(sourceDslKind) || !allowedKinds.has(destinationDslKind)) {
      continue;
    }

    lines.push(
      `${identifierFor(source.id)} -> ${identifierFor(destination.id)} "${escapeDsl(relationship.description)}" "${escapeDsl(relationship.technology ?? relationship.kind)}"`,
    );
  }

  return dedupe(lines);
}

function buildDeploymentEnvironment(ir: ArchitectureIR): string[] {
  const deploymentView = getArchitectureIRView(ir, 'deployment');
  if (!deploymentView?.available) {
    return [];
  }

  const lines: string[] = ['deploymentEnvironment "runtime" {'];
  const deploymentNodes = deploymentView.elementIds
    .map((id) => ir.elements.find((element) => element.id === id))
    .filter((element): element is ArchitectureIRElement => element?.kind === 'deployment-node');

  if (deploymentNodes.length === 0) {
    lines.push('}');
    return lines;
  }

  for (const node of deploymentNodes) {
    const serviceName = getStringMetadata(node, 'service');
    const serviceId = serviceName ? `service:${serviceName}` : undefined;
    lines.push(
      `    ${identifierFor(node.id)} = deploymentNode "${escapeDsl(node.name)}" "${escapeDsl(node.description ?? 'Runtime deployment node')}" "Container Runtime" {`,
    );
    if (serviceId) {
      lines.push(`        ${identifierFor(`instance:${serviceId}`)} = containerInstance ${identifierFor(serviceId)}`);
    }

    const imageId = getStringMetadata(node, 'image');
    if (imageId) {
      lines.push(
        `        ${identifierFor(`infra:${imageId}`)} = infrastructureNode "${escapeDsl(imageId)}" "Container image" "Image"`,
      );
    }
    lines.push('    }');
  }

  lines.push('}');
  return lines;
}

function groupComponentsByWorkspaceGroup(components: ArchitectureIRElement[]): Map<string, ArchitectureIRElement[]> {
  const grouped = new Map<string, ArchitectureIRElement[]>();

  for (const component of components) {
    const groupName = getStringMetadata(component, 'group') || '.';
    if (!grouped.has(groupName)) {
      grouped.set(groupName, []);
    }
    grouped.get(groupName)!.push(component);
  }

  for (const group of grouped.values()) {
    group.sort((left, right) => left.name.localeCompare(right.name));
  }

  return new Map([...grouped.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

function isWorkspaceProxy(element: ArchitectureIRElement): boolean {
  return element.id === WORKSPACE_CONTAINER_ID;
}

function mapElementKindForStaticDsl(kind: ArchitectureIRElement['kind']): string {
  switch (kind) {
    case 'image':
    case 'deployment-node':
      return 'container';
    default:
      return kind;
  }
}

function getStringMetadata(element: ArchitectureIRElement, field: string): string | undefined {
  const value = element.metadata[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function identifierFor(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_');
}

function escapeDsl(value: string): string {
  return value.replace(/"/g, '\\"');
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
