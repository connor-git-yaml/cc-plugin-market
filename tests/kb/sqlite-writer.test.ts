/**
 * F190 T011 — sqlite-writer：FTS5 建表 + 写入 + 逻辑幂等
 * 幂等用 SQL 查询逻辑断言（chunk 集合/content/doc/anchor），禁止 hash sqlite 文件（Codex INFO-13）。
 */

import { describe, it, expect } from 'vitest';
import type { Chunk, ChunkMeta } from '../../src/scaffold-kb/types.js';
import { buildChunksDbBytes } from '../../src/scaffold-kb/sqlite-writer.js';
import { loadDbFromBytes, queryRows } from '../../src/scaffold-kb/sqlite-engine.js';

const chunks: Chunk[] = [
  { chunkId: 'd#a', docId: 'd', contentRaw: '错误码说明', anchor: 'a' },
  { chunkId: 'd#b', docId: 'd', contentRaw: 'sdk.Init() 初始化', anchor: 'b' },
];
const meta: ChunkMeta[] = [
  { chunkId: 'd#a', docId: 'd', docTitle: 'T', sourceUrl: 'u', anchor: 'a', sdkVersion: null, builtAt: 'B' },
  { chunkId: 'd#b', docId: 'd', docTitle: 'T', sourceUrl: 'u', anchor: 'b', sdkVersion: null, builtAt: 'B' },
];

async function logicalSnapshot(bytes: Uint8Array): Promise<string> {
  const { db } = await loadDbFromBytes(bytes);
  const rows = queryRows(
    db,
    `SELECT chunks.chunk_id, chunks.content_raw, chunks.doc_id, chunk_meta.anchor
     FROM chunks JOIN chunk_meta ON chunk_meta.chunk_id = chunks.chunk_id
     ORDER BY chunks.chunk_id`,
  );
  db.close();
  return JSON.stringify(rows);
}

describe('sqlite-writer', () => {
  it('建表 + 写入后 content_raw 可读、content_tokenized 可 MATCH', async () => {
    const bytes = await buildChunksDbBytes(chunks, meta);
    const { db } = await loadDbFromBytes(bytes);
    const raw = queryRows(db, "SELECT content_raw FROM chunks WHERE chunk_id='d#a'");
    expect(raw).toEqual([['错误码说明']]);
    // 中文 bigram 经 normalize 写入 → MATCH 命中
    const hit = queryRows(db, "SELECT chunk_id FROM chunks WHERE chunks MATCH '\"错误\"'");
    expect(hit.flat()).toContain('d#a');
    db.close();
  });

  it('chunk_meta 含冗余 doc_title/source_url（R-003）', async () => {
    const bytes = await buildChunksDbBytes(chunks, meta);
    const { db } = await loadDbFromBytes(bytes);
    const r = queryRows(db, "SELECT doc_title, source_url FROM chunk_meta WHERE chunk_id='d#a'");
    expect(r).toEqual([['T', 'u']]);
    db.close();
  });

  it('逻辑幂等：两次构建 chunk 集合/content/doc/anchor 一致（不 hash 文件）', async () => {
    const b1 = await buildChunksDbBytes(chunks, meta);
    const b2 = await buildChunksDbBytes(chunks, meta);
    expect(await logicalSnapshot(b1)).toEqual(await logicalSnapshot(b2));
  });
});
