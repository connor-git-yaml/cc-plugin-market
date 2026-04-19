/**
 * 轻量 Markdown 解析：heading tree + 段落
 *
 * 仅实现 debt-scanner 需要的最小功能，不依赖重型 Markdown AST 库。
 * 规则：
 * - `^#{1,6}\s+` 识别 heading，记录 level 与 text
 * - 两个 heading 之间或到文件结尾为一个 section
 * - 空行分隔段落
 * - 忽略 fenced code block（``` ... ```）与 indented code block（行首 4+ 空格）
 */

export interface Section {
  /** heading path，如 "# Design > ## Open Questions" */
  headingPath: string;
  /** 段落列表（已剥离首尾空白、去除 code block） */
  paragraphs: string[];
  /** 该 section 的起始行号（1-indexed） */
  startLine: number;
}

/**
 * 解析 markdown 文本为 sections。
 * 如果文档没有任何 heading，则视为单个 "" section。
 */
export function parseMarkdownSections(text: string): Section[] {
  const lines = text.split('\n');
  const sections: Section[] = [];

  // 先标记 fenced code block 区域
  const inFence = new Array<boolean>(lines.length).fill(false);
  let fenceOpen = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i]!)) {
      fenceOpen = !fenceOpen;
      inFence[i] = true; // fence 标记行本身也算 code
      continue;
    }
    inFence[i] = fenceOpen;
  }

  const headingStack: Array<{ level: number; text: string }> = [];
  let current: { startLine: number; buffer: string[]; path: string } = {
    startLine: 1,
    buffer: [],
    path: '',
  };

  const flushSection = () => {
    const paragraphs = bufferToParagraphs(current.buffer);
    sections.push({
      headingPath: current.path,
      paragraphs,
      startLine: current.startLine,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (inFence[i]) {
      current.buffer.push(''); // 把 code block 行当成空行，免得它粘进段落
      continue;
    }
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) {
      // 先保存前一个 section（只有内容非空才 push）
      flushSection();
      const level = m[1]!.length;
      const text = m[2]!;
      // 调整 headingStack
      while (headingStack.length && headingStack[headingStack.length - 1]!.level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text });
      const pathStr = headingStack
        .map((h) => `${'#'.repeat(h.level)} ${h.text}`)
        .join(' > ');
      current = { startLine: i + 1, buffer: [], path: pathStr };
      continue;
    }
    current.buffer.push(line);
  }
  flushSection();

  return sections;
}

function bufferToParagraphs(lines: string[]): string[] {
  const paras: string[] = [];
  let current: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '') {
      if (current.length) {
        paras.push(current.join(' ').trim());
        current = [];
      }
      continue;
    }
    // indented code block：行首 4+ 空格或 tab 开头的视为代码忽略
    if (/^(\s{4}|\t)/.test(line) && current.length === 0) continue;
    current.push(line.trim());
  }
  if (current.length) paras.push(current.join(' ').trim());
  return paras.filter((p) => p.length > 0);
}
