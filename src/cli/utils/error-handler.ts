/**
 * CLI 错误处理工具
 * 友好的中文错误信息输出
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** 退出码定义 */
export const EXIT_CODES = {
  SUCCESS: 0,
  TARGET_ERROR: 1,
  API_ERROR: 2,
} as const;

/**
 * 验证目标路径是否存在
 * @returns 如果路径不存在则输出错误信息并返回 false
 */
export function validateTargetPath(target: string): boolean {
  const resolved = resolve(target);
  if (!existsSync(resolved)) {
    printError(`目标路径不存在: ${resolved}`);
    return false;
  }
  return true;
}

/**
 * 检查 ANTHROPIC_API_KEY 环境变量
 * @returns 如果缺失则输出错误信息并返回 false
 */
export function checkApiKey(): boolean {
  if (!process.env['ANTHROPIC_API_KEY']) {
    printError(
      '未设置 ANTHROPIC_API_KEY 环境变量\n' +
      '  请设置后重试: export ANTHROPIC_API_KEY=your-key-here',
    );
    return false;
  }
  return true;
}

/**
 * 处理运行时错误，输出友好信息
 */
export function handleError(err: unknown): number {
  if (err instanceof Error) {
    // API 相关错误
    if (err.message.includes('API') || err.message.includes('api_key') || err.message.includes('authentication')) {
      printError(`LLM API 错误: ${err.message}`);
      return EXIT_CODES.API_ERROR;
    }

    // 文件系统错误
    if ('code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      printError(`文件或目录不存在: ${err.message}`);
      return EXIT_CODES.TARGET_ERROR;
    }

    printError(err.message);
  } else {
    printError(`未知错误: ${String(err)}`);
  }
  return EXIT_CODES.API_ERROR;
}

/**
 * 输出错误信息到 stderr
 */
export function printError(message: string): void {
  console.error(`✗ 错误: ${message}`);
}

/**
 * 输出警告信息
 */
export function printWarning(message: string): void {
  console.warn(`⚠ 警告: ${message}`);
}
