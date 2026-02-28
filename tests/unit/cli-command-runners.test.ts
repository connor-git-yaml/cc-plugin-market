/**
 * CLI 命令执行器单元测试
 * 覆盖 generate/batch/diff/prepare/mcp-server 的命令编排逻辑
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve } from 'node:path';
import type { CLICommand } from '../../src/cli/utils/parse-args.js';

const mocks = vi.hoisted(() => ({
  generateSpec: vi.fn(),
  runBatch: vi.fn(),
  detectDrift: vi.fn(),
  prepareContext: vi.fn(),
  startMcpServer: vi.fn(),
  validateTargetPath: vi.fn(),
  checkAuth: vi.fn(),
  handleError: vi.fn(),
}));

vi.mock('../../src/core/single-spec-orchestrator.js', () => ({
  generateSpec: mocks.generateSpec,
  prepareContext: mocks.prepareContext,
}));

vi.mock('../../src/batch/batch-orchestrator.js', () => ({
  runBatch: mocks.runBatch,
}));

vi.mock('../../src/diff/drift-orchestrator.js', () => ({
  detectDrift: mocks.detectDrift,
}));

vi.mock('../../src/mcp/index.js', () => ({
  startMcpServer: mocks.startMcpServer,
}));

vi.mock('../../src/cli/utils/error-handler.js', () => ({
  EXIT_CODES: {
    SUCCESS: 0,
    TARGET_ERROR: 1,
    API_ERROR: 2,
  },
  validateTargetPath: mocks.validateTargetPath,
  checkAuth: mocks.checkAuth,
  handleError: mocks.handleError,
}));

import { runGenerate } from '../../src/cli/commands/generate.js';
import { runBatchCommand } from '../../src/cli/commands/batch.js';
import { runDiff } from '../../src/cli/commands/diff.js';
import { runPrepare } from '../../src/cli/commands/prepare.js';
import { runMcpServer } from '../../src/cli/commands/mcp-server.js';

function makeCommand(overrides: Partial<CLICommand> = {}): CLICommand {
  return {
    subcommand: 'generate',
    deep: false,
    force: false,
    version: false,
    help: false,
    global: false,
    remove: false,
    skillTarget: 'claude',
    ...overrides,
  };
}

describe('CLI 命令执行器', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    vi.clearAllMocks();
    process.exitCode = 0;
    mocks.validateTargetPath.mockReturnValue(true);
    mocks.checkAuth.mockReturnValue(true);
    mocks.handleError.mockReturnValue(2);
  });

  afterEach(() => {
    process.exitCode = 0;
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('runGenerate 成功调用 orchestrator 并设置成功退出码', async () => {
    mocks.generateSpec.mockResolvedValue({
      specPath: 'specs/example.spec.md',
      skeleton: {},
      tokenUsage: 100,
      confidence: 'high',
      warnings: [],
      moduleSpec: {},
    });

    await runGenerate(
      makeCommand({
        subcommand: 'generate',
        target: 'src/example.ts',
        deep: true,
      }),
      '2.0.0',
    );

    expect(mocks.generateSpec).toHaveBeenCalledWith(
      resolve('src/example.ts'),
      expect.objectContaining({
        deep: true,
        outputDir: undefined,
        projectRoot: process.cwd(),
      }),
    );
    expect(process.exitCode).toBe(0);
  });

  it('runGenerate 目标路径校验失败时退出码为 TARGET_ERROR', async () => {
    mocks.validateTargetPath.mockReturnValue(false);

    await runGenerate(
      makeCommand({
        subcommand: 'generate',
        target: 'src/missing.ts',
      }),
      '2.0.0',
    );

    expect(mocks.generateSpec).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('runBatchCommand 透传 outputDir 并设置成功退出码', async () => {
    mocks.runBatch.mockResolvedValue({
      totalModules: 3,
      successful: ['a', 'b'],
      failed: [],
      skipped: ['c'],
      degraded: [],
      duration: 100,
      indexGenerated: true,
      summaryLogPath: 'custom-specs/batch-summary.md',
    });

    await runBatchCommand(
      makeCommand({
        subcommand: 'batch',
        force: true,
        outputDir: 'custom-specs',
      }),
      '2.0.0',
    );

    expect(mocks.runBatch).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        force: true,
        outputDir: 'custom-specs',
      }),
    );
    expect(process.exitCode).toBe(0);
  });

  it('runDiff 成功时按 low 风险退出 0', async () => {
    mocks.detectDrift.mockResolvedValue({
      specPath: '/tmp/a.spec.md',
      sourcePath: '/tmp/src',
      generatedAt: new Date().toISOString(),
      specVersion: 'v1',
      summary: {
        totalChanges: 1,
        high: 0,
        medium: 0,
        low: 1,
        additions: 1,
        removals: 0,
        modifications: 0,
      },
      items: [],
      filteredNoise: 0,
      recommendation: 'ok',
      outputPath: 'drift-logs/a.md',
    });

    await runDiff(
      makeCommand({
        subcommand: 'diff',
        specFile: 'specs/a.spec.md',
        target: 'src/',
        outputDir: 'drift-logs',
      }),
      '2.0.0',
    );

    expect(mocks.detectDrift).toHaveBeenCalledWith(
      resolve('specs/a.spec.md'),
      resolve('src/'),
      expect.objectContaining({ outputDir: 'drift-logs' }),
    );
    expect(process.exitCode).toBe(0);
  });

  it('runPrepare 成功时输出结构化结果', async () => {
    const analyzedAt = new Date().toISOString();
    const skeleton = {
      filePath: resolve('src/example.ts'),
      language: 'typescript',
      loc: 10,
      exports: [],
      imports: [],
      hash: 'a'.repeat(64),
      analyzedAt,
      parserUsed: 'ts-morph',
    };

    mocks.prepareContext.mockResolvedValue({
      skeletons: [skeleton],
      mergedSkeleton: skeleton,
      context: {
        prompt: 'prompt',
        tokenCount: 42,
        truncated: false,
        truncatedParts: [],
        breakdown: {
          skeleton: 10,
          dependencies: 10,
          snippets: 10,
          instructions: 12,
        },
      },
      codeSnippets: [],
      filePaths: [resolve('src/example.ts')],
    });

    await runPrepare(
      makeCommand({
        subcommand: 'prepare',
        target: 'src/example.ts',
      }),
      '2.0.0',
    );

    expect(mocks.prepareContext).toHaveBeenCalledWith(
      resolve('src/example.ts'),
      expect.objectContaining({
        deep: false,
        projectRoot: process.cwd(),
      }),
    );
    expect(process.exitCode).toBe(0);
  });

  it('runMcpServer 调用 startMcpServer', async () => {
    mocks.startMcpServer.mockResolvedValue(undefined);

    await runMcpServer();

    expect(mocks.startMcpServer).toHaveBeenCalledTimes(1);
  });
});
