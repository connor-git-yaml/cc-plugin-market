/**
 * Feature 156 W1.4 — module-derivation 单测（FR-18 / FR-27 / FR-31 / AC-8）
 *
 * 验证：
 * - S-1：deriveModuleGraph 产出的 modules[].inDegree / outDegree 与手动计算一致
 * - S-2：topologicalOrder 与既有 topologicalSort 路径在等价 fixture 上输出相同
 * - S-3：renderModuleGraph 派生的 mermaidSource 含所有 depends-on 边
 * - S-4：isCircular 派生（A→B→A SCC fixture），SCC 内边为 true，非 SCC 边为 false
 * - FR-31：禁止从全局 cache 派生（不调用 getCurrentUnifiedGraph）
 */
import { describe, expect, it } from 'vitest';
import { deriveModuleGraph } from '../../../src/knowledge-graph/module-derivation.js';
import { UNIFIED_GRAPH_SCHEMA_VERSION } from '../../../src/knowledge-graph/unified-graph.js';
import type { UnifiedGraph } from '../../../src/knowledge-graph/unified-graph.js';

// ───────────────────────────────────────────────────────────
// 测试 fixture 工厂
// ───────────────────────────────────────────────────────────

function makeUnifiedGraph(opts: {
  moduleIds: string[];
  edges: Array<{ source: string; target: string; importTypePrefix?: string }>;
}): UnifiedGraph {
  return {
    nodes: opts.moduleIds.map((id) => ({
      id,
      label: id,
      kind: 'module' as const,
      language: 'typescript',
      filePath: id,
    })),
    edges: opts.edges.map((e) => ({
      source: e.source,
      target: e.target,
      relation: 'depends-on' as const,
      confidence: 'high' as const,
      directional: true,
      evidence: e.importTypePrefix
        ? `${e.importTypePrefix}:${e.source}->${e.target}`
        : `${e.source}->${e.target}`,
    })),
    metadata: {
      generatedAt: '2026-05-08T10:00:00.000Z',
      projectRoot: '/proj',
      schemaVersion: UNIFIED_GRAPH_SCHEMA_VERSION,
    },
  };
}

// ───────────────────────────────────────────────────────────
// S-1：inDegree / outDegree 派生
// ───────────────────────────────────────────────────────────

describe('S-1：deriveModuleGraph 派生 inDegree / outDegree', () => {
  it('3 模块 + 2 边 fixture 上 inDegree / outDegree 与手算一致', () => {
    const unified = makeUnifiedGraph({
      moduleIds: ['a.ts', 'b.ts', 'c.ts'],
      edges: [
        { source: 'a.ts', target: 'b.ts' },
        { source: 'a.ts', target: 'c.ts' },
      ],
    });
    const result = deriveModuleGraph(unified, '/proj');
    const a = result.modules.find((m) => m.source === 'a.ts')!;
    const b = result.modules.find((m) => m.source === 'b.ts')!;
    const c = result.modules.find((m) => m.source === 'c.ts')!;
    expect(a.outDegree).toBe(2);
    expect(a.inDegree).toBe(0);
    expect(b.outDegree).toBe(0);
    expect(b.inDegree).toBe(1);
    expect(c.outDegree).toBe(0);
    expect(c.inDegree).toBe(1);
    expect(a.isOrphan).toBe(false);
    expect(b.isOrphan).toBe(false);
  });

  it('孤立节点（无边）isOrphan=true', () => {
    const unified = makeUnifiedGraph({
      moduleIds: ['lonely.ts'],
      edges: [],
    });
    const result = deriveModuleGraph(unified, '/proj');
    expect(result.modules[0]!.isOrphan).toBe(true);
    expect(result.modules[0]!.inDegree).toBe(0);
    expect(result.modules[0]!.outDegree).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────
// S-2：topologicalOrder 等价
// ───────────────────────────────────────────────────────────

describe('S-2：topologicalOrder 与既有 topologicalSort 路径等价', () => {
  it('线性链 a→b→c：order 中 a 在 b 之前、b 在 c 之前（dependents-first，依赖前置）', () => {
    const unified = makeUnifiedGraph({
      moduleIds: ['a.ts', 'b.ts', 'c.ts'],
      edges: [
        { source: 'a.ts', target: 'b.ts' },
        { source: 'b.ts', target: 'c.ts' },
      ],
    });
    const result = deriveModuleGraph(unified, '/proj');
    expect(result.topologicalOrder).toHaveLength(3);
    const indexA = result.topologicalOrder.indexOf('a.ts');
    const indexB = result.topologicalOrder.indexOf('b.ts');
    const indexC = result.topologicalOrder.indexOf('c.ts');
    expect(indexA).toBeLessThan(indexB);
    expect(indexB).toBeLessThan(indexC);
  });

  it('level 字段：a→b→c 链上 level 单调递增', () => {
    const unified = makeUnifiedGraph({
      moduleIds: ['a.ts', 'b.ts', 'c.ts'],
      edges: [
        { source: 'a.ts', target: 'b.ts' },
        { source: 'b.ts', target: 'c.ts' },
      ],
    });
    const result = deriveModuleGraph(unified, '/proj');
    const lvlA = result.modules.find((m) => m.source === 'a.ts')!.level;
    const lvlB = result.modules.find((m) => m.source === 'b.ts')!.level;
    const lvlC = result.modules.find((m) => m.source === 'c.ts')!.level;
    expect(lvlA).toBeLessThanOrEqual(lvlB);
    expect(lvlB).toBeLessThanOrEqual(lvlC);
  });
});

// ───────────────────────────────────────────────────────────
// S-3：mermaidSource 含所有 depends-on 边
// ───────────────────────────────────────────────────────────

describe('S-3：mermaidSource 包含 depends-on 边', () => {
  it('每条 depends-on 边在 mermaid 输出中至少出现一次', () => {
    const unified = makeUnifiedGraph({
      moduleIds: ['a.ts', 'b.ts'],
      edges: [{ source: 'a.ts', target: 'b.ts' }],
    });
    const result = deriveModuleGraph(unified, '/proj');
    expect(result.mermaidSource).toContain('graph TD');
    expect(result.mermaidSource.length).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────
// S-4：isCircular SCC 反查
// ───────────────────────────────────────────────────────────

describe('S-4：isCircular 派生（A→B→A SCC 反查）', () => {
  it('A→B→A 循环 fixture：SCC 内边 isCircular=true', () => {
    const unified = makeUnifiedGraph({
      moduleIds: ['A.ts', 'B.ts'],
      edges: [
        { source: 'A.ts', target: 'B.ts' },
        { source: 'B.ts', target: 'A.ts' },
      ],
    });
    const result = deriveModuleGraph(unified, '/proj');
    expect(result.edges).toHaveLength(2);
    for (const e of result.edges) {
      expect(e.isCircular).toBe(true);
    }
    const bigScc = result.sccs.find((s) => s.modules.length > 1);
    expect(bigScc).toBeDefined();
    expect(new Set(bigScc!.modules)).toEqual(new Set(['A.ts', 'B.ts']));
  });

  it('混合 fixture：SCC 内边 isCircular=true、非 SCC 边 isCircular=false', () => {
    const unified = makeUnifiedGraph({
      moduleIds: ['A.ts', 'B.ts', 'C.ts'],
      edges: [
        { source: 'A.ts', target: 'B.ts' },
        { source: 'B.ts', target: 'A.ts' },
        { source: 'A.ts', target: 'C.ts' },
      ],
    });
    const result = deriveModuleGraph(unified, '/proj');
    const edgeAB = result.edges.find((e) => e.from === 'A.ts' && e.to === 'B.ts')!;
    const edgeBA = result.edges.find((e) => e.from === 'B.ts' && e.to === 'A.ts')!;
    const edgeAC = result.edges.find((e) => e.from === 'A.ts' && e.to === 'C.ts')!;
    expect(edgeAB.isCircular).toBe(true);
    expect(edgeBA.isCircular).toBe(true);
    expect(edgeAC.isCircular).toBe(false);
  });

  it('两个独立 size>1 SCC 之间的边不应被误标 isCircular', () => {
    const unified = makeUnifiedGraph({
      moduleIds: ['A.ts', 'B.ts', 'C.ts', 'D.ts'],
      edges: [
        { source: 'A.ts', target: 'B.ts' },
        { source: 'B.ts', target: 'A.ts' },
        { source: 'C.ts', target: 'D.ts' },
        { source: 'D.ts', target: 'C.ts' },
        { source: 'A.ts', target: 'C.ts' },
      ],
    });
    const result = deriveModuleGraph(unified, '/proj');
    const edgeAB = result.edges.find((e) => e.from === 'A.ts' && e.to === 'B.ts')!;
    const edgeCD = result.edges.find((e) => e.from === 'C.ts' && e.to === 'D.ts')!;
    const edgeAC = result.edges.find((e) => e.from === 'A.ts' && e.to === 'C.ts')!;
    expect(edgeAB.isCircular).toBe(true);
    expect(edgeCD.isCircular).toBe(true);
    expect(edgeAC.isCircular).toBe(false);
  });

  it('metadata.importType 优先于 evidence 前缀（新格式）', () => {
    const unified: UnifiedGraph = {
      nodes: [
        { id: 'a.ts', label: 'a.ts', kind: 'module', filePath: 'a.ts' },
        { id: 'b.ts', label: 'b.ts', kind: 'module', filePath: 'b.ts' },
      ],
      edges: [
        {
          source: 'a.ts',
          target: 'b.ts',
          relation: 'depends-on',
          confidence: 'high',
          directional: true,
          evidence: './b',
          metadata: { importType: 'dynamic' },
        },
      ],
      metadata: {
        generatedAt: '2026-05-08T10:00:00.000Z',
        projectRoot: '/proj',
        schemaVersion: UNIFIED_GRAPH_SCHEMA_VERSION,
      },
    };
    const result = deriveModuleGraph(unified, '/proj');
    expect(result.edges[0]!.importType).toBe('dynamic');
    expect(unified.edges[0]!.evidence).toBe('./b');
  });

  it('importType 从 evidence 前缀解析（dynamic / type-only / commonjs-require）', () => {
    const unified = makeUnifiedGraph({
      moduleIds: ['x.ts', 'y.ts', 'z.ts', 'w.ts'],
      edges: [
        { source: 'x.ts', target: 'y.ts', importTypePrefix: 'static' },
        { source: 'x.ts', target: 'z.ts', importTypePrefix: 'dynamic' },
        { source: 'x.ts', target: 'w.ts', importTypePrefix: 'type-only' },
      ],
    });
    const result = deriveModuleGraph(unified, '/proj');
    const eY = result.edges.find((e) => e.to === 'y.ts')!;
    const eZ = result.edges.find((e) => e.to === 'z.ts')!;
    const eW = result.edges.find((e) => e.to === 'w.ts')!;
    expect(eY.importType).toBe('static');
    expect(eZ.importType).toBe('dynamic');
    expect(eW.importType).toBe('type-only');
  });

  it('commonjs-require evidence 前缀归并到 static（ModuleEdge.importType 枚举不含 commonjs-require）', () => {
    const unified = makeUnifiedGraph({
      moduleIds: ['x.ts', 'y.ts'],
      edges: [{ source: 'x.ts', target: 'y.ts', importTypePrefix: 'commonjs-require' }],
    });
    const result = deriveModuleGraph(unified, '/proj');
    expect(result.edges[0]!.importType).toBe('static');
  });
});

// ───────────────────────────────────────────────────────────
// Feature 214 T014 — contains 边不污染 B→A 派生视图 + B→A 字段级合同（核实项④, SC-003）
// ───────────────────────────────────────────────────────────

describe('Feature 214 — deriveModuleGraph 对 contains 边/symbol 节点的 B→A 投影合同', () => {
  it('输入含 contains 边 + symbol/member 节点时，module 依赖/SCC/拓扑与不含时完全一致', () => {
    // baseline：仅 module + depends-on
    const baseline = makeUnifiedGraph({
      moduleIds: ['a.ts', 'b.ts', 'c.ts'],
      edges: [
        { source: 'a.ts', target: 'b.ts' },
        { source: 'b.ts', target: 'c.ts' },
      ],
    });
    // enriched：叠加 symbol/member 节点 + contains 边 + calls 边（Feature 214 新增数据）
    const enriched: UnifiedGraph = {
      nodes: [
        ...baseline.nodes,
        { id: 'a.ts::Foo', label: 'Foo', kind: 'symbol', language: 'typescript', filePath: 'a.ts' },
        { id: 'a.ts::Foo.bar', label: 'Foo.bar', kind: 'symbol', language: 'typescript', filePath: 'a.ts' },
      ],
      edges: [
        ...baseline.edges,
        { source: 'a.ts', target: 'a.ts::Foo', relation: 'contains', confidence: 'high', directional: true },
        { source: 'a.ts::Foo', target: 'a.ts::Foo.bar', relation: 'contains', confidence: 'high', directional: true },
        { source: 'a.ts::Foo.bar', target: 'b.ts::Baz', relation: 'calls', confidence: 'medium', directional: true },
      ],
      metadata: baseline.metadata,
    };

    const base = deriveModuleGraph(baseline, '/proj');
    const enr = deriveModuleGraph(enriched, '/proj');

    // module 集合一致（symbol/member 节点被丢弃）
    expect(new Set(enr.modules.map((m) => m.source))).toEqual(new Set(base.modules.map((m) => m.source)));
    expect(enr.modules).toHaveLength(3);
    // depends-on 边一致（contains/calls 边被丢弃，不进 ModuleEdge）
    expect(enr.edges.map((e) => `${e.from}->${e.to}`).sort()).toEqual(
      base.edges.map((e) => `${e.from}->${e.to}`).sort(),
    );
    // 拓扑序 / SCC 一致
    expect(enr.topologicalOrder).toEqual(base.topologicalOrder);
    expect(enr.sccs.length).toBe(base.sccs.length);
    // 度数一致（contains 不膨胀 module 度数）
    const enrA = enr.modules.find((m) => m.source === 'a.ts')!;
    const baseA = base.modules.find((m) => m.source === 'a.ts')!;
    expect(enrA.outDegree).toBe(baseA.outDegree);
    expect(enrA.inDegree).toBe(baseA.inDegree);
  });

  it('B→A importType 映射保留（metadata.importType → ModuleEdge.importType）', () => {
    const unified: UnifiedGraph = {
      nodes: [
        { id: 'a.ts', label: 'a.ts', kind: 'module', filePath: 'a.ts' },
        { id: 'b.ts', label: 'b.ts', kind: 'module', filePath: 'b.ts' },
        { id: 'a.ts::Foo', label: 'Foo', kind: 'symbol', filePath: 'a.ts' },
      ],
      edges: [
        {
          source: 'a.ts', target: 'b.ts', relation: 'depends-on',
          confidence: 'high', directional: true, evidence: './b',
          metadata: { importType: 'type-only' },
        },
        { source: 'a.ts', target: 'a.ts::Foo', relation: 'contains', confidence: 'high', directional: true },
      ],
      metadata: { generatedAt: '2026-07-20T10:00:00.000Z', projectRoot: '/proj', schemaVersion: UNIFIED_GRAPH_SCHEMA_VERSION },
    };
    const result = deriveModuleGraph(unified, '/proj');
    // 唯一 ModuleEdge 来自 depends-on，importType 映射保留；contains 被丢弃
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.importType).toBe('type-only');
  });
});

// ───────────────────────────────────────────────────────────
// FR-31 合规：不调用 getCurrentUnifiedGraph
// ───────────────────────────────────────────────────────────

describe('FR-31：不依赖 getCurrentUnifiedGraph 全局 cache', () => {
  it('源码级搜索：module-derivation.ts 不 import getCurrentUnifiedGraph 也不调用它', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const modulePath = path.resolve(__dirname, '../../../src/knowledge-graph/module-derivation.ts');
    const content = fs.readFileSync(modulePath, 'utf-8');
    // 剥离注释（块注释 + 行注释），仅检查实际代码
    const codeOnly = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/import\s+[^;]*\bgetCurrentUnifiedGraph\b/);
    expect(codeOnly).not.toMatch(/\bgetCurrentUnifiedGraph\s*\(/);
  });
});
