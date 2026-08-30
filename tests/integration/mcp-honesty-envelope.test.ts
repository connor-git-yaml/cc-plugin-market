/**
 * F266 T016 — MCP envelope 集成测试（impact / context / detect_changes 的 `honesty` 追加面）。
 *
 * 与 `tests/unit/mcp-graph-honesty.test.ts` 的分工：单测打判定函数，本文件打**整条链**——
 * 真实 graph.json 落盘 → `getCachedGraphData` → handler → envelope，验证四种图状态与组合态
 * 在返回体上**可判读且互不混淆**（SC-001）。
 *
 * 只有 git 探测被 stub（`evaluateFreshness`）：freshness 四态无法靠临时目录稳定构造，
 * 而 F249 已对该判定器本身有完整用例，这里要验的是"四态如何呈现在 envelope 上"。
 * detect_changes 的 `baseRef` 用例用**真实 git 仓库**跑，因为 `gitRange` 字面量正是要验的东西。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { GraphJSON, GraphNode, GraphEdge } from '../../src/panoramic/graph/graph-types.js';
import type { GraphFreshnessVerdict } from '../../src/panoramic/graph/quality/quality-types.js';

// ─── 只 stub git 探测：freshness 四态由本文件驱动 ───
const mocks = vi.hoisted(() => ({
  evaluateFreshness: vi.fn(),
}));

vi.mock('../../src/panoramic/graph/source-commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/panoramic/graph/source-commit.js')>(
    '../../src/panoramic/graph/source-commit.js',
  );
  return { ...actual, evaluateFreshness: mocks.evaluateFreshness };
});

import { handleImpact, handleContext, handleDetectChanges } from '../../src/mcp/agent-context-tools.js';
import { reloadGraph } from '../../src/mcp/graph-tools.js';
import { __resetHonestyCache } from '../../src/mcp/lib/graph-honesty.js';
import { clearReverseAdjacencyCache } from '../../src/knowledge-graph/query-helpers.js';

// ─────────────────────────────────────────────────────────────
// fixture
// ─────────────────────────────────────────────────────────────

const FRESH: GraphFreshnessVerdict = { state: 'fresh', recordedSourceCommit: 'a'.repeat(40), currentHead: 'a'.repeat(40) };
const STALE: GraphFreshnessVerdict = {
  state: 'stale',
  recordedSourceCommit: 'a'.repeat(40),
  currentHead: 'b'.repeat(40),
  staleReasons: ['source-commit', 'collector-fingerprint'],
};
const DIRTY: GraphFreshnessVerdict = {
  state: 'dirty',
  recordedSourceCommit: 'a'.repeat(40),
  currentHead: 'a'.repeat(40),
  dirtyFiles: ['src/x.ts'],
};

function node(id: string, metadata: Record<string, unknown> = {}): GraphNode {
  return { id, kind: 'component', label: id.split('::').pop() ?? id, metadata };
}

function moduleNode(id: string, callSitesCount?: number): GraphNode {
  return {
    id,
    kind: 'module',
    label: id,
    metadata: { sourcePath: id, ...(callSitesCount === undefined ? {} : { callSitesCount }) },
  };
}

function edge(source: string, target: string, relation: string): GraphEdge {
  return { source, target, relation, confidence: 'EXTRACTED', confidenceScore: 1, directional: true };
}

interface ScenarioOptions {
  /**
   * 图内已探测到的调用点总数。默认 1 —— 与图里唯一那条 calls 边相等，即"记账在场且全部成边"，
   * 这是 `confirmed-zero` 所要求的正向证据（对抗审查 A4）。给更大的值即造出缺口。
   */
  callSitesCount?: number;
  /** true = 完全不写 callSitesCount 字段，模拟"图内无任何调用点记账"的无记账图 */
  omitCallSitesCount?: boolean;
  skippedSources?: Array<{ source: string; reason: string }>;
  /** 额外 symbol 节点（默认给一个导出 symbol + 一个非导出 symbol） */
  extraNodes?: GraphNode[];
  builder?: unknown;
}

/** 造一个可被 GraphQueryEngine 加载的最小真实图（全部 repo-relative id，满足 F193 portable 约束） */
function makeGraphJson(opts: ScenarioOptions = {}): GraphJSON {
  const nodes: GraphNode[] = [
    moduleNode('src/a.ts', opts.omitCallSitesCount === true ? undefined : (opts.callSitesCount ?? 1)),
    node('src/a.ts::exportedFn', { sourcePath: 'src/a.ts', exportKind: 'function' }),
    node('src/a.ts::privateHelper', { sourcePath: 'src/a.ts' }),
    // 零调用方 + 无导出面：context 的"零结果"用例靠它才有可判读的成因（privateHelper 有 caller）
    node('src/a.ts::orphanHelper', { sourcePath: 'src/a.ts' }),
    ...(opts.extraNodes ?? []),
  ];
  const links: GraphEdge[] = [
    edge('src/a.ts', 'src/a.ts::exportedFn', 'contains'),
    edge('src/a.ts', 'src/a.ts::privateHelper', 'contains'),
    edge('src/a.ts', 'src/a.ts::orphanHelper', 'contains'),
    edge('src/a.ts::exportedFn', 'src/a.ts::privateHelper', 'calls'),
  ];
  const meta: Record<string, unknown> = {
    name: 'spectra-knowledge-graph',
    generatedAt: '2026-08-30T00:00:00.000Z',
    nodeCount: nodes.length,
    edgeCount: links.length,
    sources: ['unified-graph'],
    schemaVersion: '2.0',
    sourceCommit: 'a'.repeat(40),
    builder: opts.builder ?? null,
  };
  if (opts.skippedSources !== undefined) meta['skippedSources'] = opts.skippedSources;
  return { directed: true, multigraph: false, graph: meta as unknown as GraphJSON['graph'], nodes, links };
}

/** 一条最小但**完整**的 unified diff（只有 `diff --git` 头会被当 mode-only 跳过，测不到落图与否） */
function unifiedDiffFor(file: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1 +1 @@',
    '-old',
    '+new',
    '',
  ].join('\n');
}

const tempRoots: string[] = [];

function writeProject(graph: GraphJSON): string {
  const root = mkdtempSync(path.join(tmpdir(), 'f266-honesty-'));
  tempRoots.push(root);
  mkdirSync(path.join(root, 'specs', '_meta'), { recursive: true });
  writeFileSync(path.join(root, 'specs', '_meta', 'graph.json'), JSON.stringify(graph), 'utf-8');
  return root;
}

interface Envelope {
  honesty?: {
    resolution?: { reason: string; evidenceScope: string; detail: string };
    resolutionOmitted?: { reason: string };
    coverage?: { separable: boolean; unlinkedCallSites: number; linkageRatio: number };
    freshness: { verdict: GraphFreshnessVerdict; builderMismatch: boolean | null; builderDetail: string | null };
    comparisonScope?: { notation: string; gitRange: string; includesUncommitted: boolean; uncommittedChangesPresent: boolean | null };
  };
  nextStepHint?: string;
  [key: string]: unknown;
}

function parseEnvelope(result: { isError?: true; content: Array<{ text: string }> }): Envelope {
  expect(result.isError, `期望成功响应，实际: ${result.content[0]?.text}`).toBeUndefined();
  return JSON.parse(result.content[0]!.text) as Envelope;
}

beforeEach(() => {
  mocks.evaluateFreshness.mockReset();
  mocks.evaluateFreshness.mockReturnValue(FRESH);
  __resetHonestyCache();
  reloadGraph();
  clearReverseAdjacencyCache();
});

afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// 四状态 + 组合态（SC-001）
// ─────────────────────────────────────────────────────────────

describe('F266 四状态在 envelope 上可判读', () => {
  it('状态1 新鲜完整图（记账全部成边）+ 无导出面 symbol → confirmed-zero + fresh', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(await handleImpact({ target: 'src/a.ts::orphanHelper', projectRoot: root }));
    expect((env['affected'] as unknown[]).length).toBe(0);
    expect(env.honesty?.resolution?.reason).toBe('confirmed-zero');
    expect(env.honesty?.freshness.verdict.state).toBe('fresh');
    expect(env.honesty?.coverage).toBeUndefined();
    expect(env.nextStepHint).toContain('可采信');
  });

  it('状态1 的反面：同一张图**无调用点记账**时 → coverage-gap（不许把"没测量"说成确证）', async () => {
    const root = writeProject(makeGraphJson({ omitCallSitesCount: true }));
    const env = parseEnvelope(await handleImpact({ target: 'src/a.ts::orphanHelper', projectRoot: root }));
    expect(env.honesty?.resolution?.reason).toBe('coverage-gap');
    expect(env.honesty?.resolution?.detail).toContain('没有任何调用点记账');
  });

  it('状态2 外部边界 → boundary-exposed（symbol 级证据）', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(await handleImpact({ target: 'src/a.ts::exportedFn', projectRoot: root }));
    expect(env.honesty?.resolution?.reason).toBe('boundary-exposed');
    expect(env.honesty?.resolution?.evidenceScope).toBe('symbol');
    expect(env.nextStepHint).toContain('暴露面');
  });

  it('状态3 解析缺口 → coverage-gap 且显式 separable:false（②③不可拆分如实声明）', async () => {
    const root = writeProject(makeGraphJson({ callSitesCount: 500 }));
    const env = parseEnvelope(await handleContext({ symbolId: 'src/a.ts::orphanHelper', projectRoot: root }));
    expect(env.honesty?.resolution?.reason).toBe('coverage-gap');
    expect(env.honesty?.coverage?.separable).toBe(false);
    expect(env.honesty?.coverage?.unlinkedCallSites).toBe(499);
    expect(env.nextStepHint).toMatch(/499 个已探测调用点未成边/);
    expect(env.nextStepHint).toContain('不可区分');
  });

  it('状态4 图陈旧 → freshness.stale 与 resolution 正交并存', async () => {
    mocks.evaluateFreshness.mockReturnValue(STALE);
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(await handleContext({ symbolId: 'src/a.ts::orphanHelper', projectRoot: root }));
    expect(env.honesty?.freshness.verdict.state).toBe('stale');
    expect(env.honesty?.freshness.verdict.staleReasons).toEqual(['source-commit', 'collector-fingerprint']);
    expect(env.honesty?.resolution?.reason).toBe('confirmed-zero');
    expect(env.nextStepHint).toContain('图已过期');
  });

  it('组合态 coverage-gap + stale：两层含义同时出现，互不吞没', async () => {
    mocks.evaluateFreshness.mockReturnValue(STALE);
    const root = writeProject(makeGraphJson({ callSitesCount: 5000 }));
    const env = parseEnvelope(await handleContext({ symbolId: 'src/a.ts::orphanHelper', projectRoot: root }));
    expect(env.honesty?.resolution?.reason).toBe('coverage-gap');
    expect(env.honesty?.freshness.verdict.state).toBe('stale');
    expect(env.nextStepHint).toMatch(/4999 个已探测调用点未成边/);
    expect(env.nextStepHint).not.toContain('解析未完成');
    expect(env.nextStepHint).toContain('图已过期');
  });

  it('五种形态两两可区分：(reason, freshnessState) 组合互不相同', async () => {
    const seen = new Set<string>();
    const scenarios: Array<[GraphFreshnessVerdict, ScenarioOptions, string]> = [
      [FRESH, {}, 'src/a.ts::orphanHelper'],
      [FRESH, {}, 'src/a.ts::exportedFn'],
      [FRESH, { callSitesCount: 500 }, 'src/a.ts::orphanHelper'],
      [STALE, {}, 'src/a.ts::orphanHelper'],
      [DIRTY, { callSitesCount: 500 }, 'src/a.ts::orphanHelper'],
    ];
    for (const [verdict, opts, symbolId] of scenarios) {
      mocks.evaluateFreshness.mockReturnValue(verdict);
      __resetHonestyCache();
      reloadGraph();
      const root = writeProject(makeGraphJson(opts));
      const env = parseEnvelope(await handleContext({ symbolId, projectRoot: root }));
      seen.add(`${env.honesty?.resolution?.reason}|${env.honesty?.freshness.verdict.state}`);
    }
    expect(seen.size).toBe(5);
  });

  it('coverage-gap 也可由缺席数据源触发（skippedSources 如实回传成因）', async () => {
    const root = writeProject(
      makeGraphJson({ skippedSources: [{ source: 'doc-graph', reason: '未提供 DocGraph 数据源' }] }),
    );
    const env = parseEnvelope(await handleContext({ symbolId: 'src/a.ts::orphanHelper', projectRoot: root }));
    expect(env.honesty?.resolution?.reason).toBe('coverage-gap');
    expect(env.honesty?.resolution?.detail).toContain('doc-graph');
  });
});

// ─────────────────────────────────────────────────────────────
// 对抗审查 A1 / A5 / B3c：resolution 只在 caller 取向的查询上产出
// 两条攻击都是实跑复现出来的——被查对象在图里确有调用方，返回体却说"在图中无调用方"
// ─────────────────────────────────────────────────────────────

describe('F266-A1/A5 resolution 的取向前提', () => {
  it('A1 context include:[callees] —— 对一个**确有 caller** 的 symbol 不得产出 resolution', async () => {
    const root = writeProject(makeGraphJson());
    // privateHelper 在图里被 exportedFn 调用；include 不含 callers 时 callers 数组根本没被查询
    const env = parseEnvelope(
      await handleContext({ symbolId: 'src/a.ts::privateHelper', projectRoot: root, include: ['callees'] }),
    );
    expect(env['callers'], 'callers 未被查询，故不在返回体里').toBeUndefined();
    expect(env.honesty?.resolution, '"没查"MUST NOT 被当成"查了为空"').toBeUndefined();
    expect(env.honesty?.coverage).toBeUndefined();
    // freshness 照常携带（诚实缺席只针对没有证据的那一项）
    expect(env.honesty?.freshness.verdict.state).toBe('fresh');
    // hint 是同一句假话的用户可见面：callers 键缺席时 MUST NOT 断言"在图中无调用方"
    expect(env.nextStepHint).not.toContain('在图中无调用方');
    expect(env.nextStepHint).toContain('本次未查询');
  });

  it('A1 对照：include 含 callers 且确实为空 → resolution 照常产出', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(
      await handleContext({ symbolId: 'src/a.ts::orphanHelper', projectRoot: root, include: ['callers'] }),
    );
    expect(env['callers']).toEqual([]);
    expect(env.honesty?.resolution?.reason).toBe('confirmed-zero');
  });

  it('A5 impact direction=downstream 零结果 → 不产出 resolution（无 callee 侧边界证据）', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(
      await handleImpact({ target: 'src/a.ts::privateHelper', projectRoot: root, direction: 'downstream' }),
    );
    expect((env['affected'] as unknown[]).length).toBe(0);
    expect(env.honesty?.resolution, 'caller 侧证据不能用来解释 callee 侧零结果').toBeUndefined();
    expect(env.honesty?.freshness.verdict.state).toBe('fresh');
  });

  it('A5 对照：direction=upstream / both 零结果 → resolution 照常产出', async () => {
    const root = writeProject(makeGraphJson());
    const up = parseEnvelope(await handleImpact({ target: 'src/a.ts::orphanHelper', projectRoot: root, direction: 'upstream' }));
    expect(up.honesty?.resolution?.reason).toBe('confirmed-zero');
    __resetHonestyCache();
    const both = parseEnvelope(await handleImpact({ target: 'src/a.ts::orphanHelper', projectRoot: root, direction: 'both' }));
    expect(both.honesty?.resolution?.reason).toBe('confirmed-zero');
  });

  it('D4/D5 A5 缺席说出口：downstream 零结果带 resolutionOmitted，且 hint 不再是光秃秃的"范围为空"', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(
      await handleImpact({ target: 'src/a.ts::privateHelper', projectRoot: root, direction: 'downstream' }),
    );
    expect(env.honesty?.resolutionOmitted).toEqual({ reason: 'non-caller-oriented-query' });
    expect(env.nextStepHint).toContain('callee');
    expect(env.nextStepHint).toContain('零结果不等于');
  });

  it('D4 A1 缺席说出口：include 不含 callers → resolutionOmitted.callers-not-queried', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(
      await handleContext({ symbolId: 'src/a.ts::privateHelper', projectRoot: root, include: ['callees'] }),
    );
    expect(env.honesty?.resolution).toBeUndefined();
    expect(env.honesty?.resolutionOmitted).toEqual({ reason: 'callers-not-queried' });
  });

  it('D4 detect_changes 改动文件全部未落图（BFS 一次没跑）→ 无 resolution + no-symbols-in-graph + hint 说明未执行', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(
      await handleDetectChanges({
        diff: unifiedDiffFor('src/never-in-graph.ts'),
        projectRoot: root,
      }),
    );
    expect((env['changedSymbols'] as unknown[]).length).toBe(0);
    expect((env['affectedSymbols'] as unknown[]).length).toBe(0);
    expect(env.honesty?.resolution, '上游查询根本没执行，不能拿图级证据给它下结论').toBeUndefined();
    expect(env.honesty?.resolutionOmitted).toEqual({ reason: 'no-symbols-in-graph' });
    expect(env.nextStepHint).toContain('上游查询未执行');
    // 缺席不等于沉默
    expect(env.honesty?.freshness.verdict.state).toBe('fresh');
  });

  it('D4 对照：改动文件确实落图时，resolution 照常产出、resolutionOmitted 缺席', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(
      await handleDetectChanges({ diff: unifiedDiffFor('src/a.ts'), projectRoot: root }),
    );
    expect((env['changedSymbols'] as unknown[]).length).toBeGreaterThan(0);
    expect(env.honesty?.resolutionOmitted).toBeUndefined();
  });

  /**
   * E4：budget / depth 归零的查询**根本没跑**（budget=0 一个节点都取不到；depth=0 一层都不展开），
   * 此前它们照样产出 `boundary-exposed` 并配一句用图覆盖面解释零结果的 hint ——
   * 拿一份与本次查询无关的证据，为一个没发生过的遍历作证。
   */
  it('E4 impact(budget:0)：遍历未执行 → 无 resolution + query-constrained-to-zero + hint 明说与图内容无关', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(
      await handleImpact({ target: 'src/a.ts::exportedFn', projectRoot: root, budget: 0 }),
    );
    expect((env['affected'] as unknown[]).length).toBe(0);
    expect(env.honesty?.resolution, 'BFS 没跑过，任何 resolution 都是对空气作证').toBeUndefined();
    expect(env.honesty?.resolutionOmitted).toEqual({ reason: 'query-constrained-to-zero' });
    expect(env.nextStepHint).toContain('与图内容无关');
    // 旧行为（把导出面当成零结果的解释）必须消失
    expect(env.nextStepHint).not.toContain('对外暴露面');
  });

  it('E4 impact(depth:0)：同一判据覆盖 depth 归零（一层都不展开）', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(
      await handleImpact({ target: 'src/a.ts::exportedFn', projectRoot: root, depth: 0 }),
    );
    expect(env.honesty?.resolution).toBeUndefined();
    expect(env.honesty?.resolutionOmitted).toEqual({ reason: 'query-constrained-to-zero' });
    expect(env.nextStepHint).toContain('放宽约束');
  });

  it('E4 detect_changes(budget:0)：共享 BFS 第一轮就 break → query-constrained-to-zero（优先于 no-symbols-in-graph）', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(
      await handleDetectChanges({ diff: unifiedDiffFor('src/a.ts'), projectRoot: root, budget: 0 }),
    );
    expect((env['affectedSymbols'] as unknown[]).length).toBe(0);
    expect(env.honesty?.resolution).toBeUndefined();
    expect(env.honesty?.resolutionOmitted).toEqual({ reason: 'query-constrained-to-zero' });
    expect(env.nextStepHint).toContain('与图内容无关');
  });

  it('E4 detect_changes(depth:0)：与 impact 同形的对称口径——BFS 被调用但一层都不展开，同判归零约束', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(
      await handleDetectChanges({ diff: unifiedDiffFor('src/a.ts'), projectRoot: root, depth: 0 }),
    );
    // 起点集合非空（改动文件确实落图），因此这里判到 query-constrained-to-zero
    // 必然来自 depth 归零判据本身，而不是 no-symbols-in-graph 的顺带命中
    expect((env['changedSymbols'] as unknown[]).length).toBeGreaterThan(0);
    expect((env['affectedSymbols'] as unknown[]).length).toBe(0);
    expect(env.honesty?.resolution).toBeUndefined();
    expect(env.honesty?.resolutionOmitted).toEqual({ reason: 'query-constrained-to-zero' });
    expect(env.nextStepHint).toContain('与图内容无关');
  });

  it('E4 对照：budget/depth 正常时，同一查询照常产出 resolution（判据没有误伤正常路径）', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(
      await handleImpact({ target: 'src/a.ts::exportedFn', projectRoot: root, budget: 200, depth: 2 }),
    );
    expect(env.honesty?.resolutionOmitted).toBeUndefined();
    expect(env.honesty?.resolution?.reason).toBe('boundary-exposed');
  });

  it('B3c coverage 只在零结果时随行；非零结果的返回体不带它', async () => {
    const root = writeProject(makeGraphJson({ callSitesCount: 500 }));
    const empty = parseEnvelope(await handleContext({ symbolId: 'src/a.ts::orphanHelper', projectRoot: root }));
    expect(empty.honesty?.coverage?.unlinkedCallSites).toBe(499);
    __resetHonestyCache();
    const nonEmpty = parseEnvelope(await handleContext({ symbolId: 'src/a.ts::privateHelper', projectRoot: root }));
    expect((nonEmpty['callers'] as unknown[]).length).toBeGreaterThan(0);
    expect(nonEmpty.honesty?.coverage).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// FR-011：追加式 advisory，不改变工具成功状态；裁决 1
// ─────────────────────────────────────────────────────────────

describe('F266 追加式 advisory 与裁决 1', () => {
  it('三工具恒带 freshness（含结果非空场景）', async () => {
    mocks.evaluateFreshness.mockReturnValue(DIRTY);
    const root = writeProject(makeGraphJson());
    // impact 有结果（privateHelper 有 1 个 upstream caller）
    const imp = parseEnvelope(await handleImpact({ target: 'src/a.ts::privateHelper', projectRoot: root }));
    expect((imp['affected'] as unknown[]).length).toBeGreaterThan(0);
    expect(imp.honesty?.freshness.verdict.state).toBe('dirty');
    expect(imp.honesty?.resolution, '结果非空时不附加 resolution').toBeUndefined();

    const ctx = parseEnvelope(await handleContext({ symbolId: 'src/a.ts::orphanHelper', projectRoot: root }));
    expect(ctx.honesty?.freshness.verdict.state).toBe('dirty');

    const dc = parseEnvelope(await handleDetectChanges({ diff: 'diff --git a/src/a.ts b/src/a.ts\n', projectRoot: root }));
    expect(dc.honesty?.freshness.verdict.state).toBe('dirty');
  });

  it('freshness 为 stale 时工具仍为成功响应（advisory 不翻转状态）', async () => {
    mocks.evaluateFreshness.mockReturnValue(STALE);
    const root = writeProject(makeGraphJson());
    const res = await handleImpact({ target: 'src/a.ts::exportedFn', projectRoot: root });
    expect(res.isError).toBeUndefined();
  });

  it('builderMismatch 是独立字段，绝不进 staleReasons、不改 verdict.state', async () => {
    const root = writeProject(
      makeGraphJson({
        builder: { formatVersion: 1, commit: 'c'.repeat(40), dirty: false, sourceDirty: false, distSha256: '9'.repeat(64) },
      }),
    );
    const env = parseEnvelope(await handleContext({ symbolId: 'src/a.ts::orphanHelper', projectRoot: root }));
    const f = env.honesty!.freshness;
    // 当前进程可能有/没有 build 盖章，两种情况下 mismatch 分别为 boolean / null，
    // 但无论哪种，它都 MUST NOT 影响 verdict（裁决 1 的承重断言）
    expect(f.verdict.state).toBe('fresh');
    expect(f.verdict.staleReasons).toBeUndefined();
    expect(JSON.stringify(f.verdict)).not.toContain('builder');
    expect(f).toHaveProperty('builderMismatch');
  });

  it('既有消费方兼容性：不读 honesty 的旧式断言行为不变', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(await handleImpact({ target: 'src/a.ts::privateHelper', projectRoot: root }));
    // F155/F170c 既有契约字段全在、语义未变
    expect(env).toHaveProperty('affected');
    expect(env).toHaveProperty('summary');
    expect(env).toHaveProperty('topImpacted');
    expect(typeof env['nextStepHint']).toBe('string');
    expect(env).not.toHaveProperty('_enrichmentDegraded');
    const affected = env['affected'] as Array<{ id: string; depth: number }>;
    expect(affected.map((a) => a.id)).toEqual(['src/a.ts::exportedFn']);

    const ctx = parseEnvelope(await handleContext({ symbolId: 'src/a.ts::privateHelper', projectRoot: root }));
    expect((ctx['callers'] as Array<{ id: string }>).map((c) => c.id)).toEqual(['src/a.ts::exportedFn']);
    expect(ctx).toHaveProperty('callees');
    expect(ctx).toHaveProperty('imports');
    expect(ctx).toHaveProperty('topRelevantCallers');
  });
});

// ─────────────────────────────────────────────────────────────
// FR-012：detect_changes 比较口径（真实 git 仓库）
// ─────────────────────────────────────────────────────────────

describe('F266 detect_changes comparisonScope（FR-012）', () => {
  function initGitRepo(root: string): string {
    const run = (args: string[]): string =>
      execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    run(['init', '-q']);
    run(['config', 'user.email', 'f266@example.com']);
    run(['config', 'user.name', 'F266']);
    writeFileSync(path.join(root, 'README.md'), '# f266\n', 'utf-8');
    run(['add', '-A']);
    run(['commit', '-q', '-m', 'init']);
    return run(['rev-parse', '--verify', 'HEAD^{commit}']);
  }

  it('baseRef 模式 → comparisonScope 声明三点记法且 includesUncommitted 恒 false', async () => {
    const root = writeProject(makeGraphJson());
    const sha = initGitRepo(root);
    const env = parseEnvelope(await handleDetectChanges({ baseRef: 'HEAD', projectRoot: root }));
    expect(env.honesty?.comparisonScope?.notation).toBe('three-dot');
    expect(env.honesty?.comparisonScope?.gitRange).toBe(`${sha}...HEAD`);
    expect(env.honesty?.comparisonScope?.includesUncommitted).toBe(false);
    expect(env.nextStepHint).toContain('不含工作区未提交改动');
  });

  it('uncommittedChangesPresent 取自 freshness verdict（dirty 态）', async () => {
    mocks.evaluateFreshness.mockReturnValue(DIRTY);
    const root = writeProject(makeGraphJson());
    initGitRepo(root);
    const env = parseEnvelope(await handleDetectChanges({ baseRef: 'HEAD', projectRoot: root }));
    expect(env.honesty?.comparisonScope?.uncommittedChangesPresent).toBe(true);
    expect(env.honesty?.comparisonScope?.detail).toContain('未纳入本次比较');
  });

  it('diff 模式（调用方自带 diff）→ 不产出 comparisonScope，其余 honesty 仍在', async () => {
    const root = writeProject(makeGraphJson());
    const env = parseEnvelope(
      await handleDetectChanges({ diff: 'diff --git a/src/a.ts b/src/a.ts\n', projectRoot: root }),
    );
    expect(env.honesty?.comparisonScope).toBeUndefined();
    expect(env.honesty?.freshness).toBeDefined();
  });
});
