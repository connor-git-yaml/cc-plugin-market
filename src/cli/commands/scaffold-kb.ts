/**
 * F190 scaffold-kb 子命令入口（build | serve）
 *
 * build：文档目录 / llms.txt → kb/（doc-graph.json + chunks.sqlite）
 * serve：启动 KB MCP server（Phase B 接入，demo plugin .mcp.json 调用此路径）
 */

import type { CLICommand } from '../utils/parse-args.js';
import { buildKb } from '../../scaffold-kb/index.js';
import { extractKeywords } from '../../scaffold-kb/keyword-extract.js';
import { searchKbCore } from '../../scaffold-kb/search-core.js';
import { formatInjectionBlock, type EvidenceResult } from '../../scaffold-kb/injection-format.js';
import { loadKbContext } from '../../kb-mcp/lib/kb-locator.js';
import { mergeResults } from '../../kb-mcp/lib/result-merger.js';

const QUERY_PROBE_SENTINEL = 'scaffold-kb-query:1';

/** scaffold-kb query：一次性预查，输出注入块（markdown）或结构化结果（json）；KB 不可用 → exit 0 空 stdout */
async function runQuery(command: CLICommand): Promise<void> {
  if (command.scaffoldKbProbe) {
    process.stdout.write(`${QUERY_PROBE_SENTINEL}\n`);
    return;
  }
  const requirement = command.scaffoldKbRequirement;
  const vendorKbPath = command.scaffoldKbVendorKb;
  if (!requirement || !vendorKbPath) {
    console.error('用法: spectra scaffold-kb query --requirement "<需求>" --vendor-kb <path> [--project-kb <path>] [--top-k N] [--max-inject-chars N] [--format markdown|json] [--probe]');
    process.exitCode = 1;
    return;
  }
  const topK = command.scaffoldKbTopK ?? 3;
  const maxInjectChars = command.scaffoldKbMaxInjectChars ?? 6000;
  const format = command.scaffoldKbFormat ?? 'markdown';

  // KB 加载失败（不可用）→ 降级：exit 0 + 空 stdout（FR-005 / EC-002 统一退出契约）
  const loaded = await loadKbContext(
    command.scaffoldKbProjectKb !== undefined
      ? { vendorKbPath, projectKbPath: command.scaffoldKbProjectKb }
      : { vendorKbPath },
  );
  if (!loaded.ok) {
    console.error(`[scaffold-kb query] kb-missing: ${loaded.code}`);
    return; // exit 0, stdout 空
  }

  const query = extractKeywords(requirement);
  if (query.length === 0) {
    console.error('[scaffold-kb query] no-query: 关键词为空');
    return;
  }
  const ctx = loaded.context;
  // preTokenized=true：query 已由 extractKeywords 规范化，避免 sanitizeQuery 二次 CJK 展开（修 Codex W5）
  const vendorHits = ctx.vendor ? searchKbCore(ctx.vendor.db, query, topK * 2, undefined, true) : null;
  const projectHits = ctx.project ? searchKbCore(ctx.project.db, query, topK * 2, undefined, true) : null;
  const vendorResults = vendorHits && vendorHits.ok ? vendorHits.results : [];
  const projectResults = projectHits && projectHits.ok ? projectHits.results : [];
  const merged = mergeResults(vendorResults, projectResults, topK);

  if (merged.length === 0) {
    console.error('[scaffold-kb query] no-hit');
    return; // exit 0, stdout 空
  }

  if (format === 'json') {
    process.stdout.write(JSON.stringify({ query, results: merged }) + '\n');
    return;
  }
  // markdown：MergedResult 结构兼容 EvidenceResult
  const block = formatInjectionBlock(merged as EvidenceResult[], maxInjectChars);
  if (block.length > 0) process.stdout.write(block + '\n');
}

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
    if (command.scaffoldKbNoLlm === true) opts.noLlm = true;

    const res = await buildKb(opts);
    console.log(
      `[scaffold-kb] 构建完成：${res.docCount} 文档 / ${res.chunkCount} chunk / ` +
        `${res.entityCount} 实体（${res.extractionMethod}）→ ${res.outputPath}`,
    );
    return;
  }

  if (op === 'query') {
    await runQuery(command);
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
