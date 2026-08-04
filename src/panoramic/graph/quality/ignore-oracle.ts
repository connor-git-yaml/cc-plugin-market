/**
 * F217 决策 2 增补（FR-008）：共享 ignore 判定 oracle。
 *
 * 组合 createGitignoreFilter（.gitignore 规则）+ 图生产者自己的忽略目录合同（GRAPH_COLLECTOR_IGNORE_DIRS），
 * 供 legacy-ignored-check.ts（ignored path 节点检测）与
 * generic-language-skeleton-collector.ts（Java/Go 采集器）共同复用，
 * 避免出现第三份互不一致的忽略规则定义。
 *
 * 与六指标 check 函数不同，本模块内部调用 createGitignoreFilter（F255 起：git 仓库内向
 * git 本体预取忽略清单，非 git 上下文回退读根 .gitignore 文件），存在子进程 / 文件系统
 * I/O——因此不是"零 I/O 纯函数"，由 CLI 层 / collector 层显式构造后注入到纯函数 check 里
 * （legacy-ignored-check.ts 的 isIgnored 回调）。
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
import {
  GO_ADAPTER_SURFACE,
  JAVA_ADAPTER_SURFACE,
  PY_WALK_SURFACE,
  TSJS_SKELETON_WALK_SURFACE,
  surfaceMatchesFile,
} from '../../../collector-surface.js';

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

/**
 * 按路径落在哪条采集面分派到对应生产者的忽略目录集合；不落任何采集面（含纯目录路径）
 * → union 兜底。
 *
 * F249 FR-002 #5：分派判定面原为本文件自有的 `TSJS_EXTENSIONS`/`PY_EXTENSIONS` 镜像
 * 常量 + `'.java'`/`'.go'` 字面量比较，现全部改为消费采集面事实源，并按各管线自身的
 * `matchSemantics` 判定（d27ba75 给 `TSJS_EXTENSIONS` 追加的 `.mjs`/`.cjs` 随该镜像常量
 * 一并消亡，扩面语义由 `TSJS_SKELETON_WALK_SURFACE` 单点表达）。两处随之修正的分派失真
 * （均为向生产者真实行为靠拢）：
 * ① `.pyi` 此前落 union 兜底，现随 PY 生产者面走 PY_IGNORE_DIRS（walkPyFiles 确实采集 `.pyi`）；
 * ② `Foo.JAVA`/`main.GO` 等大小写变体此前落 union 兜底，现随各自 adapter 面走对应忽略集合
 *    （generic collector 用 `extname().toLowerCase()`，确实会采集这些变体）。
 *
 * 判定形态遵循 W-004 合同：本函数手上持有的是调用方给的**完整相对路径**（见
 * `createIgnoreOracle` 的 `relativePath`），而不是一个已提取好的扩展名字符串，因此整条
 * 判定委托 `surfaceMatchesFile`，不再先自行提取扩展名再走 `surfaceHasExtension`——
 * "文件名 → 扩展名"的提取口径本身就随管线而异（endsWith 族 vs `path.extname` 族），
 * 把提取步骤留在消费方实现正是 W-004 所指的形态失真来源。
 *
 * 两族的分派合同，以"末尾切片式提取"（`name.slice(name.lastIndexOf('.'))`，F252 前的
 * 实现口径，随 `collector-extname.ts` 退役）为对照系——测试正是按这两族的分歧钉住的：
 * - 大小写敏感族（TSJS/PY）与对照系**恒等**：对面内每个扩展名 e，"末尾切片 === e"
 *   ⟺ "relativePath.endsWith(e)"。纯 dotfile `.ts` 命中 TSJS 面，与生产者 walkTsJsFiles
 *   的 `endsWith` 同解。
 * - 大小写不敏感族（Java/Go）走 `path.extname`，与对照系存在**两类**分歧；两类都只改变
 *   分派目标（语言专属集合 ⇄ union 兜底），故目录段落在哪个集合决定翻转方向，两类各自
 *   **双向**可翻：
 *   ① 纯 dotfile basename（`.go`/`.java`）：`path.extname` 判定其无扩展名 → union 兜底，
 *      而对照系算出 `.go` → 语言专属集合。目录段只在专属集合内（`vendor/.go`、
 *      `.gradle/.java`）→ 判定为不忽略；目录段只在 union 内（`tmp/.java`、`dist/.go`、
 *      `venv/.java`、`target/.go`）→ 判定为忽略。
 *   ② 尾随分隔符路径（`f.go/` 形态）：`path.extname` 剥掉尾随分隔符算出 `.go` → 语言专属
 *      集合，而对照系保留分隔符得到 `.go/`、不落任何面 → union 兜底。分派移动方向与 ①
 *      相反，翻转方向随之镜像：`vendor/f.go/` → 判定为忽略；`tmp/f.go/` → 判定为不忽略。
 *
 * 上述两类形态在现有全部消费方均**不可达**，因此分歧不产生可观察的判定差异（采集面与图
 * 质量门结论均不受影响，BEHAVIOR_VERSION 不因这两类分歧而 bump）：
 * - generic collector（`generic-language-skeleton-collector.ts::walkFiles`）：目录项被
 *   `entry.name.startsWith('.')` 前置跳过，文件项被 `surfaceMatchesFile` 的扩展面判定挡下
 *   （纯 dotfile 不匹配 case-insensitive 面），两条路径都在调用 `isIgnored` **之前** return；
 *   而 relativePath 由 `path.relative(path.join(...))` 构造、`entry.name` 不含分隔符，
 *   结构上不产出尾随分隔符形态。
 * - 图质量门（`legacy-ignored-check.ts`）：输入是图节点 id 的 filePart，由上述采集器产出，
 *   同样不含这两类形态。
 *
 * 新增消费方时 MUST 重新评估这条不可达性：若某消费方可能持有纯 dotfile 或带尾随分隔符的
 * 路径，上述分歧会立刻变为可观察行为差异。
 */
function ignoreDirsForPath(relativePath: string): ReadonlySet<string> {
  if (surfaceMatchesFile(TSJS_SKELETON_WALK_SURFACE, relativePath)) return TSJS_IGNORE_DIRS;
  if (surfaceMatchesFile(PY_WALK_SURFACE, relativePath)) return PY_IGNORE_DIRS;
  if (surfaceMatchesFile(JAVA_ADAPTER_SURFACE, relativePath)) return javaIgnoreDirs();
  if (surfaceMatchesFile(GO_ADAPTER_SURFACE, relativePath)) return goIgnoreDirs();
  return GRAPH_COLLECTOR_IGNORE_DIRS;
}

/**
 * 构造 ignore 判定函数：输入相对 projectRoot 的路径，返回是否应被视为"已忽略"。
 *
 * 命中条件（任一即视为忽略）：
 * - git 忽略规则命中（全语言通用；F255 起以 git 本体为事实源，非 git 上下文回退根 .gitignore 近似）
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
