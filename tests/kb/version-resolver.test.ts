/**
 * F241 T053 — 版本决议（FR-017 / SC-012 / EC-23 / EC-24 / EC-25 / EC-26 / EC-27）
 *
 * 六组 fixture：仅显式 / 仅 lockfile / 两者冲突 / 多 lockfile 无显式 /
 * 多 lockfile + 显式 / lockfile 与 `node_modules` 实际安装版本不一致。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveVersion } from '../../src/scaffold-kb/version-resolver.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'verres-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function npmLock(version: string): void {
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/echarts': { version } } }),
  );
}

function pnpmLock(version: string): void {
  writeFileSync(
    join(root, 'pnpm-lock.yaml'),
    ["lockfileVersion: '6.0'", 'packages:', `  /echarts@${version}:`, '    resolution: {integrity: sha512-fake}', ''].join('\n'),
  );
}

function yarnLock(version: string): void {
  writeFileSync(join(root, 'yarn.lock'), ['echarts@^5.0.0:', `  version "${version}"`, ''].join('\n'));
}

function packageJson(range: string): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { echarts: range } }));
}

function installed(version: string): void {
  const d = join(root, 'node_modules', 'echarts');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'echarts', version }));
}

describe('version-resolver — 六组优先级仲裁（FR-017 / SC-012）', () => {
  it('组1 仅显式 → status=explicit，version 取显式值', () => {
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts', explicitVersion: '4.0.0' });
    expect(r.resolved).toEqual({ status: 'explicit', version: '4.0.0' });
    expect(r.candidates.map((c) => c.version)).toContain('4.0.0');
    expect(r.flags).not.toContain('version-conflict');
  });

  it('组2 仅 lockfile → status=lockfile', () => {
    npmLock('3.2.1');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts' });
    expect(r.resolved).toEqual({ status: 'lockfile', version: '3.2.1' });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ version: '3.2.1', source: 'package-lock.json' });
    expect(r.flags).toEqual([]);
  });

  it('组3 显式 4.0.0 + lockfile 3.2.1 冲突 → explicit 但推断值同时呈现 + version-conflict（EC-26）', () => {
    npmLock('3.2.1');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts', explicitVersion: '4.0.0' });
    expect(r.resolved).toEqual({ status: 'explicit', version: '4.0.0' });
    expect(r.candidates.map((c) => c.version).sort()).toEqual(['3.2.1', '4.0.0']);
    expect(r.flags).toContain('version-conflict');
  });

  it('组3b 显式与 lockfile 一致 → 不标 version-conflict', () => {
    npmLock('4.0.0');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts', explicitVersion: '4.0.0' });
    expect(r.resolved).toEqual({ status: 'explicit', version: '4.0.0' });
    expect(r.flags).not.toContain('version-conflict');
  });

  it('组4 多 lockfile 无显式 → ambiguous + version=null + 全量 candidates（EC-24）', () => {
    npmLock('3.2.1');
    pnpmLock('5.4.3');
    yarnLock('4.9.0');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts' });
    expect(r.resolved.status).toBe('ambiguous');
    expect(r.resolved.version).toBeNull();
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.flags).toContain('multiple-lockfiles');
    // 不得擅自按 LOCK_FILE_PRIORITY 收敛为单值：三个 lockfile 的解析结果都必须在
    expect(r.candidates.map((c) => c.source).sort()).toEqual(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
  });

  it('组5 多 lockfile + 显式 → explicit（显式优先级最高）且推断值仍全量呈现', () => {
    npmLock('3.2.1');
    pnpmLock('5.4.3');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts', explicitVersion: '4.0.0' });
    expect(r.resolved).toEqual({ status: 'explicit', version: '4.0.0' });
    expect(r.candidates.map((c) => c.version).sort()).toEqual(['3.2.1', '4.0.0', '5.4.3']);
    expect(r.flags).toContain('version-conflict');
    expect(r.flags).toContain('multiple-lockfiles');
  });

  it('组6 lockfile 与 node_modules 实际安装版本不一致 → 双呈现 + lockfile-install-mismatch（EC-25 / P-W2）', () => {
    npmLock('3.2.1');
    installed('3.9.9');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts' });
    expect(r.flags).toContain('lockfile-install-mismatch');
    const bySource = Object.fromEntries(r.candidates.map((c) => [c.source, c.version]));
    expect(bySource['package-lock.json']).toBe('3.2.1');
    expect(bySource['node_modules']).toBe('3.9.9');
    // 决议本身仍以 lockfile 为准（安装态是佐证不是权威）
    expect(r.resolved).toEqual({ status: 'lockfile', version: '3.2.1' });
  });

  it('组6b 无 node_modules（不可检测）→ 不猜测，flags 不含 lockfile-install-mismatch', () => {
    npmLock('3.2.1');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts' });
    expect(r.flags).not.toContain('lockfile-install-mismatch');
    expect(r.candidates.map((c) => c.source)).not.toContain('node_modules');
  });

  it('组6c node_modules 与 lockfile 一致 → 不标 mismatch，也不重复入 candidates', () => {
    npmLock('3.2.1');
    installed('3.2.1');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts' });
    expect(r.flags).not.toContain('lockfile-install-mismatch');
    expect(r.candidates).toHaveLength(1);
  });

  it('组6d node_modules/<pkg>/package.json 损坏 → 不猜测、不抛错', () => {
    npmLock('3.2.1');
    mkdirSync(join(root, 'node_modules', 'echarts'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'echarts', 'package.json'), '{ broken');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts' });
    expect(r.flags).not.toContain('lockfile-install-mismatch');
    expect(r.resolved).toEqual({ status: 'lockfile', version: '3.2.1' });
  });
});

describe('version-resolver — 弱信号与无信息（EC-23 / EC-27）', () => {
  it('无 lockfile 但 package.json 有 range → range-only + version=null + range 进 candidates', () => {
    packageJson('^5.0.0');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts' });
    expect(r.resolved).toEqual({ status: 'range-only', version: null });
    expect(r.candidates).toEqual([
      expect.objectContaining({ version: '^5.0.0', source: 'package.json' }),
    ]);
    expect(r.flags).toContain('range-only');
  });

  it('range 也来自 devDependencies / peerDependencies', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'demo', devDependencies: { echarts: '~5.1.0' } }),
    );
    expect(resolveVersion({ projectRoot: root, packageName: 'echarts' }).resolved).toEqual({
      status: 'range-only',
      version: null,
    });
  });

  it('lockfile 有具体版本时，package.json range 不再作为 range-only（优先级 2 > 3）', () => {
    npmLock('3.2.1');
    packageJson('^5.0.0');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts' });
    expect(r.resolved.status).toBe('lockfile');
    expect(r.flags).not.toContain('range-only');
  });

  it('什么都没有 → none + version=null + candidates 空', () => {
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts' });
    expect(r.resolved).toEqual({ status: 'none', version: null });
    expect(r.candidates).toEqual([]);
    expect(r.flags).toEqual([]);
  });

  it('只有 go.sum（非 npm 生态）→ none + ecosystem-unsupported，绝不猜测版本（EC-27 / SC-012）', () => {
    writeFileSync(join(root, 'go.sum'), 'github.com/foo/bar v1.2.3 h1:abc=\n');
    const r = resolveVersion({ projectRoot: root, packageName: 'github.com/foo/bar' });
    expect(r.resolved).toEqual({ status: 'none', version: null });
    expect(r.flags).toContain('ecosystem-unsupported');
    expect(r.candidates).toEqual([]);
  });

  it('lockfile 存在但包不在其中 → 不构成 candidate，落回 none', () => {
    npmLock('3.2.1');
    const r = resolveVersion({ projectRoot: root, packageName: 'not-installed-pkg' });
    expect(r.resolved).toEqual({ status: 'none', version: null });
    expect(r.candidates).toEqual([]);
  });

  it('projectRoot 不存在 → 不抛错，返回 none', () => {
    const r = resolveVersion({ projectRoot: join(root, 'nope'), packageName: 'echarts' });
    expect(r.resolved).toEqual({ status: 'none', version: null });
  });

  it('flags 无重复项（同一 flag 只出现一次）', () => {
    npmLock('3.2.1');
    pnpmLock('5.4.3');
    installed('9.9.9');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts', explicitVersion: '4.0.0' });
    expect(new Set(r.flags).size).toBe(r.flags.length);
  });
});

// ============================================================
// F241 批 3 Codex 整改 — B3-W1 / B3-C1 在 resolver 侧的传导
// ============================================================

describe('version-resolver — 单 lockfile 内嵌套安装位置歧义（B3-W1）', () => {
  /** monorepo：无顶层安装，两个 workspace 各锁一个版本 */
  function nestedNpmLock(a: string, b: string): void {
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'packages/a/node_modules/echarts': { version: a },
          'packages/b/node_modules/echarts': { version: b },
        },
      }),
    );
  }

  it('嵌套版本不一致 → ambiguous + version=null + 全量 candidates（不擅自取遍历首项）', () => {
    nestedNpmLock('5.4.3', '4.9.0');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts' });
    expect(r.resolved).toEqual({ status: 'ambiguous', version: null });
    expect(r.candidates.map((c) => c.version).sort()).toEqual(['4.9.0', '5.4.3']);
  });

  it('嵌套歧义**不复用** multiple-lockfiles 标记（只有一个 lockfile，不新增状态也不误标）', () => {
    nestedNpmLock('5.4.3', '4.9.0');
    expect(resolveVersion({ projectRoot: root, packageName: 'echarts' }).flags).not.toContain('multiple-lockfiles');
  });

  it('嵌套版本一致 → 仍收敛为 lockfile 单值（不因为「有多个键」就装作不知道）', () => {
    nestedNpmLock('5.4.3', '5.4.3');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts' });
    expect(r.resolved).toEqual({ status: 'lockfile', version: '5.4.3' });
    expect(r.candidates).toHaveLength(1);
  });

  it('顶层安装位置存在 → 直接采用，不进 ambiguous', () => {
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/echarts': { version: '5.4.3' },
          'packages/a/node_modules/echarts': { version: '4.9.0' },
        },
      }),
    );
    expect(resolveVersion({ projectRoot: root, packageName: 'echarts' }).resolved).toEqual({
      status: 'lockfile',
      version: '5.4.3',
    });
  });

  it('多 lockfile 且各自版本相同 → 仍标 multiple-lockfiles（该标记只描述"锁文件有几个"）', () => {
    npmLock('5.4.3');
    pnpmLock('5.4.3');
    expect(resolveVersion({ projectRoot: root, packageName: 'echarts' }).flags).toContain('multiple-lockfiles');
  });
});

describe('version-resolver — 损坏 lockfile 与「包不在锁里」不同流（B3-C1）', () => {
  it('空 pnpm-lock.yaml → 不落 none 静默，parse-error 作为可见证据进 candidates', () => {
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts' });
    expect(r.resolved).toEqual({ status: 'none', version: null });
    expect(r.candidates).toEqual([
      expect.objectContaining({ source: 'pnpm-lock.yaml', detail: expect.stringContaining('parse-error') }),
    ]);
  });

  it('损坏 yarn.lock（version 值不成形）→ 同样以 parse-error 呈现，不冒充锁定版本', () => {
    writeFileSync(join(root, 'yarn.lock'), ['echarts@^5.0.0:', '  version [unterminated', ''].join('\n'));
    const r = resolveVersion({ projectRoot: root, packageName: 'echarts' });
    expect(r.candidates.map((c) => c.version)).not.toContain('[unterminated');
    expect(r.candidates).toEqual([
      expect.objectContaining({ source: 'yarn.lock', detail: expect.stringContaining('parse-error') }),
    ]);
  });

  it('包确实不在合法 pnpm-lock 里 → candidates 干净为空（parse-error 与 not-found 不混淆）', () => {
    pnpmLock('5.4.3');
    const r = resolveVersion({ projectRoot: root, packageName: 'not-installed-pkg' });
    expect(r.resolved).toEqual({ status: 'none', version: null });
    expect(r.candidates).toEqual([]);
  });
});
