/**
 * 多模态提取模块公开 API（Feature 107）
 * 导出 runExtractionPipeline 函数及关键类型
 */

export { runExtractionPipeline } from './extraction-pipeline.js';
export type { ExtractionPipelineOptions } from './extraction-pipeline.js';

export type {
  ExtractionResult,
  ExtractedNode,
  ExtractedEdge,
  ArtifactKind,
  ExtractedNodeKind,
} from './extraction-types.js';
