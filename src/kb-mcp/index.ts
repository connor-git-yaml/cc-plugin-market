/**
 * F190 KB MCP Server stdio 入口（scaffold-kb serve 的实际启动点）
 *
 * loadKbContext（一次性加载 + 缓存双库 → warm 复用）→ createKbMcpServer → stdio 连接。
 * 库定位失败（两库皆缺）→ 写 stderr 并退出非零（不挂起）。
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createKbMcpServer } from './server.js';
import { loadKbContext } from './lib/kb-locator.js';

export interface StartKbMcpOptions {
  /** 厂商库 kb/ 目录（demo plugin 经 ${CLAUDE_PLUGIN_ROOT}/kb 注入） */
  vendorKbPath: string;
  /** 项目库 kb/ 目录（缺省 process.cwd()/.spectra/kb） */
  projectKbPath?: string;
}

export async function startKbMcpServer(opts: StartKbMcpOptions): Promise<void> {
  const projectKbPath = opts.projectKbPath ?? `${process.cwd()}/.spectra/kb`;
  const loaded = await loadKbContext({ vendorKbPath: opts.vendorKbPath, projectKbPath });

  if (!loaded.ok) {
    console.error(`[spectra-kb] 启动失败：${loaded.code}（厂商库 ${opts.vendorKbPath} / 项目库 ${projectKbPath} 均不可用）`);
    process.exitCode = 1;
    return;
  }

  const server = createKbMcpServer(loaded.context);
  const transport = new StdioServerTransport();
  console.error(
    `[spectra-kb] 启动 stdio server（可用库: ${loaded.context.sourcesAvailable.join(', ')}）...`,
  );
  await server.connect(transport);
  console.error('[spectra-kb] server 已连接，等待请求...');
}
