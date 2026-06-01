/**
 * graph.json 路径 helper
 * 统一管理生产者（graph-builder.ts writeKnowledgeGraph）和消费者（query/export/mcp）之间的路径约定
 */

import * as path from 'node:path';

/**
 * 返回 graph.json 的默认路径（生产者/消费者统一约定）
 * 与生产者 `writeKnowledgeGraph` 保持一致：{cwd}/specs/_meta/graph.json
 *
 * @param cwd - 项目根目录绝对路径
 * @returns graph.json 的完整绝对路径
 */
export function resolveGraphJsonPath(cwd: string): string {
  return path.join(cwd, 'specs', '_meta', 'graph.json');
}

/**
 * 返回 GRAPH_REPORT.md 的默认路径（社区内聚度数据源）。
 * 与 graph.json 同目录约定：{root}/specs/_meta/GRAPH_REPORT.md
 *
 * @param root - 项目根目录绝对路径
 * @returns GRAPH_REPORT.md 的完整绝对路径
 */
export function resolveGraphReportPath(root: string): string {
  return path.join(root, 'specs', '_meta', 'GRAPH_REPORT.md');
}
