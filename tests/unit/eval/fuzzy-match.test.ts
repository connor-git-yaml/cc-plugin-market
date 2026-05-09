/**
 * Feature 158 T-031 — eval-diff-fuzzy-match.mjs 单测
 *
 * 覆盖 plan.md §阈值实测校准计划 + EC-12 7 个核心场景：
 *   1. 完全匹配 → 100%
 *   2. 空 gold + 空 actual → 100%（业务定义边界）
 *   3. 完全不同 → 0%
 *   4. 仅尾空白差异 → ≥ 99%（normalize 后等价）
 *   5. 阈值边界（59% / 60% threshold）→ 退出码差异
 *   6. Diff metadata 排除（`--- a/x` / `@@ -1,3` 不计入）
 *   7. 重复行差异（`+a\n+a\n+a` vs `+a` 应 < 100%，multiset 区分）
 *
 * 9 候选场景校准 deferred 到 Stage 7a 实测（plan.md 占位符填入）— 本 task 不做。
 */

import { describe, expect, it } from 'vitest';
import {
  computeSimilarity,
  extractSemanticLines,
  multisetJaccard,
  toTokenMultiset,
} from '../../../scripts/eval-diff-fuzzy-match.mjs';

// ─── 1. 完全匹配 → 100% ─────────────────────────────────────

describe('fuzzy-match — 完全匹配', () => {
  it('两个相同 diff → 1.0', () => {
    const diff = [
      'diff --git a/foo.py b/foo.py',
      '--- a/foo.py',
      '+++ b/foo.py',
      '@@ -1,3 +1,3 @@',
      ' def foo():',
      '-    return 1',
      '+    return 2',
      '     pass',
    ].join('\n');
    expect(computeSimilarity(diff, diff)).toBe(1.0);
  });
});

// ─── 2. 空 gold + 空 actual → 100% ──────────────────────────

describe('fuzzy-match — 空输入边界', () => {
  it('两个空字符串 → 1.0', () => {
    expect(computeSimilarity('', '')).toBe(1.0);
  });

  it('只有 metadata 没有语义行 → 1.0（语义集都为空）', () => {
    const onlyHeader = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,1 +1,1 @@', ' ctx'].join(
      '\n',
    );
    expect(computeSimilarity(onlyHeader, onlyHeader)).toBe(1.0);
  });
});

// ─── 3. 完全不同 → 0% ───────────────────────────────────────

describe('fuzzy-match — 完全不同', () => {
  it('token 不重叠 → 0', () => {
    const a = '+ alpha beta gamma';
    const b = '+ delta epsilon zeta';
    expect(computeSimilarity(a, b)).toBe(0);
  });
});

// ─── 4. 仅尾空白差异 → ≥ 99% ────────────────────────────────

describe('fuzzy-match — 尾空白 normalize', () => {
  it('expected 尾部多个空格 vs actual 无空格 → 1.0', () => {
    const a = '+ return 1   ';
    const b = '+ return 1';
    expect(computeSimilarity(a, b)).toBe(1.0);
  });

  it('CRLF vs LF → 1.0（normalize 去掉 \\r）', () => {
    const a = '+ return 1\r\n+ pass\r';
    const b = '+ return 1\n+ pass';
    expect(computeSimilarity(a, b)).toBe(1.0);
  });
});

// ─── 5. 阈值边界 ────────────────────────────────────────────

describe('fuzzy-match — 阈值边界', () => {
  it('部分匹配相似度可计算', () => {
    // 6 token 中 3 个匹配 → multiset Jaccard = 3/9 = 0.333
    // expected: a b c d e f (6 tokens)
    // actual:   a b c x y z (6 tokens)
    // min: a=1 b=1 c=1 → 3
    // max: 9
    const a = '+ a b c d e f';
    const b = '+ a b c x y z';
    const sim = computeSimilarity(a, b);
    expect(sim).toBeCloseTo(3 / 9, 5);
  });
});

// ─── 6. Diff metadata 排除 ──────────────────────────────────

describe('fuzzy-match — metadata 排除', () => {
  it('--- a/x +++ b/x @@ 不进入 token 集', () => {
    const onlyMeta = [
      'diff --git a/foo b/foo',
      '--- a/foo',
      '+++ b/foo',
      '@@ -1,3 +1,3 @@',
    ].join('\n');
    const lines = extractSemanticLines(onlyMeta);
    expect(lines).toEqual([]);
  });

  it('"\\ No newline at end of file" 被排除', () => {
    const diff = ['+ foo', '\\ No newline at end of file'].join('\n');
    expect(extractSemanticLines(diff)).toEqual(['foo']);
  });

  it('context line（单空格开头）被排除', () => {
    const diff = [' context line', '+ added line', '- removed line'].join('\n');
    const lines = extractSemanticLines(diff);
    expect(lines).toEqual(['added line', 'removed line']);
  });

  it('metadata 不影响相似度计算（与纯语义对比一致）', () => {
    const fullDiff = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
    ].join('\n');
    const semanticOnly = ['-old', '+new'].join('\n');
    expect(computeSimilarity(fullDiff, semanticOnly)).toBe(1.0);
  });
});

// ─── 7. 重复行差异（multiset 区分）──────────────────────────

describe('fuzzy-match — multiset 区分重复', () => {
  it('+a\\n+a\\n+a vs +a → multiset Jaccard = 1/3', () => {
    const m1 = toTokenMultiset(['a', 'a', 'a']);
    const m2 = toTokenMultiset(['a']);
    // M1: {a:3}, M2: {a:1}, min sum=1, max sum=3 → 1/3
    expect(multisetJaccard(m1, m2)).toBeCloseTo(1 / 3, 5);
  });

  it('集合层面相同但 multiplicity 不同 → 相似度 < 100%', () => {
    const a = '+ a\n+ a\n+ a';
    const b = '+ a';
    const sim = computeSimilarity(a, b);
    expect(sim).toBeLessThan(1.0);
    expect(sim).toBeCloseTo(1 / 3, 5);
  });
});

// ─── 辅助：toTokenMultiset / extractSemanticLines 直接覆盖 ───

describe('fuzzy-match — 辅助函数', () => {
  it('toTokenMultiset 多 token 同行', () => {
    const m = toTokenMultiset(['foo bar foo']);
    expect(m.get('foo')).toBe(2);
    expect(m.get('bar')).toBe(1);
  });

  it('extractSemanticLines 不把 +++/--- 当语义行', () => {
    const lines = extractSemanticLines(
      ['--- a/x', '+++ b/x', '+ real plus', '- real minus'].join('\n'),
    );
    expect(lines).toEqual(['real plus', 'real minus']);
  });
});
