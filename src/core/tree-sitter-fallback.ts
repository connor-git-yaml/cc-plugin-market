/**
 * tree-sitter 容错降级（三级降级链）
 *
 * 降级链: ts-morph → tree-sitter → regex
 *
 * 当 ts-morph 解析失败时:
 * 1. 优先使用 TreeSitterAnalyzer 进行真正的 tree-sitter AST 解析
 * 2. 若 tree-sitter 也失败（如 WASM 加载错误），降级到正则提取
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  CodeSkeleton,
  ExportSymbol,
  ImportReference,
  ParseError,
  Language,
} from '../models/code-skeleton.js';
import { TreeSitterAnalyzer } from './tree-sitter-analyzer.js';

// ════════════════════════ 正则降级（最终兜底） ════════════════════════

/**
 * 基于正则的简易导出提取（最终降级模式）
 * 当 tree-sitter 也无法使用时，使用正则提取基本结构
 */
function extractExportsFromText(content: string): ExportSymbol[] {
  const exports: ExportSymbol[] = [];
  const lines = content.split('\n');
  const seen = new Set<string>();

  const exportPatterns = [
    /^export\s+(?:async\s+)?function\s+(\w+)/,
    /^export\s+(?:abstract\s+)?class\s+(\w+)/,
    /^export\s+interface\s+(\w+)/,
    /^export\s+type\s+(\w+)/,
    /^export\s+enum\s+(\w+)/,
    /^export\s+(?:const|let|var)\s+(\w+)/,
    /^export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/,
  ];

  const kindMap: Record<string, ExportSymbol['kind']> = {
    function: 'function',
    class: 'class',
    interface: 'interface',
    type: 'type',
    enum: 'enum',
    const: 'const',
    let: 'variable',
    var: 'variable',
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    for (const pattern of exportPatterns) {
      const match = pattern.exec(line);
      if (match?.[1] && !seen.has(match[1])) {
        seen.add(match[1]);

        let kind: ExportSymbol['kind'] = 'variable';
        for (const [keyword, k] of Object.entries(kindMap)) {
          if (line.includes(keyword)) {
            kind = k;
            break;
          }
        }

        exports.push({
          name: match[1],
          kind,
          signature: `[SYNTAX ERROR] ${line.slice(0, 200)}`,
          jsDoc: null,
          isDefault: line.includes('default'),
          startLine: i + 1,
          endLine: i + 1,
        });
        break;
      }
    }
  }

  return exports;
}

/**
 * 基于正则的简易导入提取
 */
function extractImportsFromText(content: string): ImportReference[] {
  const imports: ImportReference[] = [];
  const importRe =
    /import\s+(?:type\s+)?(?:({[^}]+})\s+from\s+|(\w+)\s+from\s+|(\w+),\s*({[^}]+})\s+from\s+)?['"]([^'"]+)['"]/g;

  let match: RegExpExecArray | null;
  while ((match = importRe.exec(content)) !== null) {
    const moduleSpecifier = match[5]!;
    const isRelative = moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/');
    const isTypeOnly = match[0].includes('import type');

    const namedImportsStr = match[1] ?? match[4];
    const namedImports = namedImportsStr
      ? namedImportsStr
          .replace(/[{}]/g, '')
          .split(',')
          .map((s) => s.trim().split(/\s+as\s+/)[0]!)
          .filter(Boolean)
      : undefined;

    const defaultImport = match[2] ?? match[3] ?? null;

    imports.push({
      moduleSpecifier,
      isRelative,
      resolvedPath: null,
      namedImports: namedImports && namedImports.length > 0 ? namedImports : undefined,
      defaultImport,
      isTypeOnly,
    });
  }

  return imports;
}

// ════════════════════════ Python 正则降级 ════════════════════════

/**
 * 基于正则的 Python 导出提取
 * 识别顶层 def、async def、class 定义
 */
function extractPythonExportsFromText(content: string): ExportSymbol[] {
  const exports: ExportSymbol[] = [];
  const lines = content.split('\n');
  const seen = new Set<string>();

  const patterns: Array<{ re: RegExp; kind: ExportSymbol['kind'] }> = [
    { re: /^(?:async\s+)?def\s+(\w+)\s*\(/, kind: 'function' },
    { re: /^class\s+(\w+)/, kind: 'class' },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // 仅匹配顶层定义（无缩进）
    if (line.startsWith(' ') || line.startsWith('\t')) continue;

    for (const { re, kind } of patterns) {
      const match = re.exec(line);
      if (match?.[1] && !seen.has(match[1]) && !match[1].startsWith('_')) {
        seen.add(match[1]);
        const isAsync = line.trimStart().startsWith('async');
        exports.push({
          name: match[1],
          kind,
          signature: `[REGEX] ${isAsync ? 'async ' : ''}${line.trim().slice(0, 200)}`,
          jsDoc: null,
          isDefault: false,
          startLine: i + 1,
          endLine: i + 1,
        });
        break;
      }
    }
  }

  return exports;
}

/**
 * 基于正则的 Python 导入提取
 * 识别 import 和 from...import 语句
 */
function extractPythonImportsFromText(content: string): ImportReference[] {
  const imports: ImportReference[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // from <module> import <names>
    const fromMatch = /^from\s+(\S+)\s+import\s+(.+)$/.exec(trimmed);
    if (fromMatch) {
      const mod = fromMatch[1]!;
      const namesStr = fromMatch[2]!.split('#')[0]!.trim(); // 去掉行内注释
      const namedImports = namesStr.split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!).filter(Boolean);
      imports.push({
        moduleSpecifier: mod,
        isRelative: mod.startsWith('.'),
        resolvedPath: null,
        namedImports: namedImports.length > 0 ? namedImports : undefined,
        isTypeOnly: false,
      });
      continue;
    }

    // import <module>
    const importMatch = /^import\s+(\S+)/.exec(trimmed);
    if (importMatch) {
      const mod = importMatch[1]!.replace(/,\s*$/, '');
      imports.push({
        moduleSpecifier: mod,
        isRelative: false,
        resolvedPath: null,
        isTypeOnly: false,
      });
    }
  }

  return imports;
}

// ════════════════════════ Go 正则降级 ════════════════════════

/**
 * 基于正则的 Go 导出提取
 * 识别顶层 func、type（struct/interface）、const、var 定义
 * Go 的可见性规则：首字母大写 = 导出
 */
function extractGoExportsFromText(content: string): ExportSymbol[] {
  const exports: ExportSymbol[] = [];
  const lines = content.split('\n');
  const seen = new Set<string>();

  const patterns: Array<{ re: RegExp; kind: ExportSymbol['kind'] }> = [
    { re: /^func\s+(\w+)\s*\(/, kind: 'function' },
    { re: /^func\s+\([^)]+\)\s+(\w+)\s*\(/, kind: 'function' }, // method
    { re: /^type\s+(\w+)\s+struct\b/, kind: 'struct' },
    { re: /^type\s+(\w+)\s+interface\b/, kind: 'interface' },
    { re: /^type\s+(\w+)\s+/, kind: 'type' },
    { re: /^const\s+(\w+)/, kind: 'const' },
    { re: /^var\s+(\w+)/, kind: 'variable' },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // 仅匹配顶层定义（无缩进）
    if (line.startsWith(' ') || line.startsWith('\t')) continue;

    for (const { re, kind } of patterns) {
      const match = re.exec(line);
      // Go: 首字母大写 = 导出
      if (match?.[1] && !seen.has(match[1]) && /^[A-Z]/.test(match[1])) {
        seen.add(match[1]);
        exports.push({
          name: match[1],
          kind,
          signature: `[REGEX] ${line.trim().slice(0, 200)}`,
          jsDoc: null,
          isDefault: false,
          startLine: i + 1,
          endLine: i + 1,
        });
        break;
      }
    }
  }

  return exports;
}

/**
 * 基于正则的 Go 导入提取
 * 识别单行 import 和分组 import
 */
function extractGoImportsFromText(content: string): ImportReference[] {
  const imports: ImportReference[] = [];

  // 分组 import: import ( "pkg1" \n "pkg2" )
  const groupRe = /import\s*\(([\s\S]*?)\)/g;
  let groupMatch: RegExpExecArray | null;
  while ((groupMatch = groupRe.exec(content)) !== null) {
    const block = groupMatch[1]!;
    const lineRe = /^\s*(?:\w+\s+)?"([^"]+)"/gm;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRe.exec(block)) !== null) {
      imports.push({
        moduleSpecifier: lineMatch[1]!,
        isRelative: false,
        resolvedPath: null,
        isTypeOnly: false,
      });
    }
  }

  // 单行 import: import "pkg"
  const singleRe = /^import\s+(?:\w+\s+)?"([^"]+)"/gm;
  let singleMatch: RegExpExecArray | null;
  while ((singleMatch = singleRe.exec(content)) !== null) {
    // 避免重复（如果已在分组中匹配）
    if (!imports.some((i) => i.moduleSpecifier === singleMatch![1])) {
      imports.push({
        moduleSpecifier: singleMatch[1]!,
        isRelative: false,
        resolvedPath: null,
        isTypeOnly: false,
      });
    }
  }

  return imports;
}

// ════════════════════════ 语言检测 ════════════════════════

/**
 * 从文件扩展名检测语言（扩展支持多语言）
 */
function getLanguage(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, Language> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.pyi': 'python',
    '.go': 'go',
    '.java': 'java',
  };
  return langMap[ext] ?? 'javascript';
}

// ════════════════════════ 降级入口 ════════════════════════

/**
 * 容错解析文件（三级降级链）
 *
 * 1. 尝试 TreeSitterAnalyzer 真正的 AST 解析
 * 2. tree-sitter 失败时降级到正则提取
 *
 * 函数签名保持与重写前完全一致，不影响调用方。
 *
 * @param filePath - 文件路径
 * @returns CodeSkeleton，parserUsed 为 'tree-sitter'（AST）或 'tree-sitter'（正则降级亦标记为 tree-sitter，保持兼容）
 */
export async function analyzeFallback(filePath: string): Promise<CodeSkeleton> {
  const language = getLanguage(filePath);

  // 第一级降级：尝试 tree-sitter AST 解析
  try {
    const analyzer = TreeSitterAnalyzer.getInstance();
    if (analyzer.isLanguageSupported(language)) {
      return await analyzer.analyze(filePath, language);
    }
  } catch {
    // tree-sitter 解析失败，继续降级到正则
  }

  // 第二级降级：正则提取（最终兜底）
  return regexFallback(filePath, language);
}

/**
 * 正则降级分析（内部方法，可用于测试对比）
 */
function regexFallback(filePath: string, language: Language): CodeSkeleton {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (error: any) {
    throw new Error(`无法读取文件: ${filePath} — ${error.message}`);
  }

  const hash = createHash('sha256').update(content).digest('hex');
  const lines = content.split('\n');
  const loc = lines.length;

  // 根据语言选择对应的正则提取器
  const exports = language === 'python'
    ? extractPythonExportsFromText(content)
    : language === 'go'
      ? extractGoExportsFromText(content)
      : extractExportsFromText(content);
  const imports = language === 'python'
    ? extractPythonImportsFromText(content)
    : language === 'go'
      ? extractGoImportsFromText(content)
      : extractImportsFromText(content);

  const parseErrors: ParseError[] = [
    {
      line: 1,
      column: 0,
      message: 'ts-morph 解析失败，已降级至正则模式提取',
      affectedSymbols: exports.map((e) => e.name),
    },
  ];

  return {
    filePath,
    language,
    loc,
    exports,
    imports,
    parseErrors,
    hash,
    analyzedAt: new Date().toISOString(),
    parserUsed: 'tree-sitter',
  };
}
