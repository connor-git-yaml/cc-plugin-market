/**
 * duplicate-id-check 单测（F217 T005）
 * 覆盖 FR-001/002：归一化三元组 (文件路径, symbol 名, kind) 映射多 ID 的 pass/fail 场景，
 * 遗留 `#` 与 `::` 分隔符共存场景。
 */
import { describe, it, expect } from 'vitest';
import { checkDuplicateCanonicalIds } from './duplicate-id-check.js';
import type { GraphJSON, GraphNode } from '../graph-types.js';

function node(id: string, kind: GraphNode['kind'] = 'component'): GraphNode {
  return { id, kind, label: id, metadata: {} };
}

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

describe('checkDuplicateCanonicalIds', () => {
  it('pass：图中无重复三元组', () => {
    const graph = makeGraph([
      node('src/a.ts::foo'),
      node('src/a.ts::bar'),
      node('src/b.ts::foo'),
    ]);
    const result = checkDuplicateCanonicalIds(graph);
    expect(result.status).toBe('pass');
    expect(result.groups).toEqual([]);
  });

  it('fail：同一 (文件路径, symbol 名, kind) 三元组对应两个不同 canonical ID（`::` vs `#`）', () => {
    // 理论上不应在生产链路自然发生，但检测器需具备灵敏度（SC-003 对抗测试前置）
    const dupGraph = makeGraph([
      { id: 'src/a.ts::foo', kind: 'component', label: 'foo', metadata: {} },
      { id: 'src/a.ts#foo', kind: 'component', label: 'foo', metadata: {} },
    ]);
    const result = checkDuplicateCanonicalIds(dupGraph);
    expect(result.status).toBe('fail');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toEqual({
      filePath: 'src/a.ts',
      symbolName: 'foo',
      kind: 'component',
      ids: ['src/a.ts#foo', 'src/a.ts::foo'],
    });
  });

  it('遗留 `#` 与当前 `::` 分隔符共存场景：同一 symbol 的新旧两种 ID 判定为重复', () => {
    const graph = makeGraph([
      node('src/legacy.py#Value', 'component'),
      node('src/legacy.py::Value', 'component'),
      node('src/legacy.py::Other', 'component'),
    ]);
    const result = checkDuplicateCanonicalIds(graph);
    expect(result.status).toBe('fail');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].filePath).toBe('src/legacy.py');
    expect(result.groups[0].symbolName).toBe('Value');
    expect(result.groups[0].ids.sort()).toEqual(['src/legacy.py#Value', 'src/legacy.py::Value']);
  });

  it('module 节点（无 symbol 名，纯文件路径 id）不参与三元组归一化，不误报', () => {
    const graph = makeGraph([
      node('src/a.ts', 'module'),
      node('src/b.ts', 'module'),
    ]);
    const result = checkDuplicateCanonicalIds(graph);
    expect(result.status).toBe('pass');
  });

  it('kind 不同时不构成重复（三元组含 kind 维度）', () => {
    const graph = makeGraph([
      { id: 'src/a.ts::foo', kind: 'component', label: 'foo', metadata: {} },
      { id: 'src/a.ts#foo', kind: 'module', label: 'foo', metadata: {} },
    ]);
    const result = checkDuplicateCanonicalIds(graph);
    expect(result.status).toBe('pass');
  });

  it('FIX-6 红测试：filePart 反斜杠与正斜杠归一后视为同一文件（`src\\a.ts#Foo` 与 `src/a.ts::Foo` 同组）', () => {
    const graph = makeGraph([
      { id: 'src\\a.ts#Foo', kind: 'component', label: 'Foo', metadata: {} },
      { id: 'src/a.ts::Foo', kind: 'component', label: 'Foo', metadata: {} },
    ]);
    const result = checkDuplicateCanonicalIds(graph);
    expect(result.status).toBe('fail');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].filePath).toBe('src/a.ts');
    expect(result.groups[0].ids.sort()).toEqual(['src/a.ts::Foo', 'src\\a.ts#Foo']);
  });
});
