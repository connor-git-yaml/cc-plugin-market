/**
 * Feature 214 T027（=plan T6）— 增量护栏对 contains 边/canonical ID 的处理（NFR-003, R-4）。
 *
 * 基于纯函数 mergeIncremental 覆盖：文件新增/删除/rename、member 删改、跨文件 calls caller 重建。
 * 断言增量 diff 正确替换旧 contains、加入新 contains，重建图无 stale/dangling endpoint，
 * 新 member 节点带 filePath 被 owning-node 识别。characterization/看护（预期绿，红即暴露缺陷）。
 */
import { describe, it, expect } from 'vitest';
import { buildUnifiedGraph } from '../../../src/knowledge-graph/index.js';
import { buildSnapshotWrapper } from '../../../src/knowledge-graph/persistence.js';
import { mergeIncremental } from '../../../src/knowledge-graph/incremental.js';
import type { CodeSkeleton, ExportSymbol, MemberInfo } from '../../../src/models/code-skeleton.js';
import type { SnapshotWrapper } from '../../../src/knowledge-graph/persistence.js';
import type { UnifiedGraph } from '../../../src/knowledge-graph/unified-graph.js';

function member(name: string, kind: MemberInfo['kind']): MemberInfo {
  return { name, kind, signature: `${name}()`, isStatic: false };
}
function exp(name: string, kind: ExportSymbol['kind'], members?: MemberInfo[]): ExportSymbol {
  return { name, kind, signature: `${kind} ${name}`, isDefault: false, startLine: 1, endLine: 10, ...(members ? { members } : {}) };
}
function sk(filePath: string, exports: ExportSymbol[], imports: CodeSkeleton['imports'] = []): CodeSkeleton {
  return {
    filePath, language: 'python', loc: 100, exports, imports,
    hash: 'a'.repeat(64), analyzedAt: '2026-07-20T10:00:00.000Z', parserUsed: 'tree-sitter',
  };
}

/** 用相对 filePath + projectRoot='.' 建图（id 保持相对，changedSet 直接匹配 node.filePath） */
function graphOf(skeletons: Map<string, CodeSkeleton>): UnifiedGraph {
  return buildUnifiedGraph({ projectRoot: '.', codeSkeletons: skeletons });
}
function snapshotOf(skeletons: Map<string, CodeSkeleton>): SnapshotWrapper {
  const hashes: Record<string, string> = {};
  for (const fp of skeletons.keys()) hashes[fp] = 'a'.repeat(64);
  return buildSnapshotWrapper(graphOf(skeletons), hashes);
}

/** 不变量：无悬空/stale endpoint —— 每条边的 source/target 都在节点集合中 */
function assertNoDanglingEndpoint(graph: UnifiedGraph): void {
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const e of graph.edges) {
    expect(ids.has(e.source), `dangling source: ${e.source} (${e.relation})`).toBe(true);
    expect(ids.has(e.target), `dangling target: ${e.target} (${e.relation})`).toBe(true);
  }
}

function containsPairs(graph: UnifiedGraph): Set<string> {
  return new Set(graph.edges.filter((e) => e.relation === 'contains').map((e) => `${e.source}=>${e.target}`));
}

describe('Feature 214 T027 — 增量 contains 边正确替换（NFR-003, R-4）', () => {
  it('member 删改：a.py 的 class 去掉一个 member → 旧 contains 删、新状态生效、无 dangling', () => {
    const oldSnap = snapshotOf(new Map([
      ['a.py', sk('a.py', [exp('Foo', 'class', [member('m1', 'method'), member('m2', 'method')])])],
      ['b.py', sk('b.py', [exp('bar', 'function')])],
    ]));
    // a.py 改：移除 m2
    const newPartial = graphOf(new Map([
      ['a.py', sk('a.py', [exp('Foo', 'class', [member('m1', 'method')])])],
    ]));
    const merged = mergeIncremental({
      oldSnapshot: oldSnap, changedSet: new Set(['a.py']),
      newPartialGraph: newPartial, newFileHashes: { 'a.py': 'b'.repeat(64) },
    });
    const pairs = containsPairs(merged.graph);
    expect(pairs.has('a.py::Foo=>a.py::Foo.m1')).toBe(true);
    expect(pairs.has('a.py::Foo=>a.py::Foo.m2')).toBe(false); // 旧 contains 已删
    expect(pairs.has('b.py=>b.py::bar')).toBe(true); // 未改文件的 contains 保留
    assertNoDanglingEndpoint(merged.graph);
    // 旧 member 节点已移除
    expect(merged.graph.nodes.some((n) => n.id === 'a.py::Foo.m2')).toBe(false);
  });

  it('文件新增：新 c.py 加入 → 新 module→symbol contains 出现，owning-node 带 filePath', () => {
    const oldSnap = snapshotOf(new Map([['a.py', sk('a.py', [exp('bar', 'function')])]]));
    const newPartial = graphOf(new Map([['c.py', sk('c.py', [exp('Baz', 'class', [member('go', 'method')])])]]));
    const merged = mergeIncremental({
      oldSnapshot: oldSnap, changedSet: new Set(['c.py']),
      newPartialGraph: newPartial, newFileHashes: { 'c.py': 'c'.repeat(64) },
    });
    const pairs = containsPairs(merged.graph);
    expect(pairs.has('c.py=>c.py::Baz')).toBe(true);
    expect(pairs.has('c.py::Baz=>c.py::Baz.go')).toBe(true);
    // 新 member 节点带 filePath（供 owning-node 反查）
    const memberNode = merged.graph.nodes.find((n) => n.id === 'c.py::Baz.go');
    expect(memberNode?.filePath).toBe('c.py');
    assertNoDanglingEndpoint(merged.graph);
  });

  it('文件删除：a.py 被删（不在 newFileHashes）→ 其 owning 节点与 contains 全部移除，无 dangling', () => {
    const oldSnap = snapshotOf(new Map([
      ['a.py', sk('a.py', [exp('Foo', 'class', [member('m1', 'method')])])],
      ['b.py', sk('b.py', [exp('bar', 'function')])],
    ]));
    const emptyPartial: UnifiedGraph = { nodes: [], edges: [], metadata: oldSnap.graph.metadata };
    const merged = mergeIncremental({
      oldSnapshot: oldSnap, changedSet: new Set(['a.py']),
      newPartialGraph: emptyPartial, newFileHashes: {}, // a.py 删除
    });
    expect(merged.graph.nodes.some((n) => n.id.startsWith('a.py'))).toBe(false);
    expect([...containsPairs(merged.graph)].some((p) => p.includes('a.py'))).toBe(false);
    expect(merged.fileHashes['a.py']).toBeUndefined();
    expect(merged.graph.nodes.some((n) => n.id === 'b.py::bar')).toBe(true);
    assertNoDanglingEndpoint(merged.graph);
  });

  it('文件 rename：a.py → renamed.py（删 a + 增 renamed）→ 旧 contains 消、新 contains 现', () => {
    const oldSnap = snapshotOf(new Map([['a.py', sk('a.py', [exp('Foo', 'class', [member('m1', 'method')])])]]));
    const newPartial = graphOf(new Map([['renamed.py', sk('renamed.py', [exp('Foo', 'class', [member('m1', 'method')])])]]));
    const merged = mergeIncremental({
      oldSnapshot: oldSnap, changedSet: new Set(['a.py', 'renamed.py']),
      newPartialGraph: newPartial, newFileHashes: { 'renamed.py': 'd'.repeat(64) },
    });
    const pairs = containsPairs(merged.graph);
    expect([...pairs].some((p) => p.includes('a.py'))).toBe(false);
    expect(pairs.has('renamed.py=>renamed.py::Foo')).toBe(true);
    expect(pairs.has('renamed.py::Foo=>renamed.py::Foo.m1')).toBe(true);
    assertNoDanglingEndpoint(merged.graph);
  });

  it('跨文件 calls caller 重建：caller a.py 重建后 calls 边替换，无 stale endpoint', () => {
    const oldSnap = snapshotOf(new Map([
      ['a.py', sk('a.py', [exp('caller', 'function')], [{ moduleSpecifier: 'b', isRelative: true, resolvedPath: 'b.py', namedImports: ['helper'], isTypeOnly: false }])],
      ['b.py', sk('b.py', [exp('helper', 'function')])],
    ]));
    // a.py 重建（caller 仍存在），b.py 未变
    const newPartial = graphOf(new Map([
      ['a.py', sk('a.py', [exp('caller', 'function')], [{ moduleSpecifier: 'b', isRelative: true, resolvedPath: 'b.py', namedImports: ['helper'], isTypeOnly: false }])],
    ]));
    const merged = mergeIncremental({
      oldSnapshot: oldSnap, changedSet: new Set(['a.py']),
      newPartialGraph: newPartial, newFileHashes: { 'a.py': 'e'.repeat(64) },
    });
    // b.py 及其 contains 保留（未在 changedSet）
    expect(merged.graph.nodes.some((n) => n.id === 'b.py::helper')).toBe(true);
    expect(containsPairs(merged.graph).has('a.py=>a.py::caller')).toBe(true);
    assertNoDanglingEndpoint(merged.graph);
  });
});
