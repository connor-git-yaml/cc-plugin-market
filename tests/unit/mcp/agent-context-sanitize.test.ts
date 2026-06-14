/**
 * F186 T4 — agent-context-tools 3 处错误响应脱敏
 *
 * 验证回传给 MCP 客户端的错误 message/context 不泄露绝对路径（/Users/、/home/）或 stack：
 *   1. runAgentContextTool 顶层 catch → 固定文案「内部错误，请稍后重试」，无 stack 字段
 *   2. loadGraphOrError 缺图分支 → 「graph 未构建」+ hint，不含 projectRoot 内插
 *   3. loadGraphOrError 其他加载失败 → 同上固定文案
 *
 * 不在范围：stale 分支（graph-format-stale）按 FINAL 设计审查处置维持现状（故意诊断信号）。
 * 各分支保留 code 字段（客户端只消费 code）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphJSON } from '../../../src/panoramic/graph/graph-types.js';

const mocks = vi.hoisted(() => ({
  getCachedGraphData: vi.fn(),
  bfsTraverse: vi.fn(),
}));

vi.mock('../../../src/mcp/graph-tools.js', () => ({
  getCachedGraphData: mocks.getCachedGraphData,
  reloadGraph: vi.fn(),
  // 保留真实 stale 判定：用例 3 的普通 Error 不含 graph-format-stale → false → graph-not-built
  isGraphFormatStaleError: (err: unknown): err is Error =>
    err instanceof Error && err.message.includes('graph-format-stale'),
}));

vi.mock('../../../src/knowledge-graph/query-helpers.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/knowledge-graph/query-helpers.js')>(
    '../../../src/knowledge-graph/query-helpers.js',
  );
  return { ...actual, bfsTraverse: mocks.bfsTraverse };
});

import { handleImpact } from '../../../src/mcp/agent-context-tools.js';
import type { ToolResult } from '../../../src/mcp/lib/tool-response.js';

const ABSOLUTE_PATH_LEAK = '/Users/secret/worktree/spectra/engine.py::Value';

function makeGraph(): GraphJSON {
  return {
    directed: true,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-06-14T00:00:00.000Z',
      nodeCount: 1,
      edgeCount: 0,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
    },
    nodes: [
      {
        id: 'fixture/engine.py::Value',
        kind: 'component',
        label: 'Value',
        metadata: { sourceFile: 'fixture/engine.py' },
      },
    ],
    links: [],
  } as unknown as GraphJSON;
}

function parseError(result: ToolResult): { code?: string; message?: string; hint?: string; context?: unknown } {
  const text = result.content?.[0]?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(text as string) as { code?: string; message?: string; hint?: string };
}

function assertNoAbsolutePath(serialized: string): void {
  expect(serialized).not.toContain('/Users/');
  expect(serialized).not.toContain('/home/');
}

describe('F186 T4 — agent-context-tools 错误响应脱敏', () => {
  beforeEach(() => {
    mocks.getCachedGraphData.mockReset();
    mocks.bfsTraverse.mockReset();
  });

  it('用例 1：顶层 catch 用固定文案，无 stack，不含绝对路径，保留 internal-error code', async () => {
    // graph 加载成功，但 BFS 抛含绝对路径 + stack 的错误 → 命中 runAgentContextTool 顶层 catch
    mocks.getCachedGraphData.mockReturnValue({
      graphData: makeGraph(),
      graphPath: '/Users/secret/.spectra/graph.json',
      mtimeMs: 1,
      sizeBytes: 1,
    });
    mocks.bfsTraverse.mockImplementation(() => {
      const err = new Error(`boom at ${ABSOLUTE_PATH_LEAK}`);
      err.stack = `Error: boom\n    at ${ABSOLUTE_PATH_LEAK}`;
      throw err;
    });

    const result = await handleImpact({ target: 'fixture/engine.py::Value' });
    const parsed = parseError(result);
    const serialized = result.content[0].text as string;

    expect(parsed.code).toBe('internal-error');
    expect(parsed.message).toBe('内部错误，请稍后重试');
    expect('stack' in (JSON.parse(serialized) as { context?: { stack?: unknown } })).toBe(false);
    expect(serialized).not.toContain('stack');
    assertNoAbsolutePath(serialized);
  });

  it('用例 2：缺图分支 message 为「graph 未构建」+ hint，不含 projectRoot 绝对路径', async () => {
    mocks.getCachedGraphData.mockReturnValue(null);

    const result = await handleImpact({
      target: 'fixture/engine.py::Value',
      projectRoot: '/Users/secret/worktree',
    });
    const parsed = parseError(result);
    const serialized = result.content[0].text as string;

    expect(parsed.code).toBe('graph-not-built');
    expect(parsed.message).toBe('graph 未构建');
    expect(parsed.hint).toBe('请先运行 `spectra batch` 生成图谱');
    assertNoAbsolutePath(serialized);
  });

  it('用例 3：其他加载失败（非 stale）message 为「graph 未构建」，不含绝对路径', async () => {
    mocks.getCachedGraphData.mockImplementation(() => {
      throw new Error(`load failed at /Users/secret/worktree/.spectra/graph.json`);
    });

    const result = await handleImpact({
      target: 'fixture/engine.py::Value',
      projectRoot: '/Users/secret/worktree',
    });
    const parsed = parseError(result);
    const serialized = result.content[0].text as string;

    expect(parsed.code).toBe('graph-not-built');
    expect(parsed.message).toBe('graph 未构建');
    assertNoAbsolutePath(serialized);
  });
});
