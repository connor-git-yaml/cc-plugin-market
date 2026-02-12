/**
 * init 子命令入口
 * 安装/移除 reverse-spec skills
 */

import type { CLICommand } from '../utils/parse-args.js';
import {
  installSkills,
  removeSkills,
  resolveTargetDir,
  formatSummary,
} from '../../installer/skill-installer.js';

/**
 * 执行 init 命令
 */
export function runInit(command: CLICommand): void {
  const mode = command.global ? 'global' : 'project';
  const targetDir = resolveTargetDir(mode);

  if (command.remove) {
    const summary = removeSkills({ targetDir, mode });
    console.log(formatSummary(summary));

    // 全部失败时退出码为 1
    const allFailed = summary.results.every((r) => r.status === 'failed');
    if (allFailed && summary.results.some((r) => r.status === 'failed')) {
      process.exitCode = 1;
    }
  } else {
    const summary = installSkills({ targetDir, mode });
    console.log(formatSummary(summary));

    // 全部失败时退出码为 1
    const allFailed = summary.results.every((r) => r.status === 'failed');
    if (allFailed) {
      process.exitCode = 1;
    }
  }
}
