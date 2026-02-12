/**
 * preuninstall 脚本
 * 全局卸载时清理 ~/.claude/skills/ 中已注册的 skill
 */

import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SKILL_NAMES = ['reverse-spec', 'reverse-spec-batch', 'reverse-spec-diff'] as const;

function main(): void {
  // 仅在全局卸载时执行
  if (process.env['npm_config_global'] !== 'true') {
    return;
  }

  const skillsTargetDir = join(homedir(), '.claude', 'skills');

  for (const skillName of SKILL_NAMES) {
    try {
      const targetDir = join(skillsTargetDir, skillName);
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
        console.log(`✓ 已清理: ~/.claude/skills/${skillName}/`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`⚠ 警告: 清理 ${skillName} 失败: ${message}`);
    }
  }

  console.log('reverse-spec skills 已从 Claude Code 注销');
}

main();
