/**
 * F190 scaffold-kb — chunks.sqlite 写入（FTS5 建表 + 写入 + 落盘）
 *
 * 表结构（plan §4.1.2 / spec §3.3）：
 * - `chunks` FTS5 虚拟表：chunk_id/doc_id/content_raw 为 UNINDEXED（不参与匹配，
 *   content_raw 供 envelope 原样返回，R-003/Codex C4）；content_tokenized 是唯一检索列
 *   （写入前过 normalizeForIndex，与查询侧同构）
 * - `chunk_meta` 普通表：冗余 doc_title/source_url，使 kb_search 不依赖 doc-graph.json
 */

import { writeFileSync } from 'node:fs';
import type { Chunk, ChunkMeta } from './types.js';
import { normalizeForIndex } from './tokenizer.js';
import { openMemoryDb, exportDb } from './sqlite-engine.js';

const CREATE_CHUNKS = `CREATE VIRTUAL TABLE chunks USING fts5(
  chunk_id UNINDEXED,
  doc_id UNINDEXED,
  content_raw UNINDEXED,
  content_tokenized,
  tokenize = 'unicode61 remove_diacritics 1'
)`;

const CREATE_META = `CREATE TABLE chunk_meta (
  chunk_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  doc_title TEXT NOT NULL,
  source_url TEXT,
  anchor TEXT,
  sdk_version TEXT,
  built_at TEXT NOT NULL
)`;

/**
 * 在内存 DB 构建 chunks + chunk_meta，导出为字节。
 * 纯函数（不落盘），便于测试。
 */
export async function buildChunksDbBytes(
  chunks: Chunk[],
  meta: ChunkMeta[],
): Promise<Uint8Array> {
  const { sqlite3, db } = await openMemoryDb();
  try {
    db.exec(CREATE_CHUNKS);
    db.exec(CREATE_META);

    for (const c of chunks) {
      db.exec({
        sql: 'INSERT INTO chunks(chunk_id, doc_id, content_raw, content_tokenized) VALUES(?,?,?,?)',
        bind: [c.chunkId, c.docId, c.contentRaw, normalizeForIndex(c.contentRaw)],
      });
    }
    for (const m of meta) {
      db.exec({
        sql: 'INSERT INTO chunk_meta(chunk_id, doc_id, doc_title, source_url, anchor, sdk_version, built_at) VALUES(?,?,?,?,?,?,?)',
        bind: [m.chunkId, m.docId, m.docTitle, m.sourceUrl, m.anchor, m.sdkVersion, m.builtAt],
      });
    }
    return exportDb(sqlite3, db);
  } finally {
    db.close();
  }
}

/** 构建并落盘 chunks.sqlite 到 outputPath */
export async function writeChunksToSqlite(
  chunks: Chunk[],
  meta: ChunkMeta[],
  outputPath: string,
): Promise<void> {
  const bytes = await buildChunksDbBytes(chunks, meta);
  writeFileSync(outputPath, bytes);
}
