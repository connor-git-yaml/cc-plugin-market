/**
 * F183 修复 3（Codex W1 修正）：findMonorepoPackageTsConfigDirs 单测
 *
 * 探测 monorepo per-package tsconfig（workspace 约定目录 packages/apps/libs 的子包 tsconfig.json）。
 * fs 探针通过 io 参数注入，零全局 mock（Codex C-2：避免污染 scanFiles 的 Dirent 调用）。
 * W1 回归证明：根级 tsconfig.base.json 等单包 config-split 文件不再被误判为 monorepo 信号。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findMonorepoPackageTsConfigDirs,
  buildModuleGraphForProject,
} from '../../../src/knowledge-graph/module-derivation.js';

/** 构造目录项（带 isDirectory()） */
function dir(name: string): { name: string; isDirectory: () => boolean } {
  return { name, isDirectory: () => true };
}
function file(name: string): { name: string; isDirectory: () => boolean } {
  return { name, isDirectory: () => false };
}

describe('findMonorepoPackageTsConfigDirs（F183 修复 3 / Codex W1）', () => {
  it('packages/* 子包含 tsconfig.json → 命中', () => {
    const io = {
      readdirSync: (p: string) =>
        p.endsWith('/packages') ? [dir('core'), dir('utils')] : (() => {
          throw new Error('ENOENT');
        })(),
      existsSync: (p: string) =>
        p.endsWith('packages/core/tsconfig.json') || p.endsWith('packages/utils/tsconfig.json'),
    };
    expect(findMonorepoPackageTsConfigDirs('/root', io)).toEqual([
      'packages/core',
      'packages/utils',
    ]);
  });

  it('W1 回归：根有 tsconfig.base.json 但无 packages/apps/libs → 不再 false-positive', () => {
    const io = {
      // 所有 workspace 目录都不存在 → readdirSync throw ENOENT
      readdirSync: (_p: string): Array<{ name: string; isDirectory: () => boolean }> => {
        throw new Error('ENOENT');
      },
      // 即使根级存在 tsconfig.base.json，本探测器根本不扫根目录，故无关
      existsSync: (_p: string) => true,
    };
    expect(findMonorepoPackageTsConfigDirs('/root', io)).toEqual([]);
  });

  it('子目录存在但无 tsconfig.json（existsSync=false）→ 不计入', () => {
    const io = {
      readdirSync: (p: string) => (p.endsWith('/packages') ? [dir('core')] : (() => {
        throw new Error('ENOENT');
      })()),
      existsSync: (_p: string) => false,
    };
    expect(findMonorepoPackageTsConfigDirs('/root', io)).toEqual([]);
  });

  it('apps/web/tsconfig.json 命中', () => {
    const io = {
      readdirSync: (p: string) => (p.endsWith('/apps') ? [dir('web')] : (() => {
        throw new Error('ENOENT');
      })()),
      existsSync: (p: string) => p.endsWith('apps/web/tsconfig.json'),
    };
    expect(findMonorepoPackageTsConfigDirs('/root', io)).toEqual(['apps/web']);
  });

  it('非目录条目（isDirectory=false）跳过', () => {
    const io = {
      readdirSync: (p: string) =>
        p.endsWith('/packages') ? [file('readme.md'), dir('core')] : (() => {
          throw new Error('ENOENT');
        })(),
      existsSync: (p: string) => p.endsWith('packages/core/tsconfig.json'),
    };
    expect(findMonorepoPackageTsConfigDirs('/root', io)).toEqual(['packages/core']);
  });
});

/**
 * 集成路径证据（改进 1）：验证 buildModuleGraphForProject 调用链路中 `[module-derivation]`
 * warn 真被触发——纯 helper 测试无法证明集成路径接线正确（将来 helper 重命名/调用点删除会静默回退）。
 * 参考 import-resolver-warn.test.ts 的 vi.spyOn(process.stderr,'write') 模式（logger 默认 warn → stderr）。
 */
describe('buildModuleGraphForProject monorepo warn 集成路径（改进 1）', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const tmpDirs: string[] = [];

  function makeTmpRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'f183-moddev-int-'));
    tmpDirs.push(root);
    // 最小合法 root tsconfig + src 源文件（让 buildModuleGraphForProject 不致空图早退）
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }), 'utf8');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;\n', 'utf8');
    return root;
  }

  afterEach(() => {
    stderrSpy?.mockRestore();
    while (tmpDirs.length > 0) {
      const d = tmpDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it('存在 packages/core/tsconfig.json → 集成链路触发含 [module-derivation] + packages/core 的 warn', async () => {
    const root = makeTmpRoot();
    // 造 monorepo 子包 tsconfig（探测块命中信号）
    mkdirSync(join(root, 'packages', 'core'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'core', 'tsconfig.json'),
      JSON.stringify({ compilerOptions: {} }),
      'utf8',
    );

    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await buildModuleGraphForProject(root);

    const moduleDerivationWarns = stderrSpy.mock.calls.filter(
      (c) => String(c[0]).includes('[module-derivation]') && String(c[0]).includes('packages/core'),
    );
    expect(moduleDerivationWarns.length).toBeGreaterThanOrEqual(1);
  });

  it('仅 root tsconfig.json 无 packages/ → 不触发 [module-derivation] monorepo warn', async () => {
    const root = makeTmpRoot();

    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await buildModuleGraphForProject(root);

    const moduleDerivationWarns = stderrSpy.mock.calls.filter((c) =>
      String(c[0]).includes('[module-derivation]'),
    );
    expect(moduleDerivationWarns.length).toBe(0);
  });
});
