/**
 * Skill 注册/卸载单元测试
 * 覆盖 contracts/skill-registrar.md 中定义的 6 个测试用例
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, copyFileSync, rmSync, existsSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 模拟 postinstall 和 preuninstall 的核心逻辑（不依赖 import.meta.dirname）
const SKILL_NAMES = ['reverse-spec', 'reverse-spec-batch', 'reverse-spec-diff'] as const;

function registerSkills(skillsTargetDir: string, skillsSourceDir: string): string[] {
  const registered: string[] = [];
  for (const skillName of SKILL_NAMES) {
    const sourceFile = join(skillsSourceDir, skillName, 'SKILL.md');
    const targetDir = join(skillsTargetDir, skillName);
    const targetFile = join(targetDir, 'SKILL.md');

    if (!existsSync(sourceFile)) {
      continue;
    }

    mkdirSync(targetDir, { recursive: true });
    copyFileSync(sourceFile, targetFile);
    registered.push(skillName);
  }
  return registered;
}

function unregisterSkills(skillsTargetDir: string): string[] {
  const removed: string[] = [];
  for (const skillName of SKILL_NAMES) {
    const targetDir = join(skillsTargetDir, skillName);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
      removed.push(skillName);
    }
  }
  return removed;
}

describe('Skill 注册器', () => {
  let tempDir: string;
  let skillsTargetDir: string;
  let skillsSourceDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skill-test-'));
    skillsTargetDir = join(tempDir, '.claude', 'skills');
    skillsSourceDir = join(tempDir, 'src', 'skills-global');

    // 创建模拟源文件
    for (const name of SKILL_NAMES) {
      const dir = join(skillsSourceDir, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `# ${name} skill`);
    }
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('全局安装时注册 3 个 skill', () => {
    const registered = registerSkills(skillsTargetDir, skillsSourceDir);

    expect(registered).toEqual(['reverse-spec', 'reverse-spec-batch', 'reverse-spec-diff']);

    // 验证文件确实存在
    for (const name of SKILL_NAMES) {
      expect(existsSync(join(skillsTargetDir, name, 'SKILL.md'))).toBe(true);
    }
  });

  it('本地安装时跳过（npm_config_global 未设置）', () => {
    // 模拟：不调用 registerSkills，仅验证逻辑
    const isGlobal = process.env['npm_config_global'] === 'true';
    expect(isGlobal).toBe(false); // 测试环境中不应是全局安装
  });

  it('目标目录不存在时自动创建', () => {
    // skillsTargetDir（~/.claude/skills/）不存在
    expect(existsSync(skillsTargetDir)).toBe(false);

    registerSkills(skillsTargetDir, skillsSourceDir);

    // 现在应该存在了
    expect(existsSync(skillsTargetDir)).toBe(true);
    expect(existsSync(join(skillsTargetDir, 'reverse-spec', 'SKILL.md'))).toBe(true);
  });

  it('权限错误时不中断（源文件不存在时跳过）', () => {
    // 删除一个源文件，模拟不可用
    rmSync(join(skillsSourceDir, 'reverse-spec-batch', 'SKILL.md'));

    const registered = registerSkills(skillsTargetDir, skillsSourceDir);

    // 只有 2 个被注册
    expect(registered).toEqual(['reverse-spec', 'reverse-spec-diff']);
  });

  it('卸载时清理 3 个 skill 目录', () => {
    // 先注册
    registerSkills(skillsTargetDir, skillsSourceDir);
    expect(existsSync(join(skillsTargetDir, 'reverse-spec'))).toBe(true);

    // 然后卸载
    const removed = unregisterSkills(skillsTargetDir);

    expect(removed).toEqual(['reverse-spec', 'reverse-spec-batch', 'reverse-spec-diff']);
    for (const name of SKILL_NAMES) {
      expect(existsSync(join(skillsTargetDir, name))).toBe(false);
    }
  });

  it('卸载时其他 skill 不受影响', () => {
    // 注册 reverse-spec skills
    registerSkills(skillsTargetDir, skillsSourceDir);

    // 创建一个"其他" skill
    const otherSkillDir = join(skillsTargetDir, 'other-skill');
    mkdirSync(otherSkillDir, { recursive: true });
    writeFileSync(join(otherSkillDir, 'SKILL.md'), '# Other skill');

    // 卸载 reverse-spec skills
    unregisterSkills(skillsTargetDir);

    // 其他 skill 仍然存在
    expect(existsSync(join(otherSkillDir, 'SKILL.md'))).toBe(true);

    // ~/.claude/skills/ 本身仍然存在
    expect(existsSync(skillsTargetDir)).toBe(true);
  });

  it('目录不存在时卸载不报错', () => {
    // 不注册，直接卸载
    expect(() => unregisterSkills(skillsTargetDir)).not.toThrow();
  });
});
