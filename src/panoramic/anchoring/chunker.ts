/**
 * Hybrid Chunker — 以 H2/H3 标题为主边界切分 Markdown 文档
 * 段落合并策略：相邻段落合并直到接近 512 tokens（字符数/4 粗估）
 * 每个 chunk 记录 startLine/endLine（1-based）和 headingPath
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================
// 类型定义
// ============================================================

/**
 * 文档切片（Chunk）
 * 来自单个 Markdown 章节，包含位置信息和文本内容
 */
export interface DocChunk {
  /** repo-relative 路径（已规范化为正斜杠） */
  filePath: string;
  /** chunk 起始行（1-based，含） */
  startLine: number;
  /** chunk 结束行（1-based，含） */
  endLine: number;
  /** 层级路径，如 "## Design > ### API" */
  headingPath: string;
  /** chunk 文本内容（去除 markdown 格式符） */
  text: string;
  /** 粗估 token 数（字符数 / 4，用于上限控制） */
  tokenCount: number;
}

/**
 * Chunker 选项
 */
export interface DocChunkerOptions {
  /** 单个 chunk 的最大 token 数（默认 512） */
  maxTokens?: number;
}

// ============================================================
// 内部辅助类型
// ============================================================

/** 内部使用的章节数据（含行号信息） */
interface Section {
  /** 标题层级（2=H2，3=H3） */
  level: 2 | 3;
  /** 标题文本（含 ## 或 ### 前缀） */
  headingLine: string;
  /** headingPath（例如 "## Setup > ### Install"） */
  headingPath: string;
  /** 起始行号（1-based，章节 heading 所在行） */
  startLine: number;
  /** 结束行号（1-based，下一章节 heading 前一行） */
  endLine: number;
  /** 章节体内容的行列表（不含 heading 行） */
  bodyLines: string[];
}

// ============================================================
// 主函数
// ============================================================

/**
 * 批量切分 Markdown 文件为 DocChunk 数组
 *
 * @param filePaths   绝对路径列表（若为空则直接返回 []，FR-015 降级场景）
 * @param projectRoot 项目根目录（用于计算 repo-relative 路径）
 * @param options     Chunker 选项（默认 maxTokens=512）
 */
export function chunkMarkdownFiles(
  filePaths: string[],
  projectRoot: string,
  options?: DocChunkerOptions,
): DocChunk[] {
  // 零 doc-file 降级：直接返回空数组（FR-015）
  if (filePaths.length === 0) {
    return [];
  }

  const maxTokens = options?.maxTokens ?? 512;
  const allChunks: DocChunk[] = [];

  for (const absPath of filePaths) {
    const chunks = chunkSingleFile(absPath, projectRoot, maxTokens);
    allChunks.push(...chunks);
  }

  return allChunks;
}

// ============================================================
// 单文件处理
// ============================================================

/** 切分单个 Markdown 文件 */
function chunkSingleFile(
  absPath: string,
  projectRoot: string,
  maxTokens: number,
): DocChunk[] {
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch {
    // 文件不可读时降级为空（不抛错）
    return [];
  }

  // 空文件降级
  if (!content.trim()) {
    return [];
  }

  const repoRelPath = toRepoRelative(absPath, projectRoot);
  const rawLines = content.split('\n');

  // 提取所有 H2/H3 章节
  const sections = extractSections(rawLines);

  // 如果没有任何 H2/H3，把整个文档作为一个 chunk
  if (sections.length === 0) {
    const text = rawLines.join('\n').trim();
    if (!text) {
      return [];
    }
    // 超长时分段
    return splitLongText(text, repoRelPath, 1, rawLines.length, '', maxTokens);
  }

  const chunks: DocChunk[] = [];

  // 处理各章节：段落合并 + 超长拆分
  for (const section of sections) {
    const sectionChunks = sectionToChunks(section, repoRelPath, maxTokens);
    chunks.push(...sectionChunks);
  }

  return chunks;
}

// ============================================================
// 章节提取
// ============================================================

/** 从行数组中提取所有 H2/H3 章节 */
function extractSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  // 记录各级别当前 heading，用于构造 headingPath
  let currentH2 = '';

  // 找出所有 H2/H3 heading 的行号
  const headingIndices: Array<{ lineIdx: number; level: 2 | 3; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    // 匹配 H2：以 "## " 或 "##\t" 开头，但不是 H3
    if (/^##\s/.test(line) && !/^###/.test(line)) {
      headingIndices.push({ lineIdx: i, level: 2, text: line.trim() });
    } else if (/^###\s/.test(line)) {
      headingIndices.push({ lineIdx: i, level: 3, text: line.trim() });
    }
  }

  if (headingIndices.length === 0) {
    return [];
  }

  for (let i = 0; i < headingIndices.length; i++) {
    const current = headingIndices[i];
    if (!current) continue;

    const nextEntry = headingIndices[i + 1];
    const nextStartLineIdx = nextEntry !== undefined ? nextEntry.lineIdx : lines.length;

    // 更新 H2 上下文
    if (current.level === 2) {
      currentH2 = current.text;
    }

    // 构造 headingPath
    const headingPath = current.level === 2
      ? current.text
      : `${currentH2} > ${current.text}`;

    // body lines（不含 heading 自身）
    const bodyLines = lines.slice(current.lineIdx + 1, nextStartLineIdx);

    sections.push({
      level: current.level,
      headingLine: current.text,
      headingPath,
      startLine: current.lineIdx + 1, // 1-based
      endLine: nextStartLineIdx,       // 最后一行 1-based
      bodyLines,
    });
  }

  return sections;
}

// ============================================================
// 章节 → Chunk
// ============================================================

/** 将单个章节转换为一个或多个 chunk（段落合并 + 超长拆分） */
function sectionToChunks(
  section: Section,
  repoRelPath: string,
  maxTokens: number,
): DocChunk[] {
  // 把 body 按空行分割为段落
  const paragraphs = splitIntoParagraphs(section.bodyLines);

  if (paragraphs.length === 0) {
    return [];
  }

  const chunks: DocChunk[] = [];
  // 当前合并中的段落文本（以 heading 行开头）
  let currentLines: string[] = [section.headingLine];
  // 当前 chunk 起始行（1-based）：heading 行本身
  let chunkStartLine = section.startLine;
  // 当前在 bodyLines 中已消费的行数
  let lineOffset = 0;

  for (const para of paragraphs) {
    const paraText = para.lines.join('\n');
    const candidateText = currentLines.join('\n') + '\n' + paraText;
    const candidateTokens = estimateTokens(candidateText);

    if (candidateTokens <= maxTokens || currentLines.length === 1) {
      // 可以合并（若只有 heading，即使超限也要接纳第一段以避免空 chunk）
      currentLines.push(paraText);
      lineOffset += para.lineCount;
    } else {
      // 当前 chunk 已满，先输出当前 chunk
      const chunkText = currentLines.join('\n').trim();
      if (chunkText) {
        const endLine = section.startLine + lineOffset - para.lineCount;
        chunks.push(...splitLongText(
          chunkText,
          repoRelPath,
          chunkStartLine,
          Math.max(chunkStartLine, endLine),
          section.headingPath,
          maxTokens,
        ));
      }
      // 开始新 chunk
      chunkStartLine = section.startLine + lineOffset - para.lineCount + 1;
      currentLines = [section.headingLine, paraText];
      lineOffset += para.lineCount;
    }
  }

  // 输出最后一个 chunk
  const remainingText = currentLines.join('\n').trim();
  if (remainingText) {
    chunks.push(...splitLongText(
      remainingText,
      repoRelPath,
      chunkStartLine,
      section.endLine,
      section.headingPath,
      maxTokens,
    ));
  }

  return chunks;
}

// ============================================================
// 超长 chunk 拆分
// ============================================================

/**
 * 将超长文本拆分为 ≤maxTokens 的 chunk
 * 按行拆分，尽量在空行处断开
 */
function splitLongText(
  text: string,
  repoRelPath: string,
  startLine: number,
  endLine: number,
  headingPath: string,
  maxTokens: number,
): DocChunk[] {
  const tokenCount = estimateTokens(text);
  if (tokenCount <= maxTokens) {
    return [
      {
        filePath: repoRelPath,
        startLine,
        endLine,
        headingPath,
        text,
        tokenCount,
      },
    ];
  }

  // 按行拆分
  const lines = text.split('\n');
  const chunks: DocChunk[] = [];
  let currentLines: string[] = [];
  let currentLineStart = startLine;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    currentLines.push(line);
    const ct = estimateTokens(currentLines.join('\n'));

    if (ct >= maxTokens && currentLines.length > 1) {
      // 输出当前 chunk（不含最后一行）
      const chunkLines = currentLines.slice(0, -1);
      const chunkText = chunkLines.join('\n').trim();
      const chunkEndLine = currentLineStart + chunkLines.length - 1;
      if (chunkText) {
        chunks.push({
          filePath: repoRelPath,
          startLine: currentLineStart,
          endLine: chunkEndLine,
          headingPath,
          text: chunkText,
          tokenCount: estimateTokens(chunkText),
        });
      }
      currentLineStart = currentLineStart + chunkLines.length;
      currentLines = [line];
    }
  }

  // 输出剩余
  if (currentLines.length > 0) {
    const chunkText = currentLines.join('\n').trim();
    if (chunkText) {
      chunks.push({
        filePath: repoRelPath,
        startLine: currentLineStart,
        endLine: endLine,
        headingPath,
        text: chunkText,
        tokenCount: estimateTokens(chunkText),
      });
    }
  }

  if (chunks.length > 0) {
    return chunks;
  }

  // 兜底：直接输出整块
  return [{ filePath: repoRelPath, startLine, endLine, headingPath, text, tokenCount }];
}

// ============================================================
// 工具函数
// ============================================================

/** 按空行将行数组分割为段落 */
function splitIntoParagraphs(
  lines: string[],
): Array<{ lines: string[]; lineCount: number }> {
  const paragraphs: Array<{ lines: string[]; lineCount: number }> = [];
  let current: string[] = [];
  let lineCount = 0;

  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) {
        paragraphs.push({ lines: current, lineCount });
        current = [];
        lineCount = 0;
      }
      lineCount++;
    } else {
      current.push(line);
      lineCount++;
    }
  }

  if (current.length > 0) {
    paragraphs.push({ lines: current, lineCount });
  }

  return paragraphs;
}

/** 粗估 token 数：字符数 / 4（与 Local Provider 保持一致） */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** 将绝对路径转换为 repo-relative 路径（正斜杠） */
function toRepoRelative(absPath: string, projectRoot: string): string {
  const rel = path.isAbsolute(absPath)
    ? path.relative(projectRoot, absPath)
    : absPath;
  return rel.split(path.sep).join('/');
}
