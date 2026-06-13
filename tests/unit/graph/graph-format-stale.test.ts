/**
 * Feature 193 T015 — 加载期 graph-format-stale 检测（决策 1c / FR-006）。
 *
 * 验证 GraphQueryEngine.fromJSON 在传入 projectRoot 时：
 *   - 相对 id 图 → 正常加载
 *   - 含非当前 projectRoot 前缀的绝对 id 图（旧 copy 自主仓）→ 抛 graph-format-stale
 *   - external 节点（绝对 + external 标记）→ 不误判
 *   - 全量扫描（违例节点在末尾也能命中，不抽样）
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GraphQueryEngine,
  assertGraphFormatNotStale,
} from '../../../src/panoramic/graph/graph-query.js';
import type { GraphJSON, GraphNode } from '../../../src/panoramic/graph/graph-types.js';
import { handleImpact } from '../../../src/mcp/agent-context-tools.js';
import { reloadGraph } from '../../../src/mcp/graph-tools.js';

function mkGraph(nodes: GraphNode[]): GraphJSON {
  return { directed: false, multigraph: false, graph: { name: 'spectra-knowledge-graph', generatedAt: '', nodeCount: nodes.length, edgeCount: 0, sources: [], schemaVersion: '2.0' }, nodes, links: [] };
}

const ROOT = '/Users/dev/worktree-current';

describe('Feature 193 T015 — graph-format-stale 加载期检测', () => {
  it('相对 id 图 → 正常加载，不抛', () => {
    const graph = mkGraph([
      { id: 'src/a.ts', kind: 'module', label: 'a.ts', metadata: {} },
      { id: 'src/a.ts::Foo', kind: 'component', label: 'Foo', metadata: {} },
    ]);
    expect(() => GraphQueryEngine.fromJSON(graph, ROOT)).not.toThrow();
  });

  it('含非当前 projectRoot 前缀的绝对 id（copy 自主仓）→ 抛 graph-format-stale', () => {
    const graph = mkGraph([
      { id: '/Users/dev/main-repo/src/a.ts::Foo', kind: 'component', label: 'Foo', metadata: {} },
    ]);
    expect(() => GraphQueryEngine.fromJSON(graph, ROOT)).toThrow(/graph-format-stale/);
  });

  it('全量扫描：违例节点在末尾也能命中（不抽样）', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 50; i += 1) {
      nodes.push({ id: `src/relative-${i}.ts`, kind: 'module', label: `r${i}`, metadata: {} });
    }
    // 末尾才放一个绝对违例节点
    nodes.push({ id: '/Users/dev/main-repo/src/leak.ts', kind: 'module', label: 'leak', metadata: {} });
    expect(() => assertGraphFormatNotStale(mkGraph(nodes), ROOT)).toThrow(/graph-format-stale/);
  });

  it('external 节点（绝对 + external 标记）→ 不误判为 stale（FR-004）', () => {
    const graph = mkGraph([
      { id: 'src/a.ts', kind: 'module', label: 'a.ts', metadata: {} },
      { id: '/Users/dev/node_modules/zod/index.ts', kind: 'module', label: 'zod', metadata: { external: true } },
    ]);
    expect(() => assertGraphFormatNotStale(graph, ROOT)).not.toThrow();
  });

  it('当前 projectRoot 前缀的绝对 id → 不抛（同 worktree 罕见绝对形态视为合法）', () => {
    const graph = mkGraph([
      { id: `${ROOT}/src/a.ts`, kind: 'module', label: 'a.ts', metadata: {} },
    ]);
    expect(() => assertGraphFormatNotStale(graph, ROOT)).not.toThrow();
  });

  it('未传 projectRoot → 跳过 stale 检测（向后兼容）', () => {
    const graph = mkGraph([
      { id: '/Users/dev/main-repo/src/a.ts', kind: 'module', label: 'a.ts', metadata: {} },
    ]);
    expect(() => GraphQueryEngine.fromJSON(graph)).not.toThrow();
  });
});

describe('Feature 193 FR-006 — MCP 工具对旧绝对图返回 graph-format-stale（不静默 graph-not-built）', () => {
  let tmpRoot: string;
  afterEach(() => {
    reloadGraph();
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('impact 在旧绝对格式图上 → error code=graph-format-stale + 重建指引', async () => {
    reloadGraph();
    tmpRoot = mkdtempSync(join(tmpdir(), 'f193-stale-mcp-'));
    mkdirSync(join(tmpRoot, 'specs', '_meta'), { recursive: true });
    // 写一个旧绝对格式图（id 前缀非 tmpRoot）
    const staleGraph = mkGraph([
      { id: '/Users/dev/main-repo/src/engine.ts::Value', kind: 'component', label: 'Value', metadata: {} },
    ]);
    writeFileSync(join(tmpRoot, 'specs', '_meta', 'graph.json'), JSON.stringify(staleGraph), 'utf-8');

    const r = await handleImpact({ target: 'src/engine.ts::Value', projectRoot: tmpRoot });
    expect(r.isError).toBe(true);
    const data = JSON.parse(r.content[0]!.text) as { code?: string; hint?: string };
    expect(data.code).toBe('graph-format-stale');
    expect(data.hint).toMatch(/重建|spectra index|spectra batch/);
  });
});
