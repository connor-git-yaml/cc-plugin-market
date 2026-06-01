/**
 * F170e — graph_community MCP 工具 projectRoot 端到端测试
 *
 * 验证 MCP server 进程 cwd 与目标项目不同时，graph_community 仍从目标项目的
 * specs/_meta/GRAPH_REPORT.md 读取 cohesion（而非进程 cwd）。
 *
 * 这是 F170e CRITICAL-2 的真机回归：通过真实 registerGraphTools 注册 → 真实
 * getEngine（statSync + loadFromFile）→ getCommunity 全链路，不 mock 引擎。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerGraphTools, reloadGraph } from '../../src/mcp/graph-tools.js';

// 最小 fake MCP server：捕获 registerGraphTools 注册的 tool handler
interface CapturedTool {
  name: string;
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
}

function buildFakeServer(): { tools: CapturedTool[] } {
  const tools: CapturedTool[] = [];
  const server = {
    tool(
      name: string,
      _description: string,
      _schema: Record<string, unknown>,
      handler: CapturedTool['handler'],
    ): void {
      tools.push({ name, handler });
    },
  };
  // registerGraphTools 形参类型是 McpServer，这里用结构兼容的 fake 注入
  registerGraphTools(server as unknown as Parameters<typeof registerGraphTools>[0]);
  return { tools };
}

/** 在 root 下写入最小 graph.json（含 cluster_0 节点） */
function writeGraphJson(root: string): void {
  const graph = {
    directed: false,
    multigraph: false,
    graph: { nodeCount: 1, edgeCount: 0, sources: ['extractionResults'] },
    nodes: [
      {
        id: 'src/a.ts',
        kind: 'file',
        label: 'a.ts',
        metadata: { sourcePath: 'src/a.ts', community: 'cluster_0' },
      },
    ],
    links: [],
  };
  mkdirSync(join(root, 'specs', '_meta'), { recursive: true });
  writeFileSync(join(root, 'specs', '_meta', 'graph.json'), JSON.stringify(graph));
}

/** 在 root 下写入 GRAPH_REPORT.md（指定 cluster_0 内聚度） */
function writeReport(root: string, cohesion: string): void {
  mkdirSync(join(root, 'specs', '_meta'), { recursive: true });
  writeFileSync(
    join(root, 'specs', '_meta', 'GRAPH_REPORT.md'),
    `# Graph Report\n\n| Community | Size | Cohesion |\n|-----------|------|----------|\n| cluster_0 | 1 | ${cohesion} |\n`,
  );
}

describe('graph_community MCP 工具 — projectRoot 隔离（F170e CRITICAL-2）', () => {
  let projectRoot: string;
  let wrongCwd: string;

  beforeEach(() => {
    reloadGraph(); // 清缓存，避免跨用例污染
    projectRoot = mkdtempSync(join(tmpdir(), 'gc-projectroot-'));
    wrongCwd = mkdtempSync(join(tmpdir(), 'gc-wrongcwd-'));
  });

  afterEach(() => {
    // mock 替代 process.chdir，不触碰真实进程 cwd（Codex INFO-1）
    vi.restoreAllMocks();
    reloadGraph();
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(wrongCwd, { recursive: true, force: true });
  });

  it('MCP 进程 cwd ≠ 目标项目时，graph_community 读 projectRoot 的 GRAPH_REPORT.md', async () => {
    // 目标项目：graph.json + 正确 cohesion 0.77
    writeGraphJson(projectRoot);
    writeReport(projectRoot, '0.77');
    // 进程 cwd：误导性 cohesion 0.11（且也有 graph.json，确保不是因为 cwd 没图才不读）
    writeGraphJson(wrongCwd);
    writeReport(wrongCwd, '0.11');
    vi.spyOn(process, 'cwd').mockReturnValue(wrongCwd);

    const { tools } = buildFakeServer();
    const graphCommunity = tools.find((t) => t.name === 'graph_community');
    expect(graphCommunity).toBeDefined();

    const response = await graphCommunity!.handler({
      communityId: 'cluster_0',
      projectRoot,
    });
    const result = JSON.parse(response.content[0]!.text) as {
      cohesion: number | null;
      message?: string;
    };

    // 必须读 projectRoot 的 0.77，而非 cwd 的 0.11
    expect(result.cohesion).toBe(0.77);
    expect(result.message).toBeUndefined();
  });

  it('目标项目无 GRAPH_REPORT.md 时返回 not-found message（即便 cwd 有 report）', async () => {
    writeGraphJson(projectRoot); // 只有 graph.json，无 GRAPH_REPORT.md
    writeGraphJson(wrongCwd);
    writeReport(wrongCwd, '0.99'); // cwd 有 report，但不应被读到
    vi.spyOn(process, 'cwd').mockReturnValue(wrongCwd);

    const { tools } = buildFakeServer();
    const graphCommunity = tools.find((t) => t.name === 'graph_community')!;
    const response = await graphCommunity.handler({
      communityId: 'cluster_0',
      projectRoot,
    });
    const result = JSON.parse(response.content[0]!.text) as {
      cohesion: number | null;
      message?: string;
    };

    expect(result.cohesion).toBeNull();
    expect(result.message).toContain('未找到');
  });
});
