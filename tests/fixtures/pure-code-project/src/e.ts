/**
 * 纯代码项目 fixture - 模块 E
 * 用于测试零 markdown 文件时的降级行为
 */

/** 日志记录类型 */
export type LogLevel = 'info' | 'warn' | 'error';

/** 记录日志 */
export function log(level: LogLevel, message: string): void {
  console[level](`[${level.toUpperCase()}] ${message}`);
}

/** 格式化时间戳 */
export function formatTimestamp(date: Date): string {
  return date.toISOString();
}
