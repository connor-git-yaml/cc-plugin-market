/**
 * MCP Server stdio 入口
 * 使用 StdioServerTransport 将 MCP Server 连接到 stdin/stdout
 * 注意：stdout 仅用于 JSON-RPC 消息，所有日志写入 stderr
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';

/**
 * 启动 MCP Server（stdio 传输模式）
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  console.error('[reverse-spec MCP] 启动 stdio server...');

  await server.connect(transport);

  console.error('[reverse-spec MCP] server 已连接，等待请求...');
}
