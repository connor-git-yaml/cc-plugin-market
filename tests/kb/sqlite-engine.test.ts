/**
 * F190 T003 — sqlite-engine：WASM 初始化 + FTS5 smoke + 字节往返
 *
 * 这是整个数据层的最高风险点（FTS5 可用性 + 内存 DB 落盘/加载）。
 */

import { describe, it, expect } from 'vitest';
import {
  initSqlite,
  openMemoryDb,
  exportDb,
  loadDbFromBytes,
  queryRows,
} from '../../src/scaffold-kb/sqlite-engine.js';

describe('sqlite-engine', () => {
  it('WASM module 初始化成功（含 FTS5）', async () => {
    const { sqlite3, db } = await openMemoryDb();
    // FTS5 可用：建虚拟表不抛错
    expect(() =>
      db.exec("CREATE VIRTUAL TABLE t USING fts5(content, tokenize='unicode61')"),
    ).not.toThrow();
    expect(sqlite3).toBeTruthy();
    db.close();
  });

  it('FTS5 MATCH 查询命中', async () => {
    const { db } = await openMemoryDb();
    db.exec("CREATE VIRTUAL TABLE t USING fts5(content)");
    db.exec({ sql: 'INSERT INTO t(content) VALUES(?)', bind: ['hello world'] });
    const rows = queryRows(db, "SELECT content FROM t WHERE t MATCH 'hello'");
    expect(rows).toEqual([['hello world']]);
    db.close();
  });

  it('内存 DB 导出字节非空', async () => {
    const { sqlite3, db } = await openMemoryDb();
    db.exec('CREATE TABLE x(a)');
    db.exec({ sql: 'INSERT INTO x(a) VALUES(?)', bind: [1] });
    const bytes = exportDb(sqlite3, db);
    expect(bytes.length).toBeGreaterThan(0);
    db.close();
  });

  it('字节往返：export → deserialize 后仍可查询（含 CJK bigram）', async () => {
    const { sqlite3, db } = await openMemoryDb();
    db.exec(
      "CREATE VIRTUAL TABLE chunks USING fts5(chunk_id UNINDEXED, content_raw UNINDEXED, content_tokenized, tokenize='unicode61')",
    );
    db.exec({
      sql: 'INSERT INTO chunks(chunk_id,content_raw,content_tokenized) VALUES(?,?,?)',
      bind: ['c1', '错误码 原文', '错 误 码 错误 误码'],
    });
    const bytes = exportDb(sqlite3, db);
    db.close();

    const loaded = await loadDbFromBytes(bytes);
    const rows = queryRows(
      loaded.db,
      "SELECT content_raw FROM chunks WHERE content_tokenized MATCH '误码'",
    );
    expect(rows).toEqual([['错误码 原文']]);
    loaded.db.close();
  });
});
