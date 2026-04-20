/**
 * 纯代码项目 fixture - 模块 D
 * 用于测试零 markdown 文件时的降级行为
 */

/** 将数组分批处理 */
export function batchProcess<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/** 统计元素数量 */
export function countItems<T>(items: T[]): number {
  return items.length;
}
