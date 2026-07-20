/**
 * Feature 214 T015（=plan T7）— contains 边耦合口径隔离（NFR-008, GATE_DESIGN #4, US1）
 *
 * 双断言【W6】：
 * (a) community `loadGraph` 图不含 contains 边 → degree/community 口径不受 contains 影响（RED，T016 前失败）
 * (b) `GraphQueryEngine`/`graph_node` 邻居仍含 contains（US1 依赖不可破坏，应绿——现状本就含）
 */
import { describe, it, expect } from 'vitest';
import { loadGraph } from '../../../../src/panoramic/community/community-detector.js';
import { GraphQueryEngine } from '../../../../src/panoramic/graph/graph-query.js';
import type { GraphJSON, GraphNode, GraphEdge } from '../../../../src/panoramic/graph/graph-types.js';

function mkGraph(nodes: GraphNode[], links: GraphEdge[]): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '',
      nodeCount: nodes.length,
      edgeCount: links.length,
      sources: [],
      schemaVersion: '2.0',
    },
    nodes,
    links,
  };
}

/** module a、module b、a 内 symbol Foo；a→b depends-on（结构外耦合边）+ a→Foo contains（结构边） */
function fixture(): GraphJSON {
  return mkGraph(
    [
      { id: 'a.ts', kind: 'module', label: 'a', metadata: {} },
      { id: 'b.ts', kind: 'module', label: 'b', metadata: {} },
      { id: 'a.ts::Foo', kind: 'component', label: 'Foo', metadata: { unifiedKind: 'symbol' } },
    ],
    [
      { source: 'a.ts', target: 'b.ts', relation: 'depends-on', confidence: 'EXTRACTED', confidenceScore: 0.95, directional: true },
      { source: 'a.ts', target: 'a.ts::Foo', relation: 'contains', confidence: 'EXTRACTED', confidenceScore: 0.95, directional: true },
    ],
  );
}

describe('NFR-008 (a) — community loadGraph 剔除 contains 边（度数/聚类口径不受影响）', () => {
  it('loadGraph 图不含 contains 边；a.ts 度数仅计 depends-on', () => {
    const g = loadGraph(fixture());
    // contains 边不入无向图
    expect(g.hasEdge('a.ts', 'a.ts::Foo')).toBe(false);
    // 结构外耦合边（depends-on）保留
    expect(g.hasEdge('a.ts', 'b.ts')).toBe(true);
    // a.ts 度数 = 1（仅 depends-on），不因 contains 膨胀为 2
    expect(g.degree('a.ts')).toBe(1);
    // symbol 节点存在但因 contains 被剔而孤立（度数 0）
    expect(g.degree('a.ts::Foo')).toBe(0);
  });
});

describe('NFR-008 (b) — GraphQueryEngine/graph_node 邻居仍含 contains（US1 依赖）', () => {
  it('getNode(a.ts) 邻居含 a.ts::Foo 的 contains 边', () => {
    const engine = GraphQueryEngine.fromJSON(fixture());
    const result = engine.getNode({ id: 'a.ts' });
    const containsNeighbor = result.neighbors.find(
      (n) => n.node.id === 'a.ts::Foo' && n.edge.relation === 'contains',
    );
    expect(containsNeighbor).toBeDefined();
  });
});

describe('NFR-008 (c) — getGodNodes 度数排除 contains（C-1）', () => {
  /** 在 fixture 基础上叠加 N 条从 a.ts 出发的 contains 边（+对应 symbol 节点） */
  function withExtraContains(n: number): GraphJSON {
    const g = fixture();
    for (let i = 0; i < n; i += 1) {
      const symId = `a.ts::Extra${i}`;
      g.nodes.push({ id: symId, kind: 'component', label: `Extra${i}`, metadata: { unifiedKind: 'symbol' } });
      g.links.push({ source: 'a.ts', target: symId, relation: 'contains', confidence: 'EXTRACTED', confidenceScore: 0.95, directional: true });
    }
    g.graph.nodeCount = g.nodes.length;
    g.graph.edgeCount = g.links.length;
    return g;
  }

  it('注入任意数量 contains 边前后，a.ts 的 god-node degree 不变（仅计非 contains 耦合边）', () => {
    const base = GraphQueryEngine.fromJSON(fixture());
    const baseDegree = base.getGodNodes(50).nodes.find((n) => n.id === 'a.ts')!.degree;
    for (const extra of [1, 5, 20]) {
      const eng = GraphQueryEngine.fromJSON(withExtraContains(extra));
      const degree = eng.getGodNodes(50).nodes.find((n) => n.id === 'a.ts')!.degree;
      expect(degree, `注入 ${extra} 条 contains 后 degree 应不变`).toBe(baseDegree);
    }
    // baseDegree 只计 depends-on（a.ts→b.ts）一条，不含 a.ts→a.ts::Foo 的 contains
    expect(baseDegree).toBe(1);
  });
});
