/**
 * F249 采集面单一事实源（Single Source of Truth）。
 *
 * 本模块是**零依赖叶子模块**（FR-019）：不 import 任何生产层（`batch`/`panoramic`/
 * `adapters`/`registry`/`knowledge-graph`）。FR-019 明确"仅允许依赖 Node 内建模块"，
 * 本模块因此只 import `node:path`——`surfaceMatchesFile` 的大小写不敏感分支必须调用
 * **与生产者同一个** `path.extname`，自造一份等价实现才是真正的风险（Node 对
 * `..`/`a..`/纯点文件的处理有非直觉分支，手写副本迟早与之漂移）。所有消费方（各采集
 * 管线自身 + `source-commit.ts` dirty 判定 + `ignore-oracle.ts` + `cache-key-builder.ts`
 * 代码子集 + 指纹计算模块）单向引用本模块。
 *
 * 为什么必须是叶子：`batch`↔`panoramic`、`adapters`↔`knowledge-graph` 已存在交叉引用，
 * `ignore-oracle.ts` 现有"不 import batch-orchestrator 避免循环依赖 + 冷启动成本"的
 * 注释是已验证的先例约束——把事实源落在任一消费层内部会重现该类问题。
 *
 * 为什么按管线分别声明而非合并成一个扁平集合：各采集管线的**匹配语义并不相同**
 * （TSJS/PY skeleton walk 用大小写敏感 `endsWith`；Java/Go adapter 与 module 派生扫描
 * 用 `extname().toLowerCase()` 大小写不敏感）。合并成扁平集合会丢失"该次变更影响
 * 哪条管线"的可辨识性，也会迫使 dirty 判定退化为单一全局语义（FIX-4 曾修复过的
 * "`.TS` 被误判触发 dirty"就是该退化的后果）。
 */
import * as path from 'node:path';

/**
 * 扩展名匹配语义：各采集管线按自身生产者实现原样保真，MUST NOT 为求统一而改写。
 *
 * 两个取值同时编码了**比较口径**与**匹配形态**——本仓库全部生产者恰好二分为两族，
 * 且两个维度一一对应（`surfaceMatchesFile` 依赖这条对应关系分派）：
 * - `case-sensitive` ⇔ `name.endsWith(ext)` 形态（TSJS/PY skeleton walk、python 符号扫描）。
 *   纯点文件 `.ts` **会**命中（`'.ts'.endsWith('.ts') === true`），与生产者一致。
 * - `case-insensitive` ⇔ `path.extname(name).toLowerCase()` 形态（Java/Go adapter 经 generic
 *   collector、module 派生扫描经 file-scanner walkDir）。纯点文件 `.go` **不**命中
 *   （`path.extname('.go') === ''`），同样与生产者一致。
 *
 * 若未来出现"大小写敏感但用 extname 提取"之类的第三族，MUST 在此扩充取值而**不是**
 * 复用现有取值——复用会让 `surfaceMatchesFile` 静默按错误形态匹配（W-004 修复的正是
 * 这类形态失真：原实现对两族一律用"lastIndexOf('.') 切片 + Set.has"，与两族生产者都不等价）。
 */
export type ExtensionMatchSemantics = 'case-sensitive' | 'case-insensitive';

/** 单条采集管线的 `{扩展集, 匹配语义}` 二元组。 */
export interface CollectorPipelineSurface {
  /** 该管线识别的扩展名集合（一律以小写字面量声明，与生产者的比较基准对齐）。 */
  readonly extensions: ReadonlySet<string>;
  readonly matchSemantics: ExtensionMatchSemantics;
}

/**
 * #1 TSJS skeleton walk（`batch/stages/source-discovery.ts::walkTsJsFiles`）。
 * 生产者用 `name.endsWith('.ts')` 逐扩展名精确匹配 → 大小写敏感。
 *
 * 扩面记账（rebase 调和 · 2026-08-03）：`.mjs`/`.cjs` 由 master 的 d27ba75（对方 F243
 * "四处扩展名脱节同步收口"）引入——该扩面此前需要在 walk 白名单 / dirty 判定常量 /
 * ignore 分派常量 / cache-key 代码子集**四处**手工镜像同步，本 Feature 把这四处收敛为对
 * 本常量的引用，因此扩面现在只在这一行表达。
 *
 * 显式**不含** `.mts`/`.cts`：沿用 d27ba75 登记的残留口径——TS 变体需 getLanguage/scriptKind
 * 联动适配，本仓库零存量。注意 `MODULE_DERIVATION_SCAN_SURFACE`（#7/#8）确实含这两个扩展，
 * 两面不等是**如实记账**而非疏漏（声明面比 skeleton 采集面宽）。
 */
export const TSJS_SKELETON_WALK_SURFACE: CollectorPipelineSurface = {
  extensions: new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']),
  matchSemantics: 'case-sensitive',
};

/**
 * #2 PY skeleton walk（`batch/stages/source-discovery.ts::walkPyFiles`）。
 * 生产者用 `name.endsWith('.py') || name.endsWith('.pyi')` → 大小写敏感，且含 `.pyi`。
 */
export const PY_WALK_SURFACE: CollectorPipelineSurface = {
  extensions: new Set(['.py', '.pyi']),
  matchSemantics: 'case-sensitive',
};

/**
 * #3 java 分量（`adapters/java-adapter.ts` 的 `extensions`，经
 * `batch/generic-language-skeleton-collector.ts::walkFiles` 的
 * `path.extname(name).toLowerCase()` 匹配）→ 大小写不敏感（`Foo.JAVA` 会被采集）。
 */
export const JAVA_ADAPTER_SURFACE: CollectorPipelineSurface = {
  extensions: new Set(['.java']),
  matchSemantics: 'case-insensitive',
};

/** #3 go 分量（`adapters/go-adapter.ts`，匹配路径与语义同 java 分量）。 */
export const GO_ADAPTER_SURFACE: CollectorPipelineSurface = {
  extensions: new Set(['.go']),
  matchSemantics: 'case-insensitive',
};

/**
 * #7/#8 module 派生扫描面：`adapters/ts-js-adapter.ts` 的 `extensions` 声明（#7）与
 * `knowledge-graph/module-derivation.ts` 的 registry-fallback 字面量（#8）原为一对
 * 手工镜像，现收敛为对本常量的共同引用。
 *
 * 匹配语义为大小写不敏感：该扩展集经 `utils/file-scanner.ts` 的 walkDir
 * `path.extname(name).toLowerCase()` 比较，`.MJS`/`.CTS` 等变体会被采集。
 */
export const MODULE_DERIVATION_SCAN_SURFACE: CollectorPipelineSurface = {
  extensions: new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']),
  matchSemantics: 'case-insensitive',
};

/**
 * #11 python 符号扫描面（`adapters/python-adapter.ts::scanPyFiles`）。
 *
 * **实现期审查（W-002，2026-08-03 落账）新增的第六条生产管线**：`scanPyFiles` 的产物经
 * `PythonLanguageAdapter.extractSymbolNodes` 进入 **graph-only 与 full 两种 mode** 的图
 * （`batch/stages/graph-assembly.ts` 与 `batch/batch-orchestrator.ts` 各有一处调用），
 * 因此它是不折不扣的建图采集面，此前漏记于 SSoT。
 *
 * 匹配形态与集合按 `scanPyFiles` 现状**如实记账**（`entry.name.endsWith('.py')`）：
 * - 集合只有 `.py`——**不含** `.pyi`，尽管 `PythonLanguageAdapter.extensions`（声明面，
 *   = `PY_WALK_SURFACE`）与 `walkPyFiles`（#2）都覆盖 `.pyi`
 * - 语义为大小写敏感 endsWith
 *
 * 声明面（`.py`+`.pyi`）与本扫描面（仅 `.py`）的失配是**既存现状而非本轮引入**：
 * `.pyi` 是否应产出符号节点属产品裁决，本轮显式不改 `scanPyFiles` 行为，只把现状登记进
 * 事实源与指纹（编排器已另行登记 follow-up）。行为探针（`tests/unit/collector-surface.test.ts`
 * 的 `mod.py` 命中 / `mod.pyi` 不命中）把该现状钉死：将来任一侧被改动都会变红，迫使
 * 修改者显式面对这个失配。
 */
export const PYTHON_SYMBOL_SCAN_SURFACE: CollectorPipelineSurface = {
  extensions: new Set(['.py']),
  matchSemantics: 'case-sensitive',
};

/**
 * 全部生产者管线（供 FR-003 dirty 判定逐管线遍历、指纹 `extensionSurface` 分量推导）。
 *
 * 顺序固定（tsjsSkeletonWalk → pyWalk → javaAdapter → goAdapter → moduleDerivationScan
 * → pythonSymbolScan），使依赖遍历顺序的下游（如 `staleReasons` 构造）产出确定性结果。
 * 新管线一律**追加在末尾**：插在中间会改动既有下标语义，而下标是测试与诊断的锚点。
 */
export const ALL_PRODUCER_SURFACES: readonly CollectorPipelineSurface[] = [
  TSJS_SKELETON_WALK_SURFACE,
  PY_WALK_SURFACE,
  JAVA_ADAPTER_SURFACE,
  GO_ADAPTER_SURFACE,
  MODULE_DERIVATION_SCAN_SURFACE,
  PYTHON_SYMBOL_SCAN_SURFACE,
];

/**
 * dirty 判定面的公开 seam（FR-002 #4）：`ALL_PRODUCER_SURFACES` 的直接 re-export。
 *
 * 原 `getDirtySourceExtensions(): ReadonlySet<string>` 的扁平 Set 契约已废除——扁平
 * 集合无法表达逐管线的混合匹配语义。`source-commit.ts` 内部谓词消费本 seam，测试
 * 则用 `DIRTY_SOURCE_SURFACES === ALL_PRODUCER_SURFACES` 断言引用同一性（SC-005a1）。
 */
export const DIRTY_SOURCE_SURFACES: readonly CollectorPipelineSurface[] = ALL_PRODUCER_SURFACES;

/**
 * 按 surface 自身的 `matchSemantics` 判定某**已提取的扩展名**是否属于该管线采集面。
 *
 * 纯函数、无 I/O。抽取到事实源模块内是为了让"匹配语义如何生效"只有一份实现——
 * 若各消费方各写一遍 `matchSemantics` 分支，事实源就只收敛了数据、没收敛语义，
 * 仍会出现"某处忘了做 toLowerCase"的镜像失真。
 *
 * **适用边界（W-004）**：本函数只回答"这个扩展名字符串是否在面内"，供**手上只有扩展名、
 * 没有文件名**的分派型消费方使用（如 `ignore-oracle.ts` 按扩展名选忽略目录集合）。
 * 要判定"某个文件是否会被该管线采集"，MUST 用 `surfaceMatchesFile`——因为"文件名 →
 * 扩展名"的提取口径本身就随管线而异（endsWith 族 vs `path.extname` 族），把提取步骤留给
 * 调用方各自实现，正是 W-004 那类形态失真（纯点文件 `src/.go` 被误判命中）的来源。
 *
 * @param extension 待判定扩展名，**保留原始大小写**（含前导 `.`，如 `.TS`）；
 *   调用方 MUST NOT 预先归一化，否则 case-sensitive 管线的判定会被静默放宽。
 */
export function surfaceHasExtension(
  surface: CollectorPipelineSurface,
  extension: string,
): boolean {
  if (surface.matchSemantics === 'case-sensitive') {
    return surface.extensions.has(extension);
  }
  return surface.extensions.has(extension.toLowerCase());
}

/**
 * 判定某文件名/路径是否落在该管线采集面内，**按该管线生产者的真实匹配形态求值**（W-004）。
 *
 * 两族形态各自与生产者逐字对应（见 `ExtensionMatchSemantics` 的说明）：
 * - `case-sensitive` → `filePathOrName.endsWith(ext)`。对完整路径直接 endsWith 与"先取
 *   basename 再 endsWith"恒等（basename 是路径的后缀，且扩展名内不含分隔符），故不必先切
 *   basename。纯点文件 `.ts` 命中，与 `walkTsJsFiles`/`walkPyFiles`/`scanPyFiles` 一致。
 * - `case-insensitive` → `path.extname(filePathOrName).toLowerCase()` 后查表。`path.extname`
 *   自带 basename 处理与"纯点文件无扩展名"规则，故 `src/.go` 不命中，与 generic collector
 *   （`extname().toLowerCase()`）及 file-scanner walkDir 一致。
 *
 * @param filePathOrName 文件名或路径，**保留原始大小写**；可以是相对路径（如 git porcelain
 *   输出的仓库相对路径）、绝对路径或裸文件名，三者判定结果一致。
 */
export function surfaceMatchesFile(
  surface: CollectorPipelineSurface,
  filePathOrName: string,
): boolean {
  if (surface.matchSemantics === 'case-sensitive') {
    for (const extension of surface.extensions) {
      if (filePathOrName.endsWith(extension)) return true;
    }
    return false;
  }
  return surface.extensions.has(path.extname(filePathOrName).toLowerCase());
}

/**
 * 合并两条 surface（供指纹计算把 java/go 合成 `genericAdapters` 单一条目）。
 *
 * `matchSemantics` 不同时 **throw**（决策 3 / plan I-02）：静默选其一或强行合并会
 * 产出语义错误的指纹分量，未来若 Java/Go 匹配语义分歧，必须在指纹计算阶段立刻暴露。
 */
export function mergeSurfaces(
  a: CollectorPipelineSurface,
  b: CollectorPipelineSurface,
): CollectorPipelineSurface {
  if (a.matchSemantics !== b.matchSemantics) {
    throw new Error(
      `mergeSurfaces: matchSemantics 不一致（${a.matchSemantics} vs ${b.matchSemantics}），` +
        '合并会产出语义错误的指纹分量——请为该管线单独记录一个 extensionSurface 条目',
    );
  }
  return {
    extensions: new Set([...a.extensions, ...b.extensions]),
    matchSemantics: a.matchSemantics,
  };
}
