/**
 * F190 — query-sanitizer：结构化 token + reserved word 消歧（Codex C-6）
 */

import { describe, it, expect } from 'vitest';
import { sanitizeQuery } from '../../src/scaffold-kb/query-sanitizer.js';

describe('sanitizeQuery — 符号查询', () => {
  it('sdk.Init() → 组件 token，每 token 双引号 OR 连接', () => {
    const r = sanitizeQuery('sdk.Init()');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tokens).toEqual(['sdk', 'Init', 'sdkInit']);
      expect(r.match).toBe('"sdk" OR "Init" OR "sdkInit"');
    }
  });

  it('X-Api-Key → 组件 + 拼接形', () => {
    const r = sanitizeQuery('X-Api-Key');
    expect(r.ok && r.match).toBe('"X" OR "Api" OR "Key" OR "XApiKey"');
  });
});

describe('sanitizeQuery — reserved word 按字面（不是 INVALID）', () => {
  it('OR NOT AND 被当普通 token 字面查询', () => {
    const r = sanitizeQuery('OR NOT AND');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tokens).toEqual(['OR', 'NOT', 'AND']);
      // 每个都被双引号包裹 → FTS5 不会把它们当操作符
      expect(r.match).toBe('"OR" OR "NOT" OR "AND"');
    }
  });

  it('NEAR/5 被拆为字面 token，不作 NEAR 操作符', () => {
    const r = sanitizeQuery('NEAR/5 error');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tokens).toContain('NEAR');
  });
});

describe('sanitizeQuery — INVALID_QUERY 仅限无 token', () => {
  it('空串 → INVALID_QUERY', () => {
    expect(sanitizeQuery('')).toEqual({ ok: false, code: 'INVALID_QUERY' });
  });
  it('纯空白 → INVALID_QUERY', () => {
    expect(sanitizeQuery('   ')).toEqual({ ok: false, code: 'INVALID_QUERY' });
  });
  it('纯标点/分隔符（normalize 后无 token）→ INVALID_QUERY', () => {
    expect(sanitizeQuery('，。！（）')).toEqual({ ok: false, code: 'INVALID_QUERY' });
  });
});

describe('sanitizeQuery — CJK', () => {
  it('中文查询展开 unigram + bigram', () => {
    const r = sanitizeQuery('错误');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tokens).toEqual(['错', '误', '错误']);
  });
});
