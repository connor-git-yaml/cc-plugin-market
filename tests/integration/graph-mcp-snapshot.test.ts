/**
 * Feature 151 — graph MCP tools 双层 snapshot 测试（FR-9 + SC-004 + Codex C-1 / C-2 修订）
 *
 * 双层验收口径（plan §3.11 + spec EC-8）：
 * - **Layer A**：把 calls 边从 graph.json 中过滤掉之后构造 GraphQueryEngine，
 *   再跑 6 个 MCP tool 查询 → snapshot 1:1（节点 / 边 ID 集合稳定）；
 * - **Layer B**：在含 calls 边的 graph.json 上构造 engine，跑同样查询 → snapshot 首版基线。
 *
 * 当前阶段（Feature 157 follow-up — P3 T-016b 完成）：
 * - 6 graph MCP tool 双层测试已就位（Layer A × 6 + Layer B MVP × 2）
 * - **Layer B 真实 self-dogfood fixture**（来自 self-dogfood 完整 spectra batch + 归一化）已入库 → 新增 self-dogfood describe 块（Layer B × 2）
 * - 原 Layer B MVP fixture（4 节点 / 5 边手工 GraphJSON）保留作为 normalizer 行为正交验证
 * - 总 snapshot：6 Layer A + 2 Layer B MVP + 2 Layer B self-dogfood = 10
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { GraphQueryEngine } from '../../src/panoramic/graph/graph-query.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// ───────────────────────────────────────────────────────────
// Layer B — self-dogfood 真实 fixture（Feature 157 follow-up T-016b）
// ───────────────────────────────────────────────────────────

const SELF_DOGFOOD_FIXTURE_PATH = path.resolve(__dirname, '__fixtures__/self-dogfood-graph.json');
const SELF_DOGFOOD_FIXTURE_EXISTS = fs.existsSync(SELF_DOGFOOD_FIXTURE_PATH);
const SELF_DOGFOOD_GRAPH: GraphJSON | null = SELF_DOGFOOD_FIXTURE_EXISTS
  ? (JSON.parse(fs.readFileSync(SELF_DOGFOOD_FIXTURE_PATH, 'utf-8')) as GraphJSON)
  : null;

const describeIfSelfDogfoodFixture = SELF_DOGFOOD_FIXTURE_EXISTS ? describe : describe.skip;

function buildLayerBSelfDogfoodEngine(): GraphQueryEngine {
  // Type-narrow：describe.skip 已经守卫了运行时（fixture 缺失时 it 不会跑），
  // 但 SELF_DOGFOOD_GRAPH 类型是 GraphJSON | null，TypeScript 需要这步显式 null-check
  // 才能让下面 GraphQueryEngine.fromJSON(SELF_DOGFOOD_GRAPH) 通过类型检查
  if (!SELF_DOGFOOD_GRAPH) {
    throw new Error('SELF_DOGFOOD_GRAPH fixture missing — describe block 应已 skip');
  }
  return GraphQueryEngine.fromJSON(SELF_DOGFOOD_GRAPH);
}

describeIfSelfDogfoodFixture('graph MCP tools snapshot — Layer B (self-dogfood, calls-enabled, P3 T-016b)', () => {
  // keyword 选择：实测 GraphQueryEngine.query 用 toLowerCase + split([\s\-_.]+) tokenize，
  // PascalCase 关键词（如 BatchOrchestrator）会被合并为单 token 不匹配 kebab-case label；
  // 选 'LanguageAdapter' 既能 tokenize 为 'languageadapter'（命中 69 节点，含产品类 LanguageAdapter）
  it('graph_query keyword=LanguageAdapter — Layer B 含真实 src/ 节点 + calls 边（W-2 路径限定）', () => {
    const engine = buildLayerBSelfDogfoodEngine();
    const result = engine.query('LanguageAdapter', { budget: 30 });
    expect(result).toMatchSnapshot('layer-b-self-dogfood-graph_query');
    // 真实数据应含 ≥ 1 src/ 路径节点（避免 tests/fixtures 下的 .py 干扰）
    const hasSrcNode = result.nodes.some(
      (n) => typeof n.id === 'string' && (n.id.startsWith('src/') || n.id.includes('/src/'))
    );
    expect(hasSrcNode).toBe(true);
    // Codex W-2：calls 边断言必须限定端点至少有一端落在 src/，避免 fixtures 误满足
    const hasSrcCallsEdge = result.edges.some((e) => {
      if (e.relation !== 'calls') return false;
      const src = typeof e.source === 'string' ? e.source : '';
      const tgt = typeof e.target === 'string' ? e.target : '';
      return src.startsWith('src/') || src.includes('/src/') || tgt.startsWith('src/') || tgt.includes('/src/');
    });
    expect(hasSrcCallsEdge).toBe(true);
  });

  it('graph_god_nodes top=5 — Layer B degree 受 calls 影响', () => {
    const engine = buildLayerBSelfDogfoodEngine();
    const result = engine.getGodNodes(5);
    expect(result).toMatchSnapshot('layer-b-self-dogfood-graph_god_nodes');
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
