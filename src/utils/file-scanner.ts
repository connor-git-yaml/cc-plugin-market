/**
 * 文件发现与 .gitignore 过滤
 * 扫描目录中的 .ts/.tsx/.js/.jsx 文件，遵循 .gitignore 规则（FR-026）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** 支持的文件扩展名 */
const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** 默认忽略的目录 */
const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
]);

export interface ScanOptions {
  /** 项目根目录（用于查找 .gitignore） */
  projectRoot?: string;
  /** 额外的忽略模式 */
  extraIgnorePatterns?: string[];
}

export interface ScanResult {
  /** 发现的文件路径列表（相对于扫描目录，排序后） */
  files: string[];
  /** 扫描的总文件数（含被忽略的） */
  totalScanned: number;
  /** 被忽略的文件数 */
  ignored: number;
}

/**
 * 解析 .gitignore 文件，返回匹配函数
 * 支持基本的 gitignore 模式：目录、通配符、否定
 */
function parseGitignore(gitignorePath: string): (relativePath: string) => boolean {
  if (!fs.existsSync(gitignorePath)) {
    return () => false;
  }

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const patterns: Array<{ pattern: RegExp; negate: boolean }> = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    // 跳过空行和注释
    if (!line || line.startsWith('#')) continue;

    let negate = false;
    let pattern = line;

    // 否定模式
    if (pattern.startsWith('!')) {
      negate = true;
      pattern = pattern.slice(1);
    }

    // 去除尾部斜杠（目录标记），但记住它是目录模式
    const isDirPattern = pattern.endsWith('/');
    if (isDirPattern) {
      pattern = pattern.slice(0, -1);
    }

    // 转换 glob 模式为正则
    const regexStr = globToRegex(pattern, isDirPattern);
    patterns.push({ pattern: new RegExp(regexStr), negate });
  }

  return (relativePath: string): boolean => {
    let ignored = false;
    for (const { pattern, negate } of patterns) {
      if (pattern.test(relativePath)) {
        ignored = !negate;
      }
    }
    return ignored;
  };
}

/**
 * 将简单 glob 模式转换为正则表达式
 */
function globToRegex(pattern: string, isDirPattern: boolean): string {
  let regex = '';

  // 如果模式不包含 /，则匹配任何路径层级中的文件名
  const matchAnywhere = !pattern.includes('/');

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // ** 匹配任意路径
        regex += '.*';
        i++; // 跳过第二个 *
        if (pattern[i + 1] === '/') {
          i++; // 跳过 /
        }
      } else {
        // * 匹配非 / 的字符
        regex += '[^/]*';
      }
    } else if (char === '?') {
      regex += '[^/]';
    } else if (char === '.') {
      regex += '\\.';
    } else {
      regex += char;
    }
  }

  if (matchAnywhere) {
    // 匹配路径任意位置：作为完整路径段或文件名
    if (isDirPattern) {
      return `(^|/)${regex}(/|$)`;
    }
    return `(^|/)${regex}$`;
  }

  // 以 / 开头的模式只匹配根路径
  if (isDirPattern) {
    return `^${regex}(/|$)`;
  }
  return `^${regex}$`;
}

/**
 * 递归扫描目录，收集符合条件的文件
 */
function walkDir(
  dir: string,
  baseDir: string,
  isIgnored: (relativePath: string) => boolean,
  results: string[],
  stats: { totalScanned: number; ignored: number },
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // 无法读取的目录静默跳过
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    // 跳过默认忽略目录
    if (entry.isDirectory() && DEFAULT_IGNORE_DIRS.has(entry.name)) {
      continue;
    }

    // 跳过符号链接
    if (entry.isSymbolicLink()) {
      continue;
    }

    // 检查 .gitignore 规则
    if (isIgnored(relativePath)) {
      stats.ignored++;
      continue;
    }

    if (entry.isDirectory()) {
      walkDir(fullPath, baseDir, isIgnored, results, stats);
    } else if (entry.isFile()) {
      stats.totalScanned++;
      const ext = path.extname(entry.name);
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        results.push(relativePath);
      } else {
        stats.ignored++;
      }
    }
  }
}

/**
 * 扫描目录中的 TS/JS 文件
 *
 * @param targetDir - 扫描的目标目录
 * @param options - 扫描选项
 * @returns 排序后的文件路径列表和统计信息
 */
export function scanFiles(targetDir: string, options?: ScanOptions): ScanResult {
  const resolvedDir = path.resolve(targetDir);

  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`目录不存在: ${resolvedDir}`);
  }

  if (!fs.statSync(resolvedDir).isDirectory()) {
    throw new Error(`路径不是目录: ${resolvedDir}`);
  }

  // 解析 .gitignore
  const projectRoot = options?.projectRoot ?? resolvedDir;
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const gitignoreCheck = parseGitignore(gitignorePath);

  // 合并额外忽略模式
  const extraPatterns = (options?.extraIgnorePatterns ?? []).map((p) => {
    const regex = globToRegex(p, false);
    return new RegExp(regex);
  });

  const isIgnored = (relativePath: string): boolean => {
    if (gitignoreCheck(relativePath)) return true;
    return extraPatterns.some((r) => r.test(relativePath));
  };

  const files: string[] = [];
  const stats = { totalScanned: 0, ignored: 0 };

  walkDir(resolvedDir, resolvedDir, isIgnored, files, stats);

  // 按字母排序
  files.sort();

  return {
    files,
    totalScanned: stats.totalScanned,
    ignored: stats.ignored,
  };
}
