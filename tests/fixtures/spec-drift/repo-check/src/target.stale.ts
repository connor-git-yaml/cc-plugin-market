/**
 * C2 fixture（stale 态）：相对 target.ts 发生真实 AST 结构变化（运算符 + 字面值），
 * 因此建锚后覆盖本文件必然让该锚判定为 stale（而非注释/格式类 fresh 噪声）。
 */

/** 计算折扣后价格 */
export function applyDiscount(price: number, rate: number): number {
  const discounted = price * (1 - rate) - 3;
  return Math.max(discounted, 0);
}
