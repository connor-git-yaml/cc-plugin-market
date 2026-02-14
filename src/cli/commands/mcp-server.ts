/**
 * mcp-server 子命令
 * 启动 MCP stdio server，通过 JSON-RPC 2.0 暴露 reverse-spec 工具能力
 */

import { startMcpServer } from '../../mcp/index.js';

/**
 * 执行 mcp-server 子命令
 */
export async function runMcpServer(): Promise<void> {
  await startMcpServer();
}
