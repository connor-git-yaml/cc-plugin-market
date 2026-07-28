/**
 * Feature 146: LLM 并发优化器 E2E 测试
 *
 * 验证 batch-orchestrator 在使用 p-limit 替换手写信号量后的关键属性：
 * - SC-003：concurrency=N 时同时活跃的 LLM 调用 ≤ N 且 > 1（并发真的触发）
 * - SC-004：单模块失败被隔离到 BatchResult.failed[]，其余模块仍能成功
 * - SC-005：tokenUsage 跨模块累加准确（JS 单线程保证 += 安全性）
 * - SC-006：并行加速效果 —— concurrency=3 的 LLM 调用时间线平均并发度显著高于
 *   concurrency=1（F233 链 H 起改用时间线重叠度，不再比较真实墙钟）
 *
 * Mock 策略沿用 F144 的 vi.hoisted() + vi.mock('@anthropic-ai/sdk')，
 * 通过闭包暴露并发计数器与调用起止时间线，捕获并发上限与并发密度。
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Mock 基础设施（vi.hoisted + 并发计数器） ──────────────────────────────────
const mocks = vi.hoisted(() => {
  const MOCK_SPEC_MARKDOWN = `
## 1. 意图

并发 E2E mock 模块。

## 2. 业务逻辑

mock LLM 返回，仅供 batch pipeline 流程跑通。

## 3. 接口定义

| 名称 | 类型 | 签名 |
|------|------|------|
| compute | function | (Input) => number |

## 4. 数据结构

Input 接口。

## 5. 约束条件

- 输入合法。

## 6. 边界条件

- 空数组返回 0。

## 7. 技术债务

无。

## 8. 测试覆盖

mock 覆盖。

## 9. 依赖关系

零外部依赖。
`.trim();

  // 并发计数器：每次 mockCreate 进入时 +1，离开时 -1
  // maxConcurrentCalls 跟踪历史峰值，用于断言上限
  let concurrentCalls = 0;
  let maxConcurrentCalls = 0;
  let totalCalls = 0;

  // F233 链 H：记录每次 LLM 调用的起止时刻，供 SC-006 用「时间线重叠」而非
  // 真实墙钟衡量并发加速（墙钟在共享 CI runner 上测的是机器负载而非并发正确性）
  const callIntervals: Array<{ startedAt: number; endedAt: number }> = [];

  // 行为开关：测试用例可改写以模拟特殊场景
  const behavior: {
    delayMs: number;
    failOnContentSubstring: string | null; // prompt 命中此字符串时所有调用都失败（用于精准失败某模块）
    inputTokensPerCall: number;
    outputTokensPerCall: number;
  } = {
    delayMs: 0,
    failOnContentSubstring: null,
    inputTokensPerCall: 100,
    outputTokensPerCall: 200,
  };

  const mockCreate = vi.fn().mockImplementation(async (req: { messages?: Array<{ content?: unknown }> }) => {
    concurrentCalls += 1;
    totalCalls += 1;
    if (concurrentCalls > maxConcurrentCalls) {
      maxConcurrentCalls = concurrentCalls;
    }
    const callIndex = totalCalls;
    const startedAt = Date.now();
    try {
      if (behavior.delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, behavior.delayMs));
      }
      if (behavior.failOnContentSubstring !== null) {
        // 把所有 messages content 拼成纯字符串后 substring 匹配
        const promptText = JSON.stringify(req?.messages ?? []);
        if (promptText.includes(behavior.failOnContentSubstring)) {
          throw new Error(`Network error (mock) for content "${behavior.failOnContentSubstring}"`);
        }
      }
      return {
        id: `msg_concurrency_${callIndex}`,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: MOCK_SPEC_MARKDOWN }],
        model: 'claude-sonnet-4-6-20261001',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: behavior.inputTokensPerCall,
          output_tokens: behavior.outputTokensPerCall,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      };
    } finally {
      concurrentCalls -= 1;
      callIntervals.push({ startedAt, endedAt: Date.now() });
    }
  });

  const reset = (): void => {
    concurrentCalls = 0;
    maxConcurrentCalls = 0;
    totalCalls = 0;
    callIntervals.length = 0;
    behavior.delayMs = 0;
    behavior.failOnContentSubstring = null;
    behavior.inputTokensPerCall = 100;
    behavior.outputTokensPerCall = 200;
    mockCreate.mockClear();
  };

  return {
    mockCreate,
    behavior,
    reset,
    getMetrics: (): { maxConcurrentCalls: number; totalCalls: number } => ({
      maxConcurrentCalls,
      totalCalls,
    }),
    getCallIntervals: (): Array<{ startedAt: number; endedAt: number }> =>
      callIntervals.map((interval) => ({ ...interval })),
  };
});

/**
 * F233 链 H：LLM 调用时间线的并发密度指标。
 *
 * - busyMs：所有调用时长之和（LLM「忙时」总量）
 * - activeWindowMs：这些区间的**并集**长度（真正有调用在跑的时间，自动排除
 *   调用之间的空档，因此不受 skeleton 采集等串行前置阶段影响）
 * - averageConcurrency = busyMs / activeWindowMs：活跃窗口内的平均并发度。
 *   顺序执行时区间互不重叠 → 并集 = 总和 → 恒为 1；真并发时 → 显著 > 1。
 *
 * 该比值只描述「调用之间是否真的重叠」，不含任何绝对速度量：宿主变慢会让每个
 * 区间同步拉长，比值不变，因此对 CI 负载免疫。
 */
function summarizeConcurrency(
  intervals: Array<{ startedAt: number; endedAt: number }>,
): { busyMs: number; activeWindowMs: number; averageConcurrency: number } {
  const busyMs = intervals.reduce((sum, i) => sum + (i.endedAt - i.startedAt), 0);

  const sorted = [...intervals].sort((a, b) => a.startedAt - b.startedAt);
  let activeWindowMs = 0;
  let mergedStart: number | null = null;
  let mergedEnd = 0;
  for (const interval of sorted) {
    if (mergedStart === null) {
      mergedStart = interval.startedAt;
      mergedEnd = interval.endedAt;
      continue;
    }
    if (interval.startedAt <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, interval.endedAt);
    } else {
      activeWindowMs += mergedEnd - mergedStart;
      mergedStart = interval.startedAt;
      mergedEnd = interval.endedAt;
    }
  }
  if (mergedStart !== null) {
    activeWindowMs += mergedEnd - mergedStart;
  }

  return {
    busyMs,
    activeWindowMs,
    averageConcurrency: activeWindowMs > 0 ? busyMs / activeWindowMs : 0,
  };
}

// ─── LLM SDK Mock（必须在模块顶层声明）─────────────────────────────────────────
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mocks.mockCreate },
  })),
  Anthropic: vi.fn().mockImplementation(() => ({
    messages: { create: mocks.mockCreate },
  })),
}));

// ─── Test Suite ───────────────────────────────────────────────────────────────

const FIXTURE_DIR = new URL(
  '../fixtures/e2e/concurrency-test-project',
  import.meta.url,
).pathname;

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spectra-e2e-concurrency-'));
  expect(isAbsolute(dir)).toBe(true);
  expect(dir).toContain(tmpdir());
  tempDirs.push(dir);
  return dir;
}

describe('Spectra batch 并发 E2E（Feature 146）', () => {
  beforeAll(async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key-e2e-concurrency';

    const { bootstrapAdapters } = await import('../../src/adapters/index.js');
    bootstrapAdapters();

    expect(existsSync(FIXTURE_DIR), `fixture 目录不存在: ${FIXTURE_DIR}`).toBe(true);
    expect(
      existsSync(join(FIXTURE_DIR, 'src', 'mod-01', 'index.ts')),
      'fixture 模块不存在',
    ).toBe(true);
  }, 60_000);

  afterEach(() => {
    mocks.reset();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('SC-003: concurrency=3 时同时活跃 LLM 调用 ≤ 3 且 > 1', async () => {
    mocks.behavior.delayMs = 30; // 制造并发重叠窗口
    const outputDir = makeTempDir();

    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    const result = await runBatch(FIXTURE_DIR, {
      outputDir,
      concurrency: 3,
      enableDebtIntelligence: false,
      generateHtml: false,
      enableAdr: false,
      progressMode: 'silent',
    });

    expect(result.totalModules).toBeGreaterThanOrEqual(10);
    const metrics = mocks.getMetrics();
    expect(metrics.maxConcurrentCalls).toBeLessThanOrEqual(3);
    expect(metrics.maxConcurrentCalls).toBeGreaterThan(1);
  }, 60_000);

  it('SC-006: 并行加速 — concurrency=3 的 LLM 时间线平均并发度显著高于 concurrency=1', async () => {
    // F233 链 H：原实现对比两次 runBatch 的**真实墙钟**（parElapsed < seqElapsed × 0.95）。
    // 该量含 panoramic / skeleton 等串行前置阶段与宿主调度开销，在 4 vCPU CI runner
    // 同时跑 487 个测试文件时并行反而慢于顺序（实测 11922ms vs 10913ms）——测到的是
    // 机器忙不忙，而非并发坏没坏。
    //
    // 改为负载无关判据：只看 mock 侧记录的 LLM 调用时间线，用「区间时长之和 ÷ 区间并集
    // 长度」得到活跃窗口内的平均并发度。顺序执行时区间零重叠 → 恒为 1；真并发时 → > 1。
    // 宿主变慢只会让每个区间同步拉长，比值不变。
    //
    // 与 SC-003 的分工：SC-003 断言并发**峰值** maxConcurrentCalls ∈ (1, 3]（瞬时证据，
    // 是并发退化的第一道结构性守护）；本用例断言并发在整个 LLM 阶段**持续**存在
    // （平均并发度），能抓住「绝大多数调用其实串行、只偶尔擦出一次重叠」这种 SC-003
    // 抓不到的退化，并保留 concurrency=1 作为对照证明该选项确实被尊重。
    mocks.behavior.delayMs = 100;

    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');

    // 顺序运行（对照组）
    const seqOutputDir = makeTempDir();
    await runBatch(FIXTURE_DIR, {
      outputDir: seqOutputDir,
      concurrency: 1,
      enableDebtIntelligence: false,
      generateHtml: false,
      enableAdr: false,
      progressMode: 'silent',
    });
    const seqTotalCalls = mocks.getMetrics().totalCalls;
    const seq = summarizeConcurrency(mocks.getCallIntervals());

    // 重置统计后再以 concurrency=3 运行
    mocks.reset();
    mocks.behavior.delayMs = 100;
    const parOutputDir = makeTempDir();
    await runBatch(FIXTURE_DIR, {
      outputDir: parOutputDir,
      concurrency: 3,
      enableDebtIntelligence: false,
      generateHtml: false,
      enableAdr: false,
      progressMode: 'silent',
    });
    const parTotalCalls = mocks.getMetrics().totalCalls;
    const par = summarizeConcurrency(mocks.getCallIntervals());

    // 两次运行 LLM 调用次数应一致（同 fixture）
    expect(parTotalCalls).toBe(seqTotalCalls);

    // 对照组：concurrency=1 时调用之间不该有重叠，平均并发度必须贴近 1
    // （留 5% 余量吸收 Date.now() 毫秒取整带来的相邻区间端点粘连）。
    // 这条同时证明 concurrency 选项确实被尊重——若调度忽略该参数恒按 >1 并发跑，
    // 对照组会先于实验组变红（实测把 pLimit 强改成常量 2 时正是此条报错）。
    expect(seq.averageConcurrency).toBeLessThan(1.05);

    // 实验组：concurrency=3 时活跃窗口内平均并发度显著 > 1。
    // 阈值 1.5 由变异测试标定（把 pLimit 上限强改成常量后实测本用例的比值）：
    //   pLimit(1) → 1.00 ／ pLimit(2) → 1.10 ／ pLimit(3)（真实值）→ 1.84
    // 三次重复分别为 1.8384 / 1.8396 / 1.8429，抖动 < 0.005；在 36 个 CPU busy loop
    // 压满 18 核时 busyMs 从 1652ms 涨到 4104ms（2.5×），比值仍为 1.87 —— 说明该
    // 指标只反映调用之间的重叠结构，与宿主快慢无关。
    // 1.5 落在 1.10 与 1.84 之间，既能抓住并发退化，也不会被端点抖动误伤。
    expect(par.averageConcurrency).toBeGreaterThan(1.5);
  }, 180_000);

  it('SC-004: 单模块失败不阻塞其他模块（Promise.allSettled + p-limit catch）', async () => {
    mocks.behavior.delayMs = 10;
    // 让所有 mod-02 相关的 LLM 调用始终失败（重试也失败 → 累计到 failed[]）
    mocks.behavior.failOnContentSubstring = 'mod-02';
    const outputDir = makeTempDir();

    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    const result = await runBatch(FIXTURE_DIR, {
      outputDir,
      concurrency: 3,
      enableDebtIntelligence: false,
      generateHtml: false,
      enableAdr: false,
      progressMode: 'silent',
    });

    // 至少有一个模块进入 failed（mod-02 的所有重试都失败）
    expect(result.failed.length).toBeGreaterThanOrEqual(1);
    // 其他模块不被阻塞，successful 至少包含其余 11 个模块中的多数
    expect(result.successful.length).toBeGreaterThan(0);
    // 失败模块路径应包含 mod-02
    const failedPaths = result.failed.map((f) => f.path).join('|');
    expect(failedPaths).toContain('mod-02');
  }, 60_000);

  it('SC-005: tokenUsage 跨模块累加正确（JS 单线程 += 安全）', async () => {
    mocks.behavior.delayMs = 5;
    mocks.behavior.inputTokensPerCall = 100;
    mocks.behavior.outputTokensPerCall = 50;
    const outputDir = makeTempDir();

    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    const result = await runBatch(FIXTURE_DIR, {
      outputDir,
      concurrency: 3,
      enableDebtIntelligence: false,
      generateHtml: false,
      enableAdr: false,
      progressMode: 'silent',
    });

    const metrics = mocks.getMetrics();
    expect(result.costSummary).toBeDefined();
    // costSummary 应该汇总所有 mockCreate 调用产生的 token
    // 严格相等：input_tokens × totalCalls = costSummary.totalInputTokens
    // 注：runBatch 内 root 模块也会调用 mockCreate（每个文件一次），totalCalls 由 mock 实测
    const expectedInputTokens = metrics.totalCalls * mocks.behavior.inputTokensPerCall;
    expect(result.costSummary!.totalInputTokens).toBe(expectedInputTokens);
  }, 60_000);
});
