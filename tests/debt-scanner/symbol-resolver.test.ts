/**
 * symbol-resolver 单元测试
 */
import { describe, it, expect } from 'vitest';
import { resolveEnclosingSymbol } from '../../src/debt-scanner/comments/symbol-resolver.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';

function buildSkeleton(exports: Array<{ name: string; startLine: number; endLine: number }>): CodeSkeleton {
  return {
    filePath: 'a.ts',
    language: 'typescript',
    loc: 100,
    exports: exports.map((e) => ({
      name: e.name,
      kind: 'function' as const,
      signature: `function ${e.name}()`,
      isDefault: false,
      startLine: e.startLine,
      endLine: e.endLine,
    })),
    imports: [],
    hash: 'a'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'ts-morph' as const,
  };
}

describe('resolveEnclosingSymbol', () => {
  it('行在某个 export 范围内返回该符号', () => {
    const sk = buildSkeleton([{ name: 'foo', startLine: 10, endLine: 20 }]);
    expect(resolveEnclosingSymbol(sk, 15)).toBe('foo');
  });

  it('行不在任何 export 内返回 null', () => {
    const sk = buildSkeleton([{ name: 'foo', startLine: 10, endLine: 20 }]);
    expect(resolveEnclosingSymbol(sk, 5)).toBeNull();
    expect(resolveEnclosingSymbol(sk, 25)).toBeNull();
  });

  it('嵌套符号选择范围最小的（最内层）', () => {
    const sk = buildSkeleton([
      { name: 'OuterClass', startLine: 1, endLine: 100 },
      { name: 'innerMethod', startLine: 20, endLine: 30 },
    ]);
    expect(resolveEnclosingSymbol(sk, 25)).toBe('innerMethod');
  });

  it('skeleton 为 null 时返回 null', () => {
    expect(resolveEnclosingSymbol(null, 5)).toBeNull();
  });
});
