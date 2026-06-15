/**
 * F192 — chunk_meta schema 向后兼容（C-1 / R-COMPAT-1）
 *
 * F190 已分发的 sqlite（厂商/demo 旧库）无 provenance 三列（ingest_source_type/
 * ingest_origin/ingested_at）。对其显式 SELECT 这些列会 `no such column` 抛错。
 *
 * 本模块用 `PRAGMA table_info(chunk_meta)` 探测列是否存在，生成"始终产出 3 列"的
 * SELECT 片段（旧库用 `NULL AS`）—— 使行索引布局对新旧库稳定，所有读取路径
 * （search-core / kb_search / kb_doc_lookup / kb_api_lookup 的 provenance 投影）
 * 一律走本片段，禁止任何处手写新列名（plan §6）。
 */

import type { SqliteDb } from './sqlite-engine.js';
import { queryRows } from './sqlite-engine.js';

/** provenance 列名（F192 §3.3）；与 sqlite-writer CREATE_META 保持一致 */
export const PROVENANCE_COLUMNS = ['ingest_source_type', 'ingest_origin', 'ingested_at'] as const;

/** 探测 chunk_meta 是否含全部 provenance 列（F190 旧库返回 false） */
export function hasProvenanceColumns(db: SqliteDb): boolean {
  // PRAGMA table_info 返回行：cid, name, type, notnull, dflt_value, pk
  const rows = queryRows(db, 'PRAGMA table_info(chunk_meta)', []);
  const cols = new Set(rows.map((r) => String(r[1] ?? '')));
  return PROVENANCE_COLUMNS.every((c) => cols.has(c));
}

/**
 * 生成 provenance 的 SELECT 片段（含前导逗号，拼接在已有列之后）。
 * 始终产出 3 列：新库选真实列，旧库用 `NULL AS`，保证调用方行索引布局不变。
 */
export function provenanceSelectFragment(db: SqliteDb): string {
  if (hasProvenanceColumns(db)) {
    return ', chunk_meta.ingest_source_type, chunk_meta.ingest_origin, chunk_meta.ingested_at';
  }
  return ', NULL AS ingest_source_type, NULL AS ingest_origin, NULL AS ingested_at';
}
