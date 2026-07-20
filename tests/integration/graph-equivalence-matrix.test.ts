/**
 * Feature 214 T026 / W-3（真实双入口重构）— graph-only vs full 等价矩阵 + SC-001 dup oracle
 * （SC-001, SC-003, FR-004, FR-007, FR-011, US3）。
 *
 * 真实双入口（磁盘 fixture 项目 tests/fixtures/f214-mixed，含 TS 两 class 同名 member + Python class + 顶层函数）：
 *  (a) graph-only：真实 `buildAstGraphOnly`（collect→buildUnifiedGraph→extractSymbolNodes→buildKnowledgeGraph→写盘）
 *  (b) full 组装：同一 collect 的 skeletons + extraction + 全部 full-only source（doc-graph/architecture-ir）注入 buildKnowledgeGraph→写盘
 * 再比较持久化 GraphJSON 的共同子图（module/symbol/member 节点 + calls/depends-on/contains 边）。
 *
 * dup oracle【W5+W7】：语义 key = 相对路径 + qualified symbol path（含 class 前缀）+ kind，双分隔符归一化；
 * duplicate-pair count = 0；负例：同文件不同 class 的同名 member（A.render/B.render）不判重复。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildAstGraphOnly,
  collectPythonCodeSkeletons,
  collectTsJsCodeSkeletons,
} from '../../src/batch/batch-orchestrator.js';
import { buildUnifiedGraph } from '../../src/knowledge-graph/index.js';
import { buildKnowledgeGraph, writeKnowledgeGraph } from '../../src/panoramic/graph/graph-builder.js';
import { PythonLanguageAdapter } from '../../src/adapters/python-adapter.js';
import type { GraphJSON, GraphNode, BuildGraphOptions } from '../../src/panoramic/graph/graph-types.js';
import type { DocGraph } from '../../src/panoramic/builders/doc-graph-builder.js';
import type { ArchitectureIR } from '../../src/panoramic/models/architecture-ir-model.js';

const FIXTURE_ROOT = resolve('tests/fixtures/f214-mixed');

const COMMON_EDGE_RELATIONS = new Set(['calls', 'depends-on', 'contains']);

function isCommonNode(n: GraphNode): boolean {
  const tag = n.metadata?.['sourceTag'];
  return tag === 'unified-graph' || tag === 'extraction';
}
function commonNodeIds(gj: GraphJSON): Set<string> {
  return new Set(gj.nodes.filter(isCommonNode).map((n) => n.id));
}
function commonEdgeKeys(gj: GraphJSON): Set<string> {
  return new Set(
    gj.links
      .filter((l) => COMMON_EDGE_RELATIONS.has(l.relation))
      .map((l) => `${l.source}|${l.target}|${l.relation}`),
  );
}

/** 双分隔符归一语义 key（W5）：file + qualified-symbol-path + kind */
function semanticKey(id: string, kind: string): string {
  const iColon = id.indexOf('::');
  const iHash = id.indexOf('#');
  const cuts = [iColon, iHash].filter((i) => i >= 0);
  if (cuts.length === 0) return `${id}␟␟${kind}`;
  const first = Math.min(...cuts);
  const file = id.slice(0, first);
  const sym = id.slice(first).replace(/^(::|#)/, '');
  return `${file}␟${sym}␟${kind}`;
}
function duplicatePairCount(gj: GraphJSON): { count: number; pairs: string[] } {
  const byKey = new Map<string, Set<string>>();
  for (const n of gj.nodes) {
    const key = semanticKey(n.id, n.kind);
    const set = byKey.get(key) ?? new Set<string>();
    set.add(n.id);
    byKey.set(key, set);
  }
  let count = 0;
  const pairs: string[] = [];
  for (const [key, ids] of byKey) {
    if (ids.size > 1) {
      count += ids.size - 1;
      pairs.push(`${key} => {${[...ids].join(', ')}}`);
    }
  }
  return { count, pairs };
}

function fullOnlySources(): Pick<BuildGraphOptions, 'docGraph' | 'architectureIR'> {
  const docGraph: DocGraph = {
    projectRoot: FIXTURE_ROOT,
    generatedAt: '2026-07-20T00:00:00.000Z',
    specs: [{ specPath: 'specs/ui.spec.md', sourceTarget: 'src/ui', relatedFiles: [], linked: true, confidence: 'medium', currentRun: true }],
    sourceToSpec: [],
    references: [],
    missingSpecs: [],
    unlinkedSpecs: [],
  };
  const architectureIR: ArchitectureIR = {
    projectName: 'f214-mixed',
    generatedAt: '2026-07-20T00:00:00.000Z',
    sourceTags: ['workspace-index'],
    warnings: [],
    elements: [{ id: 'arch/ui', name: 'UI', kind: 'component', description: '', technology: 'TS', tags: [], sourceTags: ['workspace-index'], evidence: [], metadata: {} }],
    relationships: [],
    views: [],
    stats: { totalElements: 1, totalRelationships: 0, totalViews: 0, availableViews: 0, totalWarnings: 0, sourceCount: 1 },
    metadata: {},
  };
  return { docGraph, architectureIR };
}

describe('Feature 214 T026 — graph-only vs full 真实双入口等价矩阵（FR-007, US3）', () => {
  let tmpA: string;
  let tmpB: string;
  let graphOnly: GraphJSON;
  let full: GraphJSON;

  beforeAll(async () => {
    tmpA = mkdtempSync(join(tmpdir(), 'f214-eqv-go-'));
    tmpB = mkdtempSync(join(tmpdir(), 'f214-eqv-full-'));
    mkdirSync(join(tmpB, '_meta'), { recursive: true });

    // (a) 真实 graph-only 入口
    const goResult = await buildAstGraphOnly(FIXTURE_ROOT, { outputDir: tmpA });
    graphOnly = JSON.parse(readFileSync(goResult.graphPath, 'utf-8')) as GraphJSON;

    // (b) full 组装入口：同一 collect 的 skeletons + extraction + full-only source
    const pySk = await collectPythonCodeSkeletons(FIXTURE_ROOT);
    const tsSk = await collectTsJsCodeSkeletons(FIXTURE_ROOT, { extractCallSites: true });
    const codeSkeletons = new Map([...pySk, ...tsSk]);
    const unifiedGraph = buildUnifiedGraph({ projectRoot: FIXTURE_ROOT, codeSkeletons });
    const extractionResults = await new PythonLanguageAdapter().extractSymbolNodes(FIXTURE_ROOT);
    const fullGj = buildKnowledgeGraph({ unifiedGraph, extractionResults, ...fullOnlySources() });
    const fullPath = writeKnowledgeGraph(fullGj, tmpB, { stripTimestamps: true });
    full = JSON.parse(readFileSync(fullPath, 'utf-8')) as GraphJSON;
  }, 60_000);

  afterAll(() => {
    if (tmpA) rmSync(tmpA, { recursive: true, force: true });
    if (tmpB) rmSync(tmpB, { recursive: true, force: true });
  });

  it('两路共同子图节点/边/ID 集合完全相等；差异仅来自 full-only 源', () => {
    expect(commonNodeIds(full)).toEqual(commonNodeIds(graphOnly));
    expect(commonEdgeKeys(full)).toEqual(commonEdgeKeys(graphOnly));
    // full 额外节点全部归因到 full-only 源
    const extraNodes = full.nodes.filter((n) => !commonNodeIds(graphOnly).has(n.id) && !isCommonNode(n));
    for (const n of extraNodes) {
      expect(['doc-graph', 'architecture-ir', 'cross-reference']).toContain(n.metadata?.['sourceTag']);
    }
    expect(extraNodes.length).toBeGreaterThan(0);
  });

  it('graph-only 含 contains 两级（TS module→class→member + Python class→member）', () => {
    const containsPairs = graphOnly.links
      .filter((l) => l.relation === 'contains')
      .map((l) => `${l.source}=>${l.target}`);
    // TS 两级
    expect(containsPairs.some((p) => p === 'src/ui.ts=>src/ui.ts::A')).toBe(true);
    expect(containsPairs.some((p) => p === 'src/ui.ts::A=>src/ui.ts::A.render')).toBe(true);
    // Python class→member
    expect(containsPairs.some((p) => p.endsWith('pkg/model.py::Model.forward'))).toBe(true);
  });

  it('SC-001 dup oracle：graph-only 图 duplicate-pair count = 0', () => {
    const dup = duplicatePairCount(graphOnly);
    expect(dup.count, `重复对: ${dup.pairs.join(' | ')}`).toBe(0);
  });

  it('负例：同文件不同 class 的同名 member（A.render / B.render）不判为重复', () => {
    expect(graphOnly.nodes.some((n) => n.id === 'src/ui.ts::A.render')).toBe(true);
    expect(graphOnly.nodes.some((n) => n.id === 'src/ui.ts::B.render')).toBe(true);
    expect(semanticKey('src/ui.ts::A.render', 'component')).not.toEqual(semanticKey('src/ui.ts::B.render', 'component'));
  });

  it('dup oracle 反向自检：构造 #/:: 成对节点时能被检出', () => {
    const poisoned: GraphJSON = {
      directed: false,
      multigraph: false,
      graph: { name: 'x', generatedAt: '', nodeCount: 2, edgeCount: 0, sources: [], schemaVersion: '2.0' },
      nodes: [
        { id: 'a.py::foo', kind: 'component', label: 'foo', metadata: {} },
        { id: 'a.py#foo', kind: 'component', label: 'foo', metadata: {} },
      ],
      links: [],
    };
    expect(duplicatePairCount(poisoned).count).toBe(1);
  });
});
