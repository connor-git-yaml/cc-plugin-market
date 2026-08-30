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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
    // panoramic 预期输入失败路径（!result.ok + kind=invalid-input）
    mocks.queryPanoramic.mockResolvedValue({ ok: false, error: '缺少 question 参数', kind: 'invalid-input' });
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

  it('graph 坏图（损坏 graph.json）→ graph-not-built 固定文案，不泄露绝对路径（CRITICAL-1 脱敏边界）', async () => {
    // loadFromFile 抛错信息含绝对 graphPath；runGraphTool 须映射为固定 graph-not-built 文案
    const metaDir = join(emptyRoot, 'specs', '_meta');
    mkdirSync(metaDir, { recursive: true });
    const graphPath = join(metaDir, 'graph.json');
    writeFileSync(graphPath, '{ this is : not valid json');
    const result = await tool('graph_query').handler({ question: 'x', projectRoot: emptyRoot });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env!['code']).toBe('graph-not-built');
    // 脱敏：响应不含绝对路径（graphPath / emptyRoot）
    expect(JSON.stringify(env)).not.toContain(graphPath);
    expect(JSON.stringify(env)).not.toContain(emptyRoot);
  });

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

  // ── F271 FR-014：prepare 存在性前置校验（新增分支，不改上面既有断言）──
  it('F271: prepare 对不存在路径返回 file-not-found（不再塌缩为 internal-error）', async () => {
    const missing = join(emptyRoot, 'does-not-exist');
    const result = await tool('prepare').handler({ targetPath: missing, deep: false });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env).not.toBeNull();
    expect(env!['code']).toBe('file-not-found');
    // 诊断信息可用，但只到 basename 为止：F180 脱敏红线（e2e assertNoSensitiveData 禁止
    // 响应体出现 /Users/... 、/var/folders/... 等调用方绝对路径）优先于"回显完整入参"。
    // 故这里断言 basename 而非 `missing` 全路径——server.ts 刻意只回显 basename(targetPath)。
    expect(String(env!['message'])).toContain('does-not-exist');
    expect(String(env!['message'])).not.toContain(missing);
    // 前置短路：orchestrator 根本没被调用
    expect(mocks.prepareContext).not.toHaveBeenCalled();
  });

  // ── F271 对抗审查 F5：前置校验只对"确实不存在"说 file-not-found ──
  it('F271 F5: 路径中间段不是目录（ENOTDIR）→ 仍算不存在，返回 file-not-found', async () => {
    const filePath = join(emptyRoot, 'plain.txt');
    writeFileSync(filePath, 'x');
    const result = await tool('prepare').handler({ targetPath: join(filePath, 'sub'), deep: false });
    expect(result.isError).toBe(true);
    expect(parseEnvelope(result)!['code']).toBe('file-not-found');
    expect(mocks.prepareContext).not.toHaveBeenCalled();
  });

  it('F271 F5: 非 ENOENT/ENOTDIR 的可访问性异常（ENAMETOOLONG）不得谎称 file-not-found，落 internal-error', async () => {
    // 路径**语法上**存在问题而非"不存在"：报 file-not-found 会把排查引向"路径写错了"，
    // 而真实原因是文件系统拒绝了这次 stat。含糊的 internal-error 也好过撒谎的 file-not-found。
    const tooLong = join(emptyRoot, 'a'.repeat(5000));
    const result = await tool('prepare').handler({ targetPath: tooLong, deep: false });
    expect(result.isError).toBe(true);
    expect(parseEnvelope(result)!['code']).toBe('internal-error');
    expect(mocks.prepareContext).not.toHaveBeenCalled();
  });

  it('F271: 存在路径但 orchestrator 抛未预期异常 → 仍脱敏为 internal-error（F177 不变量不被前置校验削弱）', async () => {
    // emptyRoot 存在 → 前置校验放行 → mock reject → 落 telemetry 兜底
    const result = await tool('prepare').handler({ targetPath: emptyRoot, deep: false });
    expect(result.isError).toBe(true);
    expect(parseEnvelope(result)!['code']).toBe('internal-error');
    expect(mocks.prepareContext).toHaveBeenCalled();
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

  it('panoramic-query 预期输入失败（kind=invalid-input）含 code（invalid-input）+ isError', async () => {
    const result = await tool('panoramic-query').handler({ operation: 'natural-language', projectRoot: emptyRoot });
    expect(result.isError).toBe(true); // 旧实现此路径未置 isError → RED
    const env = parseEnvelope(result);
    expect(env).not.toBeNull();
    expect(env!['code']).toBe('invalid-input');
  });

  it('panoramic-query 内部异常（kind=internal）脱敏为 internal-error（不回传含路径的 error 原文，C-4）', async () => {
    const leakyPath = join(emptyRoot, 'leaky', 'absolute', 'path.ts');
    mocks.queryPanoramic.mockResolvedValueOnce({ ok: false, error: `boom at ${leakyPath}`, kind: 'internal' });
    const result = await tool('panoramic-query').handler({ operation: 'overview', projectRoot: emptyRoot });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env).not.toBeNull();
    expect(env!['code']).toBe('internal-error');
    // 脱敏：不回传含绝对路径的 err.message 原文
    expect(JSON.stringify(env)).not.toContain(leakyPath);
  });

  // ── agent-context + file-nav 6 工具：已是 code 契约（回归保护） ──
  it('impact 缺图错误响应含 code（已有契约，回归保护）', async () => {
    const result = await tool('impact').handler({ target: 'x', projectRoot: emptyRoot });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env!['code']).toBe('graph-not-built');
  });

  it('context 缺图错误响应含 code（已有契约，回归保护）', async () => {
    const result = await tool('context').handler({ symbolId: 'x', projectRoot: emptyRoot });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env!['code']).toBe('graph-not-built');
    expect(env!['error']).toBeUndefined();
  });

  it('detect_changes 缺 diff/baseRef 错误响应含 code（invalid-input，已有契约）', async () => {
    const result = await tool('detect_changes').handler({ projectRoot: emptyRoot });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env!['code']).toBe('invalid-input');
    expect(env!['error']).toBeUndefined();
  });

  it('search_in_file 非法 path 错误响应含 code（已有契约，回归保护）', async () => {
    const result = await tool('search_in_file').handler({ path: '', pattern: 'y', projectRoot: emptyRoot });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env!['code']).toBe('invalid-input');
  });

  it('list_directory 非法 path 错误响应含 code（已有契约，回归保护）', async () => {
    const result = await tool('list_directory').handler({ path: '', projectRoot: emptyRoot });
    expect(result.isError).toBe(true);
    const env = parseEnvelope(result);
    expect(env!['code']).toBe('invalid-input');
  });
});
