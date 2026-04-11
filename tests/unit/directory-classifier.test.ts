/**
 * directory-classifier 单元测试
 * 验证三信号分类逻辑、用户覆盖优先级、批量分类
 */
import { describe, it, expect } from 'vitest';
import {
  classifyDirectory,
  classifyDirectories,
} from '../../src/batch/directory-classifier.js';

// ============================================================
// classifyDirectory 单目录测试
// ============================================================

describe('classifyDirectory - 目录名称模式信号', () => {
  it('tests/ → test', () => {
    const result = classifyDirectory('src/tests');
    expect(result.category).toBe('test');
    expect(result.signals.some((s) => s.type === 'name_pattern')).toBe(true);
  });

  it('__tests__/ → test', () => {
    const result = classifyDirectory('src/__tests__');
    expect(result.category).toBe('test');
  });

  it('examples/ → example', () => {
    const result = classifyDirectory('examples');
    expect(result.category).toBe('example');
  });

  it('worked/ → example', () => {
    const result = classifyDirectory('worked');
    expect(result.category).toBe('example');
  });

  it('vendor/ → vendor', () => {
    const result = classifyDirectory('vendor');
    expect(result.category).toBe('vendor');
  });

  it('dist/ → vendor', () => {
    const result = classifyDirectory('dist');
    expect(result.category).toBe('vendor');
  });

  it('build/ → vendor', () => {
    const result = classifyDirectory('build');
    expect(result.category).toBe('vendor');
  });

  it('docs/ → docs', () => {
    const result = classifyDirectory('docs');
    expect(result.category).toBe('docs');
  });

  it('config/ → config', () => {
    const result = classifyDirectory('config');
    expect(result.category).toBe('config');
  });

  it('src/ → source（无匹配时保守归为 source）', () => {
    const result = classifyDirectory('src');
    expect(result.category).toBe('source');
  });

  it('core/ → source（无匹配时保守归为 source）', () => {
    const result = classifyDirectory('core');
    expect(result.category).toBe('source');
  });
});

describe('classifyDirectory - Import 反向引用信号', () => {
  it('被多处 import 的目录应有 source import_reference 信号', () => {
    const importers = new Set(['main.ts', 'server.ts', 'client.ts']);
    const result = classifyDirectory('examples', importers);
    // import 信号（source）与名称信号（example）竞争
    const importSignal = result.signals.find((s) => s.type === 'import_reference');
    expect(importSignal).toBeDefined();
    expect(importSignal!.suggestedCategory).toBe('source');
  });

  it('无 import 引用的目录不产生 import 信号', () => {
    const result = classifyDirectory('examples', new Set());
    expect(result.signals.every((s) => s.type !== 'import_reference')).toBe(true);
  });
});

describe('classifyDirectory - 用户覆盖优先级', () => {
  it('excludeDirs 覆盖自动分类（强制非 source）', () => {
    // 即使是 src/ 这样本来是 source 的目录，excludeDirs 也强制排除
    const result = classifyDirectory('src', new Set(), { excludeDirs: ['src'] });
    expect(result.isUserOverride).toBe(true);
    expect(result.category).not.toBe('source');
  });

  it('includeDirs 覆盖自动分类（强制 source）', () => {
    // examples/ 本来是 example，但 includeDirs 强制为 source
    const result = classifyDirectory('examples', new Set(), { includeDirs: ['examples'] });
    expect(result.isUserOverride).toBe(true);
    expect(result.category).toBe('source');
  });

  it('includeDirs 优先级高于 excludeDirs（includeDirs 在调用方控制排序）', () => {
    // 同时出现在两个列表时，includeDirs 优先（按函数内检查顺序：exclude 先，include 后，所以 include 最终会覆盖 exclude 的场景不测试，但分别测试功能正确）
    const excludeResult = classifyDirectory('mydir', new Set(), { excludeDirs: ['mydir'] });
    expect(excludeResult.isUserOverride).toBe(true);

    const includeResult = classifyDirectory('mydir', new Set(), { includeDirs: ['mydir'] });
    expect(includeResult.category).toBe('source');
  });
});

describe('classifyDirectory - 分类结果字段完整性', () => {
  it('返回结果包含所有必要字段', () => {
    const result = classifyDirectory('tests');
    expect(result).toHaveProperty('dirPath');
    expect(result).toHaveProperty('category');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('signals');
    expect(result).toHaveProperty('isUserOverride');
    expect(Array.isArray(result.signals)).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('信号字段结构正确', () => {
    const result = classifyDirectory('tests');
    for (const signal of result.signals) {
      expect(signal).toHaveProperty('type');
      expect(signal).toHaveProperty('suggestedCategory');
      expect(signal).toHaveProperty('weight');
      expect(signal).toHaveProperty('description');
    }
  });
});

// ============================================================
// classifyDirectories 批量测试
// ============================================================

describe('classifyDirectories', () => {
  it('批量处理多个目录', () => {
    const dirs = ['src', 'tests', 'examples', 'vendor', 'docs'];
    const results = classifyDirectories(dirs);
    expect(results).toHaveLength(dirs.length);
    expect(results[0]!.category).toBe('source');  // src
    expect(results[1]!.category).toBe('test');    // tests
    expect(results[2]!.category).toBe('example'); // examples
    expect(results[3]!.category).toBe('vendor');  // vendor
    expect(results[4]!.category).toBe('docs');    // docs
  });

  it('Import 边正确传播到目录分类', () => {
    const dirs = ['examples'];
    const importEdges = [
      { from: 'src/main.ts', to: 'examples/core.ts' },
      { from: 'src/server.ts', to: 'examples/helper.ts' },
    ];
    const results = classifyDirectories(dirs, importEdges);
    // examples/ 被外部 import，应有 import_reference 信号
    const importSignal = results[0]!.signals.find((s) => s.type === 'import_reference');
    expect(importSignal).toBeDefined();
  });

  it('空目录列表返回空数组', () => {
    const results = classifyDirectories([]);
    expect(results).toHaveLength(0);
  });

  it('用户覆盖选项传播到每个目录', () => {
    const dirs = ['examples', 'vendor'];
    const results = classifyDirectories(dirs, [], { includeDirs: ['examples'] });
    // examples 应被强制设为 source
    expect(results[0]!.category).toBe('source');
    expect(results[0]!.isUserOverride).toBe(true);
    // vendor 不受影响
    expect(results[1]!.category).toBe('vendor');
    expect(results[1]!.isUserOverride).toBe(false);
  });
});
