/**
 * cache-key-builder 单元测试
 *
 * F243：INCLUDED_EXTENSIONS 此前缺 .mjs/.cjs —— generator 未实现 getDependencies()
 * 时走 fallback 全量扫描算 cache key，.mjs/.cjs 的改动不会让 cache key 变化，
 * 项目文档会错误复用旧缓存。本文件锁定 fallback 扫描面包含这两个扩展。
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanSourceFiles } from '../../../src/panoramic/cache/cache-key-builder.js';

/** 创建临时目录 */
function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cache-key-builder-test-'));
}

/** 递归删除目录 */
function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('scanSourceFiles', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      removeTmpDir(dir);
    }
    tmpDirs.length = 0;
  });

  it('收集 .mjs / .cjs 源文件（F243：与 collector 扫描面同步）', () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);

    const tsFile = path.join(tmpDir, 'index.ts');
    const mjsFile = path.join(tmpDir, 'tool.mjs');
    const cjsFile = path.join(tmpDir, 'legacy.cjs');
    fs.writeFileSync(tsFile, 'export const x = 1;');
    fs.writeFileSync(mjsFile, 'export const y = 2;');
    fs.writeFileSync(cjsFile, 'module.exports = { z: 3 };');

    const results = scanSourceFiles(tmpDir);

    expect(results).toContain(tsFile);
    expect(results).toContain(mjsFile);
    expect(results).toContain(cjsFile);
  });

  it('排除噪声目录（node_modules / dist / .git）', () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'kept.mjs'), 'export const kept = 1;');
    for (const dirName of ['node_modules', 'dist', '.git']) {
      fs.mkdirSync(path.join(tmpDir, dirName), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, dirName, 'noise.mjs'), 'export const noise = 1;');
    }

    const results = scanSourceFiles(tmpDir);

    expect(results).toContain(path.join(tmpDir, 'kept.mjs'));
    expect(results).not.toContain(path.join(tmpDir, 'node_modules', 'noise.mjs'));
    expect(results).not.toContain(path.join(tmpDir, 'dist', 'noise.mjs'));
    expect(results).not.toContain(path.join(tmpDir, '.git', 'noise.mjs'));
  });

  it('不收集扫描面外的扩展名（如 .png）', () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'logo.png'), 'binary-ish');
    fs.writeFileSync(path.join(tmpDir, 'app.mjs'), 'export const app = 1;');

    const results = scanSourceFiles(tmpDir);

    expect(results).toContain(path.join(tmpDir, 'app.mjs'));
    expect(results).not.toContain(path.join(tmpDir, 'logo.png'));
  });
});
