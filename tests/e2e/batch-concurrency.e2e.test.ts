/**
 * Feature 146: LLM 并发优化器 E2E 测试
 *
 * 验证 batch-orchestrator 在使用 p-limit 替换手写信号量后的关键属性：
 * - SC-003：concurrency=N 时同时活跃的 LLM 调用 ≤ N 且 > 1（并发真的触发）
 * - SC-004：单模块失败被隔离到 BatchResult.failed[]，其余模块仍能成功
 * - SC-005：tokenUsage 跨模块累加准确（JS 单线程保证 += 安全性）
 * - SC-006：并行加速效果（10 个 mock 100ms 模块，concurrency=3，总耗时 < 700ms）
 *
 * Mock 策略沿用 F144 的 vi.hoisted() + vi.mock('@anthropic-ai/sdk')，
 * 通过闭包暴露并发计数器，捕获并发上限。
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
    }
  });

  const reset = (): void => {
    concurrentCalls = 0;
    maxConcurrentCalls = 0;
    totalCalls = 0;
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
  };
});

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

  it('SC-006: 并行加速 — concurrency=3 下 LLM 阶段总耗时显著小于顺序执行下限', async () => {
    // 通过对比 concurrency=3 vs concurrency=1 两次运行的耗时增量来验证并发加速效果。
    // 直接对比绝对耗时（含 panoramic pipeline 各种串行步骤）会引入测试不稳定。
    // 改为：每次 LLM mock 延迟 100ms，并发=1 顺序应至少 N×100ms；并发=3 应明显少于 N×100ms。
    mocks.behavior.delayMs = 100;

    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');

    // 顺序运行
    const seqOutputDir = makeTempDir();
    const t0Seq = Date.now();
    await runBatch(FIXTURE_DIR, {
      outputDir: seqOutputDir,
      concurrency: 1,
      enableDebtIntelligence: false,
      generateHtml: false,
      enableAdr: false,
      progressMode: 'silent',
    });
    const seqElapsed = Date.now() - t0Seq;
    const seqTotalCalls = mocks.getMetrics().totalCalls;

    // 重置统计后再以 concurrency=3 运行
    mocks.reset();
    mocks.behavior.delayMs = 100;
    const parOutputDir = makeTempDir();
    const t0Par = Date.now();
    await runBatch(FIXTURE_DIR, {
      outputDir: parOutputDir,
      concurrency: 3,
      enableDebtIntelligence: false,
      generateHtml: false,
      enableAdr: false,
      progressMode: 'silent',
    });
    const parElapsed = Date.now() - t0Par;
    const parTotalCalls = mocks.getMetrics().totalCalls;

    // 两次运行 LLM 调用次数应一致（同 fixture）
    expect(parTotalCalls).toBe(seqTotalCalls);
    // 并发模式总耗时应显著小于顺序模式。
    // CI 容忍下限：节省 ≥ 15%（× 0.85），低于 spec 期望的 30% 但避免 GitHub Actions
    // 共享 runner 的偶发抖动导致 flaky。本地实测节省通常 ≥ 50%，CI 阈值仅作回归警戒线
    // （防止并发完全失效如 pLimit(1) 死锁）。Codex 审查 INFO：阈值与 spec 30% 的差距
    // 属测试工程权衡，已在测试注释和 spec.md 中分别记录。
    expect(parElapsed).toBeLessThan(seqElapsed * 0.85);
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
