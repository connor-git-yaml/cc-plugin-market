/**
 * postinstall 脚本
 * 全局安装时将 skill 注册到 ~/.claude/skills/
 * 复用 installer 模块的核心逻辑
 */

import { installSkills, resolveTargetDir } from '../installer/skill-installer.js';

function main(): void {
  // 仅在全局安装时执行
  if (process.env['npm_config_global'] !== 'true') {
    console.log('reverse-spec: 本地安装，跳过 skill 注册');
    return;
  }

  try {
    const targetDir = resolveTargetDir('global');
    const summary = installSkills({ targetDir, mode: 'global' });

    // 输出简化的注册信息
    for (const result of summary.results) {
      if (result.status === 'installed' || result.status === 'updated') {
        console.log(`✓ 已注册: ~/.claude/skills/${result.skillName}/SKILL.md`);
      } else if (result.status === 'failed') {
        console.warn(`⚠ 警告: 注册 ${result.skillName} 失败: ${result.error ?? '未知错误'}`);
      }
    }

    console.log('reverse-spec skills 已注册到 Claude Code');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠ 警告: skill 注册失败: ${message}`);
  }
}

main();
