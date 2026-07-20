/**
 * quality-engine 单测（F217 T017）
 * 覆盖：五项结构指标聚合正确装配（不含 freshness）、structuralVerdict 四态映射优先级
 * （fail-strong-invariant 优先于 pass-with-warnings，pass-with-warnings 优先于无修饰 pass）。
 */
import { describe, it, expect } from 'vitest';
import { runGraphQualityChecks } from './quality-engine.js';
import type { GraphEdge, GraphJSON, GraphNode } from '../graph-types.js';

function symbolNode(id: string, metadata: Record<string, unknown> = {}): GraphNode {
  return { id, kind: 'component', label: id, metadata: { unifiedKind: 'symbol', ...metadata } };
}
function moduleNode(id: string): GraphNode {
  return { id, kind: 'module', label: id, metadata: { unifiedKind: 'module' } };
}
function edge(source: string, target: string, relation = 'contains'): GraphEdge {
  return { source, target, relation, confidence: 'EXTRACTED', confidenceScore: 1 };
}

function makeGraph(nodes: GraphNode[], links: GraphEdge[] = []): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: nodes.length,
      edgeCount: links.length,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
    },
    nodes,
    links,
  };
}

const baseOpts = {
  isIgnored: (): boolean => false,
  getTestPatterns: (): null => null,
};

describe('runGraphQualityChecks', () => {
  it('全部五项结构指标 pass → structuralVerdict=pass', () => {
    const graph = makeGraph(
      [moduleNode('src/a.ts'), symbolNode('src/a.ts::foo')],
      [edge('src/a.ts', 'src/a.ts::foo')],
    );
    const result = runGraphQualityChecks(graph, baseOpts);
    expect(result.duplicateCanonicalId.status).toBe('pass');
    expect(result.containsCoverage.status).toBe('pass');
    expect(result.danglingEdges.status).toBe('pass');
    expect(result.legacyAndIgnoredNodes.status).toBe('pass');
    expect(result.orphanRatio.status).toBe('pass');
    expect(result.structuralVerdict).toBe('pass');
  });

  it('仅非强指标 fail（如 contains 覆盖率不足）→ pass-with-warnings（非强不变量违反）', () => {
    const graph = makeGraph([
      moduleNode('src/a.ts'),
      symbolNode('src/a.ts::foo'), // 无 contains 入边 → containsCoverage fail
    ]);
    const result = runGraphQualityChecks(graph, baseOpts);
    expect(result.containsCoverage.status).toBe('fail');
    expect(result.duplicateCanonicalId.status).toBe('pass');
    expect(result.danglingEdges.status).toBe('pass');
    expect(result.structuralVerdict).toBe('pass-with-warnings');
  });

  it('存在强不变量违反（重复 canonical ID）→ fail-strong-invariant，优先级高于同时存在的非强指标问题', () => {
    const graph = makeGraph([
      // 重复 canonical ID（强不变量违反）
      { id: 'src/a.ts::foo', kind: 'component', label: 'foo', metadata: { unifiedKind: 'symbol' } },
      { id: 'src/a.ts#foo', kind: 'component', label: 'foo', metadata: { unifiedKind: 'symbol' } },
      // 同时无 contains 入边（非强指标问题，理应被强不变量覆盖）
    ]);
    const result = runGraphQualityChecks(graph, baseOpts);
    expect(result.duplicateCanonicalId.status).toBe('fail');
    expect(result.containsCoverage.status).toBe('fail'); // 非强指标问题同时存在
    expect(result.structuralVerdict).toBe('fail-strong-invariant');
  });

  it('悬空边（强不变量违反）→ fail-strong-invariant', () => {
    const graph = makeGraph(
      [symbolNode('src/a.ts::foo')],
      [edge('src/a.ts::foo', 'ghost', 'calls')],
    );
    const result = runGraphQualityChecks(graph, baseOpts);
    expect(result.danglingEdges.status).toBe('fail');
    expect(result.structuralVerdict).toBe('fail-strong-invariant');
  });
});
