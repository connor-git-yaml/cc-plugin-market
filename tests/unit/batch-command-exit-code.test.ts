/**
 * Feature 127 (Codex review 修复 — Finding 2)：预算 cancel 必须返回非零 exit。
 *
 * 通过 mock runBatch 返回各种决策场景，断言 runBatchCommand 设置的 exitCode。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  runBatch: vi.fn(),
  checkAuth: vi.fn(),
  loadProjectConfig: vi.fn(),
  mergeConfig: vi.fn(),
}));

vi.mock('../../src/batch/batch-orchestrator.js', () => ({
  runBatch: mocks.runBatch,
}));
vi.mock('../../src/cli/utils/error-handler.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    checkAuth: mocks.checkAuth,
  };
});
vi.mock('../../src/config/project-config.js', () => ({
  loadProjectConfig: mocks.loadProjectConfig,
  mergeConfig: mocks.mergeConfig,
}));

import { runBatchCommand } from '../../src/cli/commands/batch.js';
import type { CLICommand } from '../../src/cli/utils/parse-args.js';

const baseCommand: CLICommand = {
  subcommand: 'batch',
  deep: false,
  force: false,
  version: false,
  help: false,
  global: false,
  remove: false,
  skillTarget: 'claude',
};

describe('runBatchCommand exit code (Feature 127)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAuth.mockReturnValue(true);
    mocks.loadProjectConfig.mockReturnValue({});
    mocks.mergeConfig.mockReturnValue({
      force: false,
      incremental: false,
      languages: undefined,
      outputDir: undefined,
    });
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = 0;
  });

  it('正常成功 → exit 0', async () => {
    mocks.runBatch.mockResolvedValue({
      totalModules: 3,
      successful: ['a', 'b', 'c'],
      failed: [],
      skipped: [],
      degraded: [],
      duration: 100,
      indexGenerated: true,
      summaryLogPath: '_meta/batch-summary.md',
    });
    await runBatchCommand(baseCommand, '3.0.1');
    expect(process.exitCode).toBe(0);
  });

  it('有失败模块 → exit 1 (TARGET_ERROR)', async () => {
    mocks.runBatch.mockResolvedValue({
      totalModules: 2,
      successful: ['a'],
      failed: [{ path: 'b', error: 'fail', failedAt: '', retryCount: 0, degradedToAstOnly: false }],
      skipped: [],
      degraded: [],
      duration: 100,
      indexGenerated: true,
      summaryLogPath: '_meta/batch-summary.md',
    });
    await runBatchCommand(baseCommand, '3.0.1');
    expect(process.exitCode).toBe(1);
  });

  it('预算决策 cancel + 无失败 → exit 3 (BUDGET_EXCEEDED)', async () => {
    mocks.runBatch.mockResolvedValue({
      totalModules: 5,
      successful: [],
      failed: [],
      skipped: ['a', 'b', 'c', 'd', 'e'],
      degraded: [],
      duration: 50,
      indexGenerated: false,
      summaryLogPath: '',
      budgetDecision: {
        policy: 'cancel',
        message: '超预算，自动取消',
        interactive: false,
      },
    });
    await runBatchCommand(baseCommand, '3.0.1');
    expect(process.exitCode).toBe(3);
  });

  it('预算决策 continue + 无失败 → exit 0', async () => {
    mocks.runBatch.mockResolvedValue({
      totalModules: 3,
      successful: ['a', 'b', 'c'],
      failed: [],
      skipped: [],
      degraded: [],
      duration: 100,
      indexGenerated: true,
      summaryLogPath: '_meta/batch-summary.md',
      budgetDecision: {
        policy: 'continue',
        message: '预估在预算内',
        interactive: false,
      },
    });
    await runBatchCommand(baseCommand, '3.0.1');
    expect(process.exitCode).toBe(0);
  });

  it('失败模块 + 预算 cancel 同时存在 → exit 1（优先 TARGET_ERROR）', async () => {
    mocks.runBatch.mockResolvedValue({
      totalModules: 2,
      successful: [],
      failed: [{ path: 'x', error: 'boom', failedAt: '', retryCount: 0, degradedToAstOnly: false }],
      skipped: [],
      degraded: [],
      duration: 100,
      indexGenerated: false,
      summaryLogPath: '',
      budgetDecision: {
        policy: 'cancel',
        message: '先失败后取消',
        interactive: false,
      },
    });
    await runBatchCommand(baseCommand, '3.0.1');
    expect(process.exitCode).toBe(1);
  });
});
