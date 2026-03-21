/**
 * 全景文档化模块 — 统一桶文件导出
 *
 * 导出内容：
 * - 核心接口和类型（interfaces.ts）
 * - GeneratorRegistry + bootstrapGenerators（generator-registry.ts）
 * - ArtifactParserRegistry + bootstrapParsers（parser-registry.ts）
 * - Generator 实现
 * - Parser 实现 + 类型（parsers/index.ts）
 * - ProjectContext 构建函数
 */

// 核心接口和类型
export type {
  DocumentGenerator,
  ArtifactParser,
  ProjectContext,
  GenerateOptions,
  OutputFormat,
  GeneratorMetadata,
  ArtifactParserMetadata,
  PackageManager,
  WorkspaceType,
} from './interfaces.js';

export {
  ProjectContextSchema,
  GeneratorMetadataSchema,
  ArtifactParserMetadataSchema,
  GenerateOptionsSchema,
  OutputFormatSchema,
  PackageManagerSchema,
  WorkspaceTypeSchema,
} from './interfaces.js';

// Registry
export { GeneratorRegistry, bootstrapGenerators, type GeneratorEntry } from './generator-registry.js';
export { ArtifactParserRegistry, bootstrapParsers, type ParserEntry } from './parser-registry.js';

// Generator 实现
export { MockReadmeGenerator } from './mock-readme-generator.js';
export { ConfigReferenceGenerator } from './config-reference-generator.js';
export { DataModelGenerator } from './data-model-generator.js';
export {
  ApiSurfaceGenerator,
  type ApiSource,
  type ApiParameterLocation,
  type ApiParameter,
  type ApiResponse,
  type ApiEndpoint,
  type ApiSurfaceInput,
  type ApiSurfaceOutput,
} from './api-surface-generator.js';
export {
  WorkspaceIndexGenerator,
  extractWorkspaceData,
  type WorkspacePackageInfo,
  type WorkspaceInput,
  type WorkspaceOutput,
  type WorkspaceGroup,
} from './workspace-index-generator.js';

export {
  CrossPackageAnalyzer,
  type CrossPackageInput,
  type CrossPackageOutput,
  type TopologyLevel,
  type CycleGroup,
  type DependencyStats,
} from './cross-package-analyzer.js';

export {
  RuntimeTopologyGenerator,
  type RuntimeTopologyInput,
  type RuntimeTopologyOutput,
} from './runtime-topology-generator.js';

export {
  EventSurfaceGenerator,
  type EventRole,
  type EventChannelKind,
  type EventEvidence,
  type EventOccurrence,
  type EventChannel,
  type EventSurfaceInput,
  type EventSurfaceOutput,
} from './event-surface-generator.js';

export {
  TroubleshootingGenerator,
  type TroubleshootingEntryKind,
  type TroubleshootingConfidence,
  type TroubleshootingLocation,
  type TroubleshootingEntry,
  type TroubleshootingExplanation,
  type TroubleshootingInput,
  type TroubleshootingOutput,
} from './troubleshooting-generator.js';

export {
  CoverageAuditor,
  type CoverageAudit,
  type CoverageSummary,
  type ModuleCoverageEntry,
  type GeneratorCoverageEntry,
  type DanglingLinkEntry,
  type MissingLinkEntry,
  type LowConfidenceSpecEntry,
  type LevelCoverageEntry,
  type CoverageAuditorOptions,
  type CoverageIssue,
  type ModuleCoverageStatus,
} from './coverage-auditor.js';

export {
  ArchitectureOverviewGenerator,
  type ArchitectureOverviewInput,
  type ArchitectureOverviewOutput,
} from './architecture-overview-generator.js';

export {
  ArchitectureIRGenerator,
  type ArchitectureIRInput,
  type ArchitectureIROutput,
} from './architecture-ir-generator.js';

export {
  buildComponentView,
  renderComponentView,
  type BuildComponentViewOptions,
} from './component-view-builder.js';

export {
  buildDynamicScenarios,
  renderDynamicScenarios,
  type BuildDynamicScenariosOptions,
} from './dynamic-scenarios-builder.js';

export {
  PatternHintsGenerator,
  type PatternHintsGeneratorDependencies,
  type PatternHintsLLMEnhancer,
} from './pattern-hints-generator.js';

export {
  generateBatchAdrDocs,
  type AdrSourceType,
  type AdrEvidenceRef,
  type AdrDraft,
  type AdrIndexOutput,
  type GenerateBatchAdrDocsOptions,
  type GenerateBatchAdrDocsResult,
} from './adr-decision-pipeline.js';

export {
  evaluateDocsQuality,
  renderDocsQualityReport,
  type EvaluateDocsQualityOptions,
} from './docs-quality-evaluator.js';

export {
  adaptArchitectureNarrativeProvenance,
  type AdaptNarrativeProvenanceOptions,
} from './narrative-provenance-adapter.js';

export {
  readDocsBundleManifest,
  type BundleNavigationReference,
  type BundleProfileReference,
  type DocsBundleManifestReference,
  type ReadDocsBundleManifestResult,
} from './docs-bundle-manifest-reader.js';

export {
  buildSyntheticImageName,
  mergeEnvironmentVariables,
  normalizeCommandValue,
  collectRuntimeConfigHints,
  extractRuntimeBuildStages,
  summarizeRuntimeTopology,
  type RuntimeSourceKind,
  type RuntimeStageRole,
  type RuntimeConfigFormat,
  type RuntimeConfigCategory,
  type RuntimeEnvironmentVariable,
  type RuntimePortBinding,
  type RuntimeVolumeMount,
  type RuntimeDependency,
  type RuntimeBuildStage,
  type RuntimeImage,
  type RuntimeContainer,
  type RuntimeService,
  type RuntimeConfigHint,
  type RuntimeTopology,
  type RuntimeTopologyStats,
} from './runtime-topology-model.js';

export {
  createArchitectureEvidence,
  inferModuleResponsibility,
  summarizeArchitectureOverview,
  getArchitectureSection,
  type ArchitectureSourceKind,
  type ArchitectureSectionKind,
  type ArchitectureNodeKind,
  type ArchitectureRelationKind,
  type ArchitectureEvidence,
  type ArchitectureViewNode,
  type ArchitectureViewEdge,
  type ArchitectureViewSection,
  type ArchitectureModuleSummary,
  type DeploymentUnitSummary,
  type ArchitectureOverviewStats,
  type ArchitectureOverviewModel,
} from './architecture-overview-model.js';

export {
  summarizeArchitectureIR,
  getArchitectureIRView,
  type ArchitectureIRSourceTag,
  type ArchitectureIRElementKind,
  type ArchitectureIRRelationshipKind,
  type ArchitectureIRViewKind,
  type ArchitectureIRMermaidSectionKind,
  type ArchitectureIREvidence,
  type ArchitectureIRElement,
  type ArchitectureIRRelationship,
  type ArchitectureIRView,
  type ArchitectureIRStats,
  type ArchitectureIR,
  type ArchitectureIRMermaidSection,
  type ArchitectureIRMermaidExport,
  type ArchitectureIRExportBundle,
} from './architecture-ir-model.js';

export {
  summarizeComponentView,
  summarizeDynamicScenarios,
  compareConfidence,
  maxConfidence,
  minConfidence,
  dedupeComponentEvidence,
  type ComponentConfidence,
  type ComponentEvidenceSourceType,
  type ComponentCategory,
  type ComponentMethodKind,
  type ComponentRelationshipKind,
  type DynamicScenarioCategory,
  type ComponentEvidenceRef,
  type ComponentMethodRef,
  type ComponentDescriptor,
  type ComponentRelationship,
  type ComponentGroup,
  type ComponentViewStats,
  type ComponentViewModel,
  type ComponentViewOutput,
  type DynamicScenarioStep,
  type DynamicScenario,
  type DynamicScenarioStats,
  type DynamicScenarioModel,
  type DynamicScenariosOutput,
} from './component-view-model.js';

export {
  determineDocsQualityStatus,
  dedupeProvenanceEntries,
  normalizeConfidence,
  summarizeDocsQualityStats,
  summarizeProvenanceRecord,
  summarizeProvenanceSection,
  type BundleCoverageStatus,
  type ConflictRecord,
  type ConflictSeverity,
  type ConflictSourceRef,
  type DocsQualityReport,
  type DocsQualityStats,
  type DocsQualityStatus,
  type DocumentProvenanceRecord,
  type DocumentProvenanceSection,
  type ProvenanceEntry,
  type ProvenanceSourceType,
  type QualityConfidence,
  type QualityCoverage,
  type RequiredDocCoverage,
  type RequiredDocRule,
  type RequiredDocStatus,
} from './docs-quality-model.js';

export {
  loadStoredModuleSpecs,
  parseStoredModuleSpec,
  extractStoredSpecFrontmatter,
  extractStoredSpecSectionSummary,
  summarizeStoredMarkdown,
  extractStoredBaselineSkeleton,
  normalizeStoredProjectPath,
  stripYamlScalar,
  type StoredModuleSpecRecord,
} from './stored-module-specs.js';

export { buildArchitectureIR, type BuildArchitectureIROptions } from './architecture-ir-builder.js';
export { exportArchitectureIRJson, exportArchitectureIRStructurizrDsl } from './architecture-ir-exporters.js';
export { buildArchitectureIRMermaidExport } from './architecture-ir-mermaid-adapter.js';

export {
  MINIMUM_PATTERN_CONFIDENCE,
  DEFAULT_PATTERN_KNOWLEDGE_BASE,
  evaluatePatternHints,
  buildPatternExplanation,
  type PatternEvaluationResult,
} from './pattern-knowledge-base.js';

export {
  createPatternEvidenceRef,
  determinePatternMatchLevel,
  summarizePatternHints,
  getHighConfidencePatternHints,
  dedupePatternEvidence,
  clampConfidence,
  type PatternEvidenceSource,
  type PatternMatchLevel,
  type PatternEvidenceRef,
  type PatternAlternative,
  type PatternHint,
  type PatternHintStats,
  type PatternHintsModel,
  type PatternHintsInput,
  type PatternHintsOutput,
  type PatternSignalRule,
  type PatternKnowledgeBaseEntry,
} from './pattern-hints-model.js';

// Parser 实现 + 类型
export * from './parsers/index.js';

// ProjectContext 构建
export { buildProjectContext } from './project-context.js';

// 基类和工具
export { AbstractRegistry } from './abstract-registry.js';
export { loadTemplate, resetTemplateCache } from './utils/template-loader.js';
export { sanitizeMermaidId } from './utils/mermaid-helpers.js';
export { enrichFieldDescriptions, enrichConfigDescriptions } from './utils/llm-enricher.js';
export {
  writeMultiFormat,
  type WriteMultiFormatOptions,
  type AdditionalOutputFile,
} from './utils/multi-format-writer.js';
