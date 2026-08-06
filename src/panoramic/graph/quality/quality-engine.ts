/**
 * F217 五项结构指标聚合器（quality-engine）。
 *
 * 聚合 duplicate-canonical-id / contains-coverage / dangling-edge / legacy-ignored /
 * orphan-ratio 五项**纯结构指标**（不含 freshness——freshness 是第六个独立判定域，
 * 由 CLI 层读取 sourceCommit 后单独计算，与本聚合结果一起组装成完整六字段
 * GraphQualityReport，见 quality-types.ts）。
 *
 * 本模块**自身**不做 I/O：所有需要外部信息的判定均通过 opts 注入的回调完成
 * （isIgnored 来自 ignore-oracle.ts，getTestPatterns 来自 CLI 层的 LanguageAdapterRegistry 查找）。
 *
 * ⚠️ F258 起**不再对注入回调假设纯粹性**（原文"纯函数，零 I/O"是无条件表述，已不成立）：
 * `isIgnored` 现在可能 spawn 子进程（`git check-ignore`）、带内部可变状态（记忆化 Map /
 * undeterminable 累加器 / L2 预算计时），因而**同一份 graph 连跑两次可能给出不同结果**
 * （预算耗尽、文件系统变化、未提交的忽略规则改动均会影响它）。
 *
 * 也就是说：本模块的输出是**相对于注入回调的**确定性，而不是绝对确定性。
 * 需要可重现结果的调用方（如快照测试）MUST 注入自己的确定性回调。
 */
import type { GraphJSON } from '../graph-types.js';
import { checkDuplicateCanonicalIds } from './duplicate-id-check.js';
import { checkContainsCoverage } from './contains-coverage-check.js';
import { checkDanglingEdges } from './dangling-edge-check.js';
import { checkLegacyAndIgnoredNodes } from './legacy-ignored-check.js';
import { checkOrphanRatio, type OrphanCheckOptions } from './orphan-check.js';
import type { GraphQualityReport } from './quality-types.js';

/** 五项结构指标聚合结果 + structuralVerdict（不含 freshness/graphPath/generatedAt 等 CLI 层字段）。 */
export type StructuralQualityResult = Pick<
  GraphQualityReport,
  | 'duplicateCanonicalId'
  | 'containsCoverage'
  | 'orphanRatio'
  | 'danglingEdges'
  | 'legacyAndIgnoredNodes'
> & {
  /**
   * 五项结构指标聚合出的整体判定（不含 freshness）。
   * CLI 层需再与 freshness 判定合并，计算完整六字段报告的 overallVerdict（FR-012 四态）。
   */
  structuralVerdict: 'pass' | 'pass-with-warnings' | 'fail-strong-invariant';
};

export interface RunGraphQualityChecksOptions {
  /** FR-008：判定节点源路径是否应被忽略（.gitignore / 内置 ignore 规则命中），由 ignore-oracle.ts 构造。 */
  isIgnored: (relativePath: string) => boolean;
  /** FR-005 test-export 例外：按 sourcePath 查找测试文件匹配模式，查不到适配器时返回 null。 */
  getTestPatterns: OrphanCheckOptions['getTestPatterns'];
}

/**
 * 聚合五项结构指标检测结果。
 *
 * structuralVerdict 优先级（高到低）：
 * 1. fail-strong-invariant：duplicateCanonicalId 或 danglingEdges 任一 fail（强不变量违反）
 * 2. pass-with-warnings：containsCoverage / orphanRatio / legacyAndIgnoredNodes 任一 fail
 * 3. pass：五项均无 fail
 */
export function runGraphQualityChecks(
  graph: GraphJSON,
  opts: RunGraphQualityChecksOptions,
): StructuralQualityResult {
  const duplicateCanonicalId = checkDuplicateCanonicalIds(graph);
  const containsCoverage = checkContainsCoverage(graph);
  const danglingEdges = checkDanglingEdges(graph);
  const legacyAndIgnoredNodes = checkLegacyAndIgnoredNodes(graph, opts.isIgnored);
  const orphanRatio = checkOrphanRatio(graph, { getTestPatterns: opts.getTestPatterns });

  const hasStrongFailure =
    duplicateCanonicalId.status === 'fail' || danglingEdges.status === 'fail';
  const hasWarning =
    containsCoverage.status === 'fail' ||
    orphanRatio.status === 'fail' ||
    legacyAndIgnoredNodes.status === 'fail';

  const structuralVerdict: StructuralQualityResult['structuralVerdict'] = hasStrongFailure
    ? 'fail-strong-invariant'
    : hasWarning
      ? 'pass-with-warnings'
      : 'pass';

  return {
    duplicateCanonicalId,
    containsCoverage,
    orphanRatio,
    danglingEdges,
    legacyAndIgnoredNodes,
    structuralVerdict,
  };
}
