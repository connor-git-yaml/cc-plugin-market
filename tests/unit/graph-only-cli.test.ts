/**
 * Feature 195 — graph-only CLI 层单测
 *
 * 覆盖：
 * - parse-args 接受 `--mode graph-only` 与 `--mode=graph-only` 两种写法（FR-001）
 * - 非法 mode 错误信息列出 graph-only
 * - runBatchCommand graph-only 路径：不调 checkAuth（FR-005/SC-003d）、
 *   dispatch buildAstGraphOnly、stdout 含 graph-only/零 LLM 标识（SC-003e）、exit 0
 * - --languages 传入时 warn 忽略
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runBatch: vi.fn(),
  buildAstGraphOnly: vi.fn(),
  checkAuth: vi.fn(),
  loadProjectConfig: vi.fn(),
  mergeConfig: vi.fn(),
}));

vi.mock('../../src/batch/batch-orchestrator.js', () => ({
  runBatch: mocks.runBatch,
  buildAstGraphOnly: mocks.buildAstGraphOnly,
}));
vi.mock('../../src/cli/utils/error-handler.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, checkAuth: mocks.checkAuth };
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
    mocks.checkAuth.mockReturnValue(true);
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

  it('不调用 checkAuth（零 LLM 无需认证，SC-003d）', async () => {
    await runBatchCommand(graphOnlyCommand, '4.2.0');
    expect(mocks.checkAuth).toHaveBeenCalledTimes(0);
    expect(mocks.buildAstGraphOnly).toHaveBeenCalledTimes(1);
    expect(mocks.runBatch).toHaveBeenCalledTimes(0);
    expect(process.exitCode).toBe(0);
  });

  it('即使 checkAuth 会失败也照常产图（不被 auth gate 阻断）', async () => {
    mocks.checkAuth.mockReturnValue(false);
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

  // W3（codex round-3）：checkAuth 下移后的回归与错误路径
  it('非 graph-only + checkAuth 失败 → API_ERROR（下移后认证仍生效，回归）', async () => {
    mocks.checkAuth.mockReturnValue(false);
    const fullCommand: CLICommand = { ...graphOnlyCommand, batchMode: 'full' };
    await runBatchCommand(fullCommand, '4.2.0');
    expect(mocks.checkAuth).toHaveBeenCalledTimes(1);
    expect(mocks.buildAstGraphOnly).not.toHaveBeenCalled();
    expect(mocks.runBatch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2); // EXIT_CODES.API_ERROR
  });

  it('graph-only + buildAstGraphOnly 抛错 → 非 0 退出（落入 handleError）', async () => {
    mocks.buildAstGraphOnly.mockRejectedValue(new Error('boom: write failed'));
    await runBatchCommand(graphOnlyCommand, '4.2.0');
    expect(mocks.buildAstGraphOnly).toHaveBeenCalledTimes(1);
    expect(process.exitCode).not.toBe(0);
  });
});
