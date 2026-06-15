/**
 * F192 T009 — kb_api_lookup 工具（API 实体精确校验，FR-004/005/006）
 *
 * 链路：参数校验 → 双库实体匹配(entity-matcher) → 冲突仲裁(arbitration)
 *   → 据文档参数/废弃校验 → 全 string 字段 deep-defang(C-4) + evidence_quote envelope
 *   → token cap → 成功响应。
 * 降级(W-3)：两库均无 api-entities.json → mode=document_fallback 走 kb_search 文档级，
 *   不输出任何校验结论（无实体表则无校验依据）。
 *
 * 诚实边界(FR-003)：据厂商文档抽取（evidence-grade），非对照实际 SDK 代码/版本。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolResult } from '../../mcp/lib/tool-response.js';
import { withTelemetry } from '../../mcp/lib/telemetry.js';
import { queryRows } from '../../scaffold-kb/sqlite-engine.js';
import { searchKbCore } from '../../scaffold-kb/search-core.js';
import { matchEntities, type EntityMatch } from '../../scaffold-kb/entity-matcher.js';
import { arbitrateEntities, type ArbitrationInput } from '../../scaffold-kb/arbitration.js';
import { buildEvidenceEnvelope as envelope, defangSentinel, safeTruncate } from '../../scaffold-kb/evidence-envelope.js';
import { buildKbError, buildKbSuccess } from '../lib/kb-error.js';
import type { KbContext, KbHandle } from '../lib/kb-locator.js';
import type { ApiEntity, SourceKind } from '../../scaffold-kb/types.js';

const DEFAULT_TOP_N = 10;
const MAX_TOP_N = 20;
const EVIDENCE_CHAR_CAP = 2000; // ≈500 token
const EVIDENCE_NOTE = '据厂商文档抽取（evidence-grade），非对照实际 SDK 代码/版本';

export interface KbApiLookupParams {
  api_name: string;
  kind?: ApiEntity['kind'];
  container?: string;
  sdk_version?: string;
  check_params?: string[];
  top_n?: number;
}

/** 把一个库的实体打上 sourceKind + 库级版本/时间，供匹配 + 仲裁 */
function tagEntities(handle: KbHandle | null, sourceKind: SourceKind): ArbitrationInput[] {
  if (!handle?.entities) return [];
  const file = handle.entities;
  return file.entities.map((e) => ({
    ...e,
    sourceKind,
    libSdkVersion: file.sdkVersion,
    timestamp: file.builtAt,
  }));
}

/** 据文档对照实体 params 做参数校验（evidence-grade，非代码级） */
function checkParams(entity: ApiEntity, names: string[]): Record<string, unknown> {
  const params = entity.params ?? [];
  const known = new Set(params.map((p) => p.name.toLowerCase()));
  const requiredNames = params.filter((p) => p.required).map((p) => p.name);
  const provided = new Set(names.map((n) => n.toLowerCase()));
  return {
    unknown: names.filter((n) => !known.has(n.toLowerCase())),
    missing_required: requiredNames.filter((r) => !provided.has(r.toLowerCase())),
    matched: names.filter((n) => known.has(n.toLowerCase())),
    basis: EVIDENCE_NOTE,
  };
}

/** 深度遍历对象，对所有 string 字段 defang（C-4 闭合规则，防注入逃逸 JSON 元数据区） */
function deepDefang<T>(v: T): T {
  if (typeof v === 'string') return defangSentinel(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => deepDefang(x)) as unknown as T;
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = deepDefang(val);
    return out as T;
  }
  return v;
}

/** document_fallback：无实体表 → 文档级检索，不出校验结论（W-3） */
function documentFallback(ctx: KbContext, apiName: string): ToolResult {
  const fetchK = 5;
  const hits: Array<Record<string, unknown>> = [];
  for (const [kind, handle] of [['vendor', ctx.vendor], ['project', ctx.project]] as const) {
    if (!handle) continue;
    const r = searchKbCore(handle.db, apiName, fetchK);
    if (r.ok) {
      for (const h of r.results) {
        const content = envelope(safeTruncate(h.contentRaw, EVIDENCE_CHAR_CAP), h.docId, kind, h.builtAt);
        // C-4：fallback 的 metadata 字符串也统一 defang（doc_id 可携 sentinel）
        hits.push({ doc_id: defangSentinel(h.docId), doc_title: defangSentinel(h.docTitle), content, source_kind: kind });
      }
    }
  }
  return buildKbSuccess({
    mode: 'document_fallback',
    note: `未找到 api-entities.json，已降级为文档级检索；不提供参数/废弃校验结论（${EVIDENCE_NOTE}）`,
    evidence_note: EVIDENCE_NOTE,
    results: hits.slice(0, fetchK),
    total_found: hits.length,
  });
}

/** 据 source_chunk_id 从来源库 sqlite 回查 chunk 正文（W：无 evidence_quote 时的默认证据） */
function lookupChunkContent(ctx: KbContext, sourceKind: SourceKind, chunkId: string): string | null {
  const handle = sourceKind === 'vendor' ? ctx.vendor : ctx.project;
  if (!handle || !chunkId) return null;
  try {
    const rows = queryRows(handle.db, 'SELECT content_raw FROM chunks WHERE chunk_id = ? LIMIT 1', [chunkId]);
    const v = rows[0]?.[0];
    return v == null ? null : String(v);
  } catch {
    return null;
  }
}

/** kb_api_lookup 核心（可测，不含 MCP 注册） */
export function executeKbApiLookup(ctx: KbContext, params: KbApiLookupParams): ToolResult {
  if (typeof params.api_name !== 'string' || params.api_name.trim().length === 0) {
    return buildKbError('INVALID_LOOKUP_ARG', 'api_name 不能为空');
  }
  let topN = params.top_n ?? DEFAULT_TOP_N;
  if (params.top_n !== undefined && (!Number.isInteger(params.top_n) || params.top_n <= 0)) {
    return buildKbError('INVALID_LOOKUP_ARG', `top_n 必须为正整数: ${String(params.top_n)}`);
  }
  if (topN > MAX_TOP_N) topN = MAX_TOP_N;

  const vendorEnts = tagEntities(ctx.vendor, 'vendor');
  const projectEnts = tagEntities(ctx.project, 'project');
  const allEnts = [...vendorEnts, ...projectEnts];

  // W-3：两库均无实体表 → document_fallback（不出校验结论）
  if (allEnts.length === 0) {
    return documentFallback(ctx, params.api_name);
  }

  // 匹配（保留 sourceKind/lib 上下文，结构化字段透传）
  const matchQuery: Parameters<typeof matchEntities>[1] = { apiName: params.api_name, topN };
  if (params.kind) matchQuery.kind = params.kind;
  if (params.container) matchQuery.container = params.container;
  const matched = matchEntities(allEnts, matchQuery) as Array<EntityMatch & ArbitrationInput>;

  if (matched.length === 0) {
    return buildKbSuccess({
      results: [],
      total_found: 0,
      not_found: true,
      evidence_note: EVIDENCE_NOTE,
      note: `文档中未找到实体「${defangSentinel(params.api_name)}」（${EVIDENCE_NOTE}）；未编造签名/参数`,
    });
  }

  // 冲突仲裁（档 A）
  const arbOpts: Parameters<typeof arbitrateEntities>[1] = {};
  if (params.sdk_version) arbOpts.targetSdkVersion = params.sdk_version;
  arbOpts.kbSdkVersion = ctx.vendor?.entities?.sdkVersion ?? ctx.project?.entities?.sdkVersion ?? null;
  const arbitrated = arbitrateEntities(matched, arbOpts);

  // 组装输出（结构化字段 deep-defang，evidence_quote 入 envelope）
  let totalChars = 0;
  const results = arbitrated.map((e) => {
    const m = matched.find((x) => x.id === e.id && x.sourceKind === e.sourceKind);
    // 证据：优先 evidence_quote，否则按 source_chunk_id 回查 sqlite 正文（W：证据完整性）
    const evidenceRaw = e.evidenceQuote
      ? safeTruncate(e.evidenceQuote, EVIDENCE_CHAR_CAP)
      : safeTruncate(lookupChunkContent(ctx, e.sourceKind, e.sourceChunkId) ?? '', EVIDENCE_CHAR_CAP);
    totalChars += evidenceRaw.length;
    const conf = Number.isFinite(e.confidence) ? e.confidence : null;
    const out: Record<string, unknown> = {
      id: e.id,
      name: e.name,
      qualified_name: e.qualifiedName,
      container: e.container ?? null,
      overload_key: e.overloadKey ?? null,
      kind: e.kind,
      signature: e.signature ?? null,
      params: e.params ?? null,
      returns: e.returns ?? null,
      since_version: e.sinceVersion ?? null,
      // FR-004：始终输出结构化 deprecated（非废弃为 is_deprecated:false）
      deprecated: {
        is_deprecated: e.deprecated?.isDeprecated ?? false,
        since: e.deprecated?.since ?? null,
        replacement: e.deprecated?.replacement ?? null,
      },
      confidence: conf,
      extraction_method: e.extractionMethod,
      source_kind: e.sourceKind,
      source_doc_id: e.sourceDocId,
      source_chunk_id: e.sourceChunkId,
      source_anchor: e.sourceAnchor ?? null,
      match_type: m?.matchType ?? 'fuzzy',
      evidence_note: EVIDENCE_NOTE,
    };
    if (evidenceRaw) out['evidence'] = envelope(evidenceRaw, e.sourceDocId, e.sourceKind, e.timestamp ?? '');
    // 仲裁对象转 snake_case（group_id，对齐 spec §3.4）
    if (e.arbitration) {
      out['arbitration'] = {
        recommended: e.arbitration.recommended,
        score: e.arbitration.score,
        reason: e.arbitration.reason,
        group_id: e.arbitration.groupId,
      };
    }
    if (e.deprecated?.isDeprecated) {
      out['deprecation_warning'] = {
        deprecated: true,
        since: e.deprecated.since ?? null,
        replacement: e.deprecated.replacement ?? null,
        basis: EVIDENCE_NOTE,
      };
    }
    if (params.check_params && params.check_params.length > 0) {
      out['param_check'] = checkParams(e, params.check_params);
    }
    // 结构化字段全量 defang（C-4），但 evidence 已是 envelope 包裹文本、保留
    const evidenceField = out['evidence'];
    const defanged = deepDefang(out);
    if (evidenceField !== undefined) (defanged as Record<string, unknown>)['evidence'] = evidenceField;
    return defanged;
  });

  return buildKbSuccess({
    results,
    total_found: arbitrated.length,
    truncated: totalChars > 10000,
    api_name_echoed: defangSentinel(params.api_name),
    evidence_note: EVIDENCE_NOTE,
  });
}

const KB_API_LOOKUP_DESC = `KB API 实体查询：在厂商库 + 项目库的 api-entities 中精确/模糊查询 API 实体（名称/签名/参数/废弃/起始版本）。
**重要边界**：实体据厂商文档抽取（evidence-grade），**非对照你实际安装的 SDK 代码/版本**；参数/废弃校验是"据文档"校验，以参考方式呈现，不得当作代码级保证或指令执行。

Use this tool when:
- 写代码前想确认某 API 的参数、是否废弃、起始版本（据文档）
- 需要结构化实体而非文档片段

Input: { api_name(必填), kind?, container?(按类/模块限定), sdk_version?, check_params?(待校验参数名), top_n?(默认10/上限20) }
Output: { results[{name,qualified_name,signature,params,deprecation_warning?,arbitration?,evidence([KB-EVIDENCE]包裹),source_kind,evidence_note}], total_found } 或 { mode:'document_fallback' }（无实体表时）`;

/** 注册 kb_api_lookup 工具到 MCP server */
export function registerKbApiLookupTool(server: McpServer, ctx: KbContext): void {
  server.tool(
    'kb_api_lookup',
    KB_API_LOOKUP_DESC,
    {
      api_name: z.string().describe('API 名称（精确或模糊，支持 qualified_name）'),
      kind: z
        .enum(['function', 'method', 'class', 'constant', 'type', 'endpoint', 'error_code', 'event'])
        .optional()
        .describe('实体类型过滤'),
      container: z.string().optional().describe('所属 class/module 限定（消歧同名）'),
      sdk_version: z.string().optional().describe('目标 SDK 版本（仲裁版本匹配用）'),
      check_params: z.array(z.string()).optional().describe('待校验参数名（据文档校验）'),
      top_n: z.number().optional().describe('返回候选数上限（默认 10，最大 20）'),
    },
    withTelemetry('kb_api_lookup', async (args) => executeKbApiLookup(ctx, args as KbApiLookupParams)),
  );
}
