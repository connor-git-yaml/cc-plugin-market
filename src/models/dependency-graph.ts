/**
 * DependencyGraph 及相关嵌套实体的 Zod Schema 定义
 * 项目级模块依赖关系图，包含有向边、拓扑排序和 SCC 检测结果
 *
 * Feature 151 T-006 — DependencyGraph consumer 清单（CL-02 + Codex C3 输入依据）：
 *
 * 生产方（producer）：
 *   - src/adapters/python-adapter.ts:222 PythonAdapter.buildDependencyGraph()
 *   - src/adapters/ts-js-adapter.ts:63 TsJsAdapter.buildDependencyGraph()
 *   - src/graph/dependency-graph.ts:59 buildDependencyGraph 主入口
 *   - src/graph/directory-graph.ts:33 directory-level 派生
 *
 * 消费方（consumer，按字段使用情况分组）：
 *   消费 modules + edges 字段（ID / 路径）：
 *     - src/batch/delta-regenerator.ts:48-51（edges[].from/to 增量重生成判定）
 *     - src/batch/module-grouper.ts（按 modules 路径划分批次）
 *     - src/batch/batch-orchestrator.ts:423-439（buildGraphForLanguageGroup 调用 adapter.buildDependencyGraph）
 *     - src/panoramic/builders/doc-graph-builder.ts:100,252,303（dependencyGraph 参数贯穿 spec 节点解析）
 *     - src/panoramic/generators/cross-package-analyzer.ts:48,139,283（跨包分析）
 *     - src/generator/index-generator.ts:29,47,133（README index 生成）
 *
 *   消费 SCC + topologicalOrder：
 *     - src/graph/topological-sort.ts:32 detectSCCs / topologicalSort
 *     - src/cli/commands/graph.ts（spectra graph / spectra community CLI 命令）
 *
 *   消费 mermaidSource：
 *     - src/graph/mermaid-renderer.ts:62 renderDependencyGraph（mermaid SVG 输出）
 *
 * Feature 151 shim 改造方向（T-014 输入，Codex C-2 修订）：
 *   维持本 schema 接口不变；PythonAdapter.buildDependencyGraph 内部从同一份 codeSkeleton
 *   通过 src/knowledge-graph/index.ts 的 deriveImportEdges 派生 import 子图，再装配
 *   modules / edges / SCC / topologicalOrder / mermaidSource 字段。不依赖 getCurrentUnifiedGraph
 *   全局 cache（cache 在 batch pipeline 早期为空）。
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
  /** 节点所属的编程语言（多语言图合并时使用） */
  language: z.string().optional(),
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
