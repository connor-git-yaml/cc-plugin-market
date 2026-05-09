/**
 * UnifiedGraph schema — Feature 151 关键路径基建。
 *
 * 4 语言 Knowledge Graph 共享抽象层的核心 schema：
 * - UnifiedNode：统一节点（module / symbol / spec / component / etc.）
 * - UnifiedEdge：统一边（calls / depends-on / contains / cross-module / documents / ...）
 * - UnifiedGraph：顶层装配（nodes + edges + metadata）
 * - CallSite：函数调用点的原始记录（mapper 阶段产出，call-resolver 阶段消费）
 *
 * 关键设计决策（CL-01 / CL-07 / Codex C-1 / Codex C-3）：
 * - CallSite 不携带 confidence 字段，confidence 在 call-resolver 阶段统一计算
 * - UnifiedEdge.directional?: boolean — calls / depends-on / cross-module / contains 必须 true，
 *   覆盖 GraphJSON.directed 全局开关，让 GraphQueryEngine 邻接表按 edge-level 决策
 * - UnifiedGraph 同时包含 calls 与 depends-on 边；Feature 156 W1.4 起所有 17 consumer
 *   统一通过 buildUnifiedGraph + deriveModuleGraph（src/knowledge-graph/module-derivation.ts）
 *   消费 ModuleGraph 视图，不再走 dependency-cruiser 路径
 */
import { z } from 'zod';

// ───────────────────────────────────────────────────────────
// CallSite — Python adapter 抽取的函数调用点（CL-01 schema）
//
// **Codex P0 W-2 修订** — CallSite 的 schema 真正定义在 src/models/call-site.ts，
// 本模块从 models 层 re-export 以保持 DAG 方向（models → knowledge-graph）。
// CodeSkeleton.ts 现在直接从 models 层 import，不再反向依赖。
// ───────────────────────────────────────────────────────────

export {
  CalleeKindSchema,
  CallSiteSchema,
  type CalleeKind,
  type CallSite,
} from '../models/call-site.js';

// ───────────────────────────────────────────────────────────
// ConfidenceTier — 内部 UnifiedGraph 的 confidence 三档
// ───────────────────────────────────────────────────────────

/**
 * 内部 UnifiedGraph 使用的 confidence 三档枚举。
 *
 * 注意：GraphJSON 输出层映射到现有 EXTRACTED / INFERRED / AMBIGUOUS enum
 * （由 confidence-mapper.ts mapTierToConfidence 函数完成 1:1 转换）。
 *
 * 双轨设计动机（CL-08）：
 * - high/medium/low 偏向"解析确定度"语义（对 call-resolver 直观）
 * - EXTRACTED/INFERRED/AMBIGUOUS 偏向"证据质量"（对 graph 消费者直观）
 * - 强制内部统一会污染 resolver 表达
 */
export const ConfidenceTierSchema = z.enum(['high', 'medium', 'low']);
export type ConfidenceTier = z.infer<typeof ConfidenceTierSchema>;

// ───────────────────────────────────────────────────────────
// UnifiedNode / UnifiedEdge / UnifiedGraph
// ───────────────────────────────────────────────────────────

/**
 * 节点种类枚举（**Codex P0 C-3 修订**）。
 *
 * 与 `src/panoramic/graph/graph-types.ts` 的 `GraphNode.kind` 范围严格对齐，
 * 便于 graph-builder 在 GraphJSON 序列化时不出现 schema drift。
 * 额外新增 `symbol`（UnifiedGraph 内部需要 function/class 级粒度，panoramic GraphNode 不区分）。
 */
export const UnifiedNodeKindSchema = z.enum([
  'module',
  'package',
  'component',
  'service',
  'spec',
  'document',
  'api',
  'api-schema',
  'event',
  'diagram',
  // UnifiedGraph 内部独有 — function/class/method 级符号节点
  'symbol',
]);
export type UnifiedNodeKind = z.infer<typeof UnifiedNodeKindSchema>;

/**
 * UnifiedNode — 4 语言共享的统一节点表示。
 *
 * `id` 约定：`<filePath>::<symbolName>` 或纯 `<filePath>` 表示模块节点。
 * `metadata` 字段允许各 producer 注入扩展数据（如 callSitesCount，由 graph-builder 在 §3.6 注入，Codex C-4）。
 */
export const UnifiedNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: UnifiedNodeKindSchema,
  language: z.string().optional(),
  filePath: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UnifiedNode = z.infer<typeof UnifiedNodeSchema>;

/**
 * UnifiedEdge 关系枚举。
 *
 * 与 panoramic/graph/graph-types.ts 的 GraphEdge.relation 兼容（含本 Feature 新增的 'calls'）。
 */
export const UnifiedEdgeRelationSchema = z.enum([
  // 本 Feature 新增
  'calls',
  // 既有
  'depends-on',
  'cross-module',
  'contains',
  'documents',
  'references',
  'conceptually_related_to',
  'rationale_for',
  'groups',
  'deploys',
]);
export type UnifiedEdgeRelation = z.infer<typeof UnifiedEdgeRelationSchema>;

/**
 * UnifiedEdge — 统一边。
 *
 * `directional` 字段（CL-07 + Codex C-1）：
 * - calls / depends-on / cross-module / contains 必须 true（语义有方向）
 * - conceptually_related_to / references 等对称关系默认 false
 * - GraphQueryEngine 邻接表按 edge.directional 判定双向 / 单向（不再依赖全局 GraphJSON.directed）
 *
 * `weight` 字段：可选数值，graph-builder 算分时使用。
 *
 * `evidence` 字段：自由文本注释，用于 debug 与 trace（W1.0 v2 / WARN-3 修订：
 * 不再编码 importType 前缀，保持纯净 specifier，避免污染 panoramic 消费方）。
 *
 * `metadata` 字段：producer 注入的扩展结构化数据（如 importType / callSitesCount），
 * 与 UnifiedNode.metadata 对应（Codex C-4 + Feature 156 W1.0 v2 / WARN-3 关闭）。
 */
export const UnifiedEdgeSchema = z
  .object({
    source: z.string().min(1),
    target: z.string().min(1),
    relation: UnifiedEdgeRelationSchema,
    confidence: ConfidenceTierSchema,
    directional: z.boolean().optional(),
    evidence: z.string().optional(),
    weight: z.number().nonnegative().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  // **Codex P0 W-1 修订** — 强制 calls / depends-on / cross-module / contains 必须是
  // directional=true（缺省也按 true 处理；显式 false 视为合同违反，零容忍）
  .superRefine((edge, ctx) => {
    const mustDirectional = (
      ['calls', 'depends-on', 'cross-module', 'contains'] as const
    ).includes(edge.relation as 'calls' | 'depends-on' | 'cross-module' | 'contains');
    if (mustDirectional && edge.directional === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['directional'],
        message: `relation "${edge.relation}" 必须 directional=true（不允许显式 false，违反 EC-11 / CL-07 合同）`,
      });
    }
  });
export type UnifiedEdge = z.infer<typeof UnifiedEdgeSchema>;

/**
 * UnifiedGraph metadata。
 *
 * `schemaVersion` 字段为后续 Feature 156 sqlite 持久化迁移留 anchor。
 */
export const UnifiedGraphMetadataSchema = z.object({
  generatedAt: z.string().datetime(),
  projectRoot: z.string().min(1),
  schemaVersion: z.string().regex(/^\d+\.\d+$/),
});
export type UnifiedGraphMetadata = z.infer<typeof UnifiedGraphMetadataSchema>;

/**
 * UnifiedGraph — 顶层装配。
 *
 * Codex C-3 修订：buildUnifiedGraph 同时产出 calls 与 depends-on 边，
 * 供 ModuleGraph 派生 import 视图（不再要求另起 import-edge 数据源）。
 */
export const UnifiedGraphSchema = z.object({
  nodes: z.array(UnifiedNodeSchema),
  edges: z.array(UnifiedEdgeSchema),
  metadata: UnifiedGraphMetadataSchema,
});
export type UnifiedGraph = z.infer<typeof UnifiedGraphSchema>;

// ───────────────────────────────────────────────────────────
// 辅助：directional 默认值规则（与 EC-11 / CL-07 一致）
// ───────────────────────────────────────────────────────────

const DIRECTIONAL_RELATIONS: ReadonlySet<UnifiedEdgeRelation> = new Set<UnifiedEdgeRelation>([
  'calls',
  'depends-on',
  'cross-module',
  'contains',
]);

/**
 * 给定 relation 计算其默认 directional 值。
 *
 * 用于 producer 构造 UnifiedEdge 时不显式传 directional 的兜底；
 * 也用于 GraphQueryEngine 在 edge.directional === undefined 时回退判定。
 */
export function defaultDirectionalForRelation(relation: UnifiedEdgeRelation): boolean {
  return DIRECTIONAL_RELATIONS.has(relation);
}

/**
 * 当前 UnifiedGraph schema 版本号。
 * 升级 schema 时需同步更新此常量并迁移 fixture / persistence 层。
 */
export const UNIFIED_GRAPH_SCHEMA_VERSION = '1.0';
