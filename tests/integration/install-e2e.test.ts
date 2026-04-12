/**
 * install 命令端到端集成测试
 * 构建含真实 .git/ 结构的临时目录，覆盖完整安装→验证→卸载流程
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  installClaudeHook,
  removeClaudeHook,
  type ClaudeSettings,
} from '../../src/hooks/hook-installer.js';
import {
  installGitHook,
  removeGitHook,
} from '../../src/hooks/git-hook-installer.js';

/** 创建含真实 .git/hooks/ 结构的临时目录 */
function makeTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-e2e-test-'));
  fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
  return dir;
}

/** 读取 settings.json 内容 */
function readSettings(dir: string): ClaudeSettings {
  return JSON.parse(
    fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf-8'),
  ) as ClaudeSettings;
}

describe('install-e2e', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempGitRepo();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── SC-001: 完整安装验证流程 ──────────────────────────────────────────────

  it('完整安装：settings.json 存在 PreToolUse 条目，脚本文件存在且可执行（SC-001）', () => {
    installClaudeHook(tmpDir);

    // settings.json 存在且包含 PreToolUse 条目
    const settings = readSettings(tmpDir);
    expect(settings.hooks?.PreToolUse).toHaveLength(1);
    expect(settings.hooks?.PreToolUse?.[0]?.command).toContain('spectra-context.sh');

    // shell 脚本文件存在且可执行
    const scriptPath = path.join(tmpDir, 'specs', '_meta', 'hooks', 'spectra-context.sh');
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stat = fs.statSync(scriptPath);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  // ─── SC-006: 卸载清除验证 ──────────────────────────────────────────────────

  it('卸载：PreToolUse 条目清除，其他字段完整保留（SC-006）', () => {
    // 预先写入带有其他字段的 settings.json
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const initialSettings: ClaudeSettings = {
      enabledPlugins: ['plugin-a'],
      customField: 'keep-me',
    };
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify(initialSettings, null, 2),
      'utf-8',
    );

    installClaudeHook(tmpDir);
    removeClaudeHook(tmpDir);

    const settings = readSettings(tmpDir);
    // spectra 条目已清除
    const hasSpectra = (settings.hooks?.PreToolUse ?? []).some(h =>
      h.command.includes('spectra-context.sh'),
    );
    expect(hasSpectra).toBe(false);
    // 其他字段完整保留
    expect(settings['enabledPlugins']).toEqual(['plugin-a']);
    expect(settings['customField']).toBe('keep-me');
  });

  // ─── SC-005: git hook 完整流程 ─────────────────────────────────────────────

  it('git hook 完整流程：安装后 post-commit 含标记段落，卸载后段落清除（SC-005）', () => {
    installGitHook(tmpDir);

    // 验证 post-commit 存在且含标记段落
    const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-commit');
    expect(fs.existsSync(hookPath)).toBe(true);
    const contentBefore = fs.readFileSync(hookPath, 'utf-8');
    expect(contentBefore).toContain('# --- spectra begin ---');
    expect(contentBefore).toContain('spectra graph');

    removeGitHook(tmpDir);

    // 段落已清除
    const contentAfter = fs.readFileSync(hookPath, 'utf-8');
    expect(contentAfter).not.toContain('# --- spectra begin ---');
    expect(contentAfter).not.toContain('spectra graph');
  });

  // ─── SC-004: 幂等性验证 ────────────────────────────────────────────────────

  it('幂等性：连续调用 installClaudeHook 三次，PreToolUse 数组长度始终 = 1（SC-004）', () => {
    installClaudeHook(tmpDir);
    installClaudeHook(tmpDir);
    installClaudeHook(tmpDir);

    const settings = readSettings(tmpDir);
    expect(settings.hooks?.PreToolUse).toHaveLength(1);
  });

  // ─── FR-002: settings.json 不存在场景 ────────────────────────────────────

  it('settings.json 不存在场景：安装后文件为合法 JSON 且包含 hooks 字段（FR-002）', () => {
    // 确保 .claude/ 不存在
    const claudeDir = path.join(tmpDir, '.claude');
    expect(fs.existsSync(claudeDir)).toBe(false);

    installClaudeHook(tmpDir);

    // 文件存在且为合法 JSON
    const settingsPath = path.join(claudeDir, 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);

    const content = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(content) as ClaudeSettings;

    // 包含 hooks 字段（且是合法结构）
    expect(parsed.hooks).toBeDefined();
    expect(parsed.hooks?.PreToolUse).toHaveLength(1);
  });

  // ─── FR-013: 非 git 仓库保护 ─────────────────────────────────────────────

  it('非 git 仓库执行 installGitHook 时抛出错误（FR-013）', () => {
    // 创建不含 .git/ 的普通目录
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-plain-'));
    try {
      expect(() => installGitHook(plainDir)).toThrow('.git directory not found');
    } finally {
      fs.rmSync(plainDir, { recursive: true, force: true });
    }
  });
});
