/**
 * preuninstall 脚本
 * 全局卸载时清理 ~/.claude/skills/ 和/或 ~/.codex/skills/ 中已注册的 skill
 * 复用 installer 模块的核心逻辑
 */

import {
  removeSkills,
  resolveTargetDir,
  type SkillTargetPlatform,
} from '../installer/skill-installer.js';

function resolvePreUninstallTargets(): SkillTargetPlatform[] {
  const env = process.env['REVERSE_SPEC_SKILL_TARGET'];
  if (!env) {
    // 默认清理双端，避免遗留
    return ['claude', 'codex'];
  }

  const value = env.trim().toLowerCase();
  if (value === 'both') {
    return ['claude', 'codex'];
  }

  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const targets = new Set<SkillTargetPlatform>();
  for (const item of values) {
    if (item === 'claude' || item === 'codex') {
      targets.add(item);
    }
  }
  if (targets.size === 0) {
    console.warn(
      `⚠ 警告: REVERSE_SPEC_SKILL_TARGET=${env} 无效，回退清理双端（可选: claude, codex, both）`,
    );
    return ['claude', 'codex'];
  }
  return [...targets];
}

function main(): void {
  // 仅在全局卸载时执行
  if (process.env['npm_config_global'] !== 'true') {
    return;
  }

  try {
    const targets = resolvePreUninstallTargets();
    for (const platform of targets) {
      const targetDir = resolveTargetDir('global', platform);
      const summary = removeSkills({ targetDir, mode: 'global', platform });
      const rootDir = platform === 'codex' ? '.codex' : '.claude';
      const platformLabel = platform === 'codex' ? 'Codex' : 'Claude Code';

      for (const result of summary.results) {
        if (result.status === 'removed') {
          console.log(`✓ 已清理: ~/${rootDir}/skills/${result.skillName}/`);
        } else if (result.status === 'failed') {
          console.warn(`⚠ 警告: 清理 ${result.skillName} 失败: ${result.error ?? '未知错误'}`);
        }
      }
      console.log(`reverse-spec skills 已从 ${platformLabel} 注销`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠ 警告: skill 注销失败: ${message}`);
  }
}

main();
