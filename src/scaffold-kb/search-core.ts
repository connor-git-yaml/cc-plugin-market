/**
 * F190 scaffold-kb — 单库查询核 searchKbCore（Phase A，recall 验收依赖此，非 kb_search）
 *
 * 修 Codex C-2（Phase A/B 边界）：recall 门禁在 Phase A，故查询核也在 Phase A。
 * kb_search（Phase B）= 包装本核 + 双库 result-merger + envelope + telemetry + MCP 注册。
 *
 * 流程：sanitizeQuery → FTS5 MATCH（bm25 排序，越负越相关）→ chunk_meta 联表
 *      → 短 CJK 查询 LIKE 兜底（EC-001）。返回带原始 bm25 score 的结果（供上层归一）。
 */

import type { SqliteDb } from './sqlite-engine.js';
import { queryRows } from './sqlite-engine.js';
import { sanitizeQuery } from './query-sanitizer.js';

export interface CoreResult {
  chunkId: string;
  docId: string;
  contentRaw: string;
  docTitle: string;
  anchor: string | null;
  sourceUrl: string | null;
  sdkVersion: string | null;
  builtAt: string;
  /** 原始 bm25 分（越负越相关）；LIKE 兜底命中记为 1.0（最不相关） */
  score: number;
  via: 'fts' | 'like';
}

export interface SearchCoreError {
  ok: false;
  code: 'INVALID_QUERY';
}

export interface SearchCoreOk {
  ok: true;
  results: CoreResult[];
}

const HAN = /\p{Script=Han}/gu;
const LIKE_FALLBACK_FLOOR = 3;
const SELECT_COLS = `chunks.chunk_id, chunks.doc_id, chunks.content_raw,
  chunk_meta.doc_title, chunk_meta.anchor, chunk_meta.source_url,
  chunk_meta.sdk_version, chunk_meta.built_at`;

/** 转义 LIKE 通配符 `%` `_` `\`，配合 `ESCAPE '\'`（修 Codex WARNING：召回污染） */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

function rowToResult(row: unknown[], score: number, via: 'fts' | 'like'): CoreResult {
  const str = (v: unknown): string => (v == null ? '' : String(v));
  const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
  return {
    chunkId: str(row[0]),
    docId: str(row[1]),
    contentRaw: str(row[2]),
    docTitle: str(row[3]),
    anchor: strOrNull(row[4]),
    sourceUrl: strOrNull(row[5]),
    sdkVersion: strOrNull(row[6]),
    builtAt: str(row[7]),
    score,
    via,
  };
}

/** 统计查询中的 CJK 字符数（决定是否触发短词 LIKE 兜底） */
function countHan(query: string): number {
  const m = query.match(HAN);
  return m ? m.length : 0;
}

/**
 * 单库检索核。
 * @returns ok+results（按相关度排序，FTS 优先、LIKE 兜底在后）或 INVALID_QUERY 错误
 */
export function searchKbCore(
  db: SqliteDb,
  query: string,
  topK: number,
  sdkVersion?: string,
  preTokenized = false,
): SearchCoreOk | SearchCoreError {
  const sanitized = sanitizeQuery(query, 'OR', preTokenized);
  if (!sanitized.ok) {
    return { ok: false, code: 'INVALID_QUERY' };
  }

  // 可选 sdk_version 过滤（FR-007，修 Codex WARNING：原 sdk_version 暴露但未用）
  const versionClause = sdkVersion !== undefined ? ' AND chunk_meta.sdk_version = ?' : '';

  const ftsSql = `SELECT ${SELECT_COLS}, bm25(chunks) AS score
FROM chunks JOIN chunk_meta ON chunk_meta.chunk_id = chunks.chunk_id
WHERE chunks MATCH ?${versionClause}
ORDER BY bm25(chunks)
LIMIT ?`;
  const ftsBind: unknown[] =
    sdkVersion !== undefined ? [sanitized.match, sdkVersion, topK] : [sanitized.match, topK];
  const ftsRows = queryRows(db, ftsSql, ftsBind);
  const results: CoreResult[] = ftsRows.map((row) => rowToResult(row, Number(row[8] ?? 0), 'fts'));

  // EC-001：短 CJK 查询（≤2 字）且 FTS 命中不足 → content_raw LIKE 兜底（转义通配符），合并去重
  const hanCount = countHan(query);
  if (hanCount > 0 && hanCount <= 2 && results.length < LIKE_FALLBACK_FLOOR) {
    const likeSql = `SELECT ${SELECT_COLS}
FROM chunks JOIN chunk_meta ON chunk_meta.chunk_id = chunks.chunk_id
WHERE chunks.content_raw LIKE ? ESCAPE '\\'${versionClause}
LIMIT ?`;
    const likePattern = `%${escapeLike(query.trim())}%`;
    const likeBind: unknown[] =
      sdkVersion !== undefined ? [likePattern, sdkVersion, topK] : [likePattern, topK];
    const seen = new Set(results.map((r) => r.chunkId));
    for (const row of queryRows(db, likeSql, likeBind)) {
      const chunkId = String(row[0] ?? '');
      if (!seen.has(chunkId)) {
        seen.add(chunkId);
        results.push(rowToResult(row, 1.0, 'like'));
      }
    }
  }

  return { ok: true, results: results.slice(0, topK) };
}
