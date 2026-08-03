/**
 * Feature 240 / T023 — 双 installer 语义合同的**薄适配器**
 *
 * plan §6.1 决定 Codex 侧的 `hooks.json` 合并写入采用**对称实现**而非抽共享 helper
 * （包边界不可跨 + 数据形状不同构 + 不拿 `hook-installer.ts` 的 18 个单测冒险）。
 * 对称实现的代价是漂移风险，补偿方式是：**共享「保证」而不是「实现」** ——
 * `tests/unit/hook-installer-semantics-parity.test.ts` 把 FR-011 的七条语义写成一张参数化
 * 合同表，经本文件的适配器对两个 installer 各跑一遍。
 *
 * 🔴 适配器必须保持**薄**：只做 shape 转换与定位，不得包含任何补偿逻辑。一旦在这里"抹平"
 * 差异，合同表就测不出漂移了 —— 那正是本设施存在的唯一理由。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { installClaudeHook, removeClaudeHook } from '../../src/hooks/hook-installer.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANONICAL_HOOKS_JSON = path.join(repoRoot, 'plugins', 'spec-driver', 'hooks', 'hooks.json');
const PLUGIN_ROOT = path.join(repoRoot, 'plugins', 'spec-driver');

const codexInstaller = await import(
  new URL('../../plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs', import.meta.url).href
);
const codexGenerator = await import(
  new URL('../../plugins/spec-driver/scripts/lib/codex-hooks-generator.mjs', import.meta.url).href
);

export interface ParityContext {
  /** 该适配器的根目录（Claude 为 projectRoot，Codex 为 codexHome） */
  root: string;
}

/**
 * 幂等的两种合法形态（spec FR-011.2 允许二选一）。
 * 两侧**有意分歧**并在合同表中作为「已声明差异」登记，不算漂移：
 * - Claude 侧 `skip`：command 是固定字面量，不存在版本升级导致的路径漂移；
 * - Codex 侧 `in-place-update`：command 内嵌绝对路径（FR-005），沿用 skip 会让升级后的
 *   `hooks.json` 永远指向已被清理的旧版本目录 → hook 静默失效。
 */
export type IdempotencyMode = 'skip' | 'in-place-update';

export interface ParityAdapter {
  readonly name: string;
  readonly idempotency: IdempotencyMode;
  /** 我方条目允许出现的字段名全集（用于「零自定义归属标记字段」断言） */
  readonly allowedOwnedEntryKeys: readonly string[];
  /** 非法 JSON 时错误信息应匹配的模式 */
  readonly invalidJsonPattern: RegExp;

  /** 在给定临时目录下准备「尚未安装」的初态 */
  setup(tmpDir: string): ParityContext;
  /** 被合并写入的共享配置文件 */
  targetPath(ctx: ParityContext): string;
  backupPath(ctx: ParityContext): string;

  install(ctx: ParityContext): void;
  remove(ctx: ParityContext): void;
  readTarget(ctx: ParityContext): unknown;
  writeTargetRaw(ctx: ParityContext, raw: string): void;

  /** 预置第三方条目 + 顶层未知字段 */
  seedForeign(ctx: ParityContext): void;
  /** 第三方条目切片（逐字节比较用） */
  foreignSnapshot(doc: unknown): unknown;
  /** 顶层未知字段切片 */
  topLevelSnapshot(doc: unknown): unknown;
  /** 预置「本该是数组的字段被写成非数组」的类型错乱初态 */
  seedCorruptedTypes(ctx: ParityContext): void;

  /** 我方条目数量 */
  countOwned(doc: unknown): number;
  /** 我方每个条目的字段名集合 */
  ownedEntryKeySets(doc: unknown): string[][];
  /**
   * 把已安装的我方条目改成「仍属我方、但已过期」的形态，返回写入的过期记号。
   * 供已声明差异（skip vs in-place-update）做**可观测**断言。
   */
  makeOwnedEntryStale(ctx: ParityContext): string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
}

export function sha256OfFile(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ─── Claude 侧（src/hooks/hook-installer.ts，扁平形状）────────────────────────

const CLAUDE_MARKER = 'spectra-context.sh';

interface ClaudeEntry {
  matcher?: unknown;
  command?: unknown;
  [key: string]: unknown;
}

function claudePreToolUse(doc: unknown): ClaudeEntry[] {
  if (!isPlainObject(doc) || !isPlainObject(doc['hooks'])) return [];
  const list = (doc['hooks'] as Record<string, unknown>)['PreToolUse'];
  return Array.isArray(list) ? (list as ClaudeEntry[]) : [];
}

function claudeIsOwned(entry: ClaudeEntry): boolean {
  return typeof entry.command === 'string' && entry.command.includes(CLAUDE_MARKER);
}

export const claudeAdapter: ParityAdapter = {
  name: 'claude/hook-installer.ts',
  idempotency: 'skip',
  allowedOwnedEntryKeys: ['command', 'matcher'],
  invalidJsonPattern: /settings\.json 格式错误/,

  setup(tmpDir) {
    const root = path.join(tmpDir, 'claude-project');
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    return { root };
  },
  targetPath(ctx) {
    return path.join(ctx.root, '.claude', 'settings.json');
  },
  backupPath(ctx) {
    return `${this.targetPath(ctx)}.bak`;
  },

  install(ctx) {
    installClaudeHook(ctx.root);
  },
  remove(ctx) {
    removeClaudeHook(ctx.root);
  },
  readTarget(ctx) {
    return readJson(this.targetPath(ctx));
  },
  writeTargetRaw(ctx, raw) {
    fs.writeFileSync(this.targetPath(ctx), raw, 'utf-8');
  },

  seedForeign(ctx) {
    this.writeTargetRaw(
      ctx,
      `${JSON.stringify(
        {
          enabledPlugins: ['vendor-plugin'],
          hooks: {
            PreToolUse: [
              { matcher: 'Bash', command: 'echo vendor-pre' },
              // 🔴 W2：与我方脚本**同名但不属我方**。合同表原先的第三方 fixture 与我方脚本名
              // 零交集，导致「归属锚点被放宽」这个唯一会摧毁用户数据的变异方向漏检。
              { matcher: 'Bash', command: 'bash /opt/other/spectra-context-notes.sh' },
            ],
            PostToolUse: [{ matcher: 'Bash', command: 'echo vendor-post' }],
          },
        },
        null,
        2,
      )}\n`,
    );
  },
  foreignSnapshot(doc) {
    const hooks = isPlainObject(doc) && isPlainObject(doc['hooks']) ? doc['hooks'] : {};
    return {
      PreToolUseForeign: claudePreToolUse(doc).filter((entry) => !claudeIsOwned(entry)),
      PostToolUse: (hooks as Record<string, unknown>)['PostToolUse'] ?? null,
    };
  },
  topLevelSnapshot(doc) {
    return isPlainObject(doc) ? doc['enabledPlugins'] : null;
  },
  seedCorruptedTypes(ctx) {
    this.writeTargetRaw(
      ctx,
      `${JSON.stringify({ enabledPlugins: ['vendor-plugin'], hooks: { PreToolUse: 'not-an-array' } }, null, 2)}\n`,
    );
  },

  countOwned(doc) {
    return claudePreToolUse(doc).filter(claudeIsOwned).length;
  },
  ownedEntryKeySets(doc) {
    return claudePreToolUse(doc)
      .filter(claudeIsOwned)
      .map((entry) => Object.keys(entry).sort());
  },
  makeOwnedEntryStale(ctx) {
    const stale = `bash specs/_meta/hooks/stale-v0/${CLAUDE_MARKER}`;
    const doc = this.readTarget(ctx) as Record<string, unknown>;
    const entries = claudePreToolUse(doc);
    for (const entry of entries) {
      if (claudeIsOwned(entry)) entry.command = stale;
    }
    this.writeTargetRaw(ctx, `${JSON.stringify(doc, null, 2)}\n`);
    return stale;
  },
};

// ─── Codex 侧（plugins/.../codex-hooks-installer.mjs，两级嵌套形状）──────────

interface CodexHandler {
  type?: unknown;
  command?: unknown;
  [key: string]: unknown;
}
interface CodexGroup {
  matcher?: unknown;
  hooks?: unknown;
  [key: string]: unknown;
}

function codexEntries(pluginRoot = PLUGIN_ROOT): { hooks: Record<string, unknown[]> } {
  const canonical = JSON.parse(fs.readFileSync(CANONICAL_HOOKS_JSON, 'utf-8')) as unknown;
  return codexGenerator.generateCodexHooks({ canonical, pluginRoot }) as {
    hooks: Record<string, unknown[]>;
  };
}

function codexHandlers(doc: unknown): CodexHandler[] {
  if (!isPlainObject(doc) || !isPlainObject(doc['hooks'])) return [];
  const out: CodexHandler[] = [];
  for (const groups of Object.values(doc['hooks'] as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups as CodexGroup[]) {
      if (!isPlainObject(group) || !Array.isArray(group.hooks)) continue;
      for (const handler of group.hooks as CodexHandler[]) {
        if (isPlainObject(handler)) out.push(handler);
      }
    }
  }
  return out;
}

/**
 * 🔴 W2：第三方 fixture MUST 含「与我方同名 / 与我方形态相近但不属我方」的条目。
 *
 * 原先的 fixture（`/opt/vendor/permission.sh`、`/opt/vendor/stop.sh`）与我方 5 个脚本名**零交集**，
 * 于是"把归属锚点放宽"这类变异根本碰不到任何 fixture ⇒ 合同表全绿放行。而放宽归属锚点正是
 * **唯一会摧毁用户数据**的变异方向。下面三条各钉死一个放宽方向：
 *
 * | fixture | 被放宽后会误删它的变异 |
 * |---|---|
 * | `/opt/other/scripts/postinstall.sh` | 去掉「路径含 `spec-driver` 根分量」这一条 / 只认 basename |
 * | `/opt/other/spec-driver/postinstall.sh` | 去掉「完整相对后缀精确匹配」这一条（旧实现即如此） |
 * | `${CLAUDE_PLUGIN_ROOT}/hooks/stop-task-check.sh` | `allowPlaceholderRoot` 恒被承认 |
 *
 * 🔴 它们必须放在 `PermissionRequest` 里：`foreignSnapshot` 对该事件是**原样比较**，
 * 而对 `Stop` 的切片用 `isOwnedEntry` 过滤 —— 那条路径与被测谓词自指，误删会在两侧同时消失。
 */
const FOREIGN_PERMISSION_GROUP = {
  matcher: 'vendor',
  hooks: [
    { type: 'command', command: 'bash /opt/vendor/permission.sh', timeout: 30 },
    { type: 'command', command: 'bash /opt/other/scripts/postinstall.sh' },
    { type: 'command', command: 'bash /opt/other/spec-driver/postinstall.sh' },
    { type: 'command', command: 'bash ${CLAUDE_PLUGIN_ROOT}/hooks/stop-task-check.sh' },
  ],
};
const FOREIGN_STOP_GROUP = {
  matcher: '',
  hooks: [{ type: 'command', command: 'bash /opt/vendor/stop.sh' }],
};

export const codexAdapter: ParityAdapter = {
  name: 'codex/codex-hooks-installer.mjs',
  idempotency: 'in-place-update',
  allowedOwnedEntryKeys: ['command', 'type'],
  invalidJsonPattern: /不是合法 JSON/,

  setup(tmpDir) {
    const root = path.join(tmpDir, 'codex-home');
    fs.mkdirSync(root, { recursive: true });
    return { root };
  },
  targetPath(ctx) {
    return path.join(ctx.root, 'hooks.json');
  },
  backupPath(ctx) {
    return `${this.targetPath(ctx)}.bak`;
  },

  install(ctx) {
    codexInstaller.installCodexHooks({ codexHome: ctx.root, entries: codexEntries() });
  },
  remove(ctx) {
    codexInstaller.removeCodexHooks({ codexHome: ctx.root });
  },
  readTarget(ctx) {
    return readJson(this.targetPath(ctx));
  },
  writeTargetRaw(ctx, raw) {
    fs.writeFileSync(this.targetPath(ctx), raw, 'utf-8');
  },

  seedForeign(ctx) {
    this.writeTargetRaw(
      ctx,
      `${JSON.stringify(
        {
          description: 'vendor-owned hooks',
          hooks: {
            PermissionRequest: [FOREIGN_PERMISSION_GROUP],
            Stop: [FOREIGN_STOP_GROUP],
          },
        },
        null,
        2,
      )}\n`,
    );
  },
  foreignSnapshot(doc) {
    const hooks =
      isPlainObject(doc) && isPlainObject(doc['hooks'])
        ? (doc['hooks'] as Record<string, unknown>)
        : {};
    const stop = Array.isArray(hooks['Stop']) ? (hooks['Stop'] as CodexGroup[]) : [];
    return {
      PermissionRequest: hooks['PermissionRequest'] ?? null,
      StopForeign: stop.filter(
        (group) =>
          !(
            Array.isArray(group.hooks) &&
            (group.hooks as CodexHandler[]).some((handler) =>
              codexInstaller.isOwnedEntry(handler?.command),
            )
          ),
      ),
    };
  },
  topLevelSnapshot(doc) {
    return isPlainObject(doc) ? doc['description'] : null;
  },
  seedCorruptedTypes(ctx) {
    this.writeTargetRaw(
      ctx,
      `${JSON.stringify({ description: 'vendor-owned hooks', hooks: { Stop: 'not-an-array' } }, null, 2)}\n`,
    );
  },

  countOwned(doc) {
    return codexHandlers(doc).filter((handler) => codexInstaller.isOwnedEntry(handler.command))
      .length;
  },
  ownedEntryKeySets(doc) {
    return codexHandlers(doc)
      .filter((handler) => codexInstaller.isOwnedEntry(handler.command))
      .map((handler) => Object.keys(handler).sort());
  },
  makeOwnedEntryStale(ctx) {
    // 仍含 spec-driver 目录分量与我方脚本名 ⇒ 仍属我方，但指向已被清理的旧版本缓存目录
    const staleRoot = '/opt/plugin-cache/spec-driver/0.0.1-stale';
    const doc = this.readTarget(ctx) as Record<string, unknown>;
    for (const handler of codexHandlers(doc)) {
      if (!codexInstaller.isOwnedEntry(handler.command)) continue;
      handler.command = String(handler.command).replace(PLUGIN_ROOT, staleRoot);
    }
    this.writeTargetRaw(ctx, `${JSON.stringify(doc, null, 2)}\n`);
    return staleRoot;
  },
};

export const parityAdapters: readonly ParityAdapter[] = [claudeAdapter, codexAdapter];
