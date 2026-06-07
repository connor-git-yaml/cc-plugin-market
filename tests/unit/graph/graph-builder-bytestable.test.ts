/**
 * graph-builder byte-stable 回归测试（Feature 178 RED → 护栏）
 *
 * 🔴 硬门：upsertEdge / upsertNode / edgeKey 提取前后，buildKnowledgeGraph 对覆盖全部五路
 * 数据源的固定输入必须产出 byte-identical 的 graph.json。
 *
 * 实现方式：构造确定性的五路 BuildGraphOptions → buildKnowledgeGraph → normalizeGraphForWrite
 * (stripTimestamps) → JSON.stringify(.,null,2)（与 writeAtomicJson 同一序列化）→ 快照比对。
 * 快照在提取前（当前 HEAD 实现）首跑落盘为 golden；GREEN 提取后重跑必须逐字节一致。
 */
import { describe, it, expect } from 'vitest';
import {
  buildKnowledgeGraph,
  normalizeGraphForWrite,
} from '../../../src/panoramic/graph/graph-builder.js';
import type { BuildGraphOptions } from '../../../src/panoramic/graph/graph-types.js';

/** 构造覆盖五路数据源、节点/边相互连接（含同 ID 覆盖、directional、悬空边）的确定性输入 */
function makeFiveSourceOptions(directed: boolean): BuildGraphOptions {
  const docGraph = {
    projectRoot: '/tmp/test',
    generatedAt: '2026-04-12T00:00:00.000Z',
    specs: [
      {
        specPath: 'specs/alpha.spec.md',
        sourceTarget: 'src/alpha',
        relatedFiles: ['src/alpha/index.ts'],
        linked: true,
        confidence: 'medium' as const,
        currentRun: true,
      },
      {
        specPath: 'specs/beta.spec.md',
        sourceTarget: 'src/beta',
        relatedFiles: [],
        linked: true,
        confidence: 'high' as const,
        currentRun: true,
      },
    ],
    sourceToSpec: [],
    references: [
      {
        fromSpecPath: 'specs/alpha.spec.md',
        toSpecPath: 'specs/beta.spec.md',
        kind: 'references',
        evidenceCount: 2,
      },
    ],
    missingSpecs: [],
    unlinkedSpecs: [],
  };

  const architectureIR = {
    projectName: 'test-project',
    generatedAt: '2026-04-12T00:00:00.000Z',
    sourceTags: ['workspace-index'],
    warnings: [],
    elements: [
      // 同 ID 覆盖 docGraph 的 spec 节点，触发 last-write-wins + metadata 合并
      {
        id: 'specs/alpha.spec.md',
        name: 'alpha-module',
        kind: 'container' as const,
        description: 'alpha 容器',
        technology: 'TypeScript',
        tags: ['core'],
        sourceTags: ['workspace-index'],
        evidence: [],
        metadata: { tech: 'TypeScript' },
      },
      {
        id: 'comp-x',
        name: 'component-x',
        kind: 'component' as const,
        description: 'x',
        technology: 'TypeScript',
        tags: [],
        sourceTags: ['workspace-index'],
        evidence: [],
        metadata: {},
      },
    ],
    relationships: [
      {
        id: 'rel-1',
        sourceId: 'specs/alpha.spec.md',
        destinationId: 'comp-x',
        kind: 'contains',
        description: '强方向关系',
        tags: [],
        sourceTags: ['workspace-index'],
        evidence: [],
        metadata: {},
      },
    ],
    views: [],
    stats: {
      totalElements: 2,
      totalRelationships: 1,
      totalViews: 0,
      availableViews: 0,
      totalWarnings: 0,
      sourceCount: 1,
    },
    metadata: {},
  };

  const crossReferenceLinks = [
    {
      label: '→ specs/beta.spec.md',
      href: 'specs/beta.spec.md#module-spec',
      targetSpecPath: 'specs/beta.spec.md',
      targetSourceTarget: 'specs/alpha.spec.md',
      kind: 'cross-module',
      direction: 'outbound' as const,
      evidenceCount: 1,
      summary: '出站 1 条证据',
    },
  ];

  const extractionResults = [
    {
      nodes: [
        {
          id: 'engine.py::Value',
          kind: 'symbol',
          label: 'Value',
          source_file: 'engine.py',
          confidence: 'high' as const,
          metadata: { lang: 'python' },
        },
        // 同 ID 覆盖 architectureIR 的 comp-x，触发 metadata 合并
        {
          id: 'comp-x',
          kind: 'component',
          label: 'component-x',
          source_file: 'src/x.ts',
          confidence: 'medium' as const,
          metadata: { extra: 'from-extraction' },
        },
      ],
      edges: [
        {
          source: 'engine.py::Value',
          target: 'comp-x',
          relation: 'references',
          confidence: 'EXTRACTED' as const,
        },
        // 悬空边（target 不存在）→ 应被步骤 4 过滤
        {
          source: 'engine.py::Value',
          target: 'missing-node',
          relation: 'references',
          confidence: 'AMBIGUOUS' as const,
        },
      ],
    },
  ];

  const unifiedGraph = {
    nodes: [
      { id: 'engine.py::Value', kind: 'symbol', label: 'Value', metadata: { callSitesCount: 3 } },
      { id: 'engine.py::Mul', kind: 'symbol', label: 'Mul', filePath: 'engine.py' },
    ],
    edges: [
      // directional calls 边
      { source: 'engine.py::Value', target: 'engine.py::Mul', relation: 'calls', confidence: 'high' as const, evidence: 'Value() 调用 Mul()' },
      // 对称关系，directional 缺省按 relation 判定（references 非 directional）
      { source: 'engine.py::Mul', target: 'comp-x', relation: 'references', confidence: 'medium' as const },
    ],
  };

  return { directed, docGraph, architectureIR, crossReferenceLinks, extractionResults, unifiedGraph };
}

function serializeStable(options: BuildGraphOptions): string {
  const graph = buildKnowledgeGraph(options);
  normalizeGraphForWrite(graph, { stripTimestamps: true });
  return JSON.stringify(graph, null, 2);
}

describe('buildKnowledgeGraph — byte-stable 回归（Feature 178）', () => {
  it('无向图：五路合并产物逐字节稳定', () => {
    expect(serializeStable(makeFiveSourceOptions(false))).toMatchSnapshot();
  });

  it('有向图：五路合并产物逐字节稳定', () => {
    expect(serializeStable(makeFiveSourceOptions(true))).toMatchSnapshot();
  });
});
