/**
 * Unicode 感知的文本工具
 *
 * Feature 125: 基于 Intl.Segmenter 提供 CJK 友好的分段/截断/段落判定能力，
 * 替换按 ASCII 空格分词的遗留实现。
 *
 * 设计原则：
 * 1. Intl.Segmenter 是 ECMAScript Intl 标准（Node.js 16+ 原生支持）
 * 2. 若 Intl.Segmenter 不可用（极老环境），降级到基于标点的 regex 边界
 * 3. 所有函数都对空串、超短串、极端 maxLen 做合理边界处理
 */

/** 在运行时缓存 Intl.Segmenter 实例，避免每次调用都重建 */
const segmenterCache = new Map<string, Intl.Segmenter>();

/** 获取（并缓存）指定粒度的 Intl.Segmenter 实例 */
function getSegmenter(granularity: 'grapheme' | 'word' | 'sentence'): Intl.Segmenter | null {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
    return null;
  }
  const cached = segmenterCache.get(granularity);
  if (cached) return cached;
  try {
    const seg = new Intl.Segmenter(undefined, { granularity });
    segmenterCache.set(granularity, seg);
    return seg;
  } catch {
    return null;
  }
}

/**
 * 对 text 按粒度（word / sentence / grapheme）进行 Unicode 感知的分段，
 * 返回分段字符串数组。若 Intl.Segmenter 不可用，按空格分词作为降级。
 */
export function segmentText(
  text: string,
  granularity: 'grapheme' | 'word' | 'sentence' = 'word',
): string[] {
  if (!text) return [];
  const segmenter = getSegmenter(granularity);
  if (!segmenter) {
    // fallback：按空格或字符分
    if (granularity === 'grapheme') return [...text];
    return text.split(/\s+/).filter(Boolean);
  }
  const segments: string[] = [];
  for (const seg of segmenter.segment(text)) {
    segments.push(seg.segment);
  }
  return segments;
}

/** 自然断点字符集：英文标点 + 中文/日文标点 + 空格 */
const NATURAL_BOUNDARY_CHARS = new Set([
  ' ', '\t', '\n',
  // 英文标点
  ',', '.', ';', ':', '!', '?',
  // CJK 标点
  '，', '。', '、', '；', '：', '！', '？', '…', '—',
  // 括号/引号（作为弱边界）
  ')', '）', ']', '】', '}', '〉', '》',
]);

/**
 * 在文本 maxLen 字符附近，向左寻找最近的"自然断点"（标点/空格/词边界）
 * 用于截断长标题/长摘要，避免在单词或字符中间截断。
 *
 * 行为：
 *   - 若 text.length <= maxLen：原样返回，不加省略号
 *   - 若在 [maxLen*0.7, maxLen] 区间找到自然断点：在断点前截断 + 添加 "…"
 *   - 否则使用 Intl.Segmenter word boundary 的最近边界
 *   - 若 Segmenter 不可用：在 maxLen 硬截断 + "…"（最后降级）
 */
export function truncateAtNaturalBoundary(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text;
  const minCut = Math.floor(maxLen * 0.7);

  // Step 1: 寻找最近的自然断点字符
  for (let i = maxLen; i >= minCut; i--) {
    const ch = text[i];
    if (ch && NATURAL_BOUNDARY_CHARS.has(ch)) {
      // 跳过断点字符本身，保留前面的内容
      return `${text.slice(0, i).trimEnd()}…`;
    }
  }

  // Step 2: 使用 Intl.Segmenter word boundary 找最近词边界
  const segmenter = getSegmenter('word');
  if (segmenter) {
    let bestCut = -1;
    for (const seg of segmenter.segment(text)) {
      // seg.index 是该分段在原文中的起始偏移；词与词之间的边界就是起始位置
      if (seg.index > minCut && seg.index <= maxLen) {
        bestCut = seg.index;
      } else if (seg.index > maxLen) {
        break;
      }
    }
    if (bestCut > 0) {
      return `${text.slice(0, bestCut).trimEnd()}…`;
    }
  }

  // Step 3: 最终降级 — 按 maxLen 硬截断
  return `${text.slice(0, maxLen).trimEnd()}…`;
}

/**
 * 判断段落是否"链接密集型"（视觉上接近纯导航）。
 * 基于**字符数**比例（而非 word count），确保对无空格的 CJK 段落生效。
 *
 * 算法：
 *   - 计算段落中 Markdown 链接 `[text](url)` 的总字符数
 *   - linkCharCount / totalCharCount > threshold → 认为是链接密集
 */
export function isLinkHeavyParagraph(text: string, threshold = 0.5): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const linkPattern = /\[[^\]]*\]\([^)]+\)/g;
  let linkCharCount = 0;
  for (const match of trimmed.matchAll(linkPattern)) {
    linkCharCount += match[0].length;
  }
  if (linkCharCount === 0) return false;

  return linkCharCount / trimmed.length > threshold;
}

/**
 * 判断段落是否足够"描述性"（有实质内容、非 HTML block、非纯链接/badge）。
 * 这是 Feature 125 对 product-ux-docs 原 `isDescriptiveParagraph` 的 CJK 友好替换。
 *
 * 判定规则（全部满足才视为描述性）：
 *   1. 修剪后长度 >= minLength（默认 20 字符，不按 word count）
 *   2. 不以 HTML 开头（`<`）、Markdown 标题（`#`）、图片（`![`）、badge `|` 开头
 *   3. 链接字符占比 <= linkThreshold（不算纯导航）
 */
export function isDescriptiveText(
  text: string,
  options: { minLength?: number; linkThreshold?: number } = {},
): boolean {
  const minLength = options.minLength ?? 20;
  const linkThreshold = options.linkThreshold ?? 0.5;

  const trimmed = text.trim();
  if (trimmed.length < minLength) return false;
  if (trimmed.startsWith('#')) return false;
  if (trimmed.startsWith('<')) return false;
  if (trimmed.startsWith('![')) return false;
  if (trimmed.startsWith('|')) return false;
  if (isLinkHeavyParagraph(trimmed, linkThreshold)) return false;

  return true;
}
