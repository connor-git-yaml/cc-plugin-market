/**
 * F175 Phase 0 — normalizeGraphForWrite 占位实现单测
 *
 * Phase 0 版本：验证占位实现为 in-place no-op（返回 void、对象引用不变、
 * nodes/links 顺序不变）。GREEN 阶段的 byte-stable 排序用例先以 it.todo 占位。
 */

import { describe, it, expect } from 'vitest';
import { normalizeGraphForWrite } from '../../../src/panoramic/graph/index.js';
import type { GraphJSON } from '../../../src/panoramic/graph/graph-types.js';

function makeGraph(): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-06-06T00:00:00.000Z',
      nodeCount: 3,
      edgeCount: 2,
      sources: ['architecture-ir'],
      inputHash: 'abcdef0123456789',
      schemaVersion: '2.0',
    },
    // 故意乱序（非字典序），用于证明 Phase 0 占位不重排
    nodes: [
      { id: 'zeta', kind: 'module', label: 'zeta' } as GraphJSON['nodes'][number],
      { id: 'alpha', kind: 'module', label: 'alpha' } as GraphJSON['nodes'][number],
      { id: 'mid', kind: 'module', label: 'mid' } as GraphJSON['nodes'][number],
    ],
    links: [
      { source: 'zeta', target: 'alpha', relation: 'depends-on' } as GraphJSON['links'][number],
      { source: 'alpha', target: 'mid', relation: 'calls' } as GraphJSON['links'][number],
    ],
  };
}

describe('normalizeGraphForWrite — Phase 0 占位实现（in-place no-op）', () => {
  it('返回 void', () => {
    const graph = makeGraph();
    const result = normalizeGraphForWrite(graph);
    expect(result).toBeUndefined();
  });

  it('调用前后对象引用相同（in-place）', () => {
    const graph = makeGraph();
    const nodesRef = graph.nodes;
    const linksRef = graph.links;
    normalizeGraphForWrite(graph);
    expect(graph.nodes).toBe(nodesRef);
    expect(graph.links).toBe(linksRef);
  });

  it('Phase 0 占位不改变 nodes 顺序（保持原乱序）', () => {
    const graph = makeGraph();
    normalizeGraphForWrite(graph);
    expect(graph.nodes.map((n) => n.id)).toEqual(['zeta', 'alpha', 'mid']);
  });

  it('Phase 0 占位不改变 links 顺序', () => {
    const graph = makeGraph();
    normalizeGraphForWrite(graph);
    expect(graph.links.map((l) => `${l.source}->${l.target}`)).toEqual([
      'zeta->alpha',
      'alpha->mid',
    ]);
  });

  it('Phase 0 占位不剥除 generatedAt（即使传 stripTimestamps）', () => {
    const graph = makeGraph();
    normalizeGraphForWrite(graph, { stripTimestamps: true });
    expect(graph.graph.generatedAt).toBe('2026-06-06T00:00:00.000Z');
  });

  // ===== GREEN 阶段（T011/T022）预留用例：byte-stable 排序与时间戳剥除 =====
  it.todo('GREEN：归一化后 nodes 按 id 字典序排序');
  it.todo('GREEN：归一化后 links 按 source+target+relation 字典序排序');
  it.todo('GREEN：stripTimestamps=true 时剥除 graph.generatedAt');
  it.todo('GREEN：inputHash 对内容敏感、对仅时间戳变更不敏感');
});
