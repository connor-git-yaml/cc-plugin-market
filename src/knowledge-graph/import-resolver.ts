/**
 * Feature 152 — 通用 Import Path 智能解析模块
 *
 * 提供 Python + TypeScript/JavaScript 的 import 路径解析能力，
 * 供 collectPythonCodeSkeletons（P3）和 collectTsJsCodeSkeletons（P4）调用。
 *
 * 设计原则：
 * - 纯函数（pure function），无状态，零新 npm 依赖（CL-01）
 * - 所有 resolvedPath 输出为相对 projectRoot 的 POSIX 路径（W-5 修复）
 * - 解析失败时返回 { resolvedPath: null, kind: 'unresolved' }，不抛异常（FR-2.4）
 *
 * 修复说明（Codex V3 对抗审查通过后的完整修订）：
 * - C-1：from . import nn 由 collect 层拆解为 ".nn" 后调用 resolver
 * - C-2：alias-like 前缀（~/、#/、$/、@/）无 paths 命中时返回 unresolved
 * - C-5 + N-2：isInsideProjectRoot 逐 path component 判断，避免字典序误判
 * - W-1：相对路径指向 .json / .d.ts 文件时返回 external
 * - W-5：所有 resolvedPath 输出 POSIX 格式（toPosix 包裹）
 */

import * as fs from 'fs';
import * as path from 'path';

// ───────────────────────────────────────────────────────────
// Public Types
// ───────────────────────────────────────────────────────────

/**
 * import 路径解析结果。
 * resolvedPath 为相对 projectRoot 的 POSIX 路径；external/unresolved 时为 null。
 */
export interface ResolveResult {
  /**
   * 解析后的目标文件路径，相对于 projectRoot 的 POSIX 相对路径。
   * 未命中（external / unresolved）时为 null。
   */
  resolvedPath: string | null;
  kind:
    | 'module' // Python: pkg.engine → pkg/engine.py
    | 'package-init' // Python: from pkg import X → pkg/__init__.py
    | 'relative-sibling' // Python: 相对 import（含祖先包 from .. import）
    | 'relative' // TS: ./engine、../utils
    | 'paths-alias' // TS: tsconfig.compilerOptions.paths 命中
    | 'absolute' // TS: baseUrl 解析或磁盘绝对路径
    | 'external' // 明确外部包（npm / Python stdlib）
    | 'unresolved'; // 解析失败/文件不存在/越过 projectRoot
}

/**
 * TypeScript/JavaScript tsconfig.json 解析上下文。
 * 由 findNearestTsConfig + buildTsConfigContext 协作生成。
 */
export interface TsConfigResolutionContext {
  /** tsconfig.json 所在目录的绝对路径 */
  configDir: string;
  /**
   * baseUrl 配置。
   * - 用户未配置 baseUrl → null（跳过 baseUrl 解析）
   * - 用户配置了 baseUrl → 相对 configDir 的字符串（如 "."、"src"）
   */
  baseUrl: string | null;
  /** paths 映射（含 wildcard），key/value 保留原始 tsconfig 字符串 */
  paths: Map<string, string[]>;
}

// ───────────────────────────────────────────────────────────
// 常量
// ───────────────────────────────────────────────────────────

/**
 * Python 标准库内置模块集合（plan §5.1 完整列表）。
 * 调用 resolvePythonImport 时，topModule 在此集合内则返回 external。
 */
const PYTHON_BUILTINS: ReadonlySet<string> = new Set([
  'os',
  'sys',
  're',
  'io',
  'json',
  'math',
  'time',
  'datetime',
  'collections',
  'itertools',
  'functools',
  'pathlib',
  'typing',
  'abc',
  'copy',
  'string',
  'struct',
  'socket',
  'threading',
  'subprocess',
  'logging',
  'unittest',
  'hashlib',
  'base64',
  'random',
  'operator',
  'contextlib',
  'weakref',
  'inspect',
  'ast',
  'dis',
  'gc',
  'importlib',
  'types',
  'enum',
  'dataclasses',
  'warnings',
  'traceback',
  'pprint',
  'heapq',
  'bisect',
  'array',
  'queue',
  'shutil',
  'glob',
  'fnmatch',
  'tempfile',
  'pickle',
  'csv',
  'html',
  'http',
  'urllib',
  'email',
  'xml',
  'sqlite3',
  'zlib',
  'gzip',
  'tarfile',
  'zipfile',
  'argparse',
  'textwrap',
  'decimal',
  'fractions',
  'statistics',
  'cmath',
  'secrets',
  'uuid',
  'platform',
  'signal',
  'mmap',
  'concurrent',
  'asyncio',
  'select',
  'ssl',
  'configparser',
  'tomllib',
  'gettext',
  'locale',
  'curses',
  'readline',
  'rlcompleter',
]);

/** TS/JS 候补扩展名顺序（plan §5.2） */
const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

/** TS/JS index 文件候补后缀 */
const TS_INDEX_SUFFIXES = TS_EXTENSIONS.map((ext) => `/index${ext}`);

/** alias-like 前缀列表（C-2 修复）：以这些前缀开头的 moduleSpec 无 paths 命中时返回 unresolved */
const ALIAS_PREFIXES = ['~/', '#/', '$/'] as const;

// ───────────────────────────────────────────────────────────
// 内部辅助函数
// ───────────────────────────────────────────────────────────

/**
 * 将路径转换为 POSIX 格式（W-5 修复）。
 * 确保跨平台 resolvedPath 始终使用 '/' 分隔符。
 */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * 判断 candidate 路径是否严格在 projectRoot 子树内（C-5 + N-2 修复）。
 *
 * 使用 path.relative 计算相对路径，然后逐 path component 检查第一段是否为 '..'，
 * 避免字典序误判（如 /proj 与 /projection 的关系）。
 *
 * 注意：candidate === projectRoot 时返回 false（projectRoot 自身不算"在子树内"）。
 */
function isInsideProjectRoot(candidate: string, projectRoot: string): boolean {
  const rel = path.relative(projectRoot, candidate);
  // candidate 与 projectRoot 完全相同
  if (rel.length === 0) return false;
  // 跨盘符（Windows）
  if (path.isAbsolute(rel)) return false;
  // 逐 component 检查：第一段为 '..' 则越界
  // 注意：rel='..cache/a.ts' 时 firstSeg='..cache'，不为 '..'，正确判定为子树内（N-2 修复）
  const firstSeg = rel.split(path.sep)[0];
  if (firstSeg === '..') return false;
  return true;
}

/**
 * 判断路径是否指向非源文件目标（W-1 修复）。
 * .json 和 .d.ts 文件不进入 callSites graph，返回 external。
 */
function isNonSourceTarget(p: string): boolean {
  return p.endsWith('.json') || p.endsWith('.d.ts');
}

/**
 * 统计字符串前缀中 '.' 的个数（用于 Python 相对 import level 计算）。
 */
function countLeadingDots(moduleSpec: string): number {
  let count = 0;
  for (const ch of moduleSpec) {
    if (ch === '.') count++;
    else break;
  }
  return count;
}

// ───────────────────────────────────────────────────────────
// Public API — resolvePythonImport
// ───────────────────────────────────────────────────────────

/**
 * 解析 Python import 路径。
 *
 * 支持 5 种场景（plan §5.1）：
 * 1. 绝对包路径（`pkg.engine` → `pkg/engine.py`）
 * 2. `__init__.py` 兜底（包目录 import）
 * 3. 相对 import（level ≥ 1，PEP 328：上溯 level-1 级目录）
 * 4. 祖先包 import（from .. import X）
 * 5. Python stdlib 内置模块返回 external
 *
 * C-1 修复说明：moduleSpec="." 时 stripped 为空，resolver 仅返回 __init__.py；
 * collect 层须把 "from . import nn" 拆解为 resolvePythonImport(".nn", callerFile, root)。
 *
 * @param moduleSpec - import 说明符（如 "micrograd.engine"、".nn"、"..pkg"）
 * @param callerFile  - 调用方文件的绝对路径
 * @param projectRoot - 项目根目录绝对路径
 * @returns ResolveResult（resolvedPath 为相对 projectRoot 的 POSIX 路径）
 */
export function resolvePythonImport(
  moduleSpec: string,
  callerFile: string,
  projectRoot: string,
): ResolveResult {
  const level = countLeadingDots(moduleSpec);
  const stripped = moduleSpec.slice(level); // 去掉前导点

  if (level > 0) {
    // PEP 328：from .X import Y → level=1，上溯 (level-1)=0 级，baseDir = callerFile 所在目录
    // from ..X import Y → level=2，上溯 1 级
    let baseDir = path.dirname(callerFile);
    for (let i = 0; i < level - 1; i++) {
      const parent = path.dirname(baseDir);
      // C-5 修复：检查越界，使用 isInsideProjectRoot 而非字典序
      if (!isInsideProjectRoot(baseDir, projectRoot) && baseDir !== projectRoot) {
        return { resolvedPath: null, kind: 'unresolved' };
      }
      baseDir = parent;
      // 上溯后再检查是否越界
      if (!isInsideProjectRoot(baseDir, projectRoot) && baseDir !== projectRoot) {
        return { resolvedPath: null, kind: 'unresolved' };
      }
    }

    // C-1 修复：stripped 为空时，仅返回 baseDir/__init__.py（包级 import）
    if (stripped === '') {
      const candidate = path.join(baseDir, '__init__.py');
      if (fs.existsSync(candidate)) {
        return {
          resolvedPath: toPosix(path.relative(projectRoot, candidate)),
          kind: 'relative-sibling',
        };
      }
      return { resolvedPath: null, kind: 'unresolved' };
    }

    // `from .submodule import X` 或 `from ..pkg import X`
    const parts = stripped.split('.');
    const candidate1 = path.join(baseDir, ...parts) + '.py';
    const candidate2 = path.join(baseDir, ...parts, '__init__.py');

    for (const candidate of [candidate1, candidate2]) {
      if (fs.existsSync(candidate)) {
        return {
          resolvedPath: toPosix(path.relative(projectRoot, candidate)),
          kind: 'relative-sibling',
        };
      }
    }
    return { resolvedPath: null, kind: 'unresolved' };
  }

  // 绝对 import（无前导点）
  const topModule = moduleSpec.split('.')[0] ?? '';

  // Python stdlib 内置模块
  if (PYTHON_BUILTINS.has(topModule)) {
    return { resolvedPath: null, kind: 'external' };
  }

  // dotted path → 文件路径
  const parts = moduleSpec.split('.');
  const candidate1 = path.join(projectRoot, ...parts) + '.py'; // pkg/engine.py
  const candidate2 = path.join(projectRoot, ...parts, '__init__.py'); // pkg/engine/__init__.py

  for (const candidate of [candidate1, candidate2]) {
    if (fs.existsSync(candidate)) {
      const kind = candidate.endsWith('__init__.py') ? 'package-init' : 'module';
      // W-5 修复：Python absolute import 命中分支也必须 POSIX 化
      return {
        resolvedPath: toPosix(path.relative(projectRoot, candidate)),
        kind,
      };
    }
  }

  return { resolvedPath: null, kind: 'unresolved' };
}

// ───────────────────────────────────────────────────────────
// Public API — resolveTsJsImport
// ───────────────────────────────────────────────────────────

/**
 * 解析 TypeScript/JavaScript import 路径。
 *
 * 支持 4 种场景（plan §5.2）：
 * 1. 相对路径（`./engine`、`../utils`）按 .ts → .tsx → .js → .jsx → /index.ts 顺序候补
 * 2. tsconfig paths alias（精确 key + wildcard，多 candidates 按数组顺序）
 * 3. baseUrl 解析（baseUrl != null 时）
 * 4. 外部包（npm bare 包名 / scoped 包）→ external
 *
 * 修复：
 * - W-1：相对路径指向 .json / .d.ts 文件时返回 external（不入 callSites graph）
 * - C-2：alias-like 前缀（~/、#/、$/、@/）无 paths 命中时返回 unresolved
 *
 * @param moduleSpec      - import 说明符（如 "./engine"、"~/utils"、"express"）
 * @param callerFile      - 调用方文件的绝对路径
 * @param projectRoot     - 项目根目录绝对路径
 * @param tsConfigContext - tsconfig 解析上下文（null/undefined 时仅走相对路径）
 * @returns ResolveResult
 */
export function resolveTsJsImport(
  moduleSpec: string,
  callerFile: string,
  projectRoot: string,
  tsConfigContext?: TsConfigResolutionContext | null,
): ResolveResult {
  // 磁盘绝对路径（罕见）
  if (moduleSpec.startsWith('/')) {
    for (const ext of TS_EXTENSIONS) {
      const candidate = moduleSpec + ext;
      if (fs.existsSync(candidate)) {
        // Codex final C-4 修复：候选必须在 projectRoot 内，否则 unresolved 防止 graph 污染
        if (!isInsideProjectRoot(candidate, projectRoot)) {
          return { resolvedPath: null, kind: 'unresolved' };
        }
        return {
          resolvedPath: toPosix(path.relative(projectRoot, candidate)),
          kind: 'absolute',
        };
      }
    }
    return { resolvedPath: null, kind: 'unresolved' };
  }

  // 相对路径（./ 或 ../）
  if (moduleSpec.startsWith('./') || moduleSpec.startsWith('../')) {
    // W-1 修复：moduleSpec 自身已带 .json / .d.ts 后缀 → external
    if (isNonSourceTarget(moduleSpec)) {
      return { resolvedPath: null, kind: 'external' };
    }

    const base = path.resolve(path.dirname(callerFile), moduleSpec);

    // 按 .ts → .tsx → .js → .jsx 顺序候补
    for (const ext of TS_EXTENSIONS) {
      if (fs.existsSync(base + ext)) {
        // Codex final C-4 修复：候选必须在 projectRoot 内
        if (!isInsideProjectRoot(base + ext, projectRoot)) {
          return { resolvedPath: null, kind: 'unresolved' };
        }
        return {
          resolvedPath: toPosix(path.relative(projectRoot, base + ext)),
          kind: 'relative',
        };
      }
    }

    // 按 /index.ts → /index.tsx 等顺序候补
    for (const suffix of TS_INDEX_SUFFIXES) {
      if (fs.existsSync(base + suffix)) {
        // Codex final C-4 修复：候选必须在 projectRoot 内
        if (!isInsideProjectRoot(base + suffix, projectRoot)) {
          return { resolvedPath: null, kind: 'unresolved' };
        }
        return {
          resolvedPath: toPosix(path.relative(projectRoot, base + suffix)),
          kind: 'relative',
        };
      }
    }

    // 候补失败但 base 路径本身是 .json / .d.ts → 双保险 external
    if (isNonSourceTarget(base)) {
      return { resolvedPath: null, kind: 'external' };
    }

    return { resolvedPath: null, kind: 'unresolved' };
  }

  // 非相对路径：先尝试 paths alias，再 baseUrl，再判定 external
  if (tsConfigContext) {
    // Codex P0 C-1 修复：paths 必须**精确 key 优先于 wildcard**，不依赖 Map 插入顺序
    // 否则用户 tsconfig 中 wildcard 排在 exact 前会先命中 wildcard
    const exactEntries: Array<[string, string[]]> = [];
    const wildcardEntries: Array<[string, string[]]> = [];
    for (const [pattern, replacements] of tsConfigContext.paths) {
      if (pattern.includes('*')) {
        wildcardEntries.push([pattern, replacements]);
      } else {
        exactEntries.push([pattern, replacements]);
      }
    }
    const orderedPathsEntries = [...exactEntries, ...wildcardEntries];

    for (const [pattern, replacements] of orderedPathsEntries) {
      const matched = matchPathsPattern(moduleSpec, pattern);
      if (matched !== null) {
        const tail = matched; // wildcard 截断后的尾缀（精确 key 时为 ''）
        for (const replacement of replacements) {
          // 替换 wildcard：精确 key 时 replacement 不含 '*'，直接使用
          const resolved = replacement.includes('*')
            ? replacement.replace('*', tail)
            : replacement;

          // Codex final C-3 修复：paths replacement 必须叠加 baseUrl（TypeScript 官方语义）
          // 标准模式：baseUrl="src", paths={"@/*": ["*"]} → "@/foo" 解析为 "<configDir>/src/foo"
          // 实施：absBase = configDir + (baseUrl ?? '.') + replacement
          const baseUrl = typeof tsConfigContext.baseUrl === 'string' ? tsConfigContext.baseUrl : '.';
          const absBase = path.resolve(tsConfigContext.configDir, baseUrl, resolved);

          for (const ext of TS_EXTENSIONS) {
            if (fs.existsSync(absBase + ext)) {
              return {
                resolvedPath: toPosix(path.relative(projectRoot, absBase + ext)),
                kind: 'paths-alias',
              };
            }
          }
          for (const suffix of TS_INDEX_SUFFIXES) {
            if (fs.existsSync(absBase + suffix)) {
              return {
                resolvedPath: toPosix(path.relative(projectRoot, absBase + suffix)),
                kind: 'paths-alias',
              };
            }
          }
        }
      }
    }

    // baseUrl 解析（仅 baseUrl 是字符串时）
    // Codex P0 C-2 修复：用 typeof 严格判断，避免 TS 类型签名 string|null 之外 undefined 误穿透
    if (typeof tsConfigContext.baseUrl === 'string') {
      const absBase = path.resolve(tsConfigContext.configDir, tsConfigContext.baseUrl, moduleSpec);
      for (const ext of TS_EXTENSIONS) {
        if (fs.existsSync(absBase + ext)) {
          return {
            resolvedPath: toPosix(path.relative(projectRoot, absBase + ext)),
            kind: 'absolute',
          };
        }
      }
      for (const suffix of TS_INDEX_SUFFIXES) {
        if (fs.existsSync(absBase + suffix)) {
          return {
            resolvedPath: toPosix(path.relative(projectRoot, absBase + suffix)),
            kind: 'absolute',
          };
        }
      }
    }
  }

  // C-2 修复：区分 alias-like（unresolved）与 bare npm package（external）
  // alias-like 前缀：~/、#/、$/
  if (ALIAS_PREFIXES.some((p) => moduleSpec.startsWith(p))) {
    return { resolvedPath: null, kind: 'unresolved' };
  }
  // @/foo（非 scoped 风格的 alias，区别于 @org/lib 这样的 scoped npm 包）
  if (moduleSpec.startsWith('@/')) {
    return { resolvedPath: null, kind: 'unresolved' };
  }

  // 合法 npm 包判定
  const firstSeg = moduleSpec.split('/')[0] ?? '';
  const isScoped = firstSeg.startsWith('@');
  if (isScoped) {
    // scoped 包形如 @org/lib — 首段以 @ 开头，且含 '/'（至少两段）
    return { resolvedPath: null, kind: 'external' };
  }
  // bare npm 包名规则：[a-z0-9][a-z0-9-_.]*
  if (/^[a-z0-9][a-z0-9-_.]*$/.test(firstSeg)) {
    return { resolvedPath: null, kind: 'external' };
  }

  // 含 '/' 但首段不是合法 npm 包名 → alias-like 配置缺失
  return { resolvedPath: null, kind: 'unresolved' };
}

/**
 * 匹配 tsconfig paths pattern（精确 key + wildcard）。
 *
 * @param moduleSpec - 被解析的 import 说明符
 * @param pattern    - tsconfig paths 中的 key（如 "~/*"、"react"）
 * @returns null（不匹配），或 wildcard 截取的尾缀字符串（精确 key 时为 ''）
 */
function matchPathsPattern(moduleSpec: string, pattern: string): string | null {
  if (pattern.includes('*')) {
    // wildcard 模式：将 * 前的部分作为前缀，* 后的部分作为后缀
    const starIdx = pattern.indexOf('*');
    const prefix = pattern.slice(0, starIdx);
    const suffix = pattern.slice(starIdx + 1);
    if (moduleSpec.startsWith(prefix) && moduleSpec.endsWith(suffix)) {
      const tail = moduleSpec.slice(prefix.length, moduleSpec.length - suffix.length);
      return tail;
    }
    return null;
  } else {
    // 精确 key 匹配
    if (moduleSpec === pattern) return '';
    return null;
  }
}

// ───────────────────────────────────────────────────────────
// Public API — findNearestTsConfig
// ───────────────────────────────────────────────────────────

/**
 * 从 filePath 向上查找最近的 tsconfig.json（plan §5.3 + C-5 修复）。
 *
 * 上溯范围：从 path.dirname(filePath) 向上，直到 projectRoot 边界（含 projectRoot 本身）。
 * 越过 projectRoot 则停止，不抛异常。
 *
 * @param filePath    - 起始文件的绝对路径
 * @param projectRoot - 不超过此目录，超过则返回 null
 * @returns { configDir: string, rawConfig: Record<string, unknown> } | null
 */
export function findNearestTsConfig(
  filePath: string,
  projectRoot: string,
): { configDir: string; rawConfig: Record<string, unknown> } | null {
  let dir = path.dirname(filePath);

  // Codex P0 C-3 修复：边界检查必须先于 fs.existsSync，否则
  // `/proj` vs `/projection` 场景中可能先读取越界路径的 tsconfig.json
  // 算法：每轮先验证 dir 是否仍在 projectRoot 子树内（或恰好等于 projectRoot），
  // 通过后才允许 candidate 文件系统检查
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // 边界检查（先于 fs 操作）：dir 必须等于 projectRoot 或在其子树内
    if (dir !== projectRoot && !isInsideProjectRoot(dir, projectRoot)) {
      break;
    }

    const candidate = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(candidate)) {
      // quality-review CRITICAL 修复：JSON.parse 必须包 try/catch
      // 损坏的 tsconfig.json（含注释 / 语法错误）不应抛异常吞掉整个 collect 流程，
      // 应继续上溯查找有效的 tsconfig（与 FR-2.4 "解析失败返回 unresolved 不抛异常" 同精神）
      try {
        const rawConfig = JSON.parse(
          fs.readFileSync(candidate, 'utf8') as string,
        ) as Record<string, unknown>;
        return { configDir: dir, rawConfig };
      } catch {
        // 损坏的 tsconfig.json — 视为不存在，继续向上查找
      }
    }

    // 若当前 dir 已是 projectRoot，不再继续上溯
    if (dir === projectRoot) break;

    const parent = path.dirname(dir);
    // 防止无限循环（到达文件系统根时 dirname 不再变化）
    if (parent === dir) break;

    dir = parent;
  }

  return null;
}

// ───────────────────────────────────────────────────────────
// Public API — buildTsConfigContext
// ───────────────────────────────────────────────────────────

/**
 * 将 findNearestTsConfig 返回的 rawConfig 转换为 TsConfigResolutionContext。
 *
 * 处理规则（T-021a）：
 * 1. 读取 rawConfig.compilerOptions.baseUrl（缺省时为 null）
 * 2. 读取 rawConfig.compilerOptions.paths → Map<string, string[]>（缺省时为空 Map）
 * 3. 写入 configDir（由调用方传入，findNearestTsConfig 提供）
 * 4. 不处理 extends 链（YAGNI，CL-04）
 *
 * @param rawConfig  - tsconfig.json 的原始 JSON 对象
 * @param configDir  - tsconfig.json 所在目录的绝对路径
 * @returns TsConfigResolutionContext
 */
export function buildTsConfigContext(
  rawConfig: Record<string, unknown>,
  configDir: string,
): TsConfigResolutionContext {
  const compilerOptions =
    typeof rawConfig.compilerOptions === 'object' && rawConfig.compilerOptions !== null
      ? (rawConfig.compilerOptions as Record<string, unknown>)
      : {};

  // baseUrl：字符串或 null
  const baseUrl =
    typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : null;

  // paths：对象转 Map<string, string[]>
  const paths = new Map<string, string[]>();
  if (typeof compilerOptions.paths === 'object' && compilerOptions.paths !== null) {
    for (const [key, value] of Object.entries(compilerOptions.paths as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        paths.set(key, value as string[]);
      }
    }
  }

  return { configDir, baseUrl, paths };
}
