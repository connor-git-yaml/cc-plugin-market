/**
 * F220 Stage ① — source discovery / language collection（源码发现与语言采集）
 *
 * 从 batch-orchestrator.ts 依赖闭合搬迁（F220 B2，函数体逐字不变，仅动态 import
 * 相对路径随目录层级 +1）：design-doc 路径合并（Feature 145/140 T27）、Python
 * CodeSkeleton 采集（Feature 151）、TS/JS CodeSkeleton 采集（Feature 152）及其
 * 目录忽略集合与 walker（F194 .gitignore 过滤语义不变）。
 *
 * @internal 内部实现模块：外部消费者请从 `batch/batch-orchestrator.js`（facade）导入
 * 公共 14 符号契约；对 stages/ 的深导入不属于稳定 API，随时可能重构。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findReadmePath } from '../../extraction/index.js';
import { createGitignoreFilter } from '../../utils/file-scanner.js';
import { resolvePythonImport } from '../../knowledge-graph/import-resolver.js';
import {
  resolveTsJsImport,
  findNearestTsConfig,
  buildTsConfigContext,
  type TsConfigResolutionContext,
} from '../../core/import-resolver.js';
import type { CodeSkeleton } from '../../models/code-skeleton.js';

// ============================================================
// Feature 145 P1：designDocAbsPaths "磁盘优先"合并策略
// ============================================================

/**
 * 构建 hyperedge/anchor 集成所需的设计文档绝对路径列表
 *
 * **Feature 145 合并策略**（基线，向后兼容）：
 * 1. fromDocs：本轮 generateBatchProjectDocs 写出的文件（来自 writtenFiles）
 * 2. fromDisk：主动扫描 outputDir/project/ 目录下已存在的 .md 文件（磁盘优先）
 *
 * **Feature 140 T27 扩展**（spec FR-007 — 扩展 design doc 来源）：
 * 通过 `extraOptions` 启用以下额外来源（默认全部启用，给 caller 显式 opt-out 的能力）：
 * 3. fromReadme: 根目录 README.md（最高语义价值，作为顶层叙述）
 * 4. fromDocsDir: `docs/` 目录下递归扫描的 .md（仅 `--include-docs=true` 时启用）
 * 5. fromModuleSpecs: `<modulesDir>/*.spec.md`（当前 batch 产物，每次 batch 后存在）
 * 6. fromProjectContext: `.specify/project-context.{yaml,md}`
 *
 * 解决 spec FR-007 的"hyperedge 在新项目首次 batch 后产出 0 条 hyperedge"问题：
 * 之前 designDocAbsPaths 仅依赖 outputDir/project/，对从未 batch 过的新项目结果为空。
 * 扩展后即使新项目，仅有 README.md 也能产出 ≥ 1 条 hyperedge。
 *
 * @param projectDocs 本轮 generator 输出的相对路径列表
 * @param resolvedRoot 项目根目录绝对路径
 * @param resolvedOutputDir 输出目录绝对路径（含 `project/` 子目录）
 * @param extraOptions Feature 140 T27 扩展配置；不传时只走基线行为（向后兼容）
 * @returns paths 列表 + 各来源 count + 检测到的嵌套子目录
 */
export function buildDesignDocAbsPaths(
  projectDocs: string[],
  resolvedRoot: string,
  resolvedOutputDir: string,
  extraOptions?: {
    /** 是否包含根 README.md（默认 true）*/
    includeReadme?: boolean;
    /** 是否包含 docs/ 下递归 .md（默认 false；仅 --include-docs=true 时设为 true）*/
    includeDocs?: boolean;
    /** module specs 目录（包含 *.spec.md）；不传则跳过该来源 */
    modulesDir?: string;
    /** 是否包含 .specify/project-context.{yaml,md}（默认 true）*/
    includeProjectContext?: boolean;
  },
): {
  paths: string[];
  fromDocsCount: number;
  fromDiskCount: number;
  fromReadmeCount: number;
  fromDocsDirCount: number;
  fromModuleSpecsCount: number;
  fromProjectContextCount: number;
  nestedDirsDetected: string[];
} {
  // 来自本轮 generator 输出（以 resolvedRoot 为基准解析相对路径）
  const fromProjectDocs = projectDocs
    .map(rel => path.isAbsolute(rel) ? rel : path.join(resolvedRoot, rel))
    .filter(abs => fs.existsSync(abs));

  // 主动扫描 outputDir/project/ 目录下已存在的 .md 文件（磁盘优先）
  // 架构假设：outputDir/project/ 为扁平结构（无子目录），readdirSync 非递归覆盖全部产物 .md
  // Codex 对抗审查 W002 修复：检测到子目录时返回告警信号，调用方负责输出 warn
  const projectDir = path.join(resolvedOutputDir, 'project');
  const fromDisk: string[] = [];
  const nestedDirsDetected: string[] = [];
  if (fs.existsSync(projectDir)) {
    for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        fromDisk.push(path.join(projectDir, entry.name));
      } else if (entry.isDirectory()) {
        nestedDirsDetected.push(entry.name);
      }
    }
  }

  // ============================================================
  // Feature 140 T27 — 扩展来源（spec FR-007）
  // ============================================================

  const includeReadme = extraOptions?.includeReadme ?? true;
  const includeDocsDir = extraOptions?.includeDocs ?? false;
  const includeProjectContext = extraOptions?.includeProjectContext ?? true;

  // 来源 3：根 README.md（共享 extraction-pipeline 的 findReadmePath，确保 canonical 优先级一致；
  // 修复 Codex W-1 — 之前内联实现遇首匹配就 break，与 findReadmePath 的 canonical 优先逻辑漂移）
  const fromReadme: string[] = [];
  if (includeReadme) {
    try {
      const readmePath = findReadmePath(resolvedRoot);
      if (readmePath) fromReadme.push(readmePath);
    } catch {
      /* projectRoot 不可读取时静默忽略 */
    }
  }

  // 来源 4：docs/**/*.md（仅 --include-docs=true）
  const fromDocsDir: string[] = [];
  if (includeDocsDir) {
    const docsDir = path.join(resolvedRoot, 'docs');
    if (fs.existsSync(docsDir)) {
      collectMdRecursive(docsDir, fromDocsDir);
    }
  }

  // 来源 5：modulesDir/*.spec.md（当前 batch 产物）
  const fromModuleSpecs: string[] = [];
  if (extraOptions?.modulesDir && fs.existsSync(extraOptions.modulesDir)) {
    try {
      for (const entry of fs.readdirSync(extraOptions.modulesDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.spec.md')) {
          fromModuleSpecs.push(path.join(extraOptions.modulesDir, entry.name));
        }
      }
    } catch {
      /* 不可读取时静默忽略 */
    }
  }

  // 来源 6：.specify/project-context.{yaml,md}
  // 修复 Codex C-2：yaml 是 canonical source，md 仅 legacy fallback。
  // docs/shared/agent-context-layering.md 明确：".specify/project-context.yaml 是 canonical
  // Project Context；.specify/project-context.md 仅作为 legacy fallback"。
  // 此处遵循同一规则：yaml 存在时只取 yaml；不存在时 fallback 到 md；都不存在时返回 0。
  const fromProjectContext: string[] = [];
  if (includeProjectContext) {
    const yamlPath = path.join(resolvedRoot, '.specify', 'project-context.yaml');
    const mdPath = path.join(resolvedRoot, '.specify', 'project-context.md');
    if (fs.existsSync(yamlPath)) {
      fromProjectContext.push(yamlPath);
    } else if (fs.existsSync(mdPath)) {
      fromProjectContext.push(mdPath);
    }
  }

  // 去重合并（fromProjectDocs 优先 → fromDisk → fromReadme → fromDocsDir → fromModuleSpecs → fromProjectContext）
  const merged = [
    ...new Set([
      ...fromProjectDocs,
      ...fromDisk,
      ...fromReadme,
      ...fromDocsDir,
      ...fromModuleSpecs,
      ...fromProjectContext,
    ]),
  ];

  return {
    paths: merged,
    fromDocsCount: fromProjectDocs.length,
    fromDiskCount: fromDisk.length,
    fromReadmeCount: fromReadme.length,
    fromDocsDirCount: fromDocsDir.length,
    fromModuleSpecsCount: fromModuleSpecs.length,
    fromProjectContextCount: fromProjectContext.length,
    nestedDirsDetected,
  };
}

/**
 * 递归收集目录下所有 .md 文件（Feature 140 T27 — fromDocsDir 实现）。
 *
 * 跳过常见生成目录避免把 build artifact 的 markdown 误送给 LLM。
 * 黑名单设计原则：覆盖 JS/TS / Python / Rust / Go / Java / 通用缓存目录的产物路径。
 * 修复 Codex W-2：之前的 5 项黑名单遗漏 `__pycache__` / `target` / `.cache` / `tmp` 等。
 */
const MD_SCAN_DIR_BLACKLIST = new Set([
  'node_modules', // npm/yarn/pnpm
  '.git',         // git
  '.cache',       // 通用缓存（npm/yarn/parcel/etc）
  'dist',         // JS/TS 构建产物
  'build',        // 通用构建产物（CMake/Java/etc）
  'coverage',     // 测试覆盖率报告
  'out',          // Next.js / 通用输出
  'target',       // Rust / Java/Maven
  '__pycache__',  // Python
  '.pytest_cache',
  'tmp',          // 临时文件
  '.tmp',
  '.next',        // Next.js
  '.nuxt',        // Nuxt.js
  '.turbo',       // Turborepo
]);

function collectMdRecursive(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (MD_SCAN_DIR_BLACKLIST.has(entry.name)) continue;
      collectMdRecursive(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(path.join(dir, entry.name));
    }
  }
}



// ============================================================
// Feature 151 — Python CodeSkeleton 收集（含 callSites 抽取）
// ============================================================

// F217 T004：加 export（零行为变化）——供 src/panoramic/graph/quality/ignore-oracle.ts
// 一致性单测断言 PY_SKELETON_IGNORE_DIRS ⊆ 共享内置忽略集合，防止未来三处定义漂移。
export const PY_SKELETON_IGNORE_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv',
  'build', 'dist', 'coverage', 'out', 'target', '.tox',
]);

/**
 * Feature 151 T-008c — 收集 .py 文件 CodeSkeleton（含 callSites + 本地 import 解析）。
 *
 * 与 PythonLanguageAdapter.extractSymbolNodes / buildModuleGraph 不同：
 * - 显式传 extractCallSites=true，让 graph.json 含 callSites 字段
 * - 在 PythonMapper 输出基础上补充 import 的 resolvedPath（基于项目内 .py 模块 basename map）
 *   — Codex P1 C-1 修订：mapper 当前只输出 moduleSpecifier，resolvedPath 始终 null，
 *     导致 deriveImportEdges / call-resolver Stage 3 cross-module 全部失效
 *
 * 单文件解析失败 / 大文件 / 非 UTF-8 都按 EC-14 兜底（mapper 已处理），不影响整体 collection。
 */
export async function collectPythonCodeSkeletons(
  projectRoot: string,
): Promise<Map<string, CodeSkeleton>> {
  const out = new Map<string, CodeSkeleton>();
  const { PythonLanguageAdapter } = await import('../../adapters/python-adapter.js');
  const adapter = new PythonLanguageAdapter();

  // Codex P3+P4 复审 C-2 修复：projectRoot 显式 normalize 为绝对路径
  // 避免调用方传相对路径 → Map key 与 imports[].resolvedPath 形态不一致
  // → call-resolver buildImportIndex lookup miss
  const resolvedProjectRoot = path.resolve(projectRoot);

  // F194：构建 .gitignore 过滤器，基准 = resolvedProjectRoot（与 walk 内 path.relative 同口径）
  const isGitignored = createGitignoreFilter(resolvedProjectRoot);

  const pyFiles: string[] = [];
  walkPyFiles(resolvedProjectRoot, pyFiles, isGitignored, resolvedProjectRoot);

  // Feature 152 P3 T-017：大文件 size guard 提前到 parse 之前（避免 tree-sitter 解析阻塞）
  // 1MB 阈值与 PythonMapper.CALLSITES_MAX_FILE_BYTES 对齐（EC-14）
  const MAX_FILE_BYTES = 1_000_000;

  for (const filePath of pyFiles) {
    try {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue; // 文件读不到 stat → 跳过
      }
      if (stat.size > MAX_FILE_BYTES) {
        // 大文件 skip — 不调 analyzeFile（避免 tree-sitter parse 巨型文件）
        continue;
      }
      const skeleton = await adapter.analyzeFile(filePath, { extractCallSites: true });

      // Feature 152 P3 T-017：使用 resolvePythonImport 替换 basename map（plan §5.1）
      // C-1 修复：from . import X1, X2 形态（moduleSpecifier='.'/'..') 需对每个 namedImport 单独调用
      // EC-10 修复：resolvedPath 转为绝对路径，与 Map key 格式对齐
      const resolvedSkeleton: CodeSkeleton = {
        ...skeleton,
        imports: skeleton.imports.flatMap((imp) => {
          if (imp.resolvedPath) return [imp];

          const spec = imp.moduleSpecifier;

          // C-1：裸相对 import —— moduleSpecifier 仅为纯点（'.' / '..' / '...' / 更深）
          // "from . import nn, Value" → imp.namedImports=['nn','Value']，逐个拆解
          // quality-review W-2 修复：扩展到任意点深度（PEP 328 不限层数），
          // 避免 'from ... import a, b' 时 a/b 都映射到同一 resolvedPath（namedImports 污染）
          if (/^\.+$/.test(spec)) {
            const namedImports: string[] = Array.isArray(imp.namedImports)
              ? (imp.namedImports as string[])
              : [];
            if (namedImports.length === 0) {
              // 没有 namedImports（罕见），仅尝试解析包 __init__
              const result = resolvePythonImport(spec, filePath, resolvedProjectRoot);
              const resolvedPath = result.resolvedPath
                ? path.resolve(resolvedProjectRoot, result.resolvedPath)
                : null;
              return [{ ...imp, resolvedPath }];
            }
            // 每个 namedImport 单独解析为独立 import 记录
            // Codex P3+P4 复审 C-1 修复：每条拆出记录的 namedImports 必须**只**含
            // 当前拆出的 name，否则 buildImportIndex 会把所有 namedImports 都映射到
            // 同一 resolvedPath（最后一条胜出），导致 alias 污染
            return namedImports.map((name) => {
              const combinedSpec = `${spec}${name}`; // '.' + 'nn' → '.nn'
              const result = resolvePythonImport(combinedSpec, filePath, resolvedProjectRoot);
              const resolvedPath = result.resolvedPath
                ? path.resolve(resolvedProjectRoot, result.resolvedPath)
                : null;
              return {
                ...imp,
                moduleSpecifier: combinedSpec,
                namedImports: [name], // 关键：仅含本次拆出的 name，避免 alias 污染
                resolvedPath,
              };
            });
          }

          // 常规形态：直接调用 resolver（from pkg.engine import Value / import os）
          const result = resolvePythonImport(spec, filePath, resolvedProjectRoot);
          // EC-10：resolver 返回相对 projectRoot 的 POSIX 路径，需转绝对路径与 Map key 对齐
          const resolvedPath = result.resolvedPath
            ? path.resolve(resolvedProjectRoot, result.resolvedPath)
            : null;
          return [{ ...imp, resolvedPath }];
        }),
      };
      out.set(filePath, resolvedSkeleton);
    } catch {
      // 单文件失败不影响整体
    }
  }
  return out;
}

/**
 * F194：isGitignored 与 resolvedRoot 由 collectPythonCodeSkeletons 构建并通过参数传入，
 * 在自写 walk 上叠加 .gitignore 过滤层（保留 PY_SKELETON_IGNORE_DIRS 与点前缀剪枝不变）。
 */
function walkPyFiles(
  dir: string,
  out: string[],
  isGitignored: (relativePath: string) => boolean,
  resolvedRoot: string,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    // 基准 = resolvedRoot，path.relative 输出不做 sep 转换（与 file-scanner walkDir 一致）
    const relPath = path.relative(resolvedRoot, path.join(dir, entry.name));
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      if (PY_SKELETON_IGNORE_DIRS.has(entry.name)) continue;
      if (isGitignored(relPath)) continue; // 目录命中 .gitignore → 剪枝
      walkPyFiles(path.join(dir, entry.name), out, isGitignored, resolvedRoot);
    } else if (entry.isFile() && (entry.name.endsWith('.py') || entry.name.endsWith('.pyi'))) {
      if (isGitignored(relPath)) continue; // 文件命中 .gitignore → 跳过
      out.push(path.join(dir, entry.name));
    }
  }
}

// ============================================================
// Feature 152 — TypeScript/JavaScript CodeSkeleton 收集
// ============================================================

/**
 * T-020：TS/JS 文件扫描时忽略的目录集合（与 Python 对齐，增加 .next / .nuxt 等前端产物目录）
 * F217 T004：加 export（零行为变化），理由同 PY_SKELETON_IGNORE_DIRS。
 */
export const TSJS_SKELETON_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', 'out', 'target',
  '.next', '.nuxt', '.turbo', '.cache', 'tmp', '.tmp',
  '__pycache__', '.pytest_cache', '.tox',
]);

/**
 * Feature 152 T-020 — 收集 .ts/.tsx/.js/.jsx 文件 CodeSkeleton（含 callSites + import 路径解析）。
 *
 * 与 collectPythonCodeSkeletons 设计对齐：
 * - 可选 extractCallSites，走 TsJsLanguageAdapter 双路径 merge（Feature 152 T-013/T-014）
 * - 解析 imports[].resolvedPath：findNearestTsConfig + buildTsConfigContext + resolveTsJsImport
 * - EC-10：resolvedPath 转绝对路径与 Map key 格式对齐
 * - T-021a：tsconfig context 按 configDir 缓存，避免每文件重复读
 * - 单文件失败不阻塞整体（catch 吞掉，同 Python 版本 EC-14 兜底）
 */
export async function collectTsJsCodeSkeletons(
  projectRoot: string,
  options?: { extractCallSites?: boolean },
): Promise<Map<string, CodeSkeleton>> {
  const out = new Map<string, CodeSkeleton>();
  const { TsJsLanguageAdapter } = await import('../../adapters/ts-js-adapter.js');
  const adapter = new TsJsLanguageAdapter();

  // Codex P3+P4 复审 C-2 修复：projectRoot 显式 normalize 为绝对路径
  // 避免调用方传相对路径 → Map key 与 imports[].resolvedPath 形态不一致
  const resolvedProjectRoot = path.resolve(projectRoot);

  // F194：构建 .gitignore 过滤器，基准 = resolvedProjectRoot（与 walk 内 path.relative 同口径）
  const isGitignored = createGitignoreFilter(resolvedProjectRoot);

  const tsJsFiles: string[] = [];
  walkTsJsFiles(resolvedProjectRoot, tsJsFiles, isGitignored, resolvedProjectRoot);

  // T-021a：tsconfig context 缓存（by configDir），避免每个文件重复读
  const tsConfigCache = new Map<string, TsConfigResolutionContext | null>();

  // 大文件 size guard 与 Python 版本对齐（EC-14：1MB 阈值）
  const MAX_FILE_BYTES = 1_000_000;

  for (const filePath of tsJsFiles) {
    try {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue; // 文件读不到 stat → 跳过
      }
      if (stat.size > MAX_FILE_BYTES) {
        continue; // 大文件 skip
      }

      // 主分析（含 callSites if options.extractCallSites）
      const skeleton = await adapter.analyzeFile(filePath, {
        extractCallSites: options?.extractCallSites,
      });

      // T-021a：查找最近的 tsconfig.json 并缓存 context（Feature 181：loader 收口为 configPath 单参）
      const configPath = findNearestTsConfig(filePath, resolvedProjectRoot);
      let tsConfigContext: TsConfigResolutionContext | null = null;
      if (configPath) {
        if (!tsConfigCache.has(configPath)) {
          tsConfigCache.set(configPath, buildTsConfigContext(configPath));
        }
        tsConfigContext = tsConfigCache.get(configPath) ?? null;
      }

      // 解析 imports[].resolvedPath（EC-10：转绝对路径）
      const resolvedSkeleton: CodeSkeleton = {
        ...skeleton,
        imports: skeleton.imports.map((imp) => {
          if (imp.resolvedPath) return imp;
          const result = resolveTsJsImport(
            imp.moduleSpecifier,
            filePath,
            resolvedProjectRoot,
            tsConfigContext,
          );
          // EC-10：resolver 返回相对 projectRoot 的 POSIX 路径，需转绝对路径与 Map key 对齐
          const resolvedPath = result.resolvedPath
            ? path.resolve(resolvedProjectRoot, result.resolvedPath)
            : null;
          return { ...imp, resolvedPath };
        }),
      };

      out.set(filePath, resolvedSkeleton);
    } catch {
      // 单文件失败不影响整体（与 collectPythonCodeSkeletons EC-14 一致）
    }
  }

  return out;
}

/**
 * 递归扫描 .ts/.tsx/.js/.jsx 文件（排除产物目录）。
 * 复用 walkPyFiles 的扫描模式，扩展 TS/JS 扩展名集合。
 *
 * F194：isGitignored 与 resolvedRoot 由 collectTsJsCodeSkeletons 构建并通过参数传入，
 * 在自写 walk 上叠加 .gitignore 过滤层（保留 TSJS_SKELETON_IGNORE_DIRS 与点前缀剪枝不变）。
 */
function walkTsJsFiles(
  dir: string,
  out: string[],
  isGitignored: (relativePath: string) => boolean,
  resolvedRoot: string,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    // 基准 = resolvedRoot，path.relative 输出不做 sep 转换（与 file-scanner walkDir 一致）
    const relPath = path.relative(resolvedRoot, path.join(dir, entry.name));
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      if (TSJS_SKELETON_IGNORE_DIRS.has(entry.name)) continue;
      if (isGitignored(relPath)) continue; // 目录命中 .gitignore → 剪枝
      walkTsJsFiles(path.join(dir, entry.name), out, isGitignored, resolvedRoot);
    } else if (entry.isFile()) {
      const name = entry.name;
      if (
        name.endsWith('.ts') ||
        name.endsWith('.tsx') ||
        name.endsWith('.js') ||
        name.endsWith('.jsx')
      ) {
        if (isGitignored(relPath)) continue; // 文件命中 .gitignore → 跳过
        out.push(path.join(dir, entry.name));
      }
    }
  }
}

