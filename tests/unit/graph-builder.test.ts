/**
 * graph-builder 单元测试
 * 覆盖字段结构完整性、节点去重、边去重、容错降级、性能测试
 * 验收标准：AC-101-03、AC-101-04、AC-101-07、AC-101-09
 */
import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { buildKnowledgeGraph } from '../../src/panoramic/graph/graph-builder.js';
import type { ArchitectureIR, ArchitectureIRElement, ArchitectureIRRelationship } from '../../src/panoramic/models/architecture-ir-model.js';
import type { DocGraph, DocGraphSpecNode, DocGraphReference } from '../../src/panoramic/builders/doc-graph-builder.js';
import type { CrossReferenceLink } from '../../src/models/module-spec.js';

// ============================================================
// Mock 数据辅助函数
// ============================================================

/** 创建 mock ArchitectureIRElement */
function makeMockIRElement(id: string, kind: ArchitectureIRElement['kind'] = 'component'): ArchitectureIRElement {
  return {
    id,
    name: `element-${id}`,
    kind,
    description: `描述 ${id}`,
    technology: 'TypeScript',
    tags: [],
    sourceTags: ['workspace-index'],
    evidence: [],
    metadata: { tech: 'TypeScript' },
  };
}

/** 创建 mock ArchitectureIRRelationship */
function makeMockIRRelationship(
  sourceId: string,
  destId: string,
  kind: ArchitectureIRRelationship['kind'] = 'depends-on',
): ArchitectureIRRelationship {
  return {
    id: `rel-${sourceId}-${destId}-${kind}`,
    sourceId,
    destinationId: destId,
    kind,
    description: `关系 ${sourceId} → ${destId}`,
    tags: [],
    sourceTags: ['workspace-index'],
    evidence: [],
    metadata: {},
  };
}

/** 创建 mock DocGraph */
function makeMockDocGraph(specPaths: string[]): DocGraph {
  const specs: DocGraphSpecNode[] = specPaths.map((specPath) => ({
    specPath,
    sourceTarget: specPath.replace('.spec.md', ''),
    relatedFiles: [],
    linked: true,
    confidence: 'medium' as const,
    currentRun: true,
  }));

  const references: DocGraphReference[] = [];

  return {
    projectRoot: '/tmp/test',
    generatedAt: '2026-04-12T00:00:00.000Z',
    specs,
    sourceToSpec: [],
    references,
    missingSpecs: [],
    unlinkedSpecs: [],
  };
}

/** 创建 mock CrossReferenceLink */
function makeMockCrossRef(
  targetSpecPath: string,
  targetSourceTarget: string,
  evidenceCount: number,
): CrossReferenceLink {
  return {
    label: `→ ${targetSpecPath}`,
    href: `${targetSpecPath}#module-spec`,
    targetSpecPath,
    targetSourceTarget,
    kind: 'cross-module',
    direction: 'outbound',
    evidenceCount,
    summary: `出站 ${evidenceCount} 条证据`,
  };
}

/** 创建最小 ArchitectureIR */
function makeMockArchitectureIR(
  elements: ArchitectureIRElement[],
  relationships: ArchitectureIRRelationship[],
): ArchitectureIR {
  return {
    projectName: 'test-project',
    generatedAt: '2026-04-12T00:00:00.000Z',
    sourceTags: ['workspace-index'],
    warnings: [],
    elements,
    relationships,
    views: [],
    stats: {
      totalElements: elements.length,
      totalRelationships: relationships.length,
      totalViews: 0,
      availableViews: 0,
      totalWarnings: 0,
      sourceCount: 1,
    },
    metadata: {},
  };
}

// ============================================================
// 测试用例
// ============================================================

describe('buildKnowledgeGraph — 字段结构完整性（AC-101-03）', () => {
  it('返回值包含所有必填字段', () => {
    const ir = makeMockArchitectureIR(
      [makeMockIRElement('elem-a')],
      [],
    );

    const result = buildKnowledgeGraph({ architectureIR: ir });

    // 基础结构检查
    expect(typeof result.directed).toBe('boolean');
    expect(result.multigraph).toBe(false);
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.links)).toBe(true);
    expect(result.graph).toBeDefined();
    expect(result.graph.schemaVersion).toBe('1.0');
    expect(typeof result.graph.generatedAt).toBe('string');
    expect(result.graph.nodeCount).toBe(result.nodes.length);
    expect(result.graph.edgeCount).toBe(result.links.length);
  });

  it('每个节点含必填字段', () => {
    const ir = makeMockArchitectureIR([makeMockIRElement('node-1')], []);
    const result = buildKnowledgeGraph({ architectureIR: ir });

    for (const node of result.nodes) {
      expect(typeof node.id).toBe('string');
      expect(typeof node.kind).toBe('string');
      expect(typeof node.label).toBe('string');
      expect(typeof node.metadata).toBe('object');
    }
  });

  it('每条边含必填字段', () => {
    const elements = [makeMockIRElement('a'), makeMockIRElement('b')];
    const relationships = [makeMockIRRelationship('a', 'b')];
    const ir = makeMockArchitectureIR(elements, relationships);
    const result = buildKnowledgeGraph({ architectureIR: ir });

    for (const link of result.links) {
      expect(typeof link.source).toBe('string');
      expect(typeof link.target).toBe('string');
      expect(typeof link.relation).toBe('string');
      expect(typeof link.confidence).toBe('string');
      expect(typeof link.confidenceScore).toBe('number');
    }
  });
});

describe('buildKnowledgeGraph — 节点去重（AC-101-04）', () => {
  it('ArchitectureIR 节点覆盖同 ID 的 DocGraph spec 节点（last-write-wins）', () => {
    // DocGraph spec 和 IR element 共享同一 ID
    const sharedId = 'src/auth/service.ts';
    const docGraph = makeMockDocGraph([sharedId]);
    const irElement: ArchitectureIRElement = {
      ...makeMockIRElement(sharedId, 'container'),
      name: 'AuthService-IR',
    };
    const ir = makeMockArchitectureIR([irElement], []);

    const result = buildKnowledgeGraph({ docGraph, architectureIR: ir });

    // 只有一个节点（去重）
    const matchingNodes = result.nodes.filter((n) => n.id === sharedId);
    expect(matchingNodes).toHaveLength(1);
    // IR 节点覆盖：label 来自 IR
    expect(matchingNodes[0]!.label).toBe('AuthService-IR');
    // nodeCount 与实际数量一致
    expect(result.graph.nodeCount).toBe(result.nodes.length);
  });
});

describe('buildKnowledgeGraph — 无向图边去重', () => {
  it('同一 (source, target, relation) 三元组出现两次时保留 confidenceScore 更高的', () => {
    // 构造两个元素和两条相同类型的关系（模拟重复）
    const elements = [makeMockIRElement('a'), makeMockIRElement('b')];
    // 手动添加两条 id 不同但语义相同的关系
    const rel1: ArchitectureIRRelationship = {
      ...makeMockIRRelationship('a', 'b', 'depends-on'),
      id: 'rel-1',
      confidence: 'INFERRED',
      confidenceScore: 0.65,
    };
    const rel2: ArchitectureIRRelationship = {
      ...makeMockIRRelationship('a', 'b', 'depends-on'),
      id: 'rel-2',
      confidence: 'EXTRACTED',
      confidenceScore: 0.95,
    };
    const ir = makeMockArchitectureIR(elements, [rel1, rel2]);

    const result = buildKnowledgeGraph({ architectureIR: ir });

    // 两条相同关系合并为一条，保留高分
    const depEdges = result.links.filter(
      (l) => l.source === 'a' && l.target === 'b' && l.relation === 'depends-on',
    );
    expect(depEdges).toHaveLength(1);
    expect(depEdges[0]!.confidenceScore).toBe(0.95);
  });

  it('不同 relation 的边不合并', () => {
    const elements = [makeMockIRElement('a'), makeMockIRElement('b')];
    const relationships = [
      makeMockIRRelationship('a', 'b', 'depends-on'),
      makeMockIRRelationship('a', 'b', 'contains'),
    ];
    const ir = makeMockArchitectureIR(elements, relationships);

    const result = buildKnowledgeGraph({ architectureIR: ir });

    expect(result.links.length).toBeGreaterThanOrEqual(2);
    const depEdge = result.links.find((l) => l.relation === 'depends-on');
    const containsEdge = result.links.find((l) => l.relation === 'contains');
    expect(depEdge).toBeDefined();
    expect(containsEdge).toBeDefined();
  });
});

describe('buildKnowledgeGraph — 有向图模式', () => {
  it('directed: true 时 A→B 和 B→A 同类 relation 边均保留', () => {
    const elements = [makeMockIRElement('a'), makeMockIRElement('b')];
    const rel1 = makeMockIRRelationship('a', 'b', 'depends-on');
    const rel2 = makeMockIRRelationship('b', 'a', 'depends-on');
    const ir = makeMockArchitectureIR(elements, [rel1, rel2]);

    const result = buildKnowledgeGraph({ architectureIR: ir, directed: true });

    expect(result.directed).toBe(true);
    const atob = result.links.filter((l) => l.source === 'a' && l.target === 'b');
    const btoa = result.links.filter((l) => l.source === 'b' && l.target === 'a');
    expect(atob.length).toBeGreaterThanOrEqual(1);
    expect(btoa.length).toBeGreaterThanOrEqual(1);
  });
});

describe('buildKnowledgeGraph — 容错降级（AC-101-07）', () => {
  it('architectureIR 为 undefined 时不抛出，graph.json 仍生成', () => {
    expect(() => buildKnowledgeGraph({})).not.toThrow();
    const result = buildKnowledgeGraph({});
    expect(result.graph.schemaVersion).toBe('1.0');
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.links)).toBe(true);
  });

  it('所有数据源均为 undefined 时，skippedSources 包含跳过记录', () => {
    const result = buildKnowledgeGraph({});
    expect(result.graph.skippedSources).toBeDefined();
    expect(Array.isArray(result.graph.skippedSources)).toBe(true);
    // 三个数据源均跳过
    const sourceNames = result.graph.skippedSources!.map((s) => s.source);
    expect(sourceNames).toContain('architecture-ir');
    expect(sourceNames).toContain('doc-graph');
    expect(sourceNames).toContain('cross-reference');
  });

  it('仅提供 DocGraph 时也能正常生成', () => {
    const docGraph = makeMockDocGraph(['specs/auth.spec.md', 'specs/api.spec.md']);
    expect(() => buildKnowledgeGraph({ docGraph })).not.toThrow();
    const result = buildKnowledgeGraph({ docGraph });
    expect(result.nodes.length).toBe(2);
  });
});

describe('buildKnowledgeGraph — 悬空边过滤', () => {
  it('边的 source 不在节点集合时被静默跳过', () => {
    const elements = [makeMockIRElement('a')];
    // b 不在 elements 中，此边为悬空边
    const rel = makeMockIRRelationship('a', 'b-nonexistent', 'depends-on');
    const ir = makeMockArchitectureIR(elements, [rel]);

    const result = buildKnowledgeGraph({ architectureIR: ir });

    // 悬空边被跳过
    const danglingEdge = result.links.find((l) => l.target === 'b-nonexistent');
    expect(danglingEdge).toBeUndefined();
    // edgeCount 与实际数量一致
    expect(result.graph.edgeCount).toBe(result.links.length);
  });
});

describe('buildKnowledgeGraph — 性能测试（AC-101-09）', () => {
  it('5,000 节点 + 10,000 条边的场景下执行时间 < 10,000ms', () => {
    // 生成 5000 个元素
    const nodeCount = 5000;
    const edgeCount = 10000;
    const elements: ArchitectureIRElement[] = Array.from({ length: nodeCount }, (_, i) =>
      makeMockIRElement(`node-${i}`, 'component'),
    );
    // 生成 10000 条有效边（source/target 均存在）
    const relationships: ArchitectureIRRelationship[] = Array.from({ length: edgeCount }, (_, i) => {
      const srcIdx = i % nodeCount;
      const tgtIdx = (i + 1) % nodeCount;
      return makeMockIRRelationship(`node-${srcIdx}`, `node-${tgtIdx}`, 'depends-on');
    });
    const ir = makeMockArchitectureIR(elements, relationships);

    const start = performance.now();
    const result = buildKnowledgeGraph({ architectureIR: ir });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10000);
    expect(result.nodes.length).toBe(nodeCount);
    // 因无向图去重，边数量可能少于 10000（相同源目节点的重复边会合并）
    expect(result.graph.edgeCount).toBe(result.links.length);
  });
});
