/**
 * C1 端到端 fixture：含 top-level 具名导出函数，供 drift link/check/unlink 闭环使用。
 */

/** 计算两数之和 */
export function addNumbers(a: number, b: number): number {
  const total = a + b;
  return total;
}

/** 同文件 sibling symbol，用于验证改动它不影响 addNumbers 的锚 */
export function multiplyNumbers(a: number, b: number): number {
  return a * b;
}
