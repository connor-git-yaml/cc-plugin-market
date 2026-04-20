/**
 * 纯代码项目 fixture - 模块 C
 * 用于测试零 markdown 文件时的降级行为
 */

/** 计算摘要信息 */
export function computeSummary(items: string[]): string {
  return items.join(', ');
}

/** 检查列表是否为空 */
export function isEmpty(items: string[]): boolean {
  return items.length === 0;
}
