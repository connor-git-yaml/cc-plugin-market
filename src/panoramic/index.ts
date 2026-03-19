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

// Parser 实现 + 类型
export * from './parsers/index.js';

// ProjectContext 构建
export { buildProjectContext } from './project-context.js';

// 基类和工具
export { AbstractRegistry } from './abstract-registry.js';
export { loadTemplate, resetTemplateCache } from './utils/template-loader.js';
export { sanitizeMermaidId } from './utils/mermaid-helpers.js';
export { enrichFieldDescriptions, enrichConfigDescriptions } from './utils/llm-enricher.js';
export { writeMultiFormat, type WriteMultiFormatOptions } from './utils/multi-format-writer.js';
