/**
 * language-grouper 单元测试
 * 验证按语言分组、语言过滤、边界情况处理
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { groupFilesByLanguage } from '../../src/batch/language-grouper.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';

describe('language-grouper', () => {
  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
  });

  afterEach(() => {
    LanguageAdapterRegistry.resetInstance();
  });

  it('T049: 混合 .ts/.py/.go 文件正确分为三个语言组', () => {
    const files = [
      'src/index.ts',
      'src/utils.tsx',
      'src/helper.py',
      'src/main.go',
    ];

    const result = groupFilesByLanguage(files);

    expect(result.groups).toHaveLength(3);

    const tsGroup = result.groups.find((g) => g.adapterId === 'ts-js');
    expect(tsGroup).toBeDefined();
    expect(tsGroup!.files).toHaveLength(2);

    const pyGroup = result.groups.find((g) => g.adapterId === 'python');
    expect(pyGroup).toBeDefined();
    expect(pyGroup!.files).toHaveLength(1);

    const goGroup = result.groups.find((g) => g.adapterId === 'go');
    expect(goGroup).toBeDefined();
    expect(goGroup!.files).toHaveLength(1);

    expect(result.warnings).toHaveLength(0);
  });

  it('T050: filterLanguages=[\'ts-js\'] 时仅保留 ts-js 组', () => {
    const files = [
      'src/index.ts',
      'src/helper.py',
      'src/main.go',
    ];

    const result = groupFilesByLanguage(files, ['ts-js']);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.adapterId).toBe('ts-js');
    expect(result.warnings).toHaveLength(0);
  });

  it('T051: filterLanguages 指定不存在的语言时返回空结果和警告', () => {
    const files = [
      'src/index.ts',
      'src/helper.py',
    ];

    const result = groupFilesByLanguage(files, ['rust']);

    expect(result.groups).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('rust');
  });

  it('T052: 空文件列表返回空分组', () => {
    const result = groupFilesByLanguage([]);

    expect(result.groups).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('T053: 未注册扩展名的文件被忽略不纳入任何分组', () => {
    const files = [
      'src/index.ts',
      'src/style.css',
      'src/config.yaml',
      'src/data.json',
    ];

    const result = groupFilesByLanguage(files);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.adapterId).toBe('ts-js');
    expect(result.groups[0]!.files).toHaveLength(1);
  });

  it('T054: filterLanguages=[\'ts-js\', \'python\'] 时保留两个语言组', () => {
    const files = [
      'src/index.ts',
      'src/helper.py',
      'src/main.go',
    ];

    const result = groupFilesByLanguage(files, ['ts-js', 'python']);

    expect(result.groups).toHaveLength(2);
    const ids = result.groups.map((g) => g.adapterId).sort();
    expect(ids).toEqual(['python', 'ts-js']);
    expect(result.warnings).toHaveLength(0);
  });
});
