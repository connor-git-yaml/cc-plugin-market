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
    // hub1 与 hub2 分别连接互不重叠的目标节点集合（原 fixture 中 hub1/hub2 共享 a-f
    // 目标节点，实际 findGodNodes 阈值计算下 hub2 的度数不足以入选，导致
    // `if (godNodes.length >= 2)` 恒假、断言从不执行——见 F272 ⑦-B2）。
    // 改为互不重叠目标后，hub1 (degree=8) 与 hub2 (degree=6) 均超过 2σ 阈值，
    // 稳定产出 2 个 god node，可真实验证降序排序行为。
    const hub1Targets = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
    const hub2Targets = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
    const nodes = ['hub1', 'hub2', ...hub1Targets, ...hub2Targets].map(id => makeNode(id));
    const links = [
      ...hub1Targets.map(id => makeEdge('hub1', id)),
      ...hub2Targets.map(id => makeEdge('hub2', id)),
    ];
    const graphJson = makeGraphJSON(nodes, links);
    const graph = loadGraph(graphJson);

    const communityMap = new Map<string, number>();
    for (const n of graph.nodes()) communityMap.set(n, 0);

    const godNodes = findGodNodes(graph, communityMap);
    expect(godNodes.length).toBe(2);
    expect(godNodes[0]!.id).toBe('hub1');
    expect(godNodes[0]!.degree).toBe(8);
    expect(godNodes[1]!.id).toBe('hub2');
    expect(godNodes[1]!.degree).toBe(6);
    expect(godNodes[0]!.degree).toBeGreaterThanOrEqual(godNodes[1]!.degree);
  });
});
