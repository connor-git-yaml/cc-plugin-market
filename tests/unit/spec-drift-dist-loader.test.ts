/**
 * T003：`scripts/lib/spec-drift-dist-loader.mjs` 单测（FR-011 / W-1）。
 *
 * 覆盖全部 import 失败模式，而非仅 existsSync：
 *  (a) 文件不存在 → dist-missing
 *  (b) 语法错误 → dist-load-failed
 *  (c) 传递依赖加载失败 → dist-load-failed
 *  (d) 模块顶层初始化抛错 → dist-load-failed
 *  (e) 正常加载 → { ok:true, mod }
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// @ts-expect-error —— .mjs 治理脚本无类型声明，运行时 ESM 导入
import { loadDistModule } from '../../scripts/lib/spec-drift-dist-loader.mjs';

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-loader-'));
  fs.mkdirSync(path.join(tmpRoot, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'dist', 'good.js'), 'export const answer = 42;\n', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'dist', 'broken-syntax.js'), 'export const = ;;;\n', 'utf8');
  fs.writeFileSync(
    path.join(tmpRoot, 'dist', 'broken-dep.js'),
    "import './definitely-missing-dep.js';\nexport const x = 1;\n",
    'utf8',
  );
  fs.writeFileSync(
    path.join(tmpRoot, 'dist', 'broken-init.js'),
    "throw new Error('boom at module init');\n",
    'utf8',
  );
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('loadDistModule', () => {
  it('(a) 目标文件不存在 → dist-missing', async () => {
    const r = await loadDistModule(tmpRoot, 'dist/nope.js');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('dist-missing');
    expect(r.detail).toContain('dist/nope.js');
  });

  it('(b) 文件存在但语法错误 → dist-load-failed', async () => {
    const r = await loadDistModule(tmpRoot, 'dist/broken-syntax.js');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('dist-load-failed');
    expect(typeof r.detail).toBe('string');
    expect(r.detail.length).toBeGreaterThan(0);
  });

  it('(c) 传递依赖加载失败 → dist-load-failed', async () => {
    const r = await loadDistModule(tmpRoot, 'dist/broken-dep.js');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('dist-load-failed');
  });

  it('(c2) 模块顶层初始化抛错 → dist-load-failed', async () => {
    const r = await loadDistModule(tmpRoot, 'dist/broken-init.js');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('dist-load-failed');
    expect(r.detail).toContain('boom at module init');
  });

  it('(d) 正常加载 → { ok:true, mod }', async () => {
    const r = await loadDistModule(tmpRoot, 'dist/good.js');
    expect(r.ok).toBe(true);
    expect(r.mod.answer).toBe(42);
  });
});
