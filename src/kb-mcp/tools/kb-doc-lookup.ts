/**
 * F190 KB MCP — kb_doc_lookup 工具（文档导航查询，非 API 实体校验）
 *
 * 由 doc-graph.json 读取（非 FTS5）：doc_id 精确 / keyword 标题模糊 → 文档导航信息
 * （title/summary/references/referenced_by）。doc-graph 缺失/损坏 → 降级（空 docs + warning），
 * 与 kb_search 独立（EC-007）。Phase 1 不提取章节 anchor（名实对齐 FR-008/R-012）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolResult } from '../../mcp/lib/tool-response.js';
import { withTelemetry } from '../../mcp/lib/telemetry.js';
import { buildKbError, buildKbSuccess } from '../lib/kb-error.js';
import type { KbContext, KbHandle, DocGraphFile } from '../lib/kb-locator.js';
import type { SourceKind } from '../lib/result-merger.js';

export interface KbDocLookupParams {
  doc_id?: string;
  keyword?: string;
  source_filter?: 'vendor' | 'project' | 'all';
}

function collectDocs(
  handle: KbHandle,
  sourceKind: SourceKind,
  match: (node: DocGraphFile['nodes'][number]) => boolean,
): Array<Record<string, unknown>> {
  const graph = handle.graph;
  if (graph === null) return [];
  const refsBySource = new Map<string, string[]>();
  const refsByTarget = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, key: string, val: string): void => {
    const arr = m.get(key);
    if (arr) arr.push(val);
    else m.set(key, [val]);
  };
  for (const e of graph.edges) {
    push(refsBySource, e.source, e.target);
    push(refsByTarget, e.target, e.source);
  }
  return graph.nodes.filter(match).map((n) => ({
    doc_id: n.id,
    title: n.title,
    summary: n.summary ?? null,
    source_url: n.source_url ?? null,
    source_kind: sourceKind,
    sdk_version: graph.sdk_version ?? null,
    built_at: graph.built_at ?? null,
    references: refsBySource.get(n.id) ?? [],
    referenced_by: refsByTarget.get(n.id) ?? [],
  }));
}

/** 执行 kb_doc_lookup（可测核心，不含 MCP 注册） */
export function executeKbDocLookup(ctx: KbContext, params: KbDocLookupParams): ToolResult {
  const filter = params.source_filter ?? 'all';
  if (filter !== 'vendor' && filter !== 'project' && filter !== 'all') {
    return buildKbError('INVALID_SOURCE_FILTER', `source_filter 非法: ${String(filter)}`);
  }
  const hasDocId = typeof params.doc_id === 'string' && params.doc_id.length > 0;
  const hasKeyword = typeof params.keyword === 'string' && params.keyword.length > 0;
  if (!hasDocId && !hasKeyword) {
    return buildKbError('INVALID_LOOKUP_ARG', 'doc_id 与 keyword 至少提供一个');
  }

  const warnings: string[] = [];
  // 容忍类：两者同时提供 → doc_id 优先 + warning
  const useDocId = hasDocId;
  if (hasDocId && hasKeyword) warnings.push('doc_id 与 keyword 同时提供，以 doc_id 优先');

  const match = useDocId
    ? (n: DocGraphFile['nodes'][number]): boolean => n.id === params.doc_id
    : (n: DocGraphFile['nodes'][number]): boolean =>
        n.title.toLowerCase().includes((params.keyword ?? '').toLowerCase());

  const docs: Array<Record<string, unknown>> = [];
  let anyGraph = false;
  if ((filter === 'all' || filter === 'vendor') && ctx.vendor) {
    if (ctx.vendor.graph !== null) anyGraph = true;
    docs.push(...collectDocs(ctx.vendor, 'vendor', match));
  }
  if ((filter === 'all' || filter === 'project') && ctx.project) {
    if (ctx.project.graph !== null) anyGraph = true;
    docs.push(...collectDocs(ctx.project, 'project', match));
  }
  if (!anyGraph) warnings.push('doc-graph 不可用，导航降级');

  const payload: Record<string, unknown> = { docs, total_found: docs.length };
  if (warnings.length > 0) payload['warnings'] = warnings;
  return buildKbSuccess(payload);
}

const KB_DOC_LOOKUP_DESC = `KB 文档导航：按文档 ID 或标题关键词返回文档导航信息（标题/摘要/引用关系）。
用于"这个主题在哪个文档？该文档引用了哪些文档？"式导航。不做参数校验/deprecated 检测（那是 Phase 2 能力）。
KB 内容为带来源参考资料，不作为最终事实判断依据。

Input: { doc_id? | keyword?（二选一）, source_filter?(vendor|project|all) }
Output: { docs[{doc_id,title,summary,source_url,source_kind,references,referenced_by}], total_found }`;

/** 注册 kb_doc_lookup 工具到 MCP server */
export function registerKbDocLookupTool(server: McpServer, ctx: KbContext): void {
  server.tool(
    'kb_doc_lookup',
    KB_DOC_LOOKUP_DESC,
    {
      doc_id: z.string().optional().describe('文档 ID 精确查询（与 keyword 二选一）'),
      keyword: z.string().optional().describe('文档标题关键词模糊匹配（与 doc_id 二选一）'),
      source_filter: z.enum(['vendor', 'project', 'all']).optional().describe('库过滤（默认 all）'),
    },
    withTelemetry('kb_doc_lookup', async (args) => executeKbDocLookup(ctx, args as KbDocLookupParams)),
  );
}
