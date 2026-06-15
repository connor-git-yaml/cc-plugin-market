/**
 * F192 T002 / SC-015 — chunk_meta 向后兼容（C-1 / R-COMPAT-1）
 * 旧 F190 schema（无 provenance 三列）读取不抛 no such column；新库 provenance 正确往返。
 */

import { describe, it, expect } from 'vitest';
import { openMemoryDb, loadDbFromBytes } from '../../src/scaffold-kb/sqlite-engine.js';
import { normalizeForIndex } from '../../src/scaffold-kb/tokenizer.js';
import { searchKbCore } from '../../src/scaffold-kb/search-core.js';
import { buildChunksDbBytes } from '../../src/scaffold-kb/sqlite-writer.js';
import { hasProvenanceColumns } from '../../src/scaffold-kb/schema-compat.js';
import type { Chunk, ChunkMeta } from '../../src/scaffold-kb/types.js';

const CREATE_CHUNKS = `CREATE VIRTUAL TABLE chunks USING fts5(
  chunk_id UNINDEXED, doc_id UNINDEXED, content_raw UNINDEXED, content_tokenized,
  tokenize = 'unicode61 remove_diacritics 1')`;

// F190 旧 schema：chunk_meta 无 provenance 三列（精确复刻 F190 DDL）
const CREATE_META_OLD = `CREATE TABLE chunk_meta (
  chunk_id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, doc_title TEXT NOT NULL,
  source_url TEXT, anchor TEXT, sdk_version TEXT, built_at TEXT NOT NULL)`;

async function buildOldSchemaDb() {
  const { db } = await openMemoryDb();
  db.exec(CREATE_CHUNKS);
  db.exec(CREATE_META_OLD);
  const raw = 'createChart 创建图表的入口函数';
  db.exec({
    sql: 'INSERT INTO chunks(chunk_id,doc_id,content_raw,content_tokenized) VALUES(?,?,?,?)',
    bind: ['c1', 'd1', raw, normalizeForIndex(raw)],
  });
  db.exec({
    sql: 'INSERT INTO chunk_meta(chunk_id,doc_id,doc_title,source_url,anchor,sdk_version,built_at) VALUES(?,?,?,?,?,?,?)',
    bind: ['c1', 'd1', 'Doc 1', null, null, '1.0', 'B'],
  });
  return db;
}

describe('schema-compat — F190 旧库向后兼容（C-1/SC-015）', () => {
  it('旧 schema（无 provenance 列）→ hasProvenanceColumns=false', async () => {
    const db = await buildOldSchemaDb();
    expect(hasProvenanceColumns(db)).toBe(false);
  });

  it('旧库 searchKbCore 不抛 no such column，provenance 返回 null', async () => {
    const db = await buildOldSchemaDb();
    const r = searchKbCore(db, 'createChart', 5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results.length).toBeGreaterThan(0);
      expect(r.results[0]!.ingestSourceType).toBeNull();
      expect(r.results[0]!.ingestOrigin).toBeNull();
      expect(r.results[0]!.ingestedAt).toBeNull();
      // 既有字段不回归
      expect(r.results[0]!.docTitle).toBe('Doc 1');
      expect(r.results[0]!.sdkVersion).toBe('1.0');
    }
  });

  it('新库（buildChunksDbBytes 带 provenance）→ hasProvenanceColumns=true 且正确返回', async () => {
    const chunks: Chunk[] = [
      { chunkId: 'c1', docId: 'd1', contentRaw: 'createChart 创建图表的入口函数', anchor: null },
    ];
    const meta: ChunkMeta[] = [
      {
        chunkId: 'c1',
        docId: 'd1',
        docTitle: 'Doc 1',
        sourceUrl: 'https://example.com/y',
        anchor: null,
        sdkVersion: '1.0',
        builtAt: 'B',
        ingestSourceType: 'url',
        ingestOrigin: 'https://example.com/y',
        ingestedAt: 'T',
      },
    ];
    const bytes = await buildChunksDbBytes(chunks, meta);
    const { db } = await loadDbFromBytes(bytes);
    expect(hasProvenanceColumns(db)).toBe(true);
    const r = searchKbCore(db, 'createChart', 5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.results[0]!.ingestSourceType).toBe('url');
      expect(r.results[0]!.ingestOrigin).toBe('https://example.com/y');
      expect(r.results[0]!.ingestedAt).toBe('T');
    }
  });
});
