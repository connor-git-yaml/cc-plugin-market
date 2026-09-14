/**
 * M11 卡 A（P1-I）— bfsTraverse 的 affected 条目带上所经边的 provenance：
 * confidenceLabel / resolution / callSites / callSiteCount（缺席时诚实缺席）。
 * impact 与 detect_changes 共用这条 BFS，因此两处返回面同源得到调用点行号。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { GraphJSON } from '../../../src/panoramic/graph/graph-types.js';
import { bfsTraverse, clearReverseAdjacencyCache } from '../../../src/knowledge-graph/query-helpers.js';

const RES = { stage: 'cross-module', strategy: 'import-table', basis: 'index' } as const;
function graph(): GraphJSON {
  return {
    directed: true,
    multigraph: false,
    graph: { name: 'spectra-knowledge-graph', generatedAt: '2026-09-15T00:00:00.000Z', nodeCount: 3, edgeCount: 2, sources: ['unified-graph'], schemaVersion: '2.0' },
    nodes: [
      { id: 'a.py::A', kind: 'component', label: 'A', metadata: { sourceFile: 'a.py' } },
      { id: 'b.py::B', kind: 'component', label: 'B', metadata: { sourceFile: 'b.py' } },
      { id: 'c.py::C', kind: 'component', label: 'C', metadata: { sourceFile: 'c.py' } },
    ],
    links: [
      { source: 'b.py::B', target: 'a.py::A', relation: 'calls', confidence: 'EXTRACTED', confidenceScore: 0.95, directional: true, resolution: RES, callSites: [{ line: 7, column: 2 }, { line: 9 }], callSiteCount: 2 },
      { source: 'c.py::C', target: 'b.py::B', relation: 'calls', confidence: 'INFERRED', confidenceScore: 0.65, directional: true },
    ],
  } as GraphJSON;
}

describe('bfsTraverse — 边 provenance 透传', () => {
  beforeEach(() => clearReverseAdjacencyCache());

  it('上游 BFS：affected[0] 带 confidenceLabel + resolution + callSites + callSiteCount；无标签的边诚实缺席', () => {
    const r = bfsTraverse(graph(), 'a.py::A', {
      depth: 2, minConfidence: 0, direction: 'upstream', budget: 10,
      graphPath: '/g/graph.json', graphMtimeMs: 1, graphSizeBytes: 1, relations: ['calls'],
    });
    const byId = new Map(r.affected.map((a) => [a.id, a]));
    const b = byId.get('b.py::B')!;
    expect(b.confidence).toBe(0.95);
    expect(b.confidenceLabel).toBe('EXTRACTED');
    expect(b.resolution).toEqual(RES);
    expect(b.callSites).toEqual([{ line: 7, column: 2 }, { line: 9 }]);
    expect(b.callSiteCount).toBe(2);
    const c = byId.get('c.py::C')!;
    expect(c.confidenceLabel).toBe('INFERRED');
    expect('resolution' in c).toBe(false);
    expect('callSites' in c).toBe(false);
    expect('callSiteCount' in c).toBe(false);
  });
});
