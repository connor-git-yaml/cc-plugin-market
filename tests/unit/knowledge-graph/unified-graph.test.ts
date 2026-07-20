/**
 * UnifiedGraph schema roundtrip + 边界用例（FR-1 + CL-01 / CL-07 / Codex C-1）
 */
import { describe, expect, it } from 'vitest';

import {
  CallSiteSchema,
  ConfidenceTierSchema,
  UNIFIED_GRAPH_SCHEMA_VERSION,
  UnifiedEdgeSchema,
  UnifiedGraphSchema,
  UnifiedNodeSchema,
  defaultDirectionalForRelation,
  type CallSite,
  type UnifiedEdge,
  type UnifiedGraph,
  type UnifiedNode,
} from '../../../src/knowledge-graph/unified-graph.js';

describe('UnifiedGraph schema', () => {
  describe('roundtrip — 序列化 / 反序列化字段无损（FR-1 验收）', () => {
    it('roundtrip 1：仅含 module 节点 + depends-on 边的最小图', () => {
      const graph: UnifiedGraph = {
        nodes: [
          {
            id: 'src/foo.ts',
            label: 'foo.ts',
            kind: 'module',
            language: 'typescript',
            filePath: 'src/foo.ts',
          },
          {
            id: 'src/bar.ts',
            label: 'bar.ts',
            kind: 'module',
            language: 'typescript',
            filePath: 'src/bar.ts',
          },
        ],
        edges: [
          {
            source: 'src/foo.ts',
            target: 'src/bar.ts',
            relation: 'depends-on',
            confidence: 'high',
            directional: true,
          },
        ],
        metadata: {
          generatedAt: '2026-05-08T10:00:00.000Z',
          projectRoot: '/repo',
          schemaVersion: UNIFIED_GRAPH_SCHEMA_VERSION,
        },
      };
      const serialized = JSON.stringify(graph);
      const deserialized = UnifiedGraphSchema.parse(JSON.parse(serialized));
      expect(deserialized).toEqual(graph);
    });

    it('roundtrip 2：含 calls 边 + Python 节点 + metadata 扩展字段', () => {
      const graph: UnifiedGraph = {
        nodes: [
          {
            id: 'src/engine.py::Value',
            label: 'Value',
            kind: 'symbol',
            language: 'python',
            filePath: 'src/engine.py',
            metadata: { callSitesCount: 5 },
          },
          {
            id: 'src/engine.py::Value.__add__',
            label: 'Value.__add__',
            kind: 'symbol',
            language: 'python',
            filePath: 'src/engine.py',
          },
        ],
        edges: [
          {
            source: 'src/engine.py::Value',
            target: 'src/engine.py::Value.__add__',
            relation: 'calls',
            confidence: 'high',
            directional: true,
            evidence: 'a + b → __add__ binary_operator',
            weight: 0.9,
          },
        ],
        metadata: {
          generatedAt: '2026-05-08T10:00:00.000Z',
          projectRoot: '/repo',
          schemaVersion: UNIFIED_GRAPH_SCHEMA_VERSION,
        },
      };
      const deserialized = UnifiedGraphSchema.parse(JSON.parse(JSON.stringify(graph)));
      expect(deserialized).toEqual(graph);
      expect(deserialized.nodes[0].metadata).toEqual({ callSitesCount: 5 });
    });

    it('roundtrip 3：含对称关系（conceptually_related_to，directional 缺省）', () => {
      const graph: UnifiedGraph = {
        nodes: [
          { id: 'spec/A', label: 'Spec A', kind: 'spec' },
          { id: 'spec/B', label: 'Spec B', kind: 'spec' },
        ],
        edges: [
          {
            source: 'spec/A',
            target: 'spec/B',
            relation: 'conceptually_related_to',
            confidence: 'medium',
          },
        ],
        metadata: {
          generatedAt: '2026-05-08T10:00:00.000Z',
          projectRoot: '/repo',
          schemaVersion: UNIFIED_GRAPH_SCHEMA_VERSION,
        },
      };
      const deserialized = UnifiedGraphSchema.parse(JSON.parse(JSON.stringify(graph)));
      expect(deserialized).toEqual(graph);
      expect(deserialized.edges[0].directional).toBeUndefined();
    });
  });

  describe('confidence tier 合法值 / 非法值（FR-1 验收）', () => {
    it('high / medium / low 三档全部合法', () => {
      expect(ConfidenceTierSchema.parse('high')).toBe('high');
      expect(ConfidenceTierSchema.parse('medium')).toBe('medium');
      expect(ConfidenceTierSchema.parse('low')).toBe('low');
    });

    it('其他值非法（如旧 GraphJSON 的 EXTRACTED）', () => {
      expect(() => ConfidenceTierSchema.parse('EXTRACTED')).toThrow();
      expect(() => ConfidenceTierSchema.parse('extracted')).toThrow();
      expect(() => ConfidenceTierSchema.parse('')).toThrow();
      expect(() => ConfidenceTierSchema.parse('unknown')).toThrow();
    });
  });

  describe('directional 字段语义（CL-07 + Codex C-1 验收）', () => {
    it('calls / depends-on / cross-module / contains 默认 directional=true', () => {
      expect(defaultDirectionalForRelation('calls')).toBe(true);
      expect(defaultDirectionalForRelation('depends-on')).toBe(true);
      expect(defaultDirectionalForRelation('cross-module')).toBe(true);
      expect(defaultDirectionalForRelation('contains')).toBe(true);
    });

    it('对称关系默认 directional=false', () => {
      expect(defaultDirectionalForRelation('conceptually_related_to')).toBe(false);
      expect(defaultDirectionalForRelation('references')).toBe(false);
      expect(defaultDirectionalForRelation('documents')).toBe(false);
      expect(defaultDirectionalForRelation('rationale_for')).toBe(false);
    });

    it('Codex P0 W-1：calls / depends-on / cross-module / contains 显式 directional=false 应被 schema 拒绝', () => {
      const directionalRequired: Array<UnifiedEdge['relation']> = [
        'calls',
        'depends-on',
        'cross-module',
        'contains',
      ];
      for (const relation of directionalRequired) {
        const edge = {
          source: 'a',
          target: 'b',
          relation,
          confidence: 'low' as const,
          directional: false,
        };
        expect(() => UnifiedEdgeSchema.parse(edge)).toThrow(
          /必须 directional=true/,
        );
      }
    });

    it('对称关系显式 directional=false 合法（producer 控制权）', () => {
      const edge: UnifiedEdge = {
        source: 'a',
        target: 'b',
        relation: 'conceptually_related_to',
        confidence: 'low',
        directional: false,
      };
      expect(UnifiedEdgeSchema.parse(edge)).toEqual(edge);
    });
  });

  describe('schemaVersion 验证（FR-1 + Feature 156 持久化 anchor）', () => {
    it('schemaVersion 必须存在且符合 X.Y 格式', () => {
      // Feature 214 W4 例外：直接验证版本常量本身的断言保留字面合同值，
      // 使 FR-010 的 bump 有独立看护（禁改成 CONST===CONST 恒真）。
      expect(UNIFIED_GRAPH_SCHEMA_VERSION).toBe('1.1');
      expect(UNIFIED_GRAPH_SCHEMA_VERSION).toMatch(/^\d+\.\d+$/);
    });

    it('schemaVersion 缺失时 zod 校验抛错', () => {
      const invalidGraph = {
        nodes: [],
        edges: [],
        metadata: {
          generatedAt: '2026-05-08T10:00:00.000Z',
          projectRoot: '/repo',
        },
      };
      expect(() => UnifiedGraphSchema.parse(invalidGraph)).toThrow();
    });

    it('schemaVersion 格式错误时（如 "v1"）zod 校验抛错', () => {
      const invalidGraph = {
        nodes: [],
        edges: [],
        metadata: {
          generatedAt: '2026-05-08T10:00:00.000Z',
          projectRoot: '/repo',
          schemaVersion: 'v1',
        },
      };
      expect(() => UnifiedGraphSchema.parse(invalidGraph)).toThrow();
    });
  });
});

describe('CallSite schema (CL-01)', () => {
  it('完整字段（free function call）', () => {
    const cs: CallSite = {
      calleeName: 'foo',
      calleeKind: 'free',
      line: 42,
      column: 4,
      callerContext: 'main',
    };
    expect(CallSiteSchema.parse(cs)).toEqual(cs);
  });

  it('最小字段（仅 calleeName + calleeKind + line）', () => {
    const cs: CallSite = {
      calleeName: '__add__',
      calleeKind: 'dunder',
      line: 17,
    };
    expect(CallSiteSchema.parse(cs)).toEqual(cs);
  });

  it('confidence 字段不属于 CallSite — extra field 应被 zod 默认 strip', () => {
    const csWithConfidence = {
      calleeName: 'foo',
      calleeKind: 'free',
      line: 1,
      confidence: 'high',
    };
    const parsed = CallSiteSchema.parse(csWithConfidence);
    expect(parsed).not.toHaveProperty('confidence');
    expect(parsed).toEqual({ calleeName: 'foo', calleeKind: 'free', line: 1 });
  });

  it('calleeKind 7 种枚举全部合法', () => {
    const validKinds: Array<CallSite['calleeKind']> = [
      'free',
      'member',
      'cross-module',
      'dunder',
      'super',
      'decorator',
      'unresolved',
    ];
    for (const kind of validKinds) {
      expect(() =>
        CallSiteSchema.parse({ calleeName: 'x', calleeKind: kind, line: 1 }),
      ).not.toThrow();
    }
  });

  it('line 必须是 positive integer（1-based）', () => {
    expect(() =>
      CallSiteSchema.parse({ calleeName: 'foo', calleeKind: 'free', line: 0 }),
    ).toThrow();
    expect(() =>
      CallSiteSchema.parse({ calleeName: 'foo', calleeKind: 'free', line: -1 }),
    ).toThrow();
    expect(() =>
      CallSiteSchema.parse({ calleeName: 'foo', calleeKind: 'free', line: 1.5 }),
    ).toThrow();
  });
});

describe('UnifiedNode / UnifiedEdge 边界', () => {
  it('UnifiedNode kind 11 种枚举全部合法（Codex C-3 修订：与 panoramic GraphNode 对齐 + symbol）', () => {
    const kinds: Array<UnifiedNode['kind']> = [
      'module',
      'package',
      'component',
      'service',
      'spec',
      'document',
      'api',
      'api-schema',
      'event',
      'diagram',
      'symbol',
    ];
    for (const kind of kinds) {
      expect(() => UnifiedNodeSchema.parse({ id: 'x', label: 'x', kind })).not.toThrow();
    }
  });

  it('UnifiedEdge weight 必须 ≥ 0', () => {
    expect(() =>
      UnifiedEdgeSchema.parse({
        source: 'a',
        target: 'b',
        relation: 'calls',
        confidence: 'high',
        weight: -0.1,
      }),
    ).toThrow();
  });

  it('UnifiedEdge relation 不允许未知字符串', () => {
    expect(() =>
      UnifiedEdgeSchema.parse({
        source: 'a',
        target: 'b',
        relation: 'unknown-relation',
        confidence: 'high',
      }),
    ).toThrow();
  });
});
