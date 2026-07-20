/**
 * F217 FR-006：悬空边检测。
 *
 * edge 的 source 或 target 指向图中不存在的 node id 即为悬空边。
 * 纯函数，零 I/O。
 */
import type { GraphJSON } from '../graph-types.js';
import type { DanglingEdgeRecord, GraphQualityReport } from './quality-types.js';

export function checkDanglingEdges(graph: GraphJSON): GraphQualityReport['danglingEdges'] {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const edges: DanglingEdgeRecord[] = [];

  for (const link of graph.links) {
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) {
      edges.push({ source: link.source, target: link.target, relation: link.relation });
    }
  }

  return { status: edges.length === 0 ? 'pass' : 'fail', edges };
}
