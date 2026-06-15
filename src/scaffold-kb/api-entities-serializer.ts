/**
 * F192 — api-entities.json 序列化（内存 ApiEntityFile → on-disk snake_case，§3.2）
 * build（厂商）+ ingest（项目）共用，保证两库 schema 一致。
 */

import type { ApiEntity, ApiEntityFile } from './types.js';
import { clampConfidence } from './entity-util.js';

const VALID_KINDS = new Set<ApiEntity['kind']>([
  'function', 'method', 'class', 'constant', 'type', 'endpoint', 'error_code', 'event',
]);

function serializeEntity(e: ApiEntity): Record<string, unknown> {
  return {
    id: e.id,
    name: e.name,
    qualified_name: e.qualifiedName,
    container: e.container ?? null,
    overload_key: e.overloadKey ?? null,
    kind: e.kind,
    signature: e.signature ?? null,
    params: e.params ?? null,
    returns: e.returns ?? null,
    deprecated: e.deprecated
      ? {
          is_deprecated: e.deprecated.isDeprecated,
          since: e.deprecated.since ?? null,
          replacement: e.deprecated.replacement ?? null,
        }
      : null,
    since_version: e.sinceVersion ?? null,
    source_doc_id: e.sourceDocId,
    source_chunk_id: e.sourceChunkId,
    source_chunk_ids: e.sourceChunkIds ?? null,
    source_anchor: e.sourceAnchor ?? null,
    evidence_quote: e.evidenceQuote ?? null,
    lang: e.lang,
    confidence: e.confidence,
    extraction_method: e.extractionMethod,
  };
}

/** 序列化 ApiEntityFile 为 on-disk JSON 对象（snake_case，含 schema_version） */
export function serializeApiEntities(file: ApiEntityFile): Record<string, unknown> {
  return {
    schema_version: file.schemaVersion,
    built_at: file.builtAt,
    sdk_version: file.sdkVersion,
    source_kind: file.sourceKind,
    entities: file.entities.map(serializeEntity),
    coverage: file.coverage
      ? { total_sections: file.coverage.totalSections, extracted_sections: file.coverage.extractedSections }
      : null,
  };
}

function deserializeEntity(raw: unknown): ApiEntity | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof o[k] === 'string' ? (o[k] as string) : undefined);
  const name = str('name');
  const id = str('id');
  if (!name || !id) return null;
  const kindRaw = String(o['kind'] ?? 'function');
  const kind = (VALID_KINDS.has(kindRaw as ApiEntity['kind']) ? kindRaw : 'function') as ApiEntity['kind'];
  const e: ApiEntity = {
    id,
    name,
    qualifiedName: str('qualified_name') ?? name,
    kind,
    sourceDocId: str('source_doc_id') ?? '',
    sourceChunkId: str('source_chunk_id') ?? '',
    lang: str('lang') ?? 'en',
    // 缺失/非数值 confidence → NaN（仲裁中性化，不贬为 0 即输；C-3 修正）
    confidence:
      typeof o['confidence'] === 'number' && Number.isFinite(o['confidence'])
        ? clampConfidence(o['confidence'], 0)
        : NaN,
    extractionMethod: o['extraction_method'] === 'llm' ? 'llm' : 'heuristic',
  };
  if (str('container')) e.container = str('container');
  if (str('overload_key')) e.overloadKey = str('overload_key');
  if (str('signature')) e.signature = str('signature');
  if (str('returns')) e.returns = str('returns');
  if (str('since_version')) e.sinceVersion = str('since_version');
  if (str('source_anchor')) e.sourceAnchor = str('source_anchor');
  if (str('evidence_quote')) e.evidenceQuote = str('evidence_quote');
  if (Array.isArray(o['source_chunk_ids'])) e.sourceChunkIds = (o['source_chunk_ids'] as unknown[]).map(String);
  if (Array.isArray(o['params'])) {
    e.params = (o['params'] as unknown[])
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .map((p) => {
        const param: NonNullable<ApiEntity['params']>[number] = { name: String(p['name'] ?? '') };
        if (typeof p['type'] === 'string') param.type = p['type'];
        if (typeof p['required'] === 'boolean') param.required = p['required'];
        if (typeof p['doc'] === 'string') param.doc = p['doc'];
        return param;
      })
      .filter((p) => p.name.length > 0);
  }
  const dep = o['deprecated'];
  if (typeof dep === 'object' && dep !== null) {
    const d = dep as Record<string, unknown>;
    if (d['is_deprecated'] === true) {
      e.deprecated = { isDeprecated: true };
      if (typeof d['since'] === 'string') e.deprecated.since = d['since'];
      if (typeof d['replacement'] === 'string') e.deprecated.replacement = d['replacement'];
    }
  }
  return e;
}

/** 实体数上限（防恶意超大 api-entities.json 在 MCP 启动期 OOM/CPU DoS） */
export const MAX_ENTITIES = 50_000;

/** 反序列化 on-disk api-entities.json（snake_case）→ ApiEntityFile；顶层非法返回 null */
export function deserializeApiEntities(raw: unknown): ApiEntityFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o['entities'])) return null;
  // DoS 防护：超量实体直接拒绝（降级 null → kb_api_lookup document_fallback）
  if ((o['entities'] as unknown[]).length > MAX_ENTITIES) return null;
  const entities = (o['entities'] as unknown[])
    .map(deserializeEntity)
    .filter((e): e is ApiEntity => e !== null);
  const sourceKind = o['source_kind'] === 'project' ? 'project' : 'vendor';
  return {
    schemaVersion: '1.0',
    builtAt: typeof o['built_at'] === 'string' ? o['built_at'] : '',
    sdkVersion: typeof o['sdk_version'] === 'string' ? o['sdk_version'] : null,
    sourceKind,
    entities,
  };
}
