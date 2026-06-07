/**
 * graph-builder upsert helper 单元测试（Feature 178 RED）
 *
 * upsertEdge / upsertNode 是从 buildKnowledgeGraph 五路数据源逐字复制的
 * "构造 → 算 key → 取高 confidence 覆盖" / "last-write-wins + metadata 合并" 模式提取的内部 helper。
 * 这些用例直接锁定 helper 行为契约；byte-stable 端到端回归见 graph-builder-bytestable.test.ts。
 */
import { describe, it, expect } from 'vitest';
import { upsertEdge, upsertNode } from '../../../src/panoramic/graph/graph-builder.js';
import type { GraphEdge, GraphNode } from '../../../src/panoramic/graph/graph-types.js';

function makeEdge(source: string, target: string, relation: string, confidenceScore: number): GraphEdge {
  return { source, target, relation, confidence: 'EXTRACTED', confidenceScore };
}

function makeNode(id: string, metadata: Record<string, unknown>): GraphNode {
  return { id, kind: 'component', label: id, metadata };
}

describe('upsertEdge — confidence-max-wins', () => {
  it('插入新边', () => {
    const map = new Map<string, GraphEdge>();
    upsertEdge(map, makeEdge('a', 'b', 'depends-on', 0.5), false);
    expect(map.size).toBe(1);
    expect([...map.values()][0]!.confidenceScore).toBe(0.5);
  });

  it('同 key 更高 confidenceScore 覆盖', () => {
    const map = new Map<string, GraphEdge>();
    upsertEdge(map, makeEdge('a', 'b', 'depends-on', 0.5), false);
    upsertEdge(map, makeEdge('a', 'b', 'depends-on', 0.9), false);
    expect(map.size).toBe(1);
    expect([...map.values()][0]!.confidenceScore).toBe(0.9);
  });

  it('同 key 更低 confidenceScore 不覆盖', () => {
    const map = new Map<string, GraphEdge>();
    upsertEdge(map, makeEdge('a', 'b', 'depends-on', 0.9), false);
    upsertEdge(map, makeEdge('a', 'b', 'depends-on', 0.3), false);
    expect([...map.values()][0]!.confidenceScore).toBe(0.9);
  });

  it('undirected：A→B 与 B→A 视为同一条边', () => {
    const map = new Map<string, GraphEdge>();
    upsertEdge(map, makeEdge('a', 'b', 'depends-on', 0.5), false);
    upsertEdge(map, makeEdge('b', 'a', 'depends-on', 0.9), false);
    expect(map.size).toBe(1);
    expect([...map.values()][0]!.confidenceScore).toBe(0.9);
  });

  it('directed：A→B 与 B→A 视为不同边', () => {
    const map = new Map<string, GraphEdge>();
    upsertEdge(map, makeEdge('a', 'b', 'depends-on', 0.5), true);
    upsertEdge(map, makeEdge('b', 'a', 'depends-on', 0.9), true);
    expect(map.size).toBe(2);
  });
});

describe('upsertNode — last-write-wins + metadata 合并', () => {
  it('插入新节点（无 existing）', () => {
    const map = new Map<string, GraphNode>();
    upsertNode(map, makeNode('n1', { sourceTag: 'doc-graph' }));
    expect(map.size).toBe(1);
    expect(map.get('n1')!.metadata).toEqual({ sourceTag: 'doc-graph' });
  });

  it('同 id：新节点覆盖 + 保留旧 metadata 中新节点没有的键', () => {
    const map = new Map<string, GraphNode>();
    upsertNode(map, makeNode('n1', { sourceTag: 'doc-graph', confidence: 'medium' }));
    upsertNode(map, makeNode('n1', { sourceTag: 'architecture-ir', technology: 'TS' }));
    const merged = map.get('n1')!;
    // 新值覆盖同名键，旧独有键保留
    expect(merged.metadata).toEqual({
      sourceTag: 'architecture-ir',
      confidence: 'medium',
      technology: 'TS',
    });
    // label/kind 取最后写入
    expect(merged.label).toBe('n1');
  });
});
