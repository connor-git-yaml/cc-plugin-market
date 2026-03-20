/**
 * Pattern hints shared model
 *
 * Feature 050 负责生产这份结构化模式提示模型。
 * 本文件只承载共享实体与 helper，不包含 Markdown/模板细节。
 */

import type { ArchitectureOverviewOutput } from './architecture-overview-generator.js';
import type { ArchitectureSectionKind } from './architecture-overview-model.js';

export type PatternEvidenceSource =
  | 'architecture-overview'
  | 'runtime-topology'
  | 'workspace-index'
  | 'cross-package'
  | 'doc-graph';

export type PatternMatchLevel = 'high' | 'medium' | 'low' | 'none';

export interface PatternEvidenceRef {
  source: PatternEvidenceSource;
  ref: string;
  sectionKind?: ArchitectureSectionKind;
  nodeId?: string;
  edgeRef?: string;
  note?: string;
  inferred?: boolean;
}

export interface PatternAlternative {
  patternId: string;
  patternName: string;
  reason: string;
  confidenceGap?: number;
}

export interface PatternHint {
  patternId: string;
  patternName: string;
  summary: string;
  confidence: number;
  matchLevel: Exclude<PatternMatchLevel, 'none'>;
  explanation: string;
  evidence: PatternEvidenceRef[];
  matchedSignals: string[];
  missingSignals: string[];
  competingAlternatives: PatternAlternative[];
  inferred: boolean;
}

export interface PatternHintStats {
  totalPatternsEvaluated: number;
  matchedPatterns: number;
  highConfidencePatterns: number;
  warningCount: number;
}

export interface PatternHintsModel {
  projectName: string;
  matchedPatterns: PatternHint[];
  noHighConfidenceMatch: boolean;
  alternatives: PatternAlternative[];
  warnings: string[];
  stats: PatternHintStats;
}

export interface PatternHintsInput {
  architectureOverview: ArchitectureOverviewOutput;
  warnings: string[];
  weakSignals?: {
    runtimeAvailable: boolean;
    docGraphAvailable: boolean;
  };
}

export interface PatternHintsOutput {
  title: string;
  generatedAt: string;
  architectureOverview: ArchitectureOverviewOutput;
  model: PatternHintsModel;
  warnings: string[];
}

export interface PatternSignalRule {
  id: string;
  description: string;
  sectionKind?: ArchitectureSectionKind;
  weight: number;
}

export interface PatternKnowledgeBaseEntry {
  id: string;
  name: string;
  summary: string;
  positiveSignals: PatternSignalRule[];
  negativeSignals: PatternSignalRule[];
  competingPatternIds: string[];
  explanationSeed: string;
}

export function createPatternEvidenceRef(
  source: PatternEvidenceSource,
  ref: string,
  options: Omit<PatternEvidenceRef, 'source' | 'ref'> = {},
): PatternEvidenceRef {
  return {
    source,
    ref,
    ...options,
  };
}

export function determinePatternMatchLevel(confidence: number): PatternMatchLevel {
  if (confidence >= 0.72) {
    return 'high';
  }

  if (confidence >= 0.55) {
    return 'medium';
  }

  if (confidence >= 0.35) {
    return 'low';
  }

  return 'none';
}

export function summarizePatternHints(
  model: Pick<PatternHintsModel, 'matchedPatterns' | 'warnings'>,
  totalPatternsEvaluated: number,
): PatternHintStats {
  return {
    totalPatternsEvaluated,
    matchedPatterns: model.matchedPatterns.length,
    highConfidencePatterns: model.matchedPatterns.filter((hint) => hint.matchLevel === 'high').length,
    warningCount: model.warnings.length,
  };
}

export function getHighConfidencePatternHints(model: PatternHintsModel): PatternHint[] {
  return model.matchedPatterns.filter((hint) => hint.matchLevel === 'high');
}

export function dedupePatternEvidence(evidence: PatternEvidenceRef[]): PatternEvidenceRef[] {
  const seen = new Set<string>();
  const deduped: PatternEvidenceRef[] = [];

  for (const item of evidence) {
    const key = [
      item.source,
      item.ref,
      item.sectionKind ?? '',
      item.nodeId ?? '',
      item.edgeRef ?? '',
      item.note ?? '',
      item.inferred ? '1' : '0',
    ].join('::');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

export function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}
