/**
 * F261 T001-T005（红先行）— `builder-stamp.ts` 的定位算法与零时间戳不变量。
 *
 * 与 `collector-fingerprint.test.ts` 同惯例共置在 `src/panoramic/graph/`（vitest 的 unit
 * project 已 include `src/panoramic/graph/**\/*.test.ts`）。
 *
 * 全部用例都打**纯函数** `resolveBuilderStamp(startDir)` 而非 `getBuilderStamp()`：后者带进程内
 * memoize，对它下断言就必须引入 `__resetCacheForTest` 之类的测试专用后门。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_ASCENT, parseGraphBuilderStamp, resolveBuilderStamp } from './builder-stamp.js';
import { assertDistBuilt } from '../../../tests/helpers/dist-cli-guard.js';

/** `stampBuild` 实际写入的 7 字段形态（scripts/lib/spectra-version-gate.mjs）。 */
function realShapedMeta(): Record<string, unknown> {
  return {
    commit: 'a'.repeat(40),
    dirty: false,
    sourceDirty: true,
    distSha256: '0123456789abcdef'.repeat(4),
    distFileCount: 512,
    builtAtIso: '2026-08-08T00:00:00.000Z',
    note: 'F176 版本门禁凭据；勿手改。',
  };
}

const tmpRoots: string[] = [];

function makeTmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f261-builder-stamp-'));
  tmpRoots.push(dir);
  return dir;
}

/** 在 `<root>/<relDir>` 下建目录；返回绝对路径。 */
function mkdirp(root: string, relDir: string): string {
  const abs = path.join(root, relDir);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

function writeMeta(dir: string, content: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.spectra-build-meta.json'),
    typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    'utf-8',
  );
}

describe('resolveBuilderStamp — 命中与字段集合（T-R1a）', () => {
  it('编译后形态 dist/panoramic/graph → 上溯 2 级命中 dist/.spectra-build-meta.json，字段集合精确为 5 项', () => {
    const root = makeTmpRoot();
    const startDir = mkdirp(root, path.join('dist', 'panoramic', 'graph'));
    writeMeta(path.join(root, 'dist'), realShapedMeta());

    const stamp = resolveBuilderStamp(startDir);

    expect(stamp).not.toBeNull();
    expect(Object.keys(stamp!).sort()).toEqual([
      'commit',
      'dirty',
      'distSha256',
      'formatVersion',
      'sourceDirty',
    ]);
    expect(stamp!.formatVersion).toBe(1);
    expect(stamp!.commit).toBe('a'.repeat(40));
    expect(stamp!.dirty).toBe(false);
    expect(stamp!.sourceDirty).toBe(true);
    expect(stamp!.distSha256).toBe('0123456789abcdef'.repeat(4));
  });
});

describe('resolveBuilderStamp — 零时间戳不变量（T-R1b）', () => {
  it('即便 meta 里有 builtAtIso 与 note，stamp 也 MUST NOT 携带它们（byte-stable 的致命面）', () => {
    const root = makeTmpRoot();
    const startDir = mkdirp(root, path.join('dist', 'panoramic', 'graph'));
    writeMeta(path.join(root, 'dist'), realShapedMeta());

    const stamp = resolveBuilderStamp(startDir);

    expect(stamp).not.toBeNull();
    expect('builtAtIso' in stamp!).toBe(false);
    expect('note' in stamp!).toBe(false);
    expect('distFileCount' in stamp!).toBe(false);
    // 决策 1：MUST NOT 含任何文件系统路径（F193 portable 约束）
    expect(JSON.stringify(stamp)).not.toContain(root);
    expect(JSON.stringify(stamp)).not.toContain('.spectra-build-meta.json');
  });
});

describe('resolveBuilderStamp — 只查祖先本身、绝不查 <祖先>/dist（T-R1c 反例）', () => {
  it('tsx/vitest 直跑 src 形态：<root>/dist/.spectra-build-meta.json 存在也必须返回 null', () => {
    const root = makeTmpRoot();
    const startDir = mkdirp(root, path.join('src', 'panoramic', 'graph'));
    // 关键构造：仓库确实有一份已盖章的 dist，但它不是"跑 src 的这份代码"的 builder
    writeMeta(path.join(root, 'dist'), realShapedMeta());

    expect(resolveBuilderStamp(startDir)).toBeNull();
  });

  it('祖先目录的 dist 子目录一律不探查（<root>/src/dist 亦然）', () => {
    const root = makeTmpRoot();
    const startDir = mkdirp(root, path.join('src', 'panoramic', 'graph'));
    writeMeta(path.join(root, 'src', 'dist'), realShapedMeta());
    writeMeta(path.join(root, 'src', 'panoramic', 'dist'), realShapedMeta());

    expect(resolveBuilderStamp(startDir)).toBeNull();
  });
});

describe('resolveBuilderStamp — 有界性与畸形容错（T-R1d）', () => {
  it('meta 落在第 3 级祖先（超出 MAX_ASCENT=2）→ null', () => {
    const root = makeTmpRoot();
    const startDir = mkdirp(root, path.join('dist', 'a', 'b', 'c'));
    // startDir 的第 3 级祖先 = <root>/dist，超出上溯范围（只查 c / b / a）
    writeMeta(path.join(root, 'dist'), realShapedMeta());

    expect(resolveBuilderStamp(startDir)).toBeNull();
  });

  it('MAX_ASCENT 常量本身为 2（定位窗口的最小可行值，不留余量）', () => {
    expect(MAX_ASCENT).toBe(2);
  });

  it('meta 非 JSON → null 且不抛', () => {
    const root = makeTmpRoot();
    const startDir = mkdirp(root, path.join('dist', 'panoramic', 'graph'));
    writeMeta(path.join(root, 'dist'), '{ this is not json');

    expect(() => resolveBuilderStamp(startDir)).not.toThrow();
    expect(resolveBuilderStamp(startDir)).toBeNull();
  });

  it('commit 非 string → null', () => {
    const root = makeTmpRoot();
    const startDir = mkdirp(root, path.join('dist', 'panoramic', 'graph'));
    writeMeta(path.join(root, 'dist'), { ...realShapedMeta(), commit: 12345 });

    expect(resolveBuilderStamp(startDir)).toBeNull();
  });

  it('缺 distSha256 → null', () => {
    const root = makeTmpRoot();
    const startDir = mkdirp(root, path.join('dist', 'panoramic', 'graph'));
    const meta = realShapedMeta();
    delete meta['distSha256'];
    writeMeta(path.join(root, 'dist'), meta);

    expect(resolveBuilderStamp(startDir)).toBeNull();
  });

  it('dirty / sourceDirty 非 boolean → null', () => {
    const root = makeTmpRoot();
    const startDir = mkdirp(root, path.join('dist', 'panoramic', 'graph'));
    writeMeta(path.join(root, 'dist'), { ...realShapedMeta(), dirty: 'false' });

    expect(resolveBuilderStamp(startDir)).toBeNull();
  });

  it('命中即定论：近处 meta 畸形时不继续上溯捞远处合法 meta', () => {
    const root = makeTmpRoot();
    const startDir = mkdirp(root, path.join('dist', 'panoramic', 'graph'));
    // 近处（startDir 自身）畸形，远处（<root>/dist）合法
    writeMeta(startDir, '{ broken');
    writeMeta(path.join(root, 'dist'), realShapedMeta());

    expect(resolveBuilderStamp(startDir)).toBeNull();
  });

  it('起点目录根本不存在 → null 且不抛', () => {
    const root = makeTmpRoot();
    const missing = path.join(root, 'nope', 'nope', 'nope');

    expect(() => resolveBuilderStamp(missing)).not.toThrow();
    expect(resolveBuilderStamp(missing)).toBeNull();
  });
});

/**
 * 复审 F3（第二轮）—— `commit` / `distSha256` 的**值域**校验。
 *
 * 第一轮只判 `typeof string && length > 0`，于是三类东西可以原样穿透到 graph.json 与终端：
 * ① ANSI 控制字符（`ESC[2J ESC[H` 恰好 7 字符，`slice(0,7)` 完整保留 ⇒ 真终端清屏，抹掉上方
 *    全部判定结果）；② 绝对路径；③ 时间戳。后两者正是本模块文件头声称 MUST NOT 携带的东西
 * ——那条不变量在第一轮只在 **key 名**层面成立（`scanGraphPortabilityViolations` 不扫
 * `graph.graph`），值层面完全敞开。
 *
 * 正则口径以 `stampBuild`（`scripts/lib/spectra-version-gate.mjs:68-90`）的真实产出为准：
 * `commit` = `git rev-parse HEAD` ⇒ 40 位小写 hex；`distSha256` = sha256 hex ⇒ 64 位小写 hex。
 * 实测 `dist/.spectra-build-meta.json` 与之相符，正常 build 不会被判死。
 */
describe('parseGraphBuilderStamp — 值域校验（F3）', () => {
  const VALID = {
    formatVersion: 1,
    commit: 'a'.repeat(40),
    dirty: false,
    sourceDirty: true,
    distSha256: '0123456789abcdef'.repeat(4),
  };

  it('基线：真实 stampBuild 形态（40 位小写 hex + 64 位小写 hex）必须通过', () => {
    expect(parseGraphBuilderStamp(VALID)).not.toBeNull();
  });

  it('short-sha 形态（7 位 hex）同样通过（下限）', () => {
    expect(parseGraphBuilderStamp({ ...VALID, commit: '0d3e385' })).not.toBeNull();
  });

  /**
   * 复审 W-1：上界不是 40 而是 **64**。
   *
   * 第一轮把 40 论证成"`git rev-parse HEAD` 的全长"——那只在 **sha1** object-format 仓库成立。
   * git 2.x 的 sha256 仓库里 `rev-parse HEAD` 返回 64 位，`stampBuild` 会照常写出，若卡在 40
   * 就会被整体降级为 `null` ⇒ 机制在这类仓库上**静默空转**（诚实降级方向，但白丢一维 provenance）。
   */
  it('W-1：sha256 object-format 仓库的 64 位 commit 必须通过（不得静默空转）', () => {
    expect(parseGraphBuilderStamp({ ...VALID, commit: 'a'.repeat(64) })).not.toBeNull();
  });

  it('W-1：65 位仍拒（上界仍然存在，不是取消校验）', () => {
    expect(parseGraphBuilderStamp({ ...VALID, commit: 'a'.repeat(65) })).toBeNull();
  });

  const rejectedCommits: Array<[string, string]> = [
    ['ANSI 控制字符（清屏序列，恰 7 字符）', `${String.fromCharCode(27)}[2J${String.fromCharCode(27)}[H`],
    ['换行注入（伪造第二行 advisory）', `${'a'.repeat(40)}\n[builder] fake`],
    ['绝对路径 + 时间戳', '/Users/alice/secret @ 2026-08-08T09:00:00Z'],
    ['非 hex 字符', 'zzzzzzz'],
    ['大写 hex（stampBuild 从不产出）', 'A'.repeat(40)],
    ['短于 7 位', 'abcdef'],
    ['长于 64 位（sha256 全长之上）', 'a'.repeat(65)],
    ['空串', ''],
    ['前后空白', ` ${'a'.repeat(40)} `],
  ];

  for (const [label, commit] of rejectedCommits) {
    it(`commit 值域不合规 → 整体降级为 null：${label}`, () => {
      expect(parseGraphBuilderStamp({ ...VALID, commit })).toBeNull();
    });
  }

  const rejectedShas: Array<[string, string]> = [
    ['绝对路径', '/abs/path/to/dist'],
    ['非 64 位（63）', '0'.repeat(63)],
    ['非 64 位（65）', '0'.repeat(65)],
    ['大写 hex', 'A'.repeat(64)],
    ['含非 hex 字符', `${'0'.repeat(63)}z`],
    ['空串', ''],
  ];

  for (const [label, distSha256] of rejectedShas) {
    it(`distSha256 值域不合规 → 整体降级为 null：${label}`, () => {
      expect(parseGraphBuilderStamp({ ...VALID, distSha256 })).toBeNull();
    });
  }

  it('值域不合规时走的是"整体 null"而非"部分保留"（不得半信半疑）', () => {
    const partial = parseGraphBuilderStamp({ ...VALID, commit: '/tmp/x' });
    expect(partial).toBeNull();
  });
});

describe('resolveBuilderStamp — 值域校验贯通到磁盘读取路径（F3）', () => {
  it('meta 里的 commit 含控制字符 → resolveBuilderStamp 返回 null（不落盘、不外泄）', () => {
    const root = makeTmpRoot();
    const startDir = mkdirp(root, path.join('dist', 'panoramic', 'graph'));
    writeMeta(path.join(root, 'dist'), {
      ...realShapedMeta(),
      commit: `${String.fromCharCode(27)}[2J${String.fromCharCode(27)}[H`,
    });

    expect(resolveBuilderStamp(startDir)).toBeNull();
  });

  it('meta 里的 distSha256 被替换成路径 → null', () => {
    const root = makeTmpRoot();
    const startDir = mkdirp(root, path.join('dist', 'panoramic', 'graph'));
    writeMeta(path.join(root, 'dist'), { ...realShapedMeta(), distSha256: '/abs/path' });

    expect(resolveBuilderStamp(startDir)).toBeNull();
  });
});

describe('builder-stamp 模块深度不变量（T-R1e）', () => {
  // 复审 F6：MUST 用 fileURLToPath 而非 new URL(...).pathname——后者在含空格的 clone 路径下
  // 会被 percent-encoding 打成假红（`file:///a%20b/` → `/a%20b/`，与真实路径 `/a b/` 不等）。
  // 生产代码（builder-stamp.ts:getBuilderStamp）用的就是 fileURLToPath，测试侧对齐。
  const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

  beforeAll(() => {
    assertDistBuilt();
  });

  it('编译产物 dist/panoramic/graph/builder-stamp.js 到 dist/ 的层数恰为 MAX_ASCENT', () => {
    const compiled = path.join(PROJECT_ROOT, 'dist', 'panoramic', 'graph', 'builder-stamp.js');
    expect(fs.existsSync(compiled)).toBe(true);

    const depth = path
      .relative(path.join(PROJECT_ROOT, 'dist'), path.dirname(compiled))
      .split(path.sep).length;
    expect(depth).toBe(MAX_ASCENT);
  });
});
