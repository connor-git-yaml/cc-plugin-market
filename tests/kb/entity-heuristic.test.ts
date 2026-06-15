/**
 * F192 T003 — entity-heuristic 确定性抽取 + entity-util
 */

import { describe, it, expect } from 'vitest';
import { extractHeuristic } from '../../src/scaffold-kb/entity-heuristic.js';
import { makeEntityId, clampConfidence } from '../../src/scaffold-kb/entity-util.js';
import type { ExtractionSection } from '../../src/scaffold-kb/types.js';

function section(text: string, over: Partial<ExtractionSection> = {}): ExtractionSection {
  return { docId: 'd1', anchor: 'a1', lang: 'en', chunkIds: ['d1#a1'], text, ...over };
}

describe('entity-util', () => {
  it('makeEntityId 归一（大小写/空白无关）', () => {
    expect(makeEntityId('Echarts.Init', 'function')).toBe(makeEntityId('echarts.init', 'function'));
  });
  it('makeEntityId overload_key 区分重载', () => {
    const a = makeEntityId('foo', 'method', '(a)');
    const b = makeEntityId('foo', 'method', '(a,b)');
    expect(a).not.toBe(b);
  });
  it('clampConfidence 越界裁剪 + 非数值 fallback', () => {
    expect(clampConfidence(1.5)).toBe(1);
    expect(clampConfidence(-0.2)).toBe(0);
    expect(clampConfidence('x', 0.5)).toBe(0.5);
    expect(clampConfidence(0.7)).toBe(0.7);
  });
});

describe('extractHeuristic', () => {
  it('抽取函数签名 + 参数', () => {
    const ents = extractHeuristic(section('调用 `createChart(dom, options)` 创建实例。'));
    const fn = ents.find((e) => e.name === 'createChart');
    expect(fn).toBeDefined();
    expect(fn!.kind).toBe('function');
    expect(fn!.extractionMethod).toBe('heuristic');
    expect(fn!.confidence).toBe(0.5);
    expect(fn!.params?.map((p) => p.name)).toEqual(['dom', 'options']);
    expect(fn!.sourceChunkId).toBe('d1#a1');
  });

  it('抽取 name: type 形式参数类型', () => {
    const ents = extractHeuristic(section('def setOption(option: object, notMerge: boolean)'));
    const fn = ents.find((e) => e.name === 'setOption');
    expect(fn?.params?.[0]).toMatchObject({ name: 'option', type: 'object' });
  });

  it('抽取错误码', () => {
    const ents = extractHeuristic(section('返回 E1001 或 INVALID_OPTION_ERROR 表示失败。'));
    const codes = ents.filter((e) => e.kind === 'error_code').map((e) => e.name);
    expect(codes).toContain('E1001');
    expect(codes).toContain('INVALID_OPTION_ERROR');
  });

  it('deprecated 标记 → 实体标废弃', () => {
    const ents = extractHeuristic(section('`oldApi(x)` 已废弃，请改用新接口。'));
    const fn = ents.find((e) => e.name === 'oldApi');
    expect(fn?.deprecated?.isDeprecated).toBe(true);
  });

  it('deprecated since 版本提取', () => {
    const ents = extractHeuristic(section('`legacyFn(a)` deprecated since 2.0'));
    const fn = ents.find((e) => e.name === 'legacyFn');
    expect(fn?.deprecated).toMatchObject({ isDeprecated: true, since: '2.0' });
  });

  it('过滤控制流噪声名（if/for/return 不入实体）', () => {
    const ents = extractHeuristic(section('if (x) { return foo(); } for (i) {}'));
    const names = ents.map((e) => e.name);
    expect(names).not.toContain('if');
    expect(names).not.toContain('for');
    expect(names).not.toContain('return');
  });

  it('空/无 API 文本 → 空（不编造）', () => {
    expect(extractHeuristic(section('这是一段没有任何接口的普通说明文字。'))).toEqual([]);
  });

  it('同名签名去重（一个 section 内）', () => {
    const ents = extractHeuristic(section('`foo(a)` ... 再次 `foo(a)` 。'));
    expect(ents.filter((e) => e.name === 'foo')).toHaveLength(1);
  });
});
