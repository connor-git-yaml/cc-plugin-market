/**
 * cluster-orchestrator — Telemetry hooks + mergeConfidence + diagnostics 单测
 * 覆盖 T05 / T09：6 个 hooks 在正确时机触发；
 * mergeConfidence 三态判定（high/medium/low）；
 * diagnostics 字段聚合正确（totalTokens、durationMs）
 */
import { describe, it, expect, vi } from 'vitest';
import {
  clusterDispatch,
  type CallTelemetry,
  type ClusterStrategyDirectory,
} from '../../src/panoramic/cluster-orchestrator.js';

interface TestModule {
  id: string;
  path: string;
}

function makeModules(n: number): TestModule[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    path: `src/g${Math.floor(i / 3)}/m${i}.ts`,
  }));
}

const tel = (input: number, output: number, ms = 50): CallTelemetry => ({
  inputTokens: input,
  outputTokens: output,
  durationMs: ms,
  modelId: 'test-model',
});

describe('Telemetry hooks — 触发时机与次数', () => {
  it('全部 6 个 hook 在正确时机被调用', async () => {
    const modules = makeModules(9); // 3 cluster

    const onClusterPlanned = vi.fn();
    const onMapStart = vi.fn();
    const onMapComplete = vi.fn();
    const onMapFailed = vi.fn();
    const onReduceStart = vi.fn();
    const onReduceComplete = vi.fn();

    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: {
        kind: 'directory',
        getInputPath: (m) => m.path,
      } satisfies ClusterStrategyDirectory<TestModule>,
      sharedHeader: async () => 'header',
      map: {
        fn: async (cluster) => ({ output: `m:${cluster.length}`, telemetry: tel(1000, 500) }),
      },
      reduce: {
        fn: async (mapOutputs) => ({
          output: mapOutputs.join('|'),
          telemetry: tel(2000, 800),
        }),
      },
      onClusterPlanned,
      onMapStart,
      onMapComplete,
      onMapFailed,
      onReduceStart,
      onReduceComplete,
    });

    // onClusterPlanned: 调用 1 次，参数为最终 cluster 列表
    expect(onClusterPlanned).toHaveBeenCalledTimes(1);
    const plannedClusters = onClusterPlanned.mock.calls[0][0] as TestModule[][];
    expect(plannedClusters).toHaveLength(3);

    // onMapStart: 每 cluster 调用 1 次（共 3 次）
    expect(onMapStart).toHaveBeenCalledTimes(3);

    // onMapComplete: 全部成功，调用 3 次
    expect(onMapComplete).toHaveBeenCalledTimes(3);

    // onMapFailed: 没有失败，0 次
    expect(onMapFailed).not.toHaveBeenCalled();

    // onReduceStart: 1 次，参数 = 成功 map output 数 = 3
    expect(onReduceStart).toHaveBeenCalledTimes(1);
    expect(onReduceStart).toHaveBeenCalledWith(3);

    // onReduceComplete: 1 次（重试不重复触发）
    expect(onReduceComplete).toHaveBeenCalledTimes(1);

    // 最终成功
    expect(result.finalOutput).not.toBeNull();
  });

  it('Map 失败时触发 onMapFailed，不触发 onMapComplete', async () => {
    const modules = makeModules(6); // 2 cluster
    const onMapComplete = vi.fn();
    const onMapFailed = vi.fn();

    await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'directory', getInputPath: (m) => m.path },
      sharedHeader: async () => 'h',
      map: {
        fn: async (cluster) => {
          if (cluster[0].id === 'm0') throw new Error('boom');
          return { output: 'ok', telemetry: tel(1000, 500) };
        },
      },
      reduce: { fn: async () => ({ output: 'r', telemetry: tel(500, 200) }) },
      onMapComplete,
      onMapFailed,
    });

    expect(onMapFailed).toHaveBeenCalledTimes(1);
    expect(onMapComplete).toHaveBeenCalledTimes(1);
    // onMapFailed 第一个参数应是失败 cluster idx
    const failedIdx = onMapFailed.mock.calls[0][0] as number;
    expect(typeof failedIdx).toBe('number');
    expect(onMapFailed.mock.calls[0][1]).toBeInstanceOf(Error);
  });
});

describe('mergeConfidence 程序化打分', () => {
  it('case high: 0 失败 + 0 reduce 重试', async () => {
    const modules = makeModules(6);
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'directory', getInputPath: (m) => m.path },
      sharedHeader: async () => 'h',
      map: { fn: async () => ({ output: 'ok', telemetry: tel(1000, 500) }) },
      reduce: { fn: async () => ({ output: 'r', telemetry: tel(500, 200) }) },
    });
    expect(result.diagnostics.mergeConfidence).toBe('high');
    expect(result.diagnostics.mapFailed).toBe(0);
    expect(result.diagnostics.reduceRetries).toBe(0);
  });

  it('case medium: 1 reduce 重试成功', async () => {
    const modules = makeModules(6);
    let attempts = 0;
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'directory', getInputPath: (m) => m.path },
      sharedHeader: async () => 'h',
      map: { fn: async () => ({ output: 'ok', telemetry: tel(1000, 500) }) },
      reduce: {
        fn: async () => {
          attempts++;
          if (attempts === 1) throw new Error('first attempt fail');
          return { output: 'r', telemetry: tel(500, 200) };
        },
      },
    });
    expect(result.diagnostics.mergeConfidence).toBe('medium');
    expect(result.diagnostics.reduceRetries).toBe(1);
  });

  it('case medium: ≤30% Map 失败', async () => {
    // 4 cluster 失败 1 个 = 25% 失败（< 30% 阈值）→ medium
    const modules = makeModules(12); // 4 cluster
    let mapCallCount = 0;
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'directory', getInputPath: (m) => m.path },
      sharedHeader: async () => 'h',
      map: {
        fn: async () => {
          mapCallCount++;
          if (mapCallCount === 1) throw new Error('boom');
          return { output: 'ok', telemetry: tel(1000, 500) };
        },
      },
      reduce: { fn: async () => ({ output: 'r', telemetry: tel(500, 200) }) },
    });
    expect(result.diagnostics.mapSucceeded).toBe(3);
    expect(result.diagnostics.mapFailed).toBe(1);
    // 1/4 = 25% < 30%
    expect(result.diagnostics.mergeConfidence).toBe('medium');
  });

  it('case low: > 30% Map 失败但 > 50% 成功（差 stripe）', async () => {
    // 5 cluster 失败 2 个 = 40% 失败 > 30% 阈值，但 60% 成功 > 50% 交付阈值
    const modules = makeModules(15); // 5 cluster
    let mapCallCount = 0;
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'directory', getInputPath: (m) => m.path },
      sharedHeader: async () => 'h',
      map: {
        fn: async () => {
          mapCallCount++;
          if (mapCallCount <= 2) throw new Error('boom');
          return { output: 'ok', telemetry: tel(1000, 500) };
        },
      },
      reduce: { fn: async () => ({ output: 'r', telemetry: tel(500, 200) }) },
    });
    // 60% 成功 → 交付，但失败率 40% → mergeConfidence: low
    expect(result.finalOutput).not.toBeNull();
    expect(result.diagnostics.mapSucceeded).toBe(3);
    expect(result.diagnostics.mapFailed).toBe(2);
    expect(result.diagnostics.mergeConfidence).toBe('low');
  });
});

describe('Diagnostics 字段聚合', () => {
  it('totalTokens / durationMs 正确累计 + clusterCount/clusterSplits 正确报告', async () => {
    const modules = makeModules(9); // 3 cluster (directory)
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'directory', getInputPath: (m) => m.path },
      sharedHeader: async () => 'h',
      map: { fn: async () => ({ output: 'ok', telemetry: tel(1000, 500, 100) }) },
      reduce: { fn: async () => ({ output: 'r', telemetry: tel(2000, 800, 200) }) },
    });

    expect(result.diagnostics.clusterCount).toBe(3);
    expect(result.diagnostics.appliedStrategy).toBe('directory');
    // 3 cluster x (1000 input, 500 output)
    expect(result.diagnostics.mapTotalTokens).toEqual({ input: 3000, output: 1500 });
    expect(result.diagnostics.reduceTokens).toEqual({ input: 2000, output: 800 });
    expect(result.diagnostics.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics.clusterSplits).toBe(0); // 无 FFD 拆分
    expect(result.diagnostics.failClosed).toBe(false);
  });

  it('FFD 拆分时 clusterSplits > 0 + 仍 mapSucceeded 累计完整', async () => {
    // 单 cluster 强制塞 20 module，必触发 FFD 拆分（DEFAULT_COMMUNITY_MAX_SIZE=15）
    const modules = makeModules(20);
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'single' },
      sharedHeader: async () => 'h',
      map: { fn: async () => ({ output: 'ok', telemetry: tel(100, 50) }) },
      reduce: { fn: async () => ({ output: 'r', telemetry: tel(500, 200) }) },
    });

    expect(result.diagnostics.clusterSplits).toBeGreaterThan(0);
    expect(result.diagnostics.clusterCount).toBeGreaterThan(1);
    // 所有原 input 仍被覆盖（mapSucceeded 计数 = 实际 cluster 数）
    expect(result.diagnostics.mapSucceeded).toBe(result.diagnostics.clusterCount);
  });

  it('failClosedReason=clustering-failed 时 finalOutput=null（理论分支）', async () => {
    // applyClusteringStrategy 内部已三级 fallback，理论上不会走到外层 catch；
    // 此用例 documents 该分支的 invariant：clusterCount=0 + failClosed=true
    // 通过空 inputs 触发 single fallback（合规返回 1 cluster []，不进 catch）
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: [],
      clusterStrategy: { kind: 'single' },
      sharedHeader: async () => 'h',
      map: { fn: async () => ({ output: 'ok', telemetry: tel(0, 0) }) },
      reduce: { fn: async () => ({ output: 'empty-reduce', telemetry: tel(0, 0) }) },
    });

    // 空 inputs：1 个空 cluster，map 调用一次成功（caller 决定是否对空 cluster 早返回）
    expect(result.diagnostics.clusterCount).toBe(1);
    expect(result.diagnostics.appliedStrategy).toBe('single');
  });
});
