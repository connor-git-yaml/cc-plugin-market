/**
 * import-resolver.ts — TS/JS import specifier 单一权威解析（Feature 181 收口）
 *
 * 背景（Feature 181 单一权威收口）：
 *   历史上 `core/import-resolver.ts` 与 `knowledge-graph/import-resolver.ts` 各有一份
 *   `resolveTsJsImport`，行为分叉（core 返回绝对路径无 projectRoot 守卫 + ESM ext map；
 *   kg 返回相对 POSIX + kind + isInsideProjectRoot 守卫）。两者经 AST 路径
 *   （ast-analyzer / tree-sitter-*）与 batch 路径（collect / module-derivation）都进 graph.json。
 *   本模块收口为唯一权威实现，合并两侧能力：
 *     - 相对解析：ESM ext map（`./foo.js`→`foo.ts`）+ 直接命中 + .mjs/.cjs（源自 core）
 *     - alias/baseUrl：tsconfig paths（最长前缀 + 多候选 + baseUrl 叠加，TS 官方语义）
 *     - projectRoot 边界守卫（防图污染，源自 kg；relative / disk-absolute 分支启用）
 *     - kind 分类 + external/unresolved 区分 + .json/.d.ts → external
 *
 * 设计约束：
 *   - 纯 node:fs / node:path（+ typescript 仅用于 tsconfig 解析，含 extends 链）
 *   - 不抛异常（无法解析返回 { resolvedPath: null, kind: 'unresolved' }）
 *   - 跨平台：resolvedPath 输出统一为相对 projectRoot 的 POSIX 路径；
 *     projectRoot 为空（独立 AST 调用）时返回绝对路径且跳过守卫（保持历史 core 行为）
 *
 * 注：Python import 解析（resolvePythonImport）不在本次收口范围，仍在
 *   knowledge-graph/import-resolver.ts；其依赖的 ResolveResult / toPosix / isInsideProjectRoot
 *   由本模块导出供其下行 import（knowledge-graph → core，层级方向干净）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
// 复用 ts-morph 再导出的 typescript 命名空间（避免新增对 'typescript' 的直接运行时依赖；
// ts-morph 已是本仓运行时依赖）
import { ts } from 'ts-morph';

// ───────────────────────────────────────────────────────────
// Public Types（Feature 181：由 knowledge-graph/import-resolver 迁入）
// ───────────────────────────────────────────────────────────

/**
 * import 路径解析结果。
 * resolvedPath 为相对 projectRoot 的 POSIX 路径；external/unresolved 时为 null。
 * 当 projectRoot 为空字符串（独立 AST 调用）时，resolvedPath 为绝对路径（调用方自行归一）。
 */
export interface ResolveResult {
  /** 解析后的目标文件路径（相对 projectRoot 的 POSIX 相对路径；projectRoot 空时为绝对路径）。 */
  resolvedPath: string | null;
  kind:
    | 'module' // Python: pkg.engine → pkg/engine.py
    | 'package-init' // Python: from pkg import X → pkg/__init__.py
    | 'relative-sibling' // Python: 相对 import（含祖先包 from .. import）
    | 'relative' // TS: ./engine、../utils
    | 'paths-alias' // TS: tsconfig.compilerOptions.paths 命中
    | 'absolute' // TS: baseUrl 解析或磁盘绝对路径
    | 'external' // 明确外部包（npm / Python stdlib / .json / .d.ts）
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
   * baseUrl 配置（经 ts.parseJsonConfigFileContent 解析，通常为绝对路径）。
   * 用户未配置 baseUrl → null（跳过 baseUrl 解析）。
   * 注：alias 算法用 path.resolve(configDir, baseUrl, replacement)，绝对 baseUrl 会正确覆盖 configDir。
   */
  baseUrl: string | null;
  /** paths 映射（含 wildcard），key/value 保留原始 tsconfig 相对字符串 */
  paths: Map<string, string[]>;
}

// ───────────────────────────────────────────────────────────
// 常量
// ───────────────────────────────────────────────────────────

/** TS/JS 候补扩展名顺序（含 .mjs/.cjs，源自历史 core 实现） */
const TS_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** index 文件名顺序 */
const TS_INDEX_FILES: readonly string[] = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];

/** alias-like 前缀列表（C-2）：以这些前缀开头的 moduleSpec 无 paths 命中时返回 unresolved */
const ALIAS_PREFIXES: readonly string[] = ['~/', '#/', '$/'];

/**
 * TypeScript ESM 惯例：`import './foo.js'` 实际指向 `./foo.ts`（Feature 156 CRIT-1）。
 * specifier 以 JS 扩展名结尾时，先尝试对应 TS 扩展名候选；命中即返回，否则 fallback 标准解析。
 */
const ESM_TS_EXT_MAP: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

// ───────────────────────────────────────────────────────────
// 共享辅助（导出供 knowledge-graph Python resolver 下行复用）
// ───────────────────────────────────────────────────────────

/** 将路径转换为 POSIX 格式（确保跨平台 resolvedPath 始终用 '/' 分隔符）。 */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * 判断 candidate 路径是否严格在 projectRoot 子树内（C-5 + N-2）。
 *
 * 用 path.relative 逐 component 检查第一段是否为 '..'，避免字典序误判（/proj vs /projection）。
 * candidate === projectRoot 返回 false（projectRoot 自身不算"在子树内"）。
 */
export function isInsideProjectRoot(candidate: string, projectRoot: string): boolean {
  const rel = path.relative(projectRoot, candidate);
  if (rel.length === 0) return false; // candidate === projectRoot
  if (path.isAbsolute(rel)) return false; // 跨盘符（Windows）
  const firstSeg = rel.split(path.sep)[0];
  if (firstSeg === '..') return false;
  return true;
}

/**
 * 判断路径是否指向非源文件目标（W-1）。
 * .json 和 .d.ts 文件不进入 callSites graph，返回 external。
 */
export function isNonSourceTarget(p: string): boolean {
  return p.endsWith('.json') || p.endsWith('.d.ts');
}

// ───────────────────────────────────────────────────────────
// 内部：文件候选尝试（合并 core ESM ext map + 直接命中 + 扩展名 + index）
// ───────────────────────────────────────────────────────────

function existsAndIsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function existsAndIsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 给定 base 路径，依次尝试（顺序严格复刻历史 core，护 graph.json byte-identical）：
 *   1. ESM TS ext map（若 base 以 JS 扩展名结尾，先试 .ts/.tsx 等 TS 候选）
 *   2. base 直接命中（已含扩展名）
 *   3. base + 扩展名（.ts → .cjs）
 *   4. base/index.{ts,tsx,js,jsx}
 * @returns 命中的绝对路径；否则 null
 */
function tryFilePathVariants(base: string): string | null {
  // 1. ESM TS ext map（如 foo.js → foo.ts）
  const sourceExt = path.extname(base);
  const tsCandidatesExts = ESM_TS_EXT_MAP[sourceExt];
  if (tsCandidatesExts) {
    const baseWithoutExt = base.slice(0, -sourceExt.length);
    for (const tsExt of tsCandidatesExts) {
      const tsCandidate = baseWithoutExt + tsExt;
      if (existsAndIsFile(tsCandidate)) return tsCandidate;
    }
  }

  // 2. 直接命中
  if (existsAndIsFile(base)) return base;

  // 3. 扩展名补全
  for (const ext of TS_EXTENSIONS) {
    const candidate = base + ext;
    if (existsAndIsFile(candidate)) return candidate;
  }

  // 4. 目录 + index 文件
  if (existsAndIsDir(base)) {
    for (const idxFile of TS_INDEX_FILES) {
      const candidate = path.join(base, idxFile);
      if (existsAndIsFile(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * 把命中绝对路径归一为 ResolveResult。
 * projectRoot 为真：相对 POSIX；projectRoot 为空：保留绝对路径（历史 core 独立调用行为）。
 */
function makeHit(absHit: string, projectRoot: string, kind: ResolveResult['kind']): ResolveResult {
  return {
    resolvedPath: projectRoot ? toPosix(path.relative(projectRoot, absHit)) : absHit,
    kind,
  };
}

// ───────────────────────────────────────────────────────────
// Public API — resolveTsJsImport（单一权威）
// ───────────────────────────────────────────────────────────

/**
 * 解析 TypeScript/JavaScript import 路径（单一权威实现，Feature 181）。
 *
 * 解析顺序：
 *   1. node: 内置 → external
 *   2. 磁盘绝对路径（'/' 前缀）→ 文件候选 + projectRoot 守卫
 *   3. 相对路径（'./' '../'）→ 文件候选 + projectRoot 守卫；.json/.d.ts → external
 *   4. 非相对：tsconfig paths alias（最长前缀 + 多候选 + baseUrl 叠加）→ baseUrl 解析 → external/unresolved
 *
 * 守卫策略（逐分支复刻历史 kg）：relative / disk-absolute 分支启用 isInsideProjectRoot
 * （仅 projectRoot 为真时）；paths-alias / baseUrl 分支不加守卫（保持 alias 语义）。
 *
 * @param moduleSpec      - import 说明符（如 './engine'、'~/utils'、'express'）
 * @param callerFile      - 调用方文件的绝对路径
 * @param projectRoot     - 项目根目录绝对路径（空字符串：返回绝对路径 + 跳过守卫）
 * @param tsConfigContext - tsconfig 解析上下文（null/undefined：仅走相对/绝对路径）
 * @returns ResolveResult（失败返回 { resolvedPath: null, kind: 'unresolved' }，不抛异常）
 */
export function resolveTsJsImport(
  moduleSpec: string,
  callerFile: string,
  projectRoot: string,
  tsConfigContext?: TsConfigResolutionContext | null,
): ResolveResult {
  if (!moduleSpec || typeof moduleSpec !== 'string') {
    return { resolvedPath: null, kind: 'unresolved' };
  }

  // 1. node 内置模块 → external（不解析外部依赖）
  if (moduleSpec.startsWith('node:')) {
    return { resolvedPath: null, kind: 'external' };
  }

  // 2. 磁盘绝对路径（罕见）
  if (moduleSpec.startsWith('/')) {
    const hit = tryFilePathVariants(moduleSpec);
    if (hit) {
      // 守卫：候选必须在 projectRoot 内（仅 projectRoot 为真时启用）
      if (projectRoot && !isInsideProjectRoot(hit, projectRoot)) {
        return { resolvedPath: null, kind: 'unresolved' };
      }
      return makeHit(hit, projectRoot, 'absolute');
    }
    return { resolvedPath: null, kind: 'unresolved' };
  }

  // 3. 相对路径（./ 或 ../）
  if (moduleSpec.startsWith('./') || moduleSpec.startsWith('../') || moduleSpec.startsWith('.')) {
    // W-1：moduleSpec 自身已带 .json / .d.ts 后缀 → external
    if (isNonSourceTarget(moduleSpec)) {
      return { resolvedPath: null, kind: 'external' };
    }
    const base = path.resolve(path.dirname(callerFile), moduleSpec);
    const hit = tryFilePathVariants(base);
    if (hit) {
      if (projectRoot && !isInsideProjectRoot(hit, projectRoot)) {
        return { resolvedPath: null, kind: 'unresolved' };
      }
      // 命中 .json / .d.ts（如 base 无扩展名却命中同名 .d.ts）双保险 external
      if (isNonSourceTarget(hit)) {
        return { resolvedPath: null, kind: 'external' };
      }
      return makeHit(hit, projectRoot, 'relative');
    }
    // 候补失败但 base 本身指向 .json / .d.ts → external
    if (isNonSourceTarget(base)) {
      return { resolvedPath: null, kind: 'external' };
    }
    return { resolvedPath: null, kind: 'unresolved' };
  }

  // 4. 非相对路径：先 paths alias，再 baseUrl，再判定 external/unresolved
  if (tsConfigContext) {
    const aliasHit = resolvePathsAlias(moduleSpec, projectRoot, tsConfigContext);
    if (aliasHit) return aliasHit;

    // baseUrl 解析（baseUrl 为字符串时）
    if (typeof tsConfigContext.baseUrl === 'string') {
      const absBase = path.resolve(tsConfigContext.configDir, tsConfigContext.baseUrl, moduleSpec);
      const hit = tryFilePathVariants(absBase);
      if (hit) {
        return makeHit(hit, projectRoot, 'absolute');
      }
    }
  }

  // C-2：区分 alias-like（unresolved）与 bare npm package（external）
  if (ALIAS_PREFIXES.some((p) => moduleSpec.startsWith(p)) || moduleSpec.startsWith('@/')) {
    return { resolvedPath: null, kind: 'unresolved' };
  }

  // 合法 npm 包判定
  const firstSeg = moduleSpec.split('/')[0] ?? '';
  if (firstSeg.startsWith('@')) {
    // scoped 包形如 @org/lib
    return { resolvedPath: null, kind: 'external' };
  }
  if (/^[a-z0-9][a-z0-9-_.]*$/.test(firstSeg)) {
    return { resolvedPath: null, kind: 'external' };
  }

  // 含 '/' 但首段不是合法 npm 包名 → alias-like 配置缺失
  return { resolvedPath: null, kind: 'unresolved' };
}

/**
 * AST 消费方便捷封装：解析并归一为**绝对路径**。
 *
 * ast-analyzer / tree-sitter-analyzer / tree-sitter-fallback 三处历史上把
 * resolvedPath 以绝对路径写入 CodeSkeleton.imports[]（module-derivation.normalizeSkeletonPaths
 * 期望绝对输入再相对化；collect EC-10 亦绝对）。本封装保持该形态：
 *   - projectRoot 为真：把权威 resolver 的相对 POSIX 结果 path.resolve 回绝对
 *   - projectRoot 为空：权威 resolver 已返回绝对路径，原样返回
 * external/unresolved（resolvedPath=null）统一返回 null（与历史 core string|null 语义一致）。
 */
export function resolveTsJsImportToAbsolute(
  moduleSpec: string,
  callerFile: string,
  projectRoot: string,
  tsConfigContext?: TsConfigResolutionContext | null,
): string | null {
  const r = resolveTsJsImport(moduleSpec, callerFile, projectRoot, tsConfigContext);
  if (!r.resolvedPath) return null;
  return path.isAbsolute(r.resolvedPath)
    ? r.resolvedPath
    : path.resolve(projectRoot, r.resolvedPath);
}

/**
 * tsconfig paths alias 解析（最长前缀 + 多候选 + baseUrl 叠加，TS 官方语义）。
 *
 * 合并历史两侧：
 *   - 最长前缀匹配（core：`@app/utils/*` 优先于 `@app/*`；精确 key 因 prefixLen 最长天然居首）
 *   - 多候选数组逐个尝试（core + kg）
 *   - replacement 叠加 baseUrl：path.resolve(configDir, baseUrl ?? '.', replacement)（kg C-3）
 *   - 文件候选用统一 tryFilePathVariants（含 ESM ext map / .mjs.cjs / index）
 *
 * @returns 命中的 ResolveResult（kind='paths-alias'）；未命中返回 null
 */
function resolvePathsAlias(
  moduleSpec: string,
  projectRoot: string,
  ctx: TsConfigResolutionContext,
): ResolveResult | null {
  // 收集所有命中 alias，排序规则（TS 官方语义）：
  //   1. 最长前缀优先（`@app/utils/*` 胜过 `@app/*`）
  //   2. 同前缀长度时精确 key（无 wildcard）优先于 wildcard（`react` 胜过 `react*`）
  const matched: Array<{ prefixLen: number; isWildcard: boolean; tail: string; replacements: string[] }> = [];
  for (const [pattern, replacements] of ctx.paths) {
    const tail = matchPathsPattern(moduleSpec, pattern);
    if (tail === null) continue;
    const isWildcard = pattern.includes('*');
    const prefixLen = isWildcard ? pattern.indexOf('*') : pattern.length;
    matched.push({ prefixLen, isWildcard, tail, replacements });
  }
  if (matched.length === 0) return null;
  matched.sort((a, b) => {
    if (b.prefixLen !== a.prefixLen) return b.prefixLen - a.prefixLen;
    return (a.isWildcard ? 1 : 0) - (b.isWildcard ? 1 : 0); // 同前缀长度：exact 优先
  });

  const baseUrl = typeof ctx.baseUrl === 'string' ? ctx.baseUrl : '.';
  for (const m of matched) {
    for (const replacement of m.replacements) {
      const resolved = replacement.includes('*') ? replacement.replace('*', m.tail) : replacement;
      const absBase = path.resolve(ctx.configDir, baseUrl, resolved);
      const hit = tryFilePathVariants(absBase);
      if (hit) {
        return makeHit(hit, projectRoot, 'paths-alias');
      }
    }
  }
  return null;
}

/**
 * 匹配 tsconfig paths pattern（精确 key + wildcard）。
 * @returns null（不匹配），或 wildcard 截取的尾缀（精确 key 时为 ''）
 */
function matchPathsPattern(moduleSpec: string, pattern: string): string | null {
  if (pattern.includes('*')) {
    const starIdx = pattern.indexOf('*');
    const prefix = pattern.slice(0, starIdx);
    const suffix = pattern.slice(starIdx + 1);
    if (moduleSpec.startsWith(prefix) && moduleSpec.endsWith(suffix) &&
        moduleSpec.length >= prefix.length + suffix.length) {
      return moduleSpec.slice(prefix.length, moduleSpec.length - suffix.length);
    }
    return null;
  }
  return moduleSpec === pattern ? '' : null;
}

// ───────────────────────────────────────────────────────────
// Public API — tsconfig loader（单一实现：ts.parseJsonConfigFileContent，含 extends 链）
// ───────────────────────────────────────────────────────────

/**
 * 从 filePath 向上查找最近的 tsconfig.json（monorepo-aware）。
 *
 * 上溯范围：从 path.dirname(filePath) 向上，直到 projectRoot 边界（含 projectRoot 本身）。
 * 越过 projectRoot 停止，不抛异常。
 *
 * @returns tsconfig.json 的绝对路径；未找到返回 null
 */
export function findNearestTsConfig(filePath: string, projectRoot: string): string | null {
  let dir = path.dirname(filePath);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // 边界检查先于 fs 操作（C-3：避免越界路径误读）
    if (dir !== projectRoot && !isInsideProjectRoot(dir, projectRoot)) {
      break;
    }
    const candidate = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    if (dir === projectRoot) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // 文件系统根
    dir = parent;
  }
  return null;
}

/**
 * 解析 tsconfig.json 为 TsConfigResolutionContext（单一 loader，ts API 处理 extends 链）。
 *
 * 用 ts.readConfigFile + ts.parseJsonConfigFileContent：
 *   - 自动处理 extends 链（优于历史 kg 手写 JSON.parse 的 YAGNI 无 extends）
 *   - baseUrl 解析为绝对路径（alias 算法 path.resolve 正确覆盖 configDir）
 *   - paths 保留原始相对字符串（由 alias 算法做唯一一次 resolve，避免双重 resolve）
 *
 * 失败时返回 null（不抛异常，按未配置 alias 处理）。
 *
 * @param configPath - tsconfig.json 的绝对路径（由 findNearestTsConfig / 调用方提供）
 */
export function buildTsConfigContext(configPath: string): TsConfigResolutionContext | null {
  try {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error || !configFile.config) {
      return null;
    }
    const configDir = path.dirname(configPath);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, configDir);
    const compilerOptions = parsed.options;

    const baseUrl =
      typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : null;

    const paths = new Map<string, string[]>();
    if (compilerOptions.paths) {
      for (const [key, value] of Object.entries(compilerOptions.paths)) {
        if (Array.isArray(value)) {
          const strs = value.filter((s): s is string => typeof s === 'string');
          if (strs.length > 0) paths.set(key, strs);
        }
      }
    }

    return { configDir, baseUrl, paths };
  } catch {
    return null;
  }
}
