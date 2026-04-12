/**
 * install 子命令 handler
 * 薄包装层：调用 hook-installer 和 git-hook-installer，处理错误输出
 */

import { execSync } from 'node:child_process';
import type { CLICommand } from '../utils/parse-args.js';
import { installClaudeHook, removeClaudeHook } from '../../hooks/hook-installer.js';
import { installGitHook, removeGitHook } from '../../hooks/git-hook-installer.js';
import { printError } from '../utils/error-handler.js';

/**
 * 检测项目根目录
 * 优先使用 git 仓库根目录；非 git 仓库时 fallback 到 cwd
 */
function detectProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

/**
 * 执行 install 子命令
 * 根据 --remove 和 --git 参数分别调用安装/卸载函数
 */
export function runInstall(command: CLICommand): void {
  const projectRoot = detectProjectRoot();
  try {
    if (command.installRemove) {
      // 卸载模式：先卸载 Claude hook，再卸载 git hook（若 --git）
      removeClaudeHook(projectRoot);
      if (command.installGit) {
        removeGitHook(projectRoot);
      }
    } else {
      // 安装模式：先安装 Claude hook，再安装 git hook（若 --git）
      installClaudeHook(projectRoot);
      if (command.installGit) {
        installGitHook(projectRoot);
      }
    }
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
