/**
 * F191 — CJK 感知关键词提取（spectra 侧，复用 tokenize；供 scaffold-kb query 用）
 *
 * 处理中文需求（无空格）：tokenize 切词 → 去停用词 → bigram/符号优先、单字降权 →
 * top-N 空格拼接（不含 OR，OR 由 sanitizeQuery 负责）。空 → 整句 surrogate-safe 截断 fallback。
 */

import { tokenize } from './tokenizer.js';
import { safeTruncate } from './evidence-envelope.js';

/** 内置中英停用词小表（不引外部 NLP 依赖） */
const STOPWORDS = new Set<string>([
  // 中文（单字/常见虚词）
  '的', '了', '和', '与', '是', '在', '我', '你', '他', '她', '它', '们', '有', '这', '那',
  '个', '为', '把', '被', '让', '给', '到', '从', '对', '中', '上', '下', '里', '就', '都',
  '要', '会', '能', '可', '以', '及', '或', '一', '需', '求', '做', '用',
  // 英文
  'the', 'a', 'an', 'of', 'to', 'and', 'or', 'is', 'are', 'be', 'in', 'on', 'for', 'with',
  'as', 'by', 'at', 'it', 'this', 'that', 'we', 'i', 'you', 'add', 'use', 'using', 'want',
]);

export interface ExtractOptions {
  topN?: number;
  fallbackChars?: number;
}

/** 一个 token 是否单字（单个 CJK 字或单个 ASCII 字符）→ 降权，避免高频单字放大噪声 */
function isUnigram(token: string): boolean {
  return Array.from(token).length <= 1;
}

/**
 * 从需求文本提取空格拼接的关键词串。
 * @returns 关键词串（空格分隔）；若提取为空则整句前 N 字符 fallback
 */
export function extractKeywords(text: string, opts: ExtractOptions = {}): string {
  const topN = opts.topN ?? 8;
  const fallbackChars = opts.fallbackChars ?? 64;

  const tokens = tokenize(text);
  // 累计权重分：weight(bigram/符号=1.0, 单字=0.3) × 频次
  const score = new Map<string, number>();
  for (const t of tokens) {
    if (STOPWORDS.has(t) || STOPWORDS.has(t.toLowerCase())) continue;
    const weight = isUnigram(t) ? 0.3 : 1.0;
    score.set(t, (score.get(t) ?? 0) + weight);
  }

  const ranked = [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) // 分数降序，平局按字典序稳定
    .slice(0, topN)
    .map(([token]) => token);

  if (ranked.length === 0) {
    // 整句 fallback（surrogate-safe，不切代理对）
    return safeTruncate(text.trim(), fallbackChars);
  }
  return ranked.join(' ');
}
