/**
 * 多模态提取模块公开 API（Feature 107）
 * 导出 runExtractionPipeline 函数及关键类型
 */

export { runExtractionPipeline, findReadmePath } from './extraction-pipeline.js';
export type { ExtractionPipelineOptions, ExtractionPipelineOutput } from './extraction-pipeline.js';

export type {
  ExtractionResult,
  ExtractedNode,
  ExtractedEdge,
  ArtifactKind,
  ExtractedNodeKind,
} from './extraction-types.js';
