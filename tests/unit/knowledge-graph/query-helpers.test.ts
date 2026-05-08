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
