/**
 * C2 fixture（fresh 基线态）：被 repo:check 第 13 检查族锚定的目标源文件。
 */

/** 计算折扣后价格 */
export function applyDiscount(price: number, rate: number): number {
  const discounted = price * (1 - rate);
  return discounted;
}
