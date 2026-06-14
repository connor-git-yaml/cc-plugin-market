/**
 * F190 T029/T030/T031 — recall@k 验收（SC-005/006/007）
 * 基于冻结 manifest（specs/190.../eval/recall-manifest.json）+ 真实 demo fixture 机械判定。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDbFromBytes, type SqliteDb } from '../../src/scaffold-kb/sqlite-engine.js';
import { computeRecall, type RecallManifest, type RecallReport } from '../../src/scaffold-kb/recall-eval.js';

const ROOT = process.cwd();
const MANIFEST = join(ROOT, 'specs/190-scaffold-kb-mvp/eval/recall-manifest.json');
const EN_KB = join(ROOT, 'plugins/demo-kb-en/kb/chunks.sqlite');
const ZH_KB = join(ROOT, 'plugins/demo-kb-zh/kb/chunks.sqlite');

let report: RecallReport;
let manifest: RecallManifest;

beforeAll(async () => {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as RecallManifest;
  const enDb = (await loadDbFromBytes(readFileSync(EN_KB))).db;
  const zhDb = (await loadDbFromBytes(readFileSync(ZH_KB))).db;
  const dbFor = (f: 'zh' | 'en'): SqliteDb => (f === 'zh' ? zhDb : enDb);
  report = computeRecall(dbFor, manifest, 5);
  // 调试输出（CI 可见实测数值）
  console.log('[recall@5]', report.byCategory.map((c) => `${c.category}=${c.recall.toFixed(2)}(${c.hits}/${c.total})`).join(' '));
});

function recallOf(category: string): number {
  return report.byCategory.find((c) => c.category === category)?.recall ?? 0;
}

describe('manifest 冻结完整性（防 null 静默跳过）', () => {
  it('所有 entry 的 expected_doc_ids 非 null 且非空', () => {
    for (const e of manifest.entries) {
      expect(e.expected_doc_ids, `entry ${e.id} expected_doc_ids 不应为 null`).not.toBeNull();
      expect((e.expected_doc_ids ?? []).length, `entry ${e.id} 应有 expected`).toBeGreaterThan(0);
    }
  });
  it('各 category 条数达标', () => {
    const count = (c: string): number => manifest.entries.filter((e) => e.category === c).length;
    expect(count('chinese_word')).toBeGreaterThanOrEqual(10);
    expect(count('mixed')).toBeGreaterThanOrEqual(5);
    expect(count('api_symbol')).toBeGreaterThanOrEqual(5);
    expect(count('error_code')).toBeGreaterThanOrEqual(5);
    expect(count('synonym')).toBeGreaterThanOrEqual(5);
  });
});

describe('SC-005 — 中文词 + 中英混合 recall@5', () => {
  it('无系统性零召回 BLOCKER（功能正确性，FR-004）', () => {
    expect(report.blockers).toEqual([]);
  });
  it('chinese_word recall@5 ≥ 0.80（目标）；< 0.50 为 BLOCKER', () => {
    const r = recallOf('chinese_word');
    expect(r, `chinese_word recall=${r} 不得低于 0.50 阻塞线`).toBeGreaterThanOrEqual(0.5);
    expect(r).toBeGreaterThanOrEqual(0.8);
  });
  it('mixed recall@5 ≥ 0.80', () => {
    expect(recallOf('mixed')).toBeGreaterThanOrEqual(0.8);
  });
});

describe('SC-006 — 短错误码 + API 符号 recall@5（阻塞项）', () => {
  it('api_symbol recall@5 ≥ 0.80', () => {
    expect(recallOf('api_symbol')).toBeGreaterThanOrEqual(0.8);
  });
  it('error_code recall@5 ≥ 0.80', () => {
    expect(recallOf('error_code')).toBeGreaterThanOrEqual(0.8);
  });
});

describe('SC-007 — 同义改写 recall@5（非阻塞 ≥ 0.60）', () => {
  it('synonym recall@5 ≥ 0.60', () => {
    expect(recallOf('synonym')).toBeGreaterThanOrEqual(0.6);
  });
});
