/**
 * F217 FR-007/008：遗留 `#` symbol 节点 + ignored 路径节点检测。
 *
 * - FR-007：复用既有 isLegacySymbolNode（graph-query.ts:178，F214 权威判定，CONSTRAINT-007
 *   要求不重复实现）
 * - FR-008：通过注入的 isIgnored(relativePath) 回调判定节点是否源自应被排除的路径
 *   （.gitignore / 内置 ignore 规则命中），回调由调用方基于 ignore-oracle.ts 构造并注入，
 *   本函数保持零 I/O 纯函数。
 */
import type { GraphJSON } from '../graph-types.js';
import { isLegacySymbolNode } from '../graph-query.js';
import { parseCanonicalSymbolId } from '../../../knowledge-graph/relativize.js';
import type { GraphQualityReport } from './quality-types.js';

export function checkLegacyAndIgnoredNodes(
  graph: GraphJSON,
  isIgnored: (relativePath: string) => boolean,
): GraphQualityReport['legacyAndIgnoredNodes'] {
  const legacyHashNodeIds: string[] = [];
  const ignoredPathNodeIds: string[] = [];

  for (const node of graph.nodes) {
    if (isLegacySymbolNode(node)) {
      legacyHashNodeIds.push(node.id);
    }
    const filePart = parseCanonicalSymbolId(node.id).filePart;
    if (isIgnored(filePart)) {
      ignoredPathNodeIds.push(node.id);
    }
  }

  legacyHashNodeIds.sort();
  ignoredPathNodeIds.sort();

  return {
    status: legacyHashNodeIds.length === 0 && ignoredPathNodeIds.length === 0 ? 'pass' : 'fail',
    legacyHashNodeIds,
    ignoredPathNodeIds,
  };
}
