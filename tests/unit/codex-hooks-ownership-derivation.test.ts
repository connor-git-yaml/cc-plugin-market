/**
 * F283 — Codex hooks 归属表派生化 + generator 对未登记脚本 fail-loud（M10 §12.2 W-2：「守卫抓删不抓加」）。
 *
 * 改动前：`OWNED_HOOK_SCRIPT_SUFFIXES` 与 `OWNED_HOOK_EXPECTED_EVENT` 两表各写一份，只有「删」方向有守卫
 * （product-handler-unregistered）；canonical 新增脚本漏登记会静默穿过 generator 装进 $CODEX_HOME/hooks.json，
 * 装完 `isOwnedEntry=false` ⇒ `--remove` 不回收、`validate --baseline` 当第三方数据保全。
 *
 * 运行：npx vitest run tests/unit/codex-hooks-ownership-derivation.test.ts
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const generator = await import(
  new URL('../../plugins/spec-driver/scripts/lib/codex-hooks-generator.mjs', import.meta.url).href
);
const schema = await import(
  new URL('../../plugins/spec-driver/scripts/lib/codex-hooks-schema.mjs', import.meta.url).href
);

const PLUGIN_ROOT = path.join(repoRoot, 'plugins', 'spec-driver');
const SCHEMA_SRC = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'lib', 'codex-hooks-schema.mjs'), 'utf-8');
const GENERATOR_SRC = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'lib', 'codex-hooks-generator.mjs'), 'utf-8');

type Canonical = { hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>> };
function readCanonical(): Canonical {
  return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf-8')) as Canonical;
}
type InsertAt = 'first' | 'last' | 'new-group';
/** 对抗复审 W-2：插入位置参数化——只在末位插一条会让"按位置收窄"的守卫退化全部漏网 */
function withExtraStopHandler(command: string, at: InsertAt = 'last'): Canonical {
  const c = readCanonical();
  const handler = { type: 'command', command };
  if (at === 'first') c.hooks.Stop[0]!.hooks.unshift(handler);
  else if (at === 'new-group') c.hooks.Stop.push({ hooks: [handler] });
  else c.hooks.Stop[0]!.hooks.push(handler);
  return c;
}
const INSERT_POSITIONS: InsertAt[] = ['first', 'last', 'new-group'];

describe('F283 · 归属表单源：OWNED_HOOK_SCRIPT_SUFFIXES 由 OWNED_HOOK_EXPECTED_EVENT 派生', () => {
  it('两表键集逐项相等（含顺序）；派生表与每个二元组均冻结', () => {
    const derived = (schema.OWNED_HOOK_SCRIPT_SUFFIXES as ReadonlyArray<readonly [string, string]>).map((p) => p.join('/'));
    expect(derived).toEqual(Object.keys(schema.OWNED_HOOK_EXPECTED_EVENT));
    expect(Object.isFrozen(schema.OWNED_HOOK_SCRIPT_SUFFIXES)).toBe(true);
    for (const pair of schema.OWNED_HOOK_SCRIPT_SUFFIXES as ReadonlyArray<readonly string[]>) {
      expect(Object.isFrozen(pair)).toBe(true);
      expect(pair).toHaveLength(2);
    }
  });

  it('源码层：schema 里不再存在第二份手写后缀字面量表（登记点唯一）', () => {
    expect(/OWNED_HOOK_SCRIPT_SUFFIXES = Object\.freeze\(\[\s*Object\.freeze\(\[/.test(SCHEMA_SRC)).toBe(false);
    expect(SCHEMA_SRC).toContain('deriveOwnedSuffixes(Object.keys(OWNED_HOOK_EXPECTED_EVENT))');
  });

  it('OWNED_HOOK_SCRIPT_NAMES / isOwnedEntry 在派生表上语义不变：canonical 六条脚本全部判 owned', () => {
    const owned = Object.values(readCanonical().hooks)
      .flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)))
      .filter((cmd) => !cmd.includes('worktree-lifecycle.sh'));
    expect(owned).toHaveLength(6);
    for (const cmd of owned) expect(schema.isOwnedEntry(cmd, { allowPlaceholderRoot: true })).toBe(true);
    expect([...schema.OWNED_HOOK_SCRIPT_NAMES].sort()).toEqual(
      Object.keys(schema.OWNED_HOOK_EXPECTED_EVENT).map((k) => k.split('/')[1]).sort(),
    );
  });
});

describe('F283 · generator 对未登记脚本 fail-loud（抓「加」方向）', () => {
  it('canonical hooks.json 原样通过（回归：六条 owned handler 全部展开）', () => {
    const out = generator.generateCodexHooks({ canonical: readCanonical(), pluginRoot: PLUGIN_ROOT });
    const commands = Object.values(out.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>)
      .flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
    expect(commands).toHaveLength(6);
    expect(commands.every((c) => c.includes(PLUGIN_ROOT))).toBe(true);
  });

  it.each(INSERT_POSITIONS)('产品事件下挂了既非 owned 也非 Claude-only 的脚本（插在 %s）→ 抛错并指向唯一登记点', (at) => {
    const c = withExtraStopHandler('bash ${CLAUDE_PLUGIN_ROOT}/hooks/brand-new-hook.sh', at);
    expect(() => generator.generateCodexHooks({ canonical: c, pluginRoot: PLUGIN_ROOT })).toThrow(
      /未登记脚本.*brand-new-hook\.sh.*OWNED_HOOK_EXPECTED_EVENT/s,
    );
  });

  it('第三方形态（无 spec-driver 根分量 / 含 ..）同样被拒，不会以 owned 之名装进 Codex', () => {
    for (const cmd of ['bash /opt/other/hooks/stop-task-check.sh', 'bash ${CLAUDE_PLUGIN_ROOT}/hooks/../../evil/stop-task-check.sh']) {
      for (const at of INSERT_POSITIONS) {
        expect(() => generator.generateCodexHooks({ canonical: withExtraStopHandler(cmd, at), pluginRoot: PLUGIN_ROOT })).toThrow(/未登记脚本/);
      }
    }
  });

  it('对抗复审 W-1（判据方向）：「提及即归属」形态过不了准入闸——包装器 + 参数提及、注释提及、env 提及', () => {
    const forms = [
      'bash ${CLAUDE_PLUGIN_ROOT}/hooks/brand-new.sh ${CLAUDE_PLUGIN_ROOT}/hooks/stop-task-check.sh',
      'bash ${CLAUDE_PLUGIN_ROOT}/hooks/with-timeout.sh ${CLAUDE_PLUGIN_ROOT}/hooks/stop-task-check.sh',
      'bash ${CLAUDE_PLUGIN_ROOT}/hooks/brand-new.sh # ${CLAUDE_PLUGIN_ROOT}/hooks/stop-task-check.sh',
      'X=${CLAUDE_PLUGIN_ROOT}/hooks/stop-task-check.sh bash ${CLAUDE_PLUGIN_ROOT}/hooks/brand-new.sh',
    ];
    for (const cmd of forms) {
      expect(() => generator.generateCodexHooks({ canonical: withExtraStopHandler(cmd), pluginRoot: PLUGIN_ROOT }), cmd).toThrow(/未登记脚本/);
    }
  });

  it('对抗复审 W-1（分发链）：引号 / 转义拼出的占位符展开后仍带 `${` → 拒绝（判据与装进去的字面量同一）', () => {
    const forms = [
      'bash "$"{CLAUDE_PLUGIN_ROOT}/hooks/stop-task-check.sh',
      'bash ${CLAUDE_PLUGIN_ROOT""}/hooks/stop-task-check.sh',
      "bash $'{'CLAUDE_PLUGIN_ROOT}/hooks/stop-task-check.sh",
    ];
    for (const cmd of forms) {
      expect(() => generator.generateCodexHooks({ canonical: withExtraStopHandler(cmd), pluginRoot: PLUGIN_ROOT }), cmd).toThrow(/未登记脚本/);
    }
  });

  it('合法 owned 写法不被误拒：env 前缀 / 解释器 flag / 绝对路径展开后仍认领', () => {
    const ok = [
      'FOO=1 bash -e ${CLAUDE_PLUGIN_ROOT}/hooks/stop-task-check.sh',
      'bash ${CLAUDE_PLUGIN_ROOT}/hooks/stop-task-check.sh --flag value',
    ];
    for (const cmd of ok) {
      const c = readCanonical();
      c.hooks.Stop[0]!.hooks[0] = { type: 'command', command: cmd };
      expect(() => generator.generateCodexHooks({ canonical: c, pluginRoot: PLUGIN_ROOT }), cmd).not.toThrow();
    }
  });

  it('非字符串 command → 类型错误先于准入闸（错误文案不退化成「未登记脚本 (undefined)」）', () => {
    const c = readCanonical();
    (c.hooks.Stop[0]!.hooks as Array<Record<string, unknown>>).push({ type: 'command', command: 42 });
    expect(() => generator.generateCodexHooks({ canonical: c, pluginRoot: PLUGIN_ROOT })).toThrow(/必须是字符串/);
  });

  it('对抗复审 W-2（分发链）：派生断言拒绝三段 / 一段 / 空段键（模块加载即抛，不让目录名被派生成脚本锚点）', () => {
    expect(() => schema.deriveOwnedSuffixes(['hooks/sub/three-seg.sh'])).toThrow(/两段非空/);
    expect(() => schema.deriveOwnedSuffixes(['one-seg.sh'])).toThrow(/两段非空/);
    expect(() => schema.deriveOwnedSuffixes(['hooks/'])).toThrow(/两段非空/);
    expect(schema.deriveOwnedSuffixes(['hooks/x.sh'])).toEqual([['hooks', 'x.sh']]);
  });

  it('对抗复审 I-2：validate --canonical-source 对未登记脚本判 fail（两道门同口径）', () => {
    const c = withExtraStopHandler('bash ${CLAUDE_PLUGIN_ROOT}/hooks/brand-new-hook.sh');
    const result = schema.validateCodexHooksDocument(c, { canonicalSource: true });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f: { code: string }) => f.code === 'canonical-unregistered-script')).toBe(true);
    const clean = schema.validateCodexHooksDocument(readCanonical(), { canonicalSource: true });
    expect(clean.findings.some((f: { code: string }) => f.code === 'canonical-unregistered-script')).toBe(false);
  });

  it('Claude-only 脚本挂产品事件仍走既有 fail-loud（新守卫不吞掉旧错误文案）', () => {
    const c = withExtraStopHandler('bash ${CLAUDE_PLUGIN_ROOT}/hooks/worktree-lifecycle.sh');
    expect(() => generator.generateCodexHooks({ canonical: c, pluginRoot: PLUGIN_ROOT })).toThrow(/Claude adapter 独有脚本/);
  });

  it('源码层：新守卫落在 handler 循环内、Claude-only 判定之后，且判在展开后产物上', () => {
    const claudeOnlyIdx = GENERATOR_SRC.indexOf('isClaudeOnlyEntry(handler.command');
    const ownedIdx = GENERATOR_SRC.indexOf('!isOwnedExecutableEntry(expanded)');
    expect(claudeOnlyIdx).toBeGreaterThan(0);
    expect(ownedIdx).toBeGreaterThan(claudeOnlyIdx);
  });
});
