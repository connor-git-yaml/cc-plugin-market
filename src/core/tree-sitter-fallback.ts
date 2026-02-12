/**
 * tree-sitter 容错降级
 * 针对 ts-morph 解析失败的文件进行容错解析
 * 生成部分骨架，parseErrors 字段被填充
 */
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import type {
  CodeSkeleton,
  ExportSymbol,
  ImportReference,
  ParseError,
  Language,
} from '../models/code-skeleton.js';

/**
 * 基于正则的简易导出提取（tree-sitter 降级模式）
 * 当 ts-morph 无法解析时，使用正则提取基本结构
 */
function extractExportsFromText(content: string): ExportSymbol[] {
  const exports: ExportSymbol[] = [];
  const lines = content.split('\n');
  const seen = new Set<string>();

  const exportPatterns = [
    // export function name
    /^export\s+(?:async\s+)?function\s+(\w+)/,
    // export class name
    /^export\s+(?:abstract\s+)?class\s+(\w+)/,
    // export interface name
    /^export\s+interface\s+(\w+)/,
    // export type name
    /^export\s+type\s+(\w+)/,
    // export enum name
    /^export\s+enum\s+(\w+)/,
    // export const/let/var name
    /^export\s+(?:const|let|var)\s+(\w+)/,
    // export default function/class
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

        // 推断 kind
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
          endLine: i + 1, // 无法精确确定结束行
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

/**
 * 检测文件语言
 */
function getLanguage(filePath: string): Language {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    return 'typescript';
  }
  return 'javascript';
}

/**
 * 容错解析文件
 * 使用正则模式提取基本结构信息
 *
 * @param filePath - 文件路径
 * @returns 部分填充的 CodeSkeleton，parserUsed 为 'tree-sitter'
 */
export async function analyzeFallback(filePath: string): Promise<CodeSkeleton> {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (error: any) {
    throw new Error(`无法读取文件: ${filePath} — ${error.message}`);
  }

  const hash = createHash('sha256').update(content).digest('hex');
  const lines = content.split('\n');
  const loc = lines.length;
  const language = getLanguage(filePath);

  const exports = extractExportsFromText(content);
  const imports = extractImportsFromText(content);

  // 记录解析错误
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
