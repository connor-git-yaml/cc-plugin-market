/**
 * Feature 177 — telemetry 17/17 工具覆盖矩阵（RED→GREEN）
 *
 * 防假绿（Codex WARNING-2）：用 fake server 捕获 createMcpServer 注册的真实 handler，
 * 逐个调用一次，断言每次调用恰写 1 行 telemetry JSONL（锁死双发射 EC-1）+ toolName 全覆盖。
 *
 * 关键：本文件**不 mock** src/mcp/lib/telemetry.js（真实 writeTelemetry），经 env
 * SPECTRA_MCP_TELEMETRY_PATH 落盘临时文件。范围限定"到达 handler 的调用"（spec EC-10）。
 *
 * RED 阶段：graph 6 + server 5 共 11 工具无 telemetry → 0 行 → 断言失败。
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  prepareContext: vi.fn(),
  generateSpec: vi.fn(),
  runBatch: vi.fn(),
  detectDrift: vi.fn(),
  queryPanoramic: vi.fn(),
}));

const hoistedTypes = vi.hoisted(() => ({
  FakeMcpServer: class FakeMcpServer {
    public tools: Array<{
      name: string;
      handler: (args: Record<string, unknown>) => Promise<unknown>;
    }> = [];
    constructor(_config: Record<string, unknown>) {}
    tool(
      name: string,
      _description: string,
      _schema: Record<string, unknown>,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ): void {
      this.tools.push({ name, handler });
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: hoistedTypes.FakeMcpServer,
}));
vi.mock('../../../src/core/single-spec-orchestrator.js', () => ({
  prepareContext: mocks.prepareContext,
  generateSpec: mocks.generateSpec,
}));
vi.mock('../../../src/batch/batch-orchestrator.js', () => ({
  runBatch: mocks.runBatch,
  // F202：server.ts 新增 import buildAstGraphOnly，mock 补全该具名导出（本文件不调 graph-only，仅防缺失 export）
  buildAstGraphOnly: vi.fn(),
}));
vi.mock('../../../src/diff/drift-orchestrator.js', () => ({
  detectDrift: mocks.detectDrift,
}));
vi.mock('../../../src/panoramic/query.js', () => ({
  queryPanoramic: mocks.queryPanoramic,
}));
vi.mock('../../../src/config/project-config.js', () => ({
  loadProjectConfig: vi.fn(() => ({})),
}));

import { createMcpServer } from '../../../src/mcp/server.js';

/** 17 工具权威名单（注册漂移护栏） */
const ALL_17_TOOLS = [
  'prepare', 'generate', 'batch', 'diff', 'panoramic-query',
  'graph_query', 'graph_node', 'graph_path', 'graph_community', 'graph_god_nodes', 'graph_hyperedges',
  'impact', 'context', 'detect_changes',
  'view_file', 'search_in_file', 'list_directory',
] as const;

describe('Feature 177 — telemetry 17/17 覆盖矩阵', () => {
  let emptyRoot: string;
  let telPath: string;
  let server: { tools: Array<{ name: string; handler: (a: Record<string, unknown>) => Promise<unknown> }> };
  const savedTelPath = process.env['SPECTRA_MCP_TELEMETRY_PATH'];
  const savedRunId = process.env['SPECTRA_MCP_RUN_ID'];

  beforeAll(() => {
    emptyRoot = mkdtempSync(join(tmpdir(), 'f177-tel-'));
    process.env['SPECTRA_MCP_RUN_ID'] = 'f177-test-run';
  });

  afterAll(() => {
    rmSync(emptyRoot, { recursive: true, force: true });
    if (savedTelPath === undefined) delete process.env['SPECTRA_MCP_TELEMETRY_PATH'];
    else process.env['SPECTRA_MCP_TELEMETRY_PATH'] = savedTelPath;
    if (savedRunId === undefined) delete process.env['SPECTRA_MCP_RUN_ID'];
    else process.env['SPECTRA_MCP_RUN_ID'] = savedRunId;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepareContext.mockRejectedValue(new Error('boom'));
    mocks.generateSpec.mockRejectedValue(new Error('boom'));
    mocks.runBatch.mockRejectedValue(new Error('boom'));
    mocks.detectDrift.mockRejectedValue(new Error('boom'));
    mocks.queryPanoramic.mockResolvedValue({ ok: false, error: '缺少 question 参数' });
    server = createMcpServer() as unknown as typeof server;
    telPath = join(emptyRoot, `tel-${Math.floor(performance.now())}-${server.tools.length}.jsonl`);
    writeFileSync(telPath, '');
    process.env['SPECTRA_MCP_TELEMETRY_PATH'] = telPath;
  });

  afterEach(() => {
    if (existsSync(telPath)) rmSync(telPath, { force: true });
  });

  /** 各工具到达 handler 的最小入参（错误或成功路径均可，只要触发一次 handler） */
  function argsFor(name: string): Record<string, unknown> {
    switch (name) {
      case 'prepare': return { targetPath: '.', deep: false };
      case 'generate': return { targetPath: '.', deep: false, outputDir: 'specs' };
      case 'batch': return { projectRoot: emptyRoot };
      case 'diff': return { specPath: 'a.spec.md', sourcePath: 'a.ts' };
      case 'panoramic-query': return { operation: 'overview', projectRoot: emptyRoot };
      case 'graph_query': return { question: 'x', projectRoot: emptyRoot };
      case 'graph_node': return { id: 'x', projectRoot: emptyRoot };
      case 'graph_path': return { source: 'a', target: 'b', projectRoot: emptyRoot };
      case 'graph_community': return { communityId: 'c', projectRoot: emptyRoot };
      case 'graph_god_nodes': return { limit: 3, projectRoot: emptyRoot };
      case 'graph_hyperedges': return { projectRoot: emptyRoot };
      case 'impact': return { target: 'x', projectRoot: emptyRoot };
      case 'context': return { symbolId: 'x', projectRoot: emptyRoot };
      case 'detect_changes': return { projectRoot: emptyRoot };
      case 'view_file': return { path: 'x.ts', projectRoot: emptyRoot };
      case 'search_in_file': return { path: 'x.ts', pattern: 'y', projectRoot: emptyRoot };
      case 'list_directory': return { path: '.', projectRoot: emptyRoot };
      default: return { projectRoot: emptyRoot };
    }
  }

  it('createMcpServer 恰注册 17 工具（防漂移）', () => {
    expect(server.tools.length).toBe(17);
    const names = server.tools.map((t) => t.name).sort();
    expect(names).toEqual([...ALL_17_TOOLS].sort());
  });

  for (const name of ALL_17_TOOLS) {
    it(`${name} 每次调用恰写 1 行 telemetry（toolName 匹配）`, async () => {
      const t = server.tools.find((x) => x.name === name);
      expect(t, `${name} 未注册`).toBeDefined();
      await t!.handler(argsFor(name));
      const lines = readFileSync(telPath, 'utf-8').split('\n').filter((l) => l.trim().length > 0);
      expect(lines.length, `${name} 应恰写 1 行 telemetry（实际 ${lines.length}）`).toBe(1);
      const entry = JSON.parse(lines[0]!) as { toolName: string; runId: string };
      expect(entry.toolName).toBe(name);
      expect(entry.runId).toBe('f177-test-run');
    });
  }
});
