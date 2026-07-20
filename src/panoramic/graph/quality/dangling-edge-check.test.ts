/**
 * dangling-edge-check 单测（F217 T009）
 * 覆盖 FR-006：edge source/target 不存在 node id 的检出与三元组（source/target/relation）精确报告。
 */
import { describe, it, expect } from 'vitest';
import { checkDanglingEdges } from './dangling-edge-check.js';
import type { GraphEdge, GraphJSON, GraphNode } from '../graph-types.js';

function node(id: string): GraphNode {
  return { id, kind: 'component', label: id, metadata: {} };
}

function makeGraph(nodes: GraphNode[], links: GraphEdge[]): GraphJSON {
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

describe('checkDanglingEdges', () => {
  it('pass：全部边的 source/target 均存在于节点集合', () => {
    const graph = makeGraph(
      [node('a'), node('b')],
      [{ source: 'a', target: 'b', relation: 'calls', confidence: 'EXTRACTED', confidenceScore: 1 }],
    );
    const result = checkDanglingEdges(graph);
    expect(result.status).toBe('pass');
    expect(result.edges).toEqual([]);
  });

  it('fail：target 指向不存在节点，精确报告 source/target/relation', () => {
    const graph = makeGraph(
      [node('a')],
      [{ source: 'a', target: 'ghost', relation: 'calls', confidence: 'EXTRACTED', confidenceScore: 1 }],
    );
    const result = checkDanglingEdges(graph);
    expect(result.status).toBe('fail');
    expect(result.edges).toEqual([{ source: 'a', target: 'ghost', relation: 'calls' }]);
  });

  it('fail：source 指向不存在节点', () => {
    const graph = makeGraph(
      [node('b')],
      [{ source: 'ghost', target: 'b', relation: 'depends-on', confidence: 'EXTRACTED', confidenceScore: 1 }],
    );
    const result = checkDanglingEdges(graph);
    expect(result.status).toBe('fail');
    expect(result.edges).toEqual([{ source: 'ghost', target: 'b', relation: 'depends-on' }]);
  });

  it('多条悬空边均被检出（不短路）', () => {
    const graph = makeGraph(
      [node('a')],
      [
        { source: 'a', target: 'ghost1', relation: 'calls', confidence: 'EXTRACTED', confidenceScore: 1 },
        { source: 'ghost2', target: 'a', relation: 'contains', confidence: 'EXTRACTED', confidenceScore: 1 },
      ],
    );
    const result = checkDanglingEdges(graph);
    expect(result.status).toBe('fail');
    expect(result.edges).toHaveLength(2);
  });
});
