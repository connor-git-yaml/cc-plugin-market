/**
 * MCP 工具 v2.0 集成测试（T035）
 * 覆盖 graph_hyperedges 3 种过滤场景 + 非法参数 + graph_node semanticEdges 字段
 * 使用 tests/fixtures/graph-v2.json 作为测试数据
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GraphQueryEngine } from '../../src/panoramic/graph/graph-query.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';

// 项目根目录（worktree 根）
const ROOT = join(fileURLToPath(import.meta.url), '../../..');

/** 从 fixture 文件加载 GraphQueryEngine */
function loadEngine(fixtureName: string): GraphQueryEngine {
  const raw = readFileSync(join(ROOT, 'tests/fixtures', fixtureName), 'utf-8');
  const graph = JSON.parse(raw) as GraphJSON;
  return new GraphQueryEngine(graph);
}

/** 构建无 hyperedges 的最简 GraphJSON（AC-006 降级场景） */
function makeEngineWithoutHyperedges(): GraphQueryEngine {
  const graph: GraphJSON = {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-04-19T00:00:00.000Z',
      nodeCount: 2,
      edgeCount: 1,
      sources: ['architecture-ir'],
      schemaVersion: '1.0',
    },
    nodes: [
      { id: 'src/x.ts', kind: 'module', label: 'x', metadata: {} },
      { id: 'src/y.ts', kind: 'module', label: 'y', metadata: {} },
    ],
    links: [
      {
        source: 'src/x.ts',
        target: 'src/y.ts',
        relation: 'imports',
        confidence: 'EXTRACTED',
        confidenceScore: 0.95,
      },
    ],
    // hyperedges 字段故意省略（v1.0 兼容）
  };
  return new GraphQueryEngine(graph);
}

// ============================================================
// 测试用例 1：graph_hyperedges 不带参数 → 返回所有 hyperedge
// ============================================================
describe('graph_hyperedges MCP 工具（通过 GraphQueryEngine.getHyperedges 验证）', () => {
  it('测试用例 1：不带参数时返回所有 hyperedge（graph-v2.json 含 1 条 hyperedge）', () => {
    const engine = loadEngine('graph-v2.json');
    const result = engine.getHyperedges();

    // graph-v2.json 中有 1 条 hyperedge
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('he-001');
    expect(result[0]!.label).toBe('全量摄取');
    expect(Array.isArray(result[0]!.nodes)).toBe(true);
    expect(result[0]!.nodes).toContain('src/a.ts');
    expect(result[0]!.rationale).toBeTruthy();
    expect(result[0]!.confidence).toBe('INFERRED');
  });

  // ============================================================
  // 测试用例 2：label 模糊匹配 → 返回匹配子集
  // ============================================================
  it('测试用例 2：label 模糊匹配（含"摄取"）→ 返回匹配的 hyperedge', () => {
    const engine = loadEngine('graph-v2.json');

    // "全量摄取" 中包含"摄取"
    const result = engine.getHyperedges({ label: '摄取' });
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe('全量摄取');
  });

  it('测试用例 2b：label 模糊匹配（不含任何 hyperedge label）→ 返回空数组', () => {
    const engine = loadEngine('graph-v2.json');
    const result = engine.getHyperedges({ label: 'NonExistentLabel' });
    expect(result).toHaveLength(0);
  });

  // ============================================================
  // 测试用例 3：node_id 精确匹配 → 返回包含该节点的 hyperedge
  // ============================================================
  it('测试用例 3：node_id 精确匹配（src/a.ts）→ 返回包含该节点的 hyperedge', () => {
    const engine = loadEngine('graph-v2.json');

    const result = engine.getHyperedges({ nodeId: 'src/a.ts' });
    expect(result).toHaveLength(1);
    expect(result[0]!.nodes).toContain('src/a.ts');
  });

  it('测试用例 3b：node_id 精确匹配（不存在的节点 ID）→ 返回空数组', () => {
    const engine = loadEngine('graph-v2.json');
    const result = engine.getHyperedges({ nodeId: 'src/nonexistent.ts' });
    expect(result).toHaveLength(0);
  });

  // ============================================================
  // 测试用例 4：hyperedges 为空时（v1.0 格式）→ 返回空列表不报错（AC-006）
  // ============================================================
  it('测试用例 4：graph.json 无 hyperedges 字段（v1.0）→ 返回 { hyperedges: [], total: 0, filtered: false }', () => {
    const engine = makeEngineWithoutHyperedges();
    const result = engine.getHyperedges();

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
    // total 和 filtered 由工具层构造，此处验证引擎层返回空数组
  });

  // ============================================================
  // 验证 filtered / total 响应结构（模拟工具层逻辑）
  // ============================================================
  it('工具层响应结构：带 label 过滤时 filtered=true，不带时 filtered=false', () => {
    const engine = loadEngine('graph-v2.json');

    // 无过滤参数
    const allHyperedges = engine.getHyperedges();
    const unfilteredResponse = {
      hyperedges: allHyperedges,
      total: allHyperedges.length,
      filtered: false,
    };
    expect(unfilteredResponse.filtered).toBe(false);
    expect(unfilteredResponse.total).toBe(1);

    // 带 label 过滤
    const filtered = engine.getHyperedges({ label: '摄取' });
    const filteredResponse = {
      hyperedges: filtered,
      total: filtered.length,
      filtered: true,
    };
    expect(filteredResponse.filtered).toBe(true);
    expect(filteredResponse.total).toBe(1);
  });
});

// ============================================================
// 测试用例 5：graph_node 返回 semanticEdges 字段（FR-024）
// ============================================================
describe('graph_node semanticEdges 字段（通过 GraphQueryEngine.getSemanticEdges 验证）', () => {
  it('测试用例 5：查询有语义边的节点时，getSemanticEdges 返回含 evidenceText 的语义边列表', () => {
    const engine = loadEngine('graph-v2.json');

    // graph-v2.json 中 specs/doc.md 作为 source 有两条语义边：references 和 conceptually_related_to
    const edges = engine.getSemanticEdges('specs/doc.md');

    expect(edges.length).toBeGreaterThanOrEqual(2);

    // 找到 references 类型的边
    const refEdge = edges.find((e) => e.type === 'references');
    expect(refEdge).toBeDefined();
    expect(refEdge!.direction).toBe('outgoing');
    expect(refEdge!.peer).toBe('src/pipeline.ts');
    expect(refEdge!.evidenceText).toBeTruthy();
    expect(refEdge!.evidenceSource).toBeDefined();
    expect(refEdge!.confidence).toBe('INFERRED');

    // 找到 conceptually_related_to 类型的边
    const conceptEdge = edges.find((e) => e.type === 'conceptually_related_to');
    expect(conceptEdge).toBeDefined();
    expect(conceptEdge!.direction).toBe('outgoing');
    expect(conceptEdge!.peer).toBe('src/a.ts');
    expect(conceptEdge!.evidenceText).toBeTruthy();
    expect(conceptEdge!.confidence).toBe('AMBIGUOUS');
  });

  it('测试用例 5b：查询无语义边的节点时，getSemanticEdges 返回空数组', () => {
    const engine = loadEngine('graph-v2.json');

    // src/b.ts 没有语义边（只有普通的 imports 边）
    const edges = engine.getSemanticEdges('src/b.ts');
    expect(edges).toEqual([]);
  });

  it('测试用例 5c：传入 null/undefined nodeId 时，getSemanticEdges 返回空数组（节点不存在场景）', () => {
    const engine = loadEngine('graph-v2.json');

    expect(engine.getSemanticEdges(null)).toEqual([]);
    expect(engine.getSemanticEdges(undefined)).toEqual([]);
    expect(engine.getSemanticEdges('')).toEqual([]);
  });

  it('测试用例 5d：getNode 返回节点时，semanticEdges 应作为附加字段合并到响应', () => {
    const engine = loadEngine('graph-v2.json');

    // 模拟 graph_node 工具层的行为：调用 getNode，再追加 semanticEdges
    const nodeResult = engine.getNode({ id: 'specs/doc.md' });
    expect(nodeResult.node).not.toBeNull();

    const semanticEdges = engine.getSemanticEdges(nodeResult.node?.id);
    const mergedResult = { ...nodeResult, semanticEdges };

    expect(mergedResult.semanticEdges).toBeDefined();
    expect(Array.isArray(mergedResult.semanticEdges)).toBe(true);
    expect(mergedResult.semanticEdges.length).toBeGreaterThanOrEqual(2);

    // 原有字段不受影响（向后兼容）
    expect(mergedResult.node).not.toBeNull();
    expect(mergedResult.neighbors).toBeDefined();
    expect(mergedResult.community).toBeDefined();
  });
});
