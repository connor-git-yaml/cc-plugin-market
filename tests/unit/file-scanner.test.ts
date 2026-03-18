/**
 * file-scanner 单元测试
 * 验证 .ts/.tsx/.js/.jsx 文件发现、.gitignore 规则遵循、
 * 嵌套目录递归扫描、空目录处理、符号链接忽略（FR-026）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanFiles } from '../../src/utils/file-scanner.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';

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
    // 确保 Registry 已注册适配器
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    LanguageAdapterRegistry.resetInstance();
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

  // ============================================================
  // Phase 5: 混合语言目录测试（T034）
  // ============================================================

  it('混合目录：.py 文件被 PythonLanguageAdapter 支持', () => {
    createFile(tmpDir, 'app.ts', 'export const x = 1;');
    createFile(tmpDir, 'main.py', 'print("hello")');
    createFile(tmpDir, 'lib.py', 'def foo(): pass');
    createFile(tmpDir, 'util.js', 'module.exports = {}');

    const result = scanFiles(tmpDir);

    // .py 现在被 PythonLanguageAdapter 支持，包含在 files 中
    expect(result.files).toEqual(['app.ts', 'lib.py', 'main.py', 'util.js']);
    // .py 不再出现在 unsupportedExtensions 中
    expect(result.unsupportedExtensions?.get('.py')).toBeUndefined();
  });

  it('混合目录：ScanResult.files 包含 TS/JS、Python、Go 和 Java 文件', () => {
    createFile(tmpDir, 'src/index.ts', 'export {}');
    createFile(tmpDir, 'src/utils.tsx', 'export {}');
    createFile(tmpDir, 'src/helper.py', 'pass');
    createFile(tmpDir, 'src/main.go', 'package main');
    createFile(tmpDir, 'src/App.java', 'public class App {}');
    createFile(tmpDir, 'src/style.css', 'body{}');

    const result = scanFiles(tmpDir);

    // .py, .go, .java 现在都被支持，.css 仍不支持
    expect(result.files).toEqual(['src/App.java', 'src/helper.py', 'src/index.ts', 'src/main.go', 'src/utils.tsx']);
    expect(result.unsupportedExtensions?.get('.py')).toBeUndefined();
    expect(result.unsupportedExtensions?.get('.go')).toBeUndefined();
    expect(result.unsupportedExtensions?.get('.java')).toBeUndefined();
    expect(result.unsupportedExtensions).toBeDefined();
    expect(result.unsupportedExtensions!.get('.css')).toBe(1);
  });

  it('仅含不支持语言文件的目录：files 为空', () => {
    createFile(tmpDir, 'app.rb', 'puts "hello"');
    createFile(tmpDir, 'lib/util.rs', 'fn main() {}');

    const result = scanFiles(tmpDir);

    expect(result.files).toEqual([]);
    expect(result.unsupportedExtensions).toBeDefined();
    expect(result.unsupportedExtensions!.get('.rb')).toBe(1);
    expect(result.unsupportedExtensions!.get('.rs')).toBe(1);
  });

  // ============================================================
  // Phase 2: languageStats 多语言统计测试（T012-T017）
  // ============================================================

  it('T012: 多语言项目扫描后 languageStats 包含正确的语言条目', () => {
    createFile(tmpDir, 'src/index.ts', 'export {}');
    createFile(tmpDir, 'src/util.tsx', 'export {}');
    createFile(tmpDir, 'src/helper.py', 'pass');
    createFile(tmpDir, 'src/main.go', 'package main');

    const result = scanFiles(tmpDir);

    expect(result.languageStats).toBeDefined();
    // ts-js 适配器应包含 .ts 和 .tsx
    const tsJs = result.languageStats!.get('ts-js');
    expect(tsJs).toBeDefined();
    expect(tsJs!.fileCount).toBe(2);
    expect(tsJs!.extensions).toContain('.ts');
    expect(tsJs!.extensions).toContain('.tsx');

    // python 适配器
    const python = result.languageStats!.get('python');
    expect(python).toBeDefined();
    expect(python!.fileCount).toBe(1);
    expect(python!.extensions).toContain('.py');

    // go 适配器
    const go = result.languageStats!.get('go');
    expect(go).toBeDefined();
    expect(go!.fileCount).toBe(1);
    expect(go!.extensions).toContain('.go');
  });

  it('T013: 纯单语言项目扫描后 languageStats 仅包含一个条目', () => {
    createFile(tmpDir, 'src/a.ts', 'export const a = 1;');
    createFile(tmpDir, 'src/b.ts', 'export const b = 2;');
    createFile(tmpDir, 'src/c.tsx', 'export {}');

    const result = scanFiles(tmpDir);

    expect(result.languageStats).toBeDefined();
    expect(result.languageStats!.size).toBe(1);
    expect(result.languageStats!.has('ts-js')).toBe(true);
    expect(result.languageStats!.get('ts-js')!.fileCount).toBe(3);
  });

  it('T014: 包含 .rs 和 .cpp 文件时，警告信息包含语言名称', () => {
    createFile(tmpDir, 'src/app.ts', 'export {}');
    createFile(tmpDir, 'lib.rs', 'fn main() {}');
    createFile(tmpDir, 'main.cpp', 'int main() {}');
    createFile(tmpDir, 'helper.rs', 'fn helper() {}');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scanFiles(tmpDir);

    expect(warnSpy).toHaveBeenCalled();
    const warnMsg = warnSpy.mock.calls[0]![0] as string;
    expect(warnMsg).toContain('Rust');
    expect(warnMsg).toContain('C++');
    warnSpy.mockRestore();
  });

  it('T015: 所有文件均为已支持语言时，不输出跳过警告', () => {
    createFile(tmpDir, 'src/a.ts', 'export {}');
    createFile(tmpDir, 'src/b.py', 'pass');
    createFile(tmpDir, 'src/c.go', 'package main');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scanFiles(tmpDir);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('T016: 无扩展名文件和非代码文件不纳入 languageStats', () => {
    createFile(tmpDir, 'src/index.ts', 'export {}');
    createFile(tmpDir, 'Makefile', 'all:');
    createFile(tmpDir, 'Dockerfile', 'FROM node');
    createFile(tmpDir, 'config.yaml', 'key: value');
    createFile(tmpDir, 'data.json', '{}');

    const result = scanFiles(tmpDir);

    expect(result.languageStats).toBeDefined();
    // 仅 ts-js 在 languageStats 中
    expect(result.languageStats!.size).toBe(1);
    expect(result.languageStats!.has('ts-js')).toBe(true);
  });

  it('T017: 仅有极少量文件的语言仍被检测并纳入 languageStats', () => {
    createFile(tmpDir, 'src/a.ts', 'export {}');
    createFile(tmpDir, 'src/b.ts', 'export {}');
    createFile(tmpDir, 'src/c.ts', 'export {}');
    createFile(tmpDir, 'scripts/deploy.go', 'package main');

    const result = scanFiles(tmpDir);

    expect(result.languageStats).toBeDefined();
    expect(result.languageStats!.has('go')).toBe(true);
    expect(result.languageStats!.get('go')!.fileCount).toBe(1);
  });
});
