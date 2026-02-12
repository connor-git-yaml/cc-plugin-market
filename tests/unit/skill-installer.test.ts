/**
 * skill-installer 核心逻辑单元测试
 * 覆盖 installSkills、removeSkills、resolveTargetDir、formatSummary
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  rmSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  installSkills,
  removeSkills,
  resolveTargetDir,
  formatSummary,
} from '../../src/installer/skill-installer.js';
import { SKILL_DEFINITIONS } from '../../src/installer/skill-templates.js';

describe('skill-installer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skill-installer-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('installSkills', () => {
    it('项目级安装 3 个 skill', () => {
      const targetDir = join(tempDir, '.claude', 'skills');
      const summary = installSkills({ targetDir, mode: 'project' });

      expect(summary.mode).toBe('project');
      expect(summary.action).toBe('install');
      expect(summary.results).toHaveLength(3);
      expect(summary.targetBasePath).toBe(targetDir);

      // 验证每个 skill 的状态为 installed
      for (const result of summary.results) {
        expect(result.status).toBe('installed');
      }

      // 验证文件确实存在
      for (const skill of SKILL_DEFINITIONS) {
        const filePath = join(targetDir, skill.name, 'SKILL.md');
        expect(existsSync(filePath)).toBe(true);
        expect(readFileSync(filePath, 'utf-8')).toBe(skill.content);
      }
    });

    it('全局级安装', () => {
      const targetDir = join(tempDir, 'global-skills');
      const summary = installSkills({ targetDir, mode: 'global' });

      expect(summary.mode).toBe('global');
      expect(summary.results).toHaveLength(3);
      for (const result of summary.results) {
        expect(result.status).toBe('installed');
      }
    });

    it('目录不存在时自动创建', () => {
      const targetDir = join(tempDir, 'deep', 'nested', '.claude', 'skills');
      expect(existsSync(targetDir)).toBe(false);

      installSkills({ targetDir, mode: 'project' });

      expect(existsSync(targetDir)).toBe(true);
      expect(
        existsSync(join(targetDir, 'reverse-spec', 'SKILL.md')),
      ).toBe(true);
    });

    it('文件已存在时返回 updated 状态', () => {
      const targetDir = join(tempDir, '.claude', 'skills');

      // 首次安装
      const first = installSkills({ targetDir, mode: 'project' });
      for (const r of first.results) {
        expect(r.status).toBe('installed');
      }

      // 二次安装
      const second = installSkills({ targetDir, mode: 'project' });
      for (const r of second.results) {
        expect(r.status).toBe('updated');
      }
    });

    it('单个 skill 失败不中断其他', () => {
      const targetDir = join(tempDir, '.claude', 'skills');

      // 将 reverse-spec-batch 目录创建为只读文件（阻止写入）
      const batchDir = join(targetDir, 'reverse-spec-batch');
      mkdirSync(batchDir, { recursive: true });
      // 创建一个同名文件来阻止在其下创建子文件
      // 用一个无写入权限的目录来模拟
      const batchFile = join(batchDir, 'SKILL.md');
      mkdirSync(batchFile, { recursive: true }); // 创建为目录而非文件

      const summary = installSkills({ targetDir, mode: 'project' });

      // 应有 3 个结果
      expect(summary.results).toHaveLength(3);

      // reverse-spec 和 reverse-spec-diff 应成功
      const rsResult = summary.results.find(
        (r) => r.skillName === 'reverse-spec',
      );
      expect(rsResult?.status).toBe('installed');

      const diffResult = summary.results.find(
        (r) => r.skillName === 'reverse-spec-diff',
      );
      expect(diffResult?.status).toBe('installed');

      // reverse-spec-batch 应失败
      const batchResult = summary.results.find(
        (r) => r.skillName === 'reverse-spec-batch',
      );
      expect(batchResult?.status).toBe('failed');
      expect(batchResult?.error).toBeDefined();
    });
  });

  describe('removeSkills', () => {
    it('删除已安装的 skill 目录', () => {
      const targetDir = join(tempDir, '.claude', 'skills');

      // 先安装
      installSkills({ targetDir, mode: 'project' });

      // 再移除
      const summary = removeSkills({ targetDir, mode: 'project' });

      expect(summary.action).toBe('remove');
      expect(summary.results).toHaveLength(3);
      for (const result of summary.results) {
        expect(result.status).toBe('removed');
      }

      // 验证目录已删除
      for (const skill of SKILL_DEFINITIONS) {
        expect(existsSync(join(targetDir, skill.name))).toBe(false);
      }
    });

    it('目录不存在时返回 skipped', () => {
      const targetDir = join(tempDir, 'nonexistent', '.claude', 'skills');
      const summary = removeSkills({ targetDir, mode: 'project' });

      expect(summary.results).toHaveLength(3);
      for (const result of summary.results) {
        expect(result.status).toBe('skipped');
      }
    });

    it('移除时不影响其他 skill', () => {
      const targetDir = join(tempDir, '.claude', 'skills');

      // 安装 reverse-spec skills
      installSkills({ targetDir, mode: 'project' });

      // 创建一个"其他" skill
      const otherDir = join(targetDir, 'other-skill');
      mkdirSync(otherDir, { recursive: true });
      writeFileSync(join(otherDir, 'SKILL.md'), '# Other skill');

      // 移除
      removeSkills({ targetDir, mode: 'project' });

      // 其他 skill 仍然存在
      expect(existsSync(join(otherDir, 'SKILL.md'))).toBe(true);
      expect(existsSync(targetDir)).toBe(true);
    });
  });

  describe('resolveTargetDir', () => {
    it('project 模式返回 cwd/.claude/skills', () => {
      const result = resolveTargetDir('project');
      expect(result).toBe(join(process.cwd(), '.claude', 'skills'));
    });

    it('global 模式返回 ~/.claude/skills', () => {
      const result = resolveTargetDir('global');
      expect(result).toBe(join(homedir(), '.claude', 'skills'));
    });
  });

  describe('formatSummary', () => {
    it('安装成功输出正确格式', () => {
      const output = formatSummary({
        mode: 'project',
        action: 'install',
        results: [
          {
            skillName: 'reverse-spec',
            status: 'installed',
            targetPath: '.claude/skills/reverse-spec/SKILL.md',
          },
          {
            skillName: 'reverse-spec-batch',
            status: 'installed',
            targetPath: '.claude/skills/reverse-spec-batch/SKILL.md',
          },
          {
            skillName: 'reverse-spec-diff',
            status: 'installed',
            targetPath: '.claude/skills/reverse-spec-diff/SKILL.md',
          },
        ],
        targetBasePath: '.claude/skills',
      });

      expect(output).toContain('reverse-spec skills 安装完成:');
      expect(output).toContain('✓ 已安装: .claude/skills/reverse-spec/SKILL.md');
      expect(output).toContain('提示: 在 Claude Code 中使用 /reverse-spec 即可调用');
    });

    it('更新输出包含 已更新 标记', () => {
      const output = formatSummary({
        mode: 'project',
        action: 'install',
        results: [
          {
            skillName: 'reverse-spec',
            status: 'updated',
            targetPath: '.claude/skills/reverse-spec/SKILL.md',
          },
          {
            skillName: 'reverse-spec-batch',
            status: 'updated',
            targetPath: '.claude/skills/reverse-spec-batch/SKILL.md',
          },
          {
            skillName: 'reverse-spec-diff',
            status: 'updated',
            targetPath: '.claude/skills/reverse-spec-diff/SKILL.md',
          },
        ],
        targetBasePath: '.claude/skills',
      });

      expect(output).toContain('reverse-spec skills 已更新:');
      expect(output).toContain('✓ 已更新');
    });

    it('全局安装输出包含优先级警告', () => {
      const output = formatSummary({
        mode: 'global',
        action: 'install',
        results: [
          {
            skillName: 'reverse-spec',
            status: 'installed',
            targetPath: '~/.claude/skills/reverse-spec/SKILL.md',
          },
          {
            skillName: 'reverse-spec-batch',
            status: 'installed',
            targetPath: '~/.claude/skills/reverse-spec-batch/SKILL.md',
          },
          {
            skillName: 'reverse-spec-diff',
            status: 'installed',
            targetPath: '~/.claude/skills/reverse-spec-diff/SKILL.md',
          },
        ],
        targetBasePath: '~/.claude/skills',
      });

      expect(output).toContain('已安装到全局目录');
      expect(output).toContain('~/.claude/skills/reverse-spec/SKILL.md');
      expect(output).toContain('注意: 全局 skill 优先级高于项目级 skill');
    });

    it('移除成功输出', () => {
      const output = formatSummary({
        mode: 'project',
        action: 'remove',
        results: [
          {
            skillName: 'reverse-spec',
            status: 'removed',
            targetPath: '.claude/skills/reverse-spec/SKILL.md',
          },
          {
            skillName: 'reverse-spec-batch',
            status: 'removed',
            targetPath: '.claude/skills/reverse-spec-batch/SKILL.md',
          },
          {
            skillName: 'reverse-spec-diff',
            status: 'removed',
            targetPath: '.claude/skills/reverse-spec-diff/SKILL.md',
          },
        ],
        targetBasePath: '.claude/skills',
      });

      expect(output).toContain('reverse-spec skills 已移除:');
      expect(output).toContain('✓ 已删除');
    });

    it('全部 skipped 输出无需清理', () => {
      const output = formatSummary({
        mode: 'project',
        action: 'remove',
        results: [
          {
            skillName: 'reverse-spec',
            status: 'skipped',
            targetPath: '.claude/skills/reverse-spec/SKILL.md',
          },
          {
            skillName: 'reverse-spec-batch',
            status: 'skipped',
            targetPath: '.claude/skills/reverse-spec-batch/SKILL.md',
          },
          {
            skillName: 'reverse-spec-diff',
            status: 'skipped',
            targetPath: '.claude/skills/reverse-spec-diff/SKILL.md',
          },
        ],
        targetBasePath: '.claude/skills',
      });

      expect(output).toBe('未检测到已安装的 reverse-spec skills，无需清理');
    });

    it('部分失败输出包含警告标记', () => {
      const output = formatSummary({
        mode: 'project',
        action: 'install',
        results: [
          {
            skillName: 'reverse-spec',
            status: 'installed',
            targetPath: '.claude/skills/reverse-spec/SKILL.md',
          },
          {
            skillName: 'reverse-spec-batch',
            status: 'failed',
            targetPath: '.claude/skills/reverse-spec-batch/SKILL.md',
            error: '权限不足',
          },
          {
            skillName: 'reverse-spec-diff',
            status: 'installed',
            targetPath: '.claude/skills/reverse-spec-diff/SKILL.md',
          },
        ],
        targetBasePath: '.claude/skills',
      });

      expect(output).toContain('部分失败');
      expect(output).toContain('⚠ 失败');
      expect(output).toContain('权限不足');
    });
  });
});
