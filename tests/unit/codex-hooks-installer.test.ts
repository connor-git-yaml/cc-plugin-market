/**
 * Feature 240 / T020 — `$CODEX_HOME/hooks.json` 合并写入器（FR-011 / SC-008）
 *
 * 被测对象：`plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs`
 *
 * 🔴 本用例集守护的核心不变量是**用户数据不丢失**。`$CODEX_HOME/hooks.json` 是全局唯一共享
 * 文件（`_grounding.md` §8.1），里面可能有用户自己或其他工具写的条目；写入器只允许增删
 * `isOwnedEntry` 为真的条目，其余一切（含顶层未知字段、非我方形状的畸形条目）必须逐字节保留。
 *
 * 覆盖 SC-008 七条语义 (a)~(g) + `isOwnedEntry` 三条负向用例（plan §6.3）。
 *
 * 运行：npx vitest run tests/unit/codex-hooks-installer.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALLER_URL = new URL(
  '../../plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs',
  import.meta.url,
).href;
const GENERATOR_URL = new URL(
  '../../plugins/spec-driver/scripts/lib/codex-hooks-generator.mjs',
  import.meta.url,
).href;
const installer = await import(INSTALLER_URL);
const generator = await import(GENERATOR_URL);

const CANONICAL_HOOKS_JSON = path.join(repoRoot, 'plugins', 'spec-driver', 'hooks', 'hooks.json');
const PLUGIN_ROOT = path.join(repoRoot, 'plugins', 'spec-driver');
/** 模拟「插件升级到新版本目录」——归属锚点要求路径含 spec-driver 分量 */
const UPGRADED_PLUGIN_ROOT = '/opt/plugin-cache/spec-driver/9.9.9';

type HookHandler = { type?: unknown; command?: unknown; [key: string]: unknown };
type HookGroup = { matcher?: unknown; hooks?: unknown; [key: string]: unknown };
type HooksDoc = { hooks?: Record<string, unknown>; [key: string]: unknown };

function canonical(): unknown {
  return JSON.parse(fs.readFileSync(CANONICAL_HOOKS_JSON, 'utf-8')) as unknown;
}

function entriesFor(pluginRoot: string): { hooks: Record<string, unknown[]> } {
  return generator.generateCodexHooks({ canonical: canonical(), pluginRoot }) as {
    hooks: Record<string, unknown[]>;
  };
}

/** 展开文档中的全部 handler（含事件名），用于计数与字段检查 */
function allHandlers(doc: HooksDoc): Array<{ event: string; handler: HookHandler }> {
  const out: Array<{ event: string; handler: HookHandler }> = [];
  const hooks = (doc.hooks ?? {}) as Record<string, unknown>;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups as HookGroup[]) {
      if (typeof group !== 'object' || group === null) continue;
      if (!Array.isArray(group.hooks)) continue;
      for (const handler of group.hooks as HookHandler[]) {
        if (typeof handler === 'object' && handler !== null) out.push({ event, handler });
      }
    }
  }
  return out;
}

function ownedHandlers(doc: HooksDoc): HookHandler[] {
  return allHandlers(doc)
    .filter(({ handler }) => installer.isOwnedEntry(handler.command))
    .map(({ handler }) => handler);
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** 第三方条目 fixture：既不含我方脚本名，也不含 spec-driver 目录分量 */
const FOREIGN_PERMISSION = {
  matcher: 'vendor',
  hooks: [{ type: 'command', command: 'bash /opt/vendor/permission.sh', timeout: 30 }],
};
const FOREIGN_STOP = {
  matcher: '',
  hooks: [{ type: 'command', command: 'bash /opt/vendor/stop.sh' }],
};
const FOREIGN_DOC = {
  description: '用户自己的 hooks',
  vendorField: { keep: true },
  hooks: {
    PermissionRequest: [FOREIGN_PERMISSION],
    Stop: [FOREIGN_STOP],
  },
};

describe('codex-hooks-installer', () => {
  let codexHome: string;
  let target: string;

  beforeEach(() => {
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'f240-installer-'));
    target = path.join(codexHome, 'hooks.json');
  });

  afterEach(() => {
    fs.rmSync(codexHome, { recursive: true, force: true });
  });

  function seedForeign(doc: unknown = FOREIGN_DOC): string {
    const raw = `${JSON.stringify(doc, null, 2)}\n`;
    fs.writeFileSync(target, raw, 'utf-8');
    return raw;
  }

  function readTarget(): HooksDoc {
    return JSON.parse(fs.readFileSync(target, 'utf-8')) as HooksDoc;
  }

  // ─── (a) 合并而非覆写 ────────────────────────────────────────────────────

  describe('(a) 合并而非覆写', () => {
    it('第三方条目、顶层未知字段、非我方事件键全部原样保留', () => {
      seedForeign();

      const result = installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      expect(result.ok).toBe(true);
      expect(result.changed).toBe(true);

      const merged = readTarget();
      expect(merged['description']).toBe('用户自己的 hooks');
      expect(merged['vendorField']).toEqual({ keep: true });
      // 第三方条目逐字节（结构等价 + 字段顺序）保留
      expect(JSON.stringify(merged.hooks!['PermissionRequest'])).toBe(
        JSON.stringify([FOREIGN_PERMISSION]),
      );
      const stopGroups = merged.hooks!['Stop'] as unknown[];
      expect(JSON.stringify(stopGroups[0])).toBe(JSON.stringify(FOREIGN_STOP));
      // 我方 5 个 handler 就位
      expect(ownedHandlers(merged)).toHaveLength(6);
    });

    it('目标文件不存在时创建目录与文件，且只含我方条目', () => {
      const nested = path.join(codexHome, 'deep', 'nest');
      const result = installer.installCodexHooks({
        codexHome: nested,
        entries: entriesFor(PLUGIN_ROOT),
      });
      expect(result.changed).toBe(true);
      const doc = JSON.parse(fs.readFileSync(path.join(nested, 'hooks.json'), 'utf-8')) as HooksDoc;
      expect(ownedHandlers(doc)).toHaveLength(6);
      expect(Object.keys(doc.hooks!).sort()).toEqual(
        ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'].sort(),
      );
    });

    it('我方条目追加在同事件既有第三方条目之后，不打乱第三方顺序', () => {
      seedForeign();
      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      const stopGroups = readTarget().hooks!['Stop'] as HookGroup[];
      expect(stopGroups).toHaveLength(3); // 1 第三方 + 2 我方
      expect(JSON.stringify(stopGroups[0])).toBe(JSON.stringify(FOREIGN_STOP));
      expect(installer.isOwnedEntry((stopGroups[1].hooks as HookHandler[])[0].command)).toBe(true);
    });
  });

  // ─── (b) 幂等 ────────────────────────────────────────────────────────────

  describe('(b) 幂等', () => {
    it('重复安装不产生重复条目，且第二次为无变更（不写文件、不产生备份）', () => {
      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      const firstRaw = fs.readFileSync(target, 'utf-8');

      const second = installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });

      expect(second.changed).toBe(false);
      expect(second.backupPath).toBeNull();
      expect(fs.readFileSync(target, 'utf-8')).toBe(firstRaw);
      expect(ownedHandlers(readTarget())).toHaveLength(6);
    });

    it('幂等语义取「原地更新」：插件根变化时替换旧路径，条目数恒不变、无旧路径残留', () => {
      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      const upgraded = installer.installCodexHooks({
        codexHome,
        entries: entriesFor(UPGRADED_PLUGIN_ROOT),
      });

      expect(upgraded.changed).toBe(true);
      const doc = readTarget();
      expect(ownedHandlers(doc)).toHaveLength(6);
      const raw = fs.readFileSync(target, 'utf-8');
      expect(raw).toContain(UPGRADED_PLUGIN_ROOT);
      expect(raw).not.toContain(PLUGIN_ROOT);
    });

    it('第三方条目在重复安装后仍逐字节保留', () => {
      seedForeign();
      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      installer.installCodexHooks({ codexHome, entries: entriesFor(UPGRADED_PLUGIN_ROOT) });
      installer.installCodexHooks({ codexHome, entries: entriesFor(UPGRADED_PLUGIN_ROOT) });

      const doc = readTarget();
      expect(JSON.stringify(doc.hooks!['PermissionRequest'])).toBe(
        JSON.stringify([FOREIGN_PERMISSION]),
      );
      expect(JSON.stringify((doc.hooks!['Stop'] as unknown[])[0])).toBe(JSON.stringify(FOREIGN_STOP));
      expect(ownedHandlers(doc)).toHaveLength(6);
    });
  });

  // ─── (c) 精确卸载 ────────────────────────────────────────────────────────

  describe('(c) 精确卸载', () => {
    it('卸载只移除我方条目，第三方条目与顶层字段逐字节保留', () => {
      const before = seedForeign();
      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });

      const result = installer.removeCodexHooks({ codexHome });

      expect(result.ok).toBe(true);
      expect(result.removedCount).toBe(6);
      const doc = readTarget();
      expect(ownedHandlers(doc)).toHaveLength(0);
      expect(JSON.stringify(doc.hooks!['PermissionRequest'])).toBe(
        JSON.stringify([FOREIGN_PERMISSION]),
      );
      expect(JSON.stringify(doc.hooks!['Stop'])).toBe(JSON.stringify([FOREIGN_STOP]));
      expect(doc['description']).toBe('用户自己的 hooks');
      expect(doc['vendorField']).toEqual({ keep: true });
      // 结构等价于安装前（只是序列化缩进可能不同）
      expect(JSON.stringify(doc)).toBe(JSON.stringify(JSON.parse(before)));
    });

    it('卸载后因清空而残留的事件键被一并删除，第三方事件键保留', () => {
      seedForeign();
      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      installer.removeCodexHooks({ codexHome });

      const doc = readTarget();
      // SessionStart / PreToolUse / PostToolUse 只有我方条目 → 键被删
      expect(Object.keys(doc.hooks!).sort()).toEqual(['PermissionRequest', 'Stop'].sort());
    });

    it('同一 group 内我方与第三方 handler 混排时，只摘掉我方 handler，group 与其余 handler 保留', () => {
      const mixed = {
        hooks: {
          Stop: [
            {
              matcher: 'mixed',
              extraField: 'keep-me',
              hooks: [
                { type: 'command', command: 'bash /opt/vendor/a.sh' },
                { type: 'command', command: `bash ${PLUGIN_ROOT}/hooks/stop-task-check.sh` },
                { type: 'command', command: 'bash /opt/vendor/b.sh' },
              ],
            },
          ],
        },
      };
      seedForeign(mixed);

      const result = installer.removeCodexHooks({ codexHome });

      expect(result.removedCount).toBe(1);
      const group = (readTarget().hooks!['Stop'] as HookGroup[])[0];
      expect(group['extraField']).toBe('keep-me');
      expect(group['matcher']).toBe('mixed');
      expect((group.hooks as HookHandler[]).map((h) => h.command)).toEqual([
        'bash /opt/vendor/a.sh',
        'bash /opt/vendor/b.sh',
      ]);
    });

    it('目标文件不存在 / 无我方条目时不抛错、不写文件', () => {
      const missing = installer.removeCodexHooks({ codexHome });
      expect(missing.ok).toBe(true);
      expect(missing.removedCount).toBe(0);
      expect(fs.existsSync(target)).toBe(false);

      const before = seedForeign();
      const noop = installer.removeCodexHooks({ codexHome });
      expect(noop.removedCount).toBe(0);
      expect(noop.changed).toBe(false);
      expect(fs.readFileSync(target, 'utf-8')).toBe(before);
      expect(fs.existsSync(`${target}.bak`)).toBe(false);
    });

    it('安装→卸载→安装 循环后条目数恒定，无累积残留', () => {
      seedForeign();
      for (let i = 0; i < 3; i += 1) {
        installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
        expect(ownedHandlers(readTarget())).toHaveLength(6);
        installer.removeCodexHooks({ codexHome });
        expect(ownedHandlers(readTarget())).toHaveLength(0);
      }
    });
  });

  // ─── (d) 归属锚点用 command 字符串，禁用自定义 JSON 字段 ──────────────────

  describe('(d) 归属锚点', () => {
    it('写入的我方 handler 只含 canonical 自带字段，无任何自定义标记字段', () => {
      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      for (const handler of ownedHandlers(readTarget())) {
        expect(Object.keys(handler).sort()).toEqual(['command', 'type']);
      }
      const raw = fs.readFileSync(target, 'utf-8');
      for (const forbidden of ['spec-driver-hook', 'ownedBy', '_owner', 'managedBy', 'x-spectra']) {
        expect(raw).not.toContain(forbidden);
      }
    });

    it.each([
      ['bash /opt/other/postinstall.sh', '同名脚本但无 spec-driver 目录分量'],
      ['bash /home/u/spec-driver-notes/postinstall.sh', 'spec-driver-notes 不是精确目录分量'],
      ['bash /x/spec-driver/other.sh', 'basename 不在我方脚本集合内'],
    ])('负向：%s（%s）→ isOwnedEntry 为 false', (command) => {
      expect(installer.isOwnedEntry(command)).toBe(false);
    });

    // 🔴 W1 回归钉子：以下每一条都是审查方**实跑构造**、旧实现判 OWNED（会被静默删除）的
    // 第三方命令。归属误认的后果是删除用户数据、不可逆，故这组用例不可放宽。
    it.each([
      [
        'bash /opt/othertool/spec-driver/postinstall.sh',
        '第三方目录恰好叫 spec-driver，但缺少 scripts/ 这一级完整后缀',
      ],
      [
        'echo /x/spec-driver/postinstall.sh > /tmp/log',
        '实际执行的是 echo；且路径缺 scripts/ 后缀',
      ],
      [
        'logger "installed /x/spec-driver/stop-task-check.sh"',
        '只是日志文本；且路径缺 hooks/ 后缀',
      ],
      [
        'VAR=/x/spec-driver/postinstall.sh /usr/bin/vendor-tool',
        '执行的是别的程序；且路径缺 scripts/ 后缀',
      ],
      [
        'bash /x/spec-driver/hooks/../../evil/postinstall.sh',
        '用 .. 逃逸出 spec-driver 根',
      ],
      [
        'bash /x/scripts/spec-driver/postinstall.sh',
        'spec-driver 分量出现在后缀之后（顺序错位）',
      ],
    ])('🔴 W1 负向：%s（%s）→ isOwnedEntry 为 false', (command) => {
      expect(installer.isOwnedEntry(command)).toBe(false);
    });

    it.each([
      `bash ${PLUGIN_ROOT}/hooks/stop-task-check.sh`,
      `bash ${UPGRADED_PLUGIN_ROOT}/scripts/postinstall.sh`,
      `bash '/opt/my plugins/spec-driver/hooks/pre-tool-use-guard.sh'`,
    ])('正向：%s → isOwnedEntry 为 true', (command) => {
      expect(installer.isOwnedEntry(command)).toBe(true);
    });
  });

  // ─── (e) 写入前备份 ──────────────────────────────────────────────────────

  describe('(e) 写入前备份', () => {
    it('目标存在且有变更时，.bak 内容逐字节等于写入前原文', () => {
      const before = seedForeign();
      const result = installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });

      expect(result.backupPath).toBe(`${target}.bak`);
      expect(fs.readFileSync(`${target}.bak`, 'utf-8')).toBe(before);
    });

    it('目标不存在时不产生备份（无可备份内容）', () => {
      const result = installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      expect(result.backupPath).toBeNull();
      expect(fs.existsSync(`${target}.bak`)).toBe(false);
    });

    it('无变更的重复安装不覆盖已有 .bak（原始备份不被合并后的内容顶掉）', () => {
      const before = seedForeign();
      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });

      expect(fs.readFileSync(`${target}.bak`, 'utf-8')).toBe(before);
    });

    it('🔴 W3：版本升级（pluginRoot 变化）这类真实变更也不得顶掉最初那份 .bak', () => {
      // 「无变更就不写」挡不住这条：升级是真实语义变更，第二次安装确有写入。
      // 若此时覆写备份，用户**原始**的 hooks.json 就永久消失了 —— 与归属误认叠加即不可逆。
      const before = seedForeign();
      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      expect(fs.readFileSync(`${target}.bak`, 'utf-8')).toBe(before);

      const upgraded = installer.installCodexHooks({
        codexHome,
        entries: entriesFor(UPGRADED_PLUGIN_ROOT),
      });

      expect(upgraded.changed).toBe(true);
      expect(fs.readFileSync(`${target}.bak`, 'utf-8')).toBe(before);
      expect(upgraded.diagnostics.map((d: { code: string }) => d.code)).toContain(
        'backup-already-exists',
      );
    });

    it('🔴 W3：卸载同样不顶掉最初那份 .bak', () => {
      const before = seedForeign();
      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });

      installer.removeCodexHooks({ codexHome });

      expect(fs.readFileSync(`${target}.bak`, 'utf-8')).toBe(before);
    });
  });

  // ─── (h) 权限位保全（F262 / W3）─────────────────────────────────────────

  describe('(h) 权限位保全（W3）', () => {
    it('目标原有 0600 → 写入后仍是 0600（rename 换 inode 不得把用户私密配置放宽成 0644）', () => {
      seedForeign();
      fs.chmodSync(target, 0o600);

      const result = installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });

      expect(result.changed).toBe(true);
      expect((fs.statSync(target).mode & 0o777).toString(8)).toBe((0o600).toString(8));
      // 权限保全不能是"写坏内容换来的"
      expect(ownedHandlers(readTarget())).toHaveLength(6);
    });

    it('目标原有 setgid 高位（2640）→ 高位一并保全（`& 0o777` 掩码会静默丢掉 setgid）', () => {
      seedForeign();
      fs.chmodSync(target, 0o2640);

      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });

      expect((fs.statSync(target).mode & 0o7777).toString(8)).toBe((0o2640).toString(8));
    });

    it('目标不存在（首次创建）且 umask 宽松（000）→ 落 0600，绝不世界可写', () => {
      // 🔴 hooks.json 的内容会被 Codex 当命令执行；umask 000 下按默认 mode 创建就是 0666
      // （世界可写）＝ 本地注入面。
      // 用**子进程**设 umask 而不是 `process.umask()`：后者是进程级全局状态，
      // 会污染同一 vitest worker 里并行跑的其他用例。
      const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'f262-umask-'));
      const helper = path.join(sandbox, 'first-create.mjs');
      const freshHome = path.join(sandbox, 'codex-home');
      fs.writeFileSync(
        helper,
        [
          "import fs from 'node:fs';",
          'const [installerUrl, generatorUrl, canonicalPath, pluginRoot, codexHome] = process.argv.slice(2);',
          'const { installCodexHooks } = await import(installerUrl);',
          'const { generateCodexHooks } = await import(generatorUrl);',
          "const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf-8'));",
          'installCodexHooks({ codexHome, entries: generateCodexHooks({ canonical, pluginRoot }) });',
          "process.stdout.write((fs.statSync(`${codexHome}/hooks.json`).mode & 0o7777).toString(8));",
          '',
        ].join('\n'),
        'utf-8',
      );
      try {
        const argv = [helper, INSTALLER_URL, GENERATOR_URL, CANONICAL_HOOKS_JSON, PLUGIN_ROOT, freshHome]
          .map((value) => `'${value}'`)
          .join(' ');
        const result = spawnSync('bash', ['-c', `umask 000; node ${argv}`], {
          encoding: 'utf-8',
          timeout: 60_000,
        });
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout).toBe((0o600).toString(8));
      } finally {
        fs.rmSync(sandbox, { recursive: true, force: true });
      }
    });

    it('🔴 W-3：首次创建的目录在 umask 000 下也是 0700（0777 目录里谁都能 unlink 掉 0600 文件）', () => {
      // 文件位收紧到 0600 并不关闭注入面：目录若是 0777，同机任何本地用户都能把 hooks.json
      // unlink 掉再放一份自己的进来 —— 内容会被 Codex 当命令执行。
      const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'f262-dirmode-'));
      const helper = path.join(sandbox, 'first-create-dir.mjs');
      const freshHome = path.join(sandbox, 'codex-home', 'deep');
      fs.writeFileSync(
        helper,
        [
          "import fs from 'node:fs';",
          'const [installerUrl, generatorUrl, canonicalPath, pluginRoot, codexHome] = process.argv.slice(2);',
          'const { installCodexHooks } = await import(installerUrl);',
          'const { generateCodexHooks } = await import(generatorUrl);',
          "const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf-8'));",
          'installCodexHooks({ codexHome, entries: generateCodexHooks({ canonical, pluginRoot }) });',
          'process.stdout.write((fs.statSync(codexHome).mode & 0o7777).toString(8));',
          '',
        ].join('\n'),
        'utf-8',
      );
      try {
        const argv = [helper, INSTALLER_URL, GENERATOR_URL, CANONICAL_HOOKS_JSON, PLUGIN_ROOT, freshHome]
          .map((value) => `'${value}'`)
          .join(' ');
        const result = spawnSync('bash', ['-c', `umask 000; node ${argv}`], {
          encoding: 'utf-8',
          timeout: 60_000,
        });
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout).toBe((0o700).toString(8));
      } finally {
        fs.rmSync(sandbox, { recursive: true, force: true });
      }
    });

    it('tmp 文件创建即 0600：内容全程没有一个"更宽权限"的暴露窗口', () => {
      const spy = vi.spyOn(fs, 'writeFileSync');
      try {
        installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
        const tmpWrites = spy.mock.calls.filter(
          ([file]) => typeof file === 'string' && file.startsWith(`${target}.tmp.`),
        );
        expect(tmpWrites).toHaveLength(1);
        const options = tmpWrites[0][2];
        expect(typeof options).toBe('object');
        expect((options as { mode?: number }).mode).toBe(0o600);
        // I-1：`wx`（O_EXCL）—— tmp 路径被预置成软链/已有文件时报错走清理分支，
        // 而不是顺着别人的软链把内容写到未知位置
        expect((options as { flag?: string }).flag).toBe('wx');
      } finally {
        spy.mockRestore();
      }
    });

    it('chmod 失败（无权限位文件系统）→ 降级继续：安装照常成功 + target-mode-preserve-failed 诊断', () => {
      // 放宽面在 exFAT/SMB 这类 FS 上本就不存在；为一个锦上添花的元数据动作新增阻断面
      // 反而会让本可正常写入的 hooks 装不上。
      seedForeign();
      const spy = vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
        const error: NodeJS.ErrnoException = new Error('operation not supported');
        error.code = 'ENOTSUP';
        throw error;
      });
      try {
        const result = installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });

        expect(result.ok).toBe(true);
        expect(result.changed).toBe(true);
        expect(ownedHandlers(readTarget())).toHaveLength(6);
        expect(result.diagnostics.map((d: { code: string }) => d.code)).toContain(
          'target-mode-preserve-failed',
        );
        // 降级不等于留残渣：tmp 文件不得遗留在用户的 $CODEX_HOME
        expect(fs.readdirSync(codexHome).filter((name) => name.includes('.tmp.'))).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ─── 被摘除条目的可观测性（W1 第 2 条）────────────────────────────────────

  describe('owned-entry-removed 诊断', () => {
    it('卸载时每一条被摘除的 command 都逐条进 diagnostics（误删可见可回滚）', () => {
      seedForeign();
      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });

      const result = installer.removeCodexHooks({ codexHome });

      const removed = result.diagnostics.filter(
        (d: { code: string }) => d.code === 'owned-entry-removed',
      );
      expect(removed).toHaveLength(6);
      expect(new Set(removed.map((d: { command: string }) => d.command)).size).toBe(6);
      for (const diagnostic of removed) {
        expect(diagnostic.command).toContain(PLUGIN_ROOT);
      }
      expect(result.removedCommands).toHaveLength(6);
    });

    it('版本升级时旧路径条目被登记为已移除；原样写回的条目不登记（不淹没真信号）', () => {
      installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });

      const upgraded = installer.installCodexHooks({
        codexHome,
        entries: entriesFor(UPGRADED_PLUGIN_ROOT),
      });
      const removed = upgraded.diagnostics.filter(
        (d: { code: string }) => d.code === 'owned-entry-removed',
      );
      expect(removed).toHaveLength(6);
      for (const diagnostic of removed) {
        expect(diagnostic.command).toContain(PLUGIN_ROOT);
      }

      // 幂等的正常重装：条目被摘掉又原样写回，不是删除
      const again = installer.installCodexHooks({
        codexHome,
        entries: entriesFor(UPGRADED_PLUGIN_ROOT),
      });
      expect(
        again.diagnostics.filter((d: { code: string }) => d.code === 'owned-entry-removed'),
      ).toEqual([]);
    });
  });

  // ─── projectForeignOnly：第三方保全判据的投影函数（此前零直接覆盖）────────

  describe('projectForeignOnly（C1）', () => {
    const owned = {
      matcher: '',
      hooks: [{ type: 'command', command: `bash ${PLUGIN_ROOT}/hooks/stop-task-check.sh` }],
    };

    it('正常文档：摘掉我方条目，第三方条目与顶层字段原样保留', () => {
      const projected = installer.projectForeignOnly({
        description: 'x',
        hooks: { Stop: [FOREIGN_STOP, owned], PermissionRequest: [FOREIGN_PERMISSION] },
      }) as HooksDoc;

      expect(projected['description']).toBe('x');
      expect(JSON.stringify(projected.hooks!['Stop'])).toBe(JSON.stringify([FOREIGN_STOP]));
      expect(JSON.stringify(projected.hooks!['PermissionRequest'])).toBe(
        JSON.stringify([FOREIGN_PERMISSION]),
      );
    });

    it('只剩我方条目的事件键被丢弃（投影里不留我方制造的空壳）', () => {
      const projected = installer.projectForeignOnly({ hooks: { Stop: [owned] } }) as HooksDoc;
      expect(Object.keys(projected.hooks!)).toEqual([]);
    });

    it('🔴 顶层非对象 MUST 保留原值，不得坍缩成 {hooks:{}}', () => {
      // 坍缩会让「安装前是用户数组文档 / 安装后是标准对象」两侧投影相等 ⇒ 保全判据假 pass。
      const raw = [{ hooks: { Stop: [FOREIGN_STOP] } }];
      const projected = installer.projectForeignOnly(raw) as Record<string, unknown>;

      expect(projected[installer.RAW_DOCUMENT_KEY]).toEqual(raw);
      expect(JSON.stringify(projected)).not.toBe(
        JSON.stringify(installer.projectForeignOnly({ hooks: {} })),
      );
    });

    it('🔴 hooks 字段非对象 MUST 保留原值，不得坍缩成 {}', () => {
      const rawHooks = [{ matcher: 'vendor', hooks: [{ type: 'command', command: 'bash /v.sh' }] }];
      const projected = installer.projectForeignOnly({ hooks: rawHooks }) as HooksDoc;

      expect((projected.hooks as Record<string, unknown>)[installer.RAW_HOOKS_KEY]).toEqual(rawHooks);
      expect(JSON.stringify(projected)).not.toBe(
        JSON.stringify(installer.projectForeignOnly({ hooks: {} })),
      );
    });

    it('是纯函数：不改动入参', () => {
      const doc = { hooks: { Stop: [FOREIGN_STOP, owned] } };
      const before = JSON.stringify(doc);
      installer.projectForeignOnly(doc);
      expect(JSON.stringify(doc)).toBe(before);
    });

    it('🔴 已知盲区（由命令字面量判据补偿）：被归属谓词误认的第三方条目在两侧同时消失', () => {
      // 这条断言不是"期望的行为"，而是**把结构性失明本身钉死**：
      // 投影与写入器共用 isOwnedEntry ⇒ 谓词过度认领时差异被抹平，投影判据必然假 pass。
      // 因此 validate CLI MUST 另有一条不经过归属谓词的口径（foreign-command-lost）。
      const misclaimed = {
        matcher: 'vendor',
        hooks: [{ type: 'command', command: 'bash /opt/other/spec-driver/scripts/postinstall.sh' }],
      };
      expect(installer.isOwnedEntry(misclaimed.hooks[0].command)).toBe(true);

      const before = installer.projectForeignOnly({ hooks: { Stop: [misclaimed] } });
      const after = installer.projectForeignOnly({ hooks: {} });

      expect(JSON.stringify(before)).toBe(JSON.stringify(after));
    });
  });

  // ─── (f) 非法 JSON：报错且零写操作 ───────────────────────────────────────

  describe('(f) 非法 JSON', () => {
    const BAD = '{ "hooks": { invalid json }}}';

    it('install 抛错，且抛错前无任何写操作（sha256 不变、无 .bak、无 .tmp 残留）', () => {
      fs.writeFileSync(target, BAD, 'utf-8');
      const before = sha256(target);

      expect(() => installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) })).toThrow(
        /hooks\.json/,
      );

      expect(sha256(target)).toBe(before);
      expect(fs.readdirSync(codexHome)).toEqual(['hooks.json']);
    });

    it('remove 同样抛错且不覆写（避免把用户文件洗成空壳）', () => {
      fs.writeFileSync(target, BAD, 'utf-8');
      const before = sha256(target);

      expect(() => installer.removeCodexHooks({ codexHome })).toThrow(/hooks\.json/);

      expect(sha256(target)).toBe(before);
      expect(fs.readdirSync(codexHome)).toEqual(['hooks.json']);
    });

    it('错误信息含目标路径与手工修复指引，不建议用户删文件', () => {
      fs.writeFileSync(target, BAD, 'utf-8');
      let message = '';
      try {
        installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(target);
      expect(message).toContain('手动修复');
    });
  });

  // ─── (g) 类型防御 ────────────────────────────────────────────────────────

  describe('(g) 类型防御', () => {
    it('hooks 字段被写成非对象 → 不崩溃，安装成功并记录诊断', () => {
      seedForeign({ description: 'x', hooks: 'not-an-object' });
      const result = installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });

      expect(result.ok).toBe(true);
      expect(result.diagnostics.map((d: { code: string }) => d.code)).toContain(
        'hooks-field-not-object-replaced',
      );
      expect(ownedHandlers(readTarget())).toHaveLength(6);
      expect(readTarget()['description']).toBe('x');
    });

    it('事件值被写成非数组 → 我方事件替换为数组并诊断；非我方事件原样保留', () => {
      seedForeign({ hooks: { Stop: 'oops', SomeVendorEvent: 'also-oops' } });
      const result = installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });

      expect(result.diagnostics.map((d: { code: string }) => d.code)).toContain(
        'event-value-not-array-replaced',
      );
      const doc = readTarget();
      expect(Array.isArray(doc.hooks!['Stop'])).toBe(true);
      expect(doc.hooks!['SomeVendorEvent']).toBe('also-oops');
    });

    it('group / group.hooks 形状异常 → 原样保留（不属我方形状，不得当垃圾清掉）', () => {
      seedForeign({
        hooks: {
          Stop: [null, 'string-group', { matcher: 'x', hooks: 'not-an-array' }, { noHooksField: 1 }],
        },
      });
      const result = installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      expect(result.ok).toBe(true);

      const stop = readTarget().hooks!['Stop'] as unknown[];
      expect(JSON.stringify(stop.slice(0, 4))).toBe(
        JSON.stringify([null, 'string-group', { matcher: 'x', hooks: 'not-an-array' }, { noHooksField: 1 }]),
      );
      expect(ownedHandlers(readTarget())).toHaveLength(6);
    });

    it('顶层文档被写成数组 / 标量 → 不崩溃，替换为对象并诊断', () => {
      seedForeign([1, 2, 3]);
      const result = installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      expect(result.diagnostics.map((d: { code: string }) => d.code)).toContain(
        'document-not-object-replaced',
      );
      expect(ownedHandlers(readTarget())).toHaveLength(6);
    });

    it('handler 非对象 / command 非字符串 → 不崩溃且原样保留', () => {
      seedForeign({
        hooks: { Stop: [{ matcher: '', hooks: [null, { type: 'command', command: 42 }] }] },
      });
      const result = installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });
      expect(result.ok).toBe(true);
      const first = (readTarget().hooks!['Stop'] as HookGroup[])[0];
      expect(JSON.stringify(first.hooks)).toBe(JSON.stringify([null, { type: 'command', command: 42 }]));
    });
  });

  // ─── 入参守卫与符号链接 ──────────────────────────────────────────────────

  describe('入参守卫', () => {
    it('codexHome 缺失 / 空串 → fail-loud（绝不猜一个全局路径）', () => {
      expect(() => installer.installCodexHooks({ entries: entriesFor(PLUGIN_ROOT) })).toThrow(
        /codexHome/,
      );
      expect(() => installer.installCodexHooks({ codexHome: '', entries: entriesFor(PLUGIN_ROOT) })).toThrow(
        /codexHome/,
      );
      expect(() => installer.removeCodexHooks({})).toThrow(/codexHome/);
    });

    it('entries 形状非法 → fail-loud', () => {
      expect(() => installer.installCodexHooks({ codexHome })).toThrow(/entries/);
      expect(() => installer.installCodexHooks({ codexHome, entries: { hooks: null } })).toThrow(
        /entries/,
      );
    });
  });

  describe('目标为符号链接', () => {
    it('写入跟随符号链接（保留用户的 dotfiles 软链结构），真实文件被更新', () => {
      const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f240-real-'));
      const realFile = path.join(realDir, 'hooks.json');
      try {
        fs.writeFileSync(realFile, `${JSON.stringify(FOREIGN_DOC, null, 2)}\n`, 'utf-8');
        fs.symlinkSync(realFile, target);

        installer.installCodexHooks({ codexHome, entries: entriesFor(PLUGIN_ROOT) });

        expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
        const doc = JSON.parse(fs.readFileSync(realFile, 'utf-8')) as HooksDoc;
        expect(ownedHandlers(doc)).toHaveLength(6);
        expect(JSON.stringify(doc.hooks!['PermissionRequest'])).toBe(
          JSON.stringify([FOREIGN_PERMISSION]),
        );
      } finally {
        fs.rmSync(realDir, { recursive: true, force: true });
      }
    });
  });
});
