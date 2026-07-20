/**
 * contains-coverage-check 单测（F217 T007）
 * 覆盖 FR-003/004：unifiedKind==='symbol' 分母、100% 覆盖 pass、未覆盖清单、
 * 分母为 0 时 not-applicable。
 */
import { describe, it, expect } from 'vitest';
import { checkContainsCoverage } from './contains-coverage-check.js';
import type { GraphEdge, GraphJSON, GraphNode } from '../graph-types.js';

function symbolNode(id: string): GraphNode {
  return { id, kind: 'component', label: id, metadata: { unifiedKind: 'symbol' } };
}
function moduleNode(id: string): GraphNode {
  return { id, kind: 'module', label: id, metadata: { unifiedKind: 'module' } };
}
function containsEdge(source: string, target: string): GraphEdge {
  return { source, target, relation: 'contains', confidence: 'EXTRACTED', confidenceScore: 1 };
}

function makeGraph(nodes: GraphNode[], links: GraphEdge[] = []): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: nodes.length,
      edgeCount: links.length,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
    },
    nodes,
    links,
  };
}

describe('checkContainsCoverage', () => {
  it('分母为 0（无 symbol 节点）时判定为 not-applicable', () => {
    const graph = makeGraph([moduleNode('src/a.ts')]);
    const result = checkContainsCoverage(graph);
    expect(result.status).toBe('not-applicable');
    expect(result.total).toBe(0);
    expect(result.covered).toBe(0);
    expect(result.ratio).toBeNull();
    expect(result.uncoveredIds).toEqual([]);
  });

  it('100% 覆盖时判定为 pass', () => {
    const graph = makeGraph(
      [moduleNode('src/a.ts'), symbolNode('src/a.ts::foo'), symbolNode('src/a.ts::bar')],
      [containsEdge('src/a.ts', 'src/a.ts::foo'), containsEdge('src/a.ts', 'src/a.ts::bar')],
    );
    const result = checkContainsCoverage(graph);
    expect(result.status).toBe('pass');
    expect(result.total).toBe(2);
    expect(result.covered).toBe(2);
    expect(result.ratio).toBe(1);
    expect(result.uncoveredIds).toEqual([]);
  });

  it('部分覆盖时判定为 fail，并精确列出未覆盖节点 id', () => {
    const graph = makeGraph(
      [
        moduleNode('src/a.ts'),
        symbolNode('src/a.ts::foo'),
        symbolNode('src/a.ts::bar'),
        symbolNode('src/a.ts::baz'),
      ],
      [containsEdge('src/a.ts', 'src/a.ts::foo')],
    );
    const result = checkContainsCoverage(graph);
    expect(result.status).toBe('fail');
    expect(result.total).toBe(3);
    expect(result.covered).toBe(1);
    expect(result.ratio).toBeCloseTo(1 / 3);
    expect(result.uncoveredIds).toEqual(['src/a.ts::bar', 'src/a.ts::baz']);
  });

  it('非 contains 关系的边不计入覆盖判定', () => {
    const graph = makeGraph(
      [symbolNode('src/a.ts::foo'), symbolNode('src/a.ts::bar')],
      [{ source: 'src/a.ts::foo', target: 'src/a.ts::bar', relation: 'calls', confidence: 'EXTRACTED', confidenceScore: 1 }],
    );
    const result = checkContainsCoverage(graph);
    expect(result.status).toBe('fail');
    expect(result.covered).toBe(0);
    expect(result.uncoveredIds).toEqual(['src/a.ts::bar', 'src/a.ts::foo']);
  });
});
