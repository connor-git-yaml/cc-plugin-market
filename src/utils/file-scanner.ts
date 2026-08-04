/**
 * 文件发现与 git 忽略过滤
 * 扫描目录中支持的源文件，遵循 git 忽略规则（FR-026）——git 仓库内以 git 本体为事实源，
 * 非 git 上下文回退到根 .gitignore 的近似解析（见 createGitignoreFilter）
 * 支持的扩展名从 LanguageAdapterRegistry 动态获取
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';
import { surfaceMatchesFile, type CollectorPipelineSurface } from '../collector-surface.js';

/** git 只读命令输出上限（与 source-commit.ts 的 MAX_GIT_OUTPUT_BYTES 同语义：防大仓库输出触发 ENOBUFS）。 */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

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

/** git 预取的忽略清单：精确文件条目 + 整目录忽略前缀。 */
interface GitIgnoredIndex {
  /** 逐条列出的被忽略文件（相对 walkBase，POSIX 分隔符）。 */
  files: ReadonlySet<string>;
  /** 整目录被忽略的前缀（已去尾斜杠）。 */
  dirPrefixes: readonly string[];
}

/**
 * 一次性预取"被忽略的 untracked 文件 + 整目录"清单，返回 null 表示非 git 上下文或命令失败。
 *
 * 为什么用 `--directory` 而不逐路径 `git check-ignore`：walk 每个路径起一个子进程性能不可接受；
 * 预取后过滤函数退化为纯查找，每次构造只付一个 git 进程（~10-40ms）。
 *
 * 输出形态（实测）：纯 ignored 目录折叠为 `dir/` 一条；模式命中的目录可能同时出现 `dir/`
 * 与其内文件条目（冗余无害，两种形态都会被下面的查找命中）。
 */
function readGitIgnoredIndex(walkBase: string): GitIgnoredIndex | null {
  let raw: string;
  try {
    raw = execFileSync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'],
      { cwd: walkBase, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_GIT_OUTPUT_BYTES },
    );
  } catch {
    return null;
  }

  const files = new Set<string>();
  const dirPrefixes: string[] = [];
  for (const entry of raw.split('\x00')) {
    if (entry.length === 0) continue;
    if (entry.endsWith('/')) {
      dirPrefixes.push(entry.slice(0, -1));
    } else {
      files.add(entry);
    }
  }
  return { files, dirPrefixes };
}

/** 把 git 预取清单包成查找函数：命中精确条目、等于目录前缀、或落在目录前缀之下均视为忽略。 */
function createGitIgnoredLookup(index: GitIgnoredIndex): (relativePath: string) => boolean {
  return (relativePath: string): boolean => {
    const normalized = relativePath.split(path.sep).join('/');
    if (normalized.length === 0) return false;
    if (index.files.has(normalized)) return true;
    return index.dirPrefixes.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
    );
  };
}

/**
 * 创建 .gitignore 过滤器（单一事实源）
 * 供 python-adapter 及 batch-orchestrator 的自写 walk 叠加接入。
 *
 * F255：git 仓库内的忽略判定改以 git 本体为事实源（`git ls-files --others --ignored
 * --exclude-standard --directory`），与 freshness dirty 判定侧的 `git status` 同源。
 * 手写的根 `.gitignore` 近似解析器拿不到嵌套 `.gitignore`、`.git/info/exclude`、全局
 * excludesFile 与 tracked 豁免——采集面与 dirty 观测面因此分叉，被嵌套规则覆盖的文件
 * 会入图却永判 fresh（隐性漏报）。
 *
 * 非 git 上下文 / git 命令失败时回退到原根 `.gitignore` 解析（逐字节保持既有行为）。
 * 这是维度收窄的 fail-open：根规则仍生效，仅嵌套保真度降级到修复前水平；而非 git 上下文
 * 的 freshness 本就在 `resolveSourceCommit` 处短路为 unknown-provenance，不存在错配面。
 *
 * 基准契约：返回的过滤函数期望输入**相对 walkBase 的路径**（git 模式下 `git ls-files`
 * 的输出基准即命令 cwd；回退模式下沿用 projectRoot 根解析）。walkBase 缺省等于
 * projectRoot，两个基准重合，四处既有单参调用点语义不变。
 *
 * walkBase != projectRoot 时：git 模式下清单基准与查询基准对齐，F194 遗留的基准错位怪癖
 * 自然痊愈；回退模式下该怪癖原样保留（规则取自 projectRoot 根、路径却相对 walkBase），
 * 与修复前行为一致——本次不修也不放大。
 *
 * @param projectRoot - 项目根目录（回退模式下定位 .gitignore；亦是 `.git` 存在性诊断的基准）
 * @param walkBase - walk 的实际扫描根，即过滤函数入参的相对路径基准，缺省等于 projectRoot
 * @returns 过滤函数：接受相对 walkBase 的路径，返回 true 表示应被忽略
 */
export function createGitignoreFilter(
  projectRoot: string,
  walkBase: string = projectRoot,
): (relativePath: string) => boolean {
  const index = readGitIgnoredIndex(walkBase);
  if (index !== null) {
    return createGitIgnoredLookup(index);
  }

  // git 仓库内却拿不到清单属于异常降级，必须出声——静默回退会让漏报重新变得不可见
  if (fs.existsSync(path.join(projectRoot, '.git'))) {
    console.warn('⚠ git 仓库内忽略清单预取失败，已降级为仅根 .gitignore 近似过滤');
  }
  return parseGitignore(path.resolve(projectRoot, '.gitignore'));
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
