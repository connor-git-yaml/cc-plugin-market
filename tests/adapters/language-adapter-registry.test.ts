/**
 * LanguageAdapterRegistry 单元测试
 * 覆盖：单例保证、注册、查找、冲突检测、重置、空状态、无扩展名文件、大小写不敏感
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import type { LanguageAdapter } from '../../src/adapters/language-adapter.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';
import type { DependencyGraph } from '../../src/models/dependency-graph.js';

/**
 * 创建测试用的 Mock 适配器
 */
function createMockAdapter(
  id: string,
  extensions: string[],
  ignoreDirs: string[] = [],
): LanguageAdapter {
  return {
    id,
    languages: ['typescript'] as const,
    extensions: new Set(extensions),
    defaultIgnoreDirs: new Set(ignoreDirs),
    analyzeFile: async () => ({}) as CodeSkeleton,
    analyzeFallback: async () => ({}) as CodeSkeleton,
    getTerminology: () => ({
      codeBlockLanguage: 'typescript',
      exportConcept: 'export',
      importConcept: 'import',
      typeSystemDescription: 'static',
      interfaceConcept: 'interface',
      moduleSystem: 'ESM',
    }),
    getTestPatterns: () => ({
      filePattern: /\.test\.ts$/,
      testDirs: ['tests'],
    }),
  };
}

describe('LanguageAdapterRegistry', () => {
  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
  });

  afterEach(() => {
    LanguageAdapterRegistry.resetInstance();
  });

  it('单例保证：连续两次 getInstance() 返回相同引用', () => {
    const a = LanguageAdapterRegistry.getInstance();
    const b = LanguageAdapterRegistry.getInstance();
    expect(a).toBe(b);
  });

  it('resetInstance() 后 getInstance() 返回新实例', () => {
    const old = LanguageAdapterRegistry.getInstance();
    LanguageAdapterRegistry.resetInstance();
    const fresh = LanguageAdapterRegistry.getInstance();
    expect(fresh).not.toBe(old);
  });

  it('新实例 getAllAdapters() 返回空数组', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    expect(registry.getAllAdapters()).toEqual([]);
  });

  it('新实例 getAdapter(anyFile) 返回 null', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    expect(registry.getAdapter('anything.ts')).toBeNull();
  });

  it('注册适配器后 getAdapter 返回正确适配器', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const adapter = createMockAdapter('ts-js', ['.ts', '.tsx', '.js', '.jsx']);
    registry.register(adapter);

    expect(registry.getAdapter('src/foo.ts')).toBe(adapter);
    expect(registry.getAdapter('src/bar.tsx')).toBe(adapter);
    expect(registry.getAdapter('lib/baz.js')).toBe(adapter);
    expect(registry.getAdapter('app.jsx')).toBe(adapter);
  });

  it('扩展名大小写不敏感：getAdapter("Foo.TS") 返回正确适配器', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const adapter = createMockAdapter('ts-js', ['.ts']);
    registry.register(adapter);

    expect(registry.getAdapter('Foo.TS')).toBe(adapter);
    expect(registry.getAdapter('Bar.Ts')).toBe(adapter);
  });

  it('无扩展名文件 getAdapter("Makefile") 返回 null', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const adapter = createMockAdapter('ts-js', ['.ts']);
    registry.register(adapter);

    expect(registry.getAdapter('Makefile')).toBeNull();
  });

  it('冲突注册抛出 Error（含冲突扩展名和原适配器 id）', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const adapter1 = createMockAdapter('ts-js', ['.ts', '.js']);
    const adapter2 = createMockAdapter('new-ts', ['.ts']);

    registry.register(adapter1);

    expect(() => registry.register(adapter2)).toThrow(/扩展名冲突.*\.ts.*ts-js/);
  });

  it('冲突注册失败后 Registry 状态不受污染', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const adapter1 = createMockAdapter('ts-js', ['.ts', '.js']);
    // 第二个适配器声明 .py 和 .ts，其中 .ts 冲突
    const adapter2 = createMockAdapter('mixed', ['.py', '.ts']);

    registry.register(adapter1);

    expect(() => registry.register(adapter2)).toThrow(/扩展名冲突/);

    // .py 不应被注册（原子性：冲突时不做部分注册）
    expect(registry.getAdapter('foo.py')).toBeNull();
    // 原有注册不受影响
    expect(registry.getAdapter('foo.ts')?.id).toBe('ts-js');
    // 适配器列表不应包含冲突的适配器
    expect(registry.getAllAdapters().length).toBe(1);
  });

  it('getSupportedExtensions() 返回所有已注册扩展名', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    registry.register(createMockAdapter('ts-js', ['.ts', '.tsx', '.js', '.jsx']));

    const exts = registry.getSupportedExtensions();
    expect(exts).toEqual(new Set(['.ts', '.tsx', '.js', '.jsx']));
  });

  it('getDefaultIgnoreDirs() 聚合所有适配器的忽略目录', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    registry.register(createMockAdapter('ts-js', ['.ts'], ['node_modules', 'dist']));
    registry.register(createMockAdapter('python', ['.py'], ['__pycache__', 'dist']));

    const dirs = registry.getDefaultIgnoreDirs();
    expect(dirs).toEqual(new Set(['node_modules', 'dist', '__pycache__']));
  });
});
