/**
 * import-resolver.ts — TS/JS import specifier 解析（Feature 156 W1.0 / CRITICAL-1 关闭）
 *
 * 背景：
 *   ast-analyzer.ts:376 与 tree-sitter-fallback.ts / typescript-mapper.ts 在提取 import 时
 *   把 `resolvedPath` 置为 null（"不解析路径，性能优化"）。删除 dependency-cruiser 后，
 *   knowledge-graph/index.ts 的 deriveImportEdges 跳过 `resolvedPath=null` 的 import，
 *   导致 TS/JS depends-on 边数为 0。
 *
 * 本模块提供两个核心能力：
 *   1. resolveTsJsImport — specifier → 绝对路径（无法解析返回 null）
 *      - 覆盖 4 类 import：static / dynamic / commonjs-require / type-only（路径解析逻辑相同）
 *      - 支持相对路径、扩展名补全、index.{ts,js} fallback、tsconfig path alias
 *      - node_modules / 外部包：返回 null（不解析外部依赖）
 *   2. detectImportType — 从 ts-morph 节点派生 ImportType 字面量
 *      - 用于 CodeSkeleton.imports[].importType + ModuleEdge.importType
 *
 * 设计约束：
 *   - 不引入新 npm 依赖（仅用 node:fs / node:path）
 *   - 不抛异常（无法解析返回 null + 静默忽略）
 *   - 跨平台：path.resolve / path.posix 兼容 win32 + posix
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Node, SyntaxKind, type ImportDeclaration } from 'ts-morph';

// ───────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────

/**
 * 4 类 TS/JS import 的语义类型（FR-28 / AC-11）。
 *
 * - 'static'：标准 ES Module 静态 import（`import { foo } from 'x'`）
 * - 'dynamic'：动态 import 表达式（`await import('x')`）
 * - 'type-only'：类型导入（`import type { T } from 'x'`）
 * - 'commonjs-require'：CommonJS require 调用（`const x = require('x')`）
 *
 * 注：ModuleEdge.importType 枚举为 ['static', 'dynamic', 'type-only']，
 * commonjs-require 在 module-derivation 派生时会归并到 'static'（CommonJS 视为同步加载）。
 */
export type ImportType = 'static' | 'dynamic' | 'type-only' | 'commonjs-require';

/**
 * resolveTsJsImport 选项。
 *
 * pathAliases 历史兼容：
 *   - 单值形式 Record<string, string>（旧调用方）—— 内部包装为 [value] 单候选数组
 *   - 多值形式 Record<string, string[]>（CRIT-2 v2 新增）—— tsconfig.compilerOptions.paths
 *     原生格式，支持 monorepo 多候选（如 alias '@app/star' 映射到 ['./packages/app/star', './apps/star/src']）
 *
 * baseUrl（CRIT-2 v2 新增）：
 *   - tsconfig 的 compilerOptions.baseUrl 解析后的绝对路径
 *   - 当 specifier 不是相对路径且没有 alias 命中时，作为最后的非相对 module 解析根
 *     （如 baseUrl='./src'，specifier='utils/foo' → 尝试 src/utils/foo.ts/tsx 等）
 */
export interface ResolveTsJsImportOptions {
  /** 尝试的扩展名顺序（默认 ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']） */
  extensions?: readonly string[];
  /** index 文件名顺序（默认 ['index.ts', 'index.tsx', 'index.js', 'index.jsx']） */
  indexFiles?: readonly string[];
  /**
   * tsconfig paths 映射。支持单值（向后兼容）和多候选数组形式。
   * key 中 star 通配符等价 tsconfig 中的星号；value 同理。
   */
  pathAliases?: Record<string, string | readonly string[]>;
  /**
   * tsconfig.compilerOptions.baseUrl 解析后的绝对路径。
   * 设置后，未命中 alias 的非相对 specifier 也会尝试基于 baseUrl 解析。
   */
  baseUrl?: string;
}

const DEFAULT_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const DEFAULT_INDEX_FILES: readonly string[] = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];

/**
 * Feature 156 W1.0 v2 / CRIT-1：TypeScript ESM 惯例下，`import './foo.js'` 实际指向 `./foo.ts`。
 *
 * 当 specifier 以 JS 扩展名结尾时，先尝试对应的 TS 扩展名候选；命中则返回，否则 fallback
 * 到原扩展名继续走标准解析流程（保持非 TS 项目的兼容性）。
 */
const ESM_TS_EXT_MAP: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

// ───────────────────────────────────────────────────────────
// resolveTsJsImport — specifier → 绝对路径
// ───────────────────────────────────────────────────────────

/**
 * 把 TS/JS import specifier 解析为绝对文件路径。
 *
 * 解析顺序：
 *   1. node 内置模块（如 'fs'）/ npm 包（不带相对前缀且无 alias 命中）→ null
 *   2. tsconfig path alias 命中 → 替换前缀后按相对路径流程解析
 *   3. 相对路径（`./xxx` / `../xxx` / `/xxx`）→ 基于 fromFile 拼接
 *
 * 文件存在性检查：
 *   - 直接命中（specifier 已含 .ts/.js 等扩展名）
 *   - 扩展名补全（依次尝试 options.extensions）
 *   - 目录 + index 文件 fallback（如果 specifier 指向目录）
 *
 * 失败时静默返回 null，不抛异常（FR-28 best-effort 语义）。
 *
 * @param specifier - import 字符串字面量（如 './foo'）
 * @param fromFile - 发起 import 的源文件绝对路径
 * @param projectRoot - 项目根目录（用于 alias 相对路径解析；可为空字符串，alias 失效）
 * @param options - 扩展名 / index 文件 / alias 配置
 * @returns 解析到的绝对路径；外部模块或解析失败返回 null
 */
export function resolveTsJsImport(
  specifier: string,
  fromFile: string,
  projectRoot: string,
  options?: ResolveTsJsImportOptions,
): string | null {
  if (!specifier || typeof specifier !== 'string') return null;

  const extensions = options?.extensions ?? DEFAULT_EXTENSIONS;
  const indexFiles = options?.indexFiles ?? DEFAULT_INDEX_FILES;

  // 1. node 内置模块（'fs', 'path', 'node:fs'）→ null（不解析外部依赖）
  if (specifier.startsWith('node:')) return null;

  // 2. 尝试 tsconfig path alias（多候选最长前缀匹配，CRIT-2 v2）
  const aliasCandidates = resolveAliasCandidates(
    specifier,
    projectRoot,
    options?.pathAliases,
  );
  for (const cand of aliasCandidates) {
    const hit = tryFilePathVariants(cand, extensions, indexFiles);
    if (hit) return hit;
  }

  // 3. 相对路径前缀（'.', '..', '/'）才进入文件系统解析
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const fromDir = path.dirname(path.resolve(fromFile));
    const baseSpecifier = path.resolve(fromDir, specifier);
    return tryFilePathVariants(baseSpecifier, extensions, indexFiles);
  }

  // 4. baseUrl fallback（CRIT-2 v2）：未命中 alias / 非相对路径，
  //    若 baseUrl 提供，则按非相对 module 解析（baseUrl + specifier）
  if (options?.baseUrl) {
    const baseRel = path.resolve(options.baseUrl, specifier);
    const hit = tryFilePathVariants(baseRel, extensions, indexFiles);
    if (hit) return hit;
  }

  // 5. 不带相对前缀、无 alias / baseUrl 命中：视为 npm 包 / 外部模块 → null
  return null;
}

/**
 * 尝试 alias 替换，返回所有候选绝对路径列表（CRIT-2 v2）。
 *
 * 改进：
 *   1. 支持单值与多候选数组（`Record<string, string | readonly string[]>`）
 *   2. 最长前缀匹配（`@app/utils/foo` 命中 `@app/utils/*` 优先于 `@app/*`）
 *   3. 一个 alias 可对应多个目标，全部作为候选返回（调用方逐个 tryFilePathVariants）
 *
 * @returns 候选绝对路径列表（按优先级排序：最长前缀优先 + 配置顺序）；未命中返回空数组
 */
function resolveAliasCandidates(
  specifier: string,
  projectRoot: string,
  pathAliases?: Record<string, string | readonly string[]>,
): string[] {
  if (!pathAliases || !projectRoot) return [];

  // 收集所有命中的 alias，按 prefix 长度降序（最长前缀优先）
  const matched: Array<{ prefixLen: number; remainder: string; targets: readonly string[] }> = [];
  for (const [aliasPattern, targetValue] of Object.entries(pathAliases)) {
    const aliasPrefix = aliasPattern.replace(/\*$/, '');
    if (!specifier.startsWith(aliasPrefix)) continue;
    const remainder = specifier.slice(aliasPrefix.length);
    const targets = Array.isArray(targetValue) ? targetValue : [targetValue as string];
    matched.push({ prefixLen: aliasPrefix.length, remainder, targets });
  }
  if (matched.length === 0) return [];
  matched.sort((a, b) => b.prefixLen - a.prefixLen);

  const candidates: string[] = [];
  for (const m of matched) {
    for (const target of m.targets) {
      const targetPrefix = target.replace(/\*$/, '');
      const joined = path.posix.join(targetPrefix, m.remainder);
      // target 可能已是绝对路径（ts.parseJsonConfigFileContent 解析后）；保留绝对路径不再 join projectRoot
      candidates.push(path.isAbsolute(joined) ? joined : path.resolve(projectRoot, joined));
    }
  }
  return candidates;
}

/**
 * 给定一个 base 路径，依次尝试：
 *   1. base 直接存在（含扩展名）
 *   2. base + 扩展名（.ts, .tsx, .js, ...）
 *   3. base / index.ts、base / index.js 等
 */
function tryFilePathVariants(
  base: string,
  extensions: readonly string[],
  indexFiles: readonly string[],
): string | null {
  // CRIT-1：TS ESM 惯例 — 若 base 以 JS 扩展名结尾，先尝试 TS 候选（如 foo.js → foo.ts）
  // 命中则直接返回；不命中再 fallback 到原 base 走后续标准解析流程
  const sourceExt = path.extname(base);
  const tsCandidatesExts = ESM_TS_EXT_MAP[sourceExt];
  if (tsCandidatesExts) {
    const baseWithoutExt = base.slice(0, -sourceExt.length);
    for (const tsExt of tsCandidatesExts) {
      const tsCandidate = baseWithoutExt + tsExt;
      if (existsAndIsFile(tsCandidate)) return tsCandidate;
    }
    // TS 候选未命中：继续 fallback 到下方标准解析（直接命中 / 扩展名补全 / index）
  }

  // 1. 直接命中
  if (existsAndIsFile(base)) return base;

  // 2. 扩展名补全
  for (const ext of extensions) {
    const candidate = base + ext;
    if (existsAndIsFile(candidate)) return candidate;
  }

  // 3. 目录 + index 文件
  if (existsAndIsDir(base)) {
    for (const idxFile of indexFiles) {
      const candidate = path.join(base, idxFile);
      if (existsAndIsFile(candidate)) return candidate;
    }
  }

  return null;
}

function existsAndIsFile(p: string): boolean {
  try {
    const st = fs.statSync(p);
    return st.isFile();
  } catch {
    return false;
  }
}

function existsAndIsDir(p: string): boolean {
  try {
    const st = fs.statSync(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────
// detectImportType — 从 ts-morph 节点派生 ImportType
// ───────────────────────────────────────────────────────────

/**
 * 从 ts-morph 节点派生 ImportType 字面量（FR-28 / plan §2.5）。
 *
 * 判断规则：
 *   1. 'type-only'：ImportDeclaration 且 isTypeOnly()=true
 *   2. 'dynamic'：CallExpression 且 callee 为 import 关键字（SyntaxKind.ImportKeyword）
 *   3. 'commonjs-require'：CallExpression 且 callee 文本 = "require"
 *   4. 'static'：默认（标准 ImportDeclaration）
 *
 * 注：tree-sitter / 正则降级路径不调用此函数，由调用点直接根据 query 节点类型映射
 * （tree-sitter typescript-mapper 仅处理 import_statement，importType 始终为 'static' 或 'type-only'，
 * 由 isTypeOnly 字段派生）。
 */
export function detectImportType(node: Node): ImportType {
  if (Node.isImportDeclaration(node)) {
    return detectImportDeclarationType(node);
  }
  if (Node.isCallExpression(node)) {
    return detectCallExpressionImportType(node);
  }
  // 兜底：未识别节点视为 static（保持非破坏性行为）
  return 'static';
}

function detectImportDeclarationType(decl: ImportDeclaration): ImportType {
  // (a) 顶层 `import type` 关键字
  if (decl.isTypeOnly()) return 'type-only';

  // WARN-1 修订：混合 import（含 default 或 namespace）即使 named import 全是 type-only，
  // 也保留 'static' 语义 —— default / namespace 在运行时仍是值导入。
  // 仅当 (a) 没有 default + 没有 namespace + (b) 有 named import 且全为 type-only 才归 type-only。
  const hasDefaultImport = decl.getDefaultImport() != null;
  const hasNamespaceImport = decl.getNamespaceImport() != null;
  if (hasDefaultImport || hasNamespaceImport) {
    return 'static';
  }

  const named = decl.getNamedImports();
  if (named.length > 0 && named.every((n) => n.isTypeOnly())) {
    return 'type-only';
  }
  return 'static';
}

function detectCallExpressionImportType(call: Node): ImportType {
  if (!Node.isCallExpression(call)) return 'static';
  const expr = call.getExpression();
  // 动态 import：callee 为 ImportKeyword
  if (expr.getKind() === SyntaxKind.ImportKeyword) return 'dynamic';
  // CommonJS require：callee 为 Identifier("require")
  if (Node.isIdentifier(expr) && expr.getText() === 'require') return 'commonjs-require';
  return 'static';
}

// ───────────────────────────────────────────────────────────
// 辅助：批量 post-process（供 ast-analyzer / tree-sitter-analyzer / fallback 复用）
// ───────────────────────────────────────────────────────────

import type { ImportReference } from '../models/code-skeleton.js';

/**
 * 给定一个文件的 imports 列表，逐项调用 resolveTsJsImport 填充 resolvedPath。
 *
 * 复用动机：ast-analyzer / tree-sitter-analyzer / tree-sitter-fallback 三处都需要
 * 在 imports 收集完毕后批量 resolve；提取此 helper 避免重复实现。
 *
 * - importType 默认从 `isTypeOnly` 派生（type-only / static）；ts-morph 路径可在调用前覆盖。
 * - 仅处理 TS/JS 语言；其他语言（Python / Go / Java）应跳过此函数。
 */
export function resolveImportsForFile(
  imports: ImportReference[],
  fromFile: string,
  projectRoot: string,
  options?: ResolveTsJsImportOptions,
): ImportReference[] {
  return imports.map((imp) => {
    // 已 resolve 过则保留（如 ts-morph 路径已在 ast-analyzer 中显式调用）
    const alreadyResolved = imp.resolvedPath != null && imp.resolvedPath !== '';
    const resolvedPath = alreadyResolved
      ? imp.resolvedPath
      : resolveTsJsImport(imp.moduleSpecifier, fromFile, projectRoot, options);

    // 如果未显式设置 importType，从 isTypeOnly 派生
    const inferredImportType: ImportType = imp.isTypeOnly ? 'type-only' : 'static';
    return {
      ...imp,
      resolvedPath: resolvedPath ?? null,
      // ImportReferenceSchema 已扩展 importType?: ImportType（v152 W1.0）
      importType: (imp as ImportReference & { importType?: ImportType }).importType
        ?? inferredImportType,
    } as ImportReference;
  });
}
