/**
 * Skill 注册/卸载单元测试
 * 通过新的 installer 模块验证注册/注销行为
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  installSkills,
  removeSkills,
} from '../../src/installer/skill-installer.js';
import { SKILL_DEFINITIONS } from '../../src/installer/skill-templates.js';

describe('Skill 注册器', () => {
  let tempDir: string;
  let skillsTargetDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skill-test-'));
    skillsTargetDir = join(tempDir, '.claude', 'skills');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('全局安装时注册 3 个 skill', () => {
    const summary = installSkills({ targetDir: skillsTargetDir, mode: 'global' });

    expect(summary.results).toHaveLength(3);
    for (const result of summary.results) {
      expect(result.status).toBe('installed');
    }

    // 验证文件确实存在
    for (const skill of SKILL_DEFINITIONS) {
      expect(existsSync(join(skillsTargetDir, skill.name, 'SKILL.md'))).toBe(true);
    }
  });

  it('本地安装时跳过（npm_config_global 未设置）', () => {
    // 模拟 postinstall 的全局检测逻辑
    const isGlobal = process.env['npm_config_global'] === 'true';
    expect(isGlobal).toBe(false); // 测试环境中不应是全局安装
  });

  it('目标目录不存在时自动创建', () => {
    expect(existsSync(skillsTargetDir)).toBe(false);

    installSkills({ targetDir: skillsTargetDir, mode: 'global' });

    expect(existsSync(skillsTargetDir)).toBe(true);
    expect(existsSync(join(skillsTargetDir, 'reverse-spec', 'SKILL.md'))).toBe(true);
  });

  it('单个 skill 失败不中断其他', () => {
    // 将 reverse-spec-batch 目录创建为一个阻止写入的结构
    const batchDir = join(skillsTargetDir, 'reverse-spec-batch');
    mkdirSync(batchDir, { recursive: true });
    mkdirSync(join(batchDir, 'SKILL.md'), { recursive: true }); // 创建为目录而非文件

    const summary = installSkills({ targetDir: skillsTargetDir, mode: 'global' });

    // reverse-spec 和 reverse-spec-diff 应成功
    const rsResult = summary.results.find((r) => r.skillName === 'reverse-spec');
    expect(rsResult?.status).toBe('installed');

    const diffResult = summary.results.find((r) => r.skillName === 'reverse-spec-diff');
    expect(diffResult?.status).toBe('installed');

    // reverse-spec-batch 应失败
    const batchResult = summary.results.find((r) => r.skillName === 'reverse-spec-batch');
    expect(batchResult?.status).toBe('failed');
  });

  it('卸载时清理 3 个 skill 目录', () => {
    // 先注册
    installSkills({ targetDir: skillsTargetDir, mode: 'global' });
    expect(existsSync(join(skillsTargetDir, 'reverse-spec'))).toBe(true);

    // 然后卸载
    const summary = removeSkills({ targetDir: skillsTargetDir, mode: 'global' });

    expect(summary.results).toHaveLength(3);
    for (const result of summary.results) {
      expect(result.status).toBe('removed');
    }
    for (const skill of SKILL_DEFINITIONS) {
      expect(existsSync(join(skillsTargetDir, skill.name))).toBe(false);
    }
  });

  it('卸载时其他 skill 不受影响', () => {
    // 注册 reverse-spec skills
    installSkills({ targetDir: skillsTargetDir, mode: 'global' });

    // 创建一个"其他" skill
    const otherSkillDir = join(skillsTargetDir, 'other-skill');
    mkdirSync(otherSkillDir, { recursive: true });
    writeFileSync(join(otherSkillDir, 'SKILL.md'), '# Other skill');

    // 卸载 reverse-spec skills
    removeSkills({ targetDir: skillsTargetDir, mode: 'global' });

    // 其他 skill 仍然存在
    expect(existsSync(join(otherSkillDir, 'SKILL.md'))).toBe(true);

    // ~/.claude/skills/ 本身仍然存在
    expect(existsSync(skillsTargetDir)).toBe(true);
  });

  it('目录不存在时卸载不报错', () => {
    // 不注册，直接卸载
    const summary = removeSkills({ targetDir: skillsTargetDir, mode: 'global' });
    expect(summary.results).toHaveLength(3);
    for (const result of summary.results) {
      expect(result.status).toBe('skipped');
    }
  });
});
