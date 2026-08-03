// #1 tsjsSkeletonWalk 样本（.ts）。同时是 module-only/entry.mjs 的 import 目标，
// 使 b-track 的 moduleDerivationScan 面能产出一条可断言端点的真实依赖边。
export function foo(): string {
  return 'foo';
}
