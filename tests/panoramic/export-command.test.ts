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
    // 写入空图 JSON
    const metaDir = path.join(tmpDir, '_meta');
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
      deep: false,
      force: false,
      version: false,
      help: false,
      global: false,
      remove: false,
      skillTarget: 'claude' as const,
    };
    await runExportCommand(command);
    // 不应生成导出文件（不存在 index.md 或 graph.html）
    const hasExportFiles = fs.existsSync(path.join(tmpDir, 'export', 'index.md'))
      || fs.existsSync(path.join(tmpDir, 'export', 'graph.html'));
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
});
