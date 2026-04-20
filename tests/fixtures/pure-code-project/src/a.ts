/**
 * 纯代码项目 fixture - 模块 A
 * 用于测试零 markdown 文件时的降级行为（FR-015 AC-005）
 */

/** 初始化模块 A */
export function initModuleA(): void {
  console.log('Module A initialized');
}

/** 处理数据并返回结果 */
export function processDataA(input: string): string {
  return input.trim().toUpperCase();
}
