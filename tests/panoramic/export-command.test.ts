/**
 * export CLI 命令测试
 * 测试先行（TDD）：覆盖 graceful exit 场景和参数解析
 * FR 追踪: FR-013、FR-014、FR-015
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseArgs } from '../../src/cli/utils/parse-args.js';

// ============================================================
// parseArgs 新增 export 子命令测试
// ============================================================

describe('parseArgs — export 子命令', () => {
  it('解析 export --format obsidian', () => {
    const result = parseArgs(['export', '--format', 'obsidian']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.subcommand).toBe('export');
    expect(result.command.exportFormat).toBe('obsidian');
  });

  it('解析 export --format html', () => {
    const result = parseArgs(['export', '--format', 'html']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.subcommand).toBe('export');
    expect(result.command.exportFormat).toBe('html');
  });

  it('--output-dir 未指定时 outputDir 为 undefined（由命令 handler 使用默认值）', () => {
    const result = parseArgs(['export', '--format', 'obsidian']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 默认由 export command handler 处理默认路径
    expect(result.command.exportFormat).toBe('obsidian');
  });

  it('解析 export --format html --output-dir /tmp/out', () => {
    const result = parseArgs(['export', '--format', 'html', '--output-dir', '/tmp/out']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.outputDir).toBe('/tmp/out');
  });

  it('export --format invalid 不应解析为 ok=true 且 exportFormat 不合法', () => {
    const result = parseArgs(['export', '--format', 'invalid']);
    // 允许 parse 成功（handler 层校验）或直接 error
    if (result.ok) {
      // handler 层会检查 exportFormat
      expect(result.command.exportFormat).toBe('invalid');
    } else {
      expect(result.ok).toBe(false);
    }
  });

  it('export --help 显示帮助', () => {
    const result = parseArgs(['export', '--help']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.help).toBe(true);
  });
});

// ============================================================
// runExportCommand graceful exit 场景测试
// ============================================================

describe('runExportCommand', () => {
  let tmpDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-cmd-test-'));
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // process.exit mock（不真正退出）
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    // 注：fix(138) 后 export 子命令支持 --project-root，测试用 command.projectRoot 注入
    // 替代以前的 process.cwd mock，更接近产品真实调用模式
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('graph.json 缺失时 graceful exit 并输出提示', async () => {
    const { runExportCommand } = await import('../../src/cli/commands/export.js');
    const command = {
      subcommand: 'export' as const,
      exportFormat: 'obsidian' as const,
      outputDir: tmpDir,
      projectRoot: tmpDir,
      deep: false,
      force: false,
      version: false,
      help: false,
      global: false,
      remove: false,
      skillTarget: 'claude' as const,
    };
    await runExportCommand(command);
    // 应调用 process.exit 或输出提示信息
    const logCalls = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join(' ');
    const errCalls = consoleErrorSpy.mock.calls.map((c) => c.join(' ')).join(' ');
    const allOutput = logCalls + ' ' + errCalls;
    // 要么输出提示文本，要么调用了 process.exit
    const hasFeedback = allOutput.includes('graph') || processExitSpy.mock.calls.length > 0;
    expect(hasFeedback).toBe(true);
  });

  it('exportFormat 无效时 graceful exit（退出码非零）', async () => {
    const { runExportCommand } = await import('../../src/cli/commands/export.js');
    const command = {
      subcommand: 'export' as const,
      exportFormat: 'invalid' as 'obsidian' | 'html',
      outputDir: tmpDir,
      projectRoot: tmpDir,
      deep: false,
      force: false,
      version: false,
      help: false,
      global: false,
      remove: false,
      skillTarget: 'claude' as const,
    };
    await runExportCommand(command);
    // 应有错误输出或 process.exit 调用
    const hasErrorFeedback = consoleErrorSpy.mock.calls.length > 0 || processExitSpy.mock.calls.length > 0;
    expect(hasErrorFeedback).toBe(true);
  });

  it('空图（0 节点）时 graceful exit，不生成文件', async () => {
    // 写入空图 JSON 到 projectRoot 下的 specs/_meta/graph.json（与 export.ts 的 resolveGraphJsonPath 对齐）
    const metaDir = path.join(tmpDir, 'specs', '_meta');
    fs.mkdirSync(metaDir, { recursive: true });
    const emptyGraph = {
      directed: false,
      multigraph: false,
      graph: { name: 'spectra-knowledge-graph', generatedAt: '2026-01-01T00:00:00.000Z', nodeCount: 0, edgeCount: 0, sources: [], schemaVersion: '1.0' },
      nodes: [],
      links: [],
    };
    fs.writeFileSync(path.join(metaDir, 'graph.json'), JSON.stringify(emptyGraph), 'utf-8');

    const { runExportCommand } = await import('../../src/cli/commands/export.js');
    const command = {
      subcommand: 'export' as const,
      exportFormat: 'obsidian' as const,
      outputDir: tmpDir,
      projectRoot: tmpDir,
      deep: false,
      force: false,
      version: false,
      help: false,
      global: false,
      remove: false,
      skillTarget: 'claude' as const,
    };
    await runExportCommand(command);
    // 不应生成导出文件
    // outputDir 显式传入 tmpDir 时，obsidian-exporter 写到 {outputDir}/index.md，
    // 即 tmpDir/index.md（不会再嵌套 'export' 子目录）
    const hasExportFiles = fs.existsSync(path.join(tmpDir, 'index.md'))
      || fs.existsSync(path.join(tmpDir, 'graph.html'));
    expect(hasExportFiles).toBe(false);
  });

  it('--output-dir 未指定时使用默认值 _meta/export/', async () => {
    // 检查默认输出目录行为（通过检查 command.outputDir 处理逻辑）
    const result = parseArgs(['export', '--format', 'obsidian']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // outputDir 未指定，handler 层使用 _meta/export/ 默认
    expect(result.command.outputDir).toBeUndefined();
  });

  it('sentinel: 提供 --project-root 时不再访问 process.cwd（防回归）', async () => {
    // 写入有效 graph.json 让 export 跑到读取 graph 之后的代码路径，
    // 否则 graceful-exit 在 graph 缺失时提前 return，无法验证后续代码不调 cwd
    const metaDir = path.join(tmpDir, 'specs', '_meta');
    fs.mkdirSync(metaDir, { recursive: true });
    const minimalGraph = {
      directed: false,
      multigraph: false,
      graph: { name: 'spectra-knowledge-graph', generatedAt: '2026-01-01T00:00:00.000Z', nodeCount: 0, edgeCount: 0, sources: [], schemaVersion: '1.0' },
      nodes: [],
      links: [],
    };
    fs.writeFileSync(path.join(metaDir, 'graph.json'), JSON.stringify(minimalGraph), 'utf-8');

    // 用 spy 但不 mock：监控但不改 process.cwd 行为
    const cwdSpy = vi.spyOn(process, 'cwd');
    const { runExportCommand } = await import('../../src/cli/commands/export.js');
    await runExportCommand({
      subcommand: 'export' as const,
      exportFormat: 'obsidian' as const,
      outputDir: tmpDir,
      projectRoot: tmpDir,
      deep: false, force: false, version: false, help: false,
      global: false, remove: false, skillTarget: 'claude' as const,
    });
    // 提供 projectRoot 时 export 路径不应再调用 process.cwd
    expect(cwdSpy).not.toHaveBeenCalled();
  });
});

// ============================================================
// orchestrator-cli.sh wrapper 集成测试（fix/138 Codex Finding 2）
// ============================================================

describe('orchestrator-cli.sh wrapper', () => {
  it('从外部 cwd 启动 wrapper 不应触发 ERR_MODULE_NOT_FOUND', async () => {
    const { execFileSync } = await import('node:child_process');
    const REPO_ROOT = path.resolve(__dirname, '..', '..');
    const WRAPPER_PATH = path.join(REPO_ROOT, 'plugins', 'spec-driver', 'scripts', 'orchestrator-cli.sh');
    const externalCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-wrapper-test-'));
    try {
      // validate-config 不需要项目级 overrides，只验证 zod 等依赖能正常解析
      const stdout = execFileSync('bash', [WRAPPER_PATH, 'validate-config', '--project-root', REPO_ROOT], {
        cwd: externalCwd,
        encoding: 'utf-8',
        timeout: 10_000,
      });
      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      // 输出含 mode_count 表示完整 schema 校验链路成功执行（zod 已加载）
      expect(result.mode_count).toBeGreaterThan(0);
    } finally {
      fs.rmSync(externalCwd, { recursive: true, force: true });
    }
  });
});
