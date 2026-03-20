/**
 * Pattern knowledge base and rule evaluation helpers
 *
 * Feature 050 使用规则优先的知识库，从 045 的架构概览输出中提取模式提示。
 */

import type { ArchitectureOverviewOutput } from './architecture-overview-generator.js';
import { getArchitectureSection } from './architecture-overview-model.js';
import {
  clampConfidence,
  createPatternEvidenceRef,
  dedupePatternEvidence,
  determinePatternMatchLevel,
  type PatternAlternative,
  type PatternEvidenceRef,
  type PatternHint,
  type PatternHintsInput,
  type PatternKnowledgeBaseEntry,
  type PatternSignalRule,
} from './pattern-hints-model.js';

export const MINIMUM_PATTERN_CONFIDENCE = 0.55;

interface PatternSignalEvaluation {
  matched: boolean;
  evidence: PatternEvidenceRef[];
}

interface PatternCandidate {
  entry: PatternKnowledgeBaseEntry;
  confidence: number;
  matchedSignals: string[];
  missingSignals: string[];
  evidence: PatternEvidenceRef[];
  inferred: boolean;
}

interface PatternEvaluationContext {
  architectureOverview: ArchitectureOverviewOutput;
  weakSignals?: PatternHintsInput['weakSignals'];
}

export interface PatternEvaluationResult {
  matchedPatterns: PatternHint[];
  alternatives: PatternAlternative[];
  warnings: string[];
  totalPatternsEvaluated: number;
}

type PatternSignalEvaluator = (context: PatternEvaluationContext) => PatternSignalEvaluation;

const POSITIVE_SIGNAL_EVALUATORS: Record<string, PatternSignalEvaluator> = {
  'layered-section-available': (context) => {
    const section = getArchitectureSection(context.architectureOverview.model, 'layered');
    if (!section?.available) {
      return { matched: false, evidence: [] };
    }

    return {
      matched: true,
      evidence: [createPatternEvidenceRef('architecture-overview', 'section:layered', {
        sectionKind: 'layered',
        note: '分层视图可用',
      })],
    };
  },
  'multiple-module-summaries': (context) => {
    const modules = context.architectureOverview.model.moduleSummaries;
    if (modules.length < 2) {
      return { matched: false, evidence: [] };
    }

    return {
      matched: true,
      evidence: modules.slice(0, 2).map((moduleSummary) =>
        createPatternEvidenceRef('architecture-overview', `module:${moduleSummary.packageName}`, {
          sectionKind: 'layered',
          note: moduleSummary.path,
        })),
    };
  },
  'grouped-modules': (context) => {
    const section = getArchitectureSection(context.architectureOverview.model, 'layered');
    const groups = section?.nodes.filter((node) => node.kind === 'module-group') ?? [];
    if (!section?.available || groups.length < 2) {
      return { matched: false, evidence: [] };
    }

    return {
      matched: true,
      evidence: groups.slice(0, 2).map((group) =>
        createPatternEvidenceRef('architecture-overview', `node:${group.id}`, {
          sectionKind: 'layered',
          nodeId: group.id,
          note: group.label,
        })),
    };
  },
  'shared-core-dependency': (context) => {
    const dependencyCount = new Map<string, number>();
    for (const summary of context.architectureOverview.model.moduleSummaries) {
      for (const dependency of summary.dependencies) {
        dependencyCount.set(dependency, (dependencyCount.get(dependency) ?? 0) + 1);
      }
    }

    const ranked = [...dependencyCount.entries()].sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    });

    const sharedDependency = ranked.find(([name, count]) => {
      const normalized = name.toLowerCase();
      return count >= 2 || /(core|shared|common|domain|platform)/.test(normalized);
    });

    if (!sharedDependency) {
      return { matched: false, evidence: [] };
    }

    const [dependencyName] = sharedDependency;
    const evidence = context.architectureOverview.model.moduleSummaries
      .filter((summary) => summary.dependencies.includes(dependencyName))
      .slice(0, 2)
      .map((summary) =>
        createPatternEvidenceRef('architecture-overview', `module:${summary.packageName}->${dependencyName}`, {
          sectionKind: 'layered',
          note: `${summary.packageName} 依赖 ${dependencyName}`,
        }));

    return {
      matched: true,
      evidence,
    };
  },
  'single-or-absent-deployment': (context) => {
    const section = getArchitectureSection(context.architectureOverview.model, 'deployment');
    const units = context.architectureOverview.model.deploymentUnits;

    if (!section?.available) {
      return {
        matched: true,
        evidence: [createPatternEvidenceRef('architecture-overview', 'section:deployment', {
          sectionKind: 'deployment',
          note: '部署视图缺失，视为集中部署或缺少运行时信号',
          inferred: true,
        })],
      };
    }

    if (units.length > 1) {
      return { matched: false, evidence: [] };
    }

    return {
      matched: true,
      evidence: units.slice(0, 1).map((unit) =>
        createPatternEvidenceRef('architecture-overview', `deployment:${unit.serviceName}`, {
          sectionKind: 'deployment',
          note: `部署单元数=${units.length}`,
        })),
    };
  },
  'deployment-section-available': (context) => {
    const section = getArchitectureSection(context.architectureOverview.model, 'deployment');
    if (!section?.available) {
      return { matched: false, evidence: [] };
    }

    return {
      matched: true,
      evidence: [createPatternEvidenceRef('architecture-overview', 'section:deployment', {
        sectionKind: 'deployment',
        note: '部署视图可用',
      })],
    };
  },
  'multiple-deployment-units': (context) => {
    const units = context.architectureOverview.model.deploymentUnits;
    if (units.length < 2) {
      return { matched: false, evidence: [] };
    }

    return {
      matched: true,
      evidence: units.slice(0, 2).map((unit) =>
        createPatternEvidenceRef('architecture-overview', `deployment:${unit.serviceName}`, {
          sectionKind: 'deployment',
          note: unit.containerName ?? unit.imageName ?? unit.serviceName,
        })),
    };
  },
  'service-dependencies-present': (context) => {
    const section = getArchitectureSection(context.architectureOverview.model, 'deployment');
    const dependencyEdges = section?.edges.filter(
      (edge) => edge.relation === 'depends-on' && edge.from.startsWith('service:') && edge.to.startsWith('service:'),
    ) ?? [];

    if (dependencyEdges.length === 0) {
      return { matched: false, evidence: [] };
    }

    return {
      matched: true,
      evidence: dependencyEdges.slice(0, 2).map((edge) =>
        createPatternEvidenceRef('architecture-overview', `${edge.from}->${edge.to}`, {
          sectionKind: 'deployment',
          edgeRef: `${edge.from}->${edge.to}`,
          note: '服务间显式依赖',
        })),
    };
  },
};

const NEGATIVE_SIGNAL_EVALUATORS: Record<string, PatternSignalEvaluator> = {
  'distributed-runtime': (context) => {
    const units = context.architectureOverview.model.deploymentUnits;
    if (units.length < 2) {
      return { matched: false, evidence: [] };
    }

    return {
      matched: true,
      evidence: units.slice(0, 2).map((unit) =>
        createPatternEvidenceRef('architecture-overview', `deployment:${unit.serviceName}`, {
          sectionKind: 'deployment',
          note: '存在多个独立部署单元',
        })),
    };
  },
  'multi-service-dependencies': (context) => {
    const section = getArchitectureSection(context.architectureOverview.model, 'deployment');
    const dependencyEdges = section?.edges.filter(
      (edge) => edge.relation === 'depends-on' && edge.from.startsWith('service:') && edge.to.startsWith('service:'),
    ) ?? [];

    if (dependencyEdges.length === 0) {
      return { matched: false, evidence: [] };
    }

    return {
      matched: true,
      evidence: dependencyEdges.slice(0, 2).map((edge) =>
        createPatternEvidenceRef('architecture-overview', `${edge.from}->${edge.to}`, {
          sectionKind: 'deployment',
          edgeRef: `${edge.from}->${edge.to}`,
          note: '运行时服务边界明显',
        })),
    };
  },
  'missing-layered-section': (context) => {
    const section = getArchitectureSection(context.architectureOverview.model, 'layered');
    if (section?.available) {
      return { matched: false, evidence: [] };
    }

    return {
      matched: true,
      evidence: [createPatternEvidenceRef('architecture-overview', 'section:layered', {
        sectionKind: 'layered',
        note: '缺少分层视图信号',
        inferred: true,
      })],
    };
  },
  'missing-deployment-section': (context) => {
    const section = getArchitectureSection(context.architectureOverview.model, 'deployment');
    if (section?.available) {
      return { matched: false, evidence: [] };
    }

    return {
      matched: true,
      evidence: [createPatternEvidenceRef('architecture-overview', 'section:deployment', {
        sectionKind: 'deployment',
        note: '缺少部署视图信号',
        inferred: true,
      })],
    };
  },
  'single-or-absent-deployment-for-services': (context) => {
    const section = getArchitectureSection(context.architectureOverview.model, 'deployment');
    const units = context.architectureOverview.model.deploymentUnits;
    if (section?.available && units.length >= 2) {
      return { matched: false, evidence: [] };
    }

    return {
      matched: true,
      evidence: [createPatternEvidenceRef('architecture-overview', 'section:deployment', {
        sectionKind: 'deployment',
        note: '运行时分布不足以支撑服务化模式',
        inferred: !section?.available,
      })],
    };
  },
};

export const DEFAULT_PATTERN_KNOWLEDGE_BASE: PatternKnowledgeBaseEntry[] = [
  {
    id: 'modular-monolith',
    name: '模块化单体',
    summary: '运行时更接近单体或集中部署，但代码已经按模块/包边界拆分。',
    positiveSignals: [
      { id: 'layered-section-available', description: '存在分层视图', sectionKind: 'layered', weight: 0.2 },
      { id: 'multiple-module-summaries', description: '存在多个模块职责条目', sectionKind: 'layered', weight: 0.5 },
      { id: 'single-or-absent-deployment', description: '部署形态集中或运行时信号缺失', sectionKind: 'deployment', weight: 0.3 },
    ],
    negativeSignals: [
      { id: 'distributed-runtime', description: '存在多个部署单元', sectionKind: 'deployment', weight: 0.4 },
      { id: 'multi-service-dependencies', description: '存在服务间显式依赖', sectionKind: 'deployment', weight: 0.2 },
    ],
    competingPatternIds: ['service-oriented-runtime', 'layered-architecture'],
    explanationSeed: '该系统在代码结构上表现出清晰的模块边界，但运行时没有强烈的多服务拆分迹象。',
  },
  {
    id: 'layered-architecture',
    name: '分层架构',
    summary: '代码结构以分层或分组的包边界组织，依赖关系更像自上而下的职责分层。',
    positiveSignals: [
      { id: 'layered-section-available', description: '存在分层视图', sectionKind: 'layered', weight: 0.25 },
      { id: 'grouped-modules', description: '存在明确的模块组/包组', sectionKind: 'layered', weight: 0.3 },
      { id: 'shared-core-dependency', description: '多个模块依赖共享核心能力', sectionKind: 'layered', weight: 0.45 },
    ],
    negativeSignals: [
      { id: 'missing-layered-section', description: '缺少分层视图', sectionKind: 'layered', weight: 0.55 },
      { id: 'distributed-runtime', description: '运行时更像多服务分布式形态', sectionKind: 'deployment', weight: 0.15 },
    ],
    competingPatternIds: ['modular-monolith', 'service-oriented-runtime'],
    explanationSeed: '该系统的高价值信号主要集中在模块分组和依赖组织方式上，更像职责清晰的分层结构。',
  },
  {
    id: 'service-oriented-runtime',
    name: '服务化运行时',
    summary: '运行时存在多个独立部署单元和服务依赖，具备明显的服务化边界。',
    positiveSignals: [
      { id: 'deployment-section-available', description: '存在部署视图', sectionKind: 'deployment', weight: 0.2 },
      { id: 'multiple-deployment-units', description: '存在多个部署单元', sectionKind: 'deployment', weight: 0.4 },
      { id: 'service-dependencies-present', description: '存在服务间依赖关系', sectionKind: 'deployment', weight: 0.4 },
    ],
    negativeSignals: [
      { id: 'missing-deployment-section', description: '缺少部署视图', sectionKind: 'deployment', weight: 0.5 },
      { id: 'single-or-absent-deployment-for-services', description: '部署形态不足以支撑服务化判断', sectionKind: 'deployment', weight: 0.3 },
    ],
    competingPatternIds: ['modular-monolith', 'layered-architecture'],
    explanationSeed: '该系统的运行时视图提供了较强的服务边界信号，重点不在单体部署，而在服务之间的组合关系。',
  },
];

export function evaluatePatternHints(
  context: PatternEvaluationContext,
  knowledgeBase: readonly PatternKnowledgeBaseEntry[] = DEFAULT_PATTERN_KNOWLEDGE_BASE,
): PatternEvaluationResult {
  const warnings = new Set<string>(context.architectureOverview.warnings);

  if (context.weakSignals?.docGraphAvailable === false) {
    warnings.add('未检测到 044 文档图谱增强信号，模式解释将仅基于 045 架构视图');
  }

  const candidates = knowledgeBase.map((entry) => evaluatePatternCandidate(entry, context));
  const candidateMap = new Map<string, PatternCandidate>(
    candidates.map((candidate) => [candidate.entry.id, candidate]),
  );

  const matchedPatterns = candidates
    .filter((candidate) => candidate.confidence >= MINIMUM_PATTERN_CONFIDENCE)
    .sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }

      return left.entry.name.localeCompare(right.entry.name);
    })
    .map((candidate) => {
      const competingAlternatives = candidate.entry.competingPatternIds
        .map((patternId) => candidateMap.get(patternId))
        .filter((alternative): alternative is PatternCandidate => Boolean(alternative))
        .map((alternative) => ({
          patternId: alternative.entry.id,
          patternName: alternative.entry.name,
          reason: buildAlternativeReason(candidate, alternative),
          confidenceGap: clampConfidence(candidate.confidence - alternative.confidence),
        }))
        .sort((left, right) => (left.confidenceGap ?? 0) - (right.confidenceGap ?? 0));

      return {
        patternId: candidate.entry.id,
        patternName: candidate.entry.name,
        summary: candidate.entry.summary,
        confidence: candidate.confidence,
        matchLevel: determinePatternMatchLevel(candidate.confidence) as PatternHint['matchLevel'],
        explanation: buildPatternExplanation(candidate, competingAlternatives),
        evidence: candidate.evidence,
        matchedSignals: candidate.matchedSignals,
        missingSignals: candidate.missingSignals,
        competingAlternatives,
        inferred: candidate.inferred,
      } satisfies PatternHint;
    });

  const alternatives = candidates
    .filter((candidate) => candidate.confidence < MINIMUM_PATTERN_CONFIDENCE)
    .sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }

      return left.entry.name.localeCompare(right.entry.name);
    })
    .slice(0, 3)
    .map((candidate) => ({
      patternId: candidate.entry.id,
      patternName: candidate.entry.name,
      reason: candidate.missingSignals.length > 0
        ? `缺少 ${candidate.missingSignals.slice(0, 2).join('、')} 等关键证据，当前置信度不足`
        : '当前命中信号不足，未达到最低置信度阈值',
      confidenceGap: clampConfidence(MINIMUM_PATTERN_CONFIDENCE - candidate.confidence),
    }));

  if (matchedPatterns.length === 0) {
    warnings.add('未识别到高置信度模式，将输出候选模式与缺失信号说明');
  }

  return {
    matchedPatterns,
    alternatives,
    warnings: [...warnings].sort((left, right) => left.localeCompare(right)),
    totalPatternsEvaluated: knowledgeBase.length,
  };
}

function evaluatePatternCandidate(
  entry: PatternKnowledgeBaseEntry,
  context: PatternEvaluationContext,
): PatternCandidate {
  const positiveResults = entry.positiveSignals.map((signal) => ({
    signal,
    evaluation: evaluateSignal(signal, context, POSITIVE_SIGNAL_EVALUATORS),
  }));
  const negativeResults = entry.negativeSignals.map((signal) => ({
    signal,
    evaluation: evaluateSignal(signal, context, NEGATIVE_SIGNAL_EVALUATORS),
  }));

  const positiveWeight = entry.positiveSignals.reduce((sum, signal) => sum + signal.weight, 0) || 1;
  const matchedPositiveWeight = positiveResults.reduce(
    (sum, item) => sum + (item.evaluation.matched ? item.signal.weight : 0),
    0,
  );
  const negativeWeight = entry.negativeSignals.reduce((sum, signal) => sum + signal.weight, 0);
  const matchedNegativeWeight = negativeResults.reduce(
    (sum, item) => sum + (item.evaluation.matched ? item.signal.weight : 0),
    0,
  );

  const positiveScore = matchedPositiveWeight / positiveWeight;
  const penalty = negativeWeight > 0 ? (matchedNegativeWeight / negativeWeight) * 0.55 : 0;
  const confidence = clampConfidence(positiveScore - penalty);

  const matchedSignals = positiveResults
    .filter((item) => item.evaluation.matched)
    .map((item) => item.signal.description);
  const missingSignals = positiveResults
    .filter((item) => !item.evaluation.matched)
    .map((item) => item.signal.description);
  const evidence = dedupePatternEvidence([
    ...positiveResults.flatMap((item) => item.evaluation.evidence),
    ...negativeResults
      .filter((item) => item.evaluation.matched)
      .flatMap((item) => item.evaluation.evidence),
  ]);

  return {
    entry,
    confidence,
    matchedSignals,
    missingSignals,
    evidence,
    inferred:
      missingSignals.length > 0
      || negativeResults.some((item) => item.evaluation.matched)
      || context.architectureOverview.warnings.length > 0,
  };
}

function evaluateSignal(
  signal: PatternSignalRule,
  context: PatternEvaluationContext,
  evaluators: Record<string, PatternSignalEvaluator>,
): PatternSignalEvaluation {
  const evaluator = evaluators[signal.id];
  if (!evaluator) {
    return { matched: false, evidence: [] };
  }

  return evaluator(context);
}

function buildAlternativeReason(current: PatternCandidate, alternative: PatternCandidate): string {
  if (alternative.confidence >= current.confidence) {
    return `${alternative.entry.name} 命中信号相近，但当前规则未把它排在更高优先级`;
  }

  if (alternative.missingSignals.length > 0) {
    return `缺少 ${alternative.missingSignals.slice(0, 2).join('、')}，因此没有当前模式稳定`;
  }

  return `虽然也命中部分信号，但总体置信度 (${alternative.confidence}) 低于当前模式 (${current.confidence})`;
}

export function buildPatternExplanation(
  candidate: PatternCandidate,
  alternatives: PatternAlternative[],
): string {
  const whyMatched = candidate.matchedSignals.length > 0
    ? `为何判定：${candidate.matchedSignals.slice(0, 3).join('、')}。`
    : '为何判定：当前仅命中弱信号，属于低信息量判断。';

  const whyNot = alternatives.length > 0
    ? `为何不是其他模式：${alternatives[0]!.patternName} ${alternatives[0]!.reason}。`
    : '为何不是其他模式：当前没有其它候选模式比它拥有更多关键证据。';

  const uncertainty = candidate.inferred
    ? ' [推断] 本判断受缺失版块、弱证据或竞争信号影响。'
    : '';

  return `${candidate.entry.explanationSeed} ${whyMatched} ${whyNot}${uncertainty}`.trim();
}
