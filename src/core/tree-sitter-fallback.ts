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
  ImportSemanticType,
  ParseError,
  Language,
} from '../models/code-skeleton.js';
import { TreeSitterAnalyzer } from './tree-sitter-analyzer.js';
import { resolveTsJsImport } from './import-resolver.js';

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
 * 基于正则的简易导入提取（TS/JS）。
 *
 * Feature 156 W1.0 修订（FR-28）：
 *   - 接受 filePath / projectRoot / pathAliases，调用 resolveTsJsImport 填 resolvedPath
 *   - 同时识别 require('x') 与 import('x') 形态，写入对应的 importType
 */
function extractImportsFromText(
  content: string,
  filePath: string,
  projectRoot: string,
  pathAliases?: Record<string, string>,
): ImportReference[] {
  const imports: ImportReference[] = [];
  const resolverOpts = pathAliases ? { pathAliases } : undefined;
  // WARN-2 修订：在纯正则降级路径下，先剥离行注释 / 块注释 / 字符串字面量，
  // 防止 `// require('./x')` 或 `"require('./x')"` 这类形态误命中 dynamic / require 正则。
  // WARN-2 v3：static `import ... from '...'` 路径同样改用 sanitized 文本，
  // 避免字符串字面量 / 注释里的 `import './x'` 字面被误命中（与 dynamic / require 对齐）
  const sanitized = sanitizeForImportRegex(content);
  const importRe =
    /import\s+(?:type\s+)?(?:({[^}]+})\s+from\s+|(\w+)\s+from\s+|(\w+),\s*({[^}]+})\s+from\s+)?['"]([^'"]+)['"]/g;

  let match: RegExpExecArray | null;
  while ((match = importRe.exec(sanitized)) !== null) {
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
    const resolvedPath = resolveTsJsImport(moduleSpecifier, filePath, projectRoot, resolverOpts);

    imports.push({
      moduleSpecifier,
      isRelative,
      resolvedPath,
      namedImports: namedImports && namedImports.length > 0 ? namedImports : undefined,
      defaultImport,
      isTypeOnly,
      importType: isTypeOnly ? 'type-only' : 'static',
    });
  }

  // 动态 import('x')（用 sanitized 文本，避免 WARN-2 字符串/注释误命中）
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let dyn: RegExpExecArray | null;
  while ((dyn = dynamicRe.exec(sanitized)) !== null) {
    const moduleSpecifier = dyn[1]!;
    addCallExpressionImport(imports, moduleSpecifier, 'dynamic', filePath, projectRoot, resolverOpts);
  }

  // CommonJS require('x')（限定为 require 标识符调用，避免误匹配 .require()）
  const requireRe = /(?:^|[^.\w$])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let req: RegExpExecArray | null;
  while ((req = requireRe.exec(sanitized)) !== null) {
    const moduleSpecifier = req[1]!;
    addCallExpressionImport(
      imports,
      moduleSpecifier,
      'commonjs-require',
      filePath,
      projectRoot,
      resolverOpts,
    );
  }

  return imports;
}

/**
 * 把 TS/JS 源文本剥离掉行注释 / 块注释 / 字符串字面量（替换为等长空白），
 * 让后续 dynamic / require 正则只在真实代码区段匹配。
 *
 * WARN-2 修订动机：纯文本正则会命中
 *   - `// require('./x')`（行注释）
 *   - `"require('./x')"` / `\`require('./x')\``（字符串字面量）
 * 这些片段被替换成空格后，dynamic / require 正则就不再误产边。
 *
 * 实现采用单趟扫描状态机：
 *   - normal → string('/")/template(`)/lineComment(//)/blockComment(/*)
 *   - 各 mode 在终止符处回 normal；保持长度（offset 不变），只把内容字符替换为空格
 *
 * 注意：此函数不追求 100% 解析正确（不处理 nested template literal / 转义边界
 * 罕见情况），只为降低 false positive。生产路径走 tree-sitter / ts-morph，正则
 * 仅是最终兜底。
 */
function sanitizeForImportRegex(content: string): string {
  const out = Array.from(content);
  type Mode = 'normal' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'normal';
  let i = 0;
  const n = out.length;
  while (i < n) {
    const ch = content[i]!;
    const next = i + 1 < n ? content[i + 1]! : '';
    if (mode === 'normal') {
      if (ch === '/' && next === '/') {
        mode = 'line';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        mode = 'block';
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (ch === "'") { mode = 'sq'; out[i] = ' '; i++; continue; }
      if (ch === '"') { mode = 'dq'; out[i] = ' '; i++; continue; }
      if (ch === '`') { mode = 'tpl'; out[i] = ' '; i++; continue; }
      i++;
      continue;
    }
    if (mode === 'line') {
      if (ch === '\n') { mode = 'normal'; i++; continue; }
      out[i] = ch === '\t' ? '\t' : ' ';
      i++;
      continue;
    }
    if (mode === 'block') {
      if (ch === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        mode = 'normal';
        i += 2;
        continue;
      }
      out[i] = ch === '\n' ? '\n' : (ch === '\t' ? '\t' : ' ');
      i++;
      continue;
    }
    if (mode === 'sq' || mode === 'dq' || mode === 'tpl') {
      // 转义字符：跳过下一字节（保留位置占位）
      if (ch === '\\' && i + 1 < n) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if ((mode === 'sq' && ch === "'") || (mode === 'dq' && ch === '"') || (mode === 'tpl' && ch === '`')) {
        out[i] = ' ';
        mode = 'normal';
        i++;
        continue;
      }
      out[i] = ch === '\n' ? '\n' : (ch === '\t' ? '\t' : ' ');
      i++;
      continue;
    }
  }
  return out.join('');
}

function addCallExpressionImport(
  imports: ImportReference[],
  moduleSpecifier: string,
  importType: ImportSemanticType,
  filePath: string,
  projectRoot: string,
  resolverOpts: { pathAliases: Record<string, string> } | undefined,
): void {
  const isRelative = moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/');
  const resolvedPath = resolveTsJsImport(moduleSpecifier, filePath, projectRoot, resolverOpts);
  imports.push({
    moduleSpecifier,
    isRelative,
    resolvedPath,
    isTypeOnly: false,
    importType,
  });
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

// ════════════════════════ Java 正则降级 ════════════════════════

/**
 * 基于正则的 Java 导出提取
 * 识别顶层 public class、interface、enum 定义
 */
function extractJavaExportsFromText(content: string): ExportSymbol[] {
  const exports: ExportSymbol[] = [];
  const lines = content.split('\n');
  const seen = new Set<string>();

  const patterns: Array<{ re: RegExp; kind: ExportSymbol['kind'] }> = [
    { re: /^public\s+(?:abstract\s+)?class\s+(\w+)/, kind: 'class' },
    { re: /^public\s+interface\s+(\w+)/, kind: 'interface' },
    { re: /^public\s+enum\s+(\w+)/, kind: 'enum' },
    { re: /^public\s+(?:final\s+)?class\s+(\w+)/, kind: 'class' },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    for (const { re, kind } of patterns) {
      const match = re.exec(line);
      if (match?.[1] && !seen.has(match[1])) {
        seen.add(match[1]);
        exports.push({
          name: match[1],
          kind,
          signature: `[REGEX] ${line.slice(0, 200)}`,
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
 * 基于正则的 Java 导入提取
 * 识别 import 和 import static 语句
 */
function extractJavaImportsFromText(content: string): ImportReference[] {
  const imports: ImportReference[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // import static java.util.Collections.sort;
    const staticMatch = /^import\s+static\s+([\w.]+(?:\.\*)?)\s*;/.exec(trimmed);
    if (staticMatch) {
      imports.push({
        moduleSpecifier: staticMatch[1]!,
        isRelative: false,
        resolvedPath: null,
        isTypeOnly: false,
      });
      continue;
    }

    // import java.util.List;
    // import java.util.*;
    const importMatch = /^import\s+([\w.]+(?:\.\*)?)\s*;/.exec(trimmed);
    if (importMatch) {
      imports.push({
        moduleSpecifier: importMatch[1]!,
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
 * @param filePath - 文件路径
 * @param options - Feature 156 W1.0 新增可选项：projectRoot / pathAliases，
 *                  仅 TS/JS 正则降级路径会用到（用于 import-resolver 解析 resolvedPath）
 * @returns CodeSkeleton，parserUsed 为 'tree-sitter'
 */
export async function analyzeFallback(
  filePath: string,
  options?: { projectRoot?: string; pathAliases?: Record<string, string> },
): Promise<CodeSkeleton> {
  const language = getLanguage(filePath);

  // 第一级降级：尝试 tree-sitter AST 解析
  try {
    const analyzer = TreeSitterAnalyzer.getInstance();
    if (analyzer.isLanguageSupported(language)) {
      return await analyzer.analyze(filePath, language, {
        projectRoot: options?.projectRoot,
        pathAliases: options?.pathAliases,
      });
    }
  } catch {
    // tree-sitter 解析失败，继续降级到正则
  }

  // 第二级降级：正则提取（最终兜底）
  return regexFallback(filePath, language, options?.projectRoot ?? '', options?.pathAliases);
}

/**
 * 正则降级分析（内部方法，可用于测试对比）
 */
function regexFallback(
  filePath: string,
  language: Language,
  projectRoot: string,
  pathAliases?: Record<string, string>,
): CodeSkeleton {
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
      : language === 'java'
        ? extractJavaExportsFromText(content)
        : extractExportsFromText(content);
  // Feature 156 W1.0：TS/JS 正则降级路径调用 import-resolver 填充 resolvedPath；
  // 其他语言保持现有行为（Python / Go / Java 的解析在各自 adapter 阶段处理，EC-6）
  const imports = language === 'python'
    ? extractPythonImportsFromText(content)
    : language === 'go'
      ? extractGoImportsFromText(content)
      : language === 'java'
        ? extractJavaImportsFromText(content)
        : extractImportsFromText(content, filePath, projectRoot, pathAliases);

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
