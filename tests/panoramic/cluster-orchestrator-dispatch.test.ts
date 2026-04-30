/**
 * cluster-orchestrator — Map 并发调度 + Reduce 重试 + fail-closed 单测
 * 覆盖 T03 / T04：maxConcurrency=4 并发上限、单 cluster 失败继续、
 * <50% 成功 fail-closed、Reduce 重试 1 次、重试仍失败 finalOutput=null
 *
 * Mock 策略：所有 LLM 调用都用 vi.fn() 模拟（不依赖真实 Anthropic SDK）
 */
import { describe, it, expect, vi } from 'vitest';
import {
  clusterDispatch,
  type CallTelemetry,
  type ClusterStrategySingle,
  type ClusterStrategyDirectory,
} from '../../src/panoramic/cluster-orchestrator.js';

interface TestModule {
  id: string;
  path: string;
}

function makeModules(n: number, prefix = 'm'): TestModule[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    path: `src/group${Math.floor(i / 3)}/${prefix}${i}.ts`,
  }));
}

function fakeTelemetry(input = 1000, output = 500, ms = 100): CallTelemetry {
  return { inputTokens: input, outputTokens: output, durationMs: ms, modelId: 'test-model' };
}

describe('clusterDispatch — Map 并发调度', () => {
  it('case 1: 正常流程 3 cluster 并发不超 4', async () => {
    // 9 个 module，directory 策略下分 3 cluster（每 3 个一组）
    const modules = makeModules(9);
    const concurrencyTracker: number[] = [];
    let activeCount = 0;
    let maxObserved = 0;

    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: {
        kind: 'directory',
        getInputPath: (m) => m.path,
      } satisfies ClusterStrategyDirectory<TestModule>,
      sharedHeader: async () => 'shared header',
      map: {
        fn: async (cluster) => {
          activeCount++;
          maxObserved = Math.max(maxObserved, activeCount);
          concurrencyTracker.push(activeCount);
          await new Promise((r) => setTimeout(r, 30));
          activeCount--;
          return { output: `mapped:${cluster.length}`, telemetry: fakeTelemetry() };
        },
        maxConcurrency: 4,
      },
      reduce: {
        fn: async (mapOutputs) => ({
          output: mapOutputs.join('|'),
          telemetry: fakeTelemetry(2000, 800),
        }),
      },
    });

    expect(result.finalOutput).not.toBeNull();
    expect(result.diagnostics.failClosed).toBe(false);
    expect(result.diagnostics.mapSucceeded).toBe(3);
    expect(result.diagnostics.mapFailed).toBe(0);
    // 并发上限校验：观察到的最大并发数不超过 4
    expect(maxObserved).toBeLessThanOrEqual(4);
  });

  it('case 2: 1/3 cluster Map 失败 → 继续，最终成功率 66.7% > 50% 阈值', async () => {
    const modules = makeModules(9);
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'directory', getInputPath: (m) => m.path },
      sharedHeader: async () => 'header',
      map: {
        fn: async (cluster) => {
          // 第一个 cluster (group0) 故意失败
          if (cluster[0].id === 'm0') throw new Error('mock map failure');
          return { output: `mapped:${cluster.length}`, telemetry: fakeTelemetry() };
        },
      },
      reduce: {
        fn: async (mapOutputs) => ({
          output: mapOutputs.join('|'),
          telemetry: fakeTelemetry(),
        }),
      },
    });

    expect(result.diagnostics.mapSucceeded).toBe(2);
    expect(result.diagnostics.mapFailed).toBe(1);
    expect(result.finalOutput).not.toBeNull(); // 66% > 50% 阈值，仍交付
    expect(result.diagnostics.failClosed).toBe(false);
    // mergeConfidence: 1/3 失败 = 33.3% > 30% → low
    expect(result.diagnostics.mergeConfidence).toBe('low');
  });

  it('case 3: <50% Map 成功 → fail-closed，无产物', async () => {
    const modules = makeModules(9); // 3 cluster
    let mapCallCount = 0;
    const reduceFn = vi.fn();

    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'directory', getInputPath: (m) => m.path },
      sharedHeader: async () => 'header',
      map: {
        fn: async () => {
          mapCallCount++;
          // 3 个里 2 个失败 = 66.7% 失败 = 33% 成功 < 50% 阈值
          if (mapCallCount <= 2) throw new Error('mock map failure');
          return { output: 'ok', telemetry: fakeTelemetry() };
        },
      },
      reduce: { fn: reduceFn },
    });

    expect(result.finalOutput).toBeNull();
    expect(result.diagnostics.failClosed).toBe(true);
    expect(result.diagnostics.failClosedReason).toBe('map-below-threshold');
    expect(reduceFn).not.toHaveBeenCalled(); // Reduce 不应被调用
    expect(result.diagnostics.mergeConfidence).toBe('low');
  });

  it('case 4: Map call 超时 → 视为失败', async () => {
    const modules = makeModules(3);
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'single' } satisfies ClusterStrategySingle,
      sharedHeader: async () => 'header',
      map: {
        fn: async () => {
          // 模拟超时：等待远超 perCallTimeout=50ms
          await new Promise((r) => setTimeout(r, 200));
          return { output: 'wont-reach', telemetry: fakeTelemetry() };
        },
        perCallTimeout: 50,
      },
      reduce: {
        fn: async () => ({ output: 'reduced', telemetry: fakeTelemetry() }),
      },
    });

    expect(result.diagnostics.mapSucceeded).toBe(0);
    expect(result.diagnostics.mapFailed).toBe(1);
    expect(result.diagnostics.failClosed).toBe(true);
  });
});

describe('clusterDispatch — Reduce 重试', () => {
  it('case 5: Reduce 第 1 次失败，第 2 次成功 → reduceRetries=1, mergeConfidence=medium', async () => {
    const modules = makeModules(6); // 2 cluster
    let reduceAttempts = 0;
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'directory', getInputPath: (m) => m.path },
      sharedHeader: async () => 'header',
      map: {
        fn: async (cluster) => ({
          output: `mapped:${cluster.length}`,
          telemetry: fakeTelemetry(),
        }),
      },
      reduce: {
        fn: async (mapOutputs) => {
          reduceAttempts++;
          if (reduceAttempts === 1) throw new Error('mock reduce failure');
          return { output: mapOutputs.join('|'), telemetry: fakeTelemetry(2000, 800) };
        },
      },
    });

    expect(result.finalOutput).not.toBeNull();
    expect(result.diagnostics.reduceRetries).toBe(1);
    expect(result.diagnostics.mergeConfidence).toBe('medium');
    expect(reduceAttempts).toBe(2);
  });

  it('case 6: Reduce 重试仍失败 → finalOutput=null + failClosedReason=reduce-failed', async () => {
    const modules = makeModules(6);
    const reduceFn = vi.fn().mockRejectedValue(new Error('persistent reduce failure'));

    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'directory', getInputPath: (m) => m.path },
      sharedHeader: async () => 'header',
      map: {
        fn: async (cluster) => ({
          output: `m:${cluster.length}`,
          telemetry: fakeTelemetry(),
        }),
      },
      reduce: { fn: reduceFn },
    });

    expect(result.finalOutput).toBeNull();
    expect(result.diagnostics.failClosed).toBe(true);
    expect(result.diagnostics.failClosedReason).toBe('reduce-failed');
    expect(result.diagnostics.reduceRetries).toBe(2); // 第 1 次 + 第 2 次都失败
    expect(reduceFn).toHaveBeenCalledTimes(2);
  });

  it('case 7: Reduce 超时 → 视为失败 + 重试', async () => {
    const modules = makeModules(3);
    let attempts = 0;
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'single' },
      sharedHeader: async () => 'header',
      map: {
        fn: async () => ({ output: 'ok', telemetry: fakeTelemetry() }),
      },
      reduce: {
        fn: async () => {
          attempts++;
          if (attempts === 1) {
            await new Promise((r) => setTimeout(r, 200));
            return { output: 'wont-reach', telemetry: fakeTelemetry() };
          }
          return { output: 'recovered', telemetry: fakeTelemetry() };
        },
        timeout: 50,
      },
    });

    // 第 1 次超时，第 2 次成功
    expect(attempts).toBe(2);
    expect(result.finalOutput).toBe('recovered');
    expect(result.diagnostics.reduceRetries).toBe(1);
  });
});

describe('clusterDispatch — sharedHeader 与 hook 异常保护（修复 Codex review CRITICAL [1]）', () => {
  it('sharedHeader 抛错 → fail-closed 不进 Map 阶段 + 保留 FFD diagnostics', async () => {
    // 20 个 module + single 策略 → FFD 必拆分（maxSize=15 默认）
    const modules = makeModules(20);
    const mapFn = vi.fn();
    const reduceFn = vi.fn();
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'single' },
      sharedHeader: async () => {
        throw new Error('mock sharedHeader failure');
      },
      map: { fn: mapFn },
      reduce: { fn: reduceFn },
    });
    expect(result.finalOutput).toBeNull();
    expect(result.diagnostics.failClosed).toBe(true);
    expect(result.diagnostics.failClosedReason).toBe('shared-header-failed');
    expect(mapFn).not.toHaveBeenCalled();
    expect(reduceFn).not.toHaveBeenCalled();
    // 关键：FFD 已经在 sharedHeader 失败之前完成，diagnostics 保留这部分信息
    expect(result.diagnostics.clusterCount).toBeGreaterThan(1);
    expect(result.diagnostics.clusterSplits).toBeGreaterThan(0);
    expect(result.diagnostics.oversizedInputs).toBe(0);
  });

  it('同步 telemetry hook 抛错不破坏 dispatch 主流程（含 onMapFailed）', async () => {
    const modules = makeModules(6);
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'directory', getInputPath: (m) => m.path },
      sharedHeader: async () => 'h',
      map: {
        fn: async (cluster) => {
          // 第 1 个 cluster 故意失败，触发 onMapFailed hook
          if (cluster[0].id === 'm0') throw new Error('boom');
          return { output: 'ok', telemetry: fakeTelemetry() };
        },
      },
      reduce: { fn: async () => ({ output: 'r', telemetry: fakeTelemetry() }) },
      onClusterPlanned: () => {
        throw new Error('mock onClusterPlanned failure');
      },
      onMapStart: () => {
        throw new Error('mock onMapStart failure');
      },
      onMapComplete: () => {
        throw new Error('mock onMapComplete failure');
      },
      onMapFailed: () => {
        throw new Error('mock onMapFailed failure'); // ← 之前未覆盖
      },
      onReduceStart: () => {
        throw new Error('mock onReduceStart failure');
      },
      onReduceComplete: () => {
        throw new Error('mock onReduceComplete failure');
      },
    });
    // 全部 hook（含 onMapFailed）抛错但 dispatch 仍然返回成功结果
    expect(result.finalOutput).not.toBeNull();
    expect(result.diagnostics.failClosed).toBe(false);
    expect(result.diagnostics.mapFailed).toBe(1);
  });

  it('async hook rejected Promise 不破坏 dispatch（修复 Codex 二轮 CRITICAL）', async () => {
    const modules = makeModules(6);
    // 全部 hook 写成 async，rejected — 之前的实现会抛 unhandledRejection
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'directory', getInputPath: (m) => m.path },
      sharedHeader: async () => 'h',
      map: { fn: async () => ({ output: 'ok', telemetry: fakeTelemetry() }) },
      reduce: { fn: async () => ({ output: 'r', telemetry: fakeTelemetry() }) },
      // TypeScript: () => void 类型仍允许 async callback（隐式 Promise<void>）
      onClusterPlanned: (async () => {
        throw new Error('async onClusterPlanned rejection');
      }) as () => void,
      onMapComplete: (async () => {
        throw new Error('async onMapComplete rejection');
      }) as () => void,
      onReduceComplete: (async () => {
        throw new Error('async onReduceComplete rejection');
      }) as () => void,
    });
    expect(result.finalOutput).not.toBeNull();
    expect(result.diagnostics.failClosed).toBe(false);
    // 等一个 microtask 确保所有 Promise rejection 已被 .catch 吞掉，无 unhandled
    await new Promise((r) => setImmediate(r));
  });
});

describe('clusterDispatch — AbortSignal 透传（修复 Codex review WARNING [4]）', () => {
  it('Map 超时时 signal 触发 abort，调用方可感知（如转发给 SDK 真正取消）', async () => {
    const modules = makeModules(3);
    let signalAborted = false;
    let signalReceived: AbortSignal | undefined;
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'single' },
      sharedHeader: async () => 'h',
      map: {
        fn: async (_, __, signal) => {
          signalReceived = signal;
          // 监听 abort 事件以模拟"调用方真的处理 signal"
          signal?.addEventListener('abort', () => {
            signalAborted = true;
          });
          // 故意挂起远超 timeout
          await new Promise((r) => setTimeout(r, 200));
          return { output: 'wont-reach', telemetry: fakeTelemetry() };
        },
        perCallTimeout: 30,
      },
      reduce: { fn: async () => ({ output: 'r', telemetry: fakeTelemetry() }) },
    });

    // signal 被传递给了 map.fn
    expect(signalReceived).toBeInstanceOf(AbortSignal);
    // 超时后 signal.aborted === true（withTimeoutAndSignal 调用了 controller.abort）
    expect(signalAborted).toBe(true);
    // dispatch 仍 fail-closed（< 50% 成功）
    expect(result.diagnostics.failClosed).toBe(true);
  });

  it('Reduce 超时时也透传 signal', async () => {
    const modules = makeModules(3);
    let reduceSignalReceived: AbortSignal | undefined;
    let attempts = 0;
    await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'single' },
      sharedHeader: async () => 'h',
      map: { fn: async () => ({ output: 'ok', telemetry: fakeTelemetry() }) },
      reduce: {
        fn: async (_, __, signal) => {
          attempts++;
          reduceSignalReceived = signal;
          // 第 1 次故意超时
          if (attempts === 1) {
            await new Promise((r) => setTimeout(r, 200));
          }
          return { output: 'r', telemetry: fakeTelemetry() };
        },
        timeout: 30,
      },
    });
    expect(reduceSignalReceived).toBeInstanceOf(AbortSignal);
  });
});

describe('clusterDispatch — diagnostics oversizedInputs 量化巨型 input', () => {
  it('FFD 检测到的 oversized input 数被报告到 diagnostics', async () => {
    // 单 input 200k tokens 远超默认 budget 85k
    const modules: TestModule[] = [
      { id: 'giant', path: 'src/giant.ts' },
      { id: 'normal1', path: 'src/n1.ts' },
      { id: 'normal2', path: 'src/n2.ts' },
    ];
    const result = await clusterDispatch<TestModule, string, string>({
      inputs: modules,
      clusterStrategy: { kind: 'single' },
      sharedHeader: async () => 'h',
      map: { fn: async () => ({ output: 'ok', telemetry: fakeTelemetry() }) },
      reduce: { fn: async () => ({ output: 'r', telemetry: fakeTelemetry() }) },
      tokenBudget: {
        totalBudget: 100_000,
        sharedHeaderBudget: 15_000,
        // 每个 module 的 token 估算：giant=200k, others=10k
        estimateInputTokens: (input) => ((input as TestModule).id === 'giant' ? 200_000 : 10_000),
      },
    });
    expect(result.diagnostics.oversizedInputs).toBe(1);
    // 仍然成功交付（零模块丢失 + caller 没有真的去截断）
    expect(result.finalOutput).not.toBeNull();
  });
});
