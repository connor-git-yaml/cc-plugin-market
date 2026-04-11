/**
 * @internal
 * panoramic 模块 — 内部 API 导出
 *
 * 本文件导出 panoramic 模块的内部实现类型、Generator 实现、
 * 细粒度模型类型和工具函数。
 * 这些符号 **不承诺外部 API 稳定性**，可能在任何版本中变更或移除。
 *
 * 仅供以下场景使用：
 *   - panoramic 模块内部子模块间引用
 *   - 测试文件（需要访问内部实现细节时）
 *
 * 外部代码请仅通过 index.ts 导入稳定公共 API。
 */

// ============================================================
// 核心接口和类型
// ============================================================

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

// ============================================================
// Registry（不含 bootstrap 函数）
// ============================================================

export { GeneratorRegistry, type GeneratorEntry } from './generator-registry.js';
export { ArtifactParserRegistry, type ParserEntry } from './parser-registry.js';

// ============================================================
// Generator 实现
// ============================================================

export { MockReadmeGenerator } from './generators/mock-readme-generator.js';
export { ConfigReferenceGenerator } from './generators/config-reference-generator.js';
export { DataModelGenerator } from './generators/data-model-generator.js';
export {
  ApiSurfaceGenerator,
  type ApiSource,
  type ApiParameterLocation,
  type ApiParameter,
  type ApiResponse,
  type ApiEndpoint,
  type ApiSurfaceInput,
  type ApiSurfaceOutput,
} from './api-surface/index.js';
export {
  InterfaceSurfaceGenerator,
  type InterfaceSurfaceRole,
  type InterfaceSurfaceSymbol,
  type InterfaceSurfaceModule,
  type InterfaceSurfaceInput,
  type InterfaceSurfaceOutput,
} from './generators/interface-surface-generator.js';
export {
  WorkspaceIndexGenerator,
  extractWorkspaceData,
  type WorkspacePackageInfo,
  type WorkspaceInput,
  type WorkspaceOutput,
  type WorkspaceGroup,
} from './generators/workspace-index-generator.js';

export {
  CrossPackageAnalyzer,
  type CrossPackageInput,
  type CrossPackageOutput,
  type TopologyLevel,
  type CycleGroup,
  type DependencyStats,
} from './generators/cross-package-analyzer.js';

export {
  RuntimeTopologyGenerator,
  type RuntimeTopologyInput,
  type RuntimeTopologyOutput,
} from './generators/runtime-topology-generator.js';

export {
  EventSurfaceGenerator,
  type EventRole,
  type EventChannelKind,
  type EventEvidence,
  type EventOccurrence,
  type EventChannel,
  type EventSurfaceInput,
  type EventSurfaceOutput,
} from './generators/event-surface-generator.js';

export {
  TroubleshootingGenerator,
  type TroubleshootingEntryKind,
  type TroubleshootingConfidence,
  type TroubleshootingLocation,
  type TroubleshootingEntry,
  type TroubleshootingExplanation,
  type TroubleshootingInput,
  type TroubleshootingOutput,
} from './generators/troubleshooting-generator.js';

export {
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
} from './pipelines/coverage-auditor.js';

export {
  ArchitectureOverviewGenerator,
  type ArchitectureOverviewInput,
  type ArchitectureOverviewOutput,
} from './generators/architecture-overview-generator.js';

export {
  ArchitectureIRGenerator,
  type ArchitectureIRInput,
  type ArchitectureIROutput,
} from './generators/architecture-ir-generator.js';

export {
  buildComponentView,
  renderComponentView,
  type BuildComponentViewOptions,
} from './builders/component-view-builder.js';

export {
  buildDynamicScenarios,
  renderDynamicScenarios,
  type BuildDynamicScenariosOptions,
} from './builders/dynamic-scenarios-builder.js';

export {
  PatternHintsGenerator,
  type PatternHintsGeneratorDependencies,
  type PatternHintsLLMEnhancer,
} from './generators/pattern-hints-generator.js';

export {
  generateBatchAdrDocs,
  type AdrSourceType,
  type AdrEvidenceRef,
  type AdrDraft,
  type AdrIndexOutput,
  type GenerateBatchAdrDocsOptions,
  type GenerateBatchAdrDocsResult,
} from './pipelines/adr-decision-pipeline.js';

export {
  generateProductUxDocs,
  type FeatureBrief,
  type FeatureBriefIndexOutput,
  type GenerateProductUxDocsOptions,
  type GenerateProductUxDocsResult,
  type ProductEvidenceRef,
  type ProductFactSourceType,
  type ProductOverviewOutput,
  type ProductScenario,
  type ProductUserSegment,
  type UserJourney,
  type UserJourneysOutput,
} from './pipelines/product-ux-docs.js';

export {
  evaluateDocsQuality,
  renderDocsQualityReport,
  type EvaluateDocsQualityOptions,
} from './pipelines/docs-quality-evaluator.js';

export {
  adaptArchitectureNarrativeProvenance,
  type AdaptNarrativeProvenanceOptions,
} from './pipelines/narrative-provenance-adapter.js';

export {
  readDocsBundleManifest,
  type BundleNavigationReference,
  type BundleProfileReference,
  type DocsBundleManifestReference,
  type ReadDocsBundleManifestResult,
} from './pipelines/docs-bundle-manifest-reader.js';

// ============================================================
// 模型层
// ============================================================

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
} from './models/runtime-topology-model.js';

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
} from './models/architecture-overview-model.js';

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
} from './models/architecture-ir-model.js';

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
} from './models/component-view-model.js';

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
} from './models/docs-quality-model.js';

// ============================================================
// Stored Module Specs
// ============================================================

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

// ============================================================
// Architecture IR 工具链
// ============================================================

export { buildArchitectureIR, type BuildArchitectureIROptions } from './builders/architecture-ir-builder.js';
export { exportArchitectureIRJson, exportArchitectureIRStructurizrDsl } from './exporters/architecture-ir-exporters.js';
export { buildArchitectureIRMermaidExport } from './builders/architecture-ir-mermaid-adapter.js';

// ============================================================
// Pattern Knowledge Base
// ============================================================

export {
  MINIMUM_PATTERN_CONFIDENCE,
  DEFAULT_PATTERN_KNOWLEDGE_BASE,
  evaluatePatternHints,
  buildPatternExplanation,
  type PatternEvaluationResult,
} from './models/pattern-knowledge-base.js';

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
} from './models/pattern-hints-model.js';

// ============================================================
// Docs Bundle（不含 orchestrateDocsBundle、DocsBundleProfileSummary — 由 index.ts 公共 API 层提供）
// ============================================================

export {
  buildDocsBundleInput,
} from './pipelines/docs-bundle-orchestrator.js';

export {
  getDocsBundleProfile,
  listDocsBundleProfiles,
} from './models/docs-bundle-profiles.js';

export {
  DOCS_BUNDLE_VERSION,
  DOCS_BUNDLE_MANIFEST_FILE,
  DOCS_BUNDLE_ROOT_DIR,
  type SourceDocumentKind,
  type BundleDocumentKind,
  type BundleProfileId,
  type SourceDocument,
  type ModuleSpecDocument,
  type DocsBundleInput,
  type BundleProfileDefinition,
  type BundleDocument,
  type BundleNavItem,
  type BundleProfileManifest,
  type DocsBundleManifest,
  type DocsBundleResult,
} from './models/docs-bundle-types.js';

// ============================================================
// Parser 实现 + 类型
// ============================================================

export * from './parsers/index.js';

// ============================================================
// 基类和工具（不含 loadTemplate — 由 index.ts 公共 API 层提供）
// ============================================================

export { AbstractRegistry } from './abstract-registry.js';
export { resetTemplateCache } from './utils/template-loader.js';
export { sanitizeMermaidId } from './utils/mermaid-helpers.js';
export { enrichFieldDescriptions, enrichConfigDescriptions } from './utils/llm-enricher.js';
export {
  writeMultiFormat,
  type WriteMultiFormatOptions,
  type AdditionalOutputFile,
} from './utils/multi-format-writer.js';
