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
  buildAstGraphOnly: vi.fn(),
  detectDrift: vi.fn(),
  prepareContext: vi.fn(),
  startMcpServer: vi.fn(),
  ensureSpecifyTemplates: vi.fn(),
  validateTargetPath: vi.fn(),
  resolveAuthGate: vi.fn(),
  handleError: vi.fn(),
  printError: vi.fn(),
}));

vi.mock('../../src/core/single-spec-orchestrator.js', () => ({
  generateSpec: mocks.generateSpec,
  prepareContext: mocks.prepareContext,
}));

vi.mock('../../src/batch/batch-orchestrator.js', () => ({
  runBatch: mocks.runBatch,
  buildAstGraphOnly: mocks.buildAstGraphOnly,
}));

vi.mock('../../src/diff/drift-orchestrator.js', () => ({
  detectDrift: mocks.detectDrift,
}));

vi.mock('../../src/mcp/index.js', () => ({
  startMcpServer: mocks.startMcpServer,
}));

vi.mock('../../src/utils/specify-template-sync.js', () => ({
  ensureSpecifyTemplates: mocks.ensureSpecifyTemplates,
}));

vi.mock('../../src/config/project-config.js', () => ({
  loadProjectConfig: vi.fn(() => ({})),
  mergeConfig: vi.fn((cliOptions: Record<string, unknown>) => cliOptions),
}));

vi.mock('../../src/cli/utils/error-handler.js', () => ({
  EXIT_CODES: {
    SUCCESS: 0,
    TARGET_ERROR: 1,
    API_ERROR: 2,
  },
  validateTargetPath: mocks.validateTargetPath,
  resolveAuthGate: mocks.resolveAuthGate,
  handleError: mocks.handleError,
  printError: mocks.printError,
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
    incremental: false,
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
    mocks.resolveAuthGate.mockReturnValue(true);
    mocks.handleError.mockReturnValue(2);
    mocks.ensureSpecifyTemplates.mockReturnValue({ copied: [], missing: [] });
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
      llmDegraded: false,
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
    expect(mocks.ensureSpecifyTemplates).toHaveBeenCalledWith(process.cwd());
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

  // Feature 222：零认证降级放行后，generate 仍须真正执行
  it('runGenerate 认证门控放行（零认证降级）时仍调用 orchestrator 并退出 0', async () => {
    mocks.generateSpec.mockResolvedValue({
      specPath: 'specs/example.spec.md',
      skeleton: {},
      tokenUsage: 0,
      confidence: 'low',
      warnings: ['LLM 不可用，已降级为 AST-only Spec'],
      moduleSpec: {},
      llmDegraded: true,
    });

    await runGenerate(
      makeCommand({ subcommand: 'generate', target: 'src/example.ts' }),
      '2.0.0',
    );

    expect(mocks.resolveAuthGate).toHaveBeenCalledWith(false);
    expect(mocks.generateSpec).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it('runGenerate 认证门控阻断时不调用 orchestrator 且退出 2', async () => {
    mocks.resolveAuthGate.mockReturnValue(false);

    await runGenerate(
      makeCommand({ subcommand: 'generate', target: 'src/example.ts', requireLlm: true }),
      '2.0.0',
    );

    expect(mocks.resolveAuthGate).toHaveBeenCalledWith(true);
    expect(mocks.generateSpec).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  it('runGenerate --require-llm 且产物为 AST-only 降级时事后校验退出 2', async () => {
    mocks.generateSpec.mockResolvedValue({
      specPath: 'specs/example.spec.md',
      skeleton: {},
      tokenUsage: 0,
      confidence: 'low',
      warnings: ['LLM 不可用，已降级为 AST-only Spec'],
      moduleSpec: {},
      llmDegraded: true,
    });

    await runGenerate(
      makeCommand({ subcommand: 'generate', target: 'src/example.ts', requireLlm: true }),
      '2.0.0',
    );

    expect(mocks.generateSpec).toHaveBeenCalledTimes(1);
    expect(mocks.printError).toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  // 回归防线：事后校验必须读结构化 llmDegraded，不得回退成匹配 warning 中文子串
  //（orchestrator 侧文案微调不应让 --require-llm 静默失效）
  it('runGenerate --require-llm 在 warning 文案变更但 llmDegraded=true 时仍退出 2', async () => {
    mocks.generateSpec.mockResolvedValue({
      specPath: 'specs/example.spec.md',
      skeleton: {},
      tokenUsage: 0,
      confidence: 'low',
      warnings: ['LLM 不可用，已改用纯结构输出'],
      moduleSpec: {},
      llmDegraded: true,
    });

    await runGenerate(
      makeCommand({ subcommand: 'generate', target: 'src/example.ts', requireLlm: true }),
      '2.0.0',
    );

    expect(process.exitCode).toBe(2);
  });

  it('runDiff 认证门控放行（零认证降级）时仍调用 detectDrift', async () => {
    mocks.detectDrift.mockResolvedValue({
      specPath: '/tmp/a.spec.md',
      sourcePath: '/tmp/src',
      generatedAt: new Date().toISOString(),
      specVersion: 'v1',
      summary: {
        totalChanges: 0,
        high: 0,
        medium: 0,
        low: 0,
        additions: 0,
        removals: 0,
        modifications: 0,
      },
      items: [],
      filteredNoise: 0,
      recommendation: 'ok',
      outputPath: 'drift-logs/a.md',
    });

    await runDiff(
      makeCommand({ subcommand: 'diff', specFile: 'specs/a.spec.md', target: 'src/' }),
      '2.0.0',
    );

    // diff 传入定制降级形态描述（它并不产出 AST-only spec），故断言第二个入参存在
    expect(mocks.resolveAuthGate).toHaveBeenCalledWith(
      false,
      expect.stringContaining('结构漂移检测'),
    );
    expect(mocks.detectDrift).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it('runDiff 认证门控阻断时不调用 detectDrift 且退出 2', async () => {
    mocks.resolveAuthGate.mockReturnValue(false);

    await runDiff(
      makeCommand({
        subcommand: 'diff',
        specFile: 'specs/a.spec.md',
        target: 'src/',
        requireLlm: true,
      }),
      '2.0.0',
    );

    expect(mocks.resolveAuthGate).toHaveBeenCalledWith(
      true,
      expect.stringContaining('结构漂移检测'),
    );
    expect(mocks.detectDrift).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
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

    // F175 FR-002：--force 经 resolveRegenPlan 解析为 { incremental:false, full:true }（force 是 full 等义别名），
    // 不再原样透传 force 字段——runBatch options 改收已解析的 incremental/full 真值。
    expect(mocks.runBatch).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        full: true,
        incremental: false,
        outputDir: 'custom-specs',
      }),
    );
    expect(process.exitCode).toBe(0);
  });

  it('runBatchCommand 透传 incremental 并输出 delta report 路径', async () => {
    mocks.runBatch.mockResolvedValue({
      totalModules: 3,
      successful: ['auth', 'api'],
      failed: [],
      skipped: ['jobs'],
      degraded: [],
      duration: 100,
      indexGenerated: true,
      summaryLogPath: 'specs/batch-summary.md',
      deltaReportPath: 'specs/_delta-report.md',
    });

    await runBatchCommand(
      makeCommand({
        subcommand: 'batch',
        incremental: true,
      }),
      '2.0.0',
    );

    expect(mocks.runBatch).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        incremental: true,
      }),
    );
    expect(logSpy).toHaveBeenCalledWith('✓ 差量报告: specs/_delta-report.md');
    expect(process.exitCode).toBe(0);
  });

  it('runBatchCommand 输出 docs bundle 摘要', async () => {
    mocks.runBatch.mockResolvedValue({
      totalModules: 3,
      successful: ['auth', 'api'],
      failed: [],
      skipped: [],
      degraded: [],
      duration: 100,
      indexGenerated: true,
      summaryLogPath: 'specs/batch-summary.md',
      docsBundleManifestPath: 'specs/docs-bundle.yaml',
      docsBundleProfiles: [
        {
          id: 'developer-onboarding',
          title: 'Developer Onboarding',
          rootDir: 'specs/bundles/developer-onboarding',
          documentCount: 8,
          warningCount: 0,
        },
        {
          id: 'api-consumer',
          title: 'API Consumer',
          rootDir: 'specs/bundles/api-consumer',
          documentCount: 6,
          warningCount: 1,
        },
      ],
    });

    await runBatchCommand(
      makeCommand({
        subcommand: 'batch',
      }),
      '2.0.0',
    );

    expect(logSpy).toHaveBeenCalledWith('✓ 文档 Bundle: specs/docs-bundle.yaml');
    expect(logSpy).toHaveBeenCalledWith(
      '✓ Bundle Profiles: developer-onboarding(8), api-consumer(6)',
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
    expect(mocks.ensureSpecifyTemplates).toHaveBeenCalledWith(process.cwd());
    expect(process.exitCode).toBe(0);
  });

  it('runMcpServer 调用 startMcpServer', async () => {
    mocks.startMcpServer.mockResolvedValue(undefined);

    await runMcpServer();

    expect(mocks.startMcpServer).toHaveBeenCalledTimes(1);
  });
});
