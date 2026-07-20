/**
 * Feature 214 T032（=plan T9）— MCP 四工具分层查询合同 E2E（SC-004, FR-009, NFR-005）。
 *
 * SC-004 断言矩阵：
 * (a) impact/context：同 symbol canonical 绝对/相对 ID 返回一致；legacy `#` 经 fuzzy best-effort
 *     兜底命中同一 canonical 节点（非阻断）。
 * (b) graph_node：canonical symbol ID → symbol 节点、相对路径 module ID → module 节点，
 *     邻居含 contains；legacy `#` 对 graph_node 不承诺命中。
 * (c) graph_path：symbol↔symbol / module↔module 端点组合精确匹配，路径 ID 均为 canonical。
 *
 * 【W3】不许静默 skip：测试开头断言 dist/cli/index.js 与 baseline fixture 存在，缺失=fail。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawnMcpClient,
  installRelativizedBaseline,
  DIST_CLI,
  BASELINE_GRAPH,
  type McpClientHandle,
} from './helpers/stdio-client.js';

// W3：前置资源缺失即 fail（不走 skip 分支），确保 SC-004 矩阵真实执行
if (!existsSync(DIST_CLI)) {
  throw new Error(`Feature 214 T032: dist/cli/index.js 不存在（先 npm run build）：${DIST_CLI}`);
}
if (!existsSync(BASELINE_GRAPH)) {
  throw new Error(
    `Feature 214 T032: micrograd baseline fixture 不存在（先 npm run baseline:collect -- --target karpathy/micrograd --mode full）：${BASELINE_GRAPH}`,
  );
}

const SYM_MLP = 'micrograd/nn.py::MLP';
const SYM_VALUE = 'micrograd/engine.py::Value';
const MOD_NN = 'micrograd/nn.py';
const MOD_ENGINE = 'micrograd/engine.py';
const LEGACY_MLP = 'micrograd/nn.py#MLP';

interface ContextResp {
  code?: string;
  definition?: { id?: string };
  callees?: unknown[];
  imports?: unknown[];
  resolvedTo?: string;
  warnings?: string[];
}
interface ImpactResp {
  code?: string;
  affected?: Array<{ id?: string; symbol?: string } | string>;
  resolvedTo?: string;
}
interface NodeResp {
  code?: string;
  node?: { id?: string; kind?: string };
  neighbors?: Array<{ node?: { id?: string }; edge?: { relation?: string } }>;
}
interface PathResp {
  code?: string;
  path?: Array<{ id: string }> | null;
  edges?: Array<{ source: string; target: string; relation: string }>;
  message?: string;
}

function parse<T>(result: Awaited<ReturnType<McpClientHandle['client']['callTool']>>): T {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]?.text ?? '{}') as T;
}

/** 提取 affected 集合的稳定 id key（兼容 string / {id} / {symbol}） */
function affectedIds(affected: ImpactResp['affected']): Set<string> {
  return new Set(
    (affected ?? []).map((a) => (typeof a === 'string' ? a : a.id ?? a.symbol ?? JSON.stringify(a))),
  );
}
function setEq(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

describe('Feature 214 T032 — MCP 四工具分层查询合同（SC-004）', () => {
  let handle: McpClientHandle;
  let tempRoot: string;

  beforeAll(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'f214-mcp-layered-'));
    mkdirSync(join(tempRoot, 'specs', '_meta'), { recursive: true });
    installRelativizedBaseline(join(tempRoot, 'specs', '_meta', 'graph.json'));
    handle = await spawnMcpClient({ cwd: tempRoot });
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  });

  // ───────────── (a) impact/context ─────────────

  it('SC-004(a): context 相对 canonical ID 精确命中 symbol 节点', async () => {
    const r = await handle.client.callTool({ name: 'context', arguments: { symbolId: SYM_MLP, projectRoot: tempRoot } });
    expect(r.isError).not.toBe(true);
    const data = parse<ContextResp>(r);
    expect(data.code).toBeUndefined();
    expect(data.definition?.id).toBe(SYM_MLP);
  }, 20_000);

  it('SC-004(a): impact 相对 canonical ID 精确命中并返回 affected', async () => {
    const r = await handle.client.callTool({ name: 'impact', arguments: { target: SYM_VALUE, projectRoot: tempRoot } });
    expect(r.isError).not.toBe(true);
    const data = parse<ImpactResp>(r);
    expect(data.code).toBeUndefined();
    expect(Array.isArray(data.affected)).toBe(true);
  }, 20_000);

  // W-2：绝对路径 canonical ID 与相对 ID 输入应返回一致结果集（归一化后比较）
  it('SC-004(a) W-2: context 绝对路径 canonical ID 与相对 ID 命中同一节点', async () => {
    const absId = `${join(tempRoot, 'micrograd/nn.py')}::MLP`;
    const relR = parse<ContextResp>(await handle.client.callTool({ name: 'context', arguments: { symbolId: SYM_MLP, projectRoot: tempRoot } }));
    const absR = parse<ContextResp>(await handle.client.callTool({ name: 'context', arguments: { symbolId: absId, projectRoot: tempRoot } }));
    expect(relR.definition?.id).toBe(SYM_MLP);
    expect(absR.definition?.id).toBe(SYM_MLP); // 绝对输入归一化到同一相对 canonical 节点
  }, 20_000);

  it('SC-004(a) W-2: impact 绝对路径 canonical ID 与相对 ID 返回相等的 affected 集合', async () => {
    const absId = `${join(tempRoot, 'micrograd/engine.py')}::Value`;
    const relR = parse<ImpactResp>(await handle.client.callTool({ name: 'impact', arguments: { target: SYM_VALUE, projectRoot: tempRoot } }));
    const absR = parse<ImpactResp>(await handle.client.callTool({ name: 'impact', arguments: { target: absId, projectRoot: tempRoot } }));
    const relSet = affectedIds(relR.affected);
    const absSet = affectedIds(absR.affected);
    expect(relSet.size).toBeGreaterThan(0);
    expect(setEq(absSet, relSet), `abs=${[...absSet]} rel=${[...relSet]}`).toBe(true);
  }, 20_000);

  it('SC-004(a): context 对 legacy `#` 格式经 fuzzy best-effort 兜底命中 canonical 节点（非阻断）', async () => {
    const r = await handle.client.callTool({ name: 'context', arguments: { symbolId: LEGACY_MLP, projectRoot: tempRoot } });
    const data = parse<ContextResp>(r);
    // best-effort：允许兜底命中同一 canonical 节点，或返回 symbol-not-found（非阻断，二者均合法）
    if (data.code === undefined) {
      // 兜底成功 → 必须解析到 canonical :: 节点，不得指向 legacy `#`
      const hit = data.resolvedTo ?? data.definition?.id;
      expect(hit).toBe(SYM_MLP);
    } else {
      expect(data.code).toBe('symbol-not-found');
    }
  }, 20_000);

  // ───────────── (b) graph_node ─────────────

  it('SC-004(b): graph_node canonical symbol ID → symbol(component) 节点，邻居含 contains', async () => {
    const r = await handle.client.callTool({ name: 'graph_node', arguments: { id: SYM_MLP, projectRoot: tempRoot } });
    expect(r.isError).not.toBe(true);
    const data = parse<NodeResp>(r);
    expect(data.node?.id).toBe(SYM_MLP);
    expect(data.node?.kind).toBe('component');
    // 邻居含 contains 边（class→member 层级遍历能力，US1）
    const hasContains = (data.neighbors ?? []).some((n) => n.edge?.relation === 'contains');
    expect(hasContains).toBe(true);
  }, 20_000);

  it('SC-004(b): graph_node 相对路径 module ID → module 节点，邻居含 contains（module→symbol）', async () => {
    const r = await handle.client.callTool({ name: 'graph_node', arguments: { id: MOD_NN, projectRoot: tempRoot } });
    expect(r.isError).not.toBe(true);
    const data = parse<NodeResp>(r);
    expect(data.node?.id).toBe(MOD_NN);
    expect(data.node?.kind).toBe('module');
    const hasContains = (data.neighbors ?? []).some((n) => n.edge?.relation === 'contains');
    expect(hasContains).toBe(true);
  }, 20_000);

  it('SC-004(b): graph_node 对 legacy `#` symbol ID 不承诺精确命中（精确匹配设计）', async () => {
    const r = await handle.client.callTool({ name: 'graph_node', arguments: { id: LEGACY_MLP, projectRoot: tempRoot } });
    const data = parse<NodeResp>(r);
    // 精确 nodeMap 匹配：legacy `#` id 不在图中 → 不命中 canonical 节点（node 为空或非 canonical MLP）
    expect(data.node?.id).not.toBe(SYM_MLP);
  }, 20_000);

  // ───────────── (c) graph_path ─────────────

  // W-2：每种合法端点组合断言路径**非空** + 首尾端点正确 + 途经 ID 均 canonical（禁"是数组就过"）
  /** 断言 graph_path 返回非空路径，首尾正确，途经节点/边 ID 均 canonical */
  function assertCanonicalPath(data: PathResp, source: string, target: string): void {
    const path = data.path ?? [];
    expect(path.length, `path 应非空 (${source}→${target})`).toBeGreaterThan(0);
    expect(path[0]!.id).toBe(source);
    expect(path[path.length - 1]!.id).toBe(target);
    for (const n of path) expect(n.id.includes('#'), `途经节点非 canonical: ${n.id}`).toBe(false);
    for (const e of data.edges ?? []) {
      expect(e.source.includes('#'), `途经边 source 非 canonical: ${e.source}`).toBe(false);
      expect(e.target.includes('#'), `途经边 target 非 canonical: ${e.target}`).toBe(false);
    }
  }

  it('SC-004(c): graph_path symbol↔symbol（MLP→Value）→ 路径非空、首尾正确、途经 ID 均 canonical', async () => {
    const r = await handle.client.callTool({ name: 'graph_path', arguments: { source: SYM_MLP, target: SYM_VALUE, projectRoot: tempRoot } });
    expect(r.isError).not.toBe(true);
    assertCanonicalPath(parse<PathResp>(r), SYM_MLP, SYM_VALUE);
  }, 20_000);

  it('SC-004(c): graph_path module↔module（nn.py→engine.py）→ 路径非空、首尾正确、途经 ID 均 canonical', async () => {
    const r = await handle.client.callTool({ name: 'graph_path', arguments: { source: MOD_NN, target: MOD_ENGINE, projectRoot: tempRoot } });
    expect(r.isError).not.toBe(true);
    assertCanonicalPath(parse<PathResp>(r), MOD_NN, MOD_ENGINE);
  }, 20_000);

  it('SC-004(c): graph_path symbol↔symbol（MLP→Layer 类内层级）→ 路径非空、首尾正确、canonical', async () => {
    const r = await handle.client.callTool({ name: 'graph_path', arguments: { source: SYM_MLP, target: 'micrograd/nn.py::Layer', projectRoot: tempRoot } });
    expect(r.isError).not.toBe(true);
    assertCanonicalPath(parse<PathResp>(r), SYM_MLP, 'micrograd/nn.py::Layer');
  }, 20_000);
});
