/**
 * F184 T004/T005 — 工具 description 结构完整性（FR-005 server 5 工具 4 要素 / FR-007 graph 6 工具）
 *
 * 通过 mock McpServer 捕获 createMcpServer() 注册时传入的 (name, description)，
 * 断言 server 5 工具满足 F170c 4 要素、graph 6 工具补 "Use when" + chained usage。
 * 范本：file-nav 3 工具（已满格，feature-170c-description.e2e.test.ts 同款契约，长度 ∈ [100,500]）。
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  captured: [] as Array<{ name: string; description: string }>,
}));

// mock McpServer：捕获 server.tool(name, description, ...) 注册（含 graph/agent-context/file-nav 子注册）
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    constructor(..._args: unknown[]) {}
    tool(name: string, description: string): void {
      hoisted.captured.push({ name, description });
    }
  },
}));

import { createMcpServer } from '../../../src/mcp/server.js';

const SERVER_5 = ['prepare', 'generate', 'batch', 'diff', 'panoramic-query'];
const GRAPH_6 = [
  'graph_query',
  'graph_node',
  'graph_path',
  'graph_community',
  'graph_god_nodes',
  'graph_hyperedges',
];

function find(name: string): { name: string; description: string } | undefined {
  return hoisted.captured.find((t) => t.name === name);
}

beforeAll(() => {
  hoisted.captured.length = 0;
  createMcpServer();
});

describe('F184 FR-005 — server 5 工具 description 4 要素', () => {
  it.each(SERVER_5)('%s description 长度 ∈ [100, 500]', (name) => {
    const tool = find(name);
    expect(tool, `工具 ${name} 应已注册`).toBeDefined();
    const len = tool!.description.length;
    expect(len, `${name} description 长度 ${len} 需 ∈ [100,500]`).toBeGreaterThanOrEqual(100);
    expect(len, `${name} description 长度 ${len} 需 ∈ [100,500]`).toBeLessThanOrEqual(500);
  });

  it.each(SERVER_5)('%s 含 4 要素（Use this tool when ≥3 bullet / Example / Typical chained usage）', (name) => {
    const desc = find(name)!.description;
    expect(desc, `${name} 缺 "Use this tool when" 段`).toContain('Use this tool when');
    expect(desc, `${name} 缺 "Example" 段`).toContain('Example');
    expect(desc, `${name} 缺 "Typical chained usage" 段`).toContain('Typical chained usage');
    const lines = desc.split('\n');
    const start = lines.findIndex((l) => l.includes('Use this tool when'));
    const after = lines.slice(start + 1);
    const exampleAt = after.findIndex((l) => l.includes('Example'));
    const bullets = after
      .slice(0, exampleAt === -1 ? undefined : exampleAt)
      .filter((l) => l.trim().startsWith('-'));
    expect(bullets.length, `${name} Use this tool when 段需 ≥3 bullet，实际 ${bullets.length}`).toBeGreaterThanOrEqual(3);
  });
});

describe('F184 FR-007 — graph 6 工具 description 补 Use when + chained usage', () => {
  it.each(GRAPH_6)('%s description 长度 ∈ [100, 500]', (name) => {
    const tool = find(name);
    expect(tool, `工具 ${name} 应已注册`).toBeDefined();
    const len = tool!.description.length;
    expect(len, `${name} description 长度 ${len} 需 ∈ [100,500]`).toBeGreaterThanOrEqual(100);
    expect(len, `${name} description 长度 ${len} 需 ∈ [100,500]`).toBeLessThanOrEqual(500);
  });

  it.each(GRAPH_6)('%s 含 "Use when" 段 + chained usage（→ 或 ->）', (name) => {
    const desc = find(name)!.description;
    expect(desc, `${name} 缺 "Use when" 段`).toContain('Use when');
    expect(desc, `${name} 缺 chained usage（→ 或 ->）`).toMatch(/→|->/);
  });
});
