/**
 * Feature 240 / T018 — Codex hooks 生成器（FR-001 / FR-005 / SC-001）
 *
 * 核心断言三条：
 * 1. `WorktreeCreate` / `WorktreeRemove` 被过滤（Codex 全集中不存在这两个事件，`_grounding.md` §2）；
 * 2. `${CLAUDE_PLUGIN_ROOT}` 在**生成期**展开为绝对路径 —— `_grounding.md` §8.6 实测 Codex
 *    不注入任何 plugin root 变量，运行期插值会展开为空串，命令变成 `bash /hooks/x.sh` 必然失败；
 * 3. 产物中不残留任何 `${` 插值，事件名恒为 PascalCase。
 *
 * 运行：npx vitest run tests/unit/codex-hooks-generator.test.ts
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const generator = await import(
  new URL('../../plugins/spec-driver/scripts/lib/codex-hooks-generator.mjs', import.meta.url).href
);
const schemaModule = await import(
  new URL('../../plugins/spec-driver/scripts/lib/codex-hooks-schema.mjs', import.meta.url).href
);

const PLUGIN_ROOT = path.join(repoRoot, 'plugins', 'spec-driver');
const CANONICAL_HOOKS_JSON = path.join(PLUGIN_ROOT, 'hooks', 'hooks.json');

function readCanonical(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(CANONICAL_HOOKS_JSON, 'utf-8'));
}

function allCommands(generated: { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }): string[] {
  return Object.values(generated.hooks).flatMap((groups) =>
    groups.flatMap((group) => group.hooks.map((h) => h.command)),
  );
}

describe('codex-hooks-generator', () => {
  it('从 canonical hooks.json 派生（不存在并列的 hooks.codex.json 声明文件）', () => {
    expect(fs.existsSync(CANONICAL_HOOKS_JSON)).toBe(true);
    // 🔴 双份声明必然漂移：Codex 侧声明 MUST 由 canonical 派生，不得新建并列文件
    expect(fs.existsSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.codex.json'))).toBe(false);
    expect(generator.CANONICAL_HOOKS_RELATIVE_PATH).toBe('hooks/hooks.json');
  });

  it('Worktree 系列事件被过滤，只产出 Codex 4 事件（PascalCase）', () => {
    const generated = generator.generateCodexHooks({
      canonical: readCanonical(),
      pluginRoot: PLUGIN_ROOT,
    });
    const events = Object.keys(generated.hooks);
    expect(events).toEqual(['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']);
    expect(events).not.toContain('WorktreeCreate');
    expect(events).not.toContain('WorktreeRemove');
    for (const event of events) {
      expect(event).toMatch(/^[A-Z][A-Za-z]*$/);
    }
  });

  it('${CLAUDE_PLUGIN_ROOT} 展开为绝对路径，产物零 `${` 残留', () => {
    const generated = generator.generateCodexHooks({
      canonical: readCanonical(),
      pluginRoot: PLUGIN_ROOT,
    });
    const commands = allCommands(generated);
    expect(commands.length).toBeGreaterThanOrEqual(5);
    for (const command of commands) {
      expect(command).not.toContain('${');
      expect(command).not.toContain('CLAUDE_PLUGIN_ROOT');
      expect(command).toContain(`${PLUGIN_ROOT}/`);
    }
    // 整份产物序列化后也不得含插值痕迹
    expect(JSON.stringify(generated)).not.toContain('${');
  });

  it('展开后的脚本路径真实存在且 type 恒为 command', () => {
    const generated = generator.generateCodexHooks({
      canonical: readCanonical(),
      pluginRoot: PLUGIN_ROOT,
    });
    for (const groups of Object.values(generated.hooks)) {
      for (const group of groups as Array<{ hooks: Array<{ type: string; command: string }> }>) {
        for (const handler of group.hooks) {
          expect(handler.type).toBe('command');
          const scriptPath = handler.command.split(' ').slice(-1)[0];
          expect(path.isAbsolute(scriptPath)).toBe(true);
          expect(fs.existsSync(scriptPath)).toBe(true);
        }
      }
    }
  });

  it('matcher 逐字保留（本批次不改写 matcher，见模块头注释的范围声明）', () => {
    const canonical = readCanonical();
    const generated = generator.generateCodexHooks({ canonical, pluginRoot: PLUGIN_ROOT });
    const canonicalHooks = canonical['hooks'] as Record<string, Array<{ matcher: string }>>;
    for (const event of Object.keys(generated.hooks)) {
      const got = (generated.hooks[event] as Array<{ matcher: string }>).map((g) => g.matcher);
      const want = canonicalHooks[event].map((g) => g.matcher);
      expect(got).toEqual(want);
    }
  });

  it('pluginRoot 非绝对路径 / 空 / 含换行 → fail-loud', () => {
    const canonical = readCanonical();
    expect(() => generator.generateCodexHooks({ canonical, pluginRoot: 'relative/path' })).toThrow(
      /绝对路径/,
    );
    expect(() => generator.generateCodexHooks({ canonical, pluginRoot: '' })).toThrow();
    expect(() =>
      generator.generateCodexHooks({ canonical, pluginRoot: '/tmp/with\nnewline' }),
    ).toThrow(/换行/);
    expect(() => generator.generateCodexHooks({ canonical })).toThrow();
  });

  it('路径含空格时用 POSIX 单引号包裹（不产出会被 shell 切碎的命令）', () => {
    const canonical = readCanonical();
    const generated = generator.generateCodexHooks({
      canonical,
      pluginRoot: '/tmp/some dir/plugins/spec-driver',
    });
    const commands = allCommands(generated);
    for (const command of commands) {
      // 只有被替换进去的根路径被引号包住，命令其余部分逐字保留；
      // shell 会把相邻的 quoted / unquoted 片段拼成同一个词
      expect(command).toContain("'/tmp/some dir/plugins/spec-driver'/");
    }
    // 归属判定必须能识别引号形态（否则卸载时认不出自己的条目）
    expect(schemaModule.isOwnedEntry(commands[0])).toBe(true);
  });

  it('canonical 出现「既非 4 事件子集、又非 Claude 独有脚本」的事件 → fail-loud，不静默丢弃', () => {
    const canonical = readCanonical() as { hooks: Record<string, unknown> };
    canonical.hooks['UserPromptSubmit'] = [
      { matcher: '', hooks: [{ type: 'command', command: 'bash ${CLAUDE_PLUGIN_ROOT}/hooks/new.sh' }] },
    ];
    expect(() => generator.generateCodexHooks({ canonical, pluginRoot: PLUGIN_ROOT })).toThrow(
      /UserPromptSubmit/,
    );
  });

  it('canonical 结构非法 → fail-loud', () => {
    expect(() => generator.generateCodexHooks({ canonical: null, pluginRoot: PLUGIN_ROOT })).toThrow();
    expect(() =>
      generator.generateCodexHooks({ canonical: { hooks: 'nope' }, pluginRoot: PLUGIN_ROOT }),
    ).toThrow();
  });

  it('🔴 W6：Claude-only 脚本挂到已知产品事件下 → fail-loud（过滤 MUST 做到 handler 级）', () => {
    // 事件级过滤会因为 Stop 在产品集里而直接放行，产出循环再无条件展开该事件下全部 handler，
    // 结果 worktree-lifecycle.sh 被静默装进 Codex —— 那里根本没有对应事件语义。
    const canonical = readCanonical() as { hooks: Record<string, unknown> };
    (canonical.hooks['Stop'] as Array<unknown>).push({
      matcher: '',
      hooks: [{ type: 'command', command: 'bash ${CLAUDE_PLUGIN_ROOT}/hooks/worktree-lifecycle.sh' }],
    });

    expect(() => generator.generateCodexHooks({ canonical, pluginRoot: PLUGIN_ROOT })).toThrow(
      /worktree-lifecycle\.sh/,
    );
  });

  it('🔴 I2：canonical 出现空 groups 的未知事件 → 直接跳过，不抛误导性的「请登记脚本」错误', () => {
    const canonical = readCanonical() as { hooks: Record<string, unknown> };
    canonical.hooks['WorktreeCreate'] = [];

    const generated = generator.generateCodexHooks({ canonical, pluginRoot: PLUGIN_ROOT });

    expect(Object.keys(generated.hooks)).toEqual(['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']);
  });

  it('🔴 W4：路径含 `=` 时必须被引号包裹，否则归属 token 会在 `=` 处被腰斩', () => {
    // SHELL_SAFE 曾把 `=` 视作安全字符（不加引号），而归属判定的 token 切分又把 `=` 当分隔符，
    // 两条规则互相矛盾 ⇒ 实测 install 以 owned-command-not-absolute ×4 硬失败。
    const canonical = readCanonical();
    const rootWithEquals = '/tmp/opt=1/plugins/spec-driver';

    const generated = generator.generateCodexHooks({ canonical, pluginRoot: rootWithEquals });

    for (const command of allCommands(generated)) {
      expect(command).toContain(`'${rootWithEquals}'/`);
      expect(schemaModule.isOwnedEntry(command)).toBe(true);
      expect(schemaModule.extractOwnedScriptPath(command)).toMatch(/^\//);
    }
  });

  it('🔴 W4：路径含单引号时 `\'\\\'\'` 续接序列可被归属判定还原（不产生假的 target-missing）', () => {
    const canonical = readCanonical();
    const rootWithQuote = "/tmp/o'brien/plugins/spec-driver";

    const generated = generator.generateCodexHooks({ canonical, pluginRoot: rootWithQuote });

    for (const command of allCommands(generated)) {
      expect(schemaModule.isOwnedEntry(command)).toBe(true);
      // 还原出的路径必须是字面单引号，而不是被留下一个字面反斜杠
      const extracted = schemaModule.extractOwnedScriptPath(command) as string;
      expect(extracted.startsWith(rootWithQuote)).toBe(true);
      expect(extracted).not.toContain('\\');
    }
  });
});
