/**
 * Component view builder
 *
 * 基于 ArchitectureIR + stored module specs 生成关键组件视图。
 */
import * as path from 'node:path';
import type { ExportSymbol } from '../models/code-skeleton.js';
import type { ArchitectureNarrativeOutput } from './architecture-narrative.js';
import type { ArchitectureIR, ArchitectureIRElement, ArchitectureIREvidence, ArchitectureIRRelationship } from './architecture-ir-model.js';
import type { EventSurfaceOutput } from './event-surface-generator.js';
import type { RuntimeTopologyOutput } from './runtime-topology-generator.js';
import type { StoredModuleSpecRecord } from './stored-module-specs.js';
import {
  dedupeComponentEvidence,
  summarizeComponentView,
  type ComponentCategory,
  type ComponentConfidence,
  type ComponentDescriptor,
  type ComponentEvidenceRef,
  type ComponentGroup,
  type ComponentMethodKind,
  type ComponentMethodRef,
  type ComponentRelationship,
  type ComponentViewModel,
  type ComponentViewOutput,
} from './component-view-model.js';
import { loadTemplate } from './utils/template-loader.js';
import { sanitizeMermaidId } from './utils/mermaid-helpers.js';

interface RankedComponentDescriptor extends ComponentDescriptor {
  score: number;
  sourceTarget: string;
  packageId?: string;
  groupId?: string;
}

export interface BuildComponentViewOptions {
  architectureIR: ArchitectureIR;
  storedModules: StoredModuleSpecRecord[];
  architectureNarrative?: ArchitectureNarrativeOutput;
  runtime?: RuntimeTopologyOutput;
  eventSurface?: EventSurfaceOutput;
  maxComponents?: number;
}

const CLASSLIKE_KINDS = new Set(['class', 'interface', 'type', 'data_class', 'struct', 'protocol']);
const CORE_METHOD_RE = /(query|connect|request|stream|send|receive|parse|publish|subscribe|load|save|persist|session|interrupt|control|run|execute|process)/i;
const HIGH_SIGNAL_NAME_RE = /(query|client|transport|parser|session|store|adapter|service|runtime|protocol|message|gateway|manager)/i;

export function buildComponentView(options: BuildComponentViewOptions): ComponentViewOutput {
  const maxComponents = options.maxComponents ?? 12;
  const warnings = new Set<string>();
  const narrativeNames = collectNarrativeNames(options.architectureNarrative);
  const packageElements = options.architectureIR.elements.filter((element) => element.id.startsWith('package:'));
  const groupElements = options.architectureIR.elements.filter((element) => element.id.startsWith('group:'));

  if (options.storedModules.length === 0) {
    warnings.add('未找到可用的 stored module specs，无法生成细粒度组件视图。');
  }

  const rankedComponents = options.storedModules
    .flatMap((module) => buildRankedComponents(module, packageElements, groupElements, narrativeNames))
    .filter((component, index, components) =>
      components.findIndex((candidate) => candidate.id === component.id) === index,
    )
    .sort((left, right) => {
      const scoreDiff = right.score - left.score;
      return scoreDiff !== 0 ? scoreDiff : left.id.localeCompare(right.id);
    })
    .slice(0, maxComponents);

  if (rankedComponents.length === 0 && options.storedModules.length > 0) {
    warnings.add('未识别到高信号组件，组件视图将以 warnings 形式降级。');
  }

  const components = rankedComponents.map((component) => finalizeComponent(component));
  const relationships = buildComponentRelationships(
    rankedComponents,
    options.storedModules,
    options.architectureIR,
    options.eventSurface,
  );
  const groups = buildComponentGroups(rankedComponents);
  const mermaidDiagram = buildComponentMermaid(groups, components, relationships);
  const relevantIrWarnings = options.architectureIR.views
    .filter((view) => view.kind === 'component' || view.kind === 'system-context')
    .flatMap((view) => view.warnings);
  for (const warning of relevantIrWarnings) {
    warnings.add(warning);
  }
  for (const relationship of relationships) {
    if (relationship.confidence === 'low') {
      warnings.add(`低置信组件关系: ${relationship.label}`);
    }
  }

  const summary = buildSummaryLines(components, relationships);
  const model: ComponentViewModel = {
    projectName: options.architectureIR.projectName,
    generatedAt: new Date().toISOString(),
    summary,
    groups,
    components,
    relationships,
    mermaidDiagram,
    warnings: [...warnings].sort((a, b) => a.localeCompare(b)),
    stats: summarizeComponentView({ components, relationships }),
  };

  return {
    title: `组件视图: ${options.architectureIR.projectName}`,
    generatedAt: model.generatedAt,
    model,
    warnings: model.warnings,
    mermaidDiagram,
  };
}

export function renderComponentView(output: ComponentViewOutput): string {
  const template = loadTemplate('component-view.hbs', import.meta.url);
  return template(output);
}

function buildRankedComponents(
  module: StoredModuleSpecRecord,
  packageElements: ArchitectureIRElement[],
  groupElements: ArchitectureIRElement[],
  narrativeNames: Set<string>,
): RankedComponentDescriptor[] {
  const exports = module.baselineSkeleton?.exports ?? [];
  const rankedCandidates: RankedComponentDescriptor[] = [];
  const moduleRole = classifyModuleRole(module.sourceTarget);
  const packageMatch = findMatchingPackage(module, packageElements);
  const groupMatch = findMatchingGroup(packageMatch, groupElements);
  const subsystem = inferSubsystem(module, packageMatch, groupMatch);

  for (const symbol of exports) {
    const category = classifyComponentCategory(symbol.name, module.sourceTarget);
    const score = scoreExportSymbol(symbol, category, moduleRole, narrativeNames);
    const shouldKeep = CLASSLIKE_KINDS.has(symbol.kind) || score >= 7;
    if (!shouldKeep || isLowSignalSymbol(symbol.name, moduleRole)) {
      continue;
    }

    rankedCandidates.push({
      id: sanitizeComponentId(module.sourceTarget, symbol.name),
      name: symbol.name,
      category,
      subsystem,
      summary: summarizeComponentSummary(module, symbol),
      responsibilities: dedupeStrings([
        module.intentSummary,
        module.businessSummary,
        symbol.jsDoc ?? undefined,
      ]),
      relatedFiles: module.relatedFiles,
      keyMethods: collectKeyMethods(symbol, module),
      upstreamIds: [],
      downstreamIds: [],
      confidence: deriveConfidence(score, module.confidence),
      inferred: module.confidence === 'low',
      evidence: dedupeComponentEvidence([
        createModuleEvidence(module),
        createSkeletonEvidence(module, symbol.name, symbol.signature, module.confidence === 'low'),
      ]),
      score,
      sourceTarget: module.sourceTarget,
      packageId: packageMatch?.id,
      groupId: groupMatch?.id,
    });
  }

  if (rankedCandidates.length === 0 && moduleRole !== 'validation') {
    rankedCandidates.push(createFallbackModuleComponent(module, subsystem, packageMatch?.id, groupMatch?.id));
  }

  const primaryCandidate = rankedCandidates[0];
  if (primaryCandidate) {
    attachTopLevelFunctionMethods(primaryCandidate, exports, module);
  }

  return rankedCandidates
    .sort((left, right) => {
      const scoreDiff = right.score - left.score;
      return scoreDiff !== 0 ? scoreDiff : left.name.localeCompare(right.name);
    })
    .slice(0, moduleRole === 'core' ? 2 : 1);
}

function finalizeComponent(component: RankedComponentDescriptor): ComponentDescriptor {
  return {
    id: component.id,
    name: component.name,
    category: component.category,
    subsystem: component.subsystem,
    summary: component.summary,
    responsibilities: component.responsibilities,
    relatedFiles: component.relatedFiles,
    keyMethods: component.keyMethods,
    upstreamIds: component.upstreamIds,
    downstreamIds: component.downstreamIds,
    confidence: component.confidence,
    inferred: component.inferred,
    evidence: component.evidence,
  };
}

function buildComponentRelationships(
  rankedComponents: RankedComponentDescriptor[],
  storedModules: StoredModuleSpecRecord[],
  architectureIR: ArchitectureIR,
  eventSurface: EventSurfaceOutput | undefined,
): ComponentRelationship[] {
  const relationships = new Map<string, ComponentRelationship>();
  const primaryByModule = new Map<string, RankedComponentDescriptor>();
  for (const component of rankedComponents) {
    if (!primaryByModule.has(component.sourceTarget)) {
      primaryByModule.set(component.sourceTarget, component);
    }
  }
  const componentById = new Map(rankedComponents.map((component) => [component.id, component]));

  for (const module of storedModules) {
    const sourceComponent = primaryByModule.get(module.sourceTarget);
    if (!sourceComponent) {
      continue;
    }

    for (const targetModule of resolveImportedModules(module, storedModules)) {
      const targetComponent = primaryByModule.get(targetModule.sourceTarget);
      if (!targetComponent || targetComponent.id === sourceComponent.id) {
        continue;
      }
      upsertRelationship(relationships, {
        fromId: sourceComponent.id,
        toId: targetComponent.id,
        kind: 'calls',
        label: `${sourceComponent.name} imports ${targetComponent.name}`,
        confidence: 'medium',
        evidence: [createModuleEvidence(module)],
      });
    }
  }

  for (const relationship of architectureIR.relationships) {
    if (relationship.kind !== 'depends-on') {
      continue;
    }
    const mapped = mapIrRelationshipToComponents(relationship, rankedComponents);
    if (!mapped) {
      continue;
    }
    upsertRelationship(relationships, mapped);
  }

  const queryComponent = findTopComponent(rankedComponents, ['query', 'client', 'service', 'module']);
  const transportComponent = findTopComponent(rankedComponents, ['transport']);
  const parserComponent = findTopComponent(rankedComponents, ['parser']);
  const sessionComponent = findTopComponent(rankedComponents, ['session', 'store']);

  if (queryComponent && transportComponent && queryComponent.id !== transportComponent.id) {
    upsertRelationship(relationships, {
      fromId: queryComponent.id,
      toId: transportComponent.id,
      kind: 'uses-transport',
      label: `${queryComponent.name} delegates to ${transportComponent.name}`,
      confidence: 'high',
      evidence: mergeEvidence(queryComponent.evidence, transportComponent.evidence),
    });
  }

  if (transportComponent && parserComponent && transportComponent.id !== parserComponent.id) {
    upsertRelationship(relationships, {
      fromId: transportComponent.id,
      toId: parserComponent.id,
      kind: 'parses',
      label: `${transportComponent.name} hands off to ${parserComponent.name}`,
      confidence: 'high',
      evidence: mergeEvidence(transportComponent.evidence, parserComponent.evidence),
    });
  } else if (queryComponent && parserComponent && queryComponent.id !== parserComponent.id) {
    upsertRelationship(relationships, {
      fromId: queryComponent.id,
      toId: parserComponent.id,
      kind: 'parses',
      label: `${queryComponent.name} relies on ${parserComponent.name}`,
      confidence: 'medium',
      evidence: mergeEvidence(queryComponent.evidence, parserComponent.evidence),
    });
  }

  if (queryComponent && sessionComponent && queryComponent.id !== sessionComponent.id) {
    upsertRelationship(relationships, {
      fromId: queryComponent.id,
      toId: sessionComponent.id,
      kind: 'manages-session',
      label: `${queryComponent.name} updates ${sessionComponent.name}`,
      confidence: 'medium',
      evidence: mergeEvidence(queryComponent.evidence, sessionComponent.evidence),
    });
  }

  if (eventSurface) {
    for (const channel of eventSurface.channels) {
      const publisher = channel.publishers[0];
      const subscriber = channel.subscribers[0];
      if (!publisher || !subscriber) {
        continue;
      }
      const publisherComponent = findComponentByEvidence(rankedComponents, publisher.symbolName, publisher.sourceFile);
      const subscriberComponent = findComponentByEvidence(rankedComponents, subscriber.symbolName, subscriber.sourceFile);
      if (!publisherComponent || !subscriberComponent || publisherComponent.id === subscriberComponent.id) {
        continue;
      }
      upsertRelationship(relationships, {
        fromId: publisherComponent.id,
        toId: subscriberComponent.id,
        kind: 'publishes',
        label: `${publisherComponent.name} emits ${channel.channelName}`,
        confidence: 'medium',
        evidence: [{
          sourceType: 'event-surface',
          ref: channel.channelName,
          note: channel.kind,
        }],
      });
    }
  }

  const finalized = [...relationships.values()]
    .filter((relationship) => relationship.fromId !== relationship.toId)
    .sort((left, right) =>
      `${left.fromId}|${left.kind}|${left.toId}`.localeCompare(`${right.fromId}|${right.kind}|${right.toId}`),
    );

  for (const relationship of finalized) {
    componentById.get(relationship.fromId)?.downstreamIds.push(relationship.toId);
    componentById.get(relationship.toId)?.upstreamIds.push(relationship.fromId);
  }

  for (const component of componentById.values()) {
    component.upstreamIds = dedupeStrings(component.upstreamIds);
    component.downstreamIds = dedupeStrings(component.downstreamIds);
  }

  return finalized;
}

function buildComponentGroups(
  components: RankedComponentDescriptor[],
): ComponentGroup[] {
  const groups = new Map<string, ComponentGroup>();

  for (const component of components) {
    const id = sanitizeMermaidId(`group_${component.subsystem}`);
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        name: component.subsystem,
        componentIds: [],
        summary: `${component.subsystem} 子系统`,
      });
    }
    groups.get(id)!.componentIds.push(component.id);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      componentIds: dedupeStrings(group.componentIds),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildComponentMermaid(
  groups: ComponentGroup[],
  components: ComponentDescriptor[],
  relationships: ComponentRelationship[],
): string | undefined {
  if (components.length === 0) {
    return undefined;
  }

  const lines: string[] = ['flowchart LR'];
  const componentById = new Map(components.map((component) => [component.id, component]));

  for (const group of groups) {
    lines.push(`  subgraph ${sanitizeMermaidId(group.id)}["${escapeMermaidLabel(group.name)}"]`);
    for (const componentId of group.componentIds) {
      const component = componentById.get(componentId);
      if (!component) {
        continue;
      }
      const nodeId = sanitizeMermaidId(component.id);
      lines.push(`    ${nodeId}["${escapeMermaidLabel(`${component.name}\\n${component.category}`)}"]`);
    }
    lines.push('  end');
  }

  for (const relationship of relationships) {
    const fromId = sanitizeMermaidId(relationship.fromId);
    const toId = sanitizeMermaidId(relationship.toId);
    lines.push(`  ${fromId} -->|${escapeMermaidLabel(relationship.kind)}| ${toId}`);
  }

  return lines.join('\n');
}

function buildSummaryLines(
  components: ComponentDescriptor[],
  relationships: ComponentRelationship[],
): string[] {
  const lines: string[] = [];
  if (components.length > 0) {
    lines.push(`识别到 ${components.length} 个关键组件，优先聚焦 ${components.slice(0, 4).map((component) => `\`${component.name}\``).join('、')}。`);
  } else {
    lines.push('当前批次未识别到可稳定命名的关键组件。');
  }

  const transports = components.filter((component) => component.category === 'transport');
  const parsers = components.filter((component) => component.category === 'parser');
  const sessions = components.filter((component) => component.category === 'session' || component.category === 'store');
  if (transports.length > 0 || parsers.length > 0 || sessions.length > 0) {
    lines.push(`检测到 transport/parser/session 边界：transport=${transports.length}，parser=${parsers.length}，session/store=${sessions.length}。`);
  }

  if (relationships.length > 0) {
    lines.push(`组件关系共 ${relationships.length} 条，包含 imports、transport hand-off 或 session 管理等关键连接。`);
  }

  return lines;
}

function collectNarrativeNames(
  narrative: ArchitectureNarrativeOutput | undefined,
): Set<string> {
  const names = new Set<string>();
  if (!narrative) {
    return names;
  }

  for (const symbol of narrative.keySymbols) {
    names.add(symbol.name);
  }
  for (const method of narrative.keyMethods) {
    names.add(method.name);
  }
  for (const module of narrative.keyModules) {
    names.add(module.displayName);
  }
  return names;
}

function scoreExportSymbol(
  symbol: ExportSymbol,
  category: ComponentCategory,
  moduleRole: 'core' | 'support' | 'validation',
  narrativeNames: Set<string>,
): number {
  let score = 0;
  if (CLASSLIKE_KINDS.has(symbol.kind)) score += 6;
  if (HIGH_SIGNAL_NAME_RE.test(symbol.name)) score += 6;
  if (category !== 'module') score += 4;
  if ((symbol.members ?? []).some((member) => CORE_METHOD_RE.test(member.name))) score += 3;
  if (CORE_METHOD_RE.test(symbol.name)) score += 3;
  if (narrativeNames.has(symbol.name)) score += 3;
  if (moduleRole === 'core') score += 3;
  if (moduleRole === 'support') score -= 1;
  if (moduleRole === 'validation') score -= 6;
  return score;
}

function deriveConfidence(score: number, moduleConfidence: ComponentConfidence): ComponentConfidence {
  if (moduleConfidence === 'low') {
    return score >= 12 ? 'medium' : 'low';
  }
  if (score >= 14) {
    return 'high';
  }
  if (score >= 8) {
    return 'medium';
  }
  return 'low';
}

function collectKeyMethods(
  symbol: ExportSymbol,
  module: StoredModuleSpecRecord,
): ComponentMethodRef[] {
  const methods: ComponentMethodRef[] = [];

  for (const member of symbol.members ?? []) {
    if (isLowSignalMethod(member.name, module.sourceTarget)) {
      continue;
    }
    methods.push({
      ownerName: symbol.name,
      name: member.name,
      kind: classifyMethodKind(member.name),
      signature: member.signature,
      evidence: [createSkeletonEvidence(module, `${symbol.name}.${member.name}`, member.signature, module.confidence === 'low')],
    });
  }

  return methods
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 6);
}

function attachTopLevelFunctionMethods(
  component: RankedComponentDescriptor,
  exports: ExportSymbol[],
  module: StoredModuleSpecRecord,
): void {
  const methods = exports
    .filter((symbol) => symbol.kind === 'function' && CORE_METHOD_RE.test(symbol.name))
    .map((symbol) => ({
      ownerName: undefined,
      name: symbol.name,
      kind: classifyMethodKind(symbol.name),
      signature: symbol.signature,
      evidence: [createSkeletonEvidence(module, symbol.name, symbol.signature, module.confidence === 'low')],
    } satisfies ComponentMethodRef));

  component.keyMethods = dedupeMethods([...component.keyMethods, ...methods]);
}

function createFallbackModuleComponent(
  module: StoredModuleSpecRecord,
  subsystem: string,
  packageId: string | undefined,
  groupId: string | undefined,
): RankedComponentDescriptor {
  const fallbackName = path.posix.basename(module.sourceTarget).replace(/\.[^/.]+$/, '');
  return {
    id: sanitizeComponentId(module.sourceTarget, fallbackName),
    name: fallbackName,
    category: classifyComponentCategory(fallbackName, module.sourceTarget),
    subsystem,
    summary: module.intentSummary,
    responsibilities: dedupeStrings([module.intentSummary, module.businessSummary]),
    relatedFiles: module.relatedFiles,
    keyMethods: [],
    upstreamIds: [],
    downstreamIds: [],
    confidence: module.confidence === 'low' ? 'low' : 'medium',
    inferred: module.confidence === 'low',
    evidence: [createModuleEvidence(module)],
    score: module.confidence === 'low' ? 2 : 6,
    sourceTarget: module.sourceTarget,
    packageId,
    groupId,
  };
}

function createModuleEvidence(module: StoredModuleSpecRecord): ComponentEvidenceRef {
  return {
    sourceType: 'module-spec',
    ref: module.sourceTarget,
    note: module.intentSummary,
    inferred: module.confidence === 'low',
  };
}

function createSkeletonEvidence(
  module: StoredModuleSpecRecord,
  refName: string,
  signature: string | undefined,
  inferred: boolean,
): ComponentEvidenceRef {
  return {
    sourceType: 'baseline-skeleton',
    ref: `${module.sourceTarget}:${refName}`,
    note: signature,
    inferred,
  };
}

function classifyComponentCategory(name: string, sourceTarget: string): ComponentCategory {
  const lower = `${name} ${sourceTarget}`.toLowerCase();
  if (/(transport|stdin|stdout)/.test(lower)) return 'transport';
  if (/(parser|parse|codec|serializer|message)/.test(lower)) return 'parser';
  if (/(session|conversation|transcript)/.test(lower)) return 'session';
  if (/(store|cache|repository)/.test(lower)) return 'store';
  if (/(adapter)/.test(lower)) return 'adapter';
  if (/(client|sdk)/.test(lower)) return 'client';
  if (/(query|request)/.test(lower)) return 'query';
  if (/(service|runtime|manager|controller|gateway)/.test(lower)) return 'service';
  return 'module';
}

function classifyMethodKind(name: string): ComponentMethodKind {
  const lower = name.toLowerCase();
  if (/(query|request|connect|send|stream|run|execute|process|interrupt|control)/.test(lower)) return 'entrypoint';
  if (/(transport|dispatch|emit|publish|subscribe|listen)/.test(lower)) return 'transport';
  if (/(parse|decode|encode|serialize)/.test(lower)) return 'parser';
  if (/(session|persist|store|load|save|resume)/.test(lower)) return 'session';
  if (/(event|handle|on[A-Z_])/.test(name) || /(event|handle)/.test(lower)) return 'event-handler';
  return 'supporting';
}

function summarizeComponentSummary(
  module: StoredModuleSpecRecord,
  symbol: ExportSymbol,
): string {
  const doc = symbol.jsDoc?.trim();
  if (doc) {
    return summarizeLine(doc, module.intentSummary);
  }
  return summarizeLine(module.intentSummary, symbol.signature);
}

function summarizeLine(content: string, fallback: string): string {
  const value = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .find((line) => line.length > 0);
  return value ?? fallback;
}

function classifyModuleRole(sourceTarget: string): 'core' | 'support' | 'validation' {
  if (sourceTarget === 'tests' || sourceTarget.startsWith('tests/') || sourceTarget.includes('/tests/')) {
    return 'validation';
  }
  if (sourceTarget.startsWith('examples/') || sourceTarget.startsWith('scripts/')) {
    return 'support';
  }
  return 'core';
}

function isLowSignalSymbol(name: string, moduleRole: 'core' | 'support' | 'validation'): boolean {
  return moduleRole === 'validation' && /^test/i.test(name);
}

function isLowSignalMethod(name: string, sourceTarget: string): boolean {
  return classifyModuleRole(sourceTarget) === 'validation' && /^test/i.test(name);
}

function sanitizeComponentId(sourceTarget: string, name: string): string {
  return sanitizeMermaidId(`component_${sourceTarget}_${name}`);
}

function findMatchingPackage(
  module: StoredModuleSpecRecord,
  packageElements: ArchitectureIRElement[],
): ArchitectureIRElement | undefined {
  return packageElements.find((element) => {
    const elementPath = getMetadataString(element, 'path');
    return typeof elementPath === 'string' && module.relatedFiles.some((filePath) => filePath.startsWith(`${elementPath}/`) || filePath === elementPath);
  });
}

function findMatchingGroup(
  packageElement: ArchitectureIRElement | undefined,
  groupElements: ArchitectureIRElement[],
): ArchitectureIRElement | undefined {
  if (!packageElement) {
    return undefined;
  }
  const groupName = getMetadataString(packageElement, 'group');
  if (!groupName) {
    return undefined;
  }
  return groupElements.find((element) => element.id === `group:${groupName}`);
}

function inferSubsystem(
  module: StoredModuleSpecRecord,
  packageElement: ArchitectureIRElement | undefined,
  groupElement: ArchitectureIRElement | undefined,
): string {
  const packagePath = getMetadataString(packageElement, 'path');
  if (packagePath) {
    return packagePath;
  }
  if (groupElement?.name) {
    return groupElement.name;
  }

  const parts = module.sourceTarget.split('/').filter(Boolean);
  if (parts.length >= 3 && (parts[0] === 'src' || parts[0] === 'tests')) {
    return parts.slice(1, parts.length - 1).join('/') || parts[1]!;
  }
  if (parts.length >= 2) {
    return parts.slice(0, parts.length - 1).join('/');
  }
  return module.sourceTarget;
}

function resolveImportedModules(
  module: StoredModuleSpecRecord,
  storedModules: StoredModuleSpecRecord[],
): StoredModuleSpecRecord[] {
  const imports = module.baselineSkeleton?.imports ?? [];
  const matches = new Set<StoredModuleSpecRecord>();

  for (const item of imports) {
    const resolved = item.resolvedPath?.split(path.sep).join('/');
    for (const candidate of storedModules) {
      if (candidate.sourceTarget === module.sourceTarget) {
        continue;
      }
      if (resolved && candidate.relatedFiles.some((filePath) => resolved.endsWith(filePath) || filePath.endsWith(resolved))) {
        matches.add(candidate);
        continue;
      }
      const specifier = item.moduleSpecifier.replace(/^\.\//, '');
      if (specifier.length > 0 && candidate.sourceTarget.endsWith(specifier)) {
        matches.add(candidate);
      }
    }
  }

  return [...matches];
}

function mapIrRelationshipToComponents(
  relationship: ArchitectureIRRelationship,
  rankedComponents: RankedComponentDescriptor[],
): ComponentRelationship | undefined {
  const fromCandidates = rankedComponents.filter((component) => component.packageId === relationship.sourceId || component.groupId === relationship.sourceId);
  const toCandidates = rankedComponents.filter((component) => component.packageId === relationship.destinationId || component.groupId === relationship.destinationId);
  const fromComponent = fromCandidates[0];
  const toComponent = toCandidates[0];

  if (!fromComponent || !toComponent || fromComponent.id === toComponent.id) {
    return undefined;
  }

  return {
    fromId: fromComponent.id,
    toId: toComponent.id,
    kind: relationship.kind === 'depends-on' ? 'depends-on' : 'calls',
    label: `${fromComponent.name} ${relationship.kind} ${toComponent.name}`,
    confidence: 'medium',
    evidence: relationship.evidence.map(mapIrEvidence),
  };
}

function mapIrEvidence(evidence: ArchitectureIREvidence): ComponentEvidenceRef {
  return {
    sourceType: 'architecture-ir',
    ref: evidence.ref,
    note: evidence.note,
  };
}

function findTopComponent(
  components: RankedComponentDescriptor[],
  categories: ComponentCategory[],
): RankedComponentDescriptor | undefined {
  return components.find((component) => categories.includes(component.category));
}

function findComponentByEvidence(
  components: RankedComponentDescriptor[],
  symbolName: string,
  sourceFile: string,
): RankedComponentDescriptor | undefined {
  const normalizedFile = sourceFile.split(path.sep).join('/');
  return components.find((component) =>
    component.name === symbolName
    || component.keyMethods.some((method) => method.ownerName === symbolName || method.name === symbolName)
    || component.relatedFiles.some((filePath) => filePath === normalizedFile || filePath.endsWith(normalizedFile)),
  );
}

function upsertRelationship(
  relationships: Map<string, ComponentRelationship>,
  relationship: ComponentRelationship,
): void {
  const key = `${relationship.fromId}|${relationship.kind}|${relationship.toId}`;
  const existing = relationships.get(key);
  if (!existing) {
    relationships.set(key, {
      ...relationship,
      evidence: dedupeComponentEvidence(relationship.evidence),
    });
    return;
  }

  existing.label = existing.label || relationship.label;
  existing.confidence = maxConfidence(existing.confidence, relationship.confidence);
  existing.evidence = dedupeComponentEvidence([...existing.evidence, ...relationship.evidence]);
}

function maxConfidence(left: ComponentConfidence, right: ComponentConfidence): ComponentConfidence {
  const order: ComponentConfidence[] = ['low', 'medium', 'high'];
  return order[Math.max(order.indexOf(left), order.indexOf(right))] ?? 'low';
}

function mergeEvidence(
  left: ComponentEvidenceRef[],
  right: ComponentEvidenceRef[],
): ComponentEvidenceRef[] {
  return dedupeComponentEvidence([...left, ...right]);
}

function dedupeMethods(methods: ComponentMethodRef[]): ComponentMethodRef[] {
  const seen = new Set<string>();
  const result: ComponentMethodRef[] = [];
  for (const method of methods) {
    const key = `${method.ownerName ?? ''}|${method.name}|${method.signature ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(method);
  }
  return result
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 8);
}

function dedupeStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
    .sort((a, b) => a.localeCompare(b));
}

function getMetadataString(element: ArchitectureIRElement | undefined, key: string): string | undefined {
  if (!element) {
    return undefined;
  }
  const value = element.metadata[key];
  return typeof value === 'string' ? value : undefined;
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/"/g, '\\"');
}
