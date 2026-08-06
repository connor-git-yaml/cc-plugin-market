/**
 * git 忽略判定 oracle（F258 从 file-scanner.ts 搬出）
 *
 * 搬出理由：file-scanner.ts 原本单文件承载三件事（忽略规则解析 + git 预取 + 目录扫描/
 * 语言统计），忽略判定这一块在 F258 里显著扩容（三态 verdict / errno 三分 / L2 预算），
 * 继续留在原文件会让"扫描器"与"忽略 oracle"两个职责继续纠缠。
 *
 * ## 事实源不是一个，是两个（F258 撤下的 over-claim）
 *
 * 本模块此前的注释写"以 git 本体为事实源""与 `git status` 同源"——这两句笼统表述**已删除**，
 * 因为它们把两个**回答不同问题**的 git 命令混为一谈：
 *
 * | oracle | 命令 | 它回答的问题 | 盲区 |
 * |---|---|---|---|
 * | 在盘枚举 | `git ls-files --others --ignored --exclude-standard --directory` | "**盘上**有哪些被忽略的未跟踪条目" | 离盘路径一律缺席；嵌套 git 仓 / submodule 内不枚举；`--directory` 会 over-collapse |
 * | 规则查询 | `git check-ignore`（含 index） | "**规则**是否命中这个路径" | 权威**但非全域**：symlink 穿越 / submodule 内 / 仓外 / 越界 / 空串一律 exit 128 拒答 |
 *
 * 缺陷 1 的根因正是把前者当成了后者：walk 消费方"查询路径恒在盘"这个**局部**成立的前提
 * 被泛化成 oracle 的全局契约，于是离盘路径被一律判 not-ignored，图质量门的
 * `ignoredPathNodeIds` 维度静默漏报。
 *
 * ## 三态而不是两态
 *
 * `git check-ignore` 的 exit 128 既不是 "ignored" 也不是 "not-ignored"。压成 boolean 就必然
 * 要在两个方向之一撒谎：fail-open ⇒ 缺陷 1 原样复活；无差别 fail-loud ⇒ 每个此类路径刷一条
 * warn。故内部建模为三态，由消费方统一收口为"`undeterminable` ⇒ 按 `not-ignored` 处理"
 * （两类消费方**同向**），诊断经 `drainUndeterminable()` 有界取回。
 *
 * ## 已知限制（KL-1..KL-6）：登记 + 用测试钉住实际行为，**本模块不修**
 *
 * | ID | 形态 | 实际行为 | 为什么不修 |
 * |---|---|---|---|
 * | KL-1 | 嵌套（未注册的）git 仓内的**在盘**路径 | L1 判 `not-ignored`（git 不枚举进嵌套仓），与 `check-ignore` 的 IGNORED 分叉 | 修它要求 walk 热路径对每个 MISS 起子进程（~5 ms × 全仓文件数），与 F255 的性能前提冲突；且该分叉不是本次引入 |
 * | KL-2 | submodule 内路径 / **离盘** symlink 穿越 / 仓外绝对路径 / `..` 越界 / 空串 | `undeterminable` ⇒ 按 not-ignored + 计数出声。其中绝对路径 / `..` 越界 / 空串由**入口守卫**直接判定（与在盘与否无关，见 {@link isOutsideWalkBase}），其余形态走 L2 得 exit 128 | 三态 + 有界聚合出声是唯一不制造新噪声/新静默的解 |
 * | KL-3 | `--directory` 折叠前缀的 over-collapse | `dirPrefixes` **仅在 L1 在盘分支**消费；L2 / L3 都不消费它（L3 只查 `files` 的逐条肯定答复，见 {@link createGitIgnoredFileLookup}） | 见下方"为什么换序是安全的" |
 * | KL-4 | 忽略规则内容不进任何新鲜度维度 | 同一份图两次运行间 `ignoredPathNodeIds` 可翻转而 freshness 仍报 fresh | 纳入新鲜度需 bump `collector-fingerprint.formatVersion` 并重新校准 F249/F193/F217 三方判据，属 feature 量级演进（defer） |
 * | KL-5 | **在盘**的 symlink 穿越（`lstat` 对最后一段不跟随、对**中间段跟随**） | 判在盘 ⇒ L1 查表 MISS ⇒ `not-ignored`，**静默、不计数、永远到不了 L2** | 这是缺陷 1 原病在该形态上的原样保留；修它需逐段 symlink 探测或对每个 MISS 起子进程，成本与 KL-1 同级 |
 * | KL-6 | 输入未归一化 / 大小写与磁盘不一致（macOS `core.ignorecase=true`） | 落在盘分支、**静默、不计数**，判 `not-ignored`，与 git 分叉 | L1 是对 `git ls-files` 输出做大小写敏感字符串查表；做大小写折叠会在 case-sensitive FS 上引入假 ignored |
 *
 * ## 存在性依赖是契约的一部分（不是 bug）
 *
 * 本 oracle 的答案**依赖路径是否在盘**：同一相对路径在盘时走 L1 查表（可能 `not-ignored`），
 * 离盘时走 L2 权威查询（可能 `ignored`），**两者可以相反**（KL-1 与 L2 的分歧轴正是"文件在不在"）。
 * 这是分层设计的直接后果，属**已声明的契约**；调用方 MUST NOT 假设 verdict 与文件存在性无关。
 *
 * ## verdict 接受目录相对路径，但"目录型规则 + 离盘"有一条 git 自身的口径
 *
 * `generic-language-skeleton-collector` 对**目录 dirent** 也会发问，故 verdict 的输入契约
 * 明确接受目录相对路径。需注意一条实测出来的 git 口径（**不是本模块的缺陷**）：目录型规则
 * （`legacy/`）对**离盘且无尾斜杠**的 path spec，`git check-ignore` 答 exit 1（not-ignored）
 * ——它无从判断该 path spec 是不是目录；同一路径在盘时它 stat 得到目录、答 exit 0。
 * 本模块**如实透传**该口径（`gitignore-oracle.test.ts` 的 R1-1b 直接对拍 `check-ignore`），
 * 不自作聪明地补一个"猜它是目录"的分支——那会造出第三个与 git 不同解的 oracle。
 *
 * ## 为什么换序（先判存在性、后查折叠前缀）是安全的
 *
 * `--directory` 的 over-collapse 要求"该目录下所有未跟踪条目都被忽略"（含 tracked 文件的目录
 * 不折叠）。因此"被查询路径在盘、且规则未命中"与"其父目录被折叠"**互斥**；而离盘路径由前置的
 * 存在性判定直接跳到 L2，**永远不消费 `dirPrefixes`**。该论证由 `gitignore-oracle.test.ts`
 * 的 R1-3（复刻 `generated/notes.ts` 场景）钉住。
 *
 * ⚠️ 该论证的前提是"在盘"，所以它**只覆盖 L1**。存在性未知的 L3 不在其射程内——那里查折叠前缀
 * 会把"判不了"变成"判是"，且方向与 git 的权威答案相反（`col/` 被折叠但 `git check-ignore col`
 * 答 not-ignored）。故 L3 走的是只认 `files` 的 {@link createGitIgnoredFileLookup}，由
 * `gitignore-oracle.test.ts` 的 M-3 / M-3b 双向钉住（不查前缀、仍查精确条目）。
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** git 只读命令输出上限（与 source-commit.ts 的 MAX_GIT_OUTPUT_BYTES 同语义：防大仓库输出触发 ENOBUFS）。 */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

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
 *
 * ⚠️ 该命令回答的是"**盘上**有哪些被忽略的未跟踪条目"——离盘路径一律缺席，故它**不能**
 * 单独用来回答"规则是否命中"（见文件头的两 oracle 对照表）。
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
 * 只查**逐条肯定答复**（`files`）的查找函数，**不消费** `dirPrefixes`。
 *
 * 为什么必须与上面那个查找函数分开（审查修复轮 M-3）：`--directory` 的折叠前缀只在
 * "该目录下所有未跟踪条目都被忽略"时成立——`col/` 出现在折叠清单里**不代表** `col/` 本身
 * 被规则命中（实测 `git check-ignore col` 答 exit 1）。折叠前缀因此只有配合"被查询路径在盘"
 * 这个前提才可信（见文件头"为什么换序是安全的"），而 L3 恰恰是**存在性未知**的那一支：
 * 在那里消费折叠前缀会把"判不了"变成"判是"，方向与 git 的权威答案相反，且静默不计数。
 *
 * `files` 里的条目则是 git 自己逐条列出的肯定答复，不依赖任何存在性前提，L3 可以信。
 */
function createGitIgnoredFileLookup(index: GitIgnoredIndex): (relativePath: string) => boolean {
  return (relativePath: string): boolean => {
    const normalized = relativePath.split(path.sep).join('/');
    return normalized.length > 0 && index.files.has(normalized);
  };
}

/** gitignore 判定的三态结论（F258）。 */
export type GitignoreVerdict = 'ignored' | 'not-ignored' | 'undeterminable';

/** 路径存在性探测结论（errno 三分）。 */
type Presence = 'on-disk' | 'off-disk' | 'undeterminable';

/**
 * 存在性探测 = **errno 三分**（硬性）。
 *
 * 1. `lstat` 失败 **≠** 离盘：只有 `ENOENT` / `ENOTDIR` 才是"确实不在盘"。
 * 2. 其他一切 errno（`EACCES` / `ELOOP` / `ENAMETOOLONG` / code 缺失…）⇒ **直接 `undeterminable`**，
 *    **不得**当离盘、**不得**转 L2。理由：`EACCES` 目录下的文件 walk 能枚举到、`lstat` 却抛错；
 *    若把它当离盘 ⇒ 落 L2 ⇒ 换成**另一个解**的 oracle ⇒ **被采集的文件集合可变** ⇒
 *    `collector-fingerprint` 的 `gitignore-interpretation` 责任项被触发、`BEHAVIOR_VERSION`
 *    不 bump 的论证随之失效。走本出口后消费方按 `not-ignored` 处理 = 与旧行为逐字节一致。
 * 3. `lstat` 对**最后一段**不跟随 symlink、对**中间段跟随**：`link_to_ign/f.ts` 会被判
 *    `on-disk`（KL-5），这是已登记的已知限制。
 */
function probePresence(absPath: string): Presence {
  try {
    fs.lstatSync(absPath);
    return 'on-disk';
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'off-disk';
    return 'undeterminable';
  }
}

/**
 * 权威（**但非全域**）查询：`git check-ignore` 含 index，故 tracked 豁免与 `git status` 同向。
 *
 * 退出码判别（git 2.53.0 实测只观测到 0 / 1 / 128 三种）：
 * - `execFileSync` 对 exit=1 与 exit=128 **都抛异常**，必须读 `error.status`；
 * - **仅** `status === 1` 才是 not-ignored；`128` / 其他码 / `null`（spawn 失败、信号终止、
 *   git 不可执行）一律 `undeterminable`，**绝不** fail-open 成 false
 *   （反面先例：`catch { return null }` 形态的吞错）。
 *
 * 两个不可省的调用细节：
 * - `--` 分隔符**必需**：否则以 `-` 开头的路径会被当成选项；
 * - **不加** `--no-index`：本 oracle 要的正是 tracked 豁免语义（含 tracked-but-deleted）。
 *
 * `cwd` 取 `walkBase`，与预取清单的基准同源；每次只问**一个**路径（拒绝批量 `--stdin`：
 * 一个坏路径会整批截断，且"缺席 = not ignored"不可区分）。
 */
function queryCheckIgnore(walkBase: string, relativePath: string): GitignoreVerdict {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', relativePath], {
      cwd: walkBase,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return 'ignored';
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    if (status === 1) return 'not-ignored';
    return 'undeterminable';
  }
}

/** 不可判路径的有界诊断摘要（oracle 不逐条 warn，避免刷屏）。 */
export interface UndeterminableSummary {
  /** 自上次 drain 以来判为 `undeterminable` 的**去重路径**数量。 */
  count: number;
  /** 前若干条去重样本路径（供诊断定位，不是全量）。 */
  samples: string[];
  /**
   * 是否发生过 L2 预算耗尽（具名出口 `l2-budget-exhausted`）。
   * 与 `count > 0` 是**两件事**：前者是"没去判"，后者是"判不了"，文案不得混用。
   *
   * ⚠️ 消费方的出声判据**不得**写成 `count > 0`——预算恰在最后一次 L2 之后耗尽时
   * `count` 为 0 而本位为 true，该具名出口会完全静默（审查修复轮 M-2）。
   */
  budgetExhausted: boolean;
  /**
   * 本实例是否运行在 **L0 整体降级**态（git 仓库内却拿不到忽略清单：git 不可执行 /
   * 仓库损坏 / 输出超限）。
   *
   * 为什么它必须出现在诊断结构里（审查修复轮 M-1）：L0 分支是**二态**的，
   * `undeterminable` 在该态下**结构性不可能**产出，于是 `count` 恒为 0。若消费方只看
   * `count > 0`，"打坏 git" 反而会让所有依赖本诊断的门禁一起变绿——一条可被主动触发的
   * fail-open 面。`degraded === true` 时 `count === 0` **不构成**"无不可判路径"的证据，
   * 只说明这一轮根本没在做三态判定。
   *
   * 与 `count` / `budgetExhausted` 同为**粘性**状态（降级不会中途恢复），drain 不重置它。
   */
  degraded: boolean;
}

export interface GitignoreOracle {
  /** 三态判定。输入为**相对 walkBase** 的路径；接受目录相对路径。 */
  verdict(relativePath: string): GitignoreVerdict;
  /**
   * 二态查表（L0 近似 / L1 预取），**不做存在性探测、不起任何子进程**。
   * 仅供 walk 热路径使用——输入 MUST 来自 walk 的 dirent（恒在盘）。
   */
  isIgnoredOnDisk(relativePath: string): boolean;
  /** 取走并清空累积的不可判诊断。 */
  drainUndeterminable(): UndeterminableSummary;
}

export interface GitignoreOracleOptions {
  /** L2 累计耗时预算（毫秒）。缺省 {@link DEFAULT_L2_BUDGET_MS}。 */
  l2BudgetMs?: number;
}

/**
 * L2（`git check-ignore`）的累计耗时预算。
 *
 * 为什么必须有上限：下游 `plugins/spec-driver/scripts/graph-bootstrap-status.mjs` 的
 * `DEFAULT_FRESHNESS_DEADLINE_MS = 5000` 是一个**已经存在**的硬上限——超时不会报错，
 * 而是把 freshness 直接翻成 `unknown-provenance`。也就是说"没有上限"这个选项并不存在，
 * 区别只在于超限时是**一条有名字的 warn** 还是**一次静默的判定翻转**。
 *
 * 取值依据（本机实测）：`git check-ignore` ~5.09 ms/次 ⇒ 1500 ms 约合 295 次不同离盘路径，
 * 且给下游 5000 ms deadline 留出 3.5 s 余量。健康仓库里离盘节点是异常项，正常不会触及。
 * 不引入新环境变量（需要调时由调用方经 opts 显式注入）。
 */
const DEFAULT_L2_BUDGET_MS = 1500;

/** 单实例累计 L2 调用数超过该阈值时输出一次聚合 warn（与预算耗尽是两件事）。 */
const L2_VOLUME_WARN_THRESHOLD = 200;

/** `drainUndeterminable().samples` 的条数上限。 */
const UNDETERMINABLE_SAMPLE_LIMIT = 5;

/**
 * 从 startDir 起**向上逐级**查找 `.git`（文件或目录，兼容 worktree 的 `.git` 文件形态），
 * 到文件系统根为止。
 *
 * 附带项 6.1：原探针查的是 `path.join(projectRoot, '.git')`，而 `scanFiles` 里
 * `projectRoot = options?.projectRoot ?? resolvedDir`——扫描子目录且未显式传 projectRoot 时
 * 探针查的是 `<子目录>/.git`，结构性不存在 ⇒ git 仓内的降级被静默。
 *
 * 不用 `git rev-parse --is-inside-work-tree` 复核：走到这条分支时 git 可能正是不可用的那个
 * 原因，用它判会二次失败。
 */
/**
 * 输入是否越出 `walkBase` 基准（绝对路径 / `..` 越界），与路径是否在盘**无关**。
 *
 * 本 oracle 的两个事实源都以 walkBase 为基准（预取清单的输出基准、`git check-ignore` 的 cwd），
 * 越界输入两者都答不了：`git check-ignore` 对它们实测 exit 128，查表则必然 MISS——而 MISS
 * 与"规则未命中"在二态里不可区分。故越界一律判不可判，由消费方按 not-ignored 处理 + 计数出声。
 */
function isOutsideWalkBase(walkBase: string, relativePath: string): boolean {
  if (path.isAbsolute(relativePath)) return true;
  const rel = path.relative(walkBase, path.resolve(walkBase, relativePath));
  return rel === '..' || rel.startsWith(`..${path.sep}`);
}

function hasGitDirUpward(startDir: string): boolean {
  let current = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * 构造三态 gitignore oracle。
 *
 * 判定顺序（第一个命中即返回）：
 *
 * | 层 | 条件 | 出口 | 准确契约 |
 * |---|---|---|---|
 * | L0 | 预取清单构造失败（非 git 上下文 / git 不可用 / 仓库损坏） | 根 `.gitignore` 近似解析的**二态**结果 | 与 F255 现状逐字节一致；**永不产出 `undeterminable`**。git 仓内触发时 `drainUndeterminable().degraded` 为 true——该态下 `count === 0` **不是**"无不可判路径"的证据（审查修复轮 M-1） |
 * | L-guard | 输入越出 walkBase 基准（绝对路径 / `..` 越界 / 空串） | 直接 `undeterminable` | 与在盘与否**无关**（审查修复轮 M-4，兑现 KL-2 的承诺） |
 * | L1 | 存在性探测判 `on-disk` | 预取清单查表（命中精确条目或落在 `dirPrefixes` 之下 ⇒ `ignored`） | **前提**：输入 MUST 已归一化（`path.relative` 产出形态）**且大小写与磁盘一致**；前提不满足时查表 MISS 并给 `not-ignored`（KL-6）。嵌套 git 仓 / submodule 内的在盘路径 git 根本不枚举 ⇒ 判 `not-ignored`（KL-1）。**不是**无条件的"在盘 ⇒ false" |
 * | L2 | 存在性探测判 `off-disk` | 记忆化 `git check-ignore` 的三态结果；预算耗尽走具名出口 | 权威但非全域：exit 128 是真实第三态 |
 * | L3 | 存在性探测判 `undeterminable`（非 ENOENT/ENOTDIR 的 errno） | 直接 `undeterminable` | **不得**当离盘、**不得**落 L2（见 {@link probePresence}） |
 *
 * @param projectRoot 项目根目录（L0 回退模式下定位 `.gitignore`）
 * @param walkBase 查询路径的相对基准，同时是 git 命令的 cwd；缺省等于 projectRoot
 */
export function createGitignoreOracle(
  projectRoot: string,
  walkBase: string = projectRoot,
  options?: GitignoreOracleOptions,
): GitignoreOracle {
  const index = readGitIgnoredIndex(walkBase);
  const prefetchLookup = index === null ? null : createGitIgnoredLookup(index);
  const prefetchFileLookup = index === null ? null : createGitIgnoredFileLookup(index);
  const fallbackLookup =
    index === null ? parseGitignore(path.resolve(projectRoot, '.gitignore')) : null;

  // git 仓库内却拿不到清单属于异常降级，必须出声——静默回退会让漏报重新变得不可见。
  // 这条 warn 只对着**本进程的 stderr** 说话；机读侧的出声通道是 drain 的 `degraded` 位
  // （审查修复轮 M-1：下游门禁读的是结构化诊断，不是 stderr）。
  const degraded = index === null && hasGitDirUpward(walkBase);
  if (degraded) {
    console.warn('⚠ git 仓库内忽略清单预取失败，已降级为仅根 .gitignore 近似过滤');
  }

  const memo = new Map<string, GitignoreVerdict>();
  const samples: string[] = [];
  const l2BudgetMs = options?.l2BudgetMs ?? DEFAULT_L2_BUDGET_MS;
  let undeterminableCount = 0;
  let l2SpentMs = 0;
  let l2Calls = 0;
  let budgetExhausted = false;
  let volumeWarned = false;

  const isIgnoredOnDisk = (relativePath: string): boolean =>
    prefetchLookup !== null ? prefetchLookup(relativePath) : fallbackLookup!(relativePath);

  const runL2 = (relativePath: string): GitignoreVerdict => {
    // 预算耗尽后不再发起任何新的 L2 查询（具名出口 l2-budget-exhausted）
    if (budgetExhausted) return 'undeterminable';

    const startedAt = Date.now();
    const result = queryCheckIgnore(walkBase, relativePath);
    l2SpentMs += Date.now() - startedAt;
    l2Calls++;

    if (l2SpentMs >= l2BudgetMs) budgetExhausted = true;

    if (l2Calls > L2_VOLUME_WARN_THRESHOLD && !volumeWarned) {
      volumeWarned = true;
      console.warn(
        `⚠ 离盘节点异常多（已对 ${l2Calls} 个离盘路径发起权威忽略判定），图可能极度陈旧，` +
          '建议运行 `spectra batch --mode graph-only` 重建',
      );
    }
    return result;
  };

  const computeVerdict = (relativePath: string): GitignoreVerdict => {
    // 空串不是一个可判定的路径查询（`git check-ignore ''` 实测 exit 128）。显式收口，
    // 否则 path.resolve(walkBase, '') === walkBase 会让它落进"根目录在盘"分支被判 not-ignored。
    if (relativePath.length === 0) return 'undeterminable';

    // L-guard：越界输入不依赖存在性，直接判不可判（审查修复轮 M-4）。
    //
    // 修复前只有**离盘**的仓外 / `..` 越界路径才走 L2 得 exit 128 ⇒ undeterminable；
    // 同一形态**在盘**时被 L1 截住 ⇒ 查表 MISS ⇒ 静默 not-ignored——即 KL-2 白纸黑字承诺的
    // "计数出声"在半数形态上根本没发生。文档承诺了运行时没做的事比行为缺陷更危险：
    // 下一轮审查者会按 KL 表放过它。
    //
    // 判据不看盘、只看输入本身是否违反"相对 walkBase"这条输入契约，因此对在盘/离盘同解：
    // 绝对路径一律违反（本 oracle 的查表基准与 git 命令 cwd 都是 walkBase）；
    // `path.relative` 结果以 `..` 开头即越出基准。两者都不是本 oracle 能回答的问题。
    if (isOutsideWalkBase(walkBase, relativePath)) return 'undeterminable';

    const presence = probePresence(path.resolve(walkBase, relativePath));
    // L1：在盘 ⇒ 纯查表（dirPrefixes 仅在本分支消费，见文件头"为什么换序是安全的"）
    if (presence === 'on-disk') return prefetchLookup!(relativePath) ? 'ignored' : 'not-ignored';

    // L3：errno 三分的第三支 —— 不得当离盘、不得落 L2。
    //
    // ⚠️ 但**先查一次内存中的预取清单**，否则会引入一处真实的行为回归（本 fix 的差分实证
    // 实测构造出来的反例）：`chmod 0444 dir`（有 r 无 x）时 `readdirSync` 仍能列名、
    // `lstatSync` 却抛 EACCES；此时若直接返回 `undeterminable`，消费方按 not-ignored 处理，
    // 而**修复前**该路径命中预取清单是判 ignored 的 ⇒ 被采集的文件集合发生变化 ⇒
    // `collector-fingerprint` 的 gitignore-interpretation 责任项被触发。
    //
    // 实测反例：`.gitignore` 含 `*.log`，`weird/secret.log` 在预取清单里，`chmod 0444 weird`
    // 之后 —— 修复前 `ignored`（跳过），只按 errno 三分处理则 `undeterminable`（照常采集）。
    //
    // 查预取清单既不是"当离盘"也不是"转 L2"（纯内存查表、零 I/O、零子进程），不违反 L3 的
    // 两条硬约束；而清单里的条目是 git 自己给出的**肯定**答复，信它不构成自造第三个 oracle。
    // 只有清单也没说话时才落 `undeterminable`。
    //
    // ⚠️ 这里查的是 `prefetchFileLookup`（只认 `files` 的逐条肯定答复），**不是**同时消费
    // `dirPrefixes` 的 `prefetchLookup`（审查修复轮 M-3）：折叠前缀的可信度依赖"被查询路径
    // 在盘"这个前提（见文件头"为什么换序是安全的"），而 L3 正是存在性未知的那一支。在这里
    // 消费折叠前缀会给出比 `undeterminable` **更错**的 `ignored`——实测反例：`col/` 因内含
    // 条目全被忽略而折叠、其本身却无规则命中，`col/<超长段>/keep.ts`（ENAMETOOLONG）会命中
    // 前缀被判 ignored，而 git 的权威答案是 not-ignored，且计数为 0 ⇒ 静默。
    if (presence === 'undeterminable') {
      return prefetchFileLookup!(relativePath) ? 'ignored' : 'undeterminable';
    }
    // L2：离盘 ⇒ 权威查询
    return runL2(relativePath);
  };

  const verdict = (relativePath: string): GitignoreVerdict => {
    // L0：非 git 上下文 / 预取失败 —— 二态近似，永不产出 undeterminable
    if (prefetchLookup === null) {
      return fallbackLookup!(relativePath) ? 'ignored' : 'not-ignored';
    }

    const cached = memo.get(relativePath);
    if (cached !== undefined) return cached;

    const result = computeVerdict(relativePath);
    if (result === 'undeterminable') {
      undeterminableCount++;
      if (samples.length < UNDETERMINABLE_SAMPLE_LIMIT) samples.push(relativePath);
    }
    // 三态全部缓存（含 undeterminable，避免对同一坏路径反复起子进程）
    memo.set(relativePath, result);
    return result;
  };

  const drainUndeterminable = (): UndeterminableSummary => {
    const summary: UndeterminableSummary = {
      count: undeterminableCount,
      samples: [...samples],
      // budgetExhausted / degraded 都是**粘性**状态（预算不会自己恢复、降级不会中途转好），
      // drain 只重置"自上次以来新增"的 count / samples，不重置这两位
      budgetExhausted,
      degraded,
    };
    undeterminableCount = 0;
    samples.length = 0;
    return summary;
  };

  return { verdict, isIgnoredOnDisk, drainUndeterminable };
}

/**
 * 创建 .gitignore 过滤器（walk 热路径专用薄壳）
 * 供 python-adapter 及 batch-orchestrator 的自写 walk 叠加接入。
 *
 * ⚠️ **输入契约（MUST）**：
 * - 输入路径 MUST 来自 walk 的 dirent（**恒在盘**）；
 * - 输入路径 MUST 已归一化（`path.relative` 产出形态：无 `./` 前缀、无冗余分隔符）
 *   **且大小写与磁盘一致**（否则查表 MISS 并静默给 false，见 KL-6）；
 * - **离盘路径 MUST 改用 `createGitignoreOracle().verdict`**——本函数对离盘路径的
 *   false 不代表"规则未命中"，只代表"它不在预取清单里"，这正是缺陷 1 的病灶。
 *
 * 实现上等价于 oracle 的 `isIgnoredOnDisk`：只走 L0 近似 / L1 预取查表，
 * **不做存在性探测、不起任何子进程** ⇒ walk 热路径逐字节不变、零新增开销。
 *
 * F255 的两条约束仍然成立：嵌套 `.gitignore` / `.git/info/exclude` / 全局 excludesFile
 * 由 `git ls-files` 覆盖；tracked 豁免与 `git status` 同向。
 * 非 git 上下文 / git 命令失败时回退到根 `.gitignore` 近似解析（维度收窄的 fail-open：
 * 根规则仍生效，仅嵌套保真度降级；而非 git 上下文的 freshness 本就在 `resolveSourceCommit`
 * 处短路为 unknown-provenance，不存在错配面）。
 *
 * 基准契约：过滤函数入参相对 **walkBase**（git 模式下 `git ls-files` 的输出基准即命令 cwd；
 * 回退模式下沿用 projectRoot 根解析）。walkBase 缺省等于 projectRoot，两个基准重合，
 * 四处既有单参调用点语义不变。
 *
 * @param projectRoot - 项目根目录（回退模式下定位 .gitignore）
 * @param walkBase - walk 的实际扫描根，即过滤函数入参的相对路径基准，缺省等于 projectRoot
 * @returns 过滤函数：接受相对 walkBase 的**在盘**路径，返回 true 表示应被忽略
 */
export function createGitignoreFilter(
  projectRoot: string,
  walkBase: string = projectRoot,
): (relativePath: string) => boolean {
  return createGitignoreOracle(projectRoot, walkBase).isIgnoredOnDisk;
}

/**
 * 将简单 glob 模式转换为正则表达式
 */
export function globToRegex(pattern: string, isDirPattern: boolean): string {
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
