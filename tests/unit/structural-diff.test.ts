/**
 * structural-diff 单元测试
 * 验证 compareSkeletons 对导出符号差异的分类（FR-019）
 */
import { describe, it, expect } from 'vitest';
import { compareSkeletons } from '../../src/diff/structural-diff.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';

function makeSkeleton(overrides: Partial<CodeSkeleton> = {}): CodeSkeleton {
  return {
    filePath: 'src/example.ts',
    language: 'typescript',
    loc: 100,
    exports: [],
    imports: [],
    hash: 'a'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'ts-morph',
    ...overrides,
  };
}

describe('compareSkeletons', () => {
  it('两个相同骨架应返回空差异', () => {
    const skeleton = makeSkeleton({
      exports: [
        { name: 'foo', kind: 'function', signature: '() => void', startLine: 1, endLine: 5, isDefault: false },
      ],
    });
    const result = compareSkeletons(skeleton, skeleton);
    expect(result).toHaveLength(0);
  });

  it('检测删除的导出 — HIGH 严重级别', () => {
    const old = makeSkeleton({
      exports: [
        { name: 'removed', kind: 'function', signature: '() => void', startLine: 1, endLine: 5, isDefault: false },
      ],
    });
    const now = makeSkeleton({ exports: [] });

    const result = compareSkeletons(old, now);
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('HIGH');
    expect(result[0]!.changeType).toBe('removal');
    expect(result[0]!.symbolName).toBe('removed');
    expect(result[0]!.detectedBy).toBe('structural');
  });

  it('检测新增的导出 — LOW 严重级别', () => {
    const old = makeSkeleton({ exports: [] });
    const now = makeSkeleton({
      exports: [
        { name: 'added', kind: 'function', signature: '(x: number) => string', startLine: 10, endLine: 20, isDefault: false },
      ],
    });

    const result = compareSkeletons(old, now);
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('LOW');
    expect(result[0]!.changeType).toBe('addition');
    expect(result[0]!.symbolName).toBe('added');
  });

  it('检测签名修改 — MEDIUM 严重级别', () => {
    const old = makeSkeleton({
      exports: [
        { name: 'transform', kind: 'function', signature: '(x: number) => number', startLine: 1, endLine: 5, isDefault: false },
      ],
    });
    const now = makeSkeleton({
      exports: [
        { name: 'transform', kind: 'function', signature: '(x: number, y: number) => number', startLine: 1, endLine: 8, isDefault: false },
      ],
    });

    const result = compareSkeletons(old, now);
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('MEDIUM');
    expect(result[0]!.changeType).toBe('modification');
    expect(result[0]!.oldValue).toBe('(x: number) => number');
    expect(result[0]!.newValue).toBe('(x: number, y: number) => number');
  });

  it('检测类型参数修改', () => {
    const old = makeSkeleton({
      exports: [
        { name: 'Container', kind: 'class', signature: 'class Container', startLine: 1, endLine: 50, isDefault: false, typeParameters: ['T'] },
      ],
    });
    const now = makeSkeleton({
      exports: [
        { name: 'Container', kind: 'class', signature: 'class Container', startLine: 1, endLine: 55, isDefault: false, typeParameters: ['T', 'U'] },
      ],
    });

    const result = compareSkeletons(old, now);
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('MEDIUM');
    expect(result[0]!.description).toContain('类型参数');
  });

  it('检测成员删除', () => {
    const old = makeSkeleton({
      exports: [
        {
          name: 'MyClass', kind: 'class', signature: 'class MyClass', startLine: 1, endLine: 30, isDefault: false,
          members: [
            { name: 'method1', kind: 'method', signature: '() => void' },
            { name: 'method2', kind: 'method', signature: '() => string' },
          ],
        },
      ],
    });
    const now = makeSkeleton({
      exports: [
        {
          name: 'MyClass', kind: 'class', signature: 'class MyClass', startLine: 1, endLine: 20, isDefault: false,
          members: [
            { name: 'method1', kind: 'method', signature: '() => void' },
          ],
        },
      ],
    });

    const result = compareSkeletons(old, now);
    expect(result).toHaveLength(1);
    expect(result[0]!.changeType).toBe('removal');
    expect(result[0]!.symbolName).toBe('MyClass.method2');
  });

  it('检测成员新增', () => {
    const old = makeSkeleton({
      exports: [
        {
          name: 'MyClass', kind: 'class', signature: 'class MyClass', startLine: 1, endLine: 10, isDefault: false,
          members: [],
        },
      ],
    });
    const now = makeSkeleton({
      exports: [
        {
          name: 'MyClass', kind: 'class', signature: 'class MyClass', startLine: 1, endLine: 20, isDefault: false,
          members: [
            { name: 'newMethod', kind: 'method', signature: '(arg: string) => boolean' },
          ],
        },
      ],
    });

    const result = compareSkeletons(old, now);
    expect(result).toHaveLength(1);
    expect(result[0]!.changeType).toBe('addition');
    expect(result[0]!.symbolName).toBe('MyClass.newMethod');
    expect(result[0]!.severity).toBe('LOW');
  });

  it('检测成员签名修改', () => {
    const old = makeSkeleton({
      exports: [
        {
          name: 'Service', kind: 'class', signature: 'class Service', startLine: 1, endLine: 30, isDefault: false,
          members: [
            { name: 'init', kind: 'method', signature: '() => void' },
          ],
        },
      ],
    });
    const now = makeSkeleton({
      exports: [
        {
          name: 'Service', kind: 'class', signature: 'class Service', startLine: 1, endLine: 30, isDefault: false,
          members: [
            { name: 'init', kind: 'method', signature: '(config: Config) => Promise<void>' },
          ],
        },
      ],
    });

    const result = compareSkeletons(old, now);
    expect(result).toHaveLength(1);
    expect(result[0]!.changeType).toBe('modification');
    expect(result[0]!.symbolName).toBe('Service.init');
    expect(result[0]!.severity).toBe('MEDIUM');
  });

  it('复合场景：同时删除、新增、修改', () => {
    const old = makeSkeleton({
      exports: [
        { name: 'toRemove', kind: 'function', signature: '() => void', startLine: 1, endLine: 5, isDefault: false },
        { name: 'toModify', kind: 'function', signature: '(a: string) => number', startLine: 6, endLine: 10, isDefault: false },
        { name: 'unchanged', kind: 'const', signature: 'const unchanged: string', startLine: 11, endLine: 11, isDefault: false },
      ],
    });
    const now = makeSkeleton({
      exports: [
        { name: 'toModify', kind: 'function', signature: '(a: string, b: string) => number', startLine: 1, endLine: 8, isDefault: false },
        { name: 'unchanged', kind: 'const', signature: 'const unchanged: string', startLine: 9, endLine: 9, isDefault: false },
        { name: 'brandNew', kind: 'type', signature: 'type brandNew = Record<string, unknown>', startLine: 10, endLine: 10, isDefault: false },
      ],
    });

    const result = compareSkeletons(old, now);
    expect(result).toHaveLength(3);

    const removal = result.find((d) => d.changeType === 'removal');
    const modification = result.find((d) => d.changeType === 'modification');
    const addition = result.find((d) => d.changeType === 'addition');

    expect(removal).toBeDefined();
    expect(removal!.severity).toBe('HIGH');
    expect(removal!.symbolName).toBe('toRemove');

    expect(modification).toBeDefined();
    expect(modification!.severity).toBe('MEDIUM');
    expect(modification!.symbolName).toBe('toModify');

    expect(addition).toBeDefined();
    expect(addition!.severity).toBe('LOW');
    expect(addition!.symbolName).toBe('brandNew');
  });

  it('每个 DriftItem 都有唯一 id', () => {
    const old = makeSkeleton({
      exports: [
        { name: 'a', kind: 'function', signature: '() => void', startLine: 1, endLine: 5, isDefault: false },
        { name: 'b', kind: 'function', signature: '() => string', startLine: 6, endLine: 10, isDefault: false },
      ],
    });
    const now = makeSkeleton({ exports: [] });

    const result = compareSkeletons(old, now);
    expect(result).toHaveLength(2);
    const ids = new Set(result.map((d) => d.id));
    expect(ids.size).toBe(2);
  });
});
