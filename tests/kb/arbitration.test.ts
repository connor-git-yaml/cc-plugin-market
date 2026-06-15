/**
 * F192 T006 / SC-004 — 冲突仲裁档 A（R-ARB-2 全场景）
 */

import { describe, it, expect } from 'vitest';
import { arbitrateEntities, type ArbitrationInput } from '../../src/scaffold-kb/arbitration.js';

function ent(over: Partial<ArbitrationInput> = {}): ArbitrationInput {
  return {
    id: 'foo#function',
    name: 'foo',
    qualifiedName: 'foo',
    kind: 'function',
    signature: 'foo(a)',
    sourceDocId: 'd',
    sourceChunkId: 'c',
    lang: 'en',
    confidence: 0.7,
    extractionMethod: 'llm',
    sourceKind: 'vendor',
    timestamp: 'T1',
    ...over,
  };
}

function rec(out: ReturnType<typeof arbitrateEntities>) {
  return out.find((e) => e.arbitration?.recommended === true);
}

describe('arbitrateEntities — R-ARB-2', () => {
  it('confidence 主维占优 → 推荐高 confidence 项', () => {
    const out = arbitrateEntities([
      ent({ sourceKind: 'vendor', signature: 'foo(a)', confidence: 0.6 }),
      ent({ sourceKind: 'project', signature: 'foo(a,b)', confidence: 0.9 }),
    ]);
    expect(rec(out)?.sourceKind).toBe('project');
    expect(rec(out)?.arbitration?.groupId).toBe('foo#function');
  });

  it('版本匹配主维占优 → 推荐版本贴合 target 项', () => {
    const out = arbitrateEntities(
      [
        ent({ sourceKind: 'vendor', signature: 'foo(a)', sinceVersion: '1.0', confidence: 0.7 }),
        ent({ sourceKind: 'project', signature: 'foo(a,b)', sinceVersion: '2.0', confidence: 0.7 }),
      ],
      { targetSdkVersion: '2.0' },
    );
    expect(rec(out)?.sinceVersion).toBe('2.0');
  });

  it('各维并列（tie < ε）→ 不推荐，回退双呈现', () => {
    const out = arbitrateEntities([
      ent({ sourceKind: 'vendor', signature: 'foo(a)', confidence: 0.7 }),
      ent({ sourceKind: 'project', signature: 'foo(a,b)', confidence: 0.7 }),
    ]);
    expect(rec(out)).toBeUndefined();
    expect(out.every((e) => e.arbitration?.recommended === false)).toBe(true);
  });

  it('仅时效更新（confidence 相等、无版本）→ 不推荐（时效不可单独翻盘）', () => {
    const out = arbitrateEntities([
      ent({ sourceKind: 'vendor', signature: 'foo(a)', confidence: 0.7, timestamp: 'T1' }),
      ent({ sourceKind: 'project', signature: 'foo(a,b)', confidence: 0.7, timestamp: 'T9' }),
    ]);
    expect(rec(out)).toBeUndefined();
  });

  it('缺 confidence 维中性化 → 靠版本+confidence 决策（不因缺失即输）', () => {
    const out = arbitrateEntities(
      [
        ent({ sourceKind: 'vendor', signature: 'foo(a)', sinceVersion: '1.0', confidence: NaN }),
        ent({ sourceKind: 'project', signature: 'foo(a,b)', sinceVersion: '2.0', confidence: 0.9 }),
      ],
      { targetSdkVersion: '2.0' },
    );
    expect(rec(out)?.sourceKind).toBe('project');
  });

  it('缺 confidence + 无版本 + 同时间 → 不推荐（纯中性化，无主维可判，C-3）', () => {
    const out = arbitrateEntities([
      ent({ sourceKind: 'vendor', signature: 'foo(a)', confidence: NaN, timestamp: 'T1' }),
      ent({ sourceKind: 'project', signature: 'foo(a,b)', confidence: 0.7, timestamp: 'T1' }),
    ]);
    // project 有 confidence、vendor 缺失 → 不能据此压过未知，回退双呈现（不因缺失即输）
    expect(rec(out)).toBeUndefined();
  });

  it('无查询版本 → fallback 到 kbSdkVersion（版本维不形同虚设）', () => {
    const out = arbitrateEntities(
      [
        ent({ sourceKind: 'vendor', signature: 'foo(a)', sinceVersion: '1.0', confidence: 0.7 }),
        ent({ sourceKind: 'project', signature: 'foo(a,b)', sinceVersion: '3.0', confidence: 0.7 }),
      ],
      { kbSdkVersion: '3.0' },
    );
    expect(rec(out)?.sinceVersion).toBe('3.0');
  });

  it('非冲突：单库命中 → 不标 arbitration', () => {
    const out = arbitrateEntities([ent({ sourceKind: 'vendor' })]);
    expect(out[0]!.arbitration).toBeUndefined();
  });

  it('非冲突：两库同 id 且属性一致 → 不标 arbitration', () => {
    const out = arbitrateEntities([
      ent({ sourceKind: 'vendor', signature: 'foo(a)', confidence: 0.7 }),
      ent({ sourceKind: 'project', signature: 'foo(a)', confidence: 0.7 }),
    ]);
    expect(out.every((e) => e.arbitration === undefined)).toBe(true);
  });
});
