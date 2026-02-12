/**
 * noise-filter 单元测试
 * 验证 filterNoise 对非实质性变更的过滤（FR-021）
 */
import { describe, it, expect } from 'vitest';
import { filterNoise } from '../../src/diff/noise-filter.js';
import type { DriftItem } from '../../src/models/drift-item.js';

function makeDriftItem(overrides: Partial<DriftItem> = {}): DriftItem {
  return {
    id: `test-${Date.now()}-${Math.random()}`,
    severity: 'MEDIUM',
    category: 'Interface',
    changeType: 'modification',
    location: 'src/example.ts:10',
    symbolName: 'testFn',
    description: '测试漂移项',
    oldValue: 'const x = 1;',
    newValue: 'const x = 2;',
    proposedUpdate: '更新文档',
    detectedBy: 'structural',
    ...overrides,
  };
}

describe('filterNoise', () => {
  it('空输入返回空结果', () => {
    const result = filterNoise([], '', '');
    expect(result.substantive).toHaveLength(0);
    expect(result.filtered).toBe(0);
    expect(result.filterReasons.size).toBe(0);
  });

  it('保留实质性变更', () => {
    const items = [
      makeDriftItem({
        id: 'real-change',
        oldValue: 'function add(a: number): number',
        newValue: 'function add(a: number, b: number): number',
      }),
    ];

    const result = filterNoise(items, '', '');
    expect(result.substantive).toHaveLength(1);
    expect(result.filtered).toBe(0);
  });

  it('过滤仅空白字符变更', () => {
    const items = [
      makeDriftItem({
        id: 'whitespace-only',
        oldValue: 'const x  =  1',
        newValue: 'const x = 1',
      }),
    ];

    const result = filterNoise(items, '', '');
    expect(result.substantive).toHaveLength(0);
    expect(result.filtered).toBe(1);
    expect(result.filterReasons.get('whitespace-only')).toContain('空白');
  });

  it('过滤仅注释变更', () => {
    const items = [
      makeDriftItem({
        id: 'comment-only',
        oldValue: 'const x = 1; // old comment',
        newValue: 'const x = 1; // new comment',
      }),
    ];

    const result = filterNoise(items, '', '');
    expect(result.substantive).toHaveLength(0);
    expect(result.filtered).toBe(1);
  });

  it('过滤尾逗号差异', () => {
    const items = [
      makeDriftItem({
        id: 'trailing-comma',
        oldValue: '{ a: 1, b: 2,}',
        newValue: '{ a: 1, b: 2}',
      }),
    ];

    const result = filterNoise(items, '', '');
    expect(result.substantive).toHaveLength(0);
    expect(result.filtered).toBe(1);
  });

  it('过滤分号差异（ASI 等价）', () => {
    const items = [
      makeDriftItem({
        id: 'semicolons',
        oldValue: 'const x = 1;',
        newValue: 'const x = 1',
      }),
    ];

    const result = filterNoise(items, '', '');
    expect(result.substantive).toHaveLength(0);
    expect(result.filtered).toBe(1);
  });

  it('过滤 import 重排序', () => {
    const items = [
      makeDriftItem({
        id: 'import-reorder',
        oldValue: "import { a } from 'a'\nimport { b } from 'b'",
        newValue: "import { b } from 'b'\nimport { a } from 'a'",
      }),
    ];

    const result = filterNoise(items, '', '');
    expect(result.substantive).toHaveLength(0);
    expect(result.filtered).toBe(1);
    expect(result.filterReasons.get('import-reorder')).toContain('import');
  });

  it('不过滤 import 增删（非纯重排序）', () => {
    const items = [
      makeDriftItem({
        id: 'import-added',
        oldValue: "import { a } from 'a'",
        newValue: "import { a } from 'a'\nimport { c } from 'c'",
      }),
    ];

    const result = filterNoise(items, '', '');
    expect(result.substantive).toHaveLength(1);
    expect(result.filtered).toBe(0);
  });

  it('混合场景：同时包含噪声和实质变更', () => {
    const items = [
      makeDriftItem({
        id: 'noise-1',
        oldValue: 'const x = 1;',
        newValue: 'const x = 1',
      }),
      makeDriftItem({
        id: 'real-1',
        oldValue: 'function foo(): string',
        newValue: 'function foo(): number',
      }),
      makeDriftItem({
        id: 'noise-2',
        oldValue: '{ a: 1,}',
        newValue: '{ a: 1}',
      }),
    ];

    const result = filterNoise(items, '', '');
    expect(result.substantive).toHaveLength(1);
    expect(result.substantive[0]!.id).toBe('real-1');
    expect(result.filtered).toBe(2);
  });

  it('oldValue 或 newValue 为 null 时不会崩溃', () => {
    const items = [
      makeDriftItem({
        id: 'null-old',
        oldValue: null,
        newValue: 'function newFn(): void',
      }),
      makeDriftItem({
        id: 'null-new',
        oldValue: 'function oldFn(): void',
        newValue: null,
      }),
    ];

    const result = filterNoise(items, '', '');
    // null 值不会匹配空白规则，保留为实质变更
    expect(result.substantive).toHaveLength(2);
    expect(result.filtered).toBe(0);
  });

  it('过滤多行注释变更', () => {
    const items = [
      makeDriftItem({
        id: 'multiline-comment',
        oldValue: '/* old comment */\nconst x = 1',
        newValue: '/* new comment\n   spanning lines */\nconst x = 1',
      }),
    ];

    const result = filterNoise(items, '', '');
    expect(result.substantive).toHaveLength(0);
    expect(result.filtered).toBe(1);
  });
});
