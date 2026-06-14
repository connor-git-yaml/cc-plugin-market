/**
 * F190 scaffold-kb — @sqlite.org/sqlite-wasm 封装（WASM 单例 + 内存 DB 落盘/加载）
 *
 * 实证（codebase-grounding §6）：官方 sqlite-wasm 含 FTS5；纯内存 DB 经
 * `sqlite3_js_db_export` 导出字节落盘，经 `sqlite3_deserialize` 从字节重建。
 * WASM module 初始化较重，进程内缓存为单例（cold/warm 性能前提，plan §4.9）。
 *
 * sqlite-wasm 的上层 oo1 API 有类型声明，但低层 capi/wasm 句柄类型不全，
 * 故在本模块内用最小本地接口收口这些调用，避免污染上层类型。
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

/** 一行查询结果（列值数组） */
export type Row = unknown[];

/** 对 sqlite-wasm oo1.DB 的最小类型视图（只声明本模块用到的成员） */
export interface SqliteDb {
  exec(opts: {
    sql: string;
    bind?: unknown[];
    rowMode?: 'array' | 'object';
    resultRows?: Row[];
  }): void;
  exec(sql: string): void;
  close(): void;
  readonly pointer: number;
  checkRc(rc: number): void;
}

/** 低层 capi/wasm 句柄（sqlite-wasm 未完整声明的部分，本地最小收口） */
interface Sqlite3Api {
  oo1: { DB: new (filename?: string) => SqliteDb };
  capi: {
    sqlite3_js_db_export(db: SqliteDb): Uint8Array;
    sqlite3_deserialize(
      dbPtr: number,
      schema: string,
      data: number,
      szDb: number,
      szBuf: number,
      flags: number,
    ): number;
    SQLITE_DESERIALIZE_FREEONCLOSE: number;
    SQLITE_DESERIALIZE_RESIZEABLE: number;
  };
  wasm: { allocFromTypedArray(bytes: Uint8Array): number };
}

let modulePromise: Promise<Sqlite3Api> | null = null;

/** 初始化（或复用）WASM module 单例 */
export async function initSqlite(): Promise<Sqlite3Api> {
  if (modulePromise === null) {
    modulePromise = (sqlite3InitModule() as Promise<unknown>).then(
      (m) => m as Sqlite3Api,
    );
  }
  return modulePromise;
}

/** 打开一个空的内存 DB */
export async function openMemoryDb(): Promise<{ sqlite3: Sqlite3Api; db: SqliteDb }> {
  const sqlite3 = await initSqlite();
  const db = new sqlite3.oo1.DB(':memory:');
  return { sqlite3, db };
}

/** 把内存 DB 导出为字节（供落盘 chunks.sqlite） */
export function exportDb(sqlite3: Sqlite3Api, db: SqliteDb): Uint8Array {
  return sqlite3.capi.sqlite3_js_db_export(db);
}

/** 从字节重建内存 DB（供 serve 加载已构建的 chunks.sqlite） */
export async function loadDbFromBytes(bytes: Uint8Array): Promise<{ sqlite3: Sqlite3Api; db: SqliteDb }> {
  const sqlite3 = await initSqlite();
  const db = new sqlite3.oo1.DB();
  // Node 的 readFileSync 返回 Buffer，其底层 ArrayBuffer 是池化的（byteOffset≠0 / 超长），
  // 直接喂给 allocFromTypedArray 会触发 heapForSize 错误。复制为紧凑 Uint8Array 规避。
  const tight = new Uint8Array(bytes.byteLength);
  tight.set(bytes);
  try {
    const ptr = sqlite3.wasm.allocFromTypedArray(tight);
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      'main',
      ptr,
      tight.byteLength,
      tight.byteLength,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    );
    db.checkRc(rc);
  } catch (err) {
    // 失败时关闭已创建的 DB 句柄，避免 WASM 内存泄漏（修 Codex WARNING）
    try {
      db.close();
    } catch {
      // close 本身失败忽略，优先抛原始错误
    }
    throw err;
  }
  return { sqlite3, db };
}

/** 便捷查询：返回行数组 */
export function queryRows(db: SqliteDb, sql: string, bind?: unknown[]): Row[] {
  const resultRows: Row[] = [];
  db.exec({ sql, bind: bind ?? [], rowMode: 'array', resultRows });
  return resultRows;
}
