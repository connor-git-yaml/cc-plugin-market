/**
 * F191 — extractKeywords：CJK 感知 + 停用词 + bigram/符号优先 + fallback
 */

import { describe, it, expect } from 'vitest';
import { extractKeywords } from '../../src/scaffold-kb/keyword-extract.js';

describe('extractKeywords — 中文需求', () => {
  it('返回空格拼接关键词串（不含 OR），命中核心词', () => {
    const kw = extractKeywords('为知识库检索增加中文分词支持');
    expect(kw).not.toContain(' OR '); // 不生成 OR 表达式（C3）
    expect(kw.length).toBeGreaterThan(0);
    // bigram 核心词应入选
    expect(kw).toMatch(/检索|分词|知识/);
  });

  it('停用词被过滤（的/了/是 不出现为独立词）', () => {
    const kw = extractKeywords('这是一个用于检索的功能');
    const words = kw.split(' ');
    expect(words).not.toContain('的');
    expect(words).not.toContain('是');
  });

  it('bigram 优先于单字（单字降权）', () => {
    // "检索检索检索" → bigram "检索" 频次高于单字
    const kw = extractKeywords('检索检索检索功能');
    expect(kw.split(' ')[0]).toBe('检索'); // bigram 排首位
  });
});

describe('extractKeywords — 英文需求', () => {
  it('过滤英文停用词，保留实义词', () => {
    const kw = extractKeywords('add authentication middleware to the router');
    const words = kw.split(' ');
    expect(words).not.toContain('the');
    expect(words).not.toContain('to');
    expect(kw).toMatch(/authentication|middleware|router/);
  });
});

describe('extractKeywords — fallback（EC-003）', () => {
  it('无存活 token（单停用字）→ 整句 fallback', () => {
    // 单字 '的'：tokenize→['的']→停用词过滤后空→fallback 返回整句
    const kw = extractKeywords('的', { fallbackChars: 64 });
    expect(kw).toBe('的');
  });

  it('纯标点 → tokenize 空 → fallback 返回整句（截断）', () => {
    const kw = extractKeywords('？！。', { fallbackChars: 64 });
    expect(kw).toBe('？！。');
  });

  it('空串 → 空 fallback', () => {
    expect(extractKeywords('   ')).toBe('');
  });

  it('topN 限制关键词数', () => {
    const kw = extractKeywords('认证 鉴权 检索 分词 索引 缓存 配置 错误 日志 监控 部署', { topN: 3 });
    expect(kw.split(' ').length).toBeLessThanOrEqual(3);
  });
});
