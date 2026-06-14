/**
 * F190 FR-015 — recall@k 机械判定（基于冻结 manifest + searchKbCore）
 *
 * 反过拟合：判定只看 query → top-k docId 是否命中 expected_doc_ids，
 * 无任何按 query 文本的特例分支。systematic zero-recall（命中 0 且目标存在）= BLOCKER。
 */

import type { SqliteDb } from './sqlite-engine.js';
import { queryRows } from './sqlite-engine.js';
import { searchKbCore } from './search-core.js';

export type RecallCategory =
  | 'chinese_word'
  | 'mixed'
  | 'api_symbol'
  | 'error_code'
  | 'synonym';

export interface RecallEntry {
  id: string;
  query: string;
  fixture: 'zh' | 'en';
  category: RecallCategory;
  /** 标准答案文档 id 集；null = 占位（未冻结），跳过判定 */
  expected_doc_ids: string[] | null;
  expected_chunk_ids?: string[] | null;
}

export interface RecallManifest {
  manifest_version: string;
  created?: string;
  description?: string;
  entries: RecallEntry[];
}

export interface EntryOutcome {
  id: string;
  category: RecallCategory;
  hit: boolean;
  /** systematic zero-recall：返回 0 结果但 expected 文档确实在库中 → BLOCKER */
  blocker: boolean;
  skipped: boolean;
}

export interface CategoryRecall {
  category: RecallCategory;
  total: number;
  hits: number;
  recall: number;
}

export interface RecallReport {
  byCategory: CategoryRecall[];
  outcomes: EntryOutcome[];
  blockers: string[];
}

/** 某 docId 是否存在于库（用于 zero-recall BLOCKER 判定） */
function docExists(db: SqliteDb, docId: string): boolean {
  const rows = queryRows(db, 'SELECT 1 FROM chunk_meta WHERE doc_id = ? LIMIT 1', [docId]);
  return rows.length > 0;
}

/**
 * 对单库（fixture 对应的 vendor DB）跑整份 manifest，按 category 计 recall@k。
 * @param dbFor 按 fixture 返回对应已加载 DB（zh/en 各一）
 */
export function computeRecall(
  dbFor: (fixture: 'zh' | 'en') => SqliteDb,
  manifest: RecallManifest,
  k: number,
): RecallReport {
  const outcomes: EntryOutcome[] = [];
  const blockers: string[] = [];

  for (const entry of manifest.entries) {
    if (entry.expected_doc_ids === null || entry.expected_doc_ids.length === 0) {
      outcomes.push({ id: entry.id, category: entry.category, hit: false, blocker: false, skipped: true });
      continue;
    }
    const db = dbFor(entry.fixture);
    const res = searchKbCore(db, entry.query, k);
    const topDocIds = res.ok ? res.results.slice(0, k).map((r) => r.docId) : [];
    const expected = new Set(entry.expected_doc_ids);
    const hit = topDocIds.some((d) => expected.has(d));

    // systematic zero-recall：0 命中 + 目标确实在库 → BLOCKER
    const blocker = topDocIds.length === 0 && entry.expected_doc_ids.some((d) => docExists(db, d));
    if (blocker) blockers.push(entry.id);

    outcomes.push({ id: entry.id, category: entry.category, hit, blocker, skipped: false });
  }

  const cats = new Map<RecallCategory, { total: number; hits: number }>();
  for (const o of outcomes) {
    if (o.skipped) continue;
    const c = cats.get(o.category) ?? { total: 0, hits: 0 };
    c.total += 1;
    if (o.hit) c.hits += 1;
    cats.set(o.category, c);
  }
  const byCategory: CategoryRecall[] = [...cats.entries()].map(([category, { total, hits }]) => ({
    category,
    total,
    hits,
    recall: total === 0 ? 0 : hits / total,
  }));

  return { byCategory, outcomes, blockers };
}
