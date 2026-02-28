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
  type SkillTargetPlatform,
} from '../../installer/skill-installer.js';

/**
 * 执行 init 命令
 */
export function runInit(command: CLICommand): void {
  const mode = command.global ? 'global' : 'project';
  const platforms = resolvePlatforms(command.skillTarget);
  const summaries = platforms.map((platform) => {
    const targetDir = resolveTargetDir(mode, platform);
    if (command.remove) {
      return removeSkills({ targetDir, mode, platform });
    }
    return installSkills({ targetDir, mode, platform });
  });

  const output = summaries.map((summary) => formatSummary(summary)).join('\n\n');
  console.log(output);

  // 全目标平台均失败时退出码为 1
  const allFailed = summaries.every((summary) =>
    summary.results.every((r) => r.status === 'failed'),
  );
  if (allFailed) {
    process.exitCode = 1;
  }
}

function resolvePlatforms(
  target: CLICommand['skillTarget'],
): SkillTargetPlatform[] {
  if (target === 'both') {
    return ['claude', 'codex'];
  }
  return [target];
}
