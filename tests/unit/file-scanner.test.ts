/**
 * file-scanner 单元测试
 * 验证 .ts/.tsx/.js/.jsx 文件发现、.gitignore 规则遵循、
 * 嵌套目录递归扫描、空目录处理、符号链接忽略（FR-026）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanFiles } from '../../src/utils/file-scanner.js';

/** 创建临时测试目录 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'file-scanner-test-'));
}

/** 创建文件（自动创建父目录） */
function createFile(base: string, relativePath: string, content = ''): void {
  const fullPath = path.join(base, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe('file-scanner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('应发现 .ts/.tsx/.js/.jsx 文件', () => {
    createFile(tmpDir, 'a.ts', 'export const a = 1;');
    createFile(tmpDir, 'b.tsx', 'export const b = 2;');
    createFile(tmpDir, 'c.js', 'module.exports = 3;');
    createFile(tmpDir, 'd.jsx', 'export default function() {}');
    createFile(tmpDir, 'e.json', '{}');
    createFile(tmpDir, 'f.md', '# README');

    const result = scanFiles(tmpDir);
    expect(result.files).toEqual(['a.ts', 'b.tsx', 'c.js', 'd.jsx']);
  });

  it('应递归扫描嵌套目录', () => {
    createFile(tmpDir, 'src/core/a.ts');
    createFile(tmpDir, 'src/utils/b.ts');
    createFile(tmpDir, 'lib/deep/nested/c.tsx');

    const result = scanFiles(tmpDir);
    expect(result.files).toEqual([
      'lib/deep/nested/c.tsx',
      'src/core/a.ts',
      'src/utils/b.ts',
    ]);
  });

  it('应遵循 .gitignore 规则', () => {
    createFile(tmpDir, '.gitignore', 'ignored/\n*.generated.ts\n');
    createFile(tmpDir, 'keep.ts');
    createFile(tmpDir, 'ignored/skip.ts');
    createFile(tmpDir, 'foo.generated.ts');

    const result = scanFiles(tmpDir, { projectRoot: tmpDir });
    expect(result.files).toEqual(['keep.ts']);
  });

  it('应支持 .gitignore 否定模式', () => {
    createFile(tmpDir, '.gitignore', '*.ts\n!important.ts\n');
    createFile(tmpDir, 'skip.ts');
    createFile(tmpDir, 'important.ts');

    const result = scanFiles(tmpDir, { projectRoot: tmpDir });
    expect(result.files).toEqual(['important.ts']);
  });

  it('应默认忽略 node_modules', () => {
    createFile(tmpDir, 'src/a.ts');
    createFile(tmpDir, 'node_modules/pkg/index.ts');

    const result = scanFiles(tmpDir);
    expect(result.files).toEqual(['src/a.ts']);
  });

  it('应处理空目录', () => {
    fs.mkdirSync(path.join(tmpDir, 'empty'), { recursive: true });

    const result = scanFiles(tmpDir);
    expect(result.files).toEqual([]);
    expect(result.totalScanned).toBe(0);
  });

  it('应忽略符号链接', () => {
    createFile(tmpDir, 'real.ts', 'export const x = 1;');
    // 创建符号链接
    try {
      fs.symlinkSync(
        path.join(tmpDir, 'real.ts'),
        path.join(tmpDir, 'link.ts'),
      );
    } catch {
      // 在某些环境下无法创建符号链接，跳过测试
      return;
    }

    const result = scanFiles(tmpDir);
    expect(result.files).toEqual(['real.ts']);
  });

  it('应返回排序后的文件路径', () => {
    createFile(tmpDir, 'z.ts');
    createFile(tmpDir, 'a.ts');
    createFile(tmpDir, 'm.ts');

    const result = scanFiles(tmpDir);
    expect(result.files).toEqual(['a.ts', 'm.ts', 'z.ts']);
  });

  it('应在目录不存在时抛出错误', () => {
    expect(() => scanFiles('/nonexistent/path')).toThrow('目录不存在');
  });

  it('应在路径指向文件时抛出错误', () => {
    createFile(tmpDir, 'not-a-dir.ts');
    expect(() => scanFiles(path.join(tmpDir, 'not-a-dir.ts'))).toThrow(
      '路径不是目录',
    );
  });

  it('应支持额外的忽略模式', () => {
    createFile(tmpDir, 'src/a.ts');
    createFile(tmpDir, 'src/a.test.ts');
    createFile(tmpDir, 'src/b.spec.ts');

    const result = scanFiles(tmpDir, {
      extraIgnorePatterns: ['*.test.ts', '*.spec.ts'],
    });
    expect(result.files).toEqual(['src/a.ts']);
  });

  it('应提供正确的统计信息', () => {
    createFile(tmpDir, 'a.ts');
    createFile(tmpDir, 'b.tsx');
    createFile(tmpDir, 'c.json');
    createFile(tmpDir, 'd.md');

    const result = scanFiles(tmpDir);
    expect(result.files.length).toBe(2);
    // totalScanned 包含所有读取到的文件
    expect(result.totalScanned).toBeGreaterThanOrEqual(2);
  });
});
