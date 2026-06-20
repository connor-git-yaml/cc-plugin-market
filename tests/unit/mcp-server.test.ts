/**
 * mcp/server 单元测试
 * 验证工具注册与各 handler 的成功/失败分支
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepareContext: vi.fn(),
  generateSpec: vi.fn(),
  runBatch: vi.fn(),
  detectDrift: vi.fn(),
  // T001：为 graph-only dispatch 路由测试补充 buildAstGraphOnly mock 桩
  buildAstGraphOnly: vi.fn(),
}));

const hoistedTypes = vi.hoisted(() => ({
  FakeMcpServer: class FakeMcpServer {
    public config: Record<string, unknown>;
    public tools: Array<{
      name: string;
      description: string;
      schema: Record<string, unknown>;
      handler: (args: any) => Promise<any>;
    }> = [];

    constructor(config: Record<string, unknown>) {
      this.config = config;
    }

    tool(
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: (args: any) => Promise<any>,
    ): void {
      this.tools.push({ name, description, schema, handler });
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: hoistedTypes.FakeMcpServer,
}));

vi.mock('../../src/core/single-spec-orchestrator.js', () => ({
  prepareContext: mocks.prepareContext,
  generateSpec: mocks.generateSpec,
}));

vi.mock('../../src/batch/batch-orchestrator.js', () => ({
  runBatch: mocks.runBatch,
  // T001：新增 buildAstGraphOnly 导出，供 graph-only dispatch 路由测试使用
  buildAstGraphOnly: mocks.buildAstGraphOnly,
}));

vi.mock('../../src/diff/drift-orchestrator.js', () => ({
  detectDrift: mocks.detectDrift,
}));

vi.mock('../../src/config/project-config.js', () => ({
  loadProjectConfig: vi.fn(() => ({})),
}));

import { createMcpServer } from '../../src/mcp/server.js';

function findTool(server: any, name: string) {
  const tool = server.tools.find((t: any) => t.name === name);
  if (!tool) {
    throw new Error(`tool ${name} not found`);
  }
  return tool;
}

describe('createMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('注册 prepare/generate/batch/diff/panoramic-query / graph 查询 / agent-context 工具', () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    const names = server.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'batch', 'context', 'detect_changes', 'diff', 'generate',
      'graph_community', 'graph_god_nodes', 'graph_hyperedges', 'graph_node', 'graph_path', 'graph_query',
      'impact',
      'list_directory',
      'panoramic-query', 'prepare',
      'search_in_file',
      'view_file',
    ]);
  });

  it('prepare handler 成功返回 JSON 文本', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    mocks.prepareContext.mockResolvedValue({ foo: 'bar' });
    const tool = findTool(server, 'prepare');

    const result = await tool.handler({ targetPath: 'src', deep: true });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('"foo":"bar"');
  });

  it('prepare handler 失败返回 isError=true', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    mocks.prepareContext.mockRejectedValue(new Error('prepare boom'));
    const tool = findTool(server, 'prepare');

    const result = await tool.handler({ targetPath: 'src', deep: false });
    expect(result.isError).toBe(true);
    // F177：错误 envelope 统一为 {code,message}，顶层异常脱敏为 internal-error
    expect(JSON.parse(result.content[0]!.text).code).toBe('internal-error');
  });

  it('generate handler 成功返回关键字段', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    mocks.generateSpec.mockResolvedValue({
      specPath: 'specs/a.spec.md',
      tokenUsage: 321,
      confidence: 'medium',
      warnings: ['w1'],
    });
    const tool = findTool(server, 'generate');

    const result = await tool.handler({
      targetPath: 'src/a.ts',
      deep: true,
      outputDir: 'specs',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('"specPath":"specs/a.spec.md"');
    expect(result.content[0]!.text).toContain('"tokenUsage":321');
  });

  it('generate handler 失败返回 isError=true', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    mocks.generateSpec.mockRejectedValue(new Error('generate boom'));
    const tool = findTool(server, 'generate');

    const result = await tool.handler({
      targetPath: 'src/a.ts',
      deep: false,
      outputDir: 'specs',
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text).code).toBe('internal-error');
  });

  it('batch handler 成功时返回结果', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    mocks.runBatch.mockResolvedValue({
      totalModules: 1,
      successful: ['a'],
      failed: [],
      skipped: [],
      degraded: [],
      duration: 1,
      indexGenerated: true,
      summaryLogPath: 'specs/x.md',
    });
    const tool = findTool(server, 'batch');

    const result = await tool.handler({ projectRoot: '/tmp/p', force: false });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('"totalModules":1');
  });

  it('batch handler 失败时返回 isError=true', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    mocks.runBatch.mockRejectedValue(new Error('batch boom'));
    const tool = findTool(server, 'batch');

    const result = await tool.handler({ projectRoot: '/tmp/p', force: true });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text).code).toBe('internal-error');
  });

  // ────────────────────────────────────────────────────────────
  // T091: batch 工具接受 languages 参数并正确传递给 runBatch()
  // ────────────────────────────────────────────────────────────
  it('T091: batch handler 接受 languages 参数并传递给 runBatch', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    mocks.runBatch.mockResolvedValue({
      totalModules: 2,
      successful: ['api'],
      failed: [],
      skipped: [],
      degraded: [],
      duration: 100,
      indexGenerated: true,
      summaryLogPath: 'specs/summary.md',
      detectedLanguages: ['ts-js', 'python'],
    });
    const tool = findTool(server, 'batch');

    await tool.handler({
      projectRoot: '/tmp/p',
      force: false,
      languages: ['ts-js', 'python'],
    });

    // 验证 runBatch 被调用时传入了 languages 参数
    expect(mocks.runBatch).toHaveBeenCalledTimes(1);
    const callArgs = mocks.runBatch.mock.calls[0]!;
    expect(callArgs[1]).toEqual(
      expect.objectContaining({ languages: ['ts-js', 'python'] }),
    );
  });

  // ────────────────────────────────────────────────────────────
  // T094-05: batch 工具接受 incremental 参数并正确传递给 runBatch()
  // ────────────────────────────────────────────────────────────
  it('T094-05: batch handler 接受 incremental 参数并传递给 runBatch', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    mocks.runBatch.mockResolvedValue({
      totalModules: 1,
      successful: ['a'],
      failed: [],
      skipped: [],
      degraded: [],
      duration: 1,
      indexGenerated: true,
      summaryLogPath: 'specs/x.md',
    });
    const tool = findTool(server, 'batch');

    await tool.handler({ projectRoot: '/tmp/p', force: false, incremental: true });

    expect(mocks.runBatch).toHaveBeenCalledTimes(1);
    const callArgs = mocks.runBatch.mock.calls[0]!;
    expect(callArgs[1]).toEqual(
      expect.objectContaining({ incremental: true }),
    );
  });

  // ────────────────────────────────────────────────────────────
  // Feature 202: MCP batch 工具 graph-only 模式
  // T002-T007: 用例 A / A2 / B / C / D / E
  // ────────────────────────────────────────────────────────────

  // 用例 A — graph-only dispatch 到 buildAstGraphOnly，不调用 runBatch（FR-004/005）
  it('batch handler graph-only 模式 dispatch 到 buildAstGraphOnly，不调用 runBatch', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    const fakeResult = {
      graphPath: '/tmp/test-proj/specs/_meta/graph.json',
      nodeCount: 42,
      edgeCount: 10,
      callEdgeCount: 6,
      dependsOnEdgeCount: 4,
      pythonSymbolCount: 0,
      durationMs: 800,
    };
    mocks.buildAstGraphOnly.mockResolvedValue(fakeResult);
    const tool = findTool(server, 'batch');

    const result = await tool.handler({ projectRoot: '/tmp/test-proj', mode: 'graph-only' });

    expect(result.isError).toBeUndefined();
    expect(mocks.buildAstGraphOnly).toHaveBeenCalledTimes(1);
    expect(mocks.runBatch).not.toHaveBeenCalled();
    // 返回形态与现有 batch 同构：裸 JSON.stringify
    const parsed = JSON.parse(result.content[0]!.text) as typeof fakeResult;
    expect(parsed.graphPath).toBe('/tmp/test-proj/specs/_meta/graph.json');
    expect(parsed.nodeCount).toBe(42);
  });

  // 用例 A2 — batch 工具 mode schema 接受 graph-only 枚举值（FR-001，schema 级断言）
  it('batch 工具 mode schema 接受 graph-only 枚举值', () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    const batchTool = findTool(server, 'batch');
    // schema.mode 是 Zod ZodEnum；safeParse 直接验枚举
    // FakeMcpServer 不跑 Zod 校验，故此处显式 parse 以守护枚举完整性
    const modeSchema = batchTool.schema.mode as { safeParse: (v: unknown) => { success: boolean } };
    expect(modeSchema.safeParse('graph-only').success).toBe(true);
    expect(modeSchema.safeParse('full').success).toBe(true);      // 旧值不丢
    expect(modeSchema.safeParse('bogus').success).toBe(false);    // 非法值仍拒
  });

  // 用例 B — graph-only 时 buildAstGraphOnly 不接收 regen 参数（FR-009，EC-003）
  it('graph-only 模式 buildAstGraphOnly 调用签名不含 regen 轴参数', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    mocks.buildAstGraphOnly.mockResolvedValue({
      graphPath: '/tmp/p/specs/_meta/graph.json',
      nodeCount: 0,
      edgeCount: 0,
      callEdgeCount: 0,
      dependsOnEdgeCount: 0,
      pythonSymbolCount: 0,
      durationMs: 1,
    });
    const tool = findTool(server, 'batch');

    await tool.handler({
      projectRoot: '/tmp/p',
      mode: 'graph-only',
      incremental: true,
      force: true,
    });

    expect(mocks.buildAstGraphOnly).toHaveBeenCalledTimes(1);
    // Codex C2 修正：实现为 buildAstGraphOnly(root)（单参），断言只传 1 个参数
    const callArgs = mocks.buildAstGraphOnly.mock.calls[0]!;
    expect(callArgs).toHaveLength(1);              // 只传 projectRoot，未传 regen/options 第二参
    expect(callArgs[0]).toBe('/tmp/p');
    expect(mocks.runBatch).not.toHaveBeenCalled(); // regen 参数对 graph-only 完全不可见
  });

  // 用例 C — mode 字段 describe 文案一致性（FR-002，SC-载体-001b）
  it('batch 工具 mode describe 文案不含旧"暂不支持 graph-only"字样且含 graph-only 定位关键词', () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    const batchTool = findTool(server, 'batch');
    // Zod schema 存储在 tool.schema.mode；describe() 文本在其 .description 属性
    const modeSchema = batchTool.schema.mode as { description?: string } | undefined;
    const desc = (modeSchema as { description?: string } | undefined)?.description ?? '';
    expect(desc).not.toContain('暂不支持 graph-only');
    expect(desc).toMatch(/纯 AST|零 LLM/);
  });

  // 用例 D — 三旧 mode 仍走 runBatch、不进 graph-only 分支（FR-007 零回归基线）
  it.each(['full', 'reading', 'code-only'] as const)(
    'batch handler %s 模式仍 dispatch 到 runBatch，不调用 buildAstGraphOnly',
    async (mode) => {
      const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
      mocks.runBatch.mockResolvedValue({ successful: [], skipped: [], failed: [], indexGenerated: false });
      const tool = findTool(server, 'batch');

      await tool.handler({ projectRoot: '/tmp/p', mode });

      expect(mocks.runBatch).toHaveBeenCalledTimes(1);
      expect(mocks.runBatch.mock.calls[0]![1]).toMatchObject({ mode }); // mode 逐值透传
      expect(mocks.buildAstGraphOnly).not.toHaveBeenCalled();
    },
  );

  // 用例 E — graph-only + languages 不报错、不透传 languages、发 warn 日志（FR-010，EC-001）
  it('graph-only + languages 时透传 warn 日志但不把 languages 传给 buildAstGraphOnly', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    mocks.buildAstGraphOnly.mockResolvedValue({
      graphPath: '/tmp/p/specs/_meta/graph.json',
      nodeCount: 1,
      edgeCount: 0,
      callEdgeCount: 0,
      dependsOnEdgeCount: 0,
      pythonSymbolCount: 0,
      durationMs: 1,
    });
    // batch handler 的日志出口是 console.error（mcpLogger.info → console.error）
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tool = findTool(server, 'batch');

    // try/finally 保护 spy 生命周期（Codex quality W）：任一 expect 抛出仍恢复 console.error，
    // 避免 spy 泄漏污染后续用例
    try {
      const result = await tool.handler({ projectRoot: '/tmp/p', mode: 'graph-only', languages: ['typescript'] });

      expect(result.isError).toBeUndefined();                          // 不报错、不拒绝
      expect(mocks.buildAstGraphOnly).toHaveBeenCalledTimes(1);
      expect(mocks.buildAstGraphOnly.mock.calls[0]!).toHaveLength(1);  // 第二参未传，languages 没漏给建图
      expect(errSpy.mock.calls.flat().join('\n')).toMatch(/graph-only.*languages|languages.*graph-only/);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('diff handler 会解析绝对路径并返回结果', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    mocks.detectDrift.mockResolvedValue({ outputPath: 'drift/a.md' });
    const tool = findTool(server, 'diff');

    const result = await tool.handler({
      specPath: 'specs/a.spec.md',
      sourcePath: 'src/a.ts',
    });
    expect(result.isError).toBeUndefined();
    expect(mocks.detectDrift).toHaveBeenCalledTimes(1);
    expect(result.content[0]!.text).toContain('"outputPath":"drift/a.md"');
  });

  it('diff handler 失败时返回 isError=true', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    mocks.detectDrift.mockRejectedValue(new Error('diff boom'));
    const tool = findTool(server, 'diff');

    const result = await tool.handler({
      specPath: 'specs/a.spec.md',
      sourcePath: 'src/a.ts',
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text).code).toBe('internal-error');
  });
});
