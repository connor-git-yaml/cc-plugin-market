/**
 * F266 T013/T014 — `graph-honesty.ts` 判定层 + `generateNextStepHint` 文案层单测。
 *
 * 硬约束（plan Q4 可测性）：本文件**零 git spawn、零真实时钟**——
 * freshness 与 builder 戳全部走 `deps` 注入 seam，`now` 也是注入的假时钟。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphJSON, GraphNode, GraphEdge } from '../../src/panoramic/graph/graph-types.js';
import type { GraphFreshnessVerdict } from '../../src/panoramic/graph/quality/quality-types.js';
import type { GraphBuilderStamp } from '../../src/panoramic/graph/builder-stamp.js';
import {
  buildHonestyAnnotation,
  assessCoverage,
  computeCoverageGap,
  decideResolution,
  __resetHonestyCache,
  FRESHNESS_TTL_MS,
  MCP_DIRTY_FILES_LIMIT,
  type GraphHonesty,
  type HonestyAnnotationParams,
} from '../../src/mcp/lib/graph-honesty.js';
import { generateNextStepHint } from '../../src/mcp/lib/response-helpers.js';

// ─────────────────────────────────────────────────────────────
// fixture 构造
// ─────────────────────────────────────────────────────────────

const FRESH: GraphFreshnessVerdict = {
  state: 'fresh',
  recordedSourceCommit: 'a'.repeat(40),
  currentHead: 'a'.repeat(40),
};
const STALE: GraphFreshnessVerdict = {
  state: 'stale',
  recordedSourceCommit: 'a'.repeat(40),
  currentHead: 'b'.repeat(40),
  staleReasons: ['source-commit'],
};
const DIRTY: GraphFreshnessVerdict = {
  state: 'dirty',
  recordedSourceCommit: 'a'.repeat(40),
  currentHead: 'a'.repeat(40),
  dirtyFiles: ['src/x.ts'],
};
const UNKNOWN: GraphFreshnessVerdict = {
  state: 'unknown-provenance',
  recordedSourceCommit: null,
  currentHead: null,
};

const STAMP_A: GraphBuilderStamp = {
  formatVersion: 1,
  commit: 'c'.repeat(40),
  dirty: false,
  sourceDirty: false,
  distSha256: '1'.repeat(64),
};
const STAMP_B: GraphBuilderStamp = { ...STAMP_A, distSha256: '2'.repeat(64) };

interface GraphOptions {
  nodes?: GraphNode[];
  links?: GraphEdge[];
  skippedSources?: Array<{ source: string; reason: string }>;
  /** 'absent' = 字段缺席（旧图）；否则原样写入 graph.builder */
  builder?: unknown;
}

function makeGraph(opts: GraphOptions = {}): GraphJSON {
  const meta: Record<string, unknown> = {
    name: 'spectra-knowledge-graph',
    generatedAt: '2026-08-30T00:00:00.000Z',
    nodeCount: opts.nodes?.length ?? 0,
    edgeCount: opts.links?.length ?? 0,
    sources: ['unified-graph'],
    schemaVersion: '2.0',
    sourceCommit: 'a'.repeat(40),
  };
  if (opts.skippedSources !== undefined) meta['skippedSources'] = opts.skippedSources;
  if (opts.builder !== 'absent') meta['builder'] = opts.builder ?? null;
  return {
    directed: true,
    multigraph: false,
    graph: meta as unknown as GraphJSON['graph'],
    nodes: opts.nodes ?? [],
    links: opts.links ?? [],
  };
}

function symbolNode(id: string, metadata: Record<string, unknown> = {}): GraphNode {
  return { id, kind: 'component', label: id, metadata };
}

/**
 * 生产形态的 **module** 节点。
 *
 * delta 审查 D2 之后这不再是无关紧要的标注：`callSitesCount` 只由 module 节点承载
 * （graph-builder §3.5），而"记账是否覆盖全图"的分母正是 module 节点数。用 component 节点
 * 冒充带记账的模块，测的就不是生产上会发生的形态了。
 */
function moduleNode(id: string, metadata: Record<string, unknown> = {}): GraphNode {
  return { id, kind: 'module', label: id, metadata: { unifiedKind: 'module', ...metadata } };
}

function callsEdge(source: string, target: string): GraphEdge {
  return { source, target, relation: 'calls', confidence: 'EXTRACTED', confidenceScore: 1, directional: true };
}

/** 组装一次 buildHonestyAnnotation 调用（默认注入 fresh + 无 build 盖章 + 固定时钟） */
function annotate(
  graphData: GraphJSON,
  over: Partial<HonestyAnnotationParams> = {},
  verdict: GraphFreshnessVerdict = FRESH,
  nowValue = 1_000_000,
): GraphHonesty {
  return buildHonestyAnnotation({
    projectRoot: '/tmp/proj',
    graph: { graphData, graphPath: '/tmp/proj/specs/_meta/graph.json', mtimeMs: 111, sizeBytes: 222 },
    resultsEmpty: true,
    resolutionBasis: true,
    deps: {
      evaluateFreshnessFn: () => verdict,
      now: () => nowValue,
      getBuilderStampFn: () => null,
    },
    ...over,
  });
}

beforeEach(() => {
  __resetHonestyCache();
});

// ─────────────────────────────────────────────────────────────
// FR-009：三个 resolution 值各自的构造用例 + 优先级唯一性
// ─────────────────────────────────────────────────────────────

describe('F266 resolution 三分互斥', () => {
  it('confirmed-zero：记账在场且全部成边 + 无缺席数据源 + symbol 无导出面', () => {
    // 记账在场（module 节点带 callSitesCount）且 detected === linked，才构成"测得为零"的正向证据
    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 1 }), symbolNode('a.ts::helper')],
      links: [callsEdge('a.ts::helper', 'a.ts::other')],
    });
    const h = annotate(g, { symbolId: 'a.ts::helper' });
    expect(h.resolution?.reason).toBe('confirmed-zero');
    expect(h.resolution?.evidenceScope).toBe('symbol');
    expect(h.coverage).toBeUndefined();
  });

  it('boundary-exposed：symbol 有 exportKind → symbol 级证据', () => {
    const g = makeGraph({ nodes: [symbolNode('a.ts::Foo', { exportKind: 'interface' })] });
    const h = annotate(g, { symbolId: 'a.ts::Foo' });
    expect(h.resolution?.reason).toBe('boundary-exposed');
    expect(h.resolution?.evidenceScope).toBe('symbol');
    expect(h.resolution?.detail).toContain('exportKind=interface');
  });

  it('boundary-exposed：external 节点', () => {
    const g = makeGraph({ nodes: [symbolNode('node_modules/x.js::f', { external: true })] });
    const h = annotate(g, { symbolId: 'node_modules/x.js::f' });
    expect(h.resolution?.reason).toBe('boundary-exposed');
    expect(h.resolution?.detail).toContain('external');
  });

  it('coverage-gap：存在未成边 call site，且显式带 separable:false', () => {
    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 10 }), symbolNode('a.ts::helper')],
      links: [callsEdge('a.ts::helper', 'a.ts::other')],
    });
    const h = annotate(g, { symbolId: 'a.ts::helper' });
    expect(h.resolution?.reason).toBe('coverage-gap');
    expect(h.resolution?.evidenceScope).toBe('graph');
    expect(h.coverage).toBeDefined();
    expect(h.coverage?.separable).toBe(false);
    expect(h.coverage?.callSitesDetected).toBe(10);
    expect(h.coverage?.callEdgesLinked).toBe(1);
    expect(h.coverage?.unlinkedCallSites).toBe(9);
    expect(h.coverage?.linkageRatio).toBeCloseTo(0.1, 5);
  });

  it('coverage-gap：仅 skippedSources 非空也成立（coverage 字段按契约缺席）', () => {
    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 1 }), symbolNode('a.ts::helper')],
      links: [callsEdge('a.ts::helper', 'a.ts::other')],
      skippedSources: [{ source: 'doc-graph', reason: '未提供 DocGraph 数据源' }],
    });
    const h = annotate(g, { symbolId: 'a.ts::helper' });
    expect(h.resolution?.reason).toBe('coverage-gap');
    expect(h.coverage).toBeUndefined();
    expect(h.resolution?.detail).toContain('doc-graph');
  });

  it('优先级唯一性：symbol 级证据同时存在图级缺口时，仍判 boundary-exposed（graph 级不得吃掉 symbol 级）', () => {
    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 100 }), symbolNode('a.ts::Foo', { exportKind: 'function' })],
      skippedSources: [{ source: 'doc-graph', reason: 'x' }],
    });
    const h = annotate(g, { symbolId: 'a.ts::Foo' });
    expect(h.resolution?.reason).toBe('boundary-exposed');
    // 缺口信息不因优先级而丢失
    expect(h.coverage?.unlinkedCallSites).toBe(100);
  });

  it('三个 reason 两两互斥：同一次调用只产出一个 resolution.reason', () => {
    const cases: Array<[GraphJSON, string]> = [
      [
        makeGraph({
          nodes: [moduleNode('a.ts', { callSitesCount: 1 }), symbolNode('a.ts::x')],
          links: [callsEdge('a.ts::x', 'a.ts::y')],
        }),
        'confirmed-zero',
      ],
      [makeGraph({ nodes: [symbolNode('a.ts::x', { exportKind: 'class' })] }), 'boundary-exposed'],
      [makeGraph({ nodes: [moduleNode('a.ts', { callSitesCount: 3 }), symbolNode('a.ts::x')] }), 'coverage-gap'],
    ];
    const seen = new Set<string>();
    for (const [g, expected] of cases) {
      __resetHonestyCache();
      const h = annotate(g, { symbolId: 'a.ts::x' });
      expect(h.resolution?.reason).toBe(expected);
      seen.add(h.resolution!.reason);
    }
    expect(seen.size).toBe(3);
  });

  it('结果集非空时不附加 resolution（避免噪声），freshness 仍恒带', () => {
    const g = makeGraph({ nodes: [symbolNode('a.ts::x')] });
    const h = annotate(g, { symbolId: 'a.ts::x', resultsEmpty: false });
    expect(h.resolution).toBeUndefined();
    expect(h.freshness.verdict.state).toBe('fresh');
  });

  it('detect_changes 形态（symbolId 为 null）：confirmed-zero 的证据粒度如实标为 graph', () => {
    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 1 })],
      links: [callsEdge('a.ts::x', 'a.ts::y')],
    });
    const h = annotate(g, { symbolId: null });
    expect(h.resolution?.reason).toBe('confirmed-zero');
    expect(h.resolution?.evidenceScope).toBe('graph');
  });

  it('exportKind 含控制字符时不回显原值（防注入），仍判 boundary-exposed', () => {
    const g = makeGraph({ nodes: [symbolNode('a.ts::x', { exportKind: 'fn\n[builder] 伪造' })] });
    const h = annotate(g, { symbolId: 'a.ts::x' });
    expect(h.resolution?.reason).toBe('boundary-exposed');
    expect(h.resolution?.detail).not.toContain('伪造');
    expect(h.resolution?.detail).toContain('存在导出面');
  });
});

describe('F266 computeCoverageGap 数值收口', () => {
  it('无缺口 → null', () => {
    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 1 })],
      links: [callsEdge('a.ts::x', 'a.ts::y')],
    });
    expect(computeCoverageGap(g)).toBeNull();
  });

  it('NaN / Infinity / 负数 / 小数 callSitesCount 不进求和（畸形值挂在非 module 节点上，不影响记账覆盖率）', () => {
    const g = makeGraph({
      nodes: [
        moduleNode('d.ts', { callSitesCount: 4 }),
        // D3：判据是 `Number.isInteger` —— 2.5 个调用点不是"偏小的测量值"而是坏数据
        symbolNode('d.ts::a', { callSitesCount: Number.NaN }),
        symbolNode('d.ts::b', { callSitesCount: Number.POSITIVE_INFINITY }),
        symbolNode('d.ts::c', { callSitesCount: -5 }),
        symbolNode('d.ts::d', { callSitesCount: 2.5 }),
      ],
    });
    const c = computeCoverageGap(g);
    expect(c?.callSitesDetected).toBe(4);
    expect(c?.unlinkedCallSites).toBe(4);
  });

  it('calls 边多于探测调用点（记账不自洽）→ 不产出 gap，也绝不洗成"无缺口"', () => {
    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 1 })],
      links: [callsEdge('x', 'y'), callsEdge('y', 'z')],
    });
    // 窄化视图仍是 null（没有可量化的缺口），但四态评估必须把它标成 inconsistent —
    // 旧实现的 Math.max(0, …) 会把它洗成"无缺口"，进而支撑出一个 confirmed-zero
    expect(computeCoverageGap(g)).toBeNull();
    expect(assessCoverage(g)).toEqual({ kind: 'inconsistent', callSitesDetected: 1, callEdgesLinked: 2 });
  });

  it('畸形 skippedSources 条目被丢弃而非透传', () => {
    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 2 })],
      skippedSources: [
        { source: 'doc-graph', reason: 'ok' },
        { source: 123, reason: null } as unknown as { source: string; reason: string },
      ],
    });
    expect(computeCoverageGap(g)?.skippedSources).toEqual([{ source: 'doc-graph', reason: 'ok' }]);
  });

  it('decideResolution 是纯函数：同输入同输出，且不依赖缓存', () => {
    const node = symbolNode('a.ts::x', { exportKind: 'const' });
    const measuredZero = { kind: 'measured-zero', callSitesDetected: 3, callEdgesLinked: 3 } as const;
    const a = decideResolution(node, 'a.ts::x', measuredZero, []);
    const b = decideResolution(node, 'a.ts::x', measuredZero, []);
    expect(a).toEqual(b);
  });
});

// ─────────────────────────────────────────────────────────────
// FR-011：freshness 与 resolution 正交（同时呈现）
// ─────────────────────────────────────────────────────────────

describe('F266 freshness 与 resolution 正交', () => {
  it('组合态：coverage-gap + stale 同时呈现，互不吞没', () => {
    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 50 }), symbolNode('a.ts::helper')],
      links: [callsEdge('a.ts::helper', 'a.ts::other')],
    });
    const h = annotate(g, { symbolId: 'a.ts::helper' }, STALE);
    expect(h.resolution?.reason).toBe('coverage-gap');
    expect(h.coverage?.separable).toBe(false);
    expect(h.freshness.verdict.state).toBe('stale');
    expect(h.freshness.verdict.staleReasons).toEqual(['source-commit']);
  });

  it.each([
    ['fresh', FRESH],
    ['dirty', DIRTY],
    ['stale', STALE],
    ['unknown-provenance', UNKNOWN],
  ] as const)('四态 %s 均原样内嵌 F249 verdict，不重新发明', (state, verdict) => {
    const g = makeGraph({ nodes: [symbolNode('a.ts::x')] });
    const h = annotate(g, { symbolId: 'a.ts::x' }, verdict);
    expect(h.freshness.verdict.state).toBe(state);
    // dirtyFiles 在 MCP 投影层可能被截断（B3c），故按"未超上限即原样"比对：
    // 除截断元数据外的每一个字段都 MUST 与 F249 verdict 一字不差
    const { dirtyFileCount, dirtyFilesTruncated, ...rest } = h.freshness.verdict;
    expect(rest).toEqual(verdict);
    if (verdict.dirtyFiles === undefined) {
      expect(dirtyFileCount).toBeUndefined();
      expect(dirtyFilesTruncated).toBeUndefined();
    } else {
      expect(dirtyFileCount).toBe(verdict.dirtyFiles.length);
      expect(dirtyFilesTruncated).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 裁决 1：builder 戳只可见不判定
// ─────────────────────────────────────────────────────────────

describe('F266 builder 戳 advisory（裁决 1）', () => {
  function annotateWithBuilder(builder: unknown, current: GraphBuilderStamp | null): GraphHonesty {
    const g = makeGraph({ nodes: [symbolNode('a.ts::x')], builder });
    return buildHonestyAnnotation({
      projectRoot: '/tmp/proj',
      graph: { graphData: g, graphPath: '/g.json', mtimeMs: 1, sizeBytes: 2 },
      symbolId: 'a.ts::x',
      resultsEmpty: true,
      deps: { evaluateFreshnessFn: () => FRESH, now: () => 1, getBuilderStampFn: () => current },
    });
  }

  it('dist 不同 → builderMismatch=true，但绝不进 staleReasons、不改 verdict.state', () => {
    const h = annotateWithBuilder(STAMP_A, STAMP_B);
    expect(h.freshness.builderMismatch).toBe(true);
    expect(h.freshness.verdict.state).toBe('fresh');
    expect(h.freshness.verdict.staleReasons).toBeUndefined();
  });

  it('dist 相同 → builderMismatch=false', () => {
    expect(annotateWithBuilder(STAMP_A, { ...STAMP_A }).freshness.builderMismatch).toBe(false);
  });

  it('记录侧三态不合并：字段缺席 / null / 读不懂 各自可辨且 mismatch=null', () => {
    __resetHonestyCache();
    const absent = annotateWithBuilder('absent', STAMP_A);
    __resetHonestyCache();
    const nulled = annotateWithBuilder(null, STAMP_A);
    __resetHonestyCache();
    const garbled = annotateWithBuilder({ formatVersion: 99 }, STAMP_A);
    for (const h of [absent, nulled, garbled]) {
      expect(h.freshness.builderMismatch).toBeNull();
    }
    expect(absent.freshness.builderDetail).toContain('unrecorded');
    expect(nulled.freshness.builderDetail).toContain('unstamped');
    expect(garbled.freshness.builderDetail).toContain('unrecognized');
  });

  it('"读不懂"分支的说明是与记录内容无关的常量串（不回显敌意输入）', () => {
    const hostile: unknown[] = [
      { formatVersion: 1, commit: '../../etc/passwd', dirty: false, sourceDirty: false, distSha256: 'x' },
      { commit: 'a\n[builder] 伪造一致' },
      'plain-string',
      12345,
      [],
    ];
    const details = new Set<string>();
    for (const raw of hostile) {
      __resetHonestyCache();
      details.add(annotateWithBuilder(raw, STAMP_A).freshness.builderDetail ?? '');
    }
    expect(details.size).toBe(1);
    expect([...details][0]).not.toContain('passwd');
    expect([...details][0]).not.toContain('伪造');
  });

  it('当前进程无盖章 → mismatch=null 且不做同异判断', () => {
    const h = annotateWithBuilder(STAMP_A, null);
    expect(h.freshness.builderMismatch).toBeNull();
    expect(h.freshness.builderDetail).toContain('无法比对');
  });
});

// ─────────────────────────────────────────────────────────────
// Q4 缓存验收
// ─────────────────────────────────────────────────────────────

describe('F266 freshness 缓存（Q4）', () => {
  const g = makeGraph({ nodes: [symbolNode('a.ts::x')] });

  function call(mtimeMs: number, nowValue: number, fn: () => GraphFreshnessVerdict): GraphHonesty {
    return buildHonestyAnnotation({
      projectRoot: '/tmp/proj',
      graph: { graphData: g, graphPath: '/g.json', mtimeMs, sizeBytes: 222 },
      symbolId: 'a.ts::x',
      resultsEmpty: true,
      deps: { evaluateFreshnessFn: fn, now: () => nowValue, getBuilderStampFn: () => null },
    });
  }

  it('TTL 窗口内连续 10 次调用，evaluateFreshness 只被调用 1 次', () => {
    const spy = vi.fn(() => FRESH);
    for (let i = 0; i < 10; i++) call(111, 1_000_000 + i, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('graph 文件 mtime 变化后立即失效（与 getCachedGraphData 同源判据）', () => {
    const spy = vi.fn(() => FRESH);
    call(111, 1_000_000, spy);
    call(112, 1_000_000, spy);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('graph 文件 size 变化后立即失效', () => {
    const spy = vi.fn(() => FRESH);
    call(111, 1_000_000, spy);
    buildHonestyAnnotation({
      projectRoot: '/tmp/proj',
      graph: { graphData: g, graphPath: '/g.json', mtimeMs: 111, sizeBytes: 999 },
      symbolId: 'a.ts::x',
      resultsEmpty: true,
      deps: { evaluateFreshnessFn: spy, now: () => 1_000_000, getBuilderStampFn: () => null },
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('超过 TTL 后重新判定', () => {
    const spy = vi.fn(() => FRESH);
    call(111, 1_000_000, spy);
    call(111, 1_000_000 + FRESHNESS_TTL_MS, spy);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('__resetHonestyCache 清空缓存', () => {
    const spy = vi.fn(() => FRESH);
    call(111, 1_000_000, spy);
    __resetHonestyCache();
    call(111, 1_000_000, spy);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────
// FR-012：comparisonScope
// ─────────────────────────────────────────────────────────────

describe('F266 comparisonScope（FR-012）', () => {
  const g = makeGraph({ nodes: [symbolNode('a.ts::x')] });

  it('gitRange 存在 → 声明三点记法且 includesUncommitted 恒 false', () => {
    const h = annotate(g, { symbolId: null, gitRange: '765a9608...HEAD' });
    expect(h.comparisonScope?.notation).toBe('three-dot');
    expect(h.comparisonScope?.gitRange).toBe('765a9608...HEAD');
    expect(h.comparisonScope?.includesUncommitted).toBe(false);
  });

  it('gitRange 为 null（diff 模式）→ 不产出 comparisonScope', () => {
    expect(annotate(g, { symbolId: null, gitRange: null }).comparisonScope).toBeUndefined();
  });

  it('uncommittedChangesPresent 取自 freshness verdict，不额外探测 git', () => {
    __resetHonestyCache();
    expect(annotate(g, { gitRange: 'x...HEAD' }, DIRTY).comparisonScope?.uncommittedChangesPresent).toBe(true);
    __resetHonestyCache();
    expect(annotate(g, { gitRange: 'x...HEAD' }, FRESH).comparisonScope?.uncommittedChangesPresent).toBe(false);
    __resetHonestyCache();
    expect(annotate(g, { gitRange: 'x...HEAD' }, UNKNOWN).comparisonScope?.uncommittedChangesPresent).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 内部失败不改变工具成功状态，但显式标注（不静默 fail-open）
// ─────────────────────────────────────────────────────────────

describe('F266 标注自身失败的处置', () => {
  it('evaluateFreshness 抛错 → 不抛出、置 annotationDegraded，不伪装成真实判定', () => {
    const g = makeGraph({ nodes: [symbolNode('a.ts::x')] });
    const h = buildHonestyAnnotation({
      projectRoot: '/tmp/proj',
      graph: { graphData: g, graphPath: '/g.json', mtimeMs: 1, sizeBytes: 2 },
      symbolId: 'a.ts::x',
      resultsEmpty: true,
      deps: {
        evaluateFreshnessFn: () => {
          throw new Error('git 爆炸');
        },
        now: () => 1,
      },
    });
    expect(h.annotationDegraded).toBe(true);
    expect(h.resolution).toBeUndefined();
    expect(h.freshness.builderMismatch).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// FR-010：generateNextStepHint 表驱动（resolution × freshness.state）
// ─────────────────────────────────────────────────────────────

describe('F266 generateNextStepHint 组合文案（FR-010）', () => {
  const REASONS = ['confirmed-zero', 'boundary-exposed', 'coverage-gap'] as const;
  const STATES = ['fresh', 'dirty', 'stale', 'unknown-provenance'] as const;

  function honestyOf(reason: (typeof REASONS)[number], state: (typeof STATES)[number]): GraphHonesty {
    const verdict: GraphFreshnessVerdict =
      state === 'fresh' ? FRESH : state === 'dirty' ? DIRTY : state === 'stale' ? STALE : UNKNOWN;
    const h: GraphHonesty = {
      resolution: { reason, evidenceScope: reason === 'coverage-gap' ? 'graph' : 'symbol', detail: 'd' },
      freshness: { verdict, builderMismatch: null, builderDetail: null },
    };
    if (reason === 'coverage-gap') {
      h.coverage = {
        callSitesDetected: 1000,
        callEdgesLinked: 30,
        unlinkedCallSites: 970,
        linkageRatio: 0.03,
        separable: false,
        skippedSources: [],
      };
    }
    return h;
  }

  for (const reason of REASONS) {
    for (const state of STATES) {
      it(`impact 零结果 × ${reason} × ${state}：文案含对应两层含义`, () => {
        const hint = generateNextStepHint('impact', { topImpacted: [], affected: [] }, 'success', honestyOf(reason, state));
        expect(hint.length).toBeGreaterThanOrEqual(5);
        if (reason === 'coverage-gap') expect(hint).toMatch(/未成边/);
        if (reason === 'boundary-exposed') expect(hint).toContain('暴露面');
        if (reason === 'confirmed-zero') expect(hint).toContain('可采信');
        if (state === 'stale') expect(hint).toContain('图已过期');
        if (state === 'dirty') expect(hint).toContain('未提交');
        if (state === 'unknown-provenance') expect(hint).toContain('来源版本不可知');
        if (state === 'fresh') expect(hint).not.toContain('图已过期');
      });

      it(`context 零调用方 × ${reason} × ${state}：不再声称"可能为顶层入口"`, () => {
        const hint = generateNextStepHint(
          'context',
          { definition: { id: 'a.ts::Foo' }, callers: [] },
          'success',
          honestyOf(reason, state),
        );
        expect(hint).not.toContain('可能为顶层入口');
        expect(hint).toContain('a.ts::Foo');
      });

      it(`detect_changes 无上游 × ${reason} × ${state}：不再声称"暂无上游调用方"`, () => {
        const hint = generateNextStepHint(
          'detect_changes',
          { topImpacted: [], riskTier: 'low', totalChanged: 3 },
          'success',
          honestyOf(reason, state),
        );
        expect(hint).not.toContain('暂无上游调用方');
        expect(hint.length).toBeGreaterThanOrEqual(5);
      });
    }
  }

  it('coverage-gap + stale 组合：同时出现"覆盖不足"与"图已过期"两层含义', () => {
    const hint = generateNextStepHint(
      'impact',
      { topImpacted: [], affected: [] },
      'success',
      honestyOf('coverage-gap', 'stale'),
    );
    expect(hint).toMatch(/970 个已探测调用点未成边/);
    expect(hint).toContain('图已过期');
    expect(hint).toContain('graph-only');
  });

  // 对抗审查 A3：hint 层 MUST NOT 按 linkageRatio 分档下断言。
  // 分母含 console.log / 宿主 API / 第三方包方法等永不成边的调用点，真实工程恒 <20%，
  // 旧的 <0.2 档在所有健康仓库上永久拉响"解析未完成/不可采信"——既造假归因又零信息量。
  it('linkageRatio 高低两端产出同形文案：只报绝对数 + 声明不可区分，不下可采信判定', () => {
    const low = honestyOf('coverage-gap', 'fresh');
    const lowHint = generateNextStepHint('impact', { topImpacted: [], affected: [] }, 'success', low);
    expect(lowHint).toContain('970 个已探测调用点未成边');
    expect(lowHint).toContain('不可区分');
    expect(lowHint).not.toContain('解析未完成');
    expect(lowHint).not.toContain('不可采信');
    expect(lowHint).not.toContain('覆盖率');

    const high = honestyOf('coverage-gap', 'fresh');
    high.coverage = {
      callSitesDetected: 1000,
      callEdgesLinked: 995,
      unlinkedCallSites: 5,
      linkageRatio: 0.995,
      separable: false,
      skippedSources: [],
    };
    const highHint = generateNextStepHint('impact', { topImpacted: [], affected: [] }, 'success', high);
    expect(highHint).toContain('5 个已探测调用点未成边');
    expect(highHint).toContain('不可区分');
    // 两端只有数字不同，判定措辞完全一致（不存在"越低越严"的分档）
    expect(highHint.replace('5 个', 'N 个')).toBe(lowHint.replace('970 个', 'N 个'));
  });

  it('非零结果场景：freshness 提示仍随行（FR-011 恒带 advisory）', () => {
    const h = honestyOf('confirmed-zero', 'stale');
    delete h.resolution;
    const hint = generateNextStepHint(
      'impact',
      { topImpacted: [{ id: 'a.ts::Foo', score: 1 }], affected: [{}, {}] },
      'success',
      h,
    );
    expect(hint).toContain('a.ts::Foo');
    expect(hint).toContain('图已过期');
  });

  it('向后兼容：不传 honesty 时仍返回非空引导文本，且不恢复旧的误导措辞', () => {
    expect(generateNextStepHint('impact', { topImpacted: [], affected: [] }, 'success').length).toBeGreaterThanOrEqual(5);
    const ctx = generateNextStepHint('context', { definition: { id: 'a.ts::F' }, callers: [] }, 'success');
    expect(ctx.length).toBeGreaterThanOrEqual(5);
    expect(ctx).not.toContain('可能为顶层入口');
    const dc = generateNextStepHint('detect_changes', { topImpacted: [], totalChanged: 1 }, 'success');
    expect(dc).not.toContain('暂无上游调用方');
  });

  it('degraded 路径仍固定返回 ""（传 honesty 也不例外）', () => {
    expect(generateNextStepHint('impact', {}, 'degraded', honestyOf('coverage-gap', 'stale'))).toBe('');
  });

  it('comparisonScope 存在时 detect_changes 文案声明比较口径', () => {
    const h = honestyOf('confirmed-zero', 'fresh');
    h.comparisonScope = {
      notation: 'three-dot',
      gitRange: 'abc123...HEAD',
      includesUncommitted: false,
      uncommittedChangesPresent: false,
      detail: 'd',
    };
    const hint = generateNextStepHint('detect_changes', { topImpacted: [], totalChanged: 2 }, 'success', h);
    expect(hint).toContain('不含工作区未提交改动');
  });
});

// ─────────────────────────────────────────────────────────────
// 对抗审查修复批次（A1 / A2 / A4 / A5 / B3 / B5）
// 每一条都对应一次实跑攻击构造，删掉任一条 = 把那条假话放回去
// ─────────────────────────────────────────────────────────────

describe('F266-A1/A5 resolution 只在 caller 取向的查询上产出', () => {
  const g = makeGraph({
    nodes: [moduleNode('a.ts', { callSitesCount: 1 }), symbolNode('a.ts::x')],
    links: [callsEdge('a.ts::x', 'a.ts::y')],
  });

  it('resolutionBasis 非 true（context include 不含 callers / impact downstream）→ 不产出 resolution', () => {
    const h = annotate(g, { symbolId: 'a.ts::x', resolutionBasis: 'non-caller-oriented-query' });
    expect(h.resolution).toBeUndefined();
  });

  it('resolution 缺席时 freshness 照常携带（诚实缺席 ≠ 整体沉默）', () => {
    const h = annotate(g, { symbolId: 'a.ts::x', resolutionBasis: 'non-caller-oriented-query' }, STALE);
    expect(h.freshness.verdict.state).toBe('stale');
  });

  it('resolution 缺席时 coverage 也不附加（与 resolution 同条件，避免无佐证对象的膨胀）', () => {
    const gapGraph = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 50 }), symbolNode('a.ts::x')],
      links: [callsEdge('a.ts::x', 'a.ts::y')],
    });
    expect(annotate(gapGraph, { symbolId: 'a.ts::x', resolutionBasis: 'non-caller-oriented-query' }).coverage).toBeUndefined();
    __resetHonestyCache();
    expect(annotate(gapGraph, { symbolId: 'a.ts::x', resolutionBasis: true }).coverage).toBeDefined();
  });
});

describe('F266-A4 confirmed-zero 需要"测量存在"的正向证据', () => {
  it('S1 全图无任何 callSitesCount（无记账）→ coverage-gap，绝不 confirmed-zero', () => {
    const g = makeGraph({ nodes: [symbolNode('a.ts::x')] });
    expect(assessCoverage(g)).toEqual({
      kind: 'unaccounted',
      reason: 'no-accounting',
      accountedModules: 0,
      totalModules: 0,
    });
    const h = annotate(g, { symbolId: 'a.ts::x' });
    expect(h.resolution?.reason).toBe('coverage-gap');
    expect(h.resolution?.detail).toContain('没有任何调用点记账');
    // 没有可量化的缺口 → 不编造 coverage 数字
    expect(h.coverage).toBeUndefined();
  });

  it('S2 记账不自洽（detected < linked）→ coverage-gap 并如实报出两个数，不被 clamp 洗白', () => {
    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 1 }), symbolNode('a.ts::x')],
      links: [callsEdge('a.ts::x', 'a.ts::y'), callsEdge('a.ts::y', 'a.ts::z')],
    });
    const h = annotate(g, { symbolId: 'a.ts::x' });
    expect(h.resolution?.reason).toBe('coverage-gap');
    expect(h.resolution?.detail).toContain('不自洽');
    expect(h.resolution?.detail).toContain('探测到 1 个调用点');
    expect(h.resolution?.detail).toContain('2 条 calls 边');
  });

  it('S4 记账全是畸形值（NaN/Infinity/负数）→ 不算"记账在场"，仍判 coverage-gap', () => {
    const g = makeGraph({
      nodes: [
        moduleNode('a.ts', { callSitesCount: Number.NaN }),
        moduleNode('b.ts', { callSitesCount: -1 }),
        symbolNode('a.ts::x'),
      ],
    });
    expect(assessCoverage(g)).toEqual({
      kind: 'unaccounted',
      reason: 'no-accounting',
      accountedModules: 0,
      totalModules: 2,
    });
    expect(annotate(g, { symbolId: 'a.ts::x' }).resolution?.reason).toBe('coverage-gap');
  });

  it('D2：全零记账 + 零 calls 边 → 绝不 confirmed-zero（磁盘上它与"从未抽取"完全同形）', () => {
    // 生产端 `sk.callSites?.length ?? 0` 把「tree-sitter 降级、没抽取」与「抽了、确实为 0」
    // 折叠成同一个磁盘值 0。第一轮判据（记账在场 + 自洽 + 差值为 0）在这张图上说出了最强的断言。
    const g = makeGraph({ nodes: [moduleNode('a.ts', { callSitesCount: 0 }), symbolNode('a.ts::x')] });
    expect(assessCoverage(g)).toEqual({
      kind: 'unaccounted',
      reason: 'all-zero',
      accountedModules: 1,
      totalModules: 1,
    });
    const h = annotate(g, { symbolId: 'a.ts::x' });
    expect(h.resolution?.reason).toBe('coverage-gap');
    expect(h.resolution?.detail).toContain('无法区分');
  });

  it('D2：部分模块缺记账（1 合法 + 499 缺失）→ 绝不 measured-zero，detail 报出缺口比例', () => {
    const nodes = [moduleNode('m0.ts', { callSitesCount: 3 })];
    for (let i = 1; i < 500; i += 1) nodes.push(moduleNode(`m${i}.ts`));
    nodes.push(symbolNode('m0.ts::x'));
    const g = makeGraph({
      nodes,
      links: [
        callsEdge('m0.ts::x', 'm0.ts::y'),
        callsEdge('m0.ts::y', 'm0.ts::z'),
        callsEdge('m0.ts::z', 'm0.ts::w'),
      ],
    });
    // 记账自洽（3 === 3）且差值为 0 —— 第一轮判据据此判 measured-zero → confirmed-zero，
    // 而全图 500 个模块里 499 个压根没测过
    expect(assessCoverage(g)).toEqual({
      kind: 'unaccounted',
      reason: 'partial-accounting',
      accountedModules: 1,
      totalModules: 500,
    });
    const h = annotate(g, { symbolId: 'm0.ts::x' });
    expect(h.resolution?.reason).toBe('coverage-gap');
    expect(h.resolution?.detail).toContain('499/500');
    // 没有可信的量化缺口 → 不编造 coverage 数字
    expect(h.coverage).toBeUndefined();
  });

  it('D2：全模块记账 + 总量 > 0 + 全部成边 → measured-zero → confirmed-zero（正向证据齐备时仍可达）', () => {
    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 2 }), symbolNode('a.ts::x')],
      links: [callsEdge('a.ts::x', 'a.ts::y'), callsEdge('a.ts::y', 'a.ts::z')],
    });
    expect(assessCoverage(g)).toEqual({ kind: 'measured-zero', callSitesDetected: 2, callEdgesLinked: 2 });
    expect(annotate(g, { symbolId: 'a.ts::x' }).resolution?.reason).toBe('confirmed-zero');
  });

  it('confirmed-zero 的 detail 必须交代其正向证据（记账完整），而非只说"无缺口"', () => {
    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 2 }), symbolNode('a.ts::x')],
      links: [callsEdge('p', 'q'), callsEdge('q', 'r')],
    });
    expect(annotate(g, { symbolId: 'a.ts::x' }).resolution?.detail).toContain('记账完整');
  });

  it('symbolId 给了但节点未在图中定位到 → 不对不存在的节点断言"无导出面"', () => {
    const r = decideResolution(null, 'a.ts::ghost', { kind: 'measured-zero', callSitesDetected: 1, callEdgesLinked: 1 }, []);
    expect(r.reason).toBe('confirmed-zero');
    expect(r.evidenceScope).toBe('graph');
    expect(r.detail).not.toContain('无对外导出面');
    expect(r.detail).toContain('未在图中定位到节点');
  });
});

describe('F266-D3 assessCoverage 对畸形图产物不得整体击穿', () => {
  /** 攻击面：图产物是外部输入，单个畸形节点/边过去会 throw 掉整个 honesty 信封（→ annotationDegraded） */
  it('缺 metadata 键 / metadata 为 null / metadata 是标量 → 不抛、不降级，按"无记账"处理', () => {
    const g = makeGraph({
      nodes: [
        { id: 'a.ts', kind: 'module', label: 'a.ts' } as unknown as GraphNode,
        { id: 'b.ts', kind: 'module', label: 'b.ts', metadata: null } as unknown as GraphNode,
        { id: 'c.ts', kind: 'module', label: 'c.ts', metadata: 42 } as unknown as GraphNode,
      ],
    });
    expect(() => assessCoverage(g)).not.toThrow();
    expect(assessCoverage(g)).toEqual({
      kind: 'unaccounted',
      reason: 'no-accounting',
      accountedModules: 0,
      totalModules: 3,
    });
    const h = annotate(g, { symbolId: 'a.ts' });
    expect(h.annotationDegraded).toBeUndefined();
    expect(h.resolution?.reason).toBe('coverage-gap');
  });

  it('links 里混进 null / 标量 → 不抛，calls 边计数只数合法边', () => {
    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 5 }), symbolNode('a.ts::x')],
      links: [
        null as unknown as GraphEdge,
        'calls' as unknown as GraphEdge,
        callsEdge('a.ts::x', 'a.ts::y'),
      ],
    });
    expect(() => assessCoverage(g)).not.toThrow();
    expect(assessCoverage(g)).toEqual({
      kind: 'gap',
      gap: expect.objectContaining({ callSitesDetected: 5, callEdgesLinked: 1, unlinkedCallSites: 4 }),
    });
    expect(annotate(g, { symbolId: 'a.ts::x' }).annotationDegraded).toBeUndefined();
  });

  it('原型链上的 callSitesCount / unifiedKind 不冒充节点自有记账（hasOwnProperty 收口）', () => {
    const injected = Object.create({ callSitesCount: 9999, unifiedKind: 'module' }) as Record<string, unknown>;
    const g = makeGraph({
      nodes: [
        moduleNode('a.ts', { callSitesCount: 3 }),
        { id: 'ghost.ts', kind: 'component', label: 'ghost', metadata: injected } as unknown as GraphNode,
      ],
    });
    const c = assessCoverage(g);
    // 9999 既没进求和，ghost 也没被算成"必须有记账的 module"
    expect(c).toEqual({
      kind: 'gap',
      gap: expect.objectContaining({ callSitesDetected: 3, callEdgesLinked: 0 }),
    });
  });

  it('小数 callSitesCount 按畸形处理（2.5 个调用点不是测量值）', () => {
    const g = makeGraph({ nodes: [moduleNode('a.ts', { callSitesCount: 2.5 })] });
    expect(assessCoverage(g)).toEqual({
      kind: 'unaccounted',
      reason: 'no-accounting',
      accountedModules: 0,
      totalModules: 1,
    });
  });

  it('decideResolution 读被查节点的 external / exportKind 时同样不被畸形 metadata 击穿', () => {
    const ghost = { id: 'a.ts::x', kind: 'component', label: 'x' } as unknown as GraphNode;
    expect(() =>
      decideResolution(ghost, 'a.ts::x', { kind: 'measured-zero', callSitesDetected: 1, callEdgesLinked: 1 }, []),
    ).not.toThrow();
  });
});

describe('F266-D4 未执行的查询不得下 resolution', () => {
  const g = makeGraph({
    nodes: [moduleNode('a.ts', { callSitesCount: 1 }), symbolNode('a.ts::x')],
    links: [callsEdge('a.ts::x', 'a.ts::y')],
  });

  it('detect_changes 全 unmapped（起点集合为空）→ 无 resolution + resolutionOmitted.no-symbols-in-graph', () => {
    const h = annotate(g, { symbolId: null, resolutionBasis: 'no-symbols-in-graph' });
    expect(h.resolution).toBeUndefined();
    expect(h.resolutionOmitted).toEqual({ reason: 'no-symbols-in-graph' });
    // 缺席不等于沉默：freshness 照常
    expect(h.freshness.verdict.state).toBe('fresh');
  });

  it('A1 / A5 两个既有缺席场景迁移到同一结构化字段（缺席行为不变，只是说出了口）', () => {
    expect(annotate(g, { symbolId: 'a.ts::x', resolutionBasis: 'callers-not-queried' }).resolutionOmitted).toEqual({
      reason: 'callers-not-queried',
    });
    __resetHonestyCache();
    expect(
      annotate(g, { symbolId: 'a.ts::x', resolutionBasis: 'non-caller-oriented-query' }).resolutionOmitted,
    ).toEqual({ reason: 'non-caller-oriented-query' });
  });

  it('resolution 与 resolutionOmitted 互斥；结果集非空时二者皆缺席', () => {
    const withResolution = annotate(g, { symbolId: 'a.ts::x', resolutionBasis: true });
    expect(withResolution.resolution).toBeDefined();
    expect(withResolution.resolutionOmitted).toBeUndefined();
    __resetHonestyCache();
    const nonEmpty = annotate(g, { symbolId: 'a.ts::x', resultsEmpty: false, resolutionBasis: 'no-symbols-in-graph' });
    expect(nonEmpty.resolution).toBeUndefined();
    expect(nonEmpty.resolutionOmitted).toBeUndefined();
  });
});

describe('F266-D5 resolution 缺席时 hint 必须带 hedge', () => {
  const omitted = (reason: 'callers-not-queried' | 'non-caller-oriented-query' | 'no-symbols-in-graph'): GraphHonesty => ({
    freshness: { verdict: FRESH, builderMismatch: null, builderDetail: null },
    resolutionOmitted: { reason },
  });

  it('impact downstream 零结果：不再是一句光秃秃的"受影响范围为空"', () => {
    const hint = generateNextStepHint(
      'impact',
      { topImpacted: [], affected: [] },
      'success',
      omitted('non-caller-oriented-query'),
    );
    expect(hint).toContain('受影响范围为空');
    expect(hint).toContain('callee');
    expect(hint).toContain('零结果不等于');
  });

  it('detect_changes 全 unmapped：明说上游查询未执行', () => {
    const hint = generateNextStepHint(
      'detect_changes',
      { topImpacted: [], totalChanged: 0 },
      'success',
      omitted('no-symbols-in-graph'),
    );
    expect(hint).toContain('上游查询未执行');
  });

  it('缺席声明不弱于"完全不传 honesty"的兜底文案（后者本来就带告诫）', () => {
    const fallback = generateNextStepHint('impact', { topImpacted: [], affected: [] }, 'success');
    const omittedHint = generateNextStepHint(
      'impact',
      { topImpacted: [], affected: [] },
      'success',
      omitted('non-caller-oriented-query'),
    );
    expect(fallback).toContain('不等于确实没有');
    expect(omittedHint.length).toBeGreaterThan('受影响范围为空'.length + 10);
  });
});

/**
 * F266 第三轮审查 E5：hint 层的两个"静默变裸"缺口。
 * E5-1 是编译期约束（穷尽 switch），只能靠新增成因的渲染用例间接证明；
 * E5-2 是运行期缺口：`annotationDegraded` 时 resolution / resolutionOmitted 双双缺席。
 */
/**
 * F266 第三轮审查 E5-3 / E5-4：`decideResolution` 的**节点定位**与**外层属性读取**
 * 补齐与 D3 同一口径。二者都只在畸形/被注入的图产物上才有分别，但那正是外部输入的常态。
 */
describe('F266-E5 节点读取面与 D3 同口径', () => {
  it('E5-3：nodes 里混进 null / 标量时 findNodeById 不击穿（整个信封不该被一个畸形节点打降级）', () => {
    const g = makeGraph({
      nodes: [
        null as unknown as GraphNode,
        'a.ts::x' as unknown as GraphNode,
        moduleNode('a.ts', { callSitesCount: 1 }),
        symbolNode('a.ts::x', { exportKind: 'function' }),
      ],
      links: [callsEdge('a.ts::x', 'a.ts::y')],
    });
    const h = annotate(g, { symbolId: 'a.ts::x' });
    expect(h.annotationDegraded).toBeUndefined();
    // 定位仍然成功：畸形项被跳过，不是提前中断整个扫描
    expect(h.resolution?.reason).toBe('boundary-exposed');
    expect(h.resolution?.evidenceScope).toBe('symbol');
  });

  it('E5-4：原型链上的 metadata / kind 不冒充节点自有属性（外层读取与内层键同口径）', () => {
    const protoMetadata = Object.create({ metadata: { unifiedKind: 'module', callSitesCount: 9999 } }) as GraphNode;
    Object.assign(protoMetadata, { id: 'ghost-meta.ts', label: 'ghost', kind: 'component' });
    const protoKind = Object.create({ kind: 'module' }) as GraphNode;
    Object.assign(protoKind, { id: 'ghost-kind.ts', label: 'ghost2', metadata: {} });

    const g = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 3 }), protoMetadata, protoKind],
    });
    const c = assessCoverage(g);

    // 两个幽灵节点既没贡献 9999 的记账，也没被算进"必须有记账"的 module 分母
    expect(c).toEqual({
      kind: 'gap',
      gap: expect.objectContaining({ callSitesDetected: 3, callEdgesLinked: 0 }),
    });
  });
});

describe('F266-E5 hint 的缺席兜底', () => {
  it('E5-1：新增的 query-constrained-to-zero 成因有专属渲染，不落空串', () => {
    const hint = generateNextStepHint('impact', { topImpacted: [], affected: [] }, 'success', {
      freshness: { verdict: FRESH, builderMismatch: null, builderDetail: null },
      resolutionOmitted: { reason: 'query-constrained-to-zero' },
    });
    expect(hint).toContain('budget/depth');
    expect(hint).toContain('与图内容无关');
    expect(hint).toContain('放宽约束');
  });

  it('E5-2：annotationDegraded 时 hint 必须声明"标注没算出来"，不得比不传 honesty 更裸', () => {
    const degraded: GraphHonesty = {
      freshness: {
        verdict: { state: 'unknown-provenance', recordedSourceCommit: null, currentHead: null },
        builderMismatch: null,
        builderDetail: null,
      },
      annotationDegraded: true,
    };
    const hint = generateNextStepHint('impact', { topImpacted: [], affected: [] }, 'success', degraded);
    const fallback = generateNextStepHint('impact', { topImpacted: [], affected: [] }, 'success');

    expect(hint).toContain('诚实标注计算失败');
    expect(hint).toContain('零结果不等于确实没有');
    // 承重：传了 honesty 反而更裸，就是一次静默 fail-open
    expect(hint.length).toBeGreaterThanOrEqual(fallback.length);
  });

  it('E5-2 对照：未降级时不出现该声明（不给正常路径加噪声）', () => {
    const hint = generateNextStepHint('impact', { topImpacted: [], affected: [] }, 'success', {
      freshness: { verdict: FRESH, builderMismatch: null, builderDetail: null },
      resolution: { reason: 'confirmed-zero', evidenceScope: 'symbol', detail: 'x' },
    });
    expect(hint).not.toContain('诚实标注计算失败');
  });
});

describe('F266-A2 comparisonScope 不在 stale 图上谎报工作树干净', () => {
  const g = makeGraph({ nodes: [symbolNode('a.ts::x')] });

  it('stale（porcelain 从未执行，短路返回）→ null 而非 false', () => {
    const h = annotate(g, { gitRange: 'x...HEAD' }, STALE);
    expect(h.comparisonScope?.uncommittedChangesPresent).toBeNull();
    expect(h.comparisonScope?.detail).toContain('图已陈旧，工作树状态未检测');
  });

  it('stale + 工作树实际有未提交改动 → 仍是 null（"没测量"不得渲染成任何肯定/否定句）', () => {
    const staleWithDirtyTree: GraphFreshnessVerdict = {
      state: 'stale',
      recordedSourceCommit: 'a'.repeat(40),
      currentHead: 'b'.repeat(40),
      staleReasons: ['source-commit'],
    };
    const h = annotate(g, { gitRange: 'x...HEAD' }, staleWithDirtyTree);
    expect(h.comparisonScope?.uncommittedChangesPresent).toBeNull();
    expect(h.comparisonScope?.detail).not.toContain('无未提交的源码改动');
  });

  it('porcelain 读取失败的保守 dirty → null + "检测失败"措辞，不渲染成"确实有"', () => {
    const readFailed: GraphFreshnessVerdict = {
      state: 'dirty',
      recordedSourceCommit: 'a'.repeat(40),
      currentHead: 'a'.repeat(40),
      porcelainReadFailed: true,
    };
    const h = annotate(g, { gitRange: 'x...HEAD' }, readFailed);
    expect(h.comparisonScope?.uncommittedChangesPresent).toBeNull();
    expect(h.comparisonScope?.detail).toContain('检测失败');
    expect(h.comparisonScope?.detail).not.toContain('另有未提交的源码改动，未纳入');
  });

  it('实测得脏（有 dirtyFiles）→ true；fresh（porcelain 跑过且干净）→ false', () => {
    expect(annotate(g, { gitRange: 'x...HEAD' }, DIRTY).comparisonScope?.uncommittedChangesPresent).toBe(true);
    __resetHonestyCache();
    expect(annotate(g, { gitRange: 'x...HEAD' }, FRESH).comparisonScope?.uncommittedChangesPresent).toBe(false);
  });

  it('B6a：detail 声明三点记法比较的是 merge-base，base 分支自身分叉不计入', () => {
    const h = annotate(g, { gitRange: 'x...HEAD' }, FRESH);
    expect(h.comparisonScope?.detail).toContain('merge-base');
  });
});

describe('F266-B5 标注降级时 comparisonScope 不得整体消失（FR-012 fail-open）', () => {
  it('evaluateFreshness 抛错 + baseRef 模式 → 仍带 comparisonScope，工作树状态为 null', () => {
    const g = makeGraph({ nodes: [symbolNode('a.ts::x')] });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const h = buildHonestyAnnotation({
      projectRoot: '/tmp/proj',
      graph: { graphData: g, graphPath: '/g.json', mtimeMs: 1, sizeBytes: 2 },
      symbolId: null,
      resultsEmpty: true,
      resolutionBasis: true,
      gitRange: 'deadbeef...HEAD',
      deps: {
        evaluateFreshnessFn: () => {
          throw new Error('boom');
        },
        now: () => 1,
        getBuilderStampFn: () => null,
      },
    });
    stderrSpy.mockRestore();
    expect(h.annotationDegraded).toBe(true);
    expect(h.comparisonScope?.notation).toBe('three-dot');
    expect(h.comparisonScope?.gitRange).toBe('deadbeef...HEAD');
    expect(h.comparisonScope?.includesUncommitted).toBe(false);
    expect(h.comparisonScope?.uncommittedChangesPresent).toBeNull();
  });
});

describe('F266-B3 缓存与返回体收口', () => {
  const g = makeGraph({ nodes: [symbolNode('a.ts::x')] });

  it('TTL 提到 15s（打得中 agent 的连续调用节奏）', () => {
    expect(FRESHNESS_TTL_MS).toBe(15_000);
  });

  it('时钟回拨 → 判 miss 重新求值，不把缓存条目无限期冻结成假 fresh', () => {
    const spy = vi.fn(() => FRESH);
    const call = (now: number): void => {
      buildHonestyAnnotation({
        projectRoot: '/tmp/proj',
        graph: { graphData: g, graphPath: '/g.json', mtimeMs: 111, sizeBytes: 222 },
        symbolId: 'a.ts::x',
        resultsEmpty: true,
        resolutionBasis: true,
        deps: { evaluateFreshnessFn: spy, now: () => now, getBuilderStampFn: () => null },
      });
    };
    call(1_000_000);
    expect(spy).toHaveBeenCalledTimes(1);
    call(1_000_000 - 60_000); // NTP 校正把时钟拨回 1 分钟
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('dirtyFiles 在 MCP 层截断到前 5 条，并必带全量计数与被截条数', () => {
    const many: GraphFreshnessVerdict = {
      state: 'dirty',
      recordedSourceCommit: 'a'.repeat(40),
      currentHead: 'a'.repeat(40),
      dirtyFiles: Array.from({ length: 42 }, (_, i) => `src/f${i}.ts`),
    };
    const v = annotate(g, { symbolId: 'a.ts::x' }, many).freshness.verdict;
    expect(MCP_DIRTY_FILES_LIMIT).toBe(5);
    expect(v.dirtyFiles).toHaveLength(5);
    expect(v.dirtyFiles?.[0]).toBe('src/f0.ts');
    expect(v.dirtyFileCount).toBe(42);
    expect(v.dirtyFilesTruncated).toBe(37);
  });

  it('未超上限的 dirtyFiles 原样保留，truncated 为 0（截断只在必要时发生）', () => {
    const v = annotate(g, { symbolId: 'a.ts::x' }, DIRTY).freshness.verdict;
    expect(v.dirtyFiles).toEqual(['src/x.ts']);
    expect(v.dirtyFileCount).toBe(1);
    expect(v.dirtyFilesTruncated).toBe(0);
  });

  it('非零结果（resultsEmpty=false）→ coverage 不附加（返回体瘦身）', () => {
    const gapGraph = makeGraph({
      nodes: [moduleNode('a.ts', { callSitesCount: 50 }), symbolNode('a.ts::x')],
      links: [callsEdge('a.ts::x', 'a.ts::y')],
    });
    expect(annotate(gapGraph, { symbolId: 'a.ts::x', resultsEmpty: false }).coverage).toBeUndefined();
  });
});
