/**
 * hook-installer.ts 单元测试
 * 使用 mkdtempSync 构建临时文件系统，beforeEach/afterEach 清理，不 mock 模块
 * 覆盖：settings.json 读写/合并/幂等/错误处理/脚本生成/卸载
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    vi.restoreAllMocks();
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

  // ─── F267：权限保全与备份（D5 / D6）───────────────────────────────────────
  //
  // 这一组断言的共同点：目标是**别人的文件**（用户的 settings.json、用户可能已经改过权限的
  // hook 脚本、用户手上唯一一份原始备份）。安装器对它们只有"不破坏"的义务。

  describe('F267 — 别人的文件不被顺手改写', () => {
    /** settings.json 与其 .bak 的路径 */
    function settingsPaths(dir: string): { settings: string; bak: string } {
      const settings = path.join(dir, '.claude', 'settings.json');
      return { settings, bak: `${settings}.bak` };
    }

    /** 预置一份用户已有的 settings.json（不含我方 hook 条目，保证安装走真实写入路径） */
    function seedUserSettings(dir: string, content: unknown): void {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(settingsPaths(dir).settings, JSON.stringify(content, null, 2), 'utf-8');
    }

    const scriptPathOf = (dir: string): string =>
      path.join(dir, 'specs', '_meta', 'hooks', 'spectra-context.sh');

    it('D5 已存在脚本的自定义 mode 0700 被保全，不被放宽为 0755', () => {
      // 用户把 hook 脚本收紧到 0700 是他对自己机器的决定；重装时无条件 chmod 0755 等于
      // 背着用户把它放宽——而这个脚本是会被 Claude Code 执行的。
      installClaudeHook(tmpDir);
      const scriptPath = scriptPathOf(tmpDir);
      fs.chmodSync(scriptPath, 0o700);

      // 卸载后重装，走脚本重写路径（Claude 侧安装幂等形态是 skip，已装状态下第二次 install
      // 会在写脚本之前就 return，触不到这条路径）
      removeClaudeHook(tmpDir);
      installClaudeHook(tmpDir);

      expect((fs.statSync(scriptPath).mode & 0o7777).toString(8)).toBe('700');
    });

    it('D5 用户放宽的 mode 0777 同样被如实保全（保全 ≠ 加固）', () => {
      // 反向验证：保全逻辑不得偷偷变成"只保全比默认更严的、顺手收紧更宽的"。
      // 那是替用户做决定，与放宽 0700 属同一类越权，只是方向相反。
      installClaudeHook(tmpDir);
      const scriptPath = scriptPathOf(tmpDir);
      fs.chmodSync(scriptPath, 0o777);

      removeClaudeHook(tmpDir);
      installClaudeHook(tmpDir);

      expect((fs.statSync(scriptPath).mode & 0o7777).toString(8)).toBe('777');
    });

    it('D5 首次创建的脚本给默认 0755（保全只针对已存在的文件）', () => {
      installClaudeHook(tmpDir);

      expect((fs.statSync(scriptPathOf(tmpDir)).mode & 0o7777).toString(8)).toBe('755');
    });

    it('D6 .bak 已存在时不覆盖，保留最早那一份内容', () => {
      // 备份的价值恰恰在于"最早那一份"（用户的原始文件），而不是"上一次合并的结果"。
      // 顶掉它等于把用户唯一的回滚点换成一份我们自己写出来的中间态。
      const { bak } = settingsPaths(tmpDir);
      seedUserSettings(tmpDir, { mine: 'important' });
      const precious = JSON.stringify({ precious: 'earlier-backup' }, null, 2);
      fs.writeFileSync(bak, precious, 'utf-8');

      installClaudeHook(tmpDir);

      expect(fs.readFileSync(bak, 'utf-8')).toBe(precious);
    });

    it('D6 removeClaudeHook 卸载路径也创建 .bak（与 install 对称）', () => {
      // 卸载同样是对用户文件的一次改写，误删后没有备份就无从回滚。
      installClaudeHook(tmpDir);
      const { settings, bak } = settingsPaths(tmpDir);
      const beforeRemove = fs.readFileSync(settings, 'utf-8');

      removeClaudeHook(tmpDir);

      expect(fs.existsSync(bak)).toBe(true);
      expect(fs.readFileSync(bak, 'utf-8')).toBe(beforeRemove);
    });

    it('D6 卸载不顶掉安装时留下的那份 .bak', () => {
      seedUserSettings(tmpDir, { mine: 'important' });
      const { bak } = settingsPaths(tmpDir);
      const original = fs.readFileSync(settingsPaths(tmpDir).settings, 'utf-8');

      installClaudeHook(tmpDir);
      removeClaudeHook(tmpDir);

      expect(fs.readFileSync(bak, 'utf-8')).toBe(original);
    });

    it('D2 消费方视角：用户的 settings.json 0600 在安装/卸载后仍是 0600', () => {
      seedUserSettings(tmpDir, { mine: 'important' });
      const { settings } = settingsPaths(tmpDir);
      fs.chmodSync(settings, 0o600);

      installClaudeHook(tmpDir);
      expect((fs.statSync(settings).mode & 0o7777).toString(8)).toBe('600');

      removeClaudeHook(tmpDir);
      expect((fs.statSync(settings).mode & 0o7777).toString(8)).toBe('600');
    });
  });

  // ─── F267 对抗审查引入的回归护栏 ─────────────────────────────────────────

  it('脚本权限 0777 被如实保全（不替用户收紧），但组/他人可写时必须告警', () => {
    // 用户裁决：保全 + 兜底可执行 + 告警。改动前的 `chmod 0755` 会把 0777 收窄——那是加固，
    // 不是本卡要修的缺陷；但这个文件会被当命令执行，世界可写的风险必须让用户看见。
    const root = tmpDir;
    const scriptPath = path.join(root, 'specs', '_meta', 'hooks', 'spectra-context.sh');
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, '#!/bin/bash\nexit 0\n', 'utf-8');
    fs.chmodSync(scriptPath, 0o777);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    installClaudeHook(root);

    expect((fs.statSync(scriptPath).mode & 0o7777).toString(8)).toBe('777');
    expect(warn.mock.calls.some(c => /组\/其他用户可写/.test(String(c[0])))).toBe(true);
  });

  it('脚本权限 0200（不可执行）：补足 owner 读+执行位，不报假成功', () => {
    // 保全成"装完却 100% 跑不起来"的状态、同时打印 installed，是在说假话。
    const root = tmpDir;
    const scriptPath = path.join(root, 'specs', '_meta', 'hooks', 'spectra-context.sh');
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, '#!/bin/bash\nexit 0\n', 'utf-8');
    fs.chmodSync(scriptPath, 0o200);

    installClaudeHook(root);

    const mode = fs.statSync(scriptPath).mode & 0o7777;
    expect(mode & 0o500).toBe(0o500);
    expect(mode.toString(8)).toBe('700');
  });

  it('.bak 已存在但不可用（空文件）时如实告警，不谎称"已保留最早备份"', () => {
    const root = tmpDir;
    const settingsPath = path.join(root, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ mine: 'important' }), 'utf-8');
    fs.writeFileSync(`${settingsPath}.bak`, '', 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    installClaudeHook(root);

    expect(warn.mock.calls.some(c => /没有.*可回滚的备份/.test(String(c[0])))).toBe(true);
    expect(log.mock.calls.some(c => /保留最早备份/.test(String(c[0])))).toBe(false);
  });

  it('卸载路径：备份失败不阻断卸载（best-effort）', () => {
    // 卸载是用户的止损动作。改动前它零备份、必定成功；加了备份后若让备份失败拦死卸载，
    // 用户会被锁在一个想撤销却撤销不掉的状态里（对抗审查用真实磁盘满场景实证过）。
    // 这里用一个确定性的等价构造制造"备份写不进去但目标写得进去"：
    // `.claude/` 只读（`.bak` 落在这里 → EACCES），而 settings.json 是软链、真实文件在可写目录。
    const root = tmpDir;
    const claudeDir = path.join(root, '.claude');
    const realDir = path.join(root, 'dotfiles');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.mkdirSync(realDir, { recursive: true });
    const realSettings = path.join(realDir, 'settings.json');
    fs.writeFileSync(
      realSettings,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Glob|Grep', command: 'bash specs/_meta/hooks/spectra-context.sh' },
          ],
        },
      }),
      'utf-8',
    );
    fs.symlinkSync(realSettings, path.join(claudeDir, 'settings.json'));
    fs.chmodSync(claudeDir, 0o555);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      expect(() => removeClaudeHook(root)).not.toThrow();

      const after = JSON.parse(fs.readFileSync(realSettings, 'utf-8')) as {
        hooks: { PreToolUse: unknown[] };
      };
      expect(after.hooks.PreToolUse).toEqual([]);
      expect(fs.existsSync(path.join(claudeDir, 'settings.json.bak'))).toBe(false);
    } finally {
      fs.chmodSync(claudeDir, 0o755);
    }
  });
});