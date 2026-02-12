/**
 * 超大文件分块策略
 * 当文件超过 5k LOC 时，按函数边界分割，返回带元数据的分块数组（FR-005）
 */

/** 分块阈值：5000 行 */
export const CHUNK_THRESHOLD = 5000;

/** 单个分块 */
export interface Chunk {
  /** 分块索引（从 0 开始） */
  index: number;
  /** 总分块数 */
  totalChunks: number;
  /** 分块内容 */
  content: string;
  /** 起始行号（1-based） */
  startLine: number;
  /** 结束行号（1-based） */
  endLine: number;
  /** 行数 */
  lineCount: number;
  /** 分块中包含的顶层函数/类名称 */
  symbols: string[];
}

/**
 * 检测顶层函数/类声明的正则模式
 * 匹配 export function, export class, export interface, export type, export const 等
 */
const TOP_LEVEL_DECL_RE =
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+(\w+)/;

/**
 * 查找函数边界（寻找以 } 结尾的行作为函数/类的结束位置）
 * 在 threshold 附近寻找最近的边界
 */
function findBoundary(lines: string[], targetLine: number): number {
  // 在目标行前后 200 行范围内寻找最佳分割点
  const searchRadius = 200;
  const start = Math.max(0, targetLine - searchRadius);
  const end = Math.min(lines.length - 1, targetLine + searchRadius);

  let bestBoundary = targetLine;
  let bestDistance = Infinity;

  for (let i = start; i <= end; i++) {
    const trimmed = lines[i]!.trim();

    // 寻找顶层声明的开头作为分割点（在下一行开始新分块）
    if (TOP_LEVEL_DECL_RE.test(trimmed) && i > 0) {
      const distance = Math.abs(i - targetLine);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestBoundary = i; // 在声明之前分割
      }
    }

    // 或者寻找仅有 } 的行（函数/类结束）
    if (trimmed === '}' || trimmed === '};') {
      const distance = Math.abs(i - targetLine);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestBoundary = i + 1; // 在 } 之后分割
      }
    }
  }

  return bestBoundary;
}

/**
 * 提取分块中的顶层符号名称
 */
function extractSymbols(lines: string[]): string[] {
  const symbols: string[] = [];
  for (const line of lines) {
    const match = TOP_LEVEL_DECL_RE.exec(line);
    if (match?.[1]) {
      symbols.push(match[1]);
    }
  }
  return symbols;
}

/**
 * 将文件内容按函数边界分块
 *
 * @param content - 文件完整内容
 * @param maxLinesPerChunk - 每个分块的目标最大行数（默认与阈值相同）
 * @returns 分块数组，如果文件不超过阈值则返回单元素数组
 */
export function splitIntoChunks(
  content: string,
  maxLinesPerChunk: number = CHUNK_THRESHOLD,
): Chunk[] {
  const lines = content.split('\n');
  const totalLines = lines.length;

  // 不需要分块
  if (totalLines <= CHUNK_THRESHOLD) {
    return [
      {
        index: 0,
        totalChunks: 1,
        content,
        startLine: 1,
        endLine: totalLines,
        lineCount: totalLines,
        symbols: extractSymbols(lines),
      },
    ];
  }

  // 需要分块
  const chunks: Chunk[] = [];
  let currentStart = 0;

  while (currentStart < totalLines) {
    let currentEnd: number;

    if (currentStart + maxLinesPerChunk >= totalLines) {
      // 最后一块
      currentEnd = totalLines;
    } else {
      // 在函数边界处分割
      currentEnd = findBoundary(lines, currentStart + maxLinesPerChunk);
      // 确保至少前进一些行，防止无限循环
      if (currentEnd <= currentStart) {
        currentEnd = currentStart + maxLinesPerChunk;
      }
    }

    const chunkLines = lines.slice(currentStart, currentEnd);
    chunks.push({
      index: chunks.length,
      totalChunks: 0, // 稍后回填
      content: chunkLines.join('\n'),
      startLine: currentStart + 1, // 1-based
      endLine: currentEnd,
      lineCount: chunkLines.length,
      symbols: extractSymbols(chunkLines),
    });

    currentStart = currentEnd;
  }

  // 回填 totalChunks
  for (const chunk of chunks) {
    chunk.totalChunks = chunks.length;
  }

  return chunks;
}
