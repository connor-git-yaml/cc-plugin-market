/**
 * Narrative provenance adapter
 *
 * 为 architecture-narrative 补上 059 可直接消费的 section-level provenance wrapper。
 */
import * as path from 'node:path';
import type {
  ArchitectureNarrativeOutput,
  NarrativeModuleInsight,
  NarrativeSymbolInsight,
} from './architecture-narrative.js';
import {
  normalizeConfidence,
  summarizeProvenanceRecord,
  summarizeProvenanceSection,
  type DocumentProvenanceRecord,
  type ProvenanceEntry,
} from './docs-quality-model.js';

export interface AdaptNarrativeProvenanceOptions {
  outputDir?: string;
  projectRoot?: string;
}

export function adaptArchitectureNarrativeProvenance(
  narrative: ArchitectureNarrativeOutput,
  options: AdaptNarrativeProvenanceOptions = {},
): DocumentProvenanceRecord {
  const sourcePath = options.outputDir
    ? normalizeProjectPath(path.join(options.outputDir, 'architecture-narrative.md'), options.projectRoot)
    : undefined;

  const executiveSummaryEntries = narrative.keyModules
    .slice(0, 4)
    .map((module) => createModuleEntry(module, 'executive-summary'));
  const keyModuleEntries = narrative.keyModules.map((module) => createModuleEntry(module, 'key-module'));
  const symbolEntries = [
    ...narrative.keySymbols.map((symbol) => createSymbolEntry(symbol)),
    ...narrative.keyMethods.map((symbol) => createSymbolEntry(symbol)),
  ];
  const observationEntries = [
    ...narrative.supportingDocs.map((doc): ProvenanceEntry => ({
      sourceType: 'generated-doc',
      originType: doc.generatorId,
      ref: doc.title,
      path: doc.path,
      note: `supporting-doc:${doc.generatorId}`,
      confidence: 'medium',
      inferred: false,
    })),
    ...narrative.keyModules.slice(0, 3).map((module) => createModuleEntry(module, 'observation')),
  ];

  return summarizeProvenanceRecord({
    documentId: 'architecture-narrative',
    title: narrative.title,
    sourcePath,
    available: true,
    warnings: [],
    sections: [
      summarizeProvenanceSection({
        id: 'executive-summary',
        title: 'Executive Summary',
        summary: narrative.executiveSummary.join(' '),
        entries: executiveSummaryEntries,
      }),
      summarizeProvenanceSection({
        id: 'key-modules',
        title: 'Key Modules',
        summary: `关键模块数: ${narrative.keyModules.length}`,
        entries: keyModuleEntries,
      }),
      summarizeProvenanceSection({
        id: 'key-symbols',
        title: 'Key Symbols & Methods',
        summary: `关键符号与方法数: ${narrative.keySymbols.length + narrative.keyMethods.length}`,
        entries: symbolEntries,
      }),
      summarizeProvenanceSection({
        id: 'observations',
        title: 'Observations',
        summary: narrative.observations.join(' '),
        entries: observationEntries,
      }),
    ],
  });
}

function createModuleEntry(
  module: NarrativeModuleInsight,
  notePrefix: string,
): ProvenanceEntry {
  return {
    sourceType: 'spec',
    originType: 'stored-module-spec',
    ref: module.sourceTarget,
    path: module.relatedFiles[0] ?? module.sourceTarget,
    note: `${notePrefix}:${module.intentSummary}`,
    excerpt: module.businessSummary,
    confidence: normalizeConfidence(module.confidence),
    inferred: module.inferred,
  };
}

function createSymbolEntry(symbol: NarrativeSymbolInsight): ProvenanceEntry {
  return {
    sourceType: 'code',
    originType: symbol.kind,
    ref: `${symbol.moduleName}:${symbol.ownerName ? `${symbol.ownerName}.` : ''}${symbol.name}`,
    path: symbol.moduleName,
    note: symbol.signature,
    excerpt: symbol.note,
    confidence: normalizeConfidence(symbol.inferred ? 'low' : 'medium'),
    inferred: symbol.inferred,
  };
}

function normalizeProjectPath(candidatePath: string, projectRoot?: string): string {
  if (!projectRoot) {
    return candidatePath.split(path.sep).join('/');
  }

  const relative = path.relative(projectRoot, candidatePath);
  return relative.startsWith('..')
    ? candidatePath.split(path.sep).join('/')
    : relative.split(path.sep).join('/');
}
