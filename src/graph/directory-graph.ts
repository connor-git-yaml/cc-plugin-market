/**
 * directory-graph.ts — 多语言轻量级模块图构建器（Feature 156 W1.4）
 *
 * 历史：本文件原先直接产出模块图节点 + 边。
 * Feature 156 W1.2 后改为统一走 UnifiedGraph 派生路径；W1.4 atomic switch 完成后，
 * 类型系统统一为 ModuleGraph 视图。
 *
 * 流程：
 *   1. 用既有的 resolveImportPath / resolveAbsoluteImportPath 推断每个 import 的
 *      resolvedPath（适用于 Python/Go/Java/任意语言相对 import）
 *   2. 把这些 resolvedPath 写回 CodeSkeleton.imports[i]，构造 codeSkeletons Map
 *   3. buildUnifiedGraph 派生 depends-on 边
 *   4. deriveModuleGraph 派生 ModuleGraph 视图
 */
import * as path from 'node:path';
import type { CodeSkeleton, ImportReference } from '../models/code-skeleton.js';
import type { ModuleGraph } from '../knowledge-graph/module-derivation.js';
import {
  buildModuleGraphFromCodeSkeletons,
  createEmptyModuleGraph,
} from '../knowledge-graph/module-derivation.js';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';

/**
 * 基于 CodeSkeleton 的 imports 信息构建轻量级模块图（W1.4：UnifiedGraph 派生路径）。
 *
 * 对 `isRelative: true` 的 import 使用路径解析构建依赖边；
 * `isRelative: false` 的 import（第三方包）被忽略。
 * 无法解析的 import 路径不产生边（宽容策略），不抛出异常。
 *
 * @param files - 同一语言的文件路径列表（相对于项目根目录）
 * @param projectRoot - 项目根目录
 * @param skeletons - 与 files 对应的 CodeSkeleton 列表
 * @returns ModuleGraph
 */
export async function buildDirectoryGraph(
  files: string[],
  projectRoot: string,
  skeletons: CodeSkeleton[],
): Promise<ModuleGraph> {
  if (files.length === 0) {
    return createEmptyModuleGraph(projectRoot);
  }

  const fileSet = new Set(files);
  const registry = LanguageAdapterRegistry.getInstance();

  // 预构建目录前缀索引：dirPrefix → 该目录下的文件列表
  const dirPrefixIndex = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.split('/');
    for (let depth = 1; depth < parts.length; depth++) {
      const prefix = parts.slice(0, depth).join('/') + '/';
      const existing = dirPrefixIndex.get(prefix);
      if (existing) {
        existing.push(file);
      } else {
        dirPrefixIndex.set(prefix, [file]);
      }
    }
  }

  // 文件路径 → 骨架映射
  const skeletonMap = new Map<string, CodeSkeleton>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const skeleton = skeletons[i];
    if (skeleton) {
      skeletonMap.set(file, skeleton);
    }
  }

  // ── 1. 重建带 resolvedPath 的 CodeSkeleton Map ──
  const codeSkeletons = new Map<string, CodeSkeleton>();
  for (const file of files) {
    const skeleton = skeletonMap.get(file);
    const baseImports: ImportReference[] = skeleton?.imports ?? [];
    const newImports: ImportReference[] = baseImports.map((imp) => {
      let resolved: string | undefined;
      if (imp.isRelative) {
        resolved = resolveImportPath(file, imp.moduleSpecifier, fileSet);
      } else {
        resolved = resolveAbsoluteImportPath(imp.moduleSpecifier, fileSet, dirPrefixIndex);
      }
      // 仅当解析到的目标确实在 fileSet 中且非自引用，才写回 resolvedPath
      if (resolved && resolved !== file && fileSet.has(resolved)) {
        return { ...imp, resolvedPath: resolved };
      }
      return imp;
    });

    // 构造（或复用）CodeSkeleton；filePath 用相对路径与 fileSet 对齐
    const language = skeleton?.language ?? guessLanguageFromFile(file);
    const adapter = registry.getAdapter(file);
    const synthSk: CodeSkeleton = skeleton
      ? { ...skeleton, filePath: file, imports: newImports }
      : {
          filePath: file,
          language,
          loc: 1,
          exports: [],
          imports: newImports,
          hash: '0'.repeat(64),
          analyzedAt: new Date().toISOString(),
          parserUsed: 'tree-sitter',
        };
    codeSkeletons.set(file, synthSk);
    void adapter;
  }

  // ── 2. 一站式派生 ModuleGraph（含 language 回填）──
  return buildModuleGraphFromCodeSkeletons(codeSkeletons, projectRoot);
}

// ============================================================
// 路径解析（保留 W1.2 之前的实现，作为多语言相对 import 推断的核心）
// ============================================================

/**
 * 解析 import 路径到文件集合中的实际文件
 *
 * 支持：
 * - Python 相对 import：`from .utils import x` → `./utils`
 * - Go 本地 package：`"./internal/utils"` → `./internal/utils/`
 * - 通用相对路径：`./foo`, `../bar`
 */
function resolveImportPath(
  fromFile: string,
  specifier: string,
  fileSet: Set<string>,
): string | undefined {
  const fromDir = path.dirname(fromFile);

  // Python 点号相对导入
  let normalizedSpecifier = specifier;
  if (/^\.{1,3}[a-zA-Z_]/.test(specifier)) {
    const dotMatch = /^(\.{1,3})(.*)$/.exec(specifier);
    if (dotMatch) {
      const dots = dotMatch[1]!;
      const rest = dotMatch[2]!;
      if (dots === '.') {
        normalizedSpecifier = `./${rest}`;
      } else if (dots === '..') {
        normalizedSpecifier = `../${rest}`;
      } else if (dots === '...') {
        normalizedSpecifier = `../../${rest}`;
      }
    }
  }

  if (!normalizedSpecifier.startsWith('./') && !normalizedSpecifier.startsWith('../')) {
    return undefined;
  }

  const resolved = path.normalize(path.join(fromDir, normalizedSpecifier));

  if (fileSet.has(resolved)) {
    return resolved;
  }

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java'];
  for (const ext of extensions) {
    const withExt = resolved + ext;
    if (fileSet.has(withExt)) {
      return withExt;
    }
  }

  const indexFiles = ['index.ts', 'index.js', '__init__.py'];
  for (const indexFile of indexFiles) {
    const withIndex = path.join(resolved, indexFile);
    if (fileSet.has(withIndex)) {
      return withIndex;
    }
  }

  const dirPrefix = resolved + '/';
  for (const file of fileSet) {
    if (file.startsWith(dirPrefix)) {
      return file;
    }
  }

  return undefined;
}

/**
 * 解析项目内绝对 import 路径（Python 包名式导入）
 */
function resolveAbsoluteImportPath(
  specifier: string,
  fileSet: Set<string>,
  dirPrefixIndex?: Map<string, string[]>,
): string | undefined {
  const asPath = specifier.replace(/\./g, '/');

  if (fileSet.has(asPath)) {
    return asPath;
  }

  const extensions = ['.py', '.pyi', '.ts', '.tsx', '.js', '.jsx', '.go', '.java'];
  for (const ext of extensions) {
    if (fileSet.has(asPath + ext)) {
      return asPath + ext;
    }
  }

  const indexFiles = ['__init__.py', 'index.ts', 'index.js', 'index.tsx'];
  for (const indexFile of indexFiles) {
    const candidate = `${asPath}/${indexFile}`;
    if (fileSet.has(candidate)) {
      return candidate;
    }
  }

  const dirPrefix = `${asPath}/`;
  let dirMatches: string[];
  if (dirPrefixIndex) {
    dirMatches = dirPrefixIndex.get(dirPrefix) ?? [];
  } else {
    dirMatches = [];
    for (const file of fileSet) {
      if (file.startsWith(dirPrefix)) {
        dirMatches.push(file);
      }
    }
  }

  if (dirMatches.length > 0) {
    const initPy = dirMatches.find((f) => f.endsWith('/__init__.py'));
    return initPy ?? dirMatches.sort()[0];
  }

  return undefined;
}

function guessLanguageFromFile(file: string): CodeSkeleton['language'] {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.py' || ext === '.pyi') return 'python';
  if (ext === '.go') return 'go';
  if (ext === '.java') return 'java';
  if (ext === '.ts' || ext === '.tsx' || ext === '.mts') return 'typescript';
  return 'javascript';
}

/**
 * Public builder：从已含 resolvedPath 的 CodeSkeleton Map 直接派生 ModuleGraph。
 *
 * 适用场景：python-adapter 等已知道自己语言 import 解析规则的 adapter，
 * 在自己内部完成 imports[].resolvedPath 写回后，调用本函数把 UnifiedGraph 派生 +
 * 视图转换合并为一步。
 *
 * 这是 buildModuleGraphFromCodeSkeletons 的薄壳 re-export，保留 backwards-compat 名字。
 */
export function buildGraphFromCodeSkeletons(
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
  projectRoot: string,
  language?: CodeSkeleton['language'],
): ModuleGraph {
  return buildModuleGraphFromCodeSkeletons(codeSkeletons, projectRoot, language);
}
