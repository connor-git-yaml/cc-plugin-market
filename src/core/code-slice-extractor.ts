/**
 * 代码切片提取器
 * 从 CodeSkeleton 的 exports 定位函数体，提取控制流骨架切片
 * 用于在非 deep 模式下为 LLM 提供函数语义上下文（FR-001, FR-004, FR-010）
 * 参见 contracts/core-pipeline.md
 */
import * as fs from 'node:fs';
import type { CodeSkeleton, ExportSymbol } from '../models/code-skeleton.js';
import { CodeSlicePriority } from '../models/code-skeleton.js';
import type { CodeSlice } from '../models/code-skeleton.js';
import { estimateFast } from './token-counter.js';

// ============================================================
// 类型定义
// ============================================================

export interface CodeSliceExtractorOptions {
  /**
   * 代码切片总 token 预算（默认 40_000）
   * 超出预算时按 priority 升序贪心裁剪（P1 最高优先级保留）
   */
  maxTokens?: number;
  /**
   * 多处 import 阈值：被至少 N 个文件 import 时归为 P2（默认 2）
   */
  multiImportThreshold?: number;
  /**
   * 复杂控制流行数阈值：控制流行数 >= N 时归为 P3（默认 3）
   */
  complexFlowThreshold?: number;
}

/** 文件源码缓存（避免同一文件多次读取） */
type SourceCache = Map<string, string[] | null>;

// ============================================================
// 控制流行识别
// ============================================================

/**
 * 控制流关键词模式（用于保留行的识别）
 * 保留：if/elif/else/for/while/try/except/finally/with/return/yield/raise/调用表达式
 */
const CONTROL_FLOW_PATTERNS = [
  /^\s*(if|elif|else|for|while|try|except|finally|with)\b/,  // Python 控制流
  /^\s*(if|else if|else|for|while|try|catch|finally|switch|case)\b/, // JS/TS/Go/Java 控制流
  /^\s*return\b/,
  /^\s*yield\b/,
  /^\s*raise\b/,
  /^\s*throw\b/,
  /^\s*break\b/,
  /^\s*continue\b/,
  /^\s*await\b/,
];

/** 注释行模式 */
const COMMENT_PATTERNS = [
  /^\s*\/\//, // 单行注释 JS/TS/Java/Go
  /^\s*#/,    // Python/Shell 注释
  /^\s*\/\*/, // 块注释开始
  /^\s*\*/    // 块注释内容或结束
];

/** 函数调用模式（识别为有意义的调用行） */
const CALL_PATTERN = /\w+\s*\(/;

/**
 * 判断一行是否为控制流/关键行（应当保留）
 */
function isControlFlowLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;  // 空行跳过

  // 注释行不保留
  for (const pattern of COMMENT_PATTERNS) {
    if (pattern.test(line)) return false;
  }

  // 控制流关键字
  for (const pattern of CONTROL_FLOW_PATTERNS) {
    if (pattern.test(line)) return true;
  }

  // 含函数调用的行（但不是纯赋值或常量定义）
  if (CALL_PATTERN.test(trimmed)) return true;

  return false;
}

// ============================================================
// Minified 检测
// ============================================================

/**
 * 检测文件是否为 minified/混淆代码
 * 判断依据：行长 > 500 字符的行占比 > 30%
 */
function isMinifiedFile(lines: string[]): boolean {
  if (lines.length === 0) return false;
  const longLineCount = lines.filter((l) => l.length > 500).length;
  return longLineCount / lines.length > 0.3;
}

// ============================================================
// 核心内部函数
// ============================================================

/**
 * 从文件行中提取指定行范围的控制流骨架
 *
 * @param lines - 文件全部行（0-indexed）
 * @param startLine - 函数起始行（1-based）
 * @param endLine - 函数结束行（1-based）
 * @returns 控制流骨架行数组（空函数体返回 null）
 */
export function _extractSliceFromLines(
  lines: string[],
  startLine: number,
  endLine: number,
): string[] | null {
  // 转换为 0-based 索引
  const start = startLine - 1;
  const end = Math.min(endLine - 1, lines.length - 1);

  if (start > end || start < 0) return null;

  // 提取函数体行（从第二行开始，跳过签名行）
  const bodyLines = lines.slice(start + 1, end + 1);

  // 过滤空行和纯注释
  const nonEmptyLines = bodyLines.filter((l) => l.trim().length > 0);

  // 空函数体检测（仅含 pass/return/None 等存根）
  if (nonEmptyLines.length === 0) return null;
  const stubPatterns = [/^\s*(pass|return\s*$|return\s+None\s*$|\.{3}\s*$)/];
  const isStub = nonEmptyLines.every((l) =>
    stubPatterns.some((p) => p.test(l)) || COMMENT_PATTERNS.some((p) => p.test(l))
  );
  if (isStub) return null;

  // 提取控制流行
  const controlFlowLines = bodyLines.filter(isControlFlowLine);

  // 如果没有任何控制流行，也没有调用行，则视为简单函数（仍保留但优先级低）
  if (controlFlowLines.length === 0) return null;

  return controlFlowLines;
}

/**
 * 计算导出符号的切片优先级
 *
 * @param symbol - 导出符号
 * @param allImportSpecifiers - 所有 skeleton 中的 import 目标名称集合（用于检测多处引用）
 * @param controlFlowLineCount - 控制流行数
 * @param multiImportThreshold - 多处 import 阈值
 * @param complexFlowThreshold - 复杂控制流阈值
 */
export function _calcPriority(
  symbol: ExportSymbol,
  allImportSpecifiers: Map<string, number>,
  controlFlowLineCount: number,
  multiImportThreshold: number,
  complexFlowThreshold: number,
): CodeSlicePriority {
  // P1：公开导出函数/类（kind === function 或 class，且为公开符号）
  if (!symbol.name.startsWith('_') && (symbol.kind === 'function' || symbol.kind === 'class')) {
    return CodeSlicePriority.P1_PUBLIC_EXPORT;
  }

  // P2：被多处 import 的内部函数
  const importCount = allImportSpecifiers.get(symbol.name) ?? 0;
  if (importCount >= multiImportThreshold) {
    return CodeSlicePriority.P2_MULTI_IMPORT;
  }

  // 默认 P3：最低优先级（含复杂控制流或不满足 P1/P2 条件的函数）
  return CodeSlicePriority.P3_COMPLEX_CONTROL_FLOW;
}

// ============================================================
// 主 API
// ============================================================

/**
 * 从多个 CodeSkeleton 和对应源文件中提取代码切片
 *
 * @param skeletons - CodeSkeleton 数组
 * @param sourceFiles - 文件路径到源码内容的映射（可选，为空时从磁盘读取）
 * @param options - 提取选项
 * @returns 按优先级排序、满足 token 预算的代码切片数组
 */
export function extractCodeSlices(
  skeletons: CodeSkeleton[],
  sourceFiles?: Map<string, string>,
  options: CodeSliceExtractorOptions = {},
): CodeSlice[] {
  const maxTokens = options.maxTokens ?? 200_000;
  const multiImportThreshold = options.multiImportThreshold ?? 2;
  const complexFlowThreshold = options.complexFlowThreshold ?? 3;

  // 构建导入引用计数（统计 skeleton 中每个 namedImport 被引用的次数）
  const importRefCount = new Map<string, number>();
  for (const skeleton of skeletons) {
    for (const imp of skeleton.imports) {
      for (const named of imp.namedImports ?? []) {
        importRefCount.set(named, (importRefCount.get(named) ?? 0) + 1);
      }
      if (imp.defaultImport) {
        importRefCount.set(imp.defaultImport, (importRefCount.get(imp.defaultImport) ?? 0) + 1);
      }
    }
  }

  // 文件源码缓存
  const sourceCache: SourceCache = new Map();

  const rawSlices: CodeSlice[] = [];

  for (const skeleton of skeletons) {
    // 加载文件源码（优先从传入的 sourceFiles map 取，否则从磁盘读）
    if (!sourceCache.has(skeleton.filePath)) {
      try {
        const content = sourceFiles?.get(skeleton.filePath)
          ?? fs.readFileSync(skeleton.filePath, 'utf-8');
        const lines = content.split('\n');

        // Minified 文件跳过
        if (isMinifiedFile(lines)) {
          sourceCache.set(skeleton.filePath, null);
        } else {
          sourceCache.set(skeleton.filePath, lines);
        }
      } catch {
        // 文件读取失败时跳过（降级保护 FR-011）
        sourceCache.set(skeleton.filePath, null);
      }
    }

    const lines = sourceCache.get(skeleton.filePath);
    if (!lines) continue;

    // 处理每个导出符号
    for (const symbol of skeleton.exports) {
      // 仅处理函数和类
      if (symbol.kind !== 'function' && symbol.kind !== 'class') continue;

      // 提取控制流骨架
      const controlFlowLines = _extractSliceFromLines(lines, symbol.startLine, symbol.endLine);
      if (!controlFlowLines || controlFlowLines.length === 0) continue;

      // 计算优先级
      const priority = _calcPriority(
        symbol,
        importRefCount,
        controlFlowLines.length,
        multiImportThreshold,
        complexFlowThreshold,
      );

      // 估算 token 消耗（签名 + 控制流行）
      const sliceText = `${symbol.signature}\n${controlFlowLines.join('\n')}`;
      const estimatedTokens = estimateFast(sliceText);

      rawSlices.push({
        filePath: skeleton.filePath,
        symbolName: symbol.name,
        signature: symbol.signature,
        controlFlowLines,
        priority,
        estimatedTokens,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
      });
    }
  }

  // 按优先级升序排序（P1 最高优先级优先保留）
  rawSlices.sort((a, b) => a.priority - b.priority);

  // Token 预算裁剪：贪心保留
  const result: CodeSlice[] = [];
  let usedTokens = 0;

  for (const slice of rawSlices) {
    if (usedTokens + slice.estimatedTokens <= maxTokens) {
      result.push(slice);
      usedTokens += slice.estimatedTokens;
    }
    // 超出预算后跳过低优先级切片
  }

  return result;
}
