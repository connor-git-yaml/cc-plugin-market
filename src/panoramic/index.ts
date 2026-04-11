/**
 * panoramic 模块 — 公共 API 导出
 *
 * 仅包含经审计确认的 15 个稳定公共 API 符号。
 * 内部实现类型、Generator 实现、细粒度模型类型等请从 internal.ts 导入。
 */

// Registry 启动函数
export { bootstrapGenerators } from './generator-registry.js';
export { bootstrapParsers } from './parser-registry.js';

// 上下文构建
export { buildProjectContext } from './project-context.js';

// 覆盖率审计
export { CoverageAuditor } from './pipelines/coverage-auditor.js';

// 文档 Bundle 编排
export { orchestrateDocsBundle } from './pipelines/docs-bundle-orchestrator.js';
export type { DocsBundleProfileSummary } from './models/docs-bundle-types.js';

// 模板加载
export { loadTemplate } from './utils/template-loader.js';

// DocGraph、Spec 索引与批量生成（批量链路核心）
export {
  buildDocGraph,
  scanStoredModuleSpecs,
  resolveSpecForSource,
  type StoredModuleSpecSummary,
} from './builders/doc-graph-builder.js';

export { buildCrossReferenceIndex } from './cross-reference-index.js';

export {
  generateBatchProjectDocs,
  generateDocsQualityReport,
  type BatchProjectDocsResult,
} from './batch-project-docs.js';
