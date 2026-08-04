/**
 * file-scanner 单元测试
 * 验证 .ts/.tsx/.js/.jsx 文件发现、.gitignore 规则遵循、
 * 嵌套目录递归扫描、空目录处理、符号链接忽略（FR-026）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanFiles, createGitignoreFilter } from '../../src/utils/file-scanner.js';
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

  // ============================================================
  // F194: createGitignoreFilter 导出冒烟测试
  // ============================================================

  it('createGitignoreFilter: 有 .gitignore → 命中路径返回 true，未命中返回 false', () => {
    createFile(tmpDir, '.gitignore', 'generated/\n*.stub.py\n');

    const isIgnored = createGitignoreFilter(tmpDir);

    // 目录模式命中
    expect(isIgnored('generated/auto.py')).toBe(true);
    // 通配模式命中
    expect(isIgnored('pkg/foo.stub.py')).toBe(true);
    // 未命中文件返回 false
    expect(isIgnored('pkg/core.py')).toBe(false);
  });

  it('createGitignoreFilter: 无 .gitignore → 始终返回 false', () => {
    const isIgnored = createGitignoreFilter(tmpDir);

    expect(isIgnored('anything.py')).toBe(false);
    expect(isIgnored('generated/x.py')).toBe(false);
  });

  // F255：非 git 上下文必须逐字节沿用修复前的根 .gitignore 近似解析
  // （维度收窄的 fail-open——固化这条判据，防止未来把 git 模式误接到非 git 路径）
  it('createGitignoreFilter: 非 git 目录 → 回退根 .gitignore 解析，嵌套 .gitignore 不生效', () => {
    createFile(tmpDir, '.gitignore', 'ignored/\n*.generated.ts\n');
    createFile(tmpDir, 'sub/.gitignore', '*.go\n');

    const isIgnored = createGitignoreFilter(tmpDir);

    // 根规则照常生效（与修复前一致）
    expect(isIgnored('ignored/skip.ts')).toBe(true);
    expect(isIgnored('pkg/foo.generated.ts')).toBe(true);
    expect(isIgnored('pkg/core.ts')).toBe(false);
    // 嵌套规则在回退模式下不可见——这是有意保留的降级面，不是缺陷
    expect(isIgnored('sub/foo.go')).toBe(false);
  });

  it('createGitignoreFilter: 非 git 目录 → 否定模式行为与修复前一致', () => {
    createFile(tmpDir, '.gitignore', '*.ts\n!important.ts\n');

    const isIgnored = createGitignoreFilter(tmpDir);

    expect(isIgnored('skip.ts')).toBe(true);
    expect(isIgnored('important.ts')).toBe(false);
  });
});

/**
 * F255：git 仓库内改以 git 本体为忽略事实源。
 * 全部用例使用真实 `git init` 仓库——不 mock git 输出，避免测试与实现共享同一份错误假设。
 */
describe('createGitignoreFilter：git 事实源模式（F255）', () => {
  let repoDir: string;

  function git(args: string[]): void {
    execFileSync('git', args, { cwd: repoDir, stdio: ['ignore', 'ignore', 'ignore'] });
  }

  function initRepo(): void {
    git(['init', '-q']);
    git(['config', 'user.email', 'f252-test@example.com']);
    git(['config', 'user.name', 'F255 Test']);
  }

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-scanner-git-test-'));
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('嵌套 .gitignore 声明的忽略模式生效（根 .gitignore 为空）', () => {
    createFile(repoDir, '.gitignore', '');
    createFile(repoDir, 'sub/.gitignore', '*.go\n');
    createFile(repoDir, 'sub/foo.go', 'package sub');
    createFile(repoDir, 'sub/keep.ts', 'export {}');
    initRepo();

    const isIgnored = createGitignoreFilter(repoDir);

    expect(isIgnored('sub/foo.go')).toBe(true);
    expect(isIgnored('sub/keep.ts')).toBe(false);
  });

  it('tracked 豁免：git add -f 强制入库的文件不再判 ignored', () => {
    createFile(repoDir, '.gitignore', '*.log\n');
    createFile(repoDir, 'forced.log', 'kept');
    createFile(repoDir, 'other.log', 'dropped');
    initRepo();
    git(['add', '-f', 'forced.log']);

    const isIgnored = createGitignoreFilter(repoDir);

    // tracked 文件的改动 git status 会报告 → 采集面必须同向收录
    expect(isIgnored('forced.log')).toBe(false);
    expect(isIgnored('other.log')).toBe(true);
  });

  it('整目录忽略：目录本身与其下任意深度路径均判 ignored', () => {
    createFile(repoDir, '.gitignore', 'wholedir/\n');
    createFile(repoDir, 'wholedir/deep/a.ts', 'export {}');
    initRepo();

    const isIgnored = createGitignoreFilter(repoDir);

    expect(isIgnored('wholedir')).toBe(true);
    expect(isIgnored('wholedir/deep/a.ts')).toBe(true);
    // 前缀不能按字符串裸匹配：wholedirectory 不是 wholedir 的子路径
    expect(isIgnored('wholedirectory/a.ts')).toBe(false);
  });

  it('walkBase 参数：忽略清单基准跟随 walk 根，避免子目录扫描时系统性 MISS', () => {
    createFile(repoDir, '.gitignore', '');
    createFile(repoDir, 'sub/.gitignore', '*.go\n');
    createFile(repoDir, 'sub/foo.go', 'package sub');
    initRepo();

    const subDir = path.join(repoDir, 'sub');
    const isIgnoredFromSub = createGitignoreFilter(repoDir, subDir);

    expect(isIgnoredFromSub('foo.go')).toBe(true);
    expect(isIgnoredFromSub('keep.ts')).toBe(false);
    // 对照：基准错位（清单相对仓库根、查询相对子目录）时查不中——正是 walkBase 参数要防的回归
    expect(createGitignoreFilter(repoDir)('foo.go')).toBe(false);
  });

  it('git 命令失败但 .git 存在 → console.warn 一次并回退根 .gitignore 解析', () => {
    // 畸形 .git 文件让 git 必然失败（真实失败路径，不 mock 子进程）
    createFile(repoDir, '.git', 'not a valid gitfile');
    createFile(repoDir, '.gitignore', 'generated/\n');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const isIgnored = createGitignoreFilter(repoDir);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(isIgnored('generated/auto.py')).toBe(true);
    expect(isIgnored('pkg/core.py')).toBe(false);
  });

  it('非 git 目录且无 .git → 静默回退，不产生 warn 噪声', () => {
    createFile(repoDir, '.gitignore', 'generated/\n');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const isIgnored = createGitignoreFilter(repoDir);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(isIgnored('generated/auto.py')).toBe(true);
  });
});
