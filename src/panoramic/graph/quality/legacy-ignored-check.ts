/**
 * F217 FR-007/008：遗留 `#` symbol 节点 + ignored 路径节点检测。
 *
 * - FR-007：复用既有 isLegacySymbolNode（graph-query.ts:178，F214 权威判定，CONSTRAINT-007
 *   要求不重复实现）
 * - FR-008：通过注入的 isIgnored(relativePath) 回调判定节点是否源自应被排除的路径
 *   （.gitignore / 内置 ignore 规则命中），回调由调用方基于 ignore-oracle.ts 构造并注入。
 *
 * ⚠️ F258 起本函数**自身**仍不做 I/O，但**不再对注入回调假设纯粹性**（原文"本函数保持零 I/O
 * 纯函数"是无条件表述，已不成立）：`isIgnored` 可能 spawn `git check-ignore` 子进程、带内部
 * 可变状态（记忆化 / 不可判计数 / L2 预算），同一份 graph 连跑两次可能给出不同的
 * `ignoredPathNodeIds`。输出是**相对于注入回调的**确定性；需要可重现结果的调用方 MUST 注入
 * 自己的确定性回调。
 *
 * 三态收敛在 oracle 内部完成：`undeterminable` ⇒ 按 `not-ignored` 处理 ⇒ **不计入违规**。
 * 保守方向的理由：本维度是 fail 判据，把"判不了"当违规等于让任何存在离盘不可判节点的仓库
 * 把环境噪声变成红门；且必须与采集面**同向**，否则会出现"采集器合法收了、门却判违规"的自相
 * 矛盾。诊断经 `createIgnoreOracle().drainUndeterminable()` 独立取回，不静默。
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
