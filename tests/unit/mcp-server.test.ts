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
}));

vi.mock('../../src/diff/drift-orchestrator.js', () => ({
  detectDrift: mocks.detectDrift,
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

  it('注册 prepare/generate/batch/diff 四个工具', () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    const names = server.tools.map((t) => t.name).sort();
    expect(names).toEqual(['batch', 'diff', 'generate', 'prepare']);
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
    expect(result.content[0]!.text).toContain('prepare 失败');
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
    expect(result.content[0]!.text).toContain('generate 失败');
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
    expect(result.content[0]!.text).toContain('batch 失败');
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
    expect(result.content[0]!.text).toContain('diff 失败');
  });
});
