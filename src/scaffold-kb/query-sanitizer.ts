/**
 * F190 scaffold-kb — FTS5 查询构造（结构化 token 列表，非整句拼接）
 *
 * 修 Codex CRITICAL-3 / C-6：
 * - 查询词过 normalizeForIndex 同一函数 → token 数组（已是纯字母数字/CJK token）
 * - 每个 token 独立双引号包裹（" → ""），消除 FTS5 操作符歧义 → 永不对整句加引号
 * - reserved words（OR/NOT/AND/NEAR）经 normalize 是普通 token，按字面查询，不是 INVALID
 * - 仅"空串/纯空白/normalize 后无任何 token"才 INVALID_QUERY
 */

import { tokenize } from './tokenizer.js';

export interface SanitizedQuery {
  ok: true;
  /** 规范化后的 token 列表（去重保序） */
  tokens: string[];
  /** FTS5 MATCH 表达式（每 token 双引号 + OR 连接） */
  match: string;
}

export interface SanitizeError {
  ok: false;
  code: 'INVALID_QUERY';
}

/** 将单个 token 包成 FTS5 安全短语（内部 " 转义为 ""） */
function quoteToken(token: string): string {
  return '"' + token.replace(/"/g, '""') + '"';
}

/**
 * 把用户查询构造为 FTS5 MATCH 表达式。
 * @param mode OR（召回优先，默认）| AND（精确优先）
 */
export function sanitizeQuery(
  query: string,
  mode: 'OR' | 'AND' = 'OR',
): SanitizedQuery | SanitizeError {
  const raw = tokenize(query);
  // 去重保序
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const t of raw) {
    if (!seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  }
  if (tokens.length === 0) {
    return { ok: false, code: 'INVALID_QUERY' };
  }
  const match = tokens.map(quoteToken).join(` ${mode} `);
  return { ok: true, tokens, match };
}
