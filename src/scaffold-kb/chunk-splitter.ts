/**
 * F190 scaffold-kb — chunk-splitter
 *
 * 将 ParsedDoc 按三级策略切分为 Chunk[]:
 *   1. 标题级（## / ###）— 每个标题节为候选单元
 *   2. 段落级（\n\n）— 超 400 token 候选按空行切段，组合到接近 400 token
 *   3. 句子级兜底（句号 / 换行）— 单段落超 400 token 时切
 *
 * token 计量：约 4 字符 = 1 token（无外部依赖）
 * 单 chunk 上限：500 token（≈ 2000 字符）
 * 最小 chunk：20 token（≈ 80 字符），不足则合并到邻近
 */

import type { Chunk, ParsedDoc } from './types.js';

// ── 常量 ────────────────────────────────────────────────────────────────────

/** 约 4 字符 = 1 token 的估算系数 */
const CHARS_PER_TOKEN = 4;

/** 段落级再切阈值（token）— 超过此值的标题节需要继续切 */
const PARAGRAPH_SPLIT_THRESHOLD_TOKENS = 400;

/** 单 chunk 上限（token） */
const MAX_CHUNK_TOKENS = 500;

/** 最小 chunk 阈值（token）— 不足此值合并到邻近 */
const MIN_CHUNK_TOKENS = 20;

// 阈值对应字符数
const PARAGRAPH_SPLIT_THRESHOLD_CHARS = PARAGRAPH_SPLIT_THRESHOLD_TOKENS * CHARS_PER_TOKEN; // 1600
const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * CHARS_PER_TOKEN; // 2000
const MIN_CHUNK_CHARS = MIN_CHUNK_TOKENS * CHARS_PER_TOKEN; // 80

// ── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 将标题文本转为 URL slug
 * 小写、空格转 `-`、去除非字母数字和连字符以外的字符
 */
function toSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9一-鿿㐀-䶿\-]/g, '') // 保留中文字符和英文字母数字连字符
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 估算文本的 token 数（4 字符 = 1 token）
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * 从 Markdown 正文中提取标题文本（去掉 ## / ### 前缀）
 */
function extractHeadingText(line: string): string {
  return line.replace(/^#{1,6}\s+/, '').trim();
}

/**
 * 判断是否为标题行（仅处理 ## 和 ### 级别）
 */
function isHeadingLine(line: string): boolean {
  return /^#{2,3}\s/.test(line);
}

// ── 标题节结构 ───────────────────────────────────────────────────────────────

/** 一个标题节：标题行（可空）+ 正文内容 */
interface HeadingSection {
  heading: string | null; // null 表示文档开头无标题的前置内容
  body: string;
}

/**
 * 按 ## / ### 标题将文档正文切成标题节列表
 */
function splitByHeadings(content: string): HeadingSection[] {
  const lines = content.split('\n');
  const sections: HeadingSection[] = [];

  let currentHeading: string | null = null;
  let bodyLines: string[] = [];

  for (const line of lines) {
    if (isHeadingLine(line)) {
      // 遇到新标题：保存上一节（如果有内容）
      const bodyText = bodyLines.join('\n').trim();
      if (bodyText.length > 0 || currentHeading !== null) {
        sections.push({ heading: currentHeading, body: bodyText });
      }
      currentHeading = extractHeadingText(line);
      bodyLines = [];
    } else {
      bodyLines.push(line);
    }
  }

  // 最后一节
  const bodyText = bodyLines.join('\n').trim();
  if (bodyText.length > 0 || currentHeading !== null) {
    sections.push({ heading: currentHeading, body: bodyText });
  }

  return sections;
}

// ── 段落与句子切分 ────────────────────────────────────────────────────────────

/**
 * 将文本按空行（\n\n）切成段落列表（过滤空段落）
 */
function splitToParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * 将段落按句子切分（句号、问号、感叹号、换行后兜底）
 * 尽量不跨语义单元强切
 */
function splitToSentences(paragraph: string): string[] {
  // 按中英文句号、问号、感叹号切分；保留分隔符在前句末尾
  // 同时按换行切（代码块等大段落）
  const parts: string[] = [];
  // 先按换行切，再对每行按句子切
  const lines = paragraph.split('\n');

  for (const line of lines) {
    if (line.trim().length === 0) continue;

    // 按中英文句号/问号/感叹号切分，保留标点在前面
    const sentenceBreaks = line.split(/(?<=[。！？.!?])\s*/);
    for (const s of sentenceBreaks) {
      const trimmed = s.trim();
      if (trimmed.length > 0) {
        parts.push(trimmed);
      }
    }
  }

  return parts.filter((p) => p.length > 0);
}

/**
 * 将多段落组合为不超过 MAX_CHUNK_CHARS 的文本块
 * 每个段落超过 PARAGRAPH_SPLIT_THRESHOLD_CHARS 时先拆成句子再组合
 *
 * 句子/段落组合目标是接近 400 token（PARAGRAPH_SPLIT_THRESHOLD_CHARS），
 * 绝对上限是 500 token（MAX_CHUNK_CHARS）。
 */
function combineParagraphs(paragraphs: string[]): string[] {
  const chunks: string[] = [];
  let current = '';

  /**
   * 将一批"原子单元"（句子）追加合并到 chunks。
   * 目标大小：PARAGRAPH_SPLIT_THRESHOLD_CHARS（1600 字符 ≈ 400 token）
   * 绝对上限：MAX_CHUNK_CHARS（2000 字符 ≈ 500 token）
   */
  function flushAtoms(atoms: string[]): void {
    for (const atom of atoms) {
      if (atom.length > MAX_CHUNK_CHARS) {
        // 单个原子超绝对上限：强制截断（兜底，极端情况）
        if (current.length > 0) {
          chunks.push(current);
          current = '';
        }
        let remaining = atom;
        while (remaining.length > MAX_CHUNK_CHARS) {
          chunks.push(remaining.slice(0, MAX_CHUNK_CHARS));
          remaining = remaining.slice(MAX_CHUNK_CHARS);
        }
        if (remaining.length > 0) {
          current = remaining;
        }
      } else {
        // 追加后超过目标大小（400 token）时关闭当前块，开始新块
        const separator = current.length > 0 ? '\n' : '';
        const nextLength = current.length + separator.length + atom.length;
        if (nextLength > PARAGRAPH_SPLIT_THRESHOLD_CHARS && current.length > 0) {
          chunks.push(current);
          current = atom;
        } else {
          current = current.length > 0 ? current + '\n' + atom : atom;
        }
      }
    }
  }

  for (const para of paragraphs) {
    if (para.length > PARAGRAPH_SPLIT_THRESHOLD_CHARS) {
      // 段落过大：先按句子切，再组合
      const sentences = splitToSentences(para);
      flushAtoms(sentences);
    } else if (current.length + (current.length > 0 ? 2 : 0) + para.length > MAX_CHUNK_CHARS) {
      // 追加后超绝对上限：保存当前，开新 chunk
      if (current.length > 0) {
        chunks.push(current);
        current = '';
      }
      current = para;
    } else {
      current = current.length > 0 ? current + '\n\n' + para : para;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

// ── 最小 chunk 合并 ────────────────────────────────────────────────────────

/**
 * 合并过短（< MIN_CHUNK_CHARS）的文本块到邻近块
 * 优先合并到前一块；若前一块不存在则合并到后一块
 */
function mergeSmallChunks(texts: string[]): string[] {
  if (texts.length === 0) return [];

  // 先收集合并结果
  const result: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    // 断言：texts[i] 在循环内已通过索引 i 访问，但 noUncheckedIndexedAccess 要求检查
    if (text === undefined) continue;

    if (text.length < MIN_CHUNK_CHARS) {
      if (result.length > 0) {
        // 合并到前一块
        const prev = result[result.length - 1];
        if (prev !== undefined) {
          result[result.length - 1] = prev + '\n\n' + text;
        }
      } else {
        // 没有前一块：先缓存，后面尝试合并到下一块
        result.push(text);
      }
    } else {
      if (
        result.length > 0 &&
        (result[result.length - 1]?.length ?? 0) < MIN_CHUNK_CHARS
      ) {
        // 前一个太小，合并进来
        const prev = result[result.length - 1];
        if (prev !== undefined) {
          result[result.length - 1] = prev + '\n\n' + text;
        }
      } else {
        result.push(text);
      }
    }
  }

  return result.filter((t) => t.trim().length > 0);
}

// ── 主函数 ──────────────────────────────────────────────────────────────────

/**
 * 将 ParsedDoc 按三级策略切分为 Chunk[]
 *
 * 幂等保证：相同输入产出相同 chunkId 集合与顺序
 */
export function splitDocument(doc: ParsedDoc): Chunk[] {
  const sections = splitByHeadings(doc.content);

  // anchor 序号计数器（同一 anchor 下多个 chunk 时追加序号）
  const anchorCounts = new Map<string, number>();

  /**
   * 为给定 anchor 分配下一个序号（首次分配返回 1，后续递增）
   */
  function nextAnchorIndex(anchor: string): number {
    const count = (anchorCounts.get(anchor) ?? 0) + 1;
    anchorCounts.set(anchor, count);
    return count;
  }

  const allChunks: Chunk[] = [];

  // 无标题文档的全局序号（anchor 为 null 时使用 _N）
  let noHeadingCounter = 0;

  for (const section of sections) {
    const anchor = section.heading !== null ? toSlug(section.heading) : null;

    // 候选文本：标题（如有）+ 正文
    const sectionText =
      section.heading !== null
        ? `## ${section.heading}\n\n${section.body}`.trim()
        : section.body;

    if (sectionText.trim().length === 0) continue;

    // 决定是否需要进一步切分
    let rawTexts: string[];

    if (estimateTokens(sectionText) <= PARAGRAPH_SPLIT_THRESHOLD_TOKENS) {
      // 整节 ≤ 400 token：直接作为一个候选块
      rawTexts = [sectionText];
    } else {
      // 超过 400 token：按段落+句子切分
      const paragraphs = splitToParagraphs(
        // 正文部分切段落（不含标题行本身）
        section.body,
      );
      const combined = combineParagraphs(paragraphs);
      const merged = mergeSmallChunks(combined);

      // 如果正文被切开，把标题前缀加到第一块
      if (merged.length > 0 && section.heading !== null) {
        merged[0] = `## ${section.heading}\n\n${merged[0] ?? ''}`;
      }

      rawTexts = merged.length > 0 ? merged : [sectionText];
    }

    // 最终过滤 + 生成 Chunk 对象
    for (const text of rawTexts) {
      if (text.trim().length === 0) continue;
      // 过短：计入下一次迭代合并（此处已经过 mergeSmallChunks，理论上不应出现）
      // 但仍做最终检查
      if (text.length < MIN_CHUNK_CHARS && rawTexts.length > 1) continue;

      // 生成 chunkId
      let chunkId: string;
      if (anchor !== null) {
        const idx = nextAnchorIndex(anchor);
        chunkId = idx === 1 ? `${doc.id}#${anchor}` : `${doc.id}#${anchor}-${idx}`;
      } else {
        noHeadingCounter += 1;
        chunkId = `${doc.id}#_${noHeadingCounter}`;
      }

      allChunks.push({
        chunkId,
        docId: doc.id,
        contentRaw: text,
        anchor,
      });
    }
  }

  return allChunks;
}
