/**
 * F190 T020a — searchKbCore 单库检索（write → load → query 全链路）
 * 同时覆盖 sqlite-writer 写入 + query-sanitizer + FTS5 + LIKE 兜底。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { Chunk, ChunkMeta } from '../../src/scaffold-kb/types.js';
import { buildChunksDbBytes } from '../../src/scaffold-kb/sqlite-writer.js';
import { loadDbFromBytes, type SqliteDb } from '../../src/scaffold-kb/sqlite-engine.js';
import { searchKbCore } from '../../src/scaffold-kb/search-core.js';

const BUILT_AT = '2026-06-14T00:00:00.000Z';

function mkChunk(id: string, raw: string): Chunk {
  return { chunkId: id, docId: id.split('#')[0] ?? id, contentRaw: raw, anchor: null };
}
function mkMeta(id: string, title: string): ChunkMeta {
  return {
    chunkId: id,
    docId: id.split('#')[0] ?? id,
    docTitle: title,
    sourceUrl: `https://example/${id}`,
    anchor: null,
    sdkVersion: null,
    builtAt: BUILT_AT,
  };
}

const CHUNKS: Chunk[] = [
  mkChunk('doc-auth#1', '鉴权失败时返回错误码 ERR_AUTH_FAILED，请检查 X-Api-Key 是否正确。'),
  mkChunk('doc-init#1', '调用 sdk.Init() 完成初始化，初始化失败抛出异常。'),
  mkChunk('doc-codes#1', '常见 HTTP 错误码：401 未授权，404 资源不存在，E01 内部错误。'),
  mkChunk('doc-chart#1', '配置 xAxis.axisLabel.formatter 自定义坐标轴标签格式。'),
];
const META: ChunkMeta[] = [
  mkMeta('doc-auth#1', '鉴权文档'),
  mkMeta('doc-init#1', '初始化文档'),
  mkMeta('doc-codes#1', '错误码文档'),
  mkMeta('doc-chart#1', '图表配置文档'),
];

let db: SqliteDb;

beforeAll(async () => {
  const bytes = await buildChunksDbBytes(CHUNKS, META);
  const loaded = await loadDbFromBytes(bytes);
  db = loaded.db;
});

function hitDocIds(query: string, topK = 5): string[] {
  const r = searchKbCore(db, query, topK);
  if (!r.ok) throw new Error(`unexpected error: ${r.code}`);
  return r.results.map((x) => x.docId);
}

describe('searchKbCore — 中文词查询', () => {
  it('"错误码" 命中含该词的 chunk', () => {
    expect(hitDocIds('错误码')).toContain('doc-codes');
  });
  it('"鉴权失败" 命中鉴权文档', () => {
    expect(hitDocIds('鉴权失败')).toContain('doc-auth');
  });
});

describe('searchKbCore — API 符号 / 短码', () => {
  it('sdk.Init() 命中初始化文档', () => {
    expect(hitDocIds('sdk.Init()')).toContain('doc-init');
  });
  it('X-Api-Key 命中鉴权文档', () => {
    expect(hitDocIds('X-Api-Key')).toContain('doc-auth');
  });
  it('ERR_AUTH_FAILED 命中鉴权文档', () => {
    expect(hitDocIds('ERR_AUTH_FAILED')).toContain('doc-auth');
  });
  it('短错误码 404 命中错误码文档', () => {
    expect(hitDocIds('404')).toContain('doc-codes');
  });
  it('短错误码 E01 命中错误码文档', () => {
    expect(hitDocIds('E01')).toContain('doc-codes');
  });
  it('多级符号 xAxis.axisLabel.formatter 命中图表文档', () => {
    expect(hitDocIds('xAxis.axisLabel.formatter')).toContain('doc-chart');
  });
});

describe('searchKbCore — 结果结构与排序', () => {
  it('返回 content_raw（原文，非 tokenized）', () => {
    const r = searchKbCore(db, '鉴权失败', 5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const hit = r.results.find((x) => x.docId === 'doc-auth');
      expect(hit?.contentRaw).toContain('ERR_AUTH_FAILED');
      expect(hit?.docTitle).toBe('鉴权文档');
    }
  });
  it('topK 限制结果数', () => {
    const r = searchKbCore(db, '错误', 1);
    expect(r.ok && r.results.length).toBeLessThanOrEqual(1);
  });
});

describe('searchKbCore — 边界', () => {
  it('空查询 → INVALID_QUERY', () => {
    const r = searchKbCore(db, '', 5);
    expect(r).toEqual({ ok: false, code: 'INVALID_QUERY' });
  });
  it('无命中词返回空结果（非报错）', () => {
    const r = searchKbCore(db, 'zzzznonexistent', 5);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.results).toEqual([]);
  });
});
