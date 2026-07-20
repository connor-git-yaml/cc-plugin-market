/**
 * F217 决策 2 增补（FR-008）：共享 ignore 判定 oracle。
 *
 * 组合 createGitignoreFilter（.gitignore 规则）+ 图生产者自己的忽略目录合同（GRAPH_COLLECTOR_IGNORE_DIRS），
 * 供 legacy-ignored-check.ts（ignored path 节点检测）与
 * generic-language-skeleton-collector.ts（Java/Go 采集器）共同复用，
 * 避免出现第三份互不一致的忽略规则定义。
 *
 * 与六指标 check 函数不同，本模块内部调用 createGitignoreFilter（读 .gitignore 文件），
 * 存在文件系统 I/O——因此不是"零 I/O 纯函数"，由 CLI 层 / collector 层显式构造后
 * 注入到纯函数 check 里（legacy-ignored-check.ts 的 isIgnored 回调）。
 *
 * P0 修正（本仓库实跑发现 551 个假阳性 ignored-path 节点后的根因修复）：
 * 早期实现误用了 `src/utils/file-scanner.ts` 的 `BUILTIN_IGNORE_DIRS`——那是"spec 生成
 * 扫描器"的忽略集合，语义是"spec 产物目录（如 specs/、examples/）不再重复分析"；
 * 但图生产者（collectPythonCodeSkeletons / collectTsJsCodeSkeletons，见
 * batch-orchestrator.ts 的 PY_SKELETON_IGNORE_DIRS / TSJS_SKELETON_IGNORE_DIRS）
 * **有意**扫描 specs/ 下的真实源码（如 specs/*\/contracts/*.ts）。用 file-scanner
 * 的 BUILTIN_IGNORE_DIRS 去判定图产物中的节点是否"应被忽略"，会与图生产者自己的合同
 * 冲突，导致本该正常入图的节点被误判为"ignored path 节点"（本仓库实测 551 个假阳性）。
 *
 * 图质量门的 ignore 判定必须以图生产者自己的 ignore 合同为准，因此本文件定义
 * `GRAPH_COLLECTOR_IGNORE_DIRS` 作为该合同的单一事实源，而非复用 file-scanner 的
 * BUILTIN_IGNORE_DIRS。
 */
import * as path from 'node:path';
import { createGitignoreFilter } from '../../../utils/file-scanner.js';
import { JavaLanguageAdapter } from '../../../adapters/java-adapter.js';
import { GoLanguageAdapter } from '../../../adapters/go-adapter.js';

/**
 * 图生产者 ignore 合同的单一事实源：TSJS_SKELETON_IGNORE_DIRS ∪ PY_SKELETON_IGNORE_DIRS
 * （均定义于 `src/batch/batch-orchestrator.ts`）。
 *
 * 字面枚举合并写死为单一 Set（不 import batch-orchestrator.ts 做运行时 spread），
 * 理由：① 避免 ignore-oracle.ts 引入 batch-orchestrator.ts 这个巨型模块的运行时依赖
 * （潜在循环引用与冷启动成本）；② 两侧集合的一致性交由 `ignore-oracle.test.ts` 的
 * 子集断言（真实 import 两常量校验 ⊆ 关系）在测试期守护，防止未来任一 collector
 * 新增忽略目录时忘记同步本集合。
 *
 * 与 file-scanner.ts 的 `UNIVERSAL_IGNORE_DIRS`/spec 扫描器语义不同——本集合不含
 * 'specs'/'examples'/'fixtures' 等"spec 产物目录"条目，因为图生产者本身就会扫描
 * 这些目录下的真实源码。
 *
 * 允许是 TSJS_SKELETON_IGNORE_DIRS 与 PY_SKELETON_IGNORE_DIRS 的真超集（union 语义），
 * 不要求恰好相等。
 */
export const GRAPH_COLLECTOR_IGNORE_DIRS: ReadonlySet<string> = new Set([
  // TSJS_SKELETON_IGNORE_DIRS ∪ PY_SKELETON_IGNORE_DIRS
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'tmp',
  '.tmp',
  '__pycache__',
  '.pytest_cache',
  '.tox',
  '.venv',
  'venv',
]);

// ============================================================
// FIX-5（Codex WARNING）：按语言分派到对应生产者忽略集合
// ============================================================
//
// 此前 createIgnoreOracle 对所有路径统一用 GRAPH_COLLECTOR_IGNORE_DIRS（union 语义）
// 判定，导致跨语言误报：
// - 假阴性：Go 的 `vendor/` 只在 Go generic adapter 的 defaultIgnoreDirs 里，不在
//   union 常量里，`.gradle/`（Java）同理——union 常量只镜像 TSJS/PY 两个专属 collector，
//   未覆盖 F217 决策 1 新增的 Java/Go generic collector 各自的 defaultIgnoreDirs。
// - 假阳性：union 是"任一语言排除即整体排除"，导致 PY 文件被 TSJS 独有的 `tmp/` 误伤、
//   TSJS 文件被 PY 独有的 `venv/` 误伤——但 PY collector 的 walkPyFiles 根本不排除
//   tmp，TSJS collector 的 walkTsJsFiles 也不排除 venv，图里这些文件本该正常入图。
//
// 修复：按路径扩展名分派到对应生产者的专属忽略集合；扩展名未知（含无扩展名的目录
// 路径本身）时退回 union 兜底（保守，宁可多判 ignored，不误判本该忽略的目录为已入图）。

/** TSJS collector 忽略目录合同（字面量镜像 batch-orchestrator.ts::TSJS_SKELETON_IGNORE_DIRS）。 */
const TSJS_IGNORE_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', 'out', 'target',
  '.next', '.nuxt', '.turbo', '.cache', 'tmp', '.tmp',
  '__pycache__', '.pytest_cache', '.tox',
]);

/** PY collector 忽略目录合同（字面量镜像 batch-orchestrator.ts::PY_SKELETON_IGNORE_DIRS）。 */
const PY_IGNORE_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv',
  'build', 'dist', 'coverage', 'out', 'target', '.tox',
]);

/** generic-language-skeleton-collector 对所有语言均适用的通用忽略目录。 */
const GENERIC_UNIVERSAL_IGNORE_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git']);

/** Java 生产者忽略集合 = JavaLanguageAdapter().defaultIgnoreDirs ∪ 通用集合。 */
function javaIgnoreDirs(): ReadonlySet<string> {
  return new Set([...new JavaLanguageAdapter().defaultIgnoreDirs, ...GENERIC_UNIVERSAL_IGNORE_DIRS]);
}

/** Go 生产者忽略集合 = GoLanguageAdapter().defaultIgnoreDirs ∪ 通用集合。 */
function goIgnoreDirs(): ReadonlySet<string> {
  return new Set([...new GoLanguageAdapter().defaultIgnoreDirs, ...GENERIC_UNIVERSAL_IGNORE_DIRS]);
}

const TSJS_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx', '.js', '.jsx']);
const PY_EXTENSIONS: ReadonlySet<string> = new Set(['.py']);

function extnameOf(relativePath: string): string {
  const idx = relativePath.lastIndexOf('.');
  if (idx < 0) return '';
  return relativePath.slice(idx);
}

/** 按扩展名分派到对应生产者的忽略目录集合；未知扩展名（含纯目录路径）→ union 兜底。 */
function ignoreDirsForPath(relativePath: string): ReadonlySet<string> {
  const ext = extnameOf(relativePath);
  if (TSJS_EXTENSIONS.has(ext)) return TSJS_IGNORE_DIRS;
  if (PY_EXTENSIONS.has(ext)) return PY_IGNORE_DIRS;
  if (ext === '.java') return javaIgnoreDirs();
  if (ext === '.go') return goIgnoreDirs();
  return GRAPH_COLLECTOR_IGNORE_DIRS;
}

/**
 * 构造 ignore 判定函数：输入相对 projectRoot 的路径，返回是否应被视为"已忽略"。
 *
 * 命中条件（任一即视为忽略）：
 * - .gitignore 规则命中（全语言通用）
 * - 路径任意目录段命中该路径扩展名对应的图生产者忽略目录合同（FIX-5：按语言分派，
 *   而非无差别 union；未知扩展名退回 GRAPH_COLLECTOR_IGNORE_DIRS 兜底）
 */
export function createIgnoreOracle(projectRoot: string): (relativePath: string) => boolean {
  const gitignoreCheck = createGitignoreFilter(projectRoot);

  return (relativePath: string): boolean => {
    if (gitignoreCheck(relativePath)) return true;
    const segments = relativePath.split(/[\\/]/).filter((seg) => seg.length > 0 && seg !== path.sep);
    const ignoreDirs = ignoreDirsForPath(relativePath);
    return segments.some((seg) => ignoreDirs.has(seg));
  };
}
