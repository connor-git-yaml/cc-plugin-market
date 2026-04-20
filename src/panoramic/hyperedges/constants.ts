/**
 * Hyperedges 模块共享常量
 *
 * 将多处复用的常量集中到本文件，避免定义漂移（quality-review W-4）。
 */
import type { GraphNode } from '../graph/graph-types.js';

/**
 * 视为"文档类节点"的 kind 集合
 *
 * 这类节点不算"代码节点"，不参与 hyperedge 的代码节点语义校验。
 * 在生成 prompt 的 `availableCodeNodes` 列表时也会被过滤掉。
 *
 * 新增文档类节点 kind（如 `diagram`）时仅需修改本处。
 */
export const DOC_NODE_KINDS: ReadonlySet<GraphNode['kind']> = new Set<GraphNode['kind']>([
  'spec',
  'document',
]);
