/**
 * F192 T007 — entity-matcher 精确/模糊/过滤/top-N
 */

import { describe, it, expect } from 'vitest';
import { matchEntities } from '../../src/scaffold-kb/entity-matcher.js';
import type { ApiEntity } from '../../src/scaffold-kb/types.js';

function ent(over: Partial<ApiEntity> & { name: string }): ApiEntity {
  return {
    id: `${over.qualifiedName ?? over.name}#${over.kind ?? 'function'}`,
    qualifiedName: over.name,
    kind: 'function',
    sourceDocId: 'd',
    sourceChunkId: 'c',
    lang: 'en',
    confidence: 0.8,
    extractionMethod: 'llm',
    ...over,
  };
}

const ENTS: ApiEntity[] = [
  ent({ name: 'createChart', qualifiedName: 'echarts.createChart' }),
  ent({ name: 'setOption', qualifiedName: 'Chart.setOption', kind: 'method', container: 'Chart' }),
  ent({ name: 'setOption', qualifiedName: 'Series.setOption', kind: 'method', container: 'Series' }),
  ent({ name: 'dispose', qualifiedName: 'Chart.dispose', kind: 'method', container: 'Chart' }),
  ent({ name: 'INVALID_OPTION', kind: 'error_code' }),
];

describe('matchEntities', () => {
  it('精确匹配 name', () => {
    const m = matchEntities(ENTS, { apiName: 'createChart' });
    expect(m[0]?.matchType).toBe('exact');
    expect(m[0]?.name).toBe('createChart');
  });

  it('精确匹配 qualified_name 末段', () => {
    const m = matchEntities(ENTS, { apiName: 'echarts.createChart' });
    expect(m[0]?.matchType).toBe('exact');
  });

  it('container 过滤消歧同名方法', () => {
    const m = matchEntities(ENTS, { apiName: 'setOption', container: 'Series' });
    expect(m).toHaveLength(1);
    expect(m[0]?.container).toBe('Series');
  });

  it('kind 过滤', () => {
    const m = matchEntities(ENTS, { apiName: 'INVALID_OPTION', kind: 'error_code' });
    expect(m[0]?.kind).toBe('error_code');
    const none = matchEntities(ENTS, { apiName: 'INVALID_OPTION', kind: 'function' });
    expect(none).toHaveLength(0);
  });

  it('同名多命中（无 container）→ 返回多个候选', () => {
    const m = matchEntities(ENTS, { apiName: 'setOption' });
    expect(m.length).toBeGreaterThanOrEqual(2);
    expect(m.every((e) => e.name === 'setOption')).toBe(true);
  });

  it('模糊子串匹配', () => {
    const m = matchEntities(ENTS, { apiName: 'Option' });
    const names = m.map((e) => e.name);
    expect(names).toContain('setOption');
  });

  it('topN 限制', () => {
    const m = matchEntities(ENTS, { apiName: 'setOption', topN: 1 });
    expect(m).toHaveLength(1);
  });

  it('无匹配 → 空', () => {
    expect(matchEntities(ENTS, { apiName: 'nonexistentApiXyz' })).toEqual([]);
  });

  it('空查询 → 空', () => {
    expect(matchEntities(ENTS, { apiName: '  ' })).toEqual([]);
  });
});
