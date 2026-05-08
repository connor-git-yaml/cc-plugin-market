/**
 * tree-sitter Query 到 CodeSkeleton 映射器接口
 */
import type Parser from 'web-tree-sitter';
import type { ExportSymbol, ImportReference, ParseError, Language } from '../../models/code-skeleton.js';
import type { CallSite } from '../../models/call-site.js';

export interface MapperOptions {
  /** 包含私有/非导出符号 */
  includePrivate?: boolean;
  /** 抽取函数调用点（Feature 151，默认 false；仅 panoramic 流水线显式传 true） */
  extractCallSites?: boolean;
}

export interface QueryMapper {
  /** 映射器对应的语言 */
  readonly language: Language;

  /** 从 AST tree 提取导出符号 */
  extractExports(tree: Parser.Tree, source: string, options?: MapperOptions): ExportSymbol[];

  /** 从 AST tree 提取导入引用 */
  extractImports(tree: Parser.Tree, source: string): ImportReference[];

  /** 从 AST tree 提取解析错误 */
  extractParseErrors(tree: Parser.Tree): ParseError[];

  /** 提取模块级文档注释（可选，仅支持此概念的语言实现，如 Python） */
  extractModuleDoc?(tree: Parser.Tree): string | null;

  /**
   * 抽取函数调用点（Feature 151，可选；仅 PythonMapper 在 P1 阶段实现）。
   *
   * 实现要求：
   * - 遍历 call / attribute / binary_operator / unary_operator / decorated_definition 等 AST 节点
   * - 与 truth-set extractor (scripts/lib/python-call-extractor.py) 行为对齐（CL-04）
   * - dynamic call (getattr / eval / 字符串拼接 attribute) 直接 skip 不输出（EC-12）
   * - bare decorator (@staticmethod / @property) 不记录（CL-04）
   */
  extractCallSites?(tree: Parser.Tree, source: string): CallSite[];
}
