/**
 * community-detector 单元测试
 * 覆盖图加载、Louvain 社区检测、oversized 分裂、cohesion 评分
 */
import { describe, it, expect } from 'vitest';
import { loadGraph, detectCommunities } from '../../src/panoramic/community/community-detector.js';
import type { GraphJSON, GraphNode, GraphEdge } from '../../src/panoramic/graph/graph-types.js';

// ============================================================
// Mock 数据辅助函数
// ============================================================

function makeNode(id: string, kind: GraphNode['kind'] = 'module'): GraphNode {
  return { id, kind, label: id, metadata: {} };
}

function makeEdge(source: string, target: string, relation = 'depends-on'): GraphEdge {
  return { source, target, relation, confidence: 'EXTRACTED', confidenceScore: 0.95 };
}

function makeGraphJSON(nodes: GraphNode[], links: GraphEdge[]): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: links.length,
      sources: ['architecture-ir'],
      schemaVersion: '1.0',
    },
    nodes,
    links,
  };
}

// ============================================================
// 测试用例
// ============================================================

describe('loadGraph', () => {
  it('正确加载节点和边', () => {
    const graphJson = makeGraphJSON(
      [makeNode('a'), makeNode('b'), makeNode('c')],
      [makeEdge('a', 'b'), makeEdge('b', 'c')],
    );
    const graph = loadGraph(graphJson);
    expect(graph.order).toBe(3);
    expect(graph.size).toBe(2);
  });

  it('处理空图', () => {
    const graphJson = makeGraphJSON([], []);
    const graph = loadGraph(graphJson);
    expect(graph.order).toBe(0);
    expect(graph.size).toBe(0);
  });

  it('静默跳过悬空边', () => {
    const graphJson = makeGraphJSON(
      [makeNode('a')],
      [makeEdge('a', 'nonexistent')],
    );
    const graph = loadGraph(graphJson);
    expect(graph.order).toBe(1);
    // 悬空边应该被跳过
    expect(graph.size).toBe(0);
  });
});

describe('detectCommunities', () => {
  it('检测出多个社区', () => {
    // 构建两个明显的社区：{a,b,c} 和 {d,e,f}，仅一条跨社区边
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeNode(id));
    const links = [
      // 社区 1 内部紧密连接
      makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('a', 'c'),
      // 社区 2 内部紧密连接
      makeEdge('d', 'e'), makeEdge('e', 'f'), makeEdge('d', 'f'),
      // 跨社区弱连接
      makeEdge('c', 'd'),
    ];
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);
    const result = detectCommunities(graph);

    expect(result.communities.length).toBeGreaterThanOrEqual(2);
    expect(result.nodeCommunityMap.size).toBe(6);
  });

  it('处理单节点图', () => {
    const graphJson = makeGraphJSON([makeNode('a')], []);
    const graph = loadGraph(graphJson);
    const result = detectCommunities(graph);

    expect(result.communities.length).toBe(1);
    expect(result.communities[0]!.nodes).toEqual(['a']);
    expect(result.communities[0]!.cohesion).toBe(1);
  });

  it('处理空图', () => {
    const graphJson = makeGraphJSON([], []);
    const graph = loadGraph(graphJson);
    const result = detectCommunities(graph);

    expect(result.communities.length).toBe(0);
  });

  it('minSize 过滤小社区', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeNode(id));
    const links = [
      makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('a', 'c'),
      makeEdge('d', 'e'), makeEdge('e', 'f'), makeEdge('d', 'f'),
      makeEdge('c', 'd'),
    ];
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);
    const result = detectCommunities(graph, { minSize: 4 });

    // 两个 3 节点社区应该都被过滤
    expect(result.communities.length).toBe(0);
  });

  it('社区内聚度在 0-1 之间', () => {
    const nodes = ['a', 'b', 'c'].map(id => makeNode(id));
    const links = [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('a', 'c')];
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);
    const result = detectCommunities(graph);

    for (const comm of result.communities) {
      expect(comm.cohesion).toBeGreaterThanOrEqual(0);
      expect(comm.cohesion).toBeLessThanOrEqual(1);
    }
  });

  it('coreNodes 不超过 3 个', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'].map(id => makeNode(id));
    const links = [
      makeEdge('a', 'b'), makeEdge('a', 'c'), makeEdge('a', 'd'), makeEdge('a', 'e'),
      makeEdge('b', 'c'), makeEdge('c', 'd'), makeEdge('d', 'e'),
    ];
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);
    const result = detectCommunities(graph);

    for (const comm of result.communities) {
      expect(comm.coreNodes.length).toBeLessThanOrEqual(3);
    }
  });
});
