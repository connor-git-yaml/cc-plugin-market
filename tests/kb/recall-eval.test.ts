/**
 * F190 — recall-eval 判定逻辑单测（合成数据，独立于真实 fixture）
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { Chunk, ChunkMeta } from '../../src/scaffold-kb/types.js';
import { buildChunksDbBytes } from '../../src/scaffold-kb/sqlite-writer.js';
import { loadDbFromBytes, type SqliteDb } from '../../src/scaffold-kb/sqlite-engine.js';
import { computeRecall, type RecallManifest } from '../../src/scaffold-kb/recall-eval.js';

const chunks: Chunk[] = [
  { chunkId: 'auth#1', docId: 'auth', contentRaw: '鉴权失败返回 ERR_AUTH_FAILED', anchor: null },
  { chunkId: 'codes#1', docId: 'codes', contentRaw: '错误码 404 资源不存在', anchor: null },
];
const meta: ChunkMeta[] = [
  { chunkId: 'auth#1', docId: 'auth', docTitle: '鉴权', sourceUrl: null, anchor: null, sdkVersion: null, builtAt: 'B' },
  { chunkId: 'codes#1', docId: 'codes', docTitle: '错误码', sourceUrl: null, anchor: null, sdkVersion: null, builtAt: 'B' },
];

let db: SqliteDb;
beforeAll(async () => {
  const bytes = await buildChunksDbBytes(chunks, meta);
  db = (await loadDbFromBytes(bytes)).db;
});

const dbFor = () => db;

describe('computeRecall', () => {
  it('全命中 → recall 1.0', () => {
    const manifest: RecallManifest = {
      manifest_version: '1.0',
      entries: [
        { id: 'z1', query: '鉴权失败', fixture: 'zh', category: 'chinese_word', expected_doc_ids: ['auth'] },
        { id: 'z2', query: '错误码', fixture: 'zh', category: 'chinese_word', expected_doc_ids: ['codes'] },
      ],
    };
    const rep = computeRecall(dbFor, manifest, 5);
    const cw = rep.byCategory.find((c) => c.category === 'chinese_word');
    expect(cw?.recall).toBe(1.0);
    expect(rep.blockers).toEqual([]);
  });

  it('部分命中 → recall 0.5', () => {
    const manifest: RecallManifest = {
      manifest_version: '1.0',
      entries: [
        { id: 'a', query: 'ERR_AUTH_FAILED', fixture: 'en', category: 'api_symbol', expected_doc_ids: ['auth'] },
        { id: 'b', query: 'sdk.Nonexistent()', fixture: 'en', category: 'api_symbol', expected_doc_ids: ['auth'] },
      ],
    };
    const rep = computeRecall(dbFor, manifest, 5);
    expect(rep.byCategory.find((c) => c.category === 'api_symbol')?.recall).toBe(0.5);
  });

  it('expected_doc_ids 为 null → 跳过判定（占位）', () => {
    const manifest: RecallManifest = {
      manifest_version: '1.0',
      entries: [{ id: 'p', query: '任意', fixture: 'zh', category: 'synonym', expected_doc_ids: null }],
    };
    const rep = computeRecall(dbFor, manifest, 5);
    expect(rep.outcomes[0]?.skipped).toBe(true);
    expect(rep.byCategory).toEqual([]);
  });

  it('systematic zero-recall（目标在库但 0 命中）→ BLOCKER', () => {
    const manifest: RecallManifest = {
      manifest_version: '1.0',
      // 用一个绝不可能命中的查询，但 expected 文档确实在库
      entries: [{ id: 'zr', query: 'qqzzxx', fixture: 'zh', category: 'chinese_word', expected_doc_ids: ['auth'] }],
    };
    const rep = computeRecall(dbFor, manifest, 5);
    expect(rep.blockers).toContain('zr');
  });
});
