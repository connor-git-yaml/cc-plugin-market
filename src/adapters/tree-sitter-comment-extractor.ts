/**
 * 共享的 tree-sitter 注释 region 提取器
 *
 * Python / Go / Java 三个 adapter 使用同一套逻辑，只是 grammar 名称和
 * 块注释标记不同。关键 invariant：tree-sitter grammar 会把 string literal
 * 里的 "TODO" 归类为 string 节点而不是 comment 节点，因此 AST 遍历天然
 * 满足 AC-1.2。
 */
import * as fs from 'node:fs';
import type Parser from 'web-tree-sitter';
import { GrammarManager } from '../core/grammar-manager.js';
import type { CommentRegion } from '../debt-scanner/types.js';

/** 每种语言专属的注释解析策略 */
export interface CommentGrammarSpec {
  /** GrammarManager 注册的 grammar 名 */
  grammarName: string;
  /** comment 节点类型白名单 */
  commentNodeTypes: ReadonlySet<string>;
}

const PARSER_CACHE = new Map<string, Parser>();

let ParserCtor: typeof Parser | null = null;

async function getParserCtor(): Promise<typeof Parser> {
  if (ParserCtor) return ParserCtor;
  const mod = await import('web-tree-sitter');
  // web-tree-sitter 是 default export
  ParserCtor = (mod.default ?? (mod as unknown as typeof Parser));
  return ParserCtor;
}

/** 获取（或创建）某 grammar 的 Parser 实例 */
async function getParser(grammarName: string): Promise<Parser> {
  let parser = PARSER_CACHE.get(grammarName);
  if (parser) return parser;
  const grammar = await GrammarManager.getInstance().getGrammar(grammarName);
  const PCtor = await getParserCtor();
  parser = new PCtor();
  parser.setLanguage(grammar);
  PARSER_CACHE.set(grammarName, parser);
  return parser;
}

/**
 * 使用 tree-sitter 解析源文件并返回所有注释 region。
 */
export async function extractCommentsWithTreeSitter(
  filePath: string,
  spec: CommentGrammarSpec,
): Promise<CommentRegion[]> {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.length === 0) return [];
  const source = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;

  const parser = await getParser(spec.grammarName);
  const tree = parser.parse(source);
  try {
    const regions: CommentRegion[] = [];
    walk(tree.rootNode, spec.commentNodeTypes, regions);
    regions.sort((a, b) => a.startLine - b.startLine);
    return regions;
  } finally {
    tree.delete();
  }
}

function walk(
  node: Parser.SyntaxNode,
  commentTypes: ReadonlySet<string>,
  out: CommentRegion[],
): void {
  if (commentTypes.has(node.type)) {
    out.push(nodeToRegion(node));
    return;
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walk(child, commentTypes, out);
  }
}

function nodeToRegion(node: Parser.SyntaxNode): CommentRegion {
  const raw = node.text;
  const isBlock = raw.startsWith('/*') || raw.startsWith('"""') || raw.startsWith("'''");
  return {
    kind: isBlock ? 'block' : 'line',
    text: stripCommentMarkers(raw),
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
}

/**
 * 剥离注释符号，支持：
 * - # line (Python)
 * - // line (Go / Java)
 * - /* block * / (Go / Java)
 */
function stripCommentMarkers(raw: string): string {
  if (raw.startsWith('#')) {
    return raw.replace(/^#+[ \t]?/, '');
  }
  if (raw.startsWith('//')) {
    return raw.slice(2).replace(/^[ \t]/, '');
  }
  if (raw.startsWith('/*')) {
    let inner = raw.slice(2);
    if (inner.endsWith('*/')) inner = inner.slice(0, -2);
    return inner
      .split('\n')
      .map((line) => line.replace(/^\s*\*[ \t]?/, ''))
      .join('\n')
      .trim();
  }
  return raw;
}

/** 仅测试用：清理 Parser 缓存 */
export function _resetParserCache(): void {
  for (const p of PARSER_CACHE.values()) p.delete();
  PARSER_CACHE.clear();
}
