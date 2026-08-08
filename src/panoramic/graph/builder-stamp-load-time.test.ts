/**
 * F261 复审 F5（第二轮，红先行）— `getBuilderStamp()` MUST 在**模块加载期**抓取 build-meta，
 * 而不是"首次写盘时惰性抓取"。
 *
 * 失效剧本（第一轮 memoize 实现真实可达）：`spectra batch` 跑数分钟，期间另一个终端跑
 * `npm run build` 刷新了 `dist/.spectra-build-meta.json`；进程**执行的是旧 dist 的代码**，但
 * 首次写盘时才去读 meta ⇒ 图自述**新** build ——把本机制要抓的东西反向掩盖成"看起来很新"。
 *
 * 修法是把抓取窗口从"进程加载模块 → 首次写盘"（分钟级）收窄到"模块加载那一瞬"（毫秒级）。
 * 残余窗口仍在（Node 加载模块与真正开跑之间理论上仍可被替换），如实登记在 builder-stamp.ts
 * 文件头，不声称消除。
 *
 * 本文件**独占**一个 `node:fs` mock（vitest 的 mock 按文件隔离），因此不与同目录的
 * `builder-stamp.test.ts`（打真实文件系统）互相干扰。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** mock 内可变状态：路径 → meta 文件内容。`vi.hoisted` 保证它先于 `vi.mock` 工厂求值。 */
const state = vi.hoisted(() => ({ files: new Map<string, string>() }));

vi.mock('node:fs', () => {
  const existsSync = (p: unknown): boolean => state.files.has(String(p));
  const readFileSync = (p: unknown): string => {
    const content = state.files.get(String(p));
    if (content === undefined) throw new Error(`ENOENT: ${String(p)}`);
    return content;
  };
  return { existsSync, readFileSync, default: { existsSync, readFileSync } };
});

/** `stampBuild` 真实产出形态（值域合法：40 位小写 hex + 64 位小写 hex）。 */
function meta(commit: string, distSha256: string): string {
  return JSON.stringify({
    commit,
    dirty: false,
    sourceDirty: false,
    distSha256,
    distFileCount: 326,
    builtAtIso: '2026-08-08T00:00:00.000Z',
    note: 'F176 版本门禁凭据；勿手改。',
  });
}

const OLD_BUILD = meta('a'.repeat(40), '0'.repeat(64));
const NEW_BUILD = meta('b'.repeat(40), '1'.repeat(64));

/**
 * 被测模块自身所在目录 = 本测试文件所在目录（两者共置），故 `resolveBuilderStamp` 的第一个
 * 候选路径就是这里的 `.spectra-build-meta.json`。
 */
const META_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '.spectra-build-meta.json',
);

beforeEach(() => {
  state.files.clear();
  vi.resetModules();
});

describe('getBuilderStamp — 加载期抓取（F5）', () => {
  it('模块加载后替换 build-meta，MUST 仍返回加载那一刻的值（不得抓到新 build）', async () => {
    state.files.set(META_PATH, OLD_BUILD);
    const mod = await import('./builder-stamp.js');

    // 模拟：batch 跑到一半，另一个终端跑了 npm run build
    state.files.set(META_PATH, NEW_BUILD);

    expect(mod.getBuilderStamp()?.commit).toBe('a'.repeat(40));
    expect(mod.getBuilderStamp()?.distSha256).toBe('0'.repeat(64));
  });

  it('加载期没有 meta（tsx/src 直跑）→ 恒为 null，事后凭空出现的 meta 也不追认', async () => {
    const mod = await import('./builder-stamp.js');

    state.files.set(META_PATH, NEW_BUILD);

    expect(mod.getBuilderStamp()).toBeNull();
  });

  it('同一进程内多次调用返回同一对象引用（一次运行 = 一个 builder 身份）', async () => {
    state.files.set(META_PATH, OLD_BUILD);
    const mod = await import('./builder-stamp.js');

    expect(mod.getBuilderStamp()).toBe(mod.getBuilderStamp());
  });

  it('加载期抓到的值若值域不合规（F3）→ 恒为 null，不因后续合法 meta 而翻案', async () => {
    state.files.set(META_PATH, meta('/Users/alice/secret', '/abs/path'));
    const mod = await import('./builder-stamp.js');

    state.files.set(META_PATH, OLD_BUILD);

    expect(mod.getBuilderStamp()).toBeNull();
  });
});
