/**
 * F271 T008 / FR-008 — graph_community 0 命中分支的诚实化。
 *
 * 0 命中有两种截然不同的成因，旧实现统一回「社区不存在：<id>」：
 *   A. 图中压根没有任何社区数据（未跑过 `spectra community`）→ 应指出如何获得数据
 *   B. 图中有社区数据，但给定 ID 未命中 → 应提示检查 ID
 * 把 A 说成 B 会把 agent 的诊断方向带偏（去改 ID 而不是去生成数据）。
 *
 * 返回结构不变（仍是 success 语义：nodes: []、cohesion: null），只改 message 生成逻辑。
 */

import { describe, it, expect } from 'vitest';
import { GraphQueryEngine } from '../../src/panoramic/graph/graph-query.js';
import type { GraphJSON, GraphNode } from '../../src/panoramic/graph/graph-types.js';

function mkNode(id: string, metadata: Record<string, unknown> = {}): GraphNode {
  return { id, kind: 'component', label: id, metadata } as GraphNode;
}

function mkGraph(nodes: GraphNode[]): GraphJSON {
  return {
    directed: true,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-08-31T00:00:00.000Z',
      nodeCount: nodes.length,
      edgeCount: 0,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
    },
    nodes,
    links: [],
  } as unknown as GraphJSON;
}

describe('F271 FR-008 — graph_community 区分「无社区数据」与「ID 未命中」', () => {
  it('场景 A：图中零 metadata.community → message 指出尚未运行 spectra community', () => {
    // 空 projectRoot 之外的目录，避免读到本仓真实 GRAPH_REPORT.md（0 命中分支本就先返回）
    const engine = new GraphQueryEngine(mkGraph([mkNode('src/a.ts'), mkNode('src/b.ts')]));

    const result = engine.getCommunity('0');

    expect(result.nodes).toEqual([]);
    expect(result.cohesion).toBeNull();
    expect(result.message).toContain('未运行');
    expect(result.message).toContain('spectra community');
    // 不得沿用会误导的旧文案
    expect(result.message).not.toContain('社区不存在');
  });

  it('场景 B：图中有社区数据但查询 ID 未命中 → 提示检查 ID，且不出现「未运行」字样', () => {
    const engine = new GraphQueryEngine(
      mkGraph([
        mkNode('src/a.ts', { community: '0' }),
        mkNode('src/b.ts', { community: '1' }),
      ]),
    );

    const result = engine.getCommunity('999');

    expect(result.nodes).toEqual([]);
    expect(result.cohesion).toBeNull();
    expect(result.message).toContain('未找到社区 ID');
    expect(result.message).toContain('999');
    // 关键：有数据时不能说"未运行"，否则又是一次误导
    expect(result.message).not.toContain('未运行');
  });

  it('场景 C：ID 命中时返回结构与既有行为一致（诚实化不影响正常路径）', () => {
    const engine = new GraphQueryEngine(
      mkGraph([
        mkNode('src/a.ts', { community: '0' }),
        mkNode('src/b.ts', { community: '0' }),
        mkNode('src/c.ts', { community: '1' }),
      ]),
    );

    const result = engine.getCommunity('0');

    expect(result.communityId).toBe('0');
    expect(result.nodes.map((n) => n.id)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('返回结构在两种 0 命中场景下均保持不变（不引入新 error code / 不改字段集）', () => {
    const noData = new GraphQueryEngine(mkGraph([mkNode('src/a.ts')])).getCommunity('0');
    const missId = new GraphQueryEngine(
      mkGraph([mkNode('src/a.ts', { community: '0' })]),
    ).getCommunity('7');

    for (const r of [noData, missId]) {
      expect(Object.keys(r).sort()).toEqual(['cohesion', 'communityId', 'message', 'nodes']);
    }
  });
});
