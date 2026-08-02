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
import { describeQueriedDbPaths, loadKbContext } from '../../kb-mcp/lib/kb-locator.js';
import { recordNoHit, resolveNoHitTelemetryDir } from '../../scaffold-kb/nohit-recorder.js';
import { buildCoverageGapReport, formatCoverageGapReport } from '../../scaffold-kb/coverage-gap.js';
import { resolveVersion, type VersionStatus } from '../../scaffold-kb/version-resolver.js';
import { buildKbStatusReport } from '../../scaffold-kb/kb-status.js';
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
  const queriedHandles = [ctx.vendor, ctx.project].filter((h): h is NonNullable<typeof h> => h !== null);
  const vendorHits = ctx.vendor ? searchKbCore(ctx.vendor.db, query, topK * 2, undefined, true) : null;
  const projectHits = ctx.project ? searchKbCore(ctx.project.db, query, topK * 2, undefined, true) : null;
  const vendorResults = vendorHits && vendorHits.ok ? vendorHits.results : [];
  const projectResults = projectHits && projectHits.ok ? projectHits.results : [];
  const merged = mergeResults(vendorResults, projectResults, topK);

  if (merged.length === 0 && queriedHandles.length > 0) {
    // F241 FR-012 挂点 3：真实零结果 → 记一条 no-hit 治理事件（recordNoHit 为 total 函数，默认关闭时零 I/O）。
    // 与另两个挂点共用「至少查过一个库才记」前置条件（B2-7）；dbPath 惰性求值（B2-9）。
    recordNoHit({
      tool: 'scaffold_kb_query',
      rawQuery: requirement,
      dbPath: () => describeQueriedDbPaths(queriedHandles),
    });
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

/**
 * scaffold-kb coverage-gap：读 no-hit 记录，输出达阈值的文档缺口 backlog（F241 FR-014/015）。
 *
 * 只读命令，恒 exit 0：即便采集未开启也**明确打出 status**，绝不用空 backlog 冒充"没有缺口"。
 */
function runCoverageGap(command: CLICommand): void {
  const nohitDir = resolveNoHitTelemetryDir();
  const report = buildCoverageGapReport({ nohitDir, isCollectionEnabled: nohitDir !== null });
  process.stdout.write(formatCoverageGapReport(report, command.scaffoldKbFormat === 'json' ? 'json' : 'markdown'));
}

/**
 * scaffold-kb version：给定包名 → 版本决议（F241 FR-016/FR-017）。
 *
 * 只输出决议结果，不改任何文件、不接入检索（FR-018 已判删除）。
 */
function runVersion(command: CLICommand): void {
  const packageName = command.scaffoldKbPackage;
  if (!packageName) {
    console.error(
      '用法: spectra scaffold-kb version --package <包名> [--project-root <路径>] [--sdk-version <显式版本>] [--format markdown|json]',
    );
    process.exitCode = 1;
    return;
  }
  const input: Parameters<typeof resolveVersion>[0] = {
    projectRoot: command.scaffoldKbProjectRoot ?? process.cwd(),
    packageName,
  };
  if (command.scaffoldKbSdkVersion !== undefined) input.explicitVersion = command.scaffoldKbSdkVersion;
  const result = resolveVersion(input);

  if (command.scaffoldKbFormat === 'json') {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = [
    `# 版本决议 — ${packageName}`,
    '',
    `- status: \`${result.resolved.status}\` — ${VERSION_STATUS_EXPLANATION[result.resolved.status]}`,
    `- version: ${result.resolved.version ?? '(null — 无单一可用版本)'}`,
    `- flags: ${result.flags.length > 0 ? result.flags.map((f) => `\`${f}\``).join(', ') : '(无)'}`,
    '',
  ];
  if (result.candidates.length === 0) {
    lines.push('（无候选证据）');
  } else {
    lines.push('| version | source | detail |', '|---------|--------|--------|');
    for (const c of result.candidates) {
      lines.push(`| ${c.version || '(未解析)'} | ${c.source} | ${c.detail} |`);
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

const VERSION_STATUS_EXPLANATION: Record<VersionStatus, string> = {
  explicit: '采用查询显式指定的版本（推断值同时呈现，见 candidates）',
  lockfile: '采用唯一 lockfile 推断出的具体版本',
  'range-only': '只有 package.json 声明的 range，无具体版本',
  ambiguous: '存在多个 lockfile 且无显式版本，**无法收敛**（不擅自按优先级挑一个）',
  none: '无任何版本信息 / 生态不支持',
};

/**
 * scaffold-kb status：KB 新鲜度与治理态报告（F241 FR-019/FR-020）。
 *
 * **只报告，不触发任何重建或 ingest**；库不存在也恒 exit 0（这是一个状态查询，不是健康断言）。
 */
async function runStatus(command: CLICommand): Promise<void> {
  const vendorKb = command.scaffoldKbVendorKb;
  const projectKb = command.scaffoldKbProjectKb;
  if (vendorKb !== undefined && projectKb !== undefined) {
    console.error('[scaffold-kb status] --vendor-kb 与 --project-kb 只能给其一（状态报告针对单一库）');
    process.exitCode = 1;
    return;
  }
  const kbDir = vendorKb ?? projectKb;
  if (!kbDir) {
    console.error('用法: spectra scaffold-kb status (--vendor-kb <path> | --project-kb <path>) [--format markdown|json]');
    process.exitCode = 1;
    return;
  }

  // 库不可用不是错误：如实报 dbExists 与 unknown，绝不用"库很新"糊弄过去。
  // B3-C5：「文件不存在」与「文件在但打不开」必须分开报——前者要建库、后者要修库。
  const loaded = await loadKbContext({ vendorKbPath: kbDir });
  const handle = loaded.ok ? loaded.context.vendor : null;
  const dbFileExists = handle !== null || (!loaded.ok && loaded.unloadable.includes('vendor'));
  const report = buildKbStatusReport(handle?.db ?? null, { dbExists: dbFileExists });
  const dbPath = handle?.dbPath ?? join(kbDir, 'chunks.sqlite');

  if (command.scaffoldKbFormat === 'json') {
    process.stdout.write(`${JSON.stringify({ ...report, dbPath }, null, 2)}\n`);
    return;
  }
  const lines = [
    '# KB status',
    '',
    `- dbPath: \`${dbPath}\`（dbExists: ${report.dbExists}）`,
    `- schemaCompat: \`${report.schemaCompat}\``,
    `- freshness: \`${report.freshness}\`${report.freshness === 'unknown' ? ' — 无从判级（库缺失/旧 schema/无时间戳），**不代表库是新的**' : ''}`,
    `- activityAt: ${report.activityAt ?? '(null)'} / activityAgeDays: ${report.activityAgeDays ?? '(null)'}`,
    `- oldestBuiltAt: ${report.oldestBuiltAt ?? '(null)'}（仅可见性，不参与判级）`,
    `- ingestAgeDays: ${report.ingestAgeDays ?? '(null)'}`,
    `- sourceVersions: ${report.sourceVersions.length > 0 ? report.sourceVersions.join(', ') : '(无)'}`,
    `- noHitCollection: \`${report.noHitCollection}\` / recentNoHitCount: ${report.recentNoHitCount ?? '(null — 采集未开启)'}`,
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
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

  if (op === 'coverage-gap') {
    runCoverageGap(command);
    return;
  }

  if (op === 'version') {
    runVersion(command);
    return;
  }

  if (op === 'status') {
    await runStatus(command);
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

  console.error('用法: spectra scaffold-kb <build|serve|query|ingest|coverage-gap|version|status> ...');
  process.exitCode = 1;
}

/** serve 启动点：加载双库上下文并起 KB MCP stdio server（T046） */
async function startServe(vendorKbPath: string, projectKbPath?: string): Promise<void> {
  const { startKbMcpServer } = await import('../../kb-mcp/index.js');
  const opts: { vendorKbPath: string; projectKbPath?: string } = { vendorKbPath };
  if (projectKbPath !== undefined) opts.projectKbPath = projectKbPath;
  await startKbMcpServer(opts);
}
