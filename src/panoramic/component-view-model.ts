/**
 * Component view and dynamic scenario shared model
 *
 * 057 的共享结构边界，供 batch 文档层和后续 059 provenance / quality gate 复用。
 */

export type ComponentConfidence = 'high' | 'medium' | 'low';

export type ComponentEvidenceSourceType =
  | 'architecture-ir'
  | 'module-spec'
  | 'baseline-skeleton'
  | 'architecture-narrative'
  | 'runtime-topology'
  | 'event-surface'
  | 'test-file';

export type ComponentCategory =
  | 'client'
  | 'query'
  | 'transport'
  | 'parser'
  | 'session'
  | 'store'
  | 'adapter'
  | 'service'
  | 'module'
  | 'external';

export type ComponentMethodKind =
  | 'entrypoint'
  | 'transport'
  | 'parser'
  | 'session'
  | 'event-handler'
  | 'supporting';

export type ComponentRelationshipKind =
  | 'depends-on'
  | 'calls'
  | 'uses-transport'
  | 'parses'
  | 'publishes'
  | 'subscribes'
  | 'manages-session'
  | 'hosts';

export type DynamicScenarioCategory =
  | 'request-flow'
  | 'control-flow'
  | 'event-flow'
  | 'session-flow';

export interface ComponentEvidenceRef {
  sourceType: ComponentEvidenceSourceType;
  ref: string;
  note?: string;
  inferred?: boolean;
}

export interface ComponentMethodRef {
  ownerName?: string;
  name: string;
  kind: ComponentMethodKind;
  signature?: string;
  evidence: ComponentEvidenceRef[];
}

export interface ComponentDescriptor {
  id: string;
  name: string;
  category: ComponentCategory;
  subsystem: string;
  summary: string;
  responsibilities: string[];
  relatedFiles: string[];
  keyMethods: ComponentMethodRef[];
  upstreamIds: string[];
  downstreamIds: string[];
  confidence: ComponentConfidence;
  inferred: boolean;
  evidence: ComponentEvidenceRef[];
}

export interface ComponentRelationship {
  fromId: string;
  toId: string;
  kind: ComponentRelationshipKind;
  label: string;
  confidence: ComponentConfidence;
  evidence: ComponentEvidenceRef[];
}

export interface ComponentGroup {
  id: string;
  name: string;
  componentIds: string[];
  summary?: string;
}

export interface ComponentViewStats {
  totalComponents: number;
  totalRelationships: number;
  highConfidenceComponents: number;
  sourceCount: number;
}

export interface ComponentViewModel {
  projectName: string;
  generatedAt: string;
  summary: string[];
  groups: ComponentGroup[];
  components: ComponentDescriptor[];
  relationships: ComponentRelationship[];
  mermaidDiagram?: string;
  warnings: string[];
  stats: ComponentViewStats;
}

export interface ComponentViewOutput {
  title: string;
  generatedAt: string;
  model: ComponentViewModel;
  warnings: string[];
  mermaidDiagram?: string;
}

export interface DynamicScenarioStep {
  index: number;
  actorId?: string;
  actor: string;
  action: string;
  targetId?: string;
  target?: string;
  detail: string;
  confidence: ComponentConfidence;
  inferred: boolean;
  evidence: ComponentEvidenceRef[];
}

export interface DynamicScenario {
  id: string;
  title: string;
  category: DynamicScenarioCategory;
  trigger: string;
  participants: string[];
  summary: string;
  steps: DynamicScenarioStep[];
  outcome?: string;
  confidence: ComponentConfidence;
  inferred: boolean;
  evidence: ComponentEvidenceRef[];
}

export interface DynamicScenarioStats {
  totalScenarios: number;
  highConfidenceScenarios: number;
  totalSteps: number;
}

export interface DynamicScenarioModel {
  projectName: string;
  generatedAt: string;
  scenarios: DynamicScenario[];
  warnings: string[];
  stats: DynamicScenarioStats;
}

export interface DynamicScenariosOutput {
  title: string;
  generatedAt: string;
  model: DynamicScenarioModel;
  warnings: string[];
}

export function summarizeComponentView(
  model: Pick<ComponentViewModel, 'components' | 'relationships'>,
): ComponentViewStats {
  const sourceTypes = new Set<ComponentEvidenceSourceType>();
  for (const component of model.components) {
    for (const evidence of component.evidence) {
      sourceTypes.add(evidence.sourceType);
    }
  }
  for (const relationship of model.relationships) {
    for (const evidence of relationship.evidence) {
      sourceTypes.add(evidence.sourceType);
    }
  }

  return {
    totalComponents: model.components.length,
    totalRelationships: model.relationships.length,
    highConfidenceComponents: model.components.filter((component) => component.confidence === 'high').length,
    sourceCount: sourceTypes.size,
  };
}

export function summarizeDynamicScenarios(
  model: Pick<DynamicScenarioModel, 'scenarios'>,
): DynamicScenarioStats {
  return {
    totalScenarios: model.scenarios.length,
    highConfidenceScenarios: model.scenarios.filter((scenario) => scenario.confidence === 'high').length,
    totalSteps: model.scenarios.reduce((sum, scenario) => sum + scenario.steps.length, 0),
  };
}

export function compareConfidence(
  left: ComponentConfidence,
  right: ComponentConfidence,
): number {
  return confidenceScore(left) - confidenceScore(right);
}

export function maxConfidence(...values: ComponentConfidence[]): ComponentConfidence {
  return [...values].sort((left, right) => compareConfidence(right, left))[0] ?? 'low';
}

export function minConfidence(...values: ComponentConfidence[]): ComponentConfidence {
  return [...values].sort(compareConfidence)[0] ?? 'low';
}

export function dedupeComponentEvidence(
  evidenceList: ComponentEvidenceRef[],
): ComponentEvidenceRef[] {
  const seen = new Set<string>();
  const result: ComponentEvidenceRef[] = [];

  for (const evidence of evidenceList) {
    const key = `${evidence.sourceType}|${evidence.ref}|${evidence.note ?? ''}|${String(evidence.inferred ?? false)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(evidence);
  }

  return result.sort((left, right) =>
    `${left.sourceType}|${left.ref}`.localeCompare(`${right.sourceType}|${right.ref}`),
  );
}

function confidenceScore(value: ComponentConfidence): number {
  switch (value) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
    default:
      return 1;
  }
}
