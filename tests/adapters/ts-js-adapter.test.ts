/**
 * TsJsLanguageAdapter 静态属性单元测试
 * 覆盖：id、extensions、languages、defaultIgnoreDirs、getTerminology、getTestPatterns
 */
import { describe, it, expect } from 'vitest';
import { TsJsLanguageAdapter } from '../../src/adapters/ts-js-adapter.js';

describe('TsJsLanguageAdapter 静态属性', () => {
  const adapter = new TsJsLanguageAdapter();

  it('id 为 "ts-js"', () => {
    expect(adapter.id).toBe('ts-js');
  });

  it('extensions 包含且仅包含 .ts/.tsx/.js/.jsx', () => {
    expect(adapter.extensions).toEqual(new Set(['.ts', '.tsx', '.js', '.jsx']));
    expect(adapter.extensions.size).toBe(4);
  });

  it('languages 包含 "typescript" 和 "javascript"', () => {
    expect(adapter.languages).toContain('typescript');
    expect(adapter.languages).toContain('javascript');
    expect(adapter.languages.length).toBe(2);
  });

  it('defaultIgnoreDirs 包含 node_modules 等 5 个 TS/JS 生态特有目录', () => {
    const dirs = adapter.defaultIgnoreDirs;
    expect(dirs.has('node_modules')).toBe(true);
    expect(dirs.has('dist')).toBe(true);
    expect(dirs.has('build')).toBe(true);
    expect(dirs.has('.next')).toBe(true);
    expect(dirs.has('.nuxt')).toBe(true);
    // coverage 属于通用忽略目录，由 file-scanner 的 UNIVERSAL_IGNORE_DIRS 维护
    expect(dirs.has('coverage')).toBe(false);
    expect(dirs.size).toBe(5);
  });

  it('getTerminology().codeBlockLanguage 为 "typescript"', () => {
    const terminology = adapter.getTerminology();
    expect(terminology.codeBlockLanguage).toBe('typescript');
    expect(terminology.exportConcept).toContain('export');
    expect(terminology.importConcept).toContain('import');
    expect(terminology.moduleSystem).toContain('ES Modules');
  });

  it('getTestPatterns().filePattern 正确匹配测试文件', () => {
    const patterns = adapter.getTestPatterns();
    expect(patterns.filePattern.test('foo.test.ts')).toBe(true);
    expect(patterns.filePattern.test('bar.spec.tsx')).toBe(true);
    expect(patterns.filePattern.test('baz.test.js')).toBe(true);
    expect(patterns.filePattern.test('qux.spec.jsx')).toBe(true);
    // 非测试文件不匹配
    expect(patterns.filePattern.test('foo.ts')).toBe(false);
    expect(patterns.filePattern.test('bar.js')).toBe(false);
    // testDirs
    expect(patterns.testDirs).toContain('__tests__');
    expect(patterns.testDirs).toContain('tests');
    expect(patterns.testDirs).toContain('test');
    expect(patterns.testDirs).toContain('__mocks__');
  });
});
