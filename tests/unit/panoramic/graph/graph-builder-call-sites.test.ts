/**
 * M11 卡 A（P1-I）— graph-builder 第五路（unified-graph）注入时把 calls 边的
 * resolution 透传为 GraphEdge.resolution，并把同 (source,target,relation) 的多个调用点
 * 合并成 callSites（排序 / 去重 / 上限 CALL_SITES_CAP）+ callSiteCount。
 * 非 calls 边或无 metadata 的边诚实缺席这些字段。
 */
import { describe, expect, it } from 'vitest';
import { buildKnowledgeGraph } from '../../../../src/panoramic/graph/graph-builder.js';
import { CALL_SITES_CAP } from '../../../../src/knowledge-graph/call-resolution-labels.js';

const RES = { stage: 'member', strategy: 'class-member', basis: 'index' } as const;
const nodes = [
  { id: 'a.py', kind: 'module', label: 'a.py', filePath: 'a.py', metadata: {} },
  { id: 'a.py::A', kind: 'symbol', label: 'A', filePath: 'a.py', metadata: {} },
  { id: 'a.py::B', kind: 'symbol', label: 'B', filePath: 'a.py', metadata: {} },
];
function build(edges: unknown[]) {
  return buildKnowledgeGraph({ unifiedGraph: { nodes, edges } } as never);
}
function callEdge(g: ReturnType<typeof build>) {
  const e = g.links.find((l) => l.relation === 'calls' && l.source === 'a.py::A' && l.target === 'a.py::B');
  expect(e).toBeDefined();
  return e!;
}

describe('buildKnowledgeGraph — calls 边 resolution / callSites 合并', () => {
  it('单条边：resolution 透传，callSites=[callSite]，callSiteCount=1', () => {
    const g = build([
      { source: 'a.py::A', target: 'a.py::B', relation: 'calls', confidence: 'high', directional: true, metadata: { resolution: RES, callSite: { line: 12, column: 4 } } },
    ]);
    const e = callEdge(g);
    expect(e.resolution).toEqual(RES);
    expect(e.callSites).toEqual([{ line: 12, column: 4 }]);
    expect(e.callSiteCount).toBe(1);
  });

  it('N:1 合并：三个调用点合并为一条边，按 (line, column) 排序并去重；resolution 取首条', () => {
    const g = build([
      { source: 'a.py::A', target: 'a.py::B', relation: 'calls', confidence: 'high', directional: true, metadata: { resolution: RES, callSite: { line: 40, column: 2 } } },
      { source: 'a.py::A', target: 'a.py::B', relation: 'calls', confidence: 'medium', directional: true, metadata: { resolution: { stage: 'member', strategy: 'class-member-placeholder', basis: 'heuristic' }, callSite: { line: 12, column: 4 } } },
      { source: 'a.py::A', target: 'a.py::B', relation: 'calls', confidence: 'high', directional: true, metadata: { resolution: RES, callSite: { line: 40, column: 2 } } },
      { source: 'a.py::A', target: 'a.py::B', relation: 'calls', confidence: 'high', directional: true, metadata: { resolution: RES, callSite: { line: 12 } } },
    ]);
    const e = callEdge(g);
    expect(e.callSites).toEqual([{ line: 12 }, { line: 12, column: 4 }, { line: 40, column: 2 }]);
    expect(e.callSiteCount).toBe(3);
    expect(e.resolution).toEqual(RES);
    expect(e.confidence).toBe('EXTRACTED');
  });

  it('超过 CALL_SITES_CAP 的调用点只计数不列出', () => {
    const edges = Array.from({ length: CALL_SITES_CAP + 5 }, (_, i) => ({
      source: 'a.py::A', target: 'a.py::B', relation: 'calls', confidence: 'high', directional: true,
      metadata: { resolution: RES, callSite: { line: 100 - i, column: 0 } },
    }));
    const e = callEdge(build(edges));
    expect(e.callSites!.length).toBe(CALL_SITES_CAP);
    expect(e.callSites![0]).toEqual({ line: 100 - (CALL_SITES_CAP + 4), column: 0 });
    expect(e.callSiteCount).toBe(CALL_SITES_CAP + 5);
  });

  it('无 metadata 的边（depends-on / 旧 producer）诚实缺席三个字段', () => {
    const g = build([
      { source: 'a.py::A', target: 'a.py::B', relation: 'calls', confidence: 'high', directional: true },
    ]);
    const e = callEdge(g);
    expect('resolution' in e).toBe(false);
    expect('callSites' in e).toBe(false);
    expect('callSiteCount' in e).toBe(false);
  });
});
