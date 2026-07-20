/**
 * F217 FR-003/004：受支持 symbol 节点的 contains 覆盖率检测。
 *
 * 分母：`metadata.unifiedKind === 'symbol'` 的节点数
 * 分子：存在至少一条 contains 入边（作为 link.target 且 relation==='contains'）的节点数
 * 分母为 0 时判定为 not-applicable（避免除零/误报）。
 * 纯函数，零 I/O。
 */
import type { GraphJSON } from '../graph-types.js';
import type { GraphQualityReport } from './quality-types.js';

export function checkContainsCoverage(graph: GraphJSON): GraphQualityReport['containsCoverage'] {
  const symbolNodes = graph.nodes.filter((n) => n.metadata?.['unifiedKind'] === 'symbol');
  const total = symbolNodes.length;

  if (total === 0) {
    return { status: 'not-applicable', total: 0, covered: 0, ratio: null, uncoveredIds: [] };
  }

  const coveredIds = new Set<string>();
  for (const link of graph.links) {
    if (link.relation === 'contains') coveredIds.add(link.target);
  }

  let covered = 0;
  const uncoveredIds: string[] = [];
  for (const node of symbolNodes) {
    if (coveredIds.has(node.id)) {
      covered += 1;
    } else {
      uncoveredIds.push(node.id);
    }
  }
  uncoveredIds.sort();

  return {
    status: uncoveredIds.length === 0 ? 'pass' : 'fail',
    total,
    covered,
    ratio: covered / total,
    uncoveredIds,
  };
}
