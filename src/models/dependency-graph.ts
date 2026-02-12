/**
 * DependencyGraph 及相关嵌套实体的 Zod Schema 定义
 * 项目级模块依赖关系图，包含有向边、拓扑排序和 SCC 检测结果
 */
import { z } from 'zod';

// --- 枚举 ---

export const ImportTypeSchema = z.enum(['static', 'dynamic', 'type-only']);
export type ImportType = z.infer<typeof ImportTypeSchema>;

// --- 嵌套实体 ---

/** 依赖图模块节点 */
export const GraphNodeSchema = z.object({
  source: z.string().min(1),
  isOrphan: z.boolean(),
  inDegree: z.number().int().nonnegative(),
  outDegree: z.number().int().nonnegative(),
  level: z.number().int().nonnegative(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

/** 依赖边 */
export const DependencyEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  isCircular: z.boolean(),
  importType: ImportTypeSchema,
});
export type DependencyEdge = z.infer<typeof DependencyEdgeSchema>;

/** 强连通分量 (SCC) */
export const SCCSchema = z.object({
  id: z.number().int().nonnegative(),
  modules: z.array(z.string().min(1)).min(1),
});
export type SCC = z.infer<typeof SCCSchema>;

// --- 主实体 ---

/** 项目级模块依赖关系图 */
export const DependencyGraphSchema = z.object({
  projectRoot: z.string().min(1),
  modules: z.array(GraphNodeSchema),
  edges: z.array(DependencyEdgeSchema),
  topologicalOrder: z.array(z.string()),
  sccs: z.array(SCCSchema),
  totalModules: z.number().int().nonnegative(),
  totalEdges: z.number().int().nonnegative(),
  analyzedAt: z.string().datetime(),
  mermaidSource: z.string(),
});
export type DependencyGraph = z.infer<typeof DependencyGraphSchema>;
