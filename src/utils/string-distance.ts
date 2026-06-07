/**
 * 字符串距离工具（string-distance）
 *
 * 提供仓库内共享的纯函数编辑距离实现。原先 `levenshtein` 在
 * `src/knowledge-graph/query-helpers.ts`（F174 fuzzy 解析热路径）与
 * `src/panoramic/pipelines/adr-evidence-verifier.ts`（ADR 证据宽容匹配）两处逐字复制，
 * 注释自承"照搬"。Feature 178 合并为单一来源，两调用方 import，消除双写漂移风险。
 */

/**
 * Levenshtein 编辑距离 — 标准 DP 滚动数组实现（O(min(m,n)) 空间）。
 *
 * 选短的一边作内层循环、长的一边作外层，减小内层数组规模。
 * 纯函数：相同输入恒返回相同距离，不依赖任何外部状态。
 *
 * @param a 字符串 A
 * @param b 字符串 B
 * @returns 把 a 变换为 b 所需的最少单字符插入/删除/替换次数
 */
export function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const sm = shorter.length;
  const ln = longer.length;
  let prev: number[] = Array.from({ length: sm + 1 }, (_, i) => i);
  for (let i = 1; i <= ln; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= sm; j++) {
      const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1;
      curr.push(Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost));
    }
    prev = curr;
  }
  return prev[sm]!;
}
