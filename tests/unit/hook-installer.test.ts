/**
 * hook-installer.ts 单元测试
 * 使用 mkdtempSync 构建临时文件系统，beforeEach/afterEach 清理，不 mock 模块
 * 覆盖：settings.json 读写/合并/幂等/错误处理/脚本生成/卸载
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  installClaudeHook,
  removeClaudeHook,
  generateContextScript,
  type ClaudeSettings,
} from '../../src/hooks/hook-installer.js';

/** 创建临时测试目录 */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-hook-test-'));
}

/** 读取 settings.json 内容 */
function readSettings(dir: string): ClaudeSettings {
  return JSON.parse(
    fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf-8'),
  ) as ClaudeSettings;
}

describe('hook-installer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── generateContextScript 测试 ───────────────────────────────────────────

  describe('generateContextScript()', () => {
    it('输出包含 #!/bin/bash', () => {
      const script = generateContextScript();
      expect(script).toContain('#!/bin/bash');
    });

    it('输出包含 set -euo pipefail', () => {
      const script = generateContextScript();
      expect(script).toContain('set -euo pipefail');
    });

    it('输出包含 exit 0', () => {
      const script = generateContextScript();
      expect(script).toContain('exit 0');
    });

    it('包含 node -e 内联 JSON 解析（不依赖 jq）', () => {
      const script = generateContextScript();
      expect(script).toContain('node -e');
      expect(script).not.toContain('jq');
    });

    it('包含三行输出规范（spectra: Knowledge graph / God nodes / →）', () => {
      const script = generateContextScript();
      expect(script).toContain('spectra: Knowledge graph loaded');
      expect(script).toContain('God nodes:');
      expect(script).toContain('→ Read specs/_meta/GRAPH_REPORT.md');
    });

    it('不使用 grep -P（macOS 不兼容的 GNU 扩展）', () => {
      const script = generateContextScript();
      expect(script).not.toContain('grep -oP');
    });
  });

  // ─── installClaudeHook 测试 ───────────────────────────────────────────────

  describe('installClaudeHook()', () => {
    it('settings.json 不存在时自动创建目录并写入合法 JSON（FR-002）', () => {
      installClaudeHook(tmpDir);

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = readSettings(tmpDir);
      expect(settings.hooks?.PreToolUse).toHaveLength(1);
    });

    it('.claude/ 目录不存在时自动递归创建（FR-002）', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      expect(fs.existsSync(claudeDir)).toBe(false);

      installClaudeHook(tmpDir);

      expect(fs.existsSync(claudeDir)).toBe(true);
    });

    it('合法 JSON 深度合并，enabledPlugins 等已有字段完整保留', () => {
      // 预先写入带有其他字段的 settings.json
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      const existing: ClaudeSettings = {
        enabledPlugins: ['some-plugin'],
        hooks: {
          PostToolUse: [{ matcher: 'Bash', command: 'echo done' }],
        },
      };
      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify(existing, null, 2),
        'utf-8',
      );

      installClaudeHook(tmpDir);

      const settings = readSettings(tmpDir);
      // 已有字段完整保留
      expect(settings['enabledPlugins']).toEqual(['some-plugin']);
      // PostToolUse 条目保留
      expect(settings.hooks?.PostToolUse).toHaveLength(1);
      // PreToolUse 注入成功
      expect(settings.hooks?.PreToolUse).toHaveLength(1);
      expect(settings.hooks?.PreToolUse?.[0]?.command).toContain('spectra-context.sh');
    });

    it('非法 JSON 时 throw，不修改原文件（FR-003）', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      const badContent = '{ invalid json }}}';
      const settingsPath = path.join(claudeDir, 'settings.json');
      fs.writeFileSync(settingsPath, badContent, 'utf-8');

      expect(() => installClaudeHook(tmpDir)).toThrow('settings.json 格式错误');

      // 原文件内容未修改
      const afterContent = fs.readFileSync(settingsPath, 'utf-8');
      expect(afterContent).toBe(badContent);
    });

    it('幂等安装：重复调用两次后 PreToolUse 数组长度 = 1（FR-004）', () => {
      installClaudeHook(tmpDir);
      installClaudeHook(tmpDir);

      const settings = readSettings(tmpDir);
      expect(settings.hooks?.PreToolUse).toHaveLength(1);
    });

    it('生成 spectra-context.sh 并 chmod +x（FR-005）', () => {
      installClaudeHook(tmpDir);

      const scriptPath = path.join(tmpDir, 'specs', '_meta', 'hooks', 'spectra-context.sh');
      expect(fs.existsSync(scriptPath)).toBe(true);

      // 验证可执行权限
      const stat = fs.statSync(scriptPath);
      // 0o755 = 493
      expect(stat.mode & 0o111).toBeGreaterThan(0);
    });

    it('PreToolUse 为非数组值时安全降级为空数组并正常安装', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      // 模拟 PreToolUse 被手工写成字符串
      const corrupted = { hooks: { PreToolUse: 'not-an-array' } };
      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify(corrupted, null, 2),
        'utf-8',
      );

      installClaudeHook(tmpDir);

      const settings = readSettings(tmpDir);
      expect(Array.isArray(settings.hooks?.PreToolUse)).toBe(true);
      expect(settings.hooks?.PreToolUse).toHaveLength(1);
      expect(settings.hooks?.PreToolUse?.[0]?.command).toContain('spectra-context.sh');
    });

    it('写入前创建 .bak 备份', () => {
      // 先写一次确保文件存在
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify({ existing: true }, null, 2),
        'utf-8',
      );

      installClaudeHook(tmpDir);

      const bakPath = path.join(claudeDir, 'settings.json.bak');
      expect(fs.existsSync(bakPath)).toBe(true);
    });
  });

  // ─── removeClaudeHook 测试 ────────────────────────────────────────────────

  describe('removeClaudeHook()', () => {
    it('只删除 spectra 条目，其他 PreToolUse 条目完整保留（FR-011）', () => {
      // 先安装
      installClaudeHook(tmpDir);

      // 手动追加另一个非 spectra 条目
      const settings = readSettings(tmpDir);
      const otherHook = { matcher: 'Bash', command: 'echo other' };
      settings.hooks!.PreToolUse!.push(otherHook);
      fs.writeFileSync(
        path.join(tmpDir, '.claude', 'settings.json'),
        JSON.stringify(settings, null, 2),
        'utf-8',
      );

      removeClaudeHook(tmpDir);

      const afterSettings = readSettings(tmpDir);
      // spectra 条目已删除
      const hasSpectra = afterSettings.hooks?.PreToolUse?.some(h =>
        h.command.includes('spectra-context.sh'),
      );
      expect(hasSpectra).toBe(false);
      // 其他条目保留
      expect(afterSettings.hooks?.PreToolUse).toHaveLength(1);
      expect(afterSettings.hooks?.PreToolUse?.[0]?.command).toBe('echo other');
    });

    it('settings.json 不存在时静默退出并打印 hook not found 提示', () => {
      // 不预先安装，直接卸载
      expect(() => removeClaudeHook(tmpDir)).not.toThrow();
    });

    it('settings.json 中无 spectra 条目时静默退出', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify({ hooks: {} }, null, 2),
        'utf-8',
      );

      expect(() => removeClaudeHook(tmpDir)).not.toThrow();
    });

    it('settings.json 为非法 JSON 时 throw 错误', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      const badContent = '{ invalid json }}}';
      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        badContent,
        'utf-8',
      );

      expect(() => removeClaudeHook(tmpDir)).toThrow('settings.json 格式错误');
    });
  });
});
