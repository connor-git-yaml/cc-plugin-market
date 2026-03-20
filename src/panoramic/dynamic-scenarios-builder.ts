/**
 * Dynamic scenarios builder
 *
 * 基于 component view 和弱增强信号构建关键动态链路说明。
 */
import type { EventSurfaceOutput } from './event-surface-generator.js';
import type { RuntimeTopologyOutput } from './runtime-topology-generator.js';
import type { StoredModuleSpecRecord } from './stored-module-specs.js';
import {
  dedupeComponentEvidence,
  minConfidence,
  summarizeDynamicScenarios,
  type ComponentConfidence,
  type ComponentDescriptor,
  type ComponentEvidenceRef,
  type ComponentViewModel,
  type DynamicScenario,
  type DynamicScenarioCategory,
  type DynamicScenarioModel,
  type DynamicScenariosOutput,
  type DynamicScenarioStep,
} from './component-view-model.js';
import { loadTemplate } from './utils/template-loader.js';

export interface BuildDynamicScenariosOptions {
  componentView: ComponentViewModel;
  storedModules: StoredModuleSpecRecord[];
  runtime?: RuntimeTopologyOutput;
  eventSurface?: EventSurfaceOutput;
}

export function buildDynamicScenarios(
  options: BuildDynamicScenariosOptions,
): DynamicScenariosOutput {
  const warnings = new Set<string>(options.componentView.warnings);
  const scenarios: DynamicScenario[] = [];

  if (options.storedModules.length === 0) {
    warnings.add('未找到 stored module specs，dynamic scenarios 仅基于组件视图和弱信号构建。');
  }

  const primary = buildPrimaryFlowScenario(options.componentView, options.runtime);
  if (primary) {
    scenarios.push(primary);
  } else {
    warnings.add('未识别到高信号 request/control 主链路。');
  }

  const eventScenario = buildEventFlowScenario(options.componentView, options.eventSurface);
  if (eventScenario) {
    scenarios.push(eventScenario);
  }

  const sessionScenario = buildSessionFlowScenario(options.componentView);
  if (sessionScenario) {
    scenarios.push(sessionScenario);
  }

  if (scenarios.length === 0) {
    warnings.add('当前批次未构建出可稳定复核的 dynamic scenarios。');
  }

  const model: DynamicScenarioModel = {
    projectName: options.componentView.projectName,
    generatedAt: new Date().toISOString(),
    scenarios,
    warnings: [...warnings].sort((a, b) => a.localeCompare(b)),
    stats: summarizeDynamicScenarios({ scenarios }),
  };

  return {
    title: `动态链路: ${options.componentView.projectName}`,
    generatedAt: model.generatedAt,
    model,
    warnings: model.warnings,
  };
}

export function renderDynamicScenarios(output: DynamicScenariosOutput): string {
  const template = loadTemplate('dynamic-scenarios.hbs', import.meta.url);
  return template(output);
}

function buildPrimaryFlowScenario(
  componentView: ComponentViewModel,
  runtime: RuntimeTopologyOutput | undefined,
): DynamicScenario | undefined {
  const entry = findEntryComponent(componentView.components);
  const transport = componentView.components.find((component) => component.category === 'transport');
  const parser = componentView.components.find((component) => component.category === 'parser');
  const session = componentView.components.find((component) => component.category === 'session' || component.category === 'store');
  const trigger = findTriggerName(entry);

  if (!entry || !trigger) {
    return undefined;
  }

  const steps: DynamicScenarioStep[] = [];
  let index = 1;
  steps.push(createStep({
    index: index++,
    actor: entry,
    action: `接收 ${trigger}`,
    detail: `${entry.name} 作为入口组件启动主请求链路。`,
    evidence: entry.evidence,
    confidence: entry.confidence,
    inferred: entry.inferred,
  }));

  if (transport) {
    steps.push(createStep({
      index: index++,
      actor: entry,
      action: '委托 transport',
      target: transport,
      detail: `${entry.name} 将请求交给 ${transport.name}，由 transport 层负责对外通信。`,
      evidence: mergeEvidence(entry.evidence, transport.evidence),
      confidence: mergeConfidence(entry.confidence, transport.confidence),
      inferred: entry.inferred || transport.inferred,
    }));
  }

  if (parser) {
    const parserActor = transport ?? entry;
    steps.push(createStep({
      index: index++,
      actor: parserActor,
      action: '交给解析层',
      target: parser,
      detail: `${parser.name} 对返回消息或 stream payload 进行解析，提炼上层可消费结果。`,
      evidence: mergeEvidence(parserActor.evidence, parser.evidence),
      confidence: mergeConfidence(parserActor.confidence, parser.confidence),
      inferred: parserActor.inferred || parser.inferred,
    }));
  }

  if (session) {
    const sessionActor = parser ?? transport ?? entry;
    steps.push(createStep({
      index: index++,
      actor: sessionActor,
      action: '更新会话状态',
      target: session,
      detail: `${session.name} 负责 session / transcript / local state 的更新或持久化。`,
      evidence: mergeEvidence(sessionActor.evidence, session.evidence),
      confidence: mergeConfidence(sessionActor.confidence, session.confidence),
      inferred: sessionActor.inferred || session.inferred,
    }));
  }

  if (runtime?.topology.services[0]) {
    const service = runtime.topology.services[0];
    steps.push({
      index: index++,
      actorId: entry.id,
      actor: entry.name,
      action: '运行于目标宿主',
      target: service.name,
      detail: `${service.name} 提供本链路的运行时宿主边界。`,
      confidence: 'low',
      inferred: true,
      evidence: [{
        sourceType: 'runtime-topology',
        ref: service.sourceFile,
        note: service.name,
        inferred: true,
      }],
    });
  }

  const confidence = deriveScenarioConfidence(steps);
  const category = inferScenarioCategory(trigger);
  return {
    id: 'primary-flow',
    title: `${trigger} 主链路`,
    category,
    trigger,
    participants: dedupeStrings([entry.name, transport?.name, parser?.name, session?.name]),
    summary: `${entry.name} 驱动主请求链路${transport ? `，经由 ${transport.name}` : ''}${parser ? `，并由 ${parser.name} 完成解析` : ''}。`,
    steps,
    outcome: parser
      ? `解析层 ${parser.name} 将结果交回上层调用者。`
      : '链路结果返回到入口组件。',
    confidence,
    inferred: confidence !== 'high',
    evidence: dedupeComponentEvidence(steps.flatMap((step) => step.evidence)),
  };
}

function buildEventFlowScenario(
  componentView: ComponentViewModel,
  eventSurface: EventSurfaceOutput | undefined,
): DynamicScenario | undefined {
  const channel = eventSurface?.channels[0];
  if (!channel || channel.publishers.length === 0 || channel.subscribers.length === 0) {
    return undefined;
  }

  const publisher = findComponentBySymbol(componentView.components, channel.publishers[0]!.symbolName);
  const subscriber = findComponentBySymbol(componentView.components, channel.subscribers[0]!.symbolName);
  if (!publisher || !subscriber) {
    return undefined;
  }

  const steps: DynamicScenarioStep[] = [
    createStep({
      index: 1,
      actor: publisher,
      action: `发布事件 ${channel.channelName}`,
      detail: `${publisher.name} 发布 ${channel.kind} ${channel.channelName}。`,
      evidence: [{
        sourceType: 'event-surface',
        ref: channel.channelName,
        note: 'publisher',
      }],
      confidence: 'medium',
      inferred: false,
    }),
    createStep({
      index: 2,
      actor: subscriber,
      action: `消费事件 ${channel.channelName}`,
      detail: `${subscriber.name} 订阅并处理 ${channel.channelName} 负载。`,
      evidence: [{
        sourceType: 'event-surface',
        ref: channel.channelName,
        note: 'subscriber',
      }],
      confidence: 'medium',
      inferred: false,
    }),
  ];

  return {
    id: `event-${channel.channelName}`,
    title: `${channel.channelName} 事件链路`,
    category: 'event-flow',
    trigger: channel.channelName,
    participants: [publisher.name, subscriber.name],
    summary: `${publisher.name} -> ${channel.channelName} -> ${subscriber.name}`,
    steps,
    outcome: `${subscriber.name} 完成事件处理。`,
    confidence: 'medium',
    inferred: false,
    evidence: dedupeComponentEvidence(steps.flatMap((step) => step.evidence)),
  };
}

function buildSessionFlowScenario(
  componentView: ComponentViewModel,
): DynamicScenario | undefined {
  const session = componentView.components.find((component) => component.category === 'session' || component.category === 'store');
  const entry = findEntryComponent(componentView.components);
  if (!session || !entry) {
    return undefined;
  }

  const relevantMethod = session.keyMethods.find((method) => /(load|save|persist|resume|session)/i.test(method.name));
  if (!relevantMethod) {
    return undefined;
  }

  const steps: DynamicScenarioStep[] = [
    createStep({
      index: 1,
      actor: entry,
      action: '触发会话恢复或持久化',
      target: session,
      detail: `${entry.name} 需要从 ${session.name} 恢复或更新 session 状态。`,
      evidence: mergeEvidence(entry.evidence, session.evidence),
      confidence: mergeConfidence(entry.confidence, session.confidence),
      inferred: entry.inferred || session.inferred,
    }),
    {
      index: 2,
      actorId: session.id,
      actor: session.name,
      action: `执行 ${relevantMethod.name}`,
      detail: `${session.name} 通过 ${relevantMethod.name} 处理本地状态或 transcript。`,
      confidence: session.confidence,
      inferred: session.inferred,
      evidence: dedupeComponentEvidence(relevantMethod.evidence),
    },
  ];

  return {
    id: 'session-flow',
    title: `${session.name} 会话链路`,
    category: 'session-flow',
    trigger: relevantMethod.name,
    participants: [entry.name, session.name],
    summary: `${entry.name} 与 ${session.name} 协作维护 session 状态。`,
    steps,
    outcome: `${session.name} 完成会话状态更新。`,
    confidence: deriveScenarioConfidence(steps),
    inferred: true,
    evidence: dedupeComponentEvidence(steps.flatMap((step) => step.evidence)),
  };
}

function createStep(input: {
  index: number;
  actor: ComponentDescriptor;
  action: string;
  detail: string;
  evidence: ComponentEvidenceRef[];
  confidence: ComponentConfidence;
  inferred: boolean;
  target?: ComponentDescriptor;
}): DynamicScenarioStep {
  return {
    index: input.index,
    actorId: input.actor.id,
    actor: input.actor.name,
    action: input.action,
    targetId: input.target?.id,
    target: input.target?.name,
    detail: input.detail,
    confidence: input.confidence,
    inferred: input.inferred,
    evidence: dedupeComponentEvidence(input.evidence),
  };
}

function findEntryComponent(components: ComponentDescriptor[]): ComponentDescriptor | undefined {
  return components.find((component) =>
    ['query', 'client', 'service', 'module'].includes(component.category)
    && findTriggerName(component) !== undefined,
  ) ?? components.find((component) => ['query', 'client', 'service', 'module'].includes(component.category));
}

function findTriggerName(component: ComponentDescriptor | undefined): string | undefined {
  if (!component) {
    return undefined;
  }

  const rankedMethod = component.keyMethods
    .map((method) => ({
      name: method.name,
      score: scoreTriggerMethod(method.name),
    }))
    .filter((method) => method.score > 0)
    .sort((left, right) => {
      const scoreDiff = right.score - left.score;
      return scoreDiff !== 0 ? scoreDiff : left.name.localeCompare(right.name);
    })[0];

  return rankedMethod?.name;
}

function inferScenarioCategory(trigger: string): DynamicScenarioCategory {
  if (/(interrupt|control)/i.test(trigger)) return 'control-flow';
  if (/(session|resume|persist)/i.test(trigger)) return 'session-flow';
  return 'request-flow';
}

function deriveScenarioConfidence(steps: DynamicScenarioStep[]): ComponentConfidence {
  if (steps.length >= 3 && steps.every((step) => step.confidence !== 'low')) {
    return 'high';
  }
  if (steps.length >= 2) {
    return 'medium';
  }
  return 'low';
}

function findComponentBySymbol(
  components: ComponentDescriptor[],
  symbolName: string,
): ComponentDescriptor | undefined {
  return components.find((component) =>
    component.name === symbolName
    || component.keyMethods.some((method) => method.ownerName === symbolName || method.name === symbolName),
  );
}

function mergeEvidence(
  left: ComponentEvidenceRef[],
  right: ComponentEvidenceRef[],
): ComponentEvidenceRef[] {
  return dedupeComponentEvidence([...left, ...right]);
}

function mergeConfidence(
  left: ComponentConfidence,
  right: ComponentConfidence,
): ComponentConfidence {
  return minConfidence(left, right);
}

function dedupeStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
    .sort((a, b) => a.localeCompare(b));
}

function scoreTriggerMethod(name: string): number {
  const lower = name.toLowerCase();
  if (/(query|request|process)/.test(lower)) return 5;
  if (/(interrupt|control)/.test(lower)) return 4;
  if (/(stream|send|receive)/.test(lower)) return 3;
  if (/(connect|run|execute|initialize|start)/.test(lower)) return 2;
  if (/(session|resume|persist)/.test(lower)) return 1;
  return 0;
}
