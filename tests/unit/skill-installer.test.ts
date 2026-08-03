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
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  installSkills,
  removeSkills,
  resolveTargetDir,
  formatSummary,
  formatGlobalRootDisplay,
} from '../../src/installer/skill-installer.js';
import {
  SKILL_DEFINITIONS,
  getSkillDefinitionsForPlatform,
} from '../../src/installer/skill-templates.js';

describe('skill-installer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skill-installer-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('installSkills', () => {
    it('Skill 定义直接来自 spectra canonical source', () => {
      for (const skill of SKILL_DEFINITIONS) {
        const canonicalPath = join(
          process.cwd(),
          'plugins',
          'spectra',
          'skills',
          skill.name,
          'SKILL.md',
        );
        expect(readFileSync(canonicalPath, 'utf-8')).toBe(skill.content);
      }
    });

    it('项目级安装 3 个 skill', () => {
      const targetDir = join(tempDir, '.claude', 'skills');
      const summary = installSkills({ targetDir, mode: 'project', platform: 'claude' });

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
      const summary = installSkills({ targetDir, mode: 'global', platform: 'claude' });

      expect(summary.mode).toBe('global');
      expect(summary.results).toHaveLength(3);
      for (const result of summary.results) {
        expect(result.status).toBe('installed');
      }
    });

    it('目录不存在时自动创建', () => {
      const targetDir = join(tempDir, 'deep', 'nested', '.claude', 'skills');
      expect(existsSync(targetDir)).toBe(false);

      installSkills({ targetDir, mode: 'project', platform: 'claude' });

      expect(existsSync(targetDir)).toBe(true);
      expect(
        existsSync(join(targetDir, 'spectra', 'SKILL.md')),
      ).toBe(true);
    });

    it('文件已存在时返回 updated 状态', () => {
      const targetDir = join(tempDir, '.claude', 'skills');

      // 首次安装
      const first = installSkills({ targetDir, mode: 'project', platform: 'claude' });
      for (const r of first.results) {
        expect(r.status).toBe('installed');
      }

      // 二次安装
      const second = installSkills({ targetDir, mode: 'project', platform: 'claude' });
      for (const r of second.results) {
        expect(r.status).toBe('updated');
      }
    });

    it('单个 skill 失败不中断其他', () => {
      const targetDir = join(tempDir, '.claude', 'skills');

      // 将 spectra-batch 目录创建为只读文件（阻止写入）
      const batchDir = join(targetDir, 'spectra-batch');
      mkdirSync(batchDir, { recursive: true });
      // 创建一个同名文件来阻止在其下创建子文件
      // 用一个无写入权限的目录来模拟
      const batchFile = join(batchDir, 'SKILL.md');
      mkdirSync(batchFile, { recursive: true }); // 创建为目录而非文件

      const summary = installSkills({ targetDir, mode: 'project', platform: 'claude' });

      // 应有 3 个结果
      expect(summary.results).toHaveLength(3);

      // spectra 和 spectra-diff 应成功
      const rsResult = summary.results.find(
        (r) => r.skillName === 'spectra',
      );
      expect(rsResult?.status).toBe('installed');

      const diffResult = summary.results.find(
        (r) => r.skillName === 'spectra-diff',
      );
      expect(diffResult?.status).toBe('installed');

      // spectra-batch 应失败
      const batchResult = summary.results.find(
        (r) => r.skillName === 'spectra-batch',
      );
      expect(batchResult?.status).toBe('failed');
      expect(batchResult?.error).toBeDefined();
    });

    it('codex 平台安装仅包含 spectra 三件套', () => {
      const targetDir = join(tempDir, '.codex', 'skills');
      const summary = installSkills({ targetDir, mode: 'project', platform: 'codex' });
      const expected = getSkillDefinitionsForPlatform('codex');

      expect(summary.results).toHaveLength(expected.length);
      const installedSkillNames = summary.results.map((r) => r.skillName);
      expect(installedSkillNames).toContain('spectra');
      expect(installedSkillNames).toContain('spectra-batch');
      expect(installedSkillNames).toContain('spectra-diff');
      expect(installedSkillNames).not.toContain('spec-driver-feature');
      expect(
        existsSync(join(targetDir, 'spectra', 'SKILL.md')),
      ).toBe(true);
      expect(
        existsSync(join(targetDir, 'spectra-batch', 'SKILL.md')),
      ).toBe(true);
    });
  });

  describe('removeSkills', () => {
    it('删除已安装的 skill 目录', () => {
      const targetDir = join(tempDir, '.claude', 'skills');

      // 先安装
      installSkills({ targetDir, mode: 'project', platform: 'claude' });

      // 再移除
      const summary = removeSkills({ targetDir, mode: 'project', platform: 'claude' });

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
      const summary = removeSkills({ targetDir, mode: 'project', platform: 'claude' });

      expect(summary.results).toHaveLength(3);
      for (const result of summary.results) {
        expect(result.status).toBe('skipped');
      }
    });

    // ── Codex 对抗审查 W2：不可访问 ≠ 未安装 ──

    it('🔴 W2 — 目录不可访问时返回 failed + 权限诊断，绝不冒充 skipped', () => {
      // root 跑测时 mode 000 拦不住，此时该场景无法构造 —— 显式跳过而不是假装通过
      if (process.getuid?.() === 0) {
        return;
      }

      const lockedRoot = join(tempDir, 'locked');
      const targetDir = join(lockedRoot, 'skills');
      // 先正常安装，确认产物**确实存在**（这正是"卸载假成功"的危险前提）
      installSkills({ targetDir, mode: 'project', platform: 'claude' });
      expect(existsSync(join(targetDir, SKILL_DEFINITIONS[0]!.name))).toBe(true);

      chmodSync(lockedRoot, 0o000);
      try {
        const summary = removeSkills({ targetDir, mode: 'project', platform: 'claude' });

        for (const result of summary.results) {
          expect(result.status, `不得把 EACCES 当成 skipped: ${JSON.stringify(result)}`).toBe(
            'failed',
          );
          expect(result.error).toContain('权限不足');
        }

        // 🔴 关键反向断言：上层格式化不得输出"无需清理"——
        // 产物其实还在磁盘上，那句话就是卸载假成功
        expect(formatSummary(summary)).not.toContain('无需清理');
      } finally {
        chmodSync(lockedRoot, 0o755);
      }
    });

    it('移除时不影响其他 skill', () => {
      const targetDir = join(tempDir, '.claude', 'skills');

      // 安装 spectra skills
      installSkills({ targetDir, mode: 'project', platform: 'claude' });

      // 创建一个"其他" skill
      const otherDir = join(targetDir, 'other-skill');
      mkdirSync(otherDir, { recursive: true });
      writeFileSync(join(otherDir, 'SKILL.md'), '# Other skill');

      // 移除
      removeSkills({ targetDir, mode: 'project', platform: 'claude' });

      // 其他 skill 仍然存在
      expect(existsSync(join(otherDir, 'SKILL.md'))).toBe(true);
      expect(existsSync(targetDir)).toBe(true);
    });
  });

  describe('resolveTargetDir', () => {
    // F240（FR-007）：本块下方 4 条原有断言验证的是「CODEX_HOME 未设置时的默认行为」，
    // 迁移后它们才具备「helper 是否破坏了默认路径」的检测能力，故断言本身逐字保留。
    // 此处仅**补充**显式的环境隔离：若跑测机器的环境里恰好设置了 CODEX_HOME，
    // 默认行为断言会因外部环境而假失败——隔离后这 4 条重新变回环境无关。
    let savedCodexHome: string | undefined;
    beforeEach(() => {
      savedCodexHome = process.env['CODEX_HOME'];
      delete process.env['CODEX_HOME'];
    });
    afterEach(() => {
      if (savedCodexHome === undefined) delete process.env['CODEX_HOME'];
      else process.env['CODEX_HOME'] = savedCodexHome;
    });

    it('project 模式返回 cwd/.claude/skills', () => {
      const result = resolveTargetDir('project', 'claude');
      expect(result).toBe(join(process.cwd(), '.claude', 'skills'));
    });

    it('global 模式返回 ~/.claude/skills', () => {
      const result = resolveTargetDir('global', 'claude');
      expect(result).toBe(join(homedir(), '.claude', 'skills'));
    });

    it('project + codex 返回 cwd/.codex/skills', () => {
      const result = resolveTargetDir('project', 'codex');
      expect(result).toBe(join(process.cwd(), '.codex', 'skills'));
    });

    it('global + codex 返回 ~/.codex/skills', () => {
      const result = resolveTargetDir('global', 'codex');
      expect(result).toBe(join(homedir(), '.codex', 'skills'));
    });

    // ── F240 / FR-007(3)：以下为**新增**的自定义 CODEX_HOME 用例（原断言未删改）──

    it('global + codex 在自定义 CODEX_HOME 下解析到该目录，而非 ~/.codex', () => {
      process.env['CODEX_HOME'] = '/tmp/f240-installer-custom';
      const result = resolveTargetDir('global', 'codex');
      expect(result).toBe(join('/tmp/f240-installer-custom', 'skills'));
      expect(result).not.toBe(join(homedir(), '.codex', 'skills'));
    });

    it('global + codex 的自定义 CODEX_HOME 带尾斜杠时不产生 //', () => {
      process.env['CODEX_HOME'] = '/tmp/f240-trailing/';
      expect(resolveTargetDir('global', 'codex')).toBe('/tmp/f240-trailing/skills');
    });

    it('🔴 自定义 CODEX_HOME 不得影响 project + codex（仓库内 .codex/ 语义相反）', () => {
      process.env['CODEX_HOME'] = '/tmp/f240-installer-custom';
      expect(resolveTargetDir('project', 'codex')).toBe(join(process.cwd(), '.codex', 'skills'));
    });

    it('🔴 自定义 CODEX_HOME 不得影响 Claude 两个分支', () => {
      process.env['CODEX_HOME'] = '/tmp/f240-installer-custom';
      expect(resolveTargetDir('global', 'claude')).toBe(join(homedir(), '.claude', 'skills'));
      expect(resolveTargetDir('project', 'claude')).toBe(join(process.cwd(), '.claude', 'skills'));
    });
  });

  describe('formatGlobalRootDisplay（F240 / FR-007(2)）', () => {
    let savedCodexHome: string | undefined;
    beforeEach(() => {
      savedCodexHome = process.env['CODEX_HOME'];
      delete process.env['CODEX_HOME'];
    });
    afterEach(() => {
      if (savedCodexHome === undefined) delete process.env['CODEX_HOME'];
      else process.env['CODEX_HOME'] = savedCodexHome;
    });

    it('CODEX_HOME 未设置时沿用简写 ~/.codex（既有输出不变）', () => {
      expect(formatGlobalRootDisplay('codex')).toBe('~/.codex');
    });

    it('CODEX_HOME 自定义时展示真实路径，不再误导用户去看 ~/.codex', () => {
      process.env['CODEX_HOME'] = '/tmp/f240-display';
      expect(formatGlobalRootDisplay('codex')).toBe('/tmp/f240-display');
    });

    it('Claude 平台恒为 ~/.claude，不受 CODEX_HOME 影响', () => {
      process.env['CODEX_HOME'] = '/tmp/f240-display';
      expect(formatGlobalRootDisplay('claude')).toBe('~/.claude');
    });
  });

  describe('formatSummary', () => {
    it('安装成功输出正确格式', () => {
      const output = formatSummary({
        mode: 'project',
        action: 'install',
        platform: 'claude',
        results: [
          {
            skillName: 'spectra',
            status: 'installed',
            targetPath: '.claude/skills/spectra/SKILL.md',
          },
          {
            skillName: 'spectra-batch',
            status: 'installed',
            targetPath: '.claude/skills/spectra-batch/SKILL.md',
          },
          {
            skillName: 'spectra-diff',
            status: 'installed',
            targetPath: '.claude/skills/spectra-diff/SKILL.md',
          },
        ],
        targetBasePath: '.claude/skills',
      });

      expect(output).toContain('spectra skills 安装完成:');
      expect(output).toContain('✓ 已安装: .claude/skills/spectra/SKILL.md');
      expect(output).toContain('提示: 在 Claude Code 中使用 /spectra 即可调用');
    });

    it('更新输出包含 已更新 标记', () => {
      const output = formatSummary({
        mode: 'project',
        action: 'install',
        platform: 'claude',
        results: [
          {
            skillName: 'spectra',
            status: 'updated',
            targetPath: '.claude/skills/spectra/SKILL.md',
          },
          {
            skillName: 'spectra-batch',
            status: 'updated',
            targetPath: '.claude/skills/spectra-batch/SKILL.md',
          },
          {
            skillName: 'spectra-diff',
            status: 'updated',
            targetPath: '.claude/skills/spectra-diff/SKILL.md',
          },
        ],
        targetBasePath: '.claude/skills',
      });

      expect(output).toContain('spectra skills 已更新:');
      expect(output).toContain('✓ 已更新');
    });

    it('全局安装输出包含优先级警告', () => {
      const output = formatSummary({
        mode: 'global',
        action: 'install',
        platform: 'claude',
        results: [
          {
            skillName: 'spectra',
            status: 'installed',
            targetPath: '~/.claude/skills/spectra/SKILL.md',
          },
          {
            skillName: 'spectra-batch',
            status: 'installed',
            targetPath: '~/.claude/skills/spectra-batch/SKILL.md',
          },
          {
            skillName: 'spectra-diff',
            status: 'installed',
            targetPath: '~/.claude/skills/spectra-diff/SKILL.md',
          },
        ],
        targetBasePath: '~/.claude/skills',
      });

      expect(output).toContain('已安装到全局目录');
      expect(output).toContain('~/.claude/skills/spectra/SKILL.md');
      expect(output).toContain('注意: 全局 skill 优先级高于项目级 skill');
    });

    it('移除成功输出', () => {
      const output = formatSummary({
        mode: 'project',
        action: 'remove',
        platform: 'claude',
        results: [
          {
            skillName: 'spectra',
            status: 'removed',
            targetPath: '.claude/skills/spectra/SKILL.md',
          },
          {
            skillName: 'spectra-batch',
            status: 'removed',
            targetPath: '.claude/skills/spectra-batch/SKILL.md',
          },
          {
            skillName: 'spectra-diff',
            status: 'removed',
            targetPath: '.claude/skills/spectra-diff/SKILL.md',
          },
        ],
        targetBasePath: '.claude/skills',
      });

      expect(output).toContain('spectra skills 已移除:');
      expect(output).toContain('✓ 已删除');
    });

    it('全部 skipped 输出无需清理', () => {
      const output = formatSummary({
        mode: 'project',
        action: 'remove',
        platform: 'claude',
        results: [
          {
            skillName: 'spectra',
            status: 'skipped',
            targetPath: '.claude/skills/spectra/SKILL.md',
          },
          {
            skillName: 'spectra-batch',
            status: 'skipped',
            targetPath: '.claude/skills/spectra-batch/SKILL.md',
          },
          {
            skillName: 'spectra-diff',
            status: 'skipped',
            targetPath: '.claude/skills/spectra-diff/SKILL.md',
          },
        ],
        targetBasePath: '.claude/skills',
      });

      expect(output).toBe('未检测到已安装的 spectra skills，无需清理');
    });

    it('部分失败输出包含警告标记', () => {
      const output = formatSummary({
        mode: 'project',
        action: 'install',
        platform: 'claude',
        results: [
          {
            skillName: 'spectra',
            status: 'installed',
            targetPath: '.claude/skills/spectra/SKILL.md',
          },
          {
            skillName: 'spectra-batch',
            status: 'failed',
            targetPath: '.claude/skills/spectra-batch/SKILL.md',
            error: '权限不足',
          },
          {
            skillName: 'spectra-diff',
            status: 'installed',
            targetPath: '.claude/skills/spectra-diff/SKILL.md',
          },
        ],
        targetBasePath: '.claude/skills',
      });

      expect(output).toContain('部分失败');
      expect(output).toContain('⚠ 失败');
      expect(output).toContain('权限不足');
    });

    it('codex 平台输出包含 .codex 路径和 Codex 提示', () => {
      const output = formatSummary({
        mode: 'project',
        action: 'install',
        platform: 'codex',
        results: [
          {
            skillName: 'spectra',
            status: 'installed',
            targetPath: '.codex/skills/spectra/SKILL.md',
          },
        ],
        targetBasePath: '.codex/skills',
      });

      expect(output).toContain('Codex');
      expect(output).toContain('.codex/skills/spectra/SKILL.md');
      expect(output).toContain('$spectra');
    });
  });
});
