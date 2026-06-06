/**
 * Feature 155 T-006 — query-helpers.ts 单测
 *
 * 覆盖：bfsTraverse / canonicalizeSymbolId / findFuzzyMatches / computeRiskTier /
 *      getReverseAdjacency / resolveEdgeConfidence
 *
 * 合同重点：
 *   - budget 遍历前截断（FR-012）
 *   - confidence 缺失 → 跳过 + warning
 *   - reverse adjacency cache 按 mtime / size 失效
 *   - sharedVisited 跨调用去重
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GraphJSON, GraphEdge } from '../../../src/panoramic/graph/graph-types.js';
import {
  bfsTraverse,
  canonicalizeSymbolId,
  findFuzzyMatches,
  computeRiskTier,
  getReverseAdjacency,
  resolveEdgeConfidence,
  clearReverseAdjacencyCache,
  moduleFileFromId,
  findNode,
  resolveSymbolFuzzy,
} from '../../../src/knowledge-graph/query-helpers.js';

const FIXTURE_PATH = resolve(__dirname, '../../fixtures/graph-fixtures/synthetic-budget.json');

function loadFixture(): Readonly<GraphJSON> {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as GraphJSON;
}

describe('canonicalizeSymbolId', () => {
  const graph = loadFixture();

  it('C-007a: 直接命中 graph.nodes 中的 id', () => {
    const r = canonicalizeSymbolId('fixture/engine.py::Value', graph);
    expect(r.canonicalId).toBe('fixture/engine.py::Value');
    expect(r.reason).toBe('ok');
  });

  it('C-007b: 三段输入 A::B::C 容错为 A::B.C', () => {
    // graph 中只有 fixture/engine.py::Value，三段输入 fixture/engine.py::Value::__add__
    // 容错降级为 fixture/engine.py::Value.__add__；该 id 不在 graph 中 → not-found
    // 但若 graph 含 Value.__add__ 节点应命中。本 fixture 不含 dunder，验证 not-found 路径。
    const r = canonicalizeSymbolId('fixture/engine.py::Value::__add__', graph);
    expect(r.canonicalId).toBeNull();
    expect(r.reason).toBe('not-found');
  });

  it('C-008a: 控制字符输入 → invalid', () => {
    const r = canonicalizeSymbolId('fixture/engine.py::Val\x00ue', graph);
    expect(r.canonicalId).toBeNull();
    expect(r.reason).toBe('invalid');
  });

  it('C-008b: 空字符串段 (`A::::B`) → invalid', () => {
    const r = canonicalizeSymbolId('fixture/engine.py::::Value', graph);
    expect(r.canonicalId).toBeNull();
    expect(r.reason).toBe('invalid');
  });

  it('C-008c: 空字符串 → invalid', () => {
    const r = canonicalizeSymbolId('', graph);
    expect(r.canonicalId).toBeNull();
    expect(r.reason).toBe('invalid');
  });

  it('C-008d: 仅空白字符 → invalid（trim 后空）', () => {
    const r = canonicalizeSymbolId('   ', graph);
    expect(r.canonicalId).toBeNull();
    expect(r.reason).toBe('invalid');
  });

  it('C-008e: 含前后空白的合法 id → trim 后命中', () => {
    const r = canonicalizeSymbolId('  fixture/engine.py::Value  ', graph);
    expect(r.canonicalId).toBe('fixture/engine.py::Value');
    expect(r.reason).toBe('ok');
  });

  it('C-007c: 剥前缀 ./ 后命中', () => {
    const r = canonicalizeSymbolId('./fixture/engine.py::Value', graph);
    expect(r.canonicalId).toBe('fixture/engine.py::Value');
    expect(r.reason).toBe('ok');
  });

  it('C-007d: 不在 graph 中的合法 id → not-found', () => {
    const r = canonicalizeSymbolId('fixture/nonexistent.py::Foo', graph);
    expect(r.canonicalId).toBeNull();
    expect(r.reason).toBe('not-found');
  });
});

describe('findFuzzyMatches', () => {
  const graph = loadFixture();

  it('C-009a: substring 命中返回候选', () => {
    const matches = findFuzzyMatches(graph, 'Value', 5);
    expect(matches).toContain('fixture/engine.py::Value');
  });

  it('C-009b: token 命中（拆 :: . _ /）', () => {
    const matches = findFuzzyMatches(graph, 'engine.py::Val', 5);
    expect(matches).toContain('fixture/engine.py::Value');
  });

  it('C-009c: limit=2 截断', () => {
    const matches = findFuzzyMatches(graph, 'fixture', 2);
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it('C-009d: limit=0 返回空', () => {
    expect(findFuzzyMatches(graph, 'Value', 0)).toEqual([]);
  });

  it('C-009e: 空查询返回空', () => {
    expect(findFuzzyMatches(graph, '', 5)).toEqual([]);
  });
});

describe('computeRiskTier', () => {
  it('C-010a: directCallers ≥ 10 → high', () => {
    expect(computeRiskTier(10, 0)).toBe('high');
    expect(computeRiskTier(15, 0)).toBe('high');
  });

  it('C-010b: transitive ≥ 50 → high', () => {
    expect(computeRiskTier(0, 50)).toBe('high');
  });

  it('C-010c: directCallers ≥ 3 → medium', () => {
    expect(computeRiskTier(3, 0)).toBe('medium');
    expect(computeRiskTier(9, 14)).toBe('medium');
  });

  it('C-010d: transitive ≥ 15 → medium', () => {
    expect(computeRiskTier(0, 15)).toBe('medium');
    expect(computeRiskTier(2, 49)).toBe('medium'); // transitive 49 命中 ≥ 15 阈值
  });

  it('C-010e: 边界值 directCallers=2, transitive=14 → low', () => {
    expect(computeRiskTier(2, 14)).toBe('low');
    expect(computeRiskTier(0, 0)).toBe('low');
  });
});

describe('resolveEdgeConfidence', () => {
  it('C-013a: 含 confidenceScore → 直接返回', () => {
    const edge: GraphEdge = {
      source: 'a',
      target: 'b',
      relation: 'calls',
      confidence: 'EXTRACTED',
      confidenceScore: 0.95,
    };
    expect(resolveEdgeConfidence(edge)).toBe(0.95);
  });

  it('C-013b: 无 confidenceScore，含 confidence tier → 走 CONFIDENCE_SCORES', () => {
    const edge = {
      source: 'a',
      target: 'b',
      relation: 'calls',
      confidence: 'INFERRED',
    } as unknown as GraphEdge;
    expect(resolveEdgeConfidence(edge)).toBe(0.65);
  });

  it('C-013c: 都没有 → null', () => {
    const edge = {
      source: 'a',
      target: 'b',
      relation: 'calls',
    } as unknown as GraphEdge;
    expect(resolveEdgeConfidence(edge)).toBeNull();
  });
});

describe('getReverseAdjacency', () => {
  beforeEach(() => clearReverseAdjacencyCache());

  it('C-011a: cache 命中复用同一对象', () => {
    const graph = loadFixture();
    const adj1 = getReverseAdjacency(graph, '/p/graph.json', 1000, 5000, ['calls'], 'upstream');
    const adj2 = getReverseAdjacency(graph, '/p/graph.json', 1000, 5000, ['calls'], 'upstream');
    expect(adj1).toBe(adj2);
  });

  it('C-011b: mtime 变化 → 重建（新对象）', () => {
    const graph = loadFixture();
    const adj1 = getReverseAdjacency(graph, '/p/graph.json', 1000, 5000, ['calls'], 'upstream');
    const adj2 = getReverseAdjacency(graph, '/p/graph.json', 2000, 5000, ['calls'], 'upstream');
    expect(adj1).not.toBe(adj2);
  });

  it('C-011c: size 变化 → 重建', () => {
    const graph = loadFixture();
    const adj1 = getReverseAdjacency(graph, '/p/graph.json', 1000, 5000, ['calls'], 'upstream');
    const adj2 = getReverseAdjacency(graph, '/p/graph.json', 1000, 6000, ['calls'], 'upstream');
    expect(adj1).not.toBe(adj2);
  });

  it('C-011d: upstream 邻接表正确（target → list of inbound）', () => {
    const graph = loadFixture();
    const adj = getReverseAdjacency(graph, '/p/graph.json', 1000, 5000, ['calls'], 'upstream');
    const inbound = adj.get('fixture/engine.py::Value');
    expect(inbound).toBeDefined();
    expect(inbound?.length).toBe(4); // 4 callers
    const sources = inbound?.map((x) => x.sourceId).sort();
    expect(sources).toEqual([
      'fixture/loss.py::MSELoss',
      'fixture/nn.py::Linear',
      'fixture/nn.py::ReLU',
      'fixture/optim.py::SGD',
    ]);
  });
});

describe('bfsTraverse', () => {
  beforeEach(() => clearReverseAdjacencyCache());

  const baseOptions = {
    graphPath: '/p/graph.json',
    graphMtimeMs: 1000,
    graphSizeBytes: 5000,
  };

  it('C-001: depth=2 直接返回 4 callers', () => {
    const graph = loadFixture();
    const r = bfsTraverse(graph, 'fixture/engine.py::Value', {
      ...baseOptions,
      depth: 2,
      minConfidence: 0.0, // 全部留下（含 AMBIGUOUS 0.25）
      direction: 'upstream',
      budget: 200,
    });
    expect(r.affected.length).toBe(4);
    expect(r.warnings).not.toContain('budget-truncated');
    const ids = r.affected.map((x) => x.id).sort();
    expect(ids).toEqual([
      'fixture/loss.py::MSELoss',
      'fixture/nn.py::Linear',
      'fixture/nn.py::ReLU',
      'fixture/optim.py::SGD',
    ]);
  });

  it('C-002: budget=3 强制截断（遍历前），warnings 含 budget-truncated', () => {
    const graph = loadFixture();
    const r = bfsTraverse(graph, 'fixture/engine.py::Value', {
      ...baseOptions,
      depth: 5,
      minConfidence: 0.0,
      direction: 'upstream',
      budget: 3,
    });
    expect(r.affected.length).toBe(3);
    expect(r.warnings).toContain('budget-truncated');
  });

  it('C-003: depth=0 → 空 affected（不展开任何邻居）', () => {
    const graph = loadFixture();
    const r = bfsTraverse(graph, 'fixture/engine.py::Value', {
      ...baseOptions,
      depth: 0,
      minConfidence: 0.0,
      direction: 'upstream',
      budget: 200,
    });
    expect(r.affected).toEqual([]);
  });

  it('C-004: minConfidence=0.7 过滤掉 INFERRED + AMBIGUOUS，只留 EXTRACTED 2 条', () => {
    const graph = loadFixture();
    const r = bfsTraverse(graph, 'fixture/engine.py::Value', {
      ...baseOptions,
      depth: 2,
      minConfidence: 0.7,
      direction: 'upstream',
      budget: 200,
    });
    expect(r.affected.length).toBe(2);
    const ids = r.affected.map((x) => x.id).sort();
    expect(ids).toEqual(['fixture/nn.py::Linear', 'fixture/nn.py::ReLU']);
  });

  it('C-004b: minConfidence=0.99 全过滤 → confidence-filtered-all warning', () => {
    const graph = loadFixture();
    const r = bfsTraverse(graph, 'fixture/engine.py::Value', {
      ...baseOptions,
      depth: 2,
      minConfidence: 0.99,
      direction: 'upstream',
      budget: 200,
    });
    expect(r.affected).toEqual([]);
    expect(r.warnings).toContain('confidence-filtered-all');
  });

  it('C-005: direction=downstream，从 caller 节点出发可达 target', () => {
    const graph = loadFixture();
    const r = bfsTraverse(graph, 'fixture/nn.py::Linear', {
      ...baseOptions,
      depth: 2,
      minConfidence: 0.0,
      direction: 'downstream',
      budget: 200,
    });
    expect(r.affected.map((x) => x.id)).toContain('fixture/engine.py::Value');
  });

  it('C-006: cycle 不会让响应膨胀', () => {
    // 构造 A → B → A 自循环 graph
    const cyclicGraph = {
      directed: true,
      multigraph: false,
      graph: { name: 'spectra-knowledge-graph', generatedAt: '', nodeCount: 2, edgeCount: 2, sources: [], schemaVersion: '2.0' },
      nodes: [
        { id: 'A', kind: 'component', label: 'A', metadata: {} },
        { id: 'B', kind: 'component', label: 'B', metadata: {} },
      ],
      links: [
        { source: 'A', target: 'B', relation: 'calls', confidence: 'EXTRACTED', confidenceScore: 0.95, directional: true },
        { source: 'B', target: 'A', relation: 'calls', confidence: 'EXTRACTED', confidenceScore: 0.95, directional: true },
      ],
    } as unknown as GraphJSON;
    const r = bfsTraverse(cyclicGraph, 'A', {
      graphPath: '/p/cyclic.json',
      graphMtimeMs: 1,
      graphSizeBytes: 1,
      depth: 5,
      minConfidence: 0,
      direction: 'upstream',
      budget: 200,
    });
    // cycle 应只 visit B 一次
    expect(r.affected.length).toBe(1);
    expect(r.affected[0]?.id).toBe('B');
  });

  it('C-012: sharedVisited 跨调用去重', () => {
    const graph = loadFixture();
    const sharedVisited = new Set<string>();
    // 第一次：从 Value 出发，应触达 4 callers
    const r1 = bfsTraverse(graph, 'fixture/engine.py::Value', {
      ...baseOptions,
      depth: 2,
      minConfidence: 0,
      direction: 'upstream',
      budget: 200,
      sharedVisited,
    });
    expect(r1.affected.length).toBe(4);
    // 第二次：从同一 target 出发，sharedVisited 含 self 但其他 callers 已 visited
    const r2 = bfsTraverse(graph, 'fixture/engine.py::Value', {
      ...baseOptions,
      depth: 2,
      minConfidence: 0,
      direction: 'upstream',
      budget: 200,
      sharedVisited,
    });
    // 第二次因为 callers 全部 visited 应返回 0
    expect(r2.affected.length).toBe(0);
  });

  it('C-014: confidence 缺失（无 confidenceScore + 无 confidence tier）→ missing-confidence-score warning', () => {
    const partialGraph = {
      directed: true,
      multigraph: false,
      graph: { name: 'spectra-knowledge-graph', generatedAt: '', nodeCount: 2, edgeCount: 1, sources: [], schemaVersion: '2.0' },
      nodes: [
        { id: 'A', kind: 'component', label: 'A', metadata: {} },
        { id: 'B', kind: 'component', label: 'B', metadata: {} },
      ],
      links: [
        // 故意缺 confidenceScore + confidence
        { source: 'A', target: 'B', relation: 'calls' },
      ],
    } as unknown as GraphJSON;
    const r = bfsTraverse(partialGraph, 'B', {
      graphPath: '/p/partial.json',
      graphMtimeMs: 1,
      graphSizeBytes: 1,
      depth: 2,
      minConfidence: 0,
      direction: 'upstream',
      budget: 200,
    });
    expect(r.affected.length).toBe(0);
    expect(r.warnings).toContain('missing-confidence-score');
  });
});

describe('moduleFileFromId / findNode', () => {
  const graph = loadFixture();

  it('C-015a: moduleFileFromId 提取 file 段', () => {
    expect(moduleFileFromId('fixture/engine.py::Value')).toBe('fixture/engine.py');
  });

  it('C-015b: 模块节点（无 ::）→ 返回自身', () => {
    expect(moduleFileFromId('fixture/engine.py')).toBe('fixture/engine.py');
  });

  it('C-016: findNode 找到 + 找不到都正确', () => {
    expect(findNode(graph, 'fixture/engine.py::Value')?.label).toBe('Value');
    expect(findNode(graph, 'nonexistent')).toBeNull();
  });
});

// ============================================================
// Feature 174 — resolveSymbolFuzzy 分层 fuzzy 解析
// 合同：四层命中即停（exact 1.0 / path-suffix 0.9 / partial-name 唯一性加权 /
//       levenshtein 0.5~0.75）+ 去重后唯一且 ≥0.9 → autoResolved
// ============================================================

/** 构造 fuzzy 测试用合成 micrograd 图（含 cohort C 节点 + 多义 relu + 路径后缀多义） */
function makeFuzzyGraph(): GraphJSON {
  const node = (id: string, label: string, kind: 'component' | 'module' = 'component') => ({
    id,
    kind,
    label,
    metadata: {},
  });
  return {
    nodes: [
      node('micrograd/engine.py::Value', 'Value'),
      node('micrograd/engine.py::Value.__add__', '__add__'),
      node('micrograd/engine.py::Value.__mul__', '__mul__'),
      node('micrograd/engine.py::Value.__neg__', '__neg__'),
      node('micrograd/engine.py::Value.__pow__', '__pow__'),
      node('micrograd/engine.py::Value.__repr__', '__repr__'),
      node('micrograd/engine.py::Value.backward', 'backward'),
      node('micrograd/engine.py::Value.relu', 'relu'),
      // 第二个 relu（不同 module）→ partial-name 多义
      node('micrograd/nn.py::Module.relu', 'relu'),
      node('micrograd/nn.py::Linear', 'Linear'),
      node('micrograd/nn.py::ReLU', 'ReLU'),
      // path-suffix 多义（两个 package 同后缀）→ 平票 / C-3
      node('a/util.py::Helper', 'Helper'),
      node('b/util.py::Helper', 'Helper'),
      // module 节点（无 ::）
      node('micrograd/engine.py', 'engine.py', 'module'),
      node('micrograd/nn.py', 'nn.py', 'module'),
    ],
    links: [],
    metadata: { schemaVersion: '2.0' },
  } as unknown as GraphJSON;
}

describe('resolveSymbolFuzzy (Feature 174)', () => {
  const graph = makeFuzzyGraph();

  // ---- 层 (a) exact ----
  it('R-001: 层 (a) exact 命中 → confidence 1.0 + autoResolved', () => {
    const r = resolveSymbolFuzzy(graph, 'micrograd/engine.py::Value');
    expect(r.candidates[0]?.matchKind).toBe('exact');
    expect(r.candidates[0]?.confidence).toBe(1.0);
    expect(r.autoResolved).toBe(true);
  });

  // ---- 层 (b) path-suffix ----
  it('R-002: 层 (b) path-suffix 唯一命中 → confidence 0.9 + autoResolved', () => {
    const r = resolveSymbolFuzzy(graph, 'engine.py::Value');
    expect(r.candidates[0]?.matchKind).toBe('path-suffix');
    expect(r.candidates[0]?.confidence).toBe(0.9);
    expect(r.autoResolved).toBe(true);
    expect(r.candidates[0]?.id).toBe('micrograd/engine.py::Value');
  });

  it('R-003: 层 (b) path-suffix 多命中 → 不 autoResolved + ≥2 候选', () => {
    const r = resolveSymbolFuzzy(graph, 'util.py::Helper');
    expect(r.autoResolved).toBe(false);
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.candidates.every((c) => c.matchKind === 'path-suffix')).toBe(true);
  });

  // ---- 层 (c) partial-name ----
  it('R-004: 层 (c) partial-name qualified 唯一 → 0.95 + autoResolved', () => {
    const r = resolveSymbolFuzzy(graph, 'Value.__add__');
    expect(r.candidates[0]?.matchKind).toBe('partial-name');
    expect(r.candidates[0]?.confidence).toBe(0.95);
    expect(r.candidates[0]?.id).toBe('micrograd/engine.py::Value.__add__');
    expect(r.autoResolved).toBe(true);
  });

  it('R-005: 层 (c) partial-name bare 唯一 → 0.90 + autoResolved', () => {
    const r = resolveSymbolFuzzy(graph, 'backward');
    expect(r.candidates[0]?.matchKind).toBe('partial-name');
    expect(r.candidates[0]?.confidence).toBe(0.9);
    expect(r.candidates[0]?.id).toBe('micrograd/engine.py::Value.backward');
    expect(r.autoResolved).toBe(true);
  });

  it('R-006: 层 (c) partial-name 多义（2 节点）→ 不 autoResolved + top 候选 0.7~0.85', () => {
    const r = resolveSymbolFuzzy(graph, 'relu');
    expect(r.autoResolved).toBe(false);
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.candidates[0]?.confidence).toBeLessThanOrEqual(0.85);
    expect(r.candidates[0]?.confidence).toBeGreaterThanOrEqual(0.7); // 合同下限
    expect(r.candidates.every((c) => c.matchKind === 'partial-name')).toBe(true);
  });

  // ---- 层 (d) levenshtein ----
  it('R-007: 层 (d) Levenshtein typo 命中 → matchKind levenshtein + confidence [0.5,0.75]', () => {
    const r = resolveSymbolFuzzy(graph, 'egnine.py::Value');
    expect(r.candidates[0]?.matchKind).toBe('levenshtein');
    expect(r.candidates[0]?.id).toBe('micrograd/engine.py::Value');
    expect(r.candidates[0]?.confidence).toBeGreaterThanOrEqual(0.5);
    expect(r.candidates[0]?.confidence).toBeLessThanOrEqual(0.75);
  });

  it('R-008: 层 (d) 超编辑距离阈值 → 无候选', () => {
    const r = resolveSymbolFuzzy(graph, 'zzzzzzzzzzzzzzzzzz');
    expect(r.candidates).toEqual([]);
    expect(r.autoResolved).toBe(false);
  });

  it('R-009: query > 512 字符 → 跳过层 d，返回前三层结果（此处为空）', () => {
    const longQuery = 'z'.repeat(513);
    const r = resolveSymbolFuzzy(graph, longQuery);
    expect(r.candidates).toEqual([]);
    expect(r.autoResolved).toBe(false);
  });

  // ---- 边界 ----
  it('R-010: 空 query → {candidates:[], autoResolved:false}', () => {
    expect(resolveSymbolFuzzy(graph, '')).toEqual({ candidates: [], autoResolved: false });
    expect(resolveSymbolFuzzy(graph, '   ')).toEqual({ candidates: [], autoResolved: false });
  });

  it('R-011: 控制字符 query → {candidates:[], autoResolved:false}', () => {
    expect(resolveSymbolFuzzy(graph, 'Value\x00')).toEqual({ candidates: [], autoResolved: false });
  });

  it('R-012: 空 graph → {candidates:[], autoResolved:false}', () => {
    const empty = { nodes: [], links: [], metadata: {} } as unknown as GraphJSON;
    expect(resolveSymbolFuzzy(empty, 'Value')).toEqual({ candidates: [], autoResolved: false });
  });

  it('R-013: 平票（两候选等分）→ 不 autoResolved', () => {
    // util.py::Helper 在 a/ 与 b/ 两 package 下均为 path-suffix 0.9 → 平票
    const r = resolveSymbolFuzzy(graph, 'util.py::Helper');
    expect(r.autoResolved).toBe(false);
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.candidates.every((c) => c.matchKind === 'path-suffix')).toBe(true);
    expect(r.candidates[0]?.confidence).toBe(0.9);
    expect(r.candidates[1]?.confidence).toBe(0.9);
    expect(r.candidates.map((c) => c.id).sort()).toEqual(['a/util.py::Helper', 'b/util.py::Helper']);
  });

  it('R-014: graphData 只读（Object.freeze）→ 不抛异常', () => {
    const frozen = Object.freeze(makeFuzzyGraph());
    Object.freeze(frozen.nodes);
    expect(() => resolveSymbolFuzzy(frozen, 'Value.__add__')).not.toThrow();
  });

  it('R-015: autoResolveThreshold floor ≥0.9（传 0.5 不得让 levenshtein 自动 resolve）', () => {
    // 单节点图：egnine.py::Value 唯一 levenshtein 命中（confidence ~0.67）
    const single = {
      nodes: [{ id: 'pkg/engine.py::Value', kind: 'component', label: 'Value', metadata: {} }],
      links: [],
      metadata: {},
    } as unknown as GraphJSON;
    const r = resolveSymbolFuzzy(single, 'egnine.py::Value', { autoResolveThreshold: 0.5 });
    // 唯一 levenshtein 候选，confidence 0.5~0.75（< 0.9）
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0]?.matchKind).toBe('levenshtein');
    expect(r.candidates[0]?.id).toBe('pkg/engine.py::Value');
    expect(r.candidates[0]?.confidence).toBeGreaterThanOrEqual(0.5);
    expect(r.candidates[0]?.confidence).toBeLessThan(0.9);
    // 即使传入阈值 0.5，floor 强制 ≥0.9 → 候选 <0.9 → 不 autoResolve（floor 语义保护）
    expect(r.autoResolved).toBe(false);
  });

  // ---- codex 风险回归用例 ----
  it('R-016 [C-3]: limit=1 + 2 候选不应误 autoResolve（用 deduped.length 判唯一）', () => {
    const r = resolveSymbolFuzzy(graph, 'util.py::Helper', { limit: 1 });
    // candidates 被 slice 到 limit=1，但 autoResolved 必须基于去重后真实候选数（2）判定
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0]?.matchKind).toBe('path-suffix');
    expect(['a/util.py::Helper', 'b/util.py::Helper']).toContain(r.candidates[0]?.id);
    expect(r.candidates[0]?.confidence).toBe(0.9);
    expect(r.autoResolved).toBe(false);
  });

  it('R-017 [C-2]: bare 单 token 不走 path-suffix（落 partial-name 唯一 0.90 autoResolve）', () => {
    // 'Linear' 是 bare token（无 :: 无 /）→ 必须 partial-name 命中，而非 path-suffix
    const r = resolveSymbolFuzzy(graph, 'Linear');
    expect(r.candidates[0]?.matchKind).toBe('partial-name');
    expect(r.candidates[0]?.id).toBe('micrograd/nn.py::Linear');
    expect(r.candidates[0]?.confidence).toBe(0.9); // bare 唯一加权
    expect(r.autoResolved).toBe(true);
  });

  it('R-018 [C-1]: typo 对 basename::symbol 多表示命中（去 package 前缀）', () => {
    // 完整 id 含 micrograd/ 前缀会让距离超阈值；多表示取 basename::symbol 后命中
    const r = resolveSymbolFuzzy(graph, 'egnine.py::Value');
    expect(r.candidates[0]?.matchKind).toBe('levenshtein');
    expect(r.candidates[0]?.id).toBe('micrograd/engine.py::Value');
    expect(r.candidates[0]?.confidence).toBeGreaterThanOrEqual(0.5);
    expect(r.candidates[0]?.confidence).toBeLessThanOrEqual(0.75);
  });

  it('R-019 [W-2]: 旧 `#` 分隔符格式 → partial-name 正确提取 symbol 段（防回归）', () => {
    // 旧 panoramic 格式 <file>#<symbol>；query bare 'Widget' 应 partial-name 唯一命中
    const legacy = {
      nodes: [
        { id: 'old/ui.py#Widget', kind: 'component', label: 'Widget', metadata: {} },
        { id: 'old/ui.py#Button', kind: 'component', label: 'Button', metadata: {} },
      ],
      links: [],
      metadata: {},
    } as unknown as GraphJSON;
    const r = resolveSymbolFuzzy(legacy, 'Widget');
    expect(r.candidates[0]?.matchKind).toBe('partial-name');
    expect(r.candidates[0]?.id).toBe('old/ui.py#Widget');
    expect(r.autoResolved).toBe(true);
  });
});
