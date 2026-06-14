/**
 * F190 T005 — normalizeForIndex / tokenize 规范化行为（写入↔查询同构）
 *
 * 覆盖：CJK unigram+bigram、ASCII 符号组件+拼接形、短码、中英混合、
 * 以及固定符号集的碰撞快照（完整 fixture 级碰撞率审计在 ECharts 构建后单列）。
 */

import { describe, it, expect } from 'vitest';
import { tokenize, normalizeForIndex } from '../../src/scaffold-kb/tokenizer.js';

describe('tokenize — CJK', () => {
  it('中文词产出 unigram + bigram', () => {
    expect(tokenize('错误码')).toEqual(['错', '误', '码', '错误', '误码']);
  });

  it('单字只产 unigram', () => {
    expect(tokenize('错')).toEqual(['错']);
  });

  it('两字词产 unigram + 一个 bigram', () => {
    expect(tokenize('鉴权')).toEqual(['鉴', '权', '鉴权']);
  });
});

describe('tokenize — ASCII 符号（核心三例同构快照）', () => {
  it('sdk.Init() → 组件 + 拼接形', () => {
    expect(tokenize('sdk.Init()')).toEqual(['sdk', 'Init', 'sdkInit']);
  });

  it('X-Api-Key → 组件 + 拼接形', () => {
    expect(tokenize('X-Api-Key')).toEqual(['X', 'Api', 'Key', 'XApiKey']);
  });

  it('ERR_AUTH_FAILED → 组件 + 拼接形', () => {
    expect(tokenize('ERR_AUTH_FAILED')).toEqual(['ERR', 'AUTH', 'FAILED', 'ERRAUTHFAILED']);
  });

  it('多级符号 xAxis.axisLabel.formatter', () => {
    expect(tokenize('xAxis.axisLabel.formatter')).toEqual([
      'xAxis',
      'axisLabel',
      'formatter',
      'xAxisaxisLabelformatter',
    ]);
  });
});

describe('tokenize — 短码与纯词', () => {
  it('短错误码 E01 原样单 token', () => {
    expect(tokenize('E01')).toEqual(['E01']);
  });

  it('数字码 404 原样单 token', () => {
    expect(tokenize('404')).toEqual(['404']);
  });

  it('纯英文词原样', () => {
    expect(tokenize('hello')).toEqual(['hello']);
  });
});

describe('tokenize — 中英混合', () => {
  it('CJK 段与 ASCII 符号段分别处理后拼接', () => {
    const out = tokenize('鉴权失败 ERR_AUTH_FAILED');
    // CJK 段
    expect(out).toContain('鉴权');
    expect(out).toContain('失败');
    // ASCII 符号段
    expect(out).toContain('ERR');
    expect(out).toContain('ERRAUTHFAILED');
  });

  it('normalizeForIndex 是 tokenize 的空格拼接', () => {
    const t = '错误码 sdk.Init()';
    expect(normalizeForIndex(t)).toBe(tokenize(t).join(' '));
  });
});

describe('tokenize — 边界', () => {
  it('空串 → 空数组', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  it('纯标点/分隔符 → 空数组', () => {
    expect(tokenize('，。！（）')).toEqual([]);
    expect(tokenize('--- / @')).toEqual([]);
  });
});

describe('固定符号集碰撞快照（T005：完整 fixture 级审计见 ECharts 构建后）', () => {
  it('已知易碰撞对的拼接形仍可区分', () => {
    // 不同原符号 normalize 后拼接形不应折叠成同一个（除非语义本就相同）
    const joinedForm = (s: string): string => {
      const toks = tokenize(s);
      return toks[toks.length - 1] ?? '';
    };
    const a = joinedForm('xAxis.axisLabel'); // xAxisaxisLabel
    const b = joinedForm('xAxis.axisLine'); // xAxisaxisLine
    expect(a).not.toBe(b);
  });
});
