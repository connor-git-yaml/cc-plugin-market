/**
 * cluster-orchestrator — 聚类策略 fallback chain + FFD 装箱拆分单测
 * 覆盖 T02 / T06：community → directory → single fallback；
 * 超 maxSize 或超 token budget 时按 first-fit-decreasing 装箱（零模块丢失）
 *
 * 测试位置：与 community-detector.test.ts 一致放在 tests/ 下
 * （遵循现有惯例，而非 spec 中的 src/panoramic/__tests__/）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';
import {
  __internal,
  DEFAULT_COMMUNITY_MAX_SIZE,
  type ClusterStrategyCommunity,
  type ClusterStrategyDirectory,
} from '../../src/panoramic/cluster-orchestrator.js';

// 模拟 community-detector：测试 fallback 链路时通过 vi.mock 控制 Louvain 行为
vi.mock('../../src/panoramic/community/community-detector.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/panoramic/community/community-detector.js')>(
    '../../src/panoramic/community/community-detector.js',
  );
  return actual;
});

interface TestModule {
  id: string;
  path: string;
  contentSize: number;
}

function makeModule(id: string, path: string, contentSize = 100): TestModule {
  return { id, path, contentSize };
}

function makeGraphJSON(nodeIds: string[], edges: Array<[string, string]>): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'test',
      generatedAt: new Date().toISOString(),
      nodeCount: nodeIds.length,
      edgeCount: edges.length,
      sources: ['architecture-ir'],
      schemaVersion: '1.0',
    },
    nodes: nodeIds.map((id) => ({ id, kind: 'module', label: id, metadata: {} })),
    links: edges.map(([s, t]) => ({
      source: s,
      target: t,
      relation: 'depends-on',
      confidence: 'EXTRACTED',
      confidenceScore: 0.95,
    })),
  };
}

describe('applyClusteringStrategy — fallback chain', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('case 1: Louvain 成功 → community clusters', () => {
    // 两个明显社区 {a,b,c} 和 {d,e,f}，各内部紧密，仅 1 条跨社区边
    const inputs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => makeModule(id, `src/${id}.ts`));
    const graph = makeGraphJSON(
      ['a', 'b', 'c', 'd', 'e', 'f'],
      [
        ['a', 'b'], ['b', 'c'], ['a', 'c'],
        ['d', 'e'], ['e', 'f'], ['d', 'f'],
        ['c', 'd'], // 跨社区边
      ],
    );
    const strategy: ClusterStrategyCommunity<TestModule> = {
      kind: 'community',
      graph,
      getInputId: (m) => m.id,
    };
    const result = __internal.applyClusteringStrategy(inputs, strategy, 3);
    expect(result.appliedStrategy).toBe('community');
    expect(result.clusters.length).toBeGreaterThanOrEqual(2);
    // 所有 input 都被分配
    const totalNodes = result.clusters.reduce((acc, c) => acc + c.length, 0);
    expect(totalNodes).toBe(inputs.length);
  });

  it('case 2: Louvain 抛异常 → fallback directory（通过 directoryFallback 显式字段）', () => {
    const inputs = [
      makeModule('a', 'src/foo/a.ts'),
      makeModule('b', 'src/foo/b.ts'),
      makeModule('c', 'src/bar/c.ts'),
      makeModule('d', 'src/bar/d.ts'),
    ];
    // 故意构造空 graph（loadGraph 会忽略全部 input id），导致 community 产 0 社区 → 抛降级
    const emptyGraph = makeGraphJSON([], []);
    const strategy: ClusterStrategyCommunity<TestModule> = {
      kind: 'community',
      graph: emptyGraph,
      getInputId: (m) => m.id,
      // 显式声明 community 失败时的 directory 降级路径访问器（修复 Codex review WARNING [3]）
      directoryFallback: { getInputPath: (m) => m.path },
    };
    const result = __internal.applyClusteringStrategy(inputs, strategy, 3);
    expect(result.appliedStrategy).toBe('directory');
    expect(result.clusters.length).toBe(2); // src/foo 和 src/bar 两组
  });

  it('case 2b: community 失败但未提供 directoryFallback → 直接 single', () => {
    // 验证两级 fallback 退化路径：community 失败但 strategy 没有 directoryFallback
    const inputs = [
      makeModule('a', 'src/a.ts'),
      makeModule('b', 'src/b.ts'),
      makeModule('c', 'src/c.ts'),
    ];
    const strategy: ClusterStrategyCommunity<TestModule> = {
      kind: 'community',
      graph: makeGraphJSON([], []), // 空 graph 导致 community 失败
      getInputId: (m) => m.id,
      // 不提供 directoryFallback
    };
    const result = __internal.applyClusteringStrategy(inputs, strategy, 3);
    expect(result.appliedStrategy).toBe('single');
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]).toHaveLength(3);
  });

  it('case 3: directory 抛异常 → fallback single', () => {
    const inputs = [
      makeModule('a', 'src/foo/a.ts'),
      makeModule('b', 'src/bar/b.ts'),
      makeModule('c', 'src/baz/c.ts'),
    ];
    const strategy: ClusterStrategyDirectory<TestModule> = {
      kind: 'directory',
      getInputPath: () => {
        throw new Error('mock directory failure');
      },
    };
    const result = __internal.applyClusteringStrategy(inputs, strategy, 3);
    expect(result.appliedStrategy).toBe('single');
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]).toHaveLength(3);
  });

  it('case 4: input 数 < minSize=3 → 直接 single', () => {
    const inputs = [makeModule('a', 'src/a.ts'), makeModule('b', 'src/b.ts')];
    const strategy: ClusterStrategyCommunity<TestModule> = {
      kind: 'community',
      graph: makeGraphJSON(['a', 'b'], []),
      getInputId: (m) => m.id,
      minSize: 3,
    };
    const result = __internal.applyClusteringStrategy(inputs, strategy, 3);
    expect(result.appliedStrategy).toBe('single');
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]).toHaveLength(2);
  });

  it('case 5: directory 策略下 zero 模块丢失 (orphan 也独立成 cluster)', () => {
    const inputs = [
      makeModule('a', 'src/foo/a.ts'),
      makeModule('b', 'src/foo/b.ts'),
      makeModule('c', 'src/foo/c.ts'),
      makeModule('d', 'src/bar/d.ts'),
      makeModule('e', 'src/baz/e.ts'),
    ];
    const strategy: ClusterStrategyDirectory<TestModule> = {
      kind: 'directory',
      getInputPath: (m) => m.path,
    };
    const result = __internal.applyClusteringStrategy(inputs, strategy, 3);
    const allInputs = result.clusters.flat();
    expect(new Set(allInputs)).toEqual(new Set(inputs)); // Set 等价：零丢失
    expect(allInputs).toHaveLength(inputs.length);
  });
});

describe('splitClusterByFFD — 装箱拆分（修复 Codex review finding 2）', () => {
  it('case 1: cluster 合规则不拆分（同一引用）', () => {
    const cluster = [makeModule('a', 'a.ts'), makeModule('b', 'b.ts')];
    const result = __internal.splitClusterByFFD(
      cluster,
      DEFAULT_COMMUNITY_MAX_SIZE,
      100_000,
      __internal.defaultEstimateTokens,
    );
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0]).toEqual(cluster);
    expect(result.oversizedCount).toBe(0);
  });

  it('case 2: cluster 超 maxSize=15 时拆分，零模块丢失', () => {
    const cluster: TestModule[] = [];
    for (let i = 0; i < 20; i++) {
      cluster.push(makeModule(`m${i}`, `src/m${i}.ts`, 50));
    }
    const result = __internal.splitClusterByFFD(
      cluster,
      DEFAULT_COMMUNITY_MAX_SIZE,
      100_000,
      () => 100,
    );
    expect(result.bins.length).toBeGreaterThan(1);
    const allInputs = result.bins.flat();
    expect(allInputs).toHaveLength(20);
    expect(new Set(allInputs.map((m) => m.id))).toEqual(new Set(cluster.map((m) => m.id)));
    for (const bin of result.bins) {
      expect(bin.length).toBeLessThanOrEqual(DEFAULT_COMMUNITY_MAX_SIZE);
    }
    expect(result.oversizedCount).toBe(0);
  });

  it('case 3: cluster 超 token budget 时拆分（按降序 first-fit），零模块丢失', () => {
    const cluster: TestModule[] = [];
    for (let i = 0; i < 5; i++) {
      cluster.push(makeModule(`big${i}`, `src/big${i}.ts`));
    }
    const tokenBudget = 85_000;
    const result = __internal.splitClusterByFFD(
      cluster,
      DEFAULT_COMMUNITY_MAX_SIZE,
      tokenBudget,
      () => 30_000,
    );
    expect(result.bins.length).toBeGreaterThan(1);
    const allInputs = result.bins.flat();
    expect(new Set(allInputs.map((m) => m.id))).toEqual(new Set(cluster.map((m) => m.id)));
    for (const bin of result.bins) {
      const binTokens = bin.length * 30_000;
      expect(binTokens).toBeLessThanOrEqual(tokenBudget);
    }
    expect(result.oversizedCount).toBe(0); // 单个 30k 不超 85k budget
  });

  it('case 4: 模块大小不均时优先大模块（FFD 降序）', () => {
    const cluster: TestModule[] = [
      makeModule('huge', 'src/huge.ts', 80_000),
      makeModule('small1', 'src/s1.ts', 5_000),
      makeModule('small2', 'src/s2.ts', 5_000),
      makeModule('small3', 'src/s3.ts', 5_000),
      makeModule('medium', 'src/m.ts', 40_000),
    ];
    const tokenBudget = 85_000;
    const result = __internal.splitClusterByFFD(
      cluster,
      DEFAULT_COMMUNITY_MAX_SIZE,
      tokenBudget,
      (input) => (input as TestModule).contentSize,
    );
    const allIds = new Set(result.bins.flat().map((m) => m.id));
    expect(allIds).toEqual(new Set(cluster.map((m) => m.id)));
    expect(result.bins[0].some((m) => m.id === 'huge')).toBe(true);
    expect(result.oversizedCount).toBe(0);
  });

  it('case 5: 不出现 clusterTruncated 字段（FFD 完全替代截断逻辑）', () => {
    const cluster = [
      makeModule('a', 'src/a.ts', 50_000),
      makeModule('b', 'src/b.ts', 50_000),
      makeModule('c', 'src/c.ts', 50_000),
    ];
    const result = __internal.splitClusterByFFD(
      cluster,
      DEFAULT_COMMUNITY_MAX_SIZE,
      85_000,
      (input) => (input as TestModule).contentSize,
    );
    expect(Array.isArray(result.bins)).toBe(true);
    for (const bin of result.bins) {
      expect(Array.isArray(bin)).toBe(true);
      for (const item of bin) {
        expect(Object.keys(item).sort()).toEqual(['contentSize', 'id', 'path']);
      }
    }
  });

  it('case 6: 巨型 input（单个 token > budget）保留进 bin + oversizedCount 量化（修复 Codex review CRITICAL [2]）', () => {
    // 1 个超大 input（200k）+ 2 个普通 input（10k）
    const cluster: TestModule[] = [
      makeModule('giant', 'src/giant.ts', 200_000),
      makeModule('a', 'src/a.ts', 10_000),
      makeModule('b', 'src/b.ts', 10_000),
    ];
    const tokenBudget = 85_000;
    const result = __internal.splitClusterByFFD(
      cluster,
      DEFAULT_COMMUNITY_MAX_SIZE,
      tokenBudget,
      (input) => (input as TestModule).contentSize,
    );
    // 零模块丢失：giant 仍在某 bin
    const allIds = new Set(result.bins.flat().map((m) => m.id));
    expect(allIds).toEqual(new Set(cluster.map((m) => m.id)));
    // 量化报告：giant 被识别为 oversized
    expect(result.oversizedCount).toBe(1);
    // giant 单独占一个 bin（无法和其他 input 合并，因为已超 budget）
    const giantBin = result.bins.find((bin) => bin.some((m) => m.id === 'giant'));
    expect(giantBin).toBeDefined();
    expect(giantBin!).toHaveLength(1);
  });

  it('case 7: tokenBudget=0 边界 → 全部 input 视为 oversized 但无丢失', () => {
    const cluster = [
      makeModule('a', 'src/a.ts', 100),
      makeModule('b', 'src/b.ts', 100),
    ];
    const result = __internal.splitClusterByFFD(
      cluster,
      DEFAULT_COMMUNITY_MAX_SIZE,
      0,
      (input) => (input as TestModule).contentSize,
    );
    // 零模块丢失
    expect(result.bins.flat()).toHaveLength(2);
    // 全部 oversized
    expect(result.oversizedCount).toBe(2);
  });

  it('case 8: 组合用例 — cluster.length > maxSize 且含巨型 input（修复 Codex 二轮盲区）', () => {
    // 20 个普通 module（每 5k）+ 1 个巨型 module（150k）；maxSize=15、budget=85k
    const cluster: TestModule[] = [];
    for (let i = 0; i < 20; i++) {
      cluster.push(makeModule(`m${i}`, `src/m${i}.ts`, 5_000));
    }
    cluster.push(makeModule('giant', 'src/giant.ts', 150_000));
    const tokenBudget = 85_000;
    const result = __internal.splitClusterByFFD(
      cluster,
      DEFAULT_COMMUNITY_MAX_SIZE,
      tokenBudget,
      (input) => (input as TestModule).contentSize,
    );
    // 零模块丢失
    const allIds = new Set(result.bins.flat().map((m) => m.id));
    expect(allIds).toEqual(new Set(cluster.map((m) => m.id)));
    expect(result.bins.flat()).toHaveLength(21);
    // giant 被识别为 oversized
    expect(result.oversizedCount).toBe(1);
    // 至少 2 个 bin（21 个 input 不可能塞进一个 maxSize=15 的 bin）
    expect(result.bins.length).toBeGreaterThanOrEqual(2);
    // 每个 bin 的 size ≤ maxSize（除 giant 独占的那个）
    for (const bin of result.bins) {
      expect(bin.length).toBeLessThanOrEqual(DEFAULT_COMMUNITY_MAX_SIZE);
    }
  });
});

describe('dirname helper（OS-agnostic）', () => {
  it('返回路径目录', () => {
    expect(__internal.dirname('src/foo/bar.ts')).toBe('src/foo');
    expect(__internal.dirname('a.ts')).toBe('.');
    expect(__internal.dirname('/abs/path/file.ts')).toBe('/abs/path');
  });

  it('Windows 路径转为正斜杠', () => {
    expect(__internal.dirname('src\\foo\\bar.ts')).toBe('src/foo');
  });
});
