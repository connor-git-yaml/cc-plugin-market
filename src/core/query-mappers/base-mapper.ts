/**
 * tree-sitter Query 到 CodeSkeleton 映射器接口
 */
import type Parser from 'web-tree-sitter';
import type { ExportSymbol, ImportReference, ParseError, Language } from '../../models/code-skeleton.js';

export interface MapperOptions {
  /** 包含私有/非导出符号 */
  includePrivate?: boolean;
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
}
