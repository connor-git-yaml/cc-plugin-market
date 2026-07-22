/**
 * Feature 195 — graph-only CLI 层单测
 *
 * 覆盖：
 * - parse-args 接受 `--mode graph-only` 与 `--mode=graph-only` 两种写法（FR-001）
 * - 非法 mode 错误信息列出 graph-only
 * - runBatchCommand graph-only 路径：不调认证门控（FR-005/SC-003d）、
 *   dispatch buildAstGraphOnly、stdout 含 graph-only/零 LLM 标识（SC-003e）、exit 0
 * - --languages 传入时 warn 忽略
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runBatch: vi.fn(),
  buildAstGraphOnly: vi.fn(),
  resolveAuthGate: vi.fn(),
  loadProjectConfig: vi.fn(),
  mergeConfig: vi.fn(),
}));

vi.mock('../../src/batch/batch-orchestrator.js', () => ({
  runBatch: mocks.runBatch,
  buildAstGraphOnly: mocks.buildAstGraphOnly,
}));
vi.mock('../../src/cli/utils/error-handler.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, resolveAuthGate: mocks.resolveAuthGate };
});
vi.mock('../../src/config/project-config.js', () => ({
  loadProjectConfig: mocks.loadProjectConfig,
  mergeConfig: mocks.mergeConfig,
}));

import { parseArgs } from '../../src/cli/utils/parse-args.js';
import { runBatchCommand } from '../../src/cli/commands/batch.js';
import type { CLICommand } from '../../src/cli/utils/parse-args.js';

describe('parse-args — --mode graph-only（FR-001）', () => {
  it('--mode graph-only（空格写法）解析为 graph-only', () => {
    const result = parseArgs(['batch', '--mode', 'graph-only']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.command.batchMode).toBe('graph-only');
  });

  it('--mode=graph-only（等号写法）解析为 graph-only', () => {
    const result = parseArgs(['batch', '--mode=graph-only']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.command.batchMode).toBe('graph-only');
  });

  it('非法 mode 错误信息列出 graph-only', () => {
    const result = parseArgs(['batch', '--mode', 'bogus']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('graph-only');
  });

  it('既有三 mode 仍解析正常（回归）', () => {
    for (const m of ['full', 'reading', 'code-only'] as const) {
      const result = parseArgs(['batch', '--mode', m]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.command.batchMode).toBe(m);
    }
  });
});

describe('runBatchCommand — graph-only 路径（FR-005/008）', () => {
  const graphOnlyCommand: CLICommand = {
    subcommand: 'batch',
    deep: false,
    force: false,
    version: false,
    help: false,
    global: false,
    remove: false,
    skillTarget: 'claude',
    batchMode: 'graph-only',
  };
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAuthGate.mockReturnValue(true);
    mocks.loadProjectConfig.mockReturnValue({});
    mocks.mergeConfig.mockReturnValue({
      force: false,
      incremental: false,
      languages: undefined,
      outputDir: undefined,
    });
    mocks.buildAstGraphOnly.mockResolvedValue({
      graphPath: '/tmp/p/specs/_meta/graph.json',
      nodeCount: 42,
      edgeCount: 30,
      callEdgeCount: 18,
      dependsOnEdgeCount: 12,
      pythonSymbolCount: 5,
      durationMs: 1234,
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    process.exitCode = 0;
  });

  it('不调用认证门控（零 LLM 无需认证，SC-003d）', async () => {
    await runBatchCommand(graphOnlyCommand, '4.2.0');
    expect(mocks.resolveAuthGate).toHaveBeenCalledTimes(0);
    expect(mocks.buildAstGraphOnly).toHaveBeenCalledTimes(1);
    expect(mocks.runBatch).toHaveBeenCalledTimes(0);
    expect(process.exitCode).toBe(0);
  });

  it('即使认证门控会失败也照常产图（不被 auth gate 阻断）', async () => {
    mocks.resolveAuthGate.mockReturnValue(false);
    await runBatchCommand(graphOnlyCommand, '4.2.0');
    expect(mocks.buildAstGraphOnly).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it('stdout 含 graph-only / 零 LLM 标识（SC-003e）', async () => {
    await runBatchCommand(graphOnlyCommand, '4.2.0');
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('graph-only');
    expect(out).toContain('零 LLM');
  });

  it('--languages 传入时 warn 忽略', async () => {
    await runBatchCommand({ ...graphOnlyCommand, languages: ['python'] }, '4.2.0');
    const warns = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warns).toContain('graph-only 不支持 --languages');
    expect(mocks.buildAstGraphOnly).toHaveBeenCalledTimes(1);
  });

  it('graph-only 不会进入 runBatch（解耦确认）', async () => {
    await runBatchCommand(graphOnlyCommand, '4.2.0');
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  // W3（codex round-3）：认证门控下移后的回归与错误路径
  // Feature 222：默认路径零认证不再阻断，仅 --require-llm 才硬退
  it('非 graph-only + 门控放行（零认证降级）→ 照常进入 runBatch', async () => {
    mocks.runBatch.mockResolvedValue({
      totalModules: 1,
      successful: ['a'],
      failed: [],
      skipped: [],
      degraded: [],
      duration: 10,
      indexGenerated: false,
      summaryLogPath: '',
    });
    const fullCommand: CLICommand = { ...graphOnlyCommand, batchMode: 'full' };
    await runBatchCommand(fullCommand, '4.2.0');
    expect(mocks.resolveAuthGate).toHaveBeenCalledWith(false);
    expect(mocks.buildAstGraphOnly).not.toHaveBeenCalled();
    expect(mocks.runBatch).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it('非 graph-only + --require-llm + 门控阻断 → API_ERROR', async () => {
    mocks.resolveAuthGate.mockReturnValue(false);
    const fullCommand: CLICommand = {
      ...graphOnlyCommand,
      batchMode: 'full',
      requireLlm: true,
    };
    await runBatchCommand(fullCommand, '4.2.0');
    expect(mocks.resolveAuthGate).toHaveBeenCalledWith(true);
    expect(mocks.buildAstGraphOnly).not.toHaveBeenCalled();
    expect(mocks.runBatch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2); // EXIT_CODES.API_ERROR
  });

  it('非 graph-only + --require-llm + 有降级模块 → 事后校验 API_ERROR', async () => {
    mocks.runBatch.mockResolvedValue({
      totalModules: 2,
      successful: ['a'],
      failed: [],
      skipped: [],
      degraded: ['b'],
      duration: 10,
      indexGenerated: false,
      summaryLogPath: '',
    });
    const fullCommand: CLICommand = {
      ...graphOnlyCommand,
      batchMode: 'full',
      requireLlm: true,
    };
    await runBatchCommand(fullCommand, '4.2.0');
    expect(mocks.runBatch).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(2); // EXIT_CODES.API_ERROR
  });

  // Feature 222（codex W2）：dry-run 与 graph-only 同属零 LLM 路径——不该被门控阻断，
  // 但也绝不能静默 exit 0 让人误以为 --require-llm 校验过了认证。
  describe('--dry-run + --require-llm', () => {
    const dryRunCommand: CLICommand = {
      ...graphOnlyCommand,
      batchMode: 'full',
      dryRun: true,
      requireLlm: true,
    };

    beforeEach(() => {
      mocks.runBatch.mockResolvedValue({
        totalModules: 3,
        successful: [],
        failed: [],
        skipped: [],
        degraded: [],
        duration: 10,
        indexGenerated: false,
        summaryLogPath: '',
        dryRunReportPath: 'specs/_meta/dry-run-estimate.md',
      });
    });

    it('不调用认证门控且照常产出预估报告（exit 0）', async () => {
      await runBatchCommand(dryRunCommand, '4.2.0');
      expect(mocks.resolveAuthGate).not.toHaveBeenCalled();
      expect(mocks.runBatch).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(0);
    });

    it('显式 warn 声明 --require-llm 不适用且认证未被校验', async () => {
      await runBatchCommand(dryRunCommand, '4.2.0');
      const warns = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(warns).toContain('--dry-run 不调用 LLM');
      expect(warns).toContain('--require-llm');
      expect(warns).toContain('认证未被校验');
    });

    it('未指定 --require-llm 的 dry-run 不产生该 warn（避免噪声）', async () => {
      await runBatchCommand({ ...dryRunCommand, requireLlm: false }, '4.2.0');
      const warns = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(warns).not.toContain('--require-llm');
      expect(mocks.resolveAuthGate).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    });
  });

  it('graph-only + --require-llm → warn 声明该 flag 无效（零 LLM 路径一致性）', async () => {
    await runBatchCommand({ ...graphOnlyCommand, requireLlm: true }, '4.2.0');
    const warns = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warns).toContain('graph-only 不调用 LLM');
    expect(process.exitCode).toBe(0);
  });

  it('graph-only + buildAstGraphOnly 抛错 → 非 0 退出（落入 handleError）', async () => {
    mocks.buildAstGraphOnly.mockRejectedValue(new Error('boom: write failed'));
    await runBatchCommand(graphOnlyCommand, '4.2.0');
    expect(mocks.buildAstGraphOnly).toHaveBeenCalledTimes(1);
    expect(process.exitCode).not.toBe(0);
  });
});
