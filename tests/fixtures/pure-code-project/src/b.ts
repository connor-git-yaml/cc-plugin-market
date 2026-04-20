/**
 * 纯代码项目 fixture - 模块 B
 * 用于测试零 markdown 文件时的降级行为
 */

/** 验证输入格式 */
export function validateInput(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

/** 格式化输出结果 */
export function formatOutput(data: string): string {
  return `[B]: ${data}`;
}
