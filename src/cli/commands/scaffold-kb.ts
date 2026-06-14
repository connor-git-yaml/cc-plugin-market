/**
 * F190 scaffold-kb 子命令入口（build | serve）
 *
 * build：文档目录 / llms.txt → kb/（doc-graph.json + chunks.sqlite）
 * serve：启动 KB MCP server（Phase B 接入，demo plugin .mcp.json 调用此路径）
 */

import type { CLICommand } from '../utils/parse-args.js';
import { buildKb } from '../../scaffold-kb/index.js';

export async function runScaffoldKb(command: CLICommand): Promise<void> {
  const op = command.scaffoldKbOperation;

  if (op === 'build') {
    const llmsTxtUrl = command.scaffoldKbLlmsTxt;
    const dirPath = command.scaffoldKbDir;
    if (!llmsTxtUrl && !dirPath) {
      console.error(
        '用法: spectra scaffold-kb build (--dir <路径> | --llms-txt <URL>) [--output <kb/>] [--sdk-version <版本>]',
      );
      process.exitCode = 1;
      return;
    }
    const opts: Parameters<typeof buildKb>[0] = {};
    if (llmsTxtUrl !== undefined) opts.llmsTxtUrl = llmsTxtUrl;
    if (dirPath !== undefined) opts.dirPath = dirPath;
    if (command.scaffoldKbOutput !== undefined) opts.outputPath = command.scaffoldKbOutput;
    if (command.scaffoldKbSdkVersion !== undefined) opts.sdkVersion = command.scaffoldKbSdkVersion;
    if (command.scaffoldKbLang !== undefined) opts.lang = command.scaffoldKbLang;

    const res = await buildKb(opts);
    console.log(
      `[scaffold-kb] 构建完成：${res.docCount} 文档 / ${res.chunkCount} chunk → ${res.outputPath}`,
    );
    return;
  }

  if (op === 'serve') {
    // Phase B：启动 KB MCP server。serve 实现随 KB MCP 层（src/kb-mcp/）接入（T046）。
    const vendorKbPath = command.scaffoldKbVendorKb;
    if (!vendorKbPath) {
      console.error('用法: spectra scaffold-kb serve --vendor-kb <path> [--project-kb <path>]');
      process.exitCode = 1;
      return;
    }
    await startServe(vendorKbPath, command.scaffoldKbProjectKb);
    return;
  }

  console.error('用法: spectra scaffold-kb <build|serve> ...');
  process.exitCode = 1;
}

/** serve 启动点：加载双库上下文并起 KB MCP stdio server（T046） */
async function startServe(vendorKbPath: string, projectKbPath?: string): Promise<void> {
  const { startKbMcpServer } = await import('../../kb-mcp/index.js');
  const opts: { vendorKbPath: string; projectKbPath?: string } = { vendorKbPath };
  if (projectKbPath !== undefined) opts.projectKbPath = projectKbPath;
  await startKbMcpServer(opts);
}
