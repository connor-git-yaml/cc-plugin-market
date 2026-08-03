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

// F249 collector fingerprint：计算/校验/比较 API 与 behaviorVersion 契约（FR-008/W-06）
// 经本 barrel 暴露，与 buildKnowledgeGraph/GraphQueryEngine 保持同一消费入口
export {
  BEHAVIOR_VERSION,
  BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES,
  computeCollectorFingerprint,
  fingerprintsEqual,
  isValidCollectorFingerprint,
  parseCollectorFingerprint,
} from './collector-fingerprint.js';
export type {
  BehaviorVersionBumpResponsibility,
  CollectorExtensionSurface,
  CollectorExtensionSurfaceEntry,
  CollectorFingerprint,
} from './collector-fingerprint.js';
