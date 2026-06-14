/**
 * F190 T036 — result-merger：BM25 归一方向 + 每库下限 + 冲突双呈现
 */

import { describe, it, expect } from 'vitest';
import type { CoreResult } from '../../src/scaffold-kb/search-core.js';
import { mergeResults } from '../../src/kb-mcp/lib/result-merger.js';

function res(chunkId: string, docId: string, score: number, raw = ''): CoreResult {
  return {
    chunkId, docId, contentRaw: raw || `内容 ${chunkId}`, docTitle: docId,
    anchor: null, sourceUrl: null, sdkVersion: null, builtAt: 'B', score, via: 'fts',
  };
}

describe('mergeResults — BM25 排序方向（防 Codex C-6 回归）', () => {
  it('bm25 越负越相关 → 最相关 chunk 排第 1', () => {
    // score: -5 最相关, -0.5 最不相关
    const vendor = [res('a', 'da', -0.5), res('b', 'db', -5), res('c', 'dc', -2)];
    const merged = mergeResults(vendor, [], 5);
    expect(merged[0]?.chunkId).toBe('b'); // -5 最相关排首位
    expect(merged[0]?.scoreNorm).toBeCloseTo(1.0, 5);
  });
});

describe('mergeResults — 每库候选下限', () => {
  it('top_k≥2 两库均有命中 → 每库各 ≥1 条', () => {
    // vendor 分数都更相关，project 较弱；若无下限保障，project 会被挤出
    const vendor = [res('v1', 'dv1', -10), res('v2', 'dv2', -9), res('v3', 'dv3', -8), res('v4', 'dv4', -7)];
    const project = [res('p1', 'dp1', -1)];
    const merged = mergeResults(vendor, project, 5);
    const kinds = new Set(merged.map((r) => r.sourceKind));
    expect(kinds.has('vendor')).toBe(true);
    expect(kinds.has('project')).toBe(true); // 项目库未被挤出
  });

  it('top_k=1 → 全局最高 1 条（双呈现不适用，合法降级）', () => {
    const vendor = [res('v1', 'dv1', -10)];
    const project = [res('p1', 'dp1', -1)];
    const merged = mergeResults(vendor, project, 1);
    expect(merged.length).toBe(1);
    expect(merged[0]?.sourceKind).toBe('vendor'); // -10 更相关
  });
});

describe('mergeResults — 冲突双呈现（EC-005）', () => {
  it('两库对同一主题矛盾内容均出现，source_kind 区分', () => {
    const vendor = [res('x', 'apiX', -5, 'API X 返回 string')];
    const project = [res('x', 'apiX', -5, 'API X 某版本适配后返回 object')];
    const merged = mergeResults(vendor, project, 5);
    expect(merged.length).toBe(2); // 双呈现，不因同 chunkId 被去重
    const byKind = merged.map((r) => r.sourceKind).sort();
    expect(byKind).toEqual(['project', 'vendor']);
    const contents = merged.map((r) => r.contentRaw);
    expect(contents.some((c) => c.includes('string'))).toBe(true);
    expect(contents.some((c) => c.includes('object'))).toBe(true);
  });
});

describe('mergeResults — 单库降级', () => {
  it('项目库为空 → 仅厂商库结果，不崩溃', () => {
    const merged = mergeResults([res('v1', 'dv1', -3), res('v2', 'dv2', -1)], [], 5);
    expect(merged.length).toBe(2);
    expect(merged.every((r) => r.sourceKind === 'vendor')).toBe(true);
  });

  it('两库皆空 → 空结果', () => {
    expect(mergeResults([], [], 5)).toEqual([]);
  });
});
