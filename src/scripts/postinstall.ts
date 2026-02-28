/**
 * postinstall 脚本
 * 全局安装时将 skill 注册到 ~/.claude/skills/ 和/或 ~/.codex/skills/
 * 复用 installer 模块的核心逻辑
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  installSkills,
  resolveTargetDir,
  type SkillTargetPlatform,
} from '../installer/skill-installer.js';

function resolvePostInstallTargets(): SkillTargetPlatform[] {
  const env = process.env['REVERSE_SPEC_SKILL_TARGET'];
  if (env) {
    const parsed = parseTargets(env);
    if (parsed.length > 0) {
      return parsed;
    }
    console.warn(
      `⚠ 警告: REVERSE_SPEC_SKILL_TARGET=${env} 无效，回退自动检测（可选: claude, codex, both）`,
    );
  }

  const hasCodex = existsSync(join(homedir(), '.codex'));
  return hasCodex ? ['claude', 'codex'] : ['claude'];
}

function parseTargets(raw: string): SkillTargetPlatform[] {
  const value = raw.trim().toLowerCase();
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
  return [...targets];
}

function main(): void {
  // 仅在全局安装时执行
  if (process.env['npm_config_global'] !== 'true') {
    console.log('reverse-spec: 本地安装，跳过 skill 注册');
    return;
  }

  try {
    const targets = resolvePostInstallTargets();
    for (const platform of targets) {
      const targetDir = resolveTargetDir('global', platform);
      const summary = installSkills({ targetDir, mode: 'global', platform });
      const rootDir = platform === 'codex' ? '.codex' : '.claude';
      const platformLabel = platform === 'codex' ? 'Codex' : 'Claude Code';

      // 输出简化的注册信息
      for (const result of summary.results) {
        if (result.status === 'installed' || result.status === 'updated') {
          console.log(`✓ 已注册: ~/${rootDir}/skills/${result.skillName}/SKILL.md`);
        } else if (result.status === 'failed') {
          console.warn(`⚠ 警告: 注册 ${result.skillName} 失败: ${result.error ?? '未知错误'}`);
        }
      }

      console.log(`reverse-spec skills 已注册到 ${platformLabel}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠ 警告: skill 注册失败: ${message}`);
  }
}

main();
