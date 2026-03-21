/**
 * Docs quality evaluator
 *
 * 在现有 panoramic / ADR 结构化输出之上，生成 provenance、conflict、required-doc
 * 与总体质量结论。059 不新增事实抽取器，也不把 Markdown 当作 canonical facts。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjectContext } from './interfaces.js';
import type { ArchitectureNarrativeOutput, BatchGeneratedDocSummary } from './architecture-narrative.js';
import type { ArchitectureOverviewOutput } from './architecture-overview-generator.js';
import type { PatternHintsOutput } from './pattern-hints-model.js';
import type { ComponentViewOutput, DynamicScenariosOutput } from './component-view-model.js';
import type { RuntimeTopologyOutput } from './runtime-topology-generator.js';
import type { AdrDraft, AdrIndexOutput } from './adr-decision-pipeline.js';
import { loadTemplate } from './utils/template-loader.js';
import { adaptArchitectureNarrativeProvenance } from './narrative-provenance-adapter.js';
import type { DocsBundleManifestReference } from './docs-bundle-manifest-reader.js';
import {
  determineDocsQualityStatus,
  normalizeConfidence,
  summarizeDocsQualityStats,
  summarizeProvenanceRecord,
  summarizeProvenanceSection,
  type BundleCoverageStatus,
  type ConflictRecord,
  type ConflictSourceRef,
  type DocsQualityReport,
  type DocumentProvenanceRecord,
  type ProvenanceEntry,
  type ProvenanceSourceType,
  type RequiredDocRule,
  type RequiredDocStatus,
} from './docs-quality-model.js';

export interface EvaluateDocsQualityOptions {
  projectRoot: string;
  outputDir: string;
  projectContext?: ProjectContext;
  generatedDocs: BatchGeneratedDocSummary[];
  architectureNarrative: ArchitectureNarrativeOutput;
  architectureOverview?: ArchitectureOverviewOutput;
  patternHints?: PatternHintsOutput;
  componentView?: ComponentViewOutput;
  dynamicScenarios?: DynamicScenariosOutput;
  runtimeTopology?: RuntimeTopologyOutput;
  adrIndex?: AdrIndexOutput;
  docsBundleManifest?: DocsBundleManifestReference;
  dependencyWarnings?: string[];
}

interface QualityDocumentPresence {
  id: string;
  title: string;
  path?: string;
}

interface QualityEvidenceDocument {
  sourceType: ProvenanceSourceType;
  label: string;
  path?: string;
  text: string;
}

interface TopicClaim {
  topic: ConflictRecord['topic'];
  sourceType: ProvenanceSourceType;
  label: string;
  path?: string;
  canonicalValue: string;
  excerpt: string;
}

type TopicPattern = Record<ConflictRecord['topic'], Array<{ value: string; patterns: RegExp[] }>>;

const DOC_METADATA: Record<string, { title: string; relativePath: string }> = {
  'architecture-narrative': {
    title: 'Architecture Narrative',
    relativePath: 'architecture-narrative.md',
  },
  'architecture-overview': {
    title: 'Architecture Overview',
    relativePath: 'architecture-overview.md',
  },
  'runtime-topology': {
    title: 'Runtime Topology',
    relativePath: 'runtime-topology.md',
  },
  'component-view': {
    title: 'Component View',
    relativePath: 'component-view.md',
  },
  'dynamic-scenarios': {
    title: 'Dynamic Scenarios',
    relativePath: 'dynamic-scenarios.md',
  },
  'pattern-hints': {
    title: 'Pattern Hints',
    relativePath: 'pattern-hints.md',
  },
  'api-surface': {
    title: 'API Surface',
    relativePath: 'api-surface.md',
  },
  'data-model': {
    title: 'Data Model',
    relativePath: 'data-model.md',
  },
  'workspace-index': {
    title: 'Workspace Index',
    relativePath: 'workspace-index.md',
  },
  'cross-package-analysis': {
    title: 'Cross-Package Analysis',
    relativePath: 'cross-package-analysis.md',
  },
  'docs/adr/index': {
    title: 'ADR Index',
    relativePath: 'docs/adr/index.md',
  },
  'quality-report': {
    title: 'Docs Quality Report',
    relativePath: 'quality-report.md',
  },
};

const REQUIRED_DOC_RULES: ReadonlyArray<RequiredDocRule> = [
  {
    docId: 'architecture-narrative',
    title: DOC_METADATA['architecture-narrative']!.title,
    requiredBy: ['general'],
    reason: '叙事文档是 explanation 层的默认入口。',
  },
  {
    docId: 'architecture-overview',
    title: DOC_METADATA['architecture-overview']!.title,
    requiredBy: ['runtime-project', 'architecture-heavy'],
    reason: '架构概览提供 system context / deployment / layered 的统一总览。',
  },
  {
    docId: 'pattern-hints',
    title: DOC_METADATA['pattern-hints']!.title,
    requiredBy: ['architecture-heavy'],
    reason: '模式提示用于解释系统采用当前架构形态的证据与替代方案。',
  },
  {
    docId: 'docs/adr/index',
    title: DOC_METADATA['docs/adr/index']!.title,
    requiredBy: ['architecture-heavy'],
    reason: 'ADR 索引是架构决策审计入口。',
  },
  {
    docId: 'runtime-topology',
    title: DOC_METADATA['runtime-topology']!.title,
    requiredBy: ['runtime-project'],
    reason: '运行时项目必须显式记录服务、容器和部署边界。',
  },
  {
    docId: 'component-view',
    title: DOC_METADATA['component-view']!.title,
    requiredBy: ['runtime-project'],
    reason: '组件视图是运行时链路与部署角色之间的关键中间层。',
  },
  {
    docId: 'dynamic-scenarios',
    title: DOC_METADATA['dynamic-scenarios']!.title,
    requiredBy: ['runtime-project'],
    reason: '动态链路文档用于说明主链路、参与者和 hand-off。',
  },
  {
    docId: 'api-surface',
    title: DOC_METADATA['api-surface']!.title,
    requiredBy: ['library-sdk'],
    reason: 'SDK / library 项目需要稳定的接口入口摘要。',
  },
  {
    docId: 'data-model',
    title: DOC_METADATA['data-model']!.title,
    requiredBy: ['library-sdk'],
    reason: 'SDK / library 项目需要对外和内部关键结构的数据模型摘要。',
  },
  {
    docId: 'workspace-index',
    title: DOC_METADATA['workspace-index']!.title,
    requiredBy: ['monorepo'],
    reason: 'Monorepo 需要 workspace / package 结构索引。',
  },
  {
    docId: 'cross-package-analysis',
    title: DOC_METADATA['cross-package-analysis']!.title,
    requiredBy: ['monorepo'],
    reason: 'Monorepo 需要跨包依赖分析和关系摘要。',
  },
];

const TOPIC_PATTERNS: TopicPattern = {
  'product-positioning': [
    { value: 'sdk', patterns: [/\bsdk\b/i, /\blibrary\b/i] },
    { value: 'cli', patterns: [/\bcli\b/i, /\bcommand[- ]line\b/i] },
    { value: 'plugin', patterns: [/\bplugin\b/i, /\bextension\b/i] },
    { value: 'service', patterns: [/\bservice\b/i] },
    { value: 'platform', patterns: [/\bplatform\b/i, /\bframework\b/i] },
  ],
  'runtime-hosting': [
    { value: 'containerized', patterns: [/\bdocker\b/i, /\bcompose\b/i, /\bcontainer/i] },
    { value: 'serverless', patterns: [/\bserverless\b/i, /\blambda\b/i] },
    { value: 'browser', patterns: [/\bbrowser\b/i] },
    { value: 'desktop', patterns: [/\bdesktop\b/i] },
    { value: 'local-process', patterns: [/\blocal process\b/i, /\bhost process\b/i, /\blocal runtime\b/i] },
  ],
  'protocol-boundary': [
    { value: 'http-rest', patterns: [/\bhttp\b/i, /\brest\b/i] },
    { value: 'grpc', patterns: [/\bgrpc\b/i] },
    { value: 'json-rpc', patterns: [/\bjson-rpc\b/i] },
    { value: 'websocket', patterns: [/\bwebsocket\b/i] },
    { value: 'stdio', patterns: [/\bstdio\b/i, /\bstdin\b/i, /\bstdout\b/i] },
    { value: 'event-bus', patterns: [/\bevent/i, /\bpub(?:lish)?\b/i, /\bsub(?:scribe)?\b/i] },
  ],
  'extensibility-boundary': [
    { value: 'registry', patterns: [/\bregistry\b/i] },
    { value: 'plugin', patterns: [/\bplugin\b/i, /\bextension\b/i] },
    { value: 'hook', patterns: [/\bhook\b/i] },
    { value: 'adapter', patterns: [/\badapter\b/i] },
    { value: 'middleware', patterns: [/\bmiddleware\b/i] },
  ],
  'degradation-strategy': [
    { value: 'partial', patterns: [/\bpartial\b/i] },
    { value: 'warning', patterns: [/\bwarn(?:ing)?\b/i] },
    { value: 'fallback', patterns: [/\bfallback\b/i, /\bbest effort\b/i] },
    { value: 'graceful', patterns: [/\bgraceful\b/i, /\bdegrad/i] },
    { value: 'strict', patterns: [/\bfail fast\b/i, /\bstrict\b/i, /\bblocking\b/i] },
  ],
};

export function evaluateDocsQuality(options: EvaluateDocsQualityOptions): DocsQualityReport {
  const dependencyWarnings = [...(options.dependencyWarnings ?? [])];
  const presentDocs = collectPresentDocs(options.generatedDocs, options.projectRoot, options.outputDir);
  const warnings = collectGeneratedDocWarnings(options.generatedDocs);

  if (!hasReadme(options.projectRoot)) {
    warnings.push('未找到 README.md，部分产品定位和协议边界冲突无法完整校验。');
  }
  if (!hasCurrentSpec(options.projectRoot)) {
    warnings.push('未找到 current-spec.md，产品级事实冲突校验将按可见 sources 保守降级。');
  }

  const provenance = buildProvenanceRecords(options, presentDocs);
  const evidenceDocs = collectEvidenceDocuments(options);
  const conflicts = detectConflicts(evidenceDocs);
  const requiredDocs = evaluateRequiredDocs(options, presentDocs, dependencyWarnings);
  const bundleCoverage = determineBundleCoverage(requiredDocs, options.docsBundleManifest);
  const status = determineDocsQualityStatus({
    bundleCoverage,
    conflicts,
    requiredDocs,
    warnings,
    dependencyWarnings,
  });
  const stats = summarizeDocsQualityStats({
    provenance,
    conflicts,
    requiredDocs,
    dependencyWarnings,
    warnings,
  });

  return {
    title: `文档质量报告: ${options.architectureNarrative.projectName}`,
    generatedAt: new Date().toISOString().split('T')[0]!,
    projectName: options.architectureNarrative.projectName,
    status,
    bundleCoverage,
    summary: buildSummaryLines({
      provenance,
      conflicts,
      requiredDocs,
      bundleCoverage,
      dependencyWarnings,
      warnings,
    }),
    provenance,
    conflicts,
    requiredDocs,
    dependencyWarnings: uniqueSorted(dependencyWarnings),
    warnings: uniqueSorted(warnings),
    stats,
  };
}

export function renderDocsQualityReport(report: DocsQualityReport): string {
  const template = loadTemplate('quality-report.hbs', import.meta.url);
  return template(report);
}

function buildProvenanceRecords(
  options: EvaluateDocsQualityOptions,
  presentDocs: Map<string, QualityDocumentPresence>,
): DocumentProvenanceRecord[] {
  return [
    adaptArchitectureNarrativeProvenance(options.architectureNarrative, {
      outputDir: options.outputDir,
      projectRoot: options.projectRoot,
    }),
    options.componentView
      ? buildComponentViewProvenance(options.componentView, presentDocs.get('component-view')?.path)
      : createMissingRecord('component-view', 'Component View', '当前批次未生成 component-view。'),
    options.dynamicScenarios
      ? buildDynamicScenariosProvenance(options.dynamicScenarios, presentDocs.get('dynamic-scenarios')?.path)
      : createMissingRecord('dynamic-scenarios', 'Dynamic Scenarios', '当前批次未生成 dynamic-scenarios。'),
    options.adrIndex
      ? buildAdrProvenance(options.adrIndex, presentDocs.get('docs/adr/index')?.path)
      : createMissingRecord('docs/adr/index', 'ADR Index', '当前批次未生成 ADR 索引。'),
  ];
}

function buildComponentViewProvenance(
  output: ComponentViewOutput,
  sourcePath?: string,
): DocumentProvenanceRecord {
  const componentEntries = output.model.components.flatMap((component) =>
    component.evidence.map((evidence): ProvenanceEntry => ({
      sourceType: mapComponentSourceType(evidence.sourceType),
      originType: evidence.sourceType,
      ref: `${component.name}:${evidence.ref}`,
      path: component.relatedFiles[0],
      note: evidence.note ?? component.summary,
      confidence: normalizeConfidence(component.confidence),
      inferred: Boolean(component.inferred || evidence.inferred),
    })));
  const relationshipEntries = output.model.relationships.flatMap((relationship) =>
    relationship.evidence.map((evidence): ProvenanceEntry => ({
      sourceType: mapComponentSourceType(evidence.sourceType),
      originType: evidence.sourceType,
      ref: `${relationship.fromId}->${relationship.toId}:${relationship.kind}`,
      note: evidence.note ?? relationship.label,
      confidence: normalizeConfidence(relationship.confidence),
      inferred: Boolean(evidence.inferred),
    })));

  return summarizeProvenanceRecord({
    documentId: 'component-view',
    title: output.title,
    sourcePath,
    available: true,
    warnings: output.warnings,
    sections: [
      summarizeProvenanceSection({
        id: 'components',
        title: 'Components',
        summary: `关键组件数: ${output.model.components.length}`,
        entries: componentEntries,
      }),
      summarizeProvenanceSection({
        id: 'relationships',
        title: 'Relationships',
        summary: `关系数: ${output.model.relationships.length}`,
        entries: relationshipEntries,
      }),
    ],
  });
}

function buildDynamicScenariosProvenance(
  output: DynamicScenariosOutput,
  sourcePath?: string,
): DocumentProvenanceRecord {
  const scenarioEntries = output.model.scenarios.flatMap((scenario) =>
    scenario.evidence.map((evidence): ProvenanceEntry => ({
      sourceType: mapComponentSourceType(evidence.sourceType),
      originType: evidence.sourceType,
      ref: `${scenario.id}:${evidence.ref}`,
      note: evidence.note ?? scenario.summary,
      confidence: normalizeConfidence(scenario.confidence),
      inferred: Boolean(scenario.inferred || evidence.inferred),
    })));
  const stepEntries = output.model.scenarios.flatMap((scenario) =>
    scenario.steps.flatMap((step) =>
      step.evidence.map((evidence): ProvenanceEntry => ({
        sourceType: mapComponentSourceType(evidence.sourceType),
        originType: evidence.sourceType,
        ref: `${scenario.id}:step-${step.index}:${evidence.ref}`,
        note: `${step.actor} -> ${step.target ?? 'n/a'}: ${step.action}`,
        confidence: normalizeConfidence(step.confidence),
        inferred: Boolean(step.inferred || evidence.inferred),
      }))));

  return summarizeProvenanceRecord({
    documentId: 'dynamic-scenarios',
    title: output.title,
    sourcePath,
    available: true,
    warnings: output.warnings,
    sections: [
      summarizeProvenanceSection({
        id: 'scenarios',
        title: 'Scenarios',
        summary: `场景数: ${output.model.scenarios.length}`,
        entries: scenarioEntries,
      }),
      summarizeProvenanceSection({
        id: 'steps',
        title: 'Steps',
        summary: `步骤数: ${output.model.stats.totalSteps}`,
        entries: stepEntries,
      }),
    ],
  });
}

function buildAdrProvenance(
  output: AdrIndexOutput,
  sourcePath?: string,
): DocumentProvenanceRecord {
  const draftSections = output.drafts.map((draft) => summarizeProvenanceSection({
    id: draft.decisionId.toLowerCase(),
    title: draft.title,
    summary: draft.summary,
    entries: draft.evidence.map((evidence) => toAdrProvenanceEntry(draft, evidence)),
  }));

  return summarizeProvenanceRecord({
    documentId: 'docs/adr/index',
    title: output.title,
    sourcePath,
    available: true,
    warnings: output.warnings,
    sections: draftSections,
  });
}

function toAdrProvenanceEntry(draft: AdrDraft, evidence: AdrDraft['evidence'][number]): ProvenanceEntry {
  return {
    sourceType: mapAdrSourceType(evidence.sourceType),
    originType: evidence.sourceType,
    ref: `${draft.decisionId}:${evidence.label}`,
    path: evidence.path,
    excerpt: evidence.excerpt,
    note: draft.summary,
    confidence: normalizeConfidence(draft.confidence),
    inferred: draft.inferred,
  };
}

function createMissingRecord(
  documentId: string,
  title: string,
  reason: string,
): DocumentProvenanceRecord {
  return summarizeProvenanceRecord({
    documentId,
    title,
    available: false,
    warnings: [],
    missingReason: reason,
    sections: [],
  });
}

function evaluateRequiredDocs(
  options: EvaluateDocsQualityOptions,
  presentDocs: Map<string, QualityDocumentPresence>,
  dependencyWarnings: string[],
): RequiredDocStatus[] {
  const projectKinds = inferProjectKinds(options, presentDocs);
  const manifest = options.docsBundleManifest;
  if (!manifest) {
    dependencyWarnings.push('缺少 docs-bundle manifest，发布覆盖度只能按 partial 模式估算。');
  }

  return REQUIRED_DOC_RULES
    .filter((rule) => rule.requiredBy.some((kind) => projectKinds.has(kind)))
    .map((rule) => {
      const presentDoc = presentDocs.get(rule.docId);
      const includedInBundles = manifest
        ? manifest.profiles
          .filter((profile) => profile.documentIds.includes(rule.docId))
          .map((profile) => profile.id)
        : [];
      const missingFromBundles = manifest && presentDoc && includedInBundles.length === 0
        ? manifest.profiles.map((profile) => profile.id)
        : [];

      return {
        docId: rule.docId,
        title: rule.title,
        required: true,
        present: Boolean(presentDoc),
        presentPath: presentDoc?.path,
        coverage: presentDoc
          ? (manifest && includedInBundles.length === 0 ? 'partial' : 'covered')
          : 'missing',
        requiredBy: [...rule.requiredBy],
        includedInBundles,
        missingFromBundles,
        notes: [
          rule.reason,
          ...(manifest
            ? (includedInBundles.length === 0 && presentDoc
              ? ['文档已生成，但当前 bundle profiles 未包含该文档。']
              : [])
            : ['docs-bundle manifest 不可用，发布覆盖度未完全校验。']),
        ],
      } satisfies RequiredDocStatus;
    })
    .sort((left, right) => left.docId.localeCompare(right.docId));
}

function inferProjectKinds(
  options: EvaluateDocsQualityOptions,
  presentDocs: Map<string, QualityDocumentPresence>,
): Set<string> {
  const projectKinds = new Set<string>(['general']);
  const hasRuntime = Boolean(
    options.runtimeTopology?.topology.services.length
      || options.architectureOverview?.deploymentView?.available,
  );
  const isMonorepo = Boolean(
    options.projectContext?.workspaceType === 'monorepo'
      || presentDocs.has('workspace-index')
      || presentDocs.has('cross-package-analysis'),
  );
  const isLibrarySdk = Boolean(
    presentDocs.has('api-surface')
      || presentDocs.has('data-model'),
  );
  const isArchitectureHeavy = Boolean(
    options.architectureOverview
      || options.patternHints
      || options.adrIndex,
  );

  if (hasRuntime) {
    projectKinds.add('runtime-project');
  }
  if (isMonorepo) {
    projectKinds.add('monorepo');
  }
  if (isLibrarySdk) {
    projectKinds.add('library-sdk');
  }
  if (isArchitectureHeavy) {
    projectKinds.add('architecture-heavy');
  }

  return projectKinds;
}

function determineBundleCoverage(
  requiredDocs: RequiredDocStatus[],
  manifest: DocsBundleManifestReference | undefined,
): BundleCoverageStatus {
  if (!manifest) {
    return 'partial';
  }

  return requiredDocs.some((doc) => doc.present && doc.includedInBundles.length === 0)
    ? 'partial'
    : 'full';
}

function detectConflicts(documents: QualityEvidenceDocument[]): ConflictRecord[] {
  const claims = documents.flatMap((document) => extractTopicClaims(document));
  const records: ConflictRecord[] = [];

  for (const topic of Object.keys(TOPIC_PATTERNS) as Array<ConflictRecord['topic']>) {
    const topicClaims = claims.filter((claim) => claim.topic === topic);
    const distinctValues = uniqueSorted(topicClaims.map((claim) => claim.canonicalValue));
    if (topicClaims.length < 2 || distinctValues.length < 2) {
      continue;
    }

    const sourceRefs = dedupeConflictSources(topicClaims).slice(0, 4);
    records.push({
      topic,
      severity: severityForTopic(topic),
      summary: `${humanizeTopic(topic)} 在多个来源之间存在不一致：${distinctValues.join(' vs ')}`,
      sources: sourceRefs,
    });
  }

  return records.sort((left, right) =>
    severityWeight(right.severity) - severityWeight(left.severity)
      || left.topic.localeCompare(right.topic),
  );
}

function collectEvidenceDocuments(options: EvaluateDocsQualityOptions): QualityEvidenceDocument[] {
  const documents: QualityEvidenceDocument[] = [];

  if (options.runtimeTopology?.topology.services.length) {
    documents.push({
      sourceType: 'generated-doc',
      label: 'runtime-topology',
      path: normalizeProjectPath(path.join(options.outputDir, 'runtime-topology.md'), options.projectRoot),
      text: options.runtimeTopology.topology.services.map((service) => [
        service.name,
        service.image,
        service.command ?? '',
        service.dependsOn.map((dependency) => dependency.service).join(' '),
      ].join('\n')).join('\n\n'),
    });
  }

  documents.push({
    sourceType: 'generated-doc',
    label: 'architecture-narrative',
    path: normalizeProjectPath(path.join(options.outputDir, 'architecture-narrative.md'), options.projectRoot),
    text: [
      ...options.architectureNarrative.executiveSummary,
      ...options.architectureNarrative.observations,
      ...options.architectureNarrative.keyModules.map((module) => [
        module.sourceTarget,
        module.intentSummary,
        module.businessSummary,
        module.dependencySummary,
      ].join('\n')),
    ].join('\n'),
  });

  if (options.patternHints) {
    documents.push({
      sourceType: 'generated-doc',
      label: 'pattern-hints',
      path: normalizeProjectPath(path.join(options.outputDir, 'pattern-hints.md'), options.projectRoot),
      text: options.patternHints.model.matchedPatterns.map((hint) => [
        hint.patternName,
        hint.summary,
        hint.explanation,
      ].join('\n')).join('\n\n'),
    });
  }

  for (const readmePath of findFilesByBasename(options.projectRoot, ['README.md', 'readme.md'])) {
    documents.push({
      sourceType: 'readme',
      label: path.basename(readmePath),
      path: normalizeProjectPath(readmePath, options.projectRoot),
      text: fs.readFileSync(readmePath, 'utf-8'),
    });
  }

  for (const specPath of findSpecEvidenceFiles(options.projectRoot)) {
    const basename = path.basename(specPath);
    const sourceType = basename === 'current-spec.md'
      ? 'current-spec'
      : 'spec';
    documents.push({
      sourceType,
      label: basename,
      path: normalizeProjectPath(specPath, options.projectRoot),
      text: fs.readFileSync(specPath, 'utf-8'),
    });
  }

  return documents;
}

function extractTopicClaims(document: QualityEvidenceDocument): TopicClaim[] {
  const claims: TopicClaim[] = [];

  for (const topic of Object.keys(TOPIC_PATTERNS) as Array<ConflictRecord['topic']>) {
    const matches = TOPIC_PATTERNS[topic]
      .filter((matcher) => matcher.patterns.some((pattern) => pattern.test(document.text)))
      .map((matcher) => matcher.value);
    const canonicalValue = uniqueSorted(matches).join('+');

    if (!canonicalValue) {
      continue;
    }

    claims.push({
      topic,
      sourceType: document.sourceType,
      label: document.label,
      path: document.path,
      canonicalValue,
      excerpt: extractExcerpt(document.text, TOPIC_PATTERNS[topic]),
    });
  }

  return claims;
}

function collectPresentDocs(
  generatedDocs: BatchGeneratedDocSummary[],
  projectRoot: string,
  outputDir: string,
): Map<string, QualityDocumentPresence> {
  const docs = new Map<string, QualityDocumentPresence>();

  for (const generatedDoc of generatedDocs) {
    for (const filePath of generatedDoc.writtenFiles.filter((candidate) => candidate.endsWith('.md'))) {
      const docId = toDocumentId(generatedDoc.generatorId, filePath, outputDir);
      if (!docId || !DOC_METADATA[docId]) {
        continue;
      }

      docs.set(docId, {
        id: docId,
        title: DOC_METADATA[docId]!.title,
        path: normalizeProjectPath(filePath, projectRoot),
      });
    }
  }

  return docs;
}

function collectGeneratedDocWarnings(generatedDocs: BatchGeneratedDocSummary[]): string[] {
  return uniqueSorted(generatedDocs.flatMap((doc) =>
    doc.warnings.map((warning) => `${doc.generatorId}: ${warning}`),
  ));
}

function toDocumentId(generatorId: string, filePath: string, outputDir: string): string | undefined {
  if (generatorId === 'adr-pipeline') {
    return filePath.endsWith(path.join('docs', 'adr', 'index.md')) ? 'docs/adr/index' : undefined;
  }

  if (generatorId === 'cross-package-deps') {
    return 'cross-package-analysis';
  }

  if (generatorId === 'quality-report') {
    return 'quality-report';
  }

  if (DOC_METADATA[generatorId]) {
    return generatorId;
  }

  const relative = path.relative(outputDir, filePath).split(path.sep).join('/');
  const matched = Object.entries(DOC_METADATA)
    .find(([, metadata]) => metadata.relativePath === relative);
  return matched?.[0];
}

function buildSummaryLines(input: {
  provenance: DocumentProvenanceRecord[];
  conflicts: ConflictRecord[];
  requiredDocs: RequiredDocStatus[];
  bundleCoverage: BundleCoverageStatus;
  dependencyWarnings: string[];
  warnings: string[];
}): string[] {
  const availableDocs = input.provenance.filter((record) => record.available).length;
  const highCoverageDocs = input.provenance.filter((record) => record.coverage === 'high').length;
  const coveredRequiredDocs = input.requiredDocs.filter((doc) => doc.coverage === 'covered').length;
  const missingRequiredDocs = input.requiredDocs.filter((doc) => doc.coverage === 'missing').length;

  return [
    `Explanation provenance 可用文档 ${availableDocs}/${input.provenance.length}，其中高覆盖 ${highCoverageDocs} 份。`,
    input.conflicts.length > 0
      ? `检测到 ${input.conflicts.length} 条显式冲突，最高严重级别为 ${input.conflicts[0]!.severity}。`
      : '未检测到显式冲突记录。',
    `Required docs 覆盖 ${coveredRequiredDocs}/${input.requiredDocs.length}，缺失 ${missingRequiredDocs} 份。`,
    input.bundleCoverage === 'full'
      ? 'docs bundle manifest 可用，已完成发布覆盖校验。'
      : 'docs bundle manifest 缺失或覆盖不完整，发布覆盖校验按 partial 模式降级。',
    ...(input.dependencyWarnings.length > 0
      ? [`Dependency warnings: ${input.dependencyWarnings.length} 条。`]
      : []),
    ...(input.warnings.length > 0
      ? [`General warnings: ${input.warnings.length} 条。`]
      : []),
  ];
}

function severityForTopic(topic: ConflictRecord['topic']): ConflictRecord['severity'] {
  switch (topic) {
    case 'product-positioning':
    case 'runtime-hosting':
      return 'high';
    case 'protocol-boundary':
    case 'extensibility-boundary':
      return 'medium';
    case 'degradation-strategy':
    default:
      return 'low';
  }
}

function severityWeight(severity: ConflictRecord['severity']): number {
  switch (severity) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
    default:
      return 1;
  }
}

function humanizeTopic(topic: ConflictRecord['topic']): string {
  switch (topic) {
    case 'product-positioning':
      return '产品定位';
    case 'runtime-hosting':
      return '运行时宿主';
    case 'protocol-boundary':
      return '协议边界';
    case 'extensibility-boundary':
      return '扩展边界';
    case 'degradation-strategy':
    default:
      return '降级策略';
  }
}

function dedupeConflictSources(claims: TopicClaim[]): ConflictSourceRef[] {
  const seen = new Set<string>();
  const result: ConflictSourceRef[] = [];

  for (const claim of claims) {
    const key = `${claim.topic}:${claim.sourceType}:${claim.label}:${claim.canonicalValue}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({
      sourceType: claim.sourceType,
      label: claim.label,
      canonicalValue: claim.canonicalValue,
      path: claim.path,
      excerpt: claim.excerpt,
    });
  }

  return result;
}

function mapComponentSourceType(sourceType: string): ProvenanceSourceType {
  switch (sourceType) {
    case 'architecture-ir':
    case 'baseline-skeleton':
      return 'code';
    case 'runtime-topology':
      return 'config';
    case 'test-file':
      return 'test';
    case 'module-spec':
      return 'spec';
    case 'architecture-narrative':
    case 'event-surface':
    default:
      return 'generated-doc';
  }
}

function mapAdrSourceType(sourceType: string): ProvenanceSourceType {
  switch (sourceType) {
    case 'current-spec':
      return 'current-spec';
    case 'commit':
      return 'commit';
    case 'spec':
    case 'blueprint':
      return 'spec';
    case 'source-path':
      return 'code';
    case 'architecture-overview':
    case 'architecture-narrative':
    case 'pattern-hints':
    default:
      return 'generated-doc';
  }
}

function hasReadme(projectRoot: string): boolean {
  return findFilesByBasename(projectRoot, ['README.md', 'readme.md']).length > 0;
}

function hasCurrentSpec(projectRoot: string): boolean {
  return findSpecEvidenceFiles(projectRoot).some((filePath) => path.basename(filePath) === 'current-spec.md');
}

function findSpecEvidenceFiles(projectRoot: string): string[] {
  const specsDir = path.join(projectRoot, 'specs');
  if (!fs.existsSync(specsDir)) {
    return [];
  }

  const results: string[] = [];
  walkDirectory(specsDir, (filePath) => {
    const basename = path.basename(filePath);
    if (basename === 'current-spec.md' || basename === 'spec.md' || basename === 'blueprint.md') {
      results.push(filePath);
    }
  });
  return results.sort((left, right) => left.localeCompare(right));
}

function findFilesByBasename(projectRoot: string, fileNames: string[]): string[] {
  return fileNames
    .map((fileName) => path.join(projectRoot, fileName))
    .filter((candidatePath) => fs.existsSync(candidatePath));
}

function walkDirectory(dir: string, visitor: (filePath: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(fullPath, visitor);
      continue;
    }

    if (entry.isFile()) {
      visitor(fullPath);
    }
  }
}

function extractExcerpt(
  text: string,
  topicPatterns: Array<{ value: string; patterns: RegExp[] }>,
): string {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (topicPatterns.some((matcher) => matcher.patterns.some((pattern) => pattern.test(line)))) {
      return line.slice(0, 180);
    }
  }
  return text.trim().slice(0, 180);
}

function normalizeProjectPath(candidatePath: string, projectRoot: string): string {
  const relative = path.relative(projectRoot, candidatePath);
  return relative.startsWith('..')
    ? candidatePath.split(path.sep).join('/')
    : relative.split(path.sep).join('/');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
