/**
 * Feature 151 — graph MCP tools 双层 snapshot 测试（FR-9 + SC-004 + Codex C-1 / C-2 修订）
 *
 * 双层验收口径（plan §3.11 + spec EC-8）：
 * - **Layer A**：把 calls 边从 graph.json 中过滤掉之后构造 GraphQueryEngine，
 *   再跑 6 个 MCP tool 查询 → snapshot 1:1（节点 / 边 ID 集合稳定）；
 * - **Layer B**：在含 calls 边的 graph.json 上构造 engine，跑同样查询 → snapshot 首版基线。
 *
 * 当前阶段（P0 — Feature 151 T-001b/c 骨架）：
 * - 6 graph MCP tool 双层测试已就位
 * - fixture 阶段使用 minimum-viable 手工 GraphJSON（4 节点 / 5 边，含 1 条 calls 边）
 *   验证：filter normalizer 正确剔除 calls 边、Layer A engine 在过滤后行为稳定
 * - P3 阶段（T-016a/b）替换为真实 self-dogfood baseline graph.json，录制正式 snapshot
 *
 * Codex W-1 修订：Layer B `it.skip.each` 暂占位，等 T-016b 录制后启用
 */
import { describe, expect, it } from 'vitest';

import { GraphQueryEngine } from '../../src/panoramic/graph/graph-query.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';

// ───────────────────────────────────────────────────────────
// Minimum-viable fixture（P0 阶段；P3 替换为 self-dogfood baseline）
// ───────────────────────────────────────────────────────────

const MVP_GRAPH_WITH_CALLS: GraphJSON = {
  directed: false,
  multigraph: false,
  graph: {
    sources: ['extractionResults', 'docGraph', 'architectureIR', 'crossReferenceLinks'],
    nodeCount: 4,
    edgeCount: 5,
    generatedAt: '2026-05-08T10:00:00.000Z',
  },
  nodes: [
    {
      id: 'src/foo.ts',
      kind: 'file',
      label: 'foo.ts',
      sourceFile: 'src/foo.ts',
      metadata: { sourcePath: 'src/foo.ts', community: 'cluster_0' },
    },
    {
      id: 'src/bar.ts',
      kind: 'file',
      label: 'bar.ts',
      sourceFile: 'src/bar.ts',
      metadata: { sourcePath: 'src/bar.ts', community: 'cluster_0' },
    },
    {
      id: 'src/foo.ts::greet',
      kind: 'function',
      label: 'greet',
      sourceFile: 'src/foo.ts',
      metadata: { sourcePath: 'src/foo.ts', community: 'cluster_0' },
    },
    {
      id: 'src/bar.ts::main',
      kind: 'function',
      label: 'main',
      sourceFile: 'src/bar.ts',
      metadata: { sourcePath: 'src/bar.ts', community: 'cluster_0' },
    },
  ],
  links: [
    {
      source: 'src/foo.ts',
      target: 'src/foo.ts::greet',
      relation: 'contains',
    },
    {
      source: 'src/bar.ts',
      target: 'src/bar.ts::main',
      relation: 'contains',
    },
    {
      source: 'src/bar.ts',
      target: 'src/foo.ts',
      relation: 'depends-on',
    },
    {
      source: 'src/bar.ts::main',
      target: 'src/foo.ts::greet',
      // Feature 151 新增 'calls' relation
      relation: 'calls',
    },
    {
      source: 'src/foo.ts::greet',
      target: 'src/foo.ts::greet',
      relation: 'documents',
    },
  ],
};

/**
 * Codex C-1 修订 — 必须在构造 engine 前过滤 calls 边，
 * 而不是事后过滤 raw response（adjacency 已被污染）。
 */
function filterOutCallEdges(json: GraphJSON): GraphJSON {
  return {
    ...json,
    links: json.links.filter((edge) => edge.relation !== 'calls'),
    graph: {
      ...json.graph,
      sources: json.graph.sources, // sources 不变（calls 来自 extractionResults，已包含）
    },
  };
}

// ───────────────────────────────────────────────────────────
// Engine 构造（双层，Codex C-1 修订）
// ───────────────────────────────────────────────────────────

function buildLayerAEngine(): GraphQueryEngine {
  // Layer A — 过滤掉 calls 边后构造 engine（adjacency 不含 calls 影响）
  return GraphQueryEngine.fromJSON(filterOutCallEdges(MVP_GRAPH_WITH_CALLS));
}

function buildLayerBEngine(): GraphQueryEngine {
  // Layer B — 含 calls 边的完整 engine（degree 计算受影响）
  return GraphQueryEngine.fromJSON(MVP_GRAPH_WITH_CALLS);
}

// ───────────────────────────────────────────────────────────
// Layer A — Legacy 子图必须 1:1（FR-9 + SC-004 Layer A）
// ───────────────────────────────────────────────────────────

describe('graph MCP tools snapshot — Layer A (calls-filtered engine, 必须 1:1)', () => {
  const engine = buildLayerAEngine();

  it('graph_query keyword=greet — Layer A 子图稳定', () => {
    const result = engine.query('greet', { budget: 10 });
    expect(result).toMatchSnapshot('layer-a-graph_query');
  });

  it('graph_node id=src/foo.ts — Layer A 节点详情稳定', () => {
    const result = engine.getNode('src/foo.ts');
    expect(result).toMatchSnapshot('layer-a-graph_node');
  });

  it('graph_path 从 main → greet — Layer A 不含 calls 边路径', () => {
    const result = engine.findPath('src/bar.ts::main', 'src/foo.ts::greet');
    expect(result).toMatchSnapshot('layer-a-graph_path');
  });

  it('graph_god_nodes top=3 — Layer A degree 排序稳定', () => {
    const result = engine.getGodNodes(3);
    expect(result).toMatchSnapshot('layer-a-graph_god_nodes');
  });

  it('graph_hyperedges — Layer A 超边集合', () => {
    const result = engine.getHyperedges({ limit: 100 });
    expect(result).toMatchSnapshot('layer-a-graph_hyperedges');
  });

  it('graph_community community_id=cluster_0 — Layer A 社区节点', () => {
    const result = engine.getCommunity('cluster_0', { limit: 100 });
    expect(result).toMatchSnapshot('layer-a-graph_community');
  });
});

// ───────────────────────────────────────────────────────────
// Layer B — calls-enabled 首版 baseline（Codex W-1 修订：占位 it.skip）
// ───────────────────────────────────────────────────────────

describe('graph MCP tools snapshot — Layer B (calls-enabled, 首版基线)', () => {
  const engine = buildLayerBEngine();

  // TODO(T-016b): 录制 calls-enabled 首版 baseline
  // P0 阶段已可运行（含 mvp fixture），P3 阶段在 self-dogfood 真实 graph.json 上录正式 snapshot
  it('graph_query keyword=greet — Layer B 含 calls 边', () => {
    const result = engine.query('greet', { budget: 10 });
    expect(result).toMatchSnapshot('layer-b-graph_query');
    // Layer B 必须含 'calls' relation 边
    const hasCallsEdge = result.edges.some((e) => e.relation === 'calls');
    expect(hasCallsEdge).toBe(true);
  });

  it('graph_god_nodes top=3 — Layer B degree 受 calls 影响', () => {
    const result = engine.getGodNodes(3);
    expect(result).toMatchSnapshot('layer-b-graph_god_nodes');
  });
});

// ───────────────────────────────────────────────────────────
// filterOutCallEdges normalizer 单测（Codex C-1 验收前置）
// ───────────────────────────────────────────────────────────

describe('filterOutCallEdges normalizer (Codex C-1 修订)', () => {
  it('过滤后 graph.links 中不含 relation === calls 的边', () => {
    const filtered = filterOutCallEdges(MVP_GRAPH_WITH_CALLS);
    expect(filtered.links.every((e) => e.relation !== 'calls')).toBe(true);
    // 原图含 1 条 calls 边，过滤后边数 -1
    expect(filtered.links.length).toBe(MVP_GRAPH_WITH_CALLS.links.length - 1);
  });

  it('过滤后节点集合不变（结构性 1:1 保证）', () => {
    const filtered = filterOutCallEdges(MVP_GRAPH_WITH_CALLS);
    expect(filtered.nodes.length).toBe(MVP_GRAPH_WITH_CALLS.nodes.length);
    const nodeIds = new Set(filtered.nodes.map((n) => n.id));
    const originalIds = new Set(MVP_GRAPH_WITH_CALLS.nodes.map((n) => n.id));
    expect(nodeIds).toEqual(originalIds);
  });

  it('Layer A engine 构造后 adjacency 不含 calls 边对应的边', () => {
    const engine = buildLayerAEngine();
    // 直接通过查询接口确认：main 节点的邻居中不应含 greet（因为只有 calls 边连接它们）
    const mainNode = engine.getNode('src/bar.ts::main');
    const neighborIds = mainNode.neighbors.map((n) => n.node.id);
    // main → greet 仅由 calls 边连接，过滤后不应出现
    expect(neighborIds).not.toContain('src/foo.ts::greet');
  });
});
