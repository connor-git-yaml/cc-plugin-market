/**
 * API Surface 通用辅助函数与常量
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileCollectionOptions } from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('api-surface-utils');

// ============================================================
// 常量
// ============================================================

export const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
] as const;

export const HTTP_METHOD_SET = new Set<string>([...HTTP_METHODS, 'all']);
export const TSOA_HTTP_DECORATORS = new Map<string, string>([
  ['Get', 'GET'],
  ['Post', 'POST'],
  ['Put', 'PUT'],
  ['Patch', 'PATCH'],
  ['Delete', 'DELETE'],
  ['Options', 'OPTIONS'],
  ['Head', 'HEAD'],
]);

export const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
]);

export const OPENAPI_FILE_PATTERN = /(?:^|[-_.])(openapi|swagger)(?:[-_.].*)?\.(json|yaml|yml)$/i;
export const AUTH_HINT_PATTERN = /(auth|guard|jwt|session|passport|protected|require|permission|token|acl)/i;
export const GENERIC_TAG_SEGMENTS = new Set(['api']);
export const TS_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];
export const PYTHON_EXTENSIONS = ['.py'];

// ============================================================
// 文件/路径工具
// ============================================================

export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function uniqueStrings(items: Iterable<string>): string[] {
  return [...new Set(
    [...items]
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )];
}

export function getRelativePath(projectRoot: string, filePath: string): string {
  return toPosixPath(path.relative(projectRoot, filePath));
}

export function collectProjectFiles(
  projectRoot: string,
  options: FileCollectionOptions,
): string[] {
  const results: string[] = [];
  const allowedExtensions = new Set((options.extensions ?? []).map((ext) => ext.toLowerCase()));
  const fileNamePattern = options.fileNamePattern;

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      logger.debug(`目录遍历失败，静默跳过: ${dir} — ${String(err)}`);
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(entry.name)) {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const matchesExt = allowedExtensions.size === 0 || allowedExtensions.has(ext);
      const matchesName = fileNamePattern ? fileNamePattern.test(entry.name) : true;
      if (matchesExt && matchesName) {
        results.push(fullPath);
      }
    }
  }

  walk(projectRoot);
  results.sort();
  return results;
}

export function detectProjectName(projectRoot: string): string {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (typeof pkg.name === 'string' && pkg.name.trim().length > 0) {
        return pkg.name.trim();
      }
    } catch (err) {
      logger.debug(`package.json 解析失败，使用默认项目名称: ${String(err)}`);
    }
  }

  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8');
      const match = content.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (match?.[1]) {
        return match[1];
      }
    } catch (err) {
      logger.debug(`pyproject.toml 读取失败，使用默认项目名称: ${String(err)}`);
    }
  }

  return path.basename(projectRoot);
}

// ============================================================
// URL/文本解析工具
// ============================================================

export function joinUrlPaths(...segments: string[]): string {
  const parts: string[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || trimmed === '/') {
      continue;
    }
    const cleaned = trimmed.replace(/^\/+|\/+$/g, '');
    if (cleaned.length > 0) {
      parts.push(cleaned);
    }
  }

  if (parts.length === 0) {
    return '/';
  }

  return `/${parts.join('/')}`.replace(/\/{2,}/g, '/');
}

export function splitTopLevel(text: string, separator = ','): string[] {
  const result: string[] = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escape = false;

  for (const ch of text) {
    if (quote) {
      current += ch;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
    else if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;

    if (
      ch === separator &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      const piece = current.trim();
      if (piece.length > 0) {
        result.push(piece);
      }
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    result.push(tail);
  }

  return result;
}

export function extractBalancedContent(
  text: string,
  openParenIndex: number,
): { content: string; endIndex: number } | null {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escape = false;

  for (let i = openParenIndex; i < text.length; i++) {
    const ch = text[i]!;

    if (quote) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '(') {
      depth++;
      continue;
    }

    if (ch === ')') {
      depth--;
      if (depth === 0) {
        return {
          content: text.slice(openParenIndex + 1, i),
          endIndex: i,
        };
      }
    }
  }

  return null;
}

export function stripWrappingQuotes(text: string): string | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^(["'`])([\s\S]*)\1$/);
  return match ? match[2]! : null;
}

export function getNamedArgumentValue(argsText: string, key: string): string | undefined {
  for (const part of splitTopLevel(argsText)) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = part.slice(0, eqIndex).trim();
    if (name === key) {
      return part.slice(eqIndex + 1).trim();
    }
  }
  return undefined;
}

export function getPositionalArguments(argsText: string): string[] {
  return splitTopLevel(argsText).filter((part) => !/^[a-zA-Z_]\w*\s*=/.test(part));
}

export function extractStringArray(text: string | undefined): string[] {
  if (!text) {
    return [];
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    const single = stripWrappingQuotes(trimmed);
    return single ? [single] : [];
  }

  const inner = trimmed.slice(1, -1);
  return splitTopLevel(inner)
    .map((part) => stripWrappingQuotes(part))
    .filter((item): item is string => item !== null);
}

export function extractDependencyNames(text: string): string[] {
  const names: string[] = [];
  const dependsPattern = /\b(?:Depends|Security)\(\s*([A-Za-z_]\w*)/g;
  let match: RegExpExecArray | null;
  while ((match = dependsPattern.exec(text)) !== null) {
    names.push(match[1]!);
  }
  return uniqueStrings(names);
}

// ============================================================
// 文件读取/模块解析
// ============================================================

export function tryReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    logger.debug(`文件读取失败: ${filePath} — ${String(err)}`);
    return null;
  }
}

export function resolvePythonModulePath(fromFile: string, specifier: string, projectRoot: string): string | null {
  let candidateBase: string;

  if (specifier.startsWith('.')) {
    let level = 0;
    while (specifier[level] === '.') {
      level++;
    }
    let baseDir = path.dirname(fromFile);
    for (let i = 1; i < level; i++) {
      baseDir = path.dirname(baseDir);
    }
    const remainder = specifier.slice(level);
    candidateBase = remainder.length > 0
      ? path.join(baseDir, ...remainder.split('.'))
      : baseDir;
  } else {
    candidateBase = path.join(projectRoot, ...specifier.split('.'));
  }

  const candidates = [
    `${candidateBase}.py`,
    path.join(candidateBase, '__init__.py'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return path.resolve(candidate);
      }
    } catch (err) {
      logger.debug(`Python 模块路径解析失败: ${candidate} — ${String(err)}`);
    }
  }

  return null;
}
