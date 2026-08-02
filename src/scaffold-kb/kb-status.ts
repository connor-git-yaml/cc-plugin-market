/**
 * F241 E3 — KB 状态报告器（FR-019 / FR-020）
 *
 * **只报告状态，不触发任何重建或 ingest**，且全程只读（RG-008）。
 *
 * 三条钉死的口径：
 * 1. `activityAt = max(built_at, ingested_at)`，**先逐行取 max，再全表取 MAX**
 *    （`chunk_meta` 是逐 chunk 冗余字段，没有库级 meta 表；plan §1.6 拍板）。
 * 2. `oldestBuiltAt = MIN(built_at)` **仅供可见性，不参与判级**——让维护者看出"库里有很老的
 *    分片"，但不能因此把整库判 stale。
 * 3. **旧 schema（缺 provenance 列）→ `freshness: "unknown"` 恒定**（FR-020 v3 / P-W4）。
 *    即便 `built_at` 是 1 天前也不得判 `current`：缺列意味着 `ingested_at` 不可知，
 *    单列 `built_at` 撑不起任何判级声明，那是 over-claim。
 *
 * MCP 响应用的是 `buildKbStatusSubset`（只读 db 聚合），**不含** no-hit 目录扫描——
 * 每次 `kb_search` 响应都去扫一遍磁盘目录是不可接受的请求路径开销。
 */

import { queryRows, type SqliteDb } from './sqlite-engine.js';
import { hasProvenanceColumns } from './schema-compat.js';
import { KB_FRESHNESS_AGING_DAYS, KB_FRESHNESS_STALE_DAYS } from './governance-constants.js';
import { resolveNoHitTelemetryDir } from './nohit-recorder.js';
import { buildCoverageGapReport } from './coverage-gap.js';

export type KbFreshness = 'current' | 'aging' | 'stale' | 'unknown';
export type KbSchemaCompat = 'full' | 'legacy-missing-provenance' | 'unreadable';

export interface KbStatusOutput {
  schemaVersion: 1;
  dbExists: boolean;
  schemaCompat: KbSchemaCompat;
  /** `max(built_at, ingested_at)` 的全表最大值；旧 schema 恒为 null（不做退化计算） */
  activityAt: string | null;
  /** `now - activityAt`（整天数），**freshness 的唯一判级输入** */
  activityAgeDays: number | null;
  /** 全表 `MIN(built_at)`，**仅可见性、不参与判级** */
  oldestBuiltAt: string | null;
  ingestAgeDays: number | null;
  sourceVersions: string[];
  noHitCollection: 'enabled' | 'disabled';
  recentNoHitCount: number | null;
  freshness: KbFreshness;
}

/**
 * MCP 响应扩展字段（`KbStatusOutput` 的子集）。
 *
 * 字段名 **camelCase**：spec FR-021 明定这三个键名，实现不得单方面改外部契约（B3-C4）。
 */
export interface KbStatusSubset {
  activityAgeDays: number | null;
  sourceVersions: string[];
  freshness: KbFreshness;
}

const DAY_MS = 86_400_000;

/** db 侧可读出的部分（不碰 env、不碰文件系统） */
interface DbStatus {
  schemaCompat: KbSchemaCompat;
  activityAt: string | null;
  activityAgeDays: number | null;
  oldestBuiltAt: string | null;
  ingestAgeDays: number | null;
  sourceVersions: string[];
  freshness: KbFreshness;
}

/** `DbStatus` + 未截断的天数差（判级输入，不出现在对外输出里） */
interface DbStatusInternal extends DbStatus {
  activityAgeDaysExact: number | null;
}

const UNREADABLE: DbStatusInternal = {
  schemaCompat: 'unreadable',
  activityAt: null,
  activityAgeDays: null,
  activityAgeDaysExact: null,
  oldestBuiltAt: null,
  ingestAgeDays: null,
  sourceVersions: [],
  freshness: 'unknown',
};

/**
 * 未截断的天数差（浮点）。
 *
 * B3-C2：整天数是**展示口径**，判级必须用未截断值——先 `Math.floor` 再比阈值会把
 * 30.5 天判成 `current`、90.5 天判成 `aging`，正好在两个阈值边界各错一档。
 */
function ageDaysExact(iso: string | null, now: number): number | null {
  if (iso === null) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null; // 时间戳不可解析 → 说"不知道"，不猜一个天数
  return (now - t) / DAY_MS;
}

/** 展示用整天数（判级已由 `classify` 用未截断值完成） */
function toDisplayDays(exact: number | null): number | null {
  return exact === null ? null : Math.floor(exact);
}

/** 三元判级；输入是**未截断**天数差，为 null（含旧 schema 情形）一律 unknown */
function classify(activityAgeDaysExact: number | null): KbFreshness {
  if (activityAgeDaysExact === null) return 'unknown';
  if (activityAgeDaysExact > KB_FRESHNESS_STALE_DAYS) return 'stale';
  if (activityAgeDaysExact > KB_FRESHNESS_AGING_DAYS) return 'aging';
  return 'current';
}

function firstCell(db: SqliteDb, sql: string): unknown {
  const rows = queryRows(db, sql, []);
  return rows[0]?.[0] ?? null;
}

function asIso(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function readSourceVersions(db: SqliteDb): string[] {
  const rows = queryRows(
    db,
    'SELECT DISTINCT sdk_version FROM chunk_meta WHERE sdk_version IS NOT NULL AND sdk_version <> \'\' ORDER BY sdk_version',
    [],
  );
  return rows.map((r) => String(r[0]));
}

/**
 * 读 db 侧状态。任何 SQL 失败（表缺失 / 库损坏）都收敛为 `unreadable`，不抛。
 */
function readDbStatus(db: SqliteDb | null, now: number): DbStatusInternal {
  if (db === null) return UNREADABLE;
  let hasProvenance: boolean;
  let oldestBuiltAt: string | null;
  let sourceVersions: string[];
  try {
    hasProvenance = hasProvenanceColumns(db);
    // 这两项在新旧 schema 上都可读（built_at / sdk_version 是 F190 基础列）
    oldestBuiltAt = asIso(firstCell(db, 'SELECT MIN(built_at) FROM chunk_meta'));
    sourceVersions = readSourceVersions(db);
  } catch {
    return UNREADABLE;
  }

  if (!hasProvenance) {
    // P-W4：旧 schema 下 unknown 是**恒定结论**，不因 built_at 新近而回落 current
    return {
      schemaCompat: 'legacy-missing-provenance',
      activityAt: null,
      activityAgeDays: null,
      activityAgeDaysExact: null,
      oldestBuiltAt,
      ingestAgeDays: null,
      sourceVersions,
      freshness: 'unknown',
    };
  }

  let activityAt: string | null;
  let latestIngestedAt: string | null;
  try {
    // 逐行 max(built_at, ingested_at) → 再全表 MAX（plan §1.6 拍板的二次聚合口径）
    activityAt = asIso(
      firstCell(
        db,
        `SELECT MAX(CASE
           WHEN ingested_at IS NOT NULL AND (built_at IS NULL OR ingested_at > built_at) THEN ingested_at
           ELSE built_at
         END) FROM chunk_meta`,
      ),
    );
    latestIngestedAt = asIso(firstCell(db, 'SELECT MAX(ingested_at) FROM chunk_meta'));
  } catch {
    return UNREADABLE;
  }

  const activityAgeDaysExact = ageDaysExact(activityAt, now);
  return {
    schemaCompat: 'full',
    activityAt,
    activityAgeDays: toDisplayDays(activityAgeDaysExact),
    activityAgeDaysExact,
    oldestBuiltAt,
    ingestAgeDays: toDisplayDays(ageDaysExact(latestIngestedAt, now)),
    sourceVersions,
    freshness: classify(activityAgeDaysExact),
  };
}

/** no-hit 采集态：env 未设 → `disabled` + `null`（与"开着但还没记录"的 0 明确可区分） */
function readNoHitStatus(): Pick<KbStatusOutput, 'noHitCollection' | 'recentNoHitCount'> {
  const dir = resolveNoHitTelemetryDir();
  if (dir === null) return { noHitCollection: 'disabled', recentNoHitCount: null };
  // 复用 coverage-gap 的目录扫描与容错（保留期内的有效记录条数）
  const report = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
  return { noHitCollection: 'enabled', recentNoHitCount: report.totalRecords };
}

/**
 * 生成 KB 状态报告（CLI `scaffold-kb status` 的数据面）。
 *
 * **「文件是否存在」与「能否加载」是两个独立信号**（B3-C5）：把 `dbExists` 由
 * `db !== null` 反推，会把「库文件在、但打不开」报成「库不存在」——前者要修库，
 * 后者要建库，处置完全不同。调用方比本模块更清楚磁盘实况，故存在性由它显式传入。
 *
 * @param db 已加载的库句柄；`null` 表示未能加载（可能是不存在，也可能是损坏）
 * @param opts.dbExists 磁盘上库文件是否存在；缺省时退回 `db !== null`（既有调用方零变化）
 * @param opts.now 判级基准时刻（默认 `Date.now()`，仅测试注入用）
 */
export function buildKbStatusReport(
  db: SqliteDb | null,
  opts?: { now?: number; dbExists?: boolean },
): KbStatusOutput {
  const now = opts?.now ?? Date.now();
  const { activityAgeDaysExact: _exact, ...dbStatus } = readDbStatus(db, now);
  return {
    schemaVersion: 1,
    dbExists: opts?.dbExists ?? db !== null,
    ...dbStatus,
    ...readNoHitStatus(),
  };
}

/**
 * MCP 响应用的状态子集（FR-021）。
 *
 * 多库聚合口径：`activityAgeDays` 取各库最小值（= 最近一次活动）；`sourceVersions` 并集去重；
 * **只要有任一库不可判级（旧 schema / 不可读 / 空库），整体 `freshness` 即 `unknown`**——
 * 拿可判的那半去代表全体，正是 D7 措辞红线禁止的 over-claim。
 *
 * 判级同样走未截断天数差（B3-C2），`activityAgeDays` 只是它的展示取整。
 */
export function buildKbStatusSubset(dbs: Array<SqliteDb | null>, opts?: { now?: number }): KbStatusSubset {
  const now = opts?.now ?? Date.now();
  const present = dbs.filter((d): d is SqliteDb => d !== null);
  if (present.length === 0) return { activityAgeDays: null, sourceVersions: [], freshness: 'unknown' };

  const statuses = present.map((d) => readDbStatus(d, now));
  const versions = new Set<string>();
  for (const s of statuses) for (const v of s.sourceVersions) versions.add(v);
  const ages = statuses.map((s) => s.activityAgeDaysExact).filter((a): a is number => a !== null);
  const minAgeExact = ages.length > 0 ? Math.min(...ages) : null;
  const allJudgeable = ages.length === statuses.length;

  return {
    activityAgeDays: toDisplayDays(minAgeExact),
    sourceVersions: [...versions].sort(),
    freshness: allJudgeable ? classify(minAgeExact) : 'unknown',
  };
}
