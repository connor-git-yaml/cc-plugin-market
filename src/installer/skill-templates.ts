/**
 * spectra Skill 模板分发合同
 *
 * canonical source:
 *   plugins/spectra/skills/<skill>/SKILL.md
 *
 * compatibility mirrors:
 *   src/skills-global/<skill>/SKILL.md
 *   skills/<skill>/SKILL.md
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  SkillDefinition,
  SkillTargetPlatform,
} from './skill-installer.js';

const SPECTRA_SKILL_NAMES = [
  'spectra',
  'spectra-batch',
  'spectra-diff',
] as const;

function resolveRepoRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), '..', '..');
}

function resolveCanonicalSkillPath(skillName: string): string {
  return path.join(
    resolveRepoRoot(),
    'plugins',
    'spectra',
    'skills',
    skillName,
    'SKILL.md',
  );
}

function loadCanonicalSkillDefinition(skillName: string): SkillDefinition {
  const filePath = resolveCanonicalSkillPath(skillName);
  return {
    name: skillName,
    content: readFileSync(filePath, 'utf-8'),
  };
}

export const SKILL_DEFINITIONS: readonly SkillDefinition[] =
  SPECTRA_SKILL_NAMES.map((skillName) =>
    loadCanonicalSkillDefinition(skillName),
  );

/**
 * 获取指定平台的 Skill 定义集合
 * 当前保持 spectra 与 spec-driver 的安装边界隔离：
 * - spectra init 仅安装 spectra 三件套
 */
export function getSkillDefinitionsForPlatform(
  _platform: SkillTargetPlatform,
): readonly SkillDefinition[] {
  return SKILL_DEFINITIONS;
}
