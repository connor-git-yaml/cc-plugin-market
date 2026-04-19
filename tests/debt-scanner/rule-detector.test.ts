/**
 * rule-detector 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  hasExplicitMarker,
  endsWithQuestionMark,
  makeSnippet,
} from '../../src/debt-scanner/design-docs/rule-detector.js';

describe('hasExplicitMarker', () => {
  it.each([
    ['contains TBD marker', true],
    ['中文：暂时待定', true],
    ['This is open question', true],
    ['We have open questions here', true],
    ['tradeoff detected', true],
    ['consider trade-off', true],
    ['totally innocuous paragraph', false],
  ])('%s → %s', (text, expected) => {
    expect(hasExplicitMarker(text)).toBe(expected);
  });

  it('heading path 包含 "Open Questions" 时命中', () => {
    expect(hasExplicitMarker('some text', '## Open Questions')).toBe(true);
  });

  it('heading path 包含 "Trade-offs" 时命中', () => {
    expect(hasExplicitMarker('some text', '### Trade-offs')).toBe(true);
  });
});

describe('endsWithQuestionMark', () => {
  it('英文 ?', () => {
    expect(endsWithQuestionMark('what is it?')).toBe(true);
  });
  it('中文 ？', () => {
    expect(endsWithQuestionMark('怎么办？')).toBe(true);
  });
  it('尾部空白依然识别', () => {
    expect(endsWithQuestionMark('why?  ')).toBe(true);
  });
  it('非问号不命中', () => {
    expect(endsWithQuestionMark('normal sentence.')).toBe(false);
  });
});

describe('makeSnippet', () => {
  it('折叠换行与多空格', () => {
    expect(makeSnippet('line1\n\n  line2')).toBe('line1 line2');
  });

  it('超过 400 字符截断加省略号', () => {
    const long = 'a'.repeat(500);
    const s = makeSnippet(long);
    expect(s.length).toBeLessThanOrEqual(400);
    expect(s.endsWith('…')).toBe(true);
  });
});
