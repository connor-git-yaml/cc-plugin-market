/**
 * legacy-ignored-check 单测（F217 T013）
 * 覆盖 FR-007/008：复用 isLegacySymbolNode（graph-query.ts:178）判定遗留 `#` 节点；
 * 注入的 isIgnored 回调判定 ignored 路径节点。
 */
import { describe, it, expect } from 'vitest';
import { checkLegacyAndIgnoredNodes } from './legacy-ignored-check.js';
import type { GraphJSON, GraphNode } from '../graph-types.js';

function makeGraph(nodes: GraphNode[]): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: nodes.length,
      edgeCount: 0,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
    },
    nodes,
    links: [],
  };
}

const noIgnore = (): boolean => false;

describe('checkLegacyAndIgnoredNodes', () => {
  it('pass：无遗留 # 节点、无 ignored 路径节点', () => {
    const graph = makeGraph([
      { id: 'src/a.ts::foo', kind: 'component', label: 'foo', metadata: { unifiedKind: 'symbol' } },
    ]);
    const result = checkLegacyAndIgnoredNodes(graph, noIgnore);
    expect(result.status).toBe('pass');
    expect(result.legacyHashNodeIds).toEqual([]);
    expect(result.ignoredPathNodeIds).toEqual([]);
  });

  it('fail：检出遗留 `#` symbol 节点（unifiedKind=symbol + # 分隔符）', () => {
    const graph = makeGraph([
      { id: 'src/a.py#foo', kind: 'component', label: 'foo', metadata: { unifiedKind: 'symbol' } },
      { id: 'src/a.py::bar', kind: 'component', label: 'bar', metadata: { unifiedKind: 'symbol' } },
    ]);
    const result = checkLegacyAndIgnoredNodes(graph, noIgnore);
    expect(result.status).toBe('fail');
    expect(result.legacyHashNodeIds).toEqual(['src/a.py#foo']);
    expect(result.ignoredPathNodeIds).toEqual([]);
  });

  it('doc-anchor 节点（kind=module 且 id 含 # 但非 symbol provenance）不误判为遗留节点', () => {
    const graph = makeGraph([
      { id: 'src/pipeline.ts#withRetry', kind: 'module', label: 'withRetry', metadata: {} },
    ]);
    const result = checkLegacyAndIgnoredNodes(graph, noIgnore);
    expect(result.status).toBe('pass');
    expect(result.legacyHashNodeIds).toEqual([]);
  });

  it('fail：注入的 isIgnored 回调命中路径节点', () => {
    const graph = makeGraph([
      { id: 'dist/generated.ts::foo', kind: 'component', label: 'foo', metadata: {} },
      { id: 'src/a.ts::bar', kind: 'component', label: 'bar', metadata: {} },
    ]);
    const isIgnored = (relativePath: string): boolean => relativePath.startsWith('dist/');
    const result = checkLegacyAndIgnoredNodes(graph, isIgnored);
    expect(result.status).toBe('fail');
    expect(result.ignoredPathNodeIds).toEqual(['dist/generated.ts::foo']);
    expect(result.legacyHashNodeIds).toEqual([]);
  });

  it('两类问题同时命中时均被列出', () => {
    const graph = makeGraph([
      { id: 'src/a.py#foo', kind: 'component', label: 'foo', metadata: { unifiedKind: 'symbol' } },
      { id: 'dist/b.ts::bar', kind: 'component', label: 'bar', metadata: {} },
    ]);
    const isIgnored = (relativePath: string): boolean => relativePath.startsWith('dist/');
    const result = checkLegacyAndIgnoredNodes(graph, isIgnored);
    expect(result.status).toBe('fail');
    expect(result.legacyHashNodeIds).toEqual(['src/a.py#foo']);
    expect(result.ignoredPathNodeIds).toEqual(['dist/b.ts::bar']);
  });
});
