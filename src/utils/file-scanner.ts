/**
 * 文件发现与 .gitignore 过滤
 * 扫描目录中支持的源文件，遵循 .gitignore 规则（FR-026）
 * 支持的扩展名从 LanguageAdapterRegistry 动态获取
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';

/** 通用忽略目录（与语言无关，始终忽略） */
const UNIVERSAL_IGNORE_DIRS = new Set(['.git', 'coverage']);

/**
 * 已知扩展名到语言名称的映射表
 * 用于不支持语言的友好警告（输出人类可读的语言名称）
 */
const KNOWN_LANGUAGE_NAMES: Record<string, string> = {
  '.rs': 'Rust',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.hpp': 'C++',
  '.hxx': 'C++',
  '.c': 'C',
  '.h': 'C/C++',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.scala': 'Scala',
  '.r': 'R',
  '.R': 'R',
  '.pl': 'Perl',
  '.pm': 'Perl',
  '.lua': 'Lua',
  '.hs': 'Haskell',
  '.erl': 'Erlang',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.clj': 'Clojure',
  '.dart': 'Dart',
  '.m': 'Objective-C',
  '.mm': 'Objective-C++',
  '.zig': 'Zig',
  '.nim': 'Nim',
  '.v': 'V',
  '.ml': 'OCaml',
  '.fs': 'F#',
  '.fsx': 'F#',
  '.groovy': 'Groovy',
  '.jl': 'Julia',
};

/**
 * 获取当前有效的忽略目录集合
 * 合并通用忽略目录与 Registry 聚合的适配器忽略目录
 */
function getIgnoreDirs(): Set<string> {
  const registryDirs = LanguageAdapterRegistry.getInstance().getDefaultIgnoreDirs();
  return new Set([...UNIVERSAL_IGNORE_DIRS, ...registryDirs]);
}

/**
 * 获取当前有效的支持扩展名集合
 * 优先使用调用方显式传入的扩展名，否则从 Registry 动态获取
 */
function getSupportedExtensions(options?: ScanOptions): Set<string> {
  if (options?.extensions) return options.extensions;
  return LanguageAdapterRegistry.getInstance().getSupportedExtensions();
}

export interface ScanOptions {
  /** 项目根目录（用于查找 .gitignore） */
  projectRoot?: string;
  /** 额外的忽略模式 */
  extraIgnorePatterns?: string[];
  /** 显式指定支持的扩展名，覆盖 Registry 默认值 */
  extensions?: Set<string>;
}

/** 单种语言在项目中的文件分布统计 */
export interface LanguageFileStat {
  /** 适配器 ID（如 'ts-js', 'python', 'go', 'java'） */
  adapterId: string;
  /** 该语言的文件数量 */
  fileCount: number;
  /** 该语言涉及的文件扩展名列表（如 ['.ts', '.tsx']） */
  extensions: string[];
}

export interface ScanResult {
  /** 发现的文件路径列表（相对于扫描目录，排序后） */
  files: string[];
  /** 扫描的总文件数（含被忽略的） */
  totalScanned: number;
  /** 被忽略的文件数 */
  ignored: number;
  /** 不支持的文件扩展名统计 */
  unsupportedExtensions?: Map<string, number>;
  /** 各已支持语言的文件统计（key 为 adapter.id） */
  languageStats?: Map<string, LanguageFileStat>;
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
  supportedExtensions: Set<string>,
  ignoreDirs: Set<string>,
  results: string[],
  stats: { totalScanned: number; ignored: number },
  unsupported: Map<string, number>,
  languageStats: Map<string, LanguageFileStat>,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // 无法读取的目录静默跳过
    return;
  }

  const registry = LanguageAdapterRegistry.getInstance();

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    // 跳过忽略目录（通用 + Registry 聚合）
    if (entry.isDirectory() && ignoreDirs.has(entry.name)) {
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
      walkDir(fullPath, baseDir, isIgnored, supportedExtensions, ignoreDirs, results, stats, unsupported, languageStats);
    } else if (entry.isFile()) {
      stats.totalScanned++;
      const ext = path.extname(entry.name).toLowerCase();
      if (supportedExtensions.has(ext)) {
        results.push(relativePath);

        // 累加 languageStats（按 adapter.id 分组）
        const adapter = registry.getAdapter(entry.name);
        if (adapter) {
          const existing = languageStats.get(adapter.id);
          if (existing) {
            existing.fileCount++;
            if (!existing.extensions.includes(ext)) {
              existing.extensions.push(ext);
            }
          } else {
            languageStats.set(adapter.id, {
              adapterId: adapter.id,
              fileCount: 1,
              extensions: [ext],
            });
          }
        }
      } else {
        stats.ignored++;
        // 收集不支持的扩展名统计（仅统计有扩展名的文件）
        if (ext) {
          unsupported.set(ext, (unsupported.get(ext) ?? 0) + 1);
        }
      }
    }
  }
}

/**
 * 扫描目录中支持的源文件
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

  // FR-034: Registry 未初始化时给出明确提示
  const registry = LanguageAdapterRegistry.getInstance();
  if (registry.isEmpty() && !options?.extensions) {
    throw new Error(
      'LanguageAdapterRegistry 未注册任何适配器。' +
      '请在使用前调用 bootstrapAdapters() 完成初始化。',
    );
  }

  // 获取当前有效的支持扩展名和忽略目录
  const supportedExtensions = getSupportedExtensions(options);
  const ignoreDirs = getIgnoreDirs();

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
  const unsupportedExtensions = new Map<string, number>();
  const languageStats = new Map<string, LanguageFileStat>();

  walkDir(resolvedDir, resolvedDir, isIgnored, supportedExtensions, ignoreDirs, files, stats, unsupportedExtensions, languageStats);

  // 按字母排序
  files.sort();

  // 输出不支持文件的 warn 级聚合提示到 stderr（含语言名称）
  if (unsupportedExtensions.size > 0) {
    // 按文件数降序排列
    const sorted = [...unsupportedExtensions.entries()].sort((a, b) => b[1] - a[1]);
    const parts: string[] = [];
    for (const [ext, count] of sorted) {
      const langName = KNOWN_LANGUAGE_NAMES[ext];
      if (langName) {
        parts.push(`${count} 个 ${ext} 文件（${langName}，不支持）`);
      } else {
        parts.push(`${count} 个 ${ext} 文件（不支持）`);
      }
    }
    console.warn(`\u26A0 跳过 ${parts.join('、')}`);
  }

  return {
    files,
    totalScanned: stats.totalScanned,
    ignored: stats.ignored,
    unsupportedExtensions: unsupportedExtensions.size > 0 ? unsupportedExtensions : undefined,
    languageStats: languageStats.size > 0 ? languageStats : undefined,
  };
}
