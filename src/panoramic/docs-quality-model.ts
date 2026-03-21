/**
 * Docs quality shared model
 *
 * 059 的共享治理模型，供 provenance / conflict / required-doc / quality report 复用。
 * 本文件只承载结构化实体和 helper，不包含渲染细节。
 */

export type ProvenanceSourceType =
  | 'code'
  | 'config'
  | 'test'
  | 'spec'
  | 'current-spec'
  | 'readme'
  | 'commit'
  | 'generated-doc'
  | 'inference';

export type QualityConfidence = 'high' | 'medium' | 'low';
export type QualityCoverage = 'high' | 'medium' | 'low' | 'missing';
export type ConflictSeverity = 'high' | 'medium' | 'low';
export type RequiredDocCoverage = 'covered' | 'missing' | 'partial';
export type DocsQualityStatus = 'pass' | 'warn' | 'fail' | 'partial';
export type BundleCoverageStatus = 'full' | 'partial';

export interface ProvenanceEntry {
  sourceType: ProvenanceSourceType;
  ref: string;
  originType?: string;
  path?: string;
  note?: string;
  excerpt?: string;
  confidence: QualityConfidence;
  inferred: boolean;
}

export interface DocumentProvenanceSection {
  id: string;
  title: string;
  summary?: string;
  coverage: QualityCoverage;
  entries: ProvenanceEntry[];
}

export interface DocumentProvenanceRecord {
  documentId: string;
  title: string;
  sourcePath?: string;
  available: boolean;
  coverage: QualityCoverage;
  confidence: QualityConfidence;
  sectionCount: number;
  entryCount: number;
  sourceTypes: ProvenanceSourceType[];
  warnings: string[];
  missingReason?: string;
  sections: DocumentProvenanceSection[];
}

export interface ConflictSourceRef {
  sourceType: ProvenanceSourceType;
  label: string;
  canonicalValue: string;
  path?: string;
  excerpt?: string;
}

export interface ConflictRecord {
  topic:
    | 'product-positioning'
    | 'runtime-hosting'
    | 'protocol-boundary'
    | 'extensibility-boundary'
    | 'degradation-strategy';
  severity: ConflictSeverity;
  summary: string;
  sources: ConflictSourceRef[];
}

export interface RequiredDocRule {
  docId: string;
  title: string;
  requiredBy: string[];
  reason: string;
}

export interface RequiredDocStatus {
  docId: string;
  title: string;
  required: boolean;
  present: boolean;
  presentPath?: string;
  coverage: RequiredDocCoverage;
  requiredBy: string[];
  includedInBundles: string[];
  missingFromBundles: string[];
  notes: string[];
}

export interface DocsQualityStats {
  totalProvenanceDocs: number;
  availableProvenanceDocs: number;
  highCoverageDocs: number;
  lowCoverageDocs: number;
  totalConflicts: number;
  highSeverityConflicts: number;
  totalRequiredDocs: number;
  coveredRequiredDocs: number;
  partialRequiredDocs: number;
  missingRequiredDocs: number;
  dependencyWarningCount: number;
  warningCount: number;
  score: number;
}

export interface DocsQualityReport {
  title: string;
  generatedAt: string;
  projectName: string;
  status: DocsQualityStatus;
  bundleCoverage: BundleCoverageStatus;
  summary: string[];
  provenance: DocumentProvenanceRecord[];
  conflicts: ConflictRecord[];
  requiredDocs: RequiredDocStatus[];
  dependencyWarnings: string[];
  warnings: string[];
  stats: DocsQualityStats;
}

export function normalizeConfidence(
  value: QualityConfidence | number | undefined | null,
): QualityConfidence {
  if (typeof value === 'string') {
    if (value === 'high' || value === 'medium' || value === 'low') {
      return value;
    }
    return 'low';
  }

  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'low';
  }

  if (value >= 0.72) {
    return 'high';
  }
  if (value >= 0.45) {
    return 'medium';
  }
  return 'low';
}

export function summarizeProvenanceRecord(
  record: Omit<DocumentProvenanceRecord, 'coverage' | 'confidence' | 'sectionCount' | 'entryCount' | 'sourceTypes'>,
): DocumentProvenanceRecord {
  const sectionCount = record.sections.length;
  const entryCount = record.sections.reduce((sum, section) => sum + section.entries.length, 0);
  const sourceTypes = dedupeStringValues(
    record.sections.flatMap((section) => section.entries.map((entry) => entry.sourceType)),
  ) as ProvenanceSourceType[];
  const sectionCoverageRatio = sectionCount > 0
    ? record.sections.filter((section) => section.entries.length > 0).length / sectionCount
    : 0;
  const coverage = record.available
    ? coverageFromRatio(sectionCoverageRatio)
    : 'missing';
  const confidence = confidenceFromEntries(record.sections.flatMap((section) => section.entries));

  return {
    ...record,
    sectionCount,
    entryCount,
    sourceTypes,
    coverage,
    confidence,
  };
}

export function summarizeDocsQualityStats(input: {
  provenance: DocumentProvenanceRecord[];
  conflicts: ConflictRecord[];
  requiredDocs: RequiredDocStatus[];
  dependencyWarnings: string[];
  warnings: string[];
}): DocsQualityStats {
  const totalProvenanceDocs = input.provenance.length;
  const availableProvenanceDocs = input.provenance.filter((record) => record.available).length;
  const highCoverageDocs = input.provenance.filter((record) => record.coverage === 'high').length;
  const lowCoverageDocs = input.provenance.filter((record) => record.coverage === 'low').length;
  const highSeverityConflicts = input.conflicts.filter((conflict) => conflict.severity === 'high').length;
  const coveredRequiredDocs = input.requiredDocs.filter((doc) => doc.coverage === 'covered').length;
  const partialRequiredDocs = input.requiredDocs.filter((doc) => doc.coverage === 'partial').length;
  const missingRequiredDocs = input.requiredDocs.filter((doc) => doc.coverage === 'missing').length;
  const score = clampScore(
    100
      - (highSeverityConflicts * 20)
      - (input.conflicts.filter((conflict) => conflict.severity === 'medium').length * 10)
      - (input.conflicts.filter((conflict) => conflict.severity === 'low').length * 5)
      - (missingRequiredDocs * 8)
      - (partialRequiredDocs * 4)
      - (lowCoverageDocs * 3)
      - (input.dependencyWarnings.length * 2),
  );

  return {
    totalProvenanceDocs,
    availableProvenanceDocs,
    highCoverageDocs,
    lowCoverageDocs,
    totalConflicts: input.conflicts.length,
    highSeverityConflicts,
    totalRequiredDocs: input.requiredDocs.length,
    coveredRequiredDocs,
    partialRequiredDocs,
    missingRequiredDocs,
    dependencyWarningCount: input.dependencyWarnings.length,
    warningCount: input.warnings.length,
    score,
  };
}

export function determineDocsQualityStatus(input: {
  bundleCoverage: BundleCoverageStatus;
  conflicts: ConflictRecord[];
  requiredDocs: RequiredDocStatus[];
  warnings: string[];
  dependencyWarnings: string[];
}): DocsQualityStatus {
  const missingRequiredDocs = input.requiredDocs.filter((doc) => doc.coverage === 'missing').length;
  const hasHighSeverityConflict = input.conflicts.some((conflict) => conflict.severity === 'high');
  if (hasHighSeverityConflict || missingRequiredDocs >= 2) {
    return 'fail';
  }

  if (input.bundleCoverage === 'partial' && input.dependencyWarnings.length > 0) {
    return 'partial';
  }

  if (
    input.conflicts.length > 0 ||
    input.requiredDocs.some((doc) => doc.coverage !== 'covered') ||
    input.warnings.length > 0
  ) {
    return 'warn';
  }

  return 'pass';
}

export function dedupeProvenanceEntries(entries: ProvenanceEntry[]): ProvenanceEntry[] {
  const seen = new Set<string>();
  const deduped: ProvenanceEntry[] = [];

  for (const entry of entries) {
    const key = [
      entry.sourceType,
      entry.ref,
      entry.originType ?? '',
      entry.path ?? '',
      entry.note ?? '',
      entry.excerpt ?? '',
      entry.confidence,
      entry.inferred ? '1' : '0',
    ].join('::');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped.sort((left, right) =>
    `${left.sourceType}:${left.ref}`.localeCompare(`${right.sourceType}:${right.ref}`),
  );
}

export function summarizeProvenanceSection(
  section: Omit<DocumentProvenanceSection, 'coverage' | 'entries'> & { entries: ProvenanceEntry[] },
): DocumentProvenanceSection {
  const entries = dedupeProvenanceEntries(section.entries);
  return {
    ...section,
    entries,
    coverage: coverageFromRatio(entries.length > 0 ? 1 : 0),
  };
}

function confidenceFromEntries(entries: ProvenanceEntry[]): QualityConfidence {
  if (entries.length === 0) {
    return 'low';
  }

  const score = entries.reduce((sum, entry) => sum + confidenceScore(entry.confidence), 0) / entries.length;
  if (score >= 2.5) {
    return 'high';
  }
  if (score >= 1.5) {
    return 'medium';
  }
  return 'low';
}

function coverageFromRatio(ratio: number): QualityCoverage {
  if (ratio <= 0) {
    return 'missing';
  }
  if (ratio >= 0.85) {
    return 'high';
  }
  if (ratio >= 0.5) {
    return 'medium';
  }
  return 'low';
}

function confidenceScore(value: QualityConfidence): number {
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

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function dedupeStringValues(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
