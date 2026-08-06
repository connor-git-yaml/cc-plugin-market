/**
 * 文件发现与 git 忽略过滤
 *
 * 扫描目录中支持的源文件，遵循 git 忽略规则（FR-026）。忽略判定委托
 * `./gitignore-oracle.ts`，那里的事实源**不是一个而是两个**——`git ls-files --others
 * --ignored --directory`（回答"盘上有哪些被忽略的未跟踪条目"）与 `git check-ignore`
 * （回答"规则是否命中"，权威但非全域）；非 git 上下文回退到根 `.gitignore` 的近似解析。
 * 各自的盲区与 KL-1..KL-6 已知限制逐条登记在 `gitignore-oracle.ts` 文件头，
 * 本文件不复述、也不得再写成"以 git 本体为事实源"这类笼统表述（F258 撤下的 over-claim：
 * 那句话把两个回答不同问题的命令混为一谈，正是缺陷 1 的病灶）。
 *
 * 支持的扩展名从 LanguageAdapterRegistry 动态获取。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';
import { surfaceMatchesFile, type CollectorPipelineSurface } from '../collector-surface.js';
import { createGitignoreFilter, globToRegex } from './gitignore-oracle.js';

// 忽略判定 oracle 已搬出到 ./gitignore-oracle.ts；此处重导出保持既有 import 点零改动。
export { createGitignoreFilter } from './gitignore-oracle.js';

/** 通用忽略目录（与语言无关，始终忽略） */
const UNIVERSAL_IGNORE_DIRS = new Set([
  // VCS
  '.git',
  // 测试产物和覆盖率
  'coverage',
  // 本工具的输出目录
  'specs',
  // 构建产物
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  // 第三方打包产物和依赖
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  // 示例/文档代码（通常不是核心源码）
  'examples',
  'example',
  'worked',
  'fixtures',
  '__fixtures__',
  'testdata',
  'test-fixtures',
  // CI/CD 和工具配置
  '.cache',
  '.parcel-cache',
  '.turbo',
]);

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

  // 本扫描器按 `extname().toLowerCase()` 匹配，故语义为 case-insensitive（显式化既有事实）。
  const surface: CollectorPipelineSurface = {
    extensions: supportedExtensions,
    matchSemantics: 'case-insensitive',
  };

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
      // ext 保留：下方 languageStats 分组与 unsupported 统计仍以它为键（判定本身已交给 surface）
      const ext = path.extname(entry.name).toLowerCase();
      if (surfaceMatchesFile(surface, entry.name)) {
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
      '请在使用前调用 bootstrapRuntime（src/runtime-bootstrap.ts）完成初始化。',
    );
  }

  // 获取当前有效的支持扩展名和忽略目录
  const supportedExtensions = getSupportedExtensions(options);
  const ignoreDirs = getIgnoreDirs();

  // 解析忽略规则：显式把 walk 基准（resolvedDir）传给 oracle。
  // walkDir 的 relativePath 相对 resolvedDir，若 git 模式仍以 projectRoot 为基准取清单，
  // scanRoot != projectRoot 时（如 module-derivation.ts 的 scanRoot=src）查找会系统性 MISS
  // → 过滤静默失效。回退模式下仍读 projectRoot 根 .gitignore，行为与修复前一致。
  const projectRoot = options?.projectRoot ?? resolvedDir;
  const gitignoreCheck = createGitignoreFilter(projectRoot, resolvedDir);

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
