/**
 * F217 决策 2 增补（FR-008）：共享 ignore 判定 oracle。
 *
 * 组合三态 gitignore oracle（gitignore-oracle.ts）+ 图生产者自己的忽略目录合同
 * （GRAPH_COLLECTOR_IGNORE_DIRS），供 legacy-ignored-check.ts（ignored path 节点检测）与
 * generic-language-skeleton-collector.ts（Java/Go 采集器）共同复用，
 * 避免出现第三份互不一致的忽略规则定义。
 *
 * 与六指标 check 函数不同，本模块内部会 spawn 子进程、读文件系统，且带内部可变状态
 * （记忆化 / 不可判计数 / L2 预算）——因此不是"零 I/O 纯函数"，由 CLI 层 / collector 层
 * 显式构造后注入到 check 里（legacy-ignored-check.ts 的 isIgnored 回调）。
 *
 * F258 三态收敛（本模块的核心职责）：底层 oracle 给 `ignored | not-ignored | undeterminable`
 * 三态，本模块把它收口成 `checkLegacyAndIgnoredNodes` 需要的同步 boolean 谓词，方向是
 * **`undeterminable` ⇒ 按 `not-ignored` 处理**——与采集面消费方**同向**（详见
 * legacy-ignored-check.ts 文件头）。诊断不丢弃，经 `drainUndeterminable()` 有界取回；
 * 刻意**不**提供"返回裸谓词"的便捷入口，那等于给未来的消费方留一个静默丢弃诊断的口子。
 *
 * 事实源口径（撤下 over-claim）：底层是两个回答不同问题的 git 命令
 * （`git ls-files --others --ignored --directory` 管在盘枚举、`git check-ignore` 管规则查询，
 * 后者权威**但非全域**），已知限制 KL-1..KL-6 逐条登记在 gitignore-oracle.ts 文件头。
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
import {
  createGitignoreOracle,
  type UndeterminableSummary,
} from '../../../utils/gitignore-oracle.js';
import {
  GO_ADAPTER_SURFACE,
  JAVA_ADAPTER_SURFACE,
  PY_WALK_SURFACE,
  TSJS_SKELETON_WALK_SURFACE,
  surfaceMatchesFile,
} from '../../../collector-surface.js';

/**
 * 图生产者 ignore 合同的 union 兜底集 = #1 TSJS walk ∪ #2 PY walk 的剪枝集，**由采集面事实源
 * `src/collector-surface.ts` 派生**（F284；此前是手抄字面量 + ⊆ 子集断言，两侧曾允许分叉）。
 *
 * 守卫口径（F284）：`ignore-oracle.test.ts` 与 `collector-surface-ignore-dirs.test.ts` 断言本集合与
 * TSJS ∪ PY **相等**（不再是 ⊆、不再允许真超集）；行为哨兵测试
 * `collector-surface-ignore-dirs-behavior.test.ts` 对每个消费方逐名断言有效剪枝集。
 *
 * 与 file-scanner.ts 的通用忽略集语义不同——本集合不含 'specs'/'examples'/'fixtures' 等"spec 产物目录"
 * 条目，因为图生产者本身就会扫描这些目录下的真实源码。
 *
 * 分派盲区（既有，SSoT 角 W3，登记 M11）：`.py` 只分派到 #2 集合，没有 #11（PythonLanguageAdapter.scanPyFiles）
 * 分支——#11 采到的 `build/ coverage/ out/ target/` 下 .py 节点会被本 oracle 判 ignored（合法采集判成忽略 =
 * 假警报，把 graph-quality 压到 pass-with-warnings；实测 f286 旧 dist 同结果）。
 */
export const GRAPH_COLLECTOR_IGNORE_DIRS: ReadonlySet<string> = new Set([
  // F284：由采集面事实源派生（TSJS ∪ PY 两条 walk 的剪枝集），不再手抄；两侧不可能分叉
  ...TSJS_SKELETON_WALK_SURFACE.ignoreDirs,
  ...PY_WALK_SURFACE.ignoreDirs,
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

/** TSJS collector 忽略目录合同（F284：直接引用采集面事实源，不再字面量镜像）。 */
const TSJS_IGNORE_DIRS: ReadonlySet<string> = TSJS_SKELETON_WALK_SURFACE.ignoreDirs;

/** PY collector 忽略目录合同（F284：同上）。 */
const PY_IGNORE_DIRS: ReadonlySet<string> = PY_WALK_SURFACE.ignoreDirs;

/**
 * generic-language-skeleton-collector 对所有语言均适用的通用忽略目录（oracle 对 java/go **文件级**判定的补集）。
 *
 * 与生产者的真实关系（F284 对抗复审 W1 实证，修正首稿写反的方向）：generic walk 对**目录**调 `isIgnored`，
 * 目录路径无扩展名 ⇒ 走 union 兜底 ⇒ `node_modules/ dist/ coverage/ tmp/ __pycache__/ venv/ .cache/ .tox/`
 * 等 GRAPH_COLLECTOR_IGNORE_DIRS 成员都会被剪；而本 oracle 对 `.java/.go` 文件只用 适配器集 ∪ 本集合，
 * 比 walk **窄**——分歧方向是 oracle 漏判 ignored（不是多判）。要闭合应派生为 JAVA ∪ GRAPH_COLLECTOR_IGNORE_DIRS，
 * 属行为变更，登记 M11；现状由 behavior 测试逐名钉住。
 */
const GENERIC_UNIVERSAL_IGNORE_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git']);

/** Java 生产者忽略集合 = 采集面 JAVA_ADAPTER_SURFACE.ignoreDirs（= JavaLanguageAdapter.defaultIgnoreDirs）∪ 通用集合。 */
function javaIgnoreDirs(): ReadonlySet<string> {
  return new Set([...JAVA_ADAPTER_SURFACE.ignoreDirs, ...GENERIC_UNIVERSAL_IGNORE_DIRS]);
}

/** Go 生产者忽略集合 = 采集面 GO_ADAPTER_SURFACE.ignoreDirs ∪ 通用集合。 */
function goIgnoreDirs(): ReadonlySet<string> {
  return new Set([...GO_ADAPTER_SURFACE.ignoreDirs, ...GENERIC_UNIVERSAL_IGNORE_DIRS]);
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
 * - git 忽略规则判定为 `ignored`（三态 oracle；`undeterminable` **不**算命中，按 not-ignored 处理）
 * - 路径任意目录段命中该路径扩展名对应的图生产者忽略目录合同（FIX-5：按语言分派，
 *   而非无差别 union；未知扩展名退回 GRAPH_COLLECTOR_IGNORE_DIRS 兜底）
 *
 * 注意 `undeterminable` 的可达性如实表述：walk 场景**通常**不可达（dirent 恒在盘 ⇒ 走 L1
 * 查表），但 EACCES / ELOOP 等 errno 形态**可达**——此时按 not-ignored 处理，
 * 与旧行为逐字节一致。不得写成"结构上不可达"。
 */
export interface IgnoreOracle {
  /**
   * 同步 boolean 谓词（`checkLegacyAndIgnoredNodes` 的既有契约不变）。
   * 三态在本函数内部收敛：`undeterminable` ⇒ 按 `not-ignored` 处理（见 drainUndeterminable）。
   */
  isIgnored(relativePath: string): boolean;
  /** 取走并清空累积的"判不了"诊断；返回形状含 `budgetExhausted` 具名出口。 */
  drainUndeterminable(): UndeterminableSummary;
}

export function createIgnoreOracle(projectRoot: string): IgnoreOracle {
  const gitignore = createGitignoreOracle(projectRoot);

  return {
    isIgnored(relativePath: string): boolean {
      if (gitignore.verdict(relativePath) === 'ignored') return true;
      const segments = relativePath
        .split(/[\\/]/)
        .filter((seg) => seg.length > 0 && seg !== path.sep);
      const ignoreDirs = ignoreDirsForPath(relativePath);
      return segments.some((seg) => ignoreDirs.has(seg));
    },
    drainUndeterminable: () => gitignore.drainUndeterminable(),
  };
}
