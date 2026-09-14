/**
 * M11 卡 A（P1-I）— call-resolver 每条 calls 边携带 metadata.resolution（stage / strategy / basis）
 * 与 metadata.callSite（line / column）。此前 mkEdge 把调用点行号丢掉、也不区分命中的是
 * 索引直查还是占位启发式，消费方只能看到一个 high/medium/low。
 */
import { describe, expect, it } from 'vitest';
import { resolveCalls, type CallSiteWithFile } from '../../../src/knowledge-graph/call-resolver.js';
import type { CodeSkeleton } from '../../../src/models/code-skeleton.js';

function mkSkeleton(opts: {
  filePath: string;
  language?: CodeSkeleton['language'];
  exports?: CodeSkeleton['exports'];
  imports?: CodeSkeleton['imports'];
}): CodeSkeleton {
  return {
    filePath: opts.filePath,
    language: opts.language ?? 'python',
    loc: 100,
    exports: opts.exports ?? [],
    imports: opts.imports ?? [],
    hash: 'a'.repeat(64),
    analyzedAt: '2026-09-15T00:00:00.000Z',
    parserUsed: 'tree-sitter',
  };
}
function skeletons(list: CodeSkeleton[]): Map<string, CodeSkeleton> {
  return new Map(list.map((s) => [s.filePath, s]));
}
const fn = (name: string): CodeSkeleton['exports'][number] => ({
  name, kind: 'function', signature: `def ${name}()`, isDefault: false, startLine: 1, endLine: 5,
});
const cls = (name: string, members: string[], extendsFrom?: string): CodeSkeleton['exports'][number] => ({
  name, kind: 'class', signature: extendsFrom ? `class ${name}(${extendsFrom}):` : `class ${name}:`,
  isDefault: false, startLine: 10, endLine: 40,
  members: members.map((m) => ({ name: m, kind: 'method' as const, signature: `def ${m}(self)` })),
});
function meta(edges: ReturnType<typeof resolveCalls>, i = 0): Record<string, unknown> {
  expect(edges.length).toBeGreaterThan(i);
  return (edges[i]!.metadata ?? {}) as Record<string, unknown>;
}

describe('resolveCalls — resolution 标签与 callSite', () => {
  it('Stage 1 本地导出命中：local-export / export-table / index，callSite 带行列', () => {
    const sk = skeletons([mkSkeleton({ filePath: 'a.py', exports: [fn('foo'), fn('bar')] })]);
    const cs: CallSiteWithFile = { callerFile: 'a.py', calleeName: 'foo', calleeKind: 'free', line: 12, column: 4, callerContext: 'bar' };
    const edges = resolveCalls([cs], sk);
    expect(edges[0]!.confidence).toBe('high');
    expect(meta(edges)['resolution']).toEqual({ stage: 'local-export', strategy: 'export-table', basis: 'index' });
    expect(meta(edges)['callSite']).toEqual({ line: 12, column: 4 });
  });

  it('Stage 2 自身类成员命中：member / class-member / index；column 缺席时 callSite 只带 line', () => {
    const sk = skeletons([mkSkeleton({ filePath: 'a.py', exports: [cls('Value', ['add', 'mul'])] })]);
    const cs: CallSiteWithFile = { callerFile: 'a.py', calleeName: 'add', calleeKind: 'member', line: 30, callerContext: 'Value.mul' };
    const edges = resolveCalls([cs], sk);
    expect(edges[0]!.target).toBe('a.py::Value.add');
    expect(meta(edges)['resolution']).toEqual({ stage: 'member', strategy: 'class-member', basis: 'index' });
    expect(meta(edges)['callSite']).toEqual({ line: 30 });
  });

  it('Stage 2 类可定位但成员既不在自身也不在 MRO：class-member-placeholder / heuristic', () => {
    const sk = skeletons([mkSkeleton({ filePath: 'a.py', exports: [cls('Value', ['add'])] })]);
    const cs: CallSiteWithFile = { callerFile: 'a.py', calleeName: 'ghost', calleeKind: 'member', line: 31, callerContext: 'Value.add' };
    const edges = resolveCalls([cs], sk);
    expect(edges[0]!.confidence).toBe('medium');
    expect(meta(edges)['resolution']).toEqual({ stage: 'member', strategy: 'class-member-placeholder', basis: 'heuristic' });
  });

  it('Stage 2 MRO 父类命中：class-mro / index', () => {
    const sk = skeletons([mkSkeleton({ filePath: 'a.py', exports: [cls('Base', ['tick']), cls('Child', ['run'], 'Base')] })]);
    const cs: CallSiteWithFile = { callerFile: 'a.py', calleeName: 'tick', calleeKind: 'member', line: 22, callerContext: 'Child.run' };
    const edges = resolveCalls([cs], sk);
    expect(edges[0]!.target).toBe('a.py::Base.tick');
    expect(meta(edges)['resolution']).toEqual({ stage: 'member', strategy: 'class-mro', basis: 'index' });
  });

  it('Stage 3 import 表命中：cross-module / import-table / index；通配 import：star-import / heuristic', () => {
    const named = skeletons([
      mkSkeleton({ filePath: 'a.py', imports: [{ moduleSpecifier: 'b', isRelative: false, resolvedPath: 'b.py', namedImports: ['helper'], isTypeOnly: false }] }),
      mkSkeleton({ filePath: 'b.py', exports: [fn('helper')] }),
    ]);
    const e1 = resolveCalls([{ callerFile: 'a.py', calleeName: 'helper', calleeKind: 'cross-module', line: 3 }], named);
    expect(e1[0]!.target).toBe('b.py::helper');
    expect(meta(e1)['resolution']).toEqual({ stage: 'cross-module', strategy: 'import-table', basis: 'index' });

    const star = skeletons([
      mkSkeleton({ filePath: 'a.py', imports: [{ moduleSpecifier: 'b', isRelative: false, resolvedPath: 'b.py', namedImports: ['*', 'helper'], isTypeOnly: false }] }),
      mkSkeleton({ filePath: 'b.py', exports: [fn('helper')] }),
    ]);
    const e2 = resolveCalls([{ callerFile: 'a.py', calleeName: 'helper', calleeKind: 'cross-module', line: 4 }], star);
    expect(e2[0]!.confidence).toBe('low');
    expect(meta(e2)['resolution']).toEqual({ stage: 'cross-module', strategy: 'star-import', basis: 'heuristic' });
  });

  it('Stage 4 兜底占位：fallback / unresolved-placeholder / heuristic', () => {
    const sk = skeletons([mkSkeleton({ filePath: 'a.py', exports: [fn('foo')] })]);
    const edges = resolveCalls([{ callerFile: 'a.py', calleeName: 'mystery', calleeKind: 'unresolved', line: 50, column: 0 }], sk);
    expect(edges[0]!.target).toBe('?::mystery');
    expect(meta(edges)['resolution']).toEqual({ stage: 'fallback', strategy: 'unresolved-placeholder', basis: 'heuristic' });
    expect(meta(edges)['callSite']).toEqual({ line: 50, column: 0 });
  });

  it('F260 接收者类型解析：receiver-type / receiver-type-index / index', () => {
    const sk = skeletons([
      mkSkeleton({
        filePath: 'src/a.ts', language: 'typescript',
        imports: [{ moduleSpecifier: './b.js', isRelative: true, resolvedPath: 'src/b.ts', namedImports: ['Widget'], isTypeOnly: false }],
        exports: [fn('use')],
      }),
      mkSkeleton({ filePath: 'src/b.ts', language: 'typescript', exports: [cls('Widget', ['render'])] }),
    ]);
    const cs: CallSiteWithFile = {
      callerFile: 'src/a.ts', calleeName: 'render', calleeKind: 'member', line: 7, column: 2,
      calleeQualifier: 'w', receiverType: 'Widget', receiverTypeSoleImportBinding: true, callerContext: 'use',
    };
    const edges = resolveCalls([cs], sk);
    expect(edges[0]!.target).toBe('src/b.ts::Widget.render');
    expect(meta(edges)['resolution']).toEqual({ stage: 'receiver-type', strategy: 'receiver-type-index', basis: 'index' });
    expect(meta(edges)['callSite']).toEqual({ line: 7, column: 2 });
  });
});
