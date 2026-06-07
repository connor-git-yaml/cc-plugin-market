/**
 * string-distance 单元测试（Feature 178 RED）
 *
 * 锁定 levenshtein 编辑距离的行为契约——本实现由 query-helpers.ts 与
 * adr-evidence-verifier.ts 两份逐字重复的私有副本合并而来，提取后两调用方共享。
 * 这些用例保证抽取为单一来源后 DP 数值结果零变化（F174 fuzzy 热路径不回归）。
 */
import { describe, it, expect } from 'vitest';
import { levenshtein } from '../../src/utils/string-distance.js';

describe('levenshtein — 边界条件', () => {
  it('两空串距离为 0', () => {
    expect(levenshtein('', '')).toBe(0);
  });

  it('一侧为空串时距离等于另一侧长度', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('完全相同的串距离为 0', () => {
    expect(levenshtein('kitten', 'kitten')).toBe(0);
    expect(levenshtein('a', 'a')).toBe(0);
  });

  it('单字符替换距离为 1', () => {
    expect(levenshtein('a', 'b')).toBe(1);
  });
});

describe('levenshtein — DP 正确性（经典样例）', () => {
  it('kitten ↔ sitting = 3', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('flaw ↔ lawn = 2', () => {
    expect(levenshtein('flaw', 'lawn')).toBe(2);
  });

  it('intention ↔ execution = 5', () => {
    expect(levenshtein('intention', 'execution')).toBe(5);
  });

  it('大小写敏感（Value vs value = 1）', () => {
    expect(levenshtein('Value', 'value')).toBe(1);
  });
});

describe('levenshtein — 对称性 / 长度差不变性', () => {
  it('lev(a,b) === lev(b,a)（短/长内外层切换不影响结果）', () => {
    expect(levenshtein('sitting', 'kitten')).toBe(levenshtein('kitten', 'sitting'));
    expect(levenshtein('abcdefgh', 'xyz')).toBe(levenshtein('xyz', 'abcdefgh'));
  });

  it('长串差异仍给出精确编辑距离（剪枝不改变结果）', () => {
    const a = 'engine.py::Value.__add__';
    const b = 'engine.py::Value.__mul__';
    // 仅 `add` → `mul` 三字符替换
    expect(levenshtein(a, b)).toBe(3);
  });
});
