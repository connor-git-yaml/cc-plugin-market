/**
 * F217 FR-005：source symbol orphan 比例检测。
 *
 * orphan 定义：degree 为 0（不带任何 relation 的边，contains 边也计入判定）的
 * symbol 节点（`metadata.unifiedKind === 'symbol'`）。
 * 比例 = 未落入例外分类的 orphan symbol 数 / symbol 节点总数，≤5% 判定 pass。
 * 三类例外（entrypoint / pure-type / test-export）不计入超标分子，单独计数展示。
 * 分母为 0 时判定为 not-applicable。
 *
 * 纯函数，零 I/O——test-export 判定所需的 LanguageAdapter.getTestPatterns() 结果
 * 由调用方通过 opts.getTestPatterns 回调注入（查不到适配器时返回 null，本函数据此
 * 保守失败，不归为 test-export 例外）。
 */
import type { GraphJSON, GraphNode } from '../graph-types.js';
import { parseCanonicalSymbolId } from '../../../knowledge-graph/relativize.js';
import type { GraphQualityReport, OrphanExceptionCategory } from './quality-types.js';

/** orphan-check 所需的测试文件匹配模式（与 LanguageAdapter.TestPatterns 结构对齐）。 */
export interface OrphanCheckTestPatterns {
  filePattern: RegExp;
  testDirs: readonly string[];
}

export interface OrphanCheckOptions {
  /**
   * 按节点 sourcePath 查找对应语言的测试文件匹配模式。
   * 查不到适配器（如扩展名未注册）时返回 null——保守失败，不归为 test-export 例外
   * （宁可"漏判 pass"也不"误判"，避免臆造）。
   */
  getTestPatterns: (sourcePath: string) => OrphanCheckTestPatterns | null;
}

/** 统计每个节点 id 的 degree（作为 source 或 target 出现的边总数，含 contains）。 */
function computeDegrees(graph: GraphJSON): Map<string, number> {
  const degree = new Map<string, number>();
  const bump = (id: string): void => {
    degree.set(id, (degree.get(id) ?? 0) + 1);
  };
  for (const link of graph.links) {
    bump(link.source);
    bump(link.target);
  }
  return degree;
}

/** 节点的源文件路径：优先 metadata.sourcePath，缺失时退回 canonical id 的 file part。 */
function nodeSourcePath(node: Readonly<GraphNode>): string {
  const sourcePath = node.metadata?.['sourcePath'];
  if (typeof sourcePath === 'string' && sourcePath.length > 0) return sourcePath;
  return parseCanonicalSymbolId(node.id).filePart;
}

/** entrypoint 例外：文件级启发式，严格按 FR-005 字面枚举，不臆造语言专属规则。 */
const ENTRYPOINT_BASENAME_PATTERN = /^(main\..+|index\..+|__init__\.py)$/;

function isEntrypoint(sourcePath: string): boolean {
  const basename = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  return ENTRYPOINT_BASENAME_PATTERN.test(basename);
}

/** pure-type 例外：metadata.exportKind 为 interface / type（决策 2 增补的透传字段）。 */
function isPureType(node: Readonly<GraphNode>): boolean {
  const exportKind = node.metadata?.['exportKind'];
  return exportKind === 'interface' || exportKind === 'type';
}

/**
 * test-export 例外匹配：filePattern 命中 basename，或路径命中 testDirs 之一——
 * 与 secret-redactor.ts::isTestFile 既有 OR 语义对齐。
 *
 * testDirs 条目本身可以是单段（如 `__tests__`）或多段路径（如 Java 的
 * `src/test/java`）——统一按"路径根前缀"或"路径中间任意段序列"两种方式匹配，
 * 而非简单按单个路径 segment 相等比较（否则多段 testDirs 永远不可能命中）。
 */
function matchesTestPatterns(sourcePath: string, patterns: OrphanCheckTestPatterns): boolean {
  const normalizedPath = sourcePath.replace(/\\/g, '/');
  const basename = normalizedPath.split('/').pop() ?? normalizedPath;
  if (patterns.filePattern.test(basename)) return true;

  return patterns.testDirs.some((dir) => {
    const normalizedDir = dir.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalizedDir.length === 0) return false;
    return (
      normalizedPath === normalizedDir ||
      normalizedPath.startsWith(`${normalizedDir}/`) ||
      normalizedPath.includes(`/${normalizedDir}/`)
    );
  });
}

export function checkOrphanRatio(
  graph: GraphJSON,
  opts: OrphanCheckOptions,
): GraphQualityReport['orphanRatio'] {
  const degree = computeDegrees(graph);
  const symbolNodes = graph.nodes.filter((n) => n.metadata?.['unifiedKind'] === 'symbol');
  const totalSymbolNodes = symbolNodes.length;

  // 全节点级 zero-degree 率（信息展示，FR-005 附带要求，不参与本项 pass/fail）
  const totalNodes = graph.nodes.length;
  const allZeroDegreeCount = graph.nodes.filter((n) => (degree.get(n.id) ?? 0) === 0).length;
  const allNodeZeroDegreeRatio = totalNodes === 0 ? 0 : allZeroDegreeCount / totalNodes;

  if (totalSymbolNodes === 0) {
    return {
      status: 'not-applicable',
      totalSymbolNodes: 0,
      rawOrphanCount: 0,
      exemptedByCategory: { entrypoint: 0, 'pure-type': 0, 'test-export': 0 },
      offendingRatio: null,
      offendingIds: [],
      allNodeZeroDegreeRatio,
    };
  }

  const exemptedByCategory: Record<OrphanExceptionCategory, number> = {
    entrypoint: 0,
    'pure-type': 0,
    'test-export': 0,
  };
  const offendingIds: string[] = [];
  let rawOrphanCount = 0;

  for (const node of symbolNodes) {
    if ((degree.get(node.id) ?? 0) !== 0) continue;
    rawOrphanCount += 1;

    const sourcePath = nodeSourcePath(node);
    if (isEntrypoint(sourcePath)) {
      exemptedByCategory.entrypoint += 1;
      continue;
    }
    if (isPureType(node)) {
      exemptedByCategory['pure-type'] += 1;
      continue;
    }
    const testPatterns = opts.getTestPatterns(sourcePath);
    if (testPatterns && matchesTestPatterns(sourcePath, testPatterns)) {
      exemptedByCategory['test-export'] += 1;
      continue;
    }
    offendingIds.push(node.id);
  }

  offendingIds.sort();
  const offendingRatio = offendingIds.length / totalSymbolNodes;

  return {
    status: offendingRatio <= 0.05 ? 'pass' : 'fail',
    totalSymbolNodes,
    rawOrphanCount,
    exemptedByCategory,
    offendingRatio,
    offendingIds,
    allNodeZeroDegreeRatio,
  };
}
