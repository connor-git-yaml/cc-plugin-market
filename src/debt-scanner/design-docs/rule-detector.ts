/**
 * Design-doc open question 规则检测
 *
 * 两种命中路径（AC-2.2）：
 * 1. 显式标记：段落包含 TBD、待定、open question(s)、tradeoff/trade-off 之一
 * 2. 疑问句：段落（或 heading 下的子段落）以 `?` 或 `？` 结尾
 *
 * 显式命中直接进入 "rule" source；问号命中为 LLM 仲裁候选。
 */

const EXPLICIT_KEYWORDS = [
  'tbd',
  '待定',
  'open question',
  'open questions',
  'tradeoff',
  'trade-off',
];

/** 是否显式命中（大小写不敏感） */
export function hasExplicitMarker(text: string, headingPath?: string): boolean {
  const lower = text.toLowerCase();
  if (EXPLICIT_KEYWORDS.some((k) => lower.includes(k))) return true;
  if (headingPath) {
    const h = headingPath.toLowerCase();
    if (/open\s*question/.test(h)) return true;
    if (/trade[-\s]*off/.test(h)) return true;
    if (/\btbd\b/.test(h)) return true;
  }
  return false;
}

/** 是否以问号结尾（兼容英文 ? 和中文 ？） */
export function endsWithQuestionMark(text: string): boolean {
  const t = text.trimEnd();
  return t.endsWith('?') || t.endsWith('？');
}

/**
 * 限制 snippet 最大 400 字符。
 */
export function makeSnippet(text: string, max = 400): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
