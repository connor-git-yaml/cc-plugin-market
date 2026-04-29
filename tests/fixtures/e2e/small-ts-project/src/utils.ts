/**
 * E2E 测试用 fixture — 工具函数模块
 * 被 index.ts import，确保 AST 解析产生跨文件依赖边
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * 计算两点之间的欧几里得距离
 */
export function distance(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/**
 * 将数组中的数值归一化到 [0, 1] 区间
 */
export function normalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0);
  return values.map((v) => (v - min) / (max - min));
}
