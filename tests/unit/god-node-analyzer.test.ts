/**
 * god-node-analyzer 单元测试
 * 覆盖 God Node 阈值、过滤逻辑、排序
 */
import { describe, it, expect } from 'vitest';
import { loadGraph } from '../../src/panoramic/community/community-detector.js';
import { findGodNodes } from '../../src/panoramic/community/god-node-analyzer.js';
import type { GraphJSON, GraphNode, GraphEdge } from '../../src/panoramic/graph/graph-types.js';

function makeNode(id: string, kind: GraphNode['kind'] = 'module'): GraphNode {
  return { id, kind, label: id, metadata: {} };
}

function makeEdge(source: string, target: string, relation = 'depends-on'): GraphEdge {
  return { source, target, relation, confidence: 'EXTRACTED', confidenceScore: 0.95 };
}

function makeGraphJSON(nodes: GraphNode[], links: GraphEdge[]): GraphJSON {
  return {
    directed: false, multigraph: false,
    graph: { name: 'spectra-knowledge-graph', generatedAt: '', nodeCount: nodes.length, edgeCount: links.length, sources: ['architecture-ir'], schemaVersion: '1.0' },
    nodes, links,
  };
}

describe('findGodNodes', () => {
  it('识别度数异常高的节点', () => {
    // hub 连接所有其他节点，其他节点之间无连接
    const nodes = ['hub', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => makeNode(id));
    const links = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => makeEdge('hub', id));
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);

    const communityMap = new Map<string, number>();
    for (const n of graph.nodes()) communityMap.set(n, 0);

    const godNodes = findGodNodes(graph, communityMap);
    expect(godNodes.length).toBeGreaterThanOrEqual(1);
    expect(godNodes[0]!.id).toBe('hub');
    expect(godNodes[0]!.degree).toBe(8);
  });

  it('过滤 kind=package 节点', () => {
    const nodes = [
      { id: 'pkg', kind: 'package' as const, label: 'pkg', metadata: {} },
      ...['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeNode(id)),
    ];
    const links = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeEdge('pkg', id));
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);

    const communityMap = new Map<string, number>();
    for (const n of graph.nodes()) communityMap.set(n, 0);

    const godNodes = findGodNodes(graph, communityMap);
    // pkg 应该被过滤掉
    expect(godNodes.find(n => n.id === 'pkg')).toBeUndefined();
  });

  it('过滤仅有 contains 关系的节点', () => {
    const nodes = ['container', 'a', 'b', 'c', 'd', 'e', 'f'].map(id => makeNode(id));
    const links = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeEdge('container', id, 'contains'));
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);

    const communityMap = new Map<string, number>();
    for (const n of graph.nodes()) communityMap.set(n, 0);

    const godNodes = findGodNodes(graph, communityMap);
    expect(godNodes.find(n => n.id === 'container')).toBeUndefined();
  });

  it('空图返回空列表', () => {
    const graphJson = makeGraphJSON([], []);
    const graph = loadGraph(graphJson);
    const godNodes = findGodNodes(graph, new Map());
    expect(godNodes).toEqual([]);
  });

  it('无高度节点返回空列表', () => {
    // 所有节点度数相近
    const nodes = ['a', 'b', 'c'].map(id => makeNode(id));
    const links = [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('a', 'c')];
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);

    const communityMap = new Map<string, number>();
    for (const n of graph.nodes()) communityMap.set(n, 0);

    const godNodes = findGodNodes(graph, communityMap);
    expect(godNodes.length).toBe(0);
  });

  it('按度数降序排列', () => {
    const nodes = ['hub1', 'hub2', ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(id => makeNode(id))].map(
      id => typeof id === 'string' ? makeNode(id) : id,
    );
    const links = [
      // hub1 连接 8 个节点
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => makeEdge('hub1', id)),
      // hub2 连接 6 个节点
      ...['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeEdge('hub2', id)),
    ];
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);

    const communityMap = new Map<string, number>();
    for (const n of graph.nodes()) communityMap.set(n, 0);

    const godNodes = findGodNodes(graph, communityMap);
    if (godNodes.length >= 2) {
      expect(godNodes[0]!.degree).toBeGreaterThanOrEqual(godNodes[1]!.degree);
    }
  });
});
