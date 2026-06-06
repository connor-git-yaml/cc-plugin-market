// graph 模块统一导出入口，供 batch-orchestrator 和 CLI 使用

// 类型定义
export type { ConfidenceLevel, GraphNode, GraphEdge, GraphJSON, BuildGraphOptions } from './graph-types.js';

// 构建函数
export { buildKnowledgeGraph, writeKnowledgeGraph, enrichNodeDegrees, normalizeGraphForWrite } from './graph-builder.js';
export type { NormalizeGraphOptions } from './graph-builder.js';

// 映射函数与常量
export { CONFIDENCE_SCORES, mapDocConfidence, mapEvidenceConfidence } from './confidence-mapper.js';

// 图谱查询引擎与结果类型
export { GraphQueryEngine } from './graph-query.js';
export type { QueryResult, NodeResult, PathResult, CommunityResult, GodNodesResult } from './graph-query.js';
