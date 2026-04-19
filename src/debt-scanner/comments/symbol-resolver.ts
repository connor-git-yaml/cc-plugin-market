/**
 * 根据行号定位最近的 enclosing 符号名称。
 *
 * 输入：CodeSkeleton（特别是 exports 列表，每项含 startLine/endLine）
 * 输出：最近包含该行的符号名称，无则 null
 *
 * 解析策略：
 * 1. 在 exports 列表里找所有 [startLine, endLine] 包含 line 的条目
 * 2. 若多个嵌套（如 class > method），选择范围最小的那个（更具体）
 * 3. 对于 class：如果 members 有精确的行号（部分 mapper 可能未填），优先选用
 *    当前实现仅基于顶层 exports，足以满足 "最近符号" 的合理近似。
 */
import type { CodeSkeleton, ExportSymbol } from '../../models/code-skeleton.js';

/**
 * 返回最近包围 line 的 export 符号名称。
 */
export function resolveEnclosingSymbol(
  skeleton: CodeSkeleton | null,
  line: number,
): string | null {
  if (!skeleton) return null;
  let best: ExportSymbol | null = null;
  for (const exp of skeleton.exports) {
    if (line >= exp.startLine && line <= exp.endLine) {
      // 选择行范围最小的（最内层嵌套）
      if (!best || exp.endLine - exp.startLine < best.endLine - best.startLine) {
        best = exp;
      }
    }
  }
  return best ? best.name : null;
}
