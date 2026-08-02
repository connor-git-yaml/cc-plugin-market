/**
 * F241 T055 — KB 状态报告器（FR-019 / FR-020 / SC-013 / EC-17）
 *
 * 三元新鲜度公式：`activityAt = max(built_at, ingested_at)`（**先逐行取 max，再全表取 MAX**），
 * `oldestBuiltAt = MIN(built_at)` 仅供可见性、**不参与判级**。
 * 旧 schema（缺 provenance 列）→ `freshness: "unknown"` **恒定**（即便 built_at 很新，P-W4）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openMemoryDb, loadDbFromBytes, exportDb, type SqliteDb } from '../../src/scaffold-kb/sqlite-engine.js';
import { normalizeForIndex } from '../../src/scaffold-kb/tokenizer.js';
import { buildKbStatusReport, buildKbStatusSubset } from '../../src/scaffold-kb/kb-status.js';

const CREATE_CHUNKS = `CREATE VIRTUAL TABLE chunks USING fts5(
  chunk_id UNINDEXED, doc_id UNINDEXED, content_raw UNINDEXED, content_tokenized,
  tokenize = 'unicode61 remove_diacritics 1')`;

/** F192 新 schema（含 provenance 三列） */
const CREATE_META_FULL = `CREATE TABLE chunk_meta (
  chunk_id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, doc_title TEXT NOT NULL,
  source_url TEXT, anchor TEXT, sdk_version TEXT, built_at TEXT NOT NULL,
  ingest_source_type TEXT, ingest_origin TEXT, ingested_at TEXT)`;

/** F190 旧 schema（精确复刻：无 provenance 三列） */
const CREATE_META_LEGACY = `CREATE TABLE chunk_meta (
  chunk_id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, doc_title TEXT NOT NULL,
  source_url TEXT, anchor TEXT, sdk_version TEXT, built_at TEXT NOT NULL)`;

const DAY_MS = 86_400_000;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

interface MetaRow {
  builtAt: string;
  ingestedAt?: string | null;
  sdkVersion?: string | null;
}

async function buildDb(rows: MetaRow[], schema: 'full' | 'legacy'): Promise<SqliteDb> {
  const { db } = await openMemoryDb();
  db.exec(CREATE_CHUNKS);
  db.exec(schema === 'full' ? CREATE_META_FULL : CREATE_META_LEGACY);
  rows.forEach((r, i) => {
    const raw = `chunk ${i} createChart`;
    db.exec({
      sql: 'INSERT INTO chunks(chunk_id,doc_id,content_raw,content_tokenized) VALUES(?,?,?,?)',
      bind: [`c${i}`, 'd1', raw, normalizeForIndex(raw)],
    });
    if (schema === 'full') {
      db.exec({
        sql: 'INSERT INTO chunk_meta(chunk_id,doc_id,doc_title,source_url,anchor,sdk_version,built_at,ingest_source_type,ingest_origin,ingested_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        bind: [`c${i}`, 'd1', 'Doc', null, null, r.sdkVersion ?? '1.0', r.builtAt, null, null, r.ingestedAt ?? null],
      });
    } else {
      db.exec({
        sql: 'INSERT INTO chunk_meta(chunk_id,doc_id,doc_title,source_url,anchor,sdk_version,built_at) VALUES(?,?,?,?,?,?,?)',
        bind: [`c${i}`, 'd1', 'Doc', null, null, r.sdkVersion ?? '1.0', r.builtAt],
      });
    }
  });
  return db;
}

const NOHIT_ENV = 'SPECTRA_KB_NOHIT_TELEMETRY';
let savedEnv: string | undefined;
let tmp: string;

beforeEach(() => {
  savedEnv = process.env[NOHIT_ENV];
  delete process.env[NOHIT_ENV];
  tmp = mkdtempSync(join(tmpdir(), 'kbstatus-'));
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env[NOHIT_ENV];
  else process.env[NOHIT_ENV] = savedEnv;
  rmSync(tmp, { recursive: true, force: true });
});

describe('kb-status — 三元新鲜度（FR-019 / SC-013）', () => {
  it('built_at 5 天前 → current', async () => {
    const r = buildKbStatusReport(await buildDb([{ builtAt: daysAgo(5) }], 'full'));
    expect(r.freshness).toBe('current');
    expect(r.schemaCompat).toBe('full');
    expect(r.dbExists).toBe(true);
    expect(r.activityAgeDays).toBe(5);
  });

  it('built_at 45 天前 → aging', async () => {
    const r = buildKbStatusReport(await buildDb([{ builtAt: daysAgo(45) }], 'full'));
    expect(r.freshness).toBe('aging');
    expect(r.activityAgeDays).toBe(45);
  });

  it('built_at 100 天前 → stale', async () => {
    const r = buildKbStatusReport(await buildDb([{ builtAt: daysAgo(100) }], 'full'));
    expect(r.freshness).toBe('stale');
    expect(r.activityAgeDays).toBe(100);
  });

  it('built_at 100 天前 + ingested_at 5 天前 → current（取 max 而非 min），oldestBuiltAt 仍如实反映 100 天前', async () => {
    const built = daysAgo(100);
    const r = buildKbStatusReport(await buildDb([{ builtAt: built, ingestedAt: daysAgo(5) }], 'full'));
    expect(r.freshness).toBe('current');
    expect(r.activityAgeDays).toBe(5);
    expect(r.oldestBuiltAt).toBe(built);
    expect(r.ingestAgeDays).toBe(5);
  });

  it('activityAt 是「先逐行 max 再全表 MAX」：无单行同时含最新两值时也能取到最新活动', async () => {
    // 行 A：built 100 天前 / 无 ingest；行 B：built 200 天前 / ingest 3 天前
    const r = buildKbStatusReport(
      await buildDb(
        [
          { builtAt: daysAgo(100), ingestedAt: null },
          { builtAt: daysAgo(200), ingestedAt: daysAgo(3) },
        ],
        'full',
      ),
    );
    expect(r.activityAgeDays).toBe(3);
    expect(r.freshness).toBe('current');
    // oldestBuiltAt 是全表 MIN(built_at)，仅可见性，不把整库拉成 stale
    expect(r.oldestBuiltAt).not.toBeNull();
    expect(new Date(r.oldestBuiltAt!).getTime()).toBeLessThan(Date.now() - 199 * DAY_MS);
  });

  it('sourceVersions 去重且稳定排序', async () => {
    const r = buildKbStatusReport(
      await buildDb(
        [
          { builtAt: daysAgo(1), sdkVersion: '2.0' },
          { builtAt: daysAgo(1), sdkVersion: '1.0' },
          { builtAt: daysAgo(1), sdkVersion: '2.0' },
          { builtAt: daysAgo(1), sdkVersion: null },
        ],
        'full',
      ),
    );
    expect(r.sourceVersions).toEqual(['1.0', '2.0']);
  });

  it('空库（无 chunk_meta 行）→ activityAt null + freshness unknown，不谎报 current', async () => {
    const r = buildKbStatusReport(await buildDb([], 'full'));
    expect(r.activityAt).toBeNull();
    expect(r.activityAgeDays).toBeNull();
    expect(r.freshness).toBe('unknown');
    expect(r.schemaCompat).toBe('full');
  });

  it('db 为 null → dbExists false + schemaCompat unreadable + unknown', () => {
    const r = buildKbStatusReport(null);
    expect(r).toMatchObject({
      schemaVersion: 1,
      dbExists: false,
      schemaCompat: 'unreadable',
      activityAt: null,
      activityAgeDays: null,
      oldestBuiltAt: null,
      ingestAgeDays: null,
      sourceVersions: [],
      freshness: 'unknown',
    });
  });
});

describe('kb-status — 旧 schema unknown 恒定（FR-020 / P-W4 / EC-17）', () => {
  it('缺 provenance 列旧库 → legacy-missing-provenance + unknown + 不抛错', async () => {
    const r = buildKbStatusReport(await buildDb([{ builtAt: daysAgo(100) }], 'legacy'));
    expect(r.schemaCompat).toBe('legacy-missing-provenance');
    expect(r.freshness).toBe('unknown');
    expect(r.activityAt).toBeNull();
    expect(r.activityAgeDays).toBeNull();
    expect(r.ingestAgeDays).toBeNull();
  });

  it('**回归钉子**：旧库 built_at 为 1 天前（很新）→ freshness 仍恒为 unknown，不得回落为 current', async () => {
    const r = buildKbStatusReport(await buildDb([{ builtAt: daysAgo(1) }], 'legacy'));
    expect(r.freshness).toBe('unknown');
    expect(r.activityAt).toBeNull();
    expect(r.activityAgeDays).toBeNull();
  });

  it('旧库 built_at 为 5 天前 → 同样 unknown（SC-013 第 (v) 组）', async () => {
    expect(buildKbStatusReport(await buildDb([{ builtAt: daysAgo(5) }], 'legacy')).freshness).toBe('unknown');
  });

  it('旧库仍如实输出 oldestBuiltAt 与 sourceVersions（可见性字段不受判级封锁影响）', async () => {
    const built = daysAgo(77);
    const r = buildKbStatusReport(await buildDb([{ builtAt: built, sdkVersion: '3.1' }], 'legacy'));
    expect(r.oldestBuiltAt).toBe(built);
    expect(r.sourceVersions).toEqual(['3.1']);
  });

  it('chunk_meta 表整个不存在（结构损坏）→ unreadable + unknown，不抛错', async () => {
    const { db } = await openMemoryDb();
    db.exec(CREATE_CHUNKS);
    const r = buildKbStatusReport(db);
    expect(r.schemaCompat).toBe('unreadable');
    expect(r.freshness).toBe('unknown');
  });
});

describe('kb-status — no-hit 采集态（FR-019 / P-W2）', () => {
  it('env 未设 → noHitCollection disabled + recentNoHitCount null', async () => {
    const r = buildKbStatusReport(await buildDb([{ builtAt: daysAgo(1) }], 'full'));
    expect(r.noHitCollection).toBe('disabled');
    expect(r.recentNoHitCount).toBeNull();
  });

  it('env 设置且目录有数据 → enabled + 非负整数', async () => {
    process.env[NOHIT_ENV] = tmp;
    const file = join(tmp, 'nohit-20260801.jsonl');
    writeFileSync(file, '');
    for (const hash of ['h1', 'h2', 'h3']) {
      appendFileSync(
        file,
        `${JSON.stringify({
          schemaVersion: 1,
          timestamp: '2026-08-01T00:00:00.000Z',
          tool: 'kb_search',
          terms: ['alpha'],
          normalizedQueryHash: hash,
          redactionTags: [],
          resultCount: 0,
          dbPathHash: 'abc',
        })}\n`,
      );
    }
    const r = buildKbStatusReport(await buildDb([{ builtAt: daysAgo(1) }], 'full'));
    expect(r.noHitCollection).toBe('enabled');
    expect(r.recentNoHitCount).toBe(3);
  });

  it('env 设置但目录为空 → enabled + 0（可区分于「采集没开」的 null）', async () => {
    process.env[NOHIT_ENV] = tmp;
    const r = buildKbStatusReport(await buildDb([{ builtAt: daysAgo(1) }], 'full'));
    expect(r.noHitCollection).toBe('enabled');
    expect(r.recentNoHitCount).toBe(0);
  });
});

/**
 * B3-W2：原断言把「文件写盘后再 hash 两次」当只读证明——被 hash 的文件从未传进被测函数，
 * 断言近乎恒真。模块层能证明的是**被测函数拿到的那个 db 句柄**内容未变（导出字节比对）；
 * 「CLI 实际读的那个文件路径没被改写」在 `cli-scaffold-kb.test.ts` 里用真实 argv 断言。
 */
describe('kb-status — 只读证明（SC-013 / RG-008）', () => {
  it('被测 db 句柄导出字节在调用前后逐字节不变', async () => {
    const { sqlite3, db: src } = await openMemoryDb();
    src.exec(CREATE_CHUNKS);
    src.exec(CREATE_META_FULL);
    src.exec({
      sql: 'INSERT INTO chunk_meta(chunk_id,doc_id,doc_title,source_url,anchor,sdk_version,built_at,ingest_source_type,ingest_origin,ingested_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      bind: ['c0', 'd1', 'Doc', null, null, '1.0', daysAgo(10), null, null, daysAgo(2)],
    });
    const dbFile = join(tmp, 'chunks.sqlite');
    writeFileSync(dbFile, exportDb(sqlite3, src));

    // 关键：hash 的对象就是**传进被测函数的那个句柄**，不是旁路的磁盘副本
    const { sqlite3: rt, db } = await loadDbFromBytes(readFileSync(dbFile));
    const before = createHash('sha256').update(exportDb(rt, db)).digest('hex');
    const r = buildKbStatusReport(db);
    expect(r.freshness).toBe('current');
    const after = createHash('sha256').update(exportDb(rt, db)).digest('hex');

    expect(after).toBe(before);
    // 防「导出恒定」假绿：确实写一笔就必须变，说明这个 hash 有分辨力
    db.exec({
      sql: 'INSERT INTO chunk_meta(chunk_id,doc_id,doc_title,source_url,anchor,sdk_version,built_at,ingest_source_type,ingest_origin,ingested_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      bind: ['c1', 'd1', 'Doc', null, null, '1.0', daysAgo(9), null, null, null],
    });
    expect(createHash('sha256').update(exportDb(rt, db)).digest('hex')).not.toBe(before);
  });
});

describe('kb-status — MCP 子集聚合（FR-021）', () => {
  it('无可用库 → activityAgeDays null + freshness unknown + sourceVersions 空', () => {
    expect(buildKbStatusSubset([])).toEqual({
      activityAgeDays: null,
      sourceVersions: [],
      freshness: 'unknown',
    });
  });

  it('单库 → 直接反映该库状态', async () => {
    const s = buildKbStatusSubset([await buildDb([{ builtAt: daysAgo(2), sdkVersion: '1.0' }], 'full')]);
    expect(s).toEqual({ activityAgeDays: 2, sourceVersions: ['1.0'], freshness: 'current' });
  });

  it('双库 → 取最近一次活动，sourceVersions 并集去重排序', async () => {
    const s = buildKbStatusSubset([
      await buildDb([{ builtAt: daysAgo(120), sdkVersion: '1.0' }], 'full'),
      await buildDb([{ builtAt: daysAgo(4), sdkVersion: '2.0' }], 'full'),
    ]);
    expect(s.activityAgeDays).toBe(4);
    expect(s.sourceVersions).toEqual(['1.0', '2.0']);
    expect(s.freshness).toBe('current');
  });

  it('任一库不可判级（旧 schema）→ 整体 freshness unknown（不拿可判的那半冒充全体）', async () => {
    const s = buildKbStatusSubset([
      await buildDb([{ builtAt: daysAgo(2), sdkVersion: '1.0' }], 'full'),
      await buildDb([{ builtAt: daysAgo(2), sdkVersion: '9.9' }], 'legacy'),
    ]);
    expect(s.freshness).toBe('unknown');
    expect(s.sourceVersions).toEqual(['1.0', '9.9']);
  });

  it('子集不读 no-hit 目录（MCP 每次响应都扫盘不可接受）', async () => {
    process.env[NOHIT_ENV] = tmp;
    const s = buildKbStatusSubset([await buildDb([{ builtAt: daysAgo(2) }], 'full')]);
    expect(Object.keys(s).sort()).toEqual(['activityAgeDays', 'freshness', 'sourceVersions']);
  });

  it('**B3-C4 回归钉子**：子集键一律 camelCase，不得出现 snake_case 变体（spec FR-021 是外部契约）', async () => {
    const s = buildKbStatusSubset([await buildDb([{ builtAt: daysAgo(2) }], 'full')]) as unknown as Record<string, unknown>;
    for (const forbidden of ['activity_age_days', 'source_versions']) {
      expect(Object.keys(s)).not.toContain(forbidden);
    }
  });
});

// ============================================================
// F241 批 3 Codex 整改 — B3-C2 / B3-C5
// ============================================================

/**
 * B3-C2：先 `Math.floor` 再比阈值，会把 30.5 天判成 current、90.5 天判成 aging——
 * 整天数是**展示口径**，判级必须用未截断的时间差。
 */
describe('kb-status — 阈值判级不先截断（B3-C2）', () => {
  /** 用固定 now 注入，避免测试运行耗时把边界推过界 */
  function atAge(days: number): { built: string; now: number } {
    const now = Date.UTC(2026, 7, 1, 12, 0, 0);
    return { built: new Date(now - days * DAY_MS).toISOString(), now };
  }

  it.each([
    [30.5, 'aging'],
    [30.01, 'aging'],
    [90.5, 'stale'],
    [90.01, 'stale'],
  ])('%s 天 → %s（先 floor 会误判为低一级）', async (days, expected) => {
    const { built, now } = atAge(days as number);
    const r = buildKbStatusReport(await buildDb([{ builtAt: built }], 'full'), { now });
    expect(r.freshness).toBe(expected);
  });

  it.each([
    [30, 'current'],
    [29.99, 'current'],
    [90, 'aging'],
    [89.99, 'aging'],
  ])('%s 天 → %s（边界是「超过」而非「达到」，不得反向误伤）', async (days, expected) => {
    const { built, now } = atAge(days as number);
    const r = buildKbStatusReport(await buildDb([{ builtAt: built }], 'full'), { now });
    expect(r.freshness).toBe(expected);
  });

  it('展示字段 activityAgeDays 仍是整天数（30.5 天显示 30，但判级已是 aging）', async () => {
    const { built, now } = atAge(30.5);
    const r = buildKbStatusReport(await buildDb([{ builtAt: built }], 'full'), { now });
    expect(r.activityAgeDays).toBe(30);
    expect(r.freshness).toBe('aging');
  });

  it('MCP 子集同样不先截断：30.5 天 → aging', async () => {
    const { built, now } = atAge(30.5);
    const s = buildKbStatusSubset([await buildDb([{ builtAt: built }], 'full')], { now });
    expect(s.activityAgeDays).toBe(30);
    expect(s.freshness).toBe('aging');
  });
});

/**
 * B3-C5：`dbExists` 由 `db !== null` 反推，会把「文件在、但打不开」报成「文件不存在」——
 * 这两件事的处置完全不同（前者要修库，后者要建库）。
 */
describe('kb-status — 存在性与可加载性是两个独立信号（B3-C5）', () => {
  it('显式传 dbExists:true 且 db 为 null → dbExists true + schemaCompat unreadable', () => {
    const r = buildKbStatusReport(null, { dbExists: true });
    expect(r.dbExists).toBe(true);
    expect(r.schemaCompat).toBe('unreadable');
    expect(r.freshness).toBe('unknown');
  });

  it('不传 dbExists 时沿用旧默认（db!==null 推导），既有调用方零行为变化', async () => {
    expect(buildKbStatusReport(null).dbExists).toBe(false);
    expect(buildKbStatusReport(await buildDb([{ builtAt: daysAgo(1) }], 'full')).dbExists).toBe(true);
  });

  it('显式传 dbExists:false 且 db 可用 → 以显式信号为准（调用方比模块更清楚磁盘实况）', async () => {
    const r = buildKbStatusReport(await buildDb([{ builtAt: daysAgo(1) }], 'full'), { dbExists: false });
    expect(r.dbExists).toBe(false);
    expect(r.schemaCompat).toBe('full'); // 可加载性不受存在性信号影响
  });
});
