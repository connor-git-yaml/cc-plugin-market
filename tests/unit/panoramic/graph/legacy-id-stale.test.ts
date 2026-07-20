/**
 * Feature 214 T017（=plan T5）— legacy `#` symbol id 内容级 stale 检测（FR-008, NFR-001, R-3）
 *
 * 【C2 正向谓词】assertGraphFormatNotStale 须识别 legacy `#` **symbol** 节点为 stale，
 * 但 MUST NOT 对 kind='module' 的 doc-anchor `#` 节点或 api-surface `#` 节点误报。
 *
 * RED：T020 实现 isLegacySymbolNode 前，assertGraphFormatNotStale 只查绝对路径，
 * 不识别 `#` symbol → 正例不抛（断言失败可收集）。
 * wrapper 3.0 嗅探：T019 bump 前 2.0 快照不判 stale → 断言失败可收集。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertGraphFormatNotStale } from '../../../../src/panoramic/graph/graph-query.js';
import type { GraphJSON, GraphNode } from '../../../../src/panoramic/graph/graph-types.js';
import { loadSnapshotDetailed } from '../../../../src/knowledge-graph/persistence.js';

const ROOT = '/Users/dev/worktree-current';

function mkGraph(nodes: GraphNode[]): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '',
      nodeCount: nodes.length,
      edgeCount: 0,
      sources: [],
      schemaVersion: '2.0',
    },
    nodes,
    links: [],
  };
}

describe('Feature 214 FR-008 — legacy `#` symbol 节点触发 graph-format-stale', () => {
  it('正例 A：`#` 节点 metadata.unifiedKind=symbol → 抛 graph-format-stale', () => {
    const graph = mkGraph([
      { id: 'src/a.ts', kind: 'module', label: 'a', metadata: {} },
      {
        id: 'src/a.py#Value',
        kind: 'component',
        label: 'Value',
        metadata: { unifiedKind: 'symbol', sourceTag: 'unified-graph' },
      },
    ]);
    expect(() => assertGraphFormatNotStale(graph, ROOT)).toThrow(/graph-format-stale/);
  });

  it('正例 B：`#` 节点 sourceTag=extraction + Python provenance(.py) → 抛 graph-format-stale', () => {
    const graph = mkGraph([
      {
        id: 'micrograd/engine.py#Value',
        kind: 'component',
        label: 'Value',
        metadata: { sourceTag: 'extraction' },
      },
    ]);
    expect(() => assertGraphFormatNotStale(graph, ROOT)).toThrow(/graph-format-stale/);
  });

  it('负例 A：kind=module 的 doc-anchor `#` 节点（无 symbol provenance）→ 不误报', () => {
    // design-doc-anchoring.test.ts:44 的合法节点形态
    const graph = mkGraph([
      { id: 'src/pipeline.ts', kind: 'module', label: 'runPipeline', metadata: {} },
      { id: 'src/pipeline.ts#withRetry', kind: 'module', label: 'withRetry', metadata: {} },
    ]);
    expect(() => assertGraphFormatNotStale(graph, ROOT)).not.toThrow();
  });

  it('负例 B：api-surface `#` 节点（kind=api，非 symbol 语义）→ 不误报', () => {
    const graph = mkGraph([
      {
        id: 'src/routes.py#get_users',
        kind: 'api',
        label: 'GET /users',
        metadata: { sourceTag: 'api-surface' },
      },
    ]);
    expect(() => assertGraphFormatNotStale(graph, ROOT)).not.toThrow();
  });

  it('负例 C：canonical `::` symbol 节点（新格式）→ 不抛', () => {
    const graph = mkGraph([
      { id: 'src/a.ts', kind: 'module', label: 'a', metadata: {} },
      {
        id: 'src/a.py::Value',
        kind: 'component',
        label: 'Value',
        metadata: { unifiedKind: 'symbol', sourceTag: 'unified-graph' },
      },
    ]);
    expect(() => assertGraphFormatNotStale(graph, ROOT)).not.toThrow();
  });

  // W-5 边界：文件名本身含 `#`
  it('W-5 边界 A：`src/a#b.py::Foo`（canonical :: + 文件名含 #）unifiedKind=symbol → 不误报', () => {
    const graph = mkGraph([
      { id: 'src/a#b.py::Foo', kind: 'component', label: 'Foo', metadata: { unifiedKind: 'symbol', sourceTag: 'unified-graph' } },
    ]);
    expect(() => assertGraphFormatNotStale(graph, ROOT)).not.toThrow();
  });

  it('W-5 边界 B：`src/a#b.py#Foo`（无 ::，文件名含 #）extraction → 正确识别为 legacy（最后一个 # 切分）', () => {
    const graph = mkGraph([
      { id: 'src/a#b.py#Foo', kind: 'component', label: 'Foo', metadata: { sourceTag: 'extraction' } },
    ]);
    expect(() => assertGraphFormatNotStale(graph, ROOT)).toThrow(/graph-format-stale/);
  });
});

describe('Feature 214 FR-010 — wrapper 3.0 嗅探旧 2.0 快照 → format-stale', () => {
  let tmpRoot: string;
  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('schemaVersion=2.0 的旧快照被 3.0 loader 判为 format-stale（触发全量重建）', async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'f214-wrapper-stale-'));
    mkdirSync(join(tmpRoot, '.spectra'), { recursive: true });
    // 旧 2.0 wrapper（sniff 在 schema parse 之前，内嵌 graph 可最小化）
    const oldWrapper = {
      schemaVersion: '2.0',
      generatedAt: '2026-07-20T10:00:00.000Z',
      graph: { nodes: [], edges: [], metadata: {} },
      fileHashes: {},
    };
    writeFileSync(
      join(tmpRoot, '.spectra', 'unified-graph.json'),
      JSON.stringify(oldWrapper),
      'utf-8',
    );
    const { snapshot, reason } = await loadSnapshotDetailed(tmpRoot);
    expect(snapshot).toBeNull();
    expect(reason).toBe('format-stale');
  });
});
