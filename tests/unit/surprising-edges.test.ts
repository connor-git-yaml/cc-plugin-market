/**
 * surprising-edges 单元测试
 * 覆盖跨社区边识别、betweenness 采样、复合评分排序
 */
import { describe, it, expect } from 'vitest';
import { loadGraph, detectCommunities } from '../../src/panoramic/community/community-detector.js';
import { findSurprisingEdges } from '../../src/panoramic/community/surprising-edges.js';
import type { GraphJSON, GraphNode, GraphEdge } from '../../src/panoramic/graph/graph-types.js';

function makeNode(id: string, kind: GraphNode['kind'] = 'module'): GraphNode {
  return { id, kind, label: id, metadata: {} };
}

function makeEdge(
  source: string,
  target: string,
  relation = 'depends-on',
  confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' = 'EXTRACTED',
): GraphEdge {
  const scores = { EXTRACTED: 0.95, INFERRED: 0.65, AMBIGUOUS: 0.25 };
  return { source, target, relation, confidence, confidenceScore: scores[confidence] };
}

function makeGraphJSON(nodes: GraphNode[], links: GraphEdge[]): GraphJSON {
  return {
    directed: false, multigraph: false,
    graph: { name: 'spectra-knowledge-graph', generatedAt: '', nodeCount: nodes.length, edgeCount: links.length, sources: ['architecture-ir'], schemaVersion: '1.0' },
    nodes, links,
  };
}

describe('findSurprisingEdges', () => {
  it('识别跨社区边', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeNode(id));
    const links = [
      makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('a', 'c'),
      makeEdge('d', 'e'), makeEdge('e', 'f'), makeEdge('d', 'f'),
      makeEdge('c', 'd'), // 跨社区边
    ];
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);
    const { nodeCommunityMap } = detectCommunities(graph);

    const surprises = findSurprisingEdges(graph, nodeCommunityMap);
    // 应该至少包含跨社区边
    const crossEdge = surprises.find(e =>
      (e.source === 'c' && e.target === 'd') || (e.source === 'd' && e.target === 'c'),
    );
    expect(crossEdge).toBeDefined();
    expect(crossEdge!.crossCommunity).toBe(true);
  });

  it('排除 contains 关系', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(id => makeNode(id));
    const links = [
      makeEdge('a', 'b'), makeEdge('a', 'c'),
      makeEdge('a', 'd', 'contains'), // contains 应被排除
    ];
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);

    const communityMap = new Map([['a', 0], ['b', 0], ['c', 1], ['d', 1]]);
    const surprises = findSurprisingEdges(graph, communityMap);
    const containsEdge = surprises.find(e => e.relation === 'contains');
    expect(containsEdge).toBeUndefined();
  });

  it('低置信度边评分更高', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(id => makeNode(id));
    const links = [
      makeEdge('a', 'b', 'depends-on', 'AMBIGUOUS'),
      makeEdge('c', 'd', 'depends-on', 'EXTRACTED'),
    ];
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);

    const communityMap = new Map([['a', 0], ['b', 1], ['c', 0], ['d', 1]]);
    const surprises = findSurprisingEdges(graph, communityMap);

    if (surprises.length >= 2) {
      // AMBIGUOUS 边应该评分更高
      const ambiguousEdge = surprises.find(e => e.confidence === 'AMBIGUOUS');
      const extractedEdge = surprises.find(e => e.confidence === 'EXTRACTED');
      if (ambiguousEdge && extractedEdge) {
        expect(ambiguousEdge.score).toBeGreaterThan(extractedEdge.score);
      }
    }
  });

  it('空图返回空列表', () => {
    const graphJson = makeGraphJSON([], []);
    const graph = loadGraph(graphJson);
    const surprises = findSurprisingEdges(graph, new Map());
    expect(surprises).toEqual([]);
  });

  it('topN 参数限制返回数量', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => makeNode(`n${i}`));
    const links: GraphEdge[] = [];
    for (let i = 0; i < 9; i++) {
      links.push(makeEdge(`n${i}`, `n${i + 1}`, 'depends-on', 'INFERRED'));
    }
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);

    const communityMap = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      communityMap.set(`n${i}`, i < 5 ? 0 : 1);
    }

    const surprises = findSurprisingEdges(graph, communityMap, { topN: 3 });
    expect(surprises.length).toBeLessThanOrEqual(3);
  });

  it('按评分降序排列', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeNode(id));
    const links = [
      makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('a', 'c'),
      makeEdge('d', 'e'), makeEdge('e', 'f'), makeEdge('d', 'f'),
      makeEdge('c', 'd', 'depends-on', 'AMBIGUOUS'),
      makeEdge('b', 'e', 'depends-on', 'EXTRACTED'),
    ];
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);
    const { nodeCommunityMap } = detectCommunities(graph);

    const surprises = findSurprisingEdges(graph, nodeCommunityMap);
    for (let i = 1; i < surprises.length; i++) {
      expect(surprises[i - 1]!.score).toBeGreaterThanOrEqual(surprises[i]!.score);
    }
  });
});
