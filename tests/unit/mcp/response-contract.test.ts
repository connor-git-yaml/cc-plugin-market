/**
 * Feature 177 — MCP 工具统一错误响应契约（RED→GREEN）
 *
 * 验证 17/17 工具的**错误响应**含统一 `code` 字段（无旧 `{error}` / 纯文本残留）。
 * 经 createMcpServer 注册的真实 handler 驱动（不 import 未实现内部符号），范围限定
 * "入参通过 schema 校验、到达 handler 的调用"（spec EC-10）。
 *
 * RED 阶段：graph 6 工具返回旧 `{error}`、server 5 工具返回纯文本 → 断言失败。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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
      handler: (args: Record<string, unknown>) => Promise<{
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      }>;
    }> = [];
    constructor(_config: Record<string, unknown>) {}
    tool(
      name: string,
      _description: string,
      _schema: Record<string, unknown>,
      handler: (args: Record<string, unknown>) => Promise<{
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      }>,
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

/** 解析 handler 错误响应的 JSON envelope（错误时 content[0].text 应为 {code,message,...}） */
function parseEnvelope(result: { content: Array<{ text: string }> }): Record<string, unknown> | null {
  const text = result.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null; // 纯文本（非 JSON）→ 旧 server 错误形态
  }
}

describe('Feature 177 — 17 工具统一错误响应契约', () => {
  let emptyRoot: string;
  let server: { tools: Array<{ name: string; handler: (a: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }> };

  beforeEach(() => {
    vi.clearAllMocks();
    // 无 graph.json 的空目录 → graph/agent-context 工具走 graph-not-built
    emptyRoot = mkdtempSync(join(tmpdir(), 'f177-contract-'));
    // server 工具的 orchestrator 一律 reject → 顶层 internal-error
    mocks.prepareContext.mockRejectedValue(new Error('boom'));
    mocks.generateSpec.mockRejectedValue(new Error('boom'));
    mocks.runBatch.mockRejectedValue(new Error('boom'));
    mocks.detectDrift.mockRejectedValue(new Error('boom'));
    // panoramic 预期失败路径（!result.ok）
    mocks.queryPanoramic.mockResolvedValue({ ok: false, error: '缺少 question 参数' });
    server = createMcpServer() as unknown as typeof server;
  });

  afterEach(() => {
    rmSync(emptyRoot, { recursive: true, force: true });
  });

  function tool(name: string) {
    const t = server.tools.find((x) => x.name === name);
    if (!t) throw new Error(`tool ${name} 未注册`);
    return t;
  }

  // ── graph 6 工具：缺图 → graph-not-built（带 code） ──
  const graphCases: Array<[string, Record<string, unknown>]> = [
    ['graph_query', { question: 'x', projectRoot: '__PLACEHOLDER__' }],
    ['graph_node', { id: 'x', projectRoot: '__PLACEHOLDER__' }],
    ['graph_path', { source: 'a', target: 'b', projectRoot: '__PLACEHOLDER__' }],
    ['graph_community', { communityId: 'c', projectRoot: '__PLACEHOLDER__' }],
    ['graph_god_nodes', { limit: 3, projectRoot: '__PLACEHOLDER__' }],
    ['graph_hyperedges', { projectRoot: '__PLACEHOLDER__' }],
  ];
  for (const [name, args] of graphCases) {
    it(`${name} 缺图错误响应含 code 字段（graph-not-built）`, async () => {
      const a = { ...args, projectRoot: emptyRoot };
      const result = await tool(name).handler(a);
      expect(result.isError).toBe(true);
      const env = parseEnvelope(result);
      expect(env).not.toBeNull();
      expect(typeof env!['code']).toBe('string');
      expect(env!['code']).toBe('graph-not-built');
      // 无旧 {error} 残留
      expect(env!['error']).toBeUndefined();
    });
  }

  it('graph_hyperedges 空串 label 错误响应含 code（invalid-input）', async () => {
    const result = await tool('graph_hyperedges').handler({ label: '', projectRoot: emptyRoot });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env).not.toBeNull();
    expect(env!['code']).toBe('invalid-input');
    expect(env!['error']).toBeUndefined();
  });

  // ── server 5 工具：错误响应含 code ──
  it('prepare 顶层异常错误响应含 code（internal-error）', async () => {
    const result = await tool('prepare').handler({ targetPath: '.', deep: false });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env).not.toBeNull(); // 旧实现返回纯文本 → null → RED
    expect(env!['code']).toBe('internal-error');
  });

  it('generate 顶层异常错误响应含 code（internal-error）', async () => {
    const result = await tool('generate').handler({ targetPath: '.', deep: false, outputDir: 'specs' });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env).not.toBeNull();
    expect(env!['code']).toBe('internal-error');
  });

  it('batch 顶层异常错误响应含 code（internal-error）', async () => {
    const result = await tool('batch').handler({ projectRoot: emptyRoot });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env).not.toBeNull();
    expect(env!['code']).toBe('internal-error');
  });

  it('diff 顶层异常错误响应含 code（internal-error）', async () => {
    const result = await tool('diff').handler({ specPath: 'a.spec.md', sourcePath: 'a.ts' });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env).not.toBeNull();
    expect(env!['code']).toBe('internal-error');
  });

  it('panoramic-query 预期失败（!result.ok）含 code（invalid-input）+ isError', async () => {
    const result = await tool('panoramic-query').handler({ operation: 'natural-language', projectRoot: emptyRoot });
    expect(result.isError).toBe(true); // 旧实现此路径未置 isError → RED
    const env = parseEnvelope(result);
    expect(env).not.toBeNull();
    expect(env!['code']).toBe('invalid-input');
  });

  // ── agent-context + file-nav 6 工具：已是 code 契约（回归保护） ──
  it('impact 缺图错误响应含 code（已有契约，回归保护）', async () => {
    const result = await tool('impact').handler({ target: 'x', projectRoot: emptyRoot });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env!['code']).toBe('graph-not-built');
  });

  it('view_file 非法 path 错误响应含 code（已有契约，回归保护）', async () => {
    const result = await tool('view_file').handler({ path: '', projectRoot: emptyRoot });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env!['code']).toBe('invalid-input');
  });
});
