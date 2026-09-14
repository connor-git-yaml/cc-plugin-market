/**
 * M11 卡 A（P1-I）— tools/list 顺序确定性回归。
 *
 * MCP SDK 的 tools/list 按注册顺序返回；此前没有任何测试钉住这个顺序
 * （feature-180 e2e 只断言排序后的集合）。本测试把 createMcpServer 的注册顺序
 * 与 contracts/mcp-return-surface-contract.yaml 的 determinism.toolsListOrder 逐位对拍。
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseYamlDocument } from '../../../plugins/spec-driver/scripts/lib/simple-yaml.mjs';

const hoisted = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    constructor(..._args: unknown[]) {}
    tool(name: string): void {
      hoisted.names.push(name);
    }
  },
}));

import { createMcpServer } from '../../../src/mcp/server.js';

describe('tools/list 注册顺序', () => {
  it('createMcpServer 注册顺序 == 合同 toolsListOrder（逐位）', () => {
    hoisted.names.length = 0;
    createMcpServer();
    const contract = parseYamlDocument(readFileSync(resolve('contracts/mcp-return-surface-contract.yaml'), 'utf-8')) as {
      determinism: { toolsListOrder: string[] };
    };
    expect(hoisted.names).toEqual(contract.determinism.toolsListOrder);
  });

  it('两次构建 server 的注册顺序逐位相同', () => {
    hoisted.names.length = 0;
    createMcpServer();
    const first = [...hoisted.names];
    hoisted.names.length = 0;
    createMcpServer();
    expect(hoisted.names).toEqual(first);
  });
});
