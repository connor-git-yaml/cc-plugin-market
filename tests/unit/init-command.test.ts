/**
 * init 命令单元测试
 * 覆盖 parse-args 扩展和 init 命令处理
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from '../../src/cli/utils/parse-args.js';
import { SKILL_DEFINITIONS } from '../../src/installer/skill-templates.js';
import {
  installSkills,
  removeSkills,
  formatSummary,
} from '../../src/installer/skill-installer.js';

describe('parse-args: init 子命令', () => {
  it('解析 init', () => {
    const result = parseArgs(['init']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('init');
      expect(result.command.global).toBe(false);
      expect(result.command.remove).toBe(false);
    }
  });

  it('解析 init --global', () => {
    const result = parseArgs(['init', '--global']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('init');
      expect(result.command.global).toBe(true);
      expect(result.command.remove).toBe(false);
    }
  });

  it('解析 init -g', () => {
    const result = parseArgs(['init', '-g']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('init');
      expect(result.command.global).toBe(true);
    }
  });

  it('解析 init --remove', () => {
    const result = parseArgs(['init', '--remove']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('init');
      expect(result.command.remove).toBe(true);
      expect(result.command.global).toBe(false);
    }
  });

  it('解析 init --remove --global', () => {
    const result = parseArgs(['init', '--remove', '--global']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('init');
      expect(result.command.remove).toBe(true);
      expect(result.command.global).toBe(true);
    }
  });

  it('非 init 命令使用 --global 报错', () => {
    const result = parseArgs(['generate', '--global', 'src/']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invalid_option');
      expect(result.error.message).toContain('--global');
      expect(result.error.message).toContain('init');
    }
  });

  it('非 init 命令使用 --remove 报错', () => {
    const result = parseArgs(['batch', '--remove']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invalid_option');
      expect(result.error.message).toContain('--remove');
    }
  });

  it('init 带位置参数报错', () => {
    const result = parseArgs(['init', 'src/']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invalid_option');
      expect(result.error.message).toContain('不接受位置参数');
    }
  });

  it('现有命令的 global 和 remove 字段默认为 false', () => {
    const result = parseArgs(['generate', 'src/']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.global).toBe(false);
      expect(result.command.remove).toBe(false);
    }
  });
});

describe('init 命令集成流程', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'init-cmd-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('项目级安装完整流程', () => {
    const targetDir = join(tempDir, '.claude', 'skills');
    const summary = installSkills({ targetDir, mode: 'project' });

    // 验证 3 个 skill 安装成功
    expect(summary.results).toHaveLength(3);
    for (const result of summary.results) {
      expect(result.status).toBe('installed');
    }

    // 验证格式化输出
    const output = formatSummary(summary);
    expect(output).toContain('安装完成');
    expect(output).toContain('/reverse-spec');

    // 验证文件内容包含降级逻辑
    const skillContent = readFileSync(
      join(targetDir, 'reverse-spec', 'SKILL.md'),
      'utf-8',
    );
    expect(skillContent).toContain('command -v reverse-spec');
    expect(skillContent).toContain('npm_config_yes=true npx reverse-spec');
    expect(skillContent).toContain('npm install -g reverse-spec');
  });

  it('--global 正确传递 mode=global', () => {
    const targetDir = join(tempDir, 'global-skills');
    const summary = installSkills({ targetDir, mode: 'global' });
    expect(summary.mode).toBe('global');

    const output = formatSummary(summary);
    expect(output).toContain('全局目录');
    expect(output).toContain('优先级');
  });

  it('--remove 项目级移除', () => {
    const targetDir = join(tempDir, '.claude', 'skills');

    // 先安装
    installSkills({ targetDir, mode: 'project' });

    // 再移除
    const summary = removeSkills({ targetDir, mode: 'project' });
    expect(summary.action).toBe('remove');
    for (const result of summary.results) {
      expect(result.status).toBe('removed');
    }

    const output = formatSummary(summary);
    expect(output).toContain('已移除');
  });

  it('--remove 无已安装 skill 时输出无需清理', () => {
    const targetDir = join(tempDir, 'empty', '.claude', 'skills');
    const summary = removeSkills({ targetDir, mode: 'project' });

    const output = formatSummary(summary);
    expect(output).toBe('未检测到已安装的 reverse-spec skills，无需清理');
  });

  it('--remove --global 全局移除', () => {
    const targetDir = join(tempDir, 'global-skills');

    // 先安装
    installSkills({ targetDir, mode: 'global' });

    // 再移除
    const summary = removeSkills({ targetDir, mode: 'global' });
    expect(summary.mode).toBe('global');
    for (const result of summary.results) {
      expect(result.status).toBe('removed');
    }
  });
});
