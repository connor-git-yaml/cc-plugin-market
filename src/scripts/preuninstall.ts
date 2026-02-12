/**
 * preuninstall 脚本
 * 全局卸载时清理 ~/.claude/skills/ 中已注册的 skill
 * 复用 installer 模块的核心逻辑
 */

import { removeSkills, resolveTargetDir } from '../installer/skill-installer.js';

function main(): void {
  // 仅在全局卸载时执行
  if (process.env['npm_config_global'] !== 'true') {
    return;
  }

  try {
    const targetDir = resolveTargetDir('global');
    const summary = removeSkills({ targetDir, mode: 'global' });

    for (const result of summary.results) {
      if (result.status === 'removed') {
        console.log(`✓ 已清理: ~/.claude/skills/${result.skillName}/`);
      } else if (result.status === 'failed') {
        console.warn(`⚠ 警告: 清理 ${result.skillName} 失败: ${result.error ?? '未知错误'}`);
      }
    }

    console.log('reverse-spec skills 已从 Claude Code 注销');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠ 警告: skill 注销失败: ${message}`);
  }
}

main();
