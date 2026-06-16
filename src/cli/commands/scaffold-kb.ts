/**
 * F190 scaffold-kb 子命令入口（build | serve）
 *
 * build：文档目录 / llms.txt → kb/（doc-graph.json + chunks.sqlite）
 * serve：启动 KB MCP server（Phase B 接入，demo plugin .mcp.json 调用此路径）
 */

import { join } from 'node:path';
import type { CLICommand } from '../utils/parse-args.js';
import { buildKb } from '../../scaffold-kb/index.js';
import { extractKeywords } from '../../scaffold-kb/keyword-extract.js';
import { searchKbCore } from '../../scaffold-kb/search-core.js';
import { formatInjectionBlock, type EvidenceResult } from '../../scaffold-kb/injection-format.js';
import { loadKbContext } from '../../kb-mcp/lib/kb-locator.js';
import { mergeResults } from '../../kb-mcp/lib/result-merger.js';
import { prepareIngest, commitIngest, IngestError, type IngestSource } from '../../scaffold-kb/ingest/ingest-core.js';

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

/** scaffold-kb ingest：三方源（url/file/minutes）→ 预览 → --yes 落项目库（FR-009/013） */
async function runIngest(command: CLICommand): Promise<void> {
  const sources: IngestSource[] = [];
  if (command.scaffoldKbUrl) sources.push({ kind: 'url', value: command.scaffoldKbUrl });
  if (command.scaffoldKbFile) sources.push({ kind: 'file', value: command.scaffoldKbFile });
  if (command.scaffoldKbMinutes) sources.push({ kind: 'minutes', value: command.scaffoldKbMinutes });
  if (sources.length === 0) {
    console.error(
      '用法: spectra scaffold-kb ingest (--url <url> | --file <path> | --minutes <path>) ' +
        '[--project-kb <path>] [--yes | --dry-run] [--no-llm]',
    );
    process.exitCode = 1;
    return;
  }
  const projectKb = command.scaffoldKbProjectKb ?? join(process.cwd(), '.spectra', 'kb');
  const opts: Parameters<typeof prepareIngest>[2] = {};
  if (command.scaffoldKbNoLlm === true) opts.noLlm = true;

  let plan;
  try {
    plan = await prepareIngest(sources, projectKb, opts);
  } catch (e) {
    // 既有项目库读取失败等 fail-closed → 拒绝导入（C-2）
    console.error(`[scaffold-kb ingest] 失败：${e instanceof IngestError ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }
  console.log('[scaffold-kb ingest] 预览:');
  for (const s of plan.sources) {
    console.log(`  ${s.ok ? '✓' : '✗'} ${s.origin}${s.ok ? ` (${s.type})` : ` — ${s.reason ?? ''}`}`);
  }
  console.log(
    `  新增 ${plan.newDocs} 文档 / ${plan.newChunks} chunk / ${plan.newEntities} 实体` +
      `（合并后共 ${plan.totalChunks} chunk / ${plan.totalEntities} 实体）`,
  );
  const okCount = plan.sources.filter((s) => s.ok).length;
  // 全部源失败 → 拒绝落库 + exit 1（W-4）
  if (okCount === 0) {
    console.error('  所有源均失败，未落库');
    process.exitCode = 1;
    return;
  }
  if (command.scaffoldKbDryRun === true) {
    console.log('  --dry-run：仅预览，不落库');
    return;
  }
  if (command.scaffoldKbYes !== true) {
    console.log('  预览模式：加 --yes 落库，或 --dry-run 仅预览');
    return;
  }
  commitIngest(projectKb, plan);
  console.log(`  ✓ 已落库 → ${projectKb}`);
  // 部分源失败 → exit 2（信号，已落成功的部分，W-4）
  if (okCount < plan.sources.length) process.exitCode = 2;
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

  if (op === 'ingest') {
    await runIngest(command);
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
