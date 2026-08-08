/**
 * F261 builder stamp：图产物"**由哪一版编译产物执行写出**"这一维 provenance。
 *
 * 与既有两维的分工（三者互补，缺一不可）：
 * - `sourceCommit`（F217）：这张图**基于哪一版源码**分析而来；
 * - `fingerprint`（F249）：这张图由**哪一版采集面 / behaviorVersion** 产出；
 * - `builder`（本模块）：这份文件由**哪一版 dist 编译产物**写出。
 *
 * 为什么第三维不可由前两维代偿：生产建图跑的是 `dist/`，而 `dist` 与源码树是两条独立演进的
 * 时间线，只有 `npm run build` 那一刻才同步。当 dist 落后但采集面恰好未变时，陈旧 dist 建的图
 * 与新 dist 建的图 fingerprint **完全相同**、sourceCommit 也照样记当前 HEAD ⇒ freshness 判 fresh，
 * 静默放行。事实源 `dist/.spectra-build-meta.json`（F176 `stampBuild` 盖章、F186 postbuild 接线）
 * 早已存在，本模块只是把它接进图写盘链路。
 *
 * **零时间戳硬约束**：`GraphBuilderStamp` MUST NOT 携带 `builtAtIso`（build-meta 里唯一的墙钟
 * 字段）或任何文件系统路径。前者会直接摧毁 byte-stable（F183 `normalizeGraphForWrite` +
 * F193 portable 守卫的既有护栏面），后者会让图不可跨机复用。注意 `scanGraphPortabilityViolations`
 * **不扫** `graph.graph`，所以这条不变量在**键**层面靠字段设计 + 测试保证，在**值**层面靠
 * {@link parseGraphBuilderStamp} 的值域正则（见下）——两层缺一不可。
 *
 * **约束面如实化（D6）：上述硬约束的作用域是「本版本 producer 写出的值」，不是「磁盘上的一切值」。**
 * `writeKnowledgeGraph` 的 `preserve-recorded` 通道**只在覆盖无损时才覆盖**，其余一概原样保留
 * （前向兼容：旧版本无权抹掉更新版本写入的内容，把 `unrecognized` 抹成 `unstamped` 是把未知
 * 伪装成已知），因此磁盘上可以存在带路径 / 时间戳的外来 builder 值。
 *
 * 让渡这条防线的前提是**消费侧独立成立**。这里必须**如实**说清楚它成立到什么程度，不能写成
 * "什么都不回显"这种一读就能被证伪的绝对句（前三轮已经在同一种病上栽过三次）：
 * - `describeBuilderStamp`（`graph-quality.ts`）的 `unrecognized` 输出是**与记录内容完全无关的
 *   常量串**——有 8 组敌意输入的恒定性用例钉住；
 * - `scripts/graph-semantic-diff.mjs` 的 banner **值一律不回显**（`commit` / `distSha256` 都过
 *   十六进制闸口，不合规就折叠成 `unrecognized`），但两侧渲染值相同时**会列出差异落点的键名**——
 *   键名经字符集消毒（`[A-Za-z0-9_.-]{1,40}`，其余折叠成 `<非常规字段名>`）且最多 5 个。
 *   所以准确表述是「**值不回显；少量经消毒的外来键名会回显**」。控制字符 / 路径 / 时间戳这三类
 *   **值**的危害路径因此仍是封死的，而"键名也算内容"这条代价是已知并接受的。
 *
 * 至于 byte-stable：保留支不做任何字段级改写，同一输入连写两次逐字节相同（有专门用例）。
 * 注意"原样"的精度边界：整条链路是 `JSON.parse` → `JSON.stringify`，其固有归一化（`1e999 → null`、
 * `-0 → 0`、超出 f64 精度的整数被舍入）对**整份 graph.json**（含 `fingerprint`、节点 metadata）
 * 同样成立、且早于本特性存在，不是保留通道引入的。
 *
 * **key 集合严格性刻意弱于 F249 `parseCollectorFingerprint`，但值域校验一样严**（复审 F3 订正）：
 * 这两件事必须分开讲，第一轮把它们混为一谈，结果值域完全敞开。
 * - **key 集合**：F249 之所以要严格 key 集合，是因为指纹参与 `fingerprintsEqual` **相等性判定**
 *   ——未登记的新字段会让"实际已变"的两份指纹判等、进而把过期图判 fresh（静默放行）。`builder`
 *   **不参与任何判定**（advisory-only：不进 freshness 四态、不改 overallVerdict、不改 exit code），
 *   那条静默放行通道结构性不存在，因此"演进时必须同步 bump formatVersion"的成本没有对应收益。
 * - **值域**：上面那条论证**完全不覆盖**值域。`builder` 的值会被**原样写进 graph.json** 并被
 *   **原样打印到终端**，因此它是一条数据流出口，而非纯判定输入。第一轮只判 `typeof string &&
 *   length > 0`，实测可穿透：`commit = ESC[2J ESC[H`（恰 7 字符，展示层 `slice(0,7)` 完整保留）
 *   在真终端里清屏 + 光标归位，抹掉上方全部判定结果；`commit = "/Users/alice/x @ 2026-08-08T09:00Z"`
 *   与 `distSha256 = "/abs/path"` 则让上一段的"零时间戳 / 零路径"沦为空话。
 *   故两个字符串字段一律按 `stampBuild` 的真实产出下**值域正则**，不合规整体降级为 `null`。
 *
 * **barrel 导出口径（T018 核实结论）**：本模块**不**经 `./index.ts` 暴露。已实读该 barrel：
 * `collector-fingerprint.ts` 之所以在里面，是 F249 FR-008/W-06 的显式要求（其 API 要供图外
 * 消费方调用）；而与本模块同类的 `source-commit.ts`（同为 `panoramic/graph/` 内的 provenance
 * 判定模块）**未**被 barrel 导出，其唯一外部消费方 `src/cli/commands/graph-quality.ts` 直接
 * 深链 import。本模块的消费面完全一致（`graph-builder.ts` 同目录 + `graph-quality.ts` 深链），
 * 故沿用 `source-commit.ts` 的口径，不为一个 advisory 字段扩大 barrel 的公共面。
 *
 * ---
 *
 * **口径如实化（第三轮 D4）：本字段是「事故检测器」，不是「篡改检测器」。**
 *
 * `distSha256` 在**图这条链路上只是一段自称的字符串**。仓库里确实存在一处 dist hash 复算——
 * `verifySpectraVersion`（`scripts/lib/spectra-version-gate.mjs`，函数起于 `export function
 * verifySpectraVersion`；复算发生在其函数体的 `(2) dist 内容指纹` 一段，调 `hashDistTree` 重算
 * 全树 hash 并与 `meta.distSha256` 比对）——但本模块**从不调用它**：`resolveBuilderStamp` 只是读
 * `.spectra-build-meta.json` 并做值域校验。手改一行 meta 就能让图自述任意 build 身份。
 *
 * （订正：本段前一版把那处复算写成一个叫 `verifyBuildStamp` 的独立函数并附了精确行号——
 * **该符号在全仓不存在**，复算只是 `verifySpectraVersion` 的函数体片段，不是可被"接上"的现成 API。
 * 行号也不再写死：它会随该文件编辑漂移，而漂移了的精确行号比没有行号更误导。）
 *
 * 非恶意变体同样成立、且更常见：`npx tsc`、IDE 的 build task、`npm run build --ignore-scripts`
 * 都会改写 `dist/**.js` 而**不触发** `scripts/postbuild-stamp.mjs` ⇒ meta 停留在**上一次**盖章的
 * 身份，图会自述一个已经不成立的 dist 指纹。因此本字段能抓的是"**忘了重建 / 用了另一版 dist**"
 * 这类事故，抓不了"有人存心伪造 provenance"。
 *
 * **交接注记**（两条，都容易被下一任漏掉）：若未来 `builder` 被升为门禁判据（进 freshness /
 * 改 verdict / 改 exit code），必须**同时**做两件事：
 * 1. 把 `parseGraphBuilderStamp` 收紧到严格 key 集合，否则会复现 F249 修掉的那条
 *    "新增字段 + 忘 bump formatVersion ⇒ 判等 ⇒ 静默放行"通道；
 * 2. **接上 hash 复算**（现成的只有 `verifySpectraVersion` 里那段内联逻辑，**没有可直接复用的
 *    导出函数**，要么抽一个出来、要么自己调 `hashDistTree`）——只收紧 key 集合而不复算，判据仍然
 *    建立在"meta 自称什么就是什么"之上，上一段的两类失真会原样穿透到门禁结论里。
 *
 * ---
 *
 * **消费侧（第三轮 D1）**：`describeBuilderStamp`（`src/cli/commands/graph-quality.ts`）把**图里
 * 记录的 builder** 与 {@link getBuilderStamp}（当前运行的 builder）做字段级比较，回答"这张图是不是
 * 由你现在跑的这一版 spectra 建的"。前两轮曾把它与 `graph.graph.sourceCommit` 比对——那是**设计级
 * 错误**：`builder.commit` 是 Spectra 自己 dist 的 commit，`sourceCommit` 是**被分析项目**的 commit，
 * 除自举外二者跨仓库，不等是结构性恒真的（已实证：健康的外部项目每次都被断言"由与源码树不同版本的
 * 编译产物写出"）。
 *
 * ---
 *
 * **已知后果（复审 F8）：本字段使 graph.json 不再跨环境 byte-identical，我们选择接受。**
 *
 * 事实：同一 commit、同一输入、已 strip 时间戳的前提下，两台机器（或两个 worktree）因
 * `dirty` / `sourceDirty` / `distSha256` 取值不同，写出的 graph.json **不再逐字节相同**。
 * F193 SC-002 的"同 commit 跨 worktree byte 一致"口径因此被收窄为"**同 dist** 跨 worktree
 * byte 一致"。（现有 `tests/unit/graph/cross-worktree-byte.test.ts` 不经 `writeKnowledgeGraph`，
 * 结构性看不到这条，故不会变红——这不代表它没发生。）
 *
 * 为何接受、不回退字段：记录"这份文件由哪一版编译产物执行写出"**本质上就是环境相关的**，
 * 一个跨环境恒等的字段无法回答这个问题；且跨 dist 的 A/B diff 出现 builder delta 是**信息
 * 而非噪声**——它正是"陈旧 dist 建的基线图虚高 148 节点"那类事故的第一现场证据。
 * 真正必须守住的是**同一 dist 内的写盘确定性**（连跑两次逐字节相同），那一维由
 * `tests/batch/graph-only-pipeline.test.ts` 的 byte-stable 断言守护，并已被 F261 变异测试验证有效。
 *
 * **MUST NOT** 为了恢复跨环境 byte 一致而把 `builder` 纳入 `stripTimestamps` 的剥除面：
 * 生产的 graph-only 链路正是 `stripTimestamps: true`（`src/batch/stages/graph-assembly.ts:265-267`），
 * 剥掉等于该字段在生产路径上永远不写、机制整体空转。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 图产物 `graph.graph.builder` 的结构：**把这张图的节点/边内容建出来并首次落盘**的那一版
 * 编译产物身份。
 *
 * 措辞订正（复审 F4）：不是"写出这份文件的编译产物"。差别出在**纯 metadata 回写**链路——
 * `spectra community` 会 `JSON.parse` 已有 graph.json、只往节点 metadata 塞 community id，
 * 再整份写回。按旧措辞它应当改写 builder，而那正好把"陈旧 dist 建的图"洗成"当前 dist 建的图"
 * （已实证复现）。
 *
 * 谁有资格盖章由**调用方显式声明**（`WriteKnowledgeGraphOptions.builderProvenance`），不再从
 * 对象形态反推：先后试过"无条件覆盖"与"仅字段缺席时注入"两版形态判据，**都被实证击穿**
 * （后者放过了"上线前存量图没有该键"这一支，一次 community 就把 unstamped 变成假陈述）。
 */
export interface GraphBuilderStamp {
  /** 固定值 1：格式演进的判别锚点（对齐 `CollectorFingerprint.formatVersion` 惯例）。 */
  formatVersion: 1;
  /** 盖章 build 的源 commit（`stampBuild` 写入的 40 位 SHA，原样透传，不截断）。 */
  commit: string;
  /** 盖章时刻整个工作树是否脏（build-meta.dirty 原样透传）。 */
  dirty: boolean;
  /** 盖章时刻 build 输入（src / tsconfig / package）是否脏（build-meta.sourceDirty）。 */
  sourceDirty: boolean;
  /** dist 树全部 .js 的内容指纹（build-meta.distSha256，64 位十六进制，原样透传）。 */
  distSha256: string;
}

/** 当前唯一受支持的 stamp 格式版本。 */
const SUPPORTED_FORMAT_VERSION = 1;

/**
 * `commit` 的合法值域：小写十六进制、7-64 位。
 *
 * 上界 64 = **sha256 object-format 仓库**里 `git rev-parse HEAD` 的全长（复审 W-1 订正：
 * 本注释第一版写的"40 = rev-parse 全长"只在 sha1 仓库成立；git 2.x 的 sha256 仓库返回 64 位，
 * `stampBuild` 会照常写出，卡在 40 会让整个 stamp 降级为 `null` ⇒ 机制在这类仓库上**静默空转**）。
 * 下界 7 = 人读 short-sha 的惯用长度，留给"外部工具/手工构造的图用 short-sha 记账"这一合理形态。
 * 放宽上界不削弱防线：值域仍是纯小写 hex，控制字符 / 路径 / 时间戳一个都进不来。
 *
 * 锚定 `^...$` 且**不加 `m` 标志**：`$` 在无 `m` 时是文本末尾而非行尾，换行注入
 * （`<40位sha>\n[builder] fake`）因此被拒——否则伪造第二行 advisory 是平凡的。
 * 无 `g` 标志 ⇒ 无 `lastIndex` 跨调用状态；量词有界 ⇒ 无回溯，无 ReDoS 面。
 */
const COMMIT_VALUE_PATTERN = /^[0-9a-f]{7,64}$/;

/** `distSha256` 的合法值域：sha256 的 64 位小写十六进制（`stampBuild` 用 `crypto` 产出，恒为此形态）。 */
const DIST_SHA256_VALUE_PATTERN = /^[0-9a-f]{64}$/;

/** build 盖章文件名（与 `scripts/lib/spectra-version-gate.mjs` 的 `BUILD_META_NAME` 同值）。 */
const BUILD_META_NAME = '.spectra-build-meta.json';

/**
 * 从模块自身位置向上回溯的最大层数。
 *
 * 取**最小可行值**而非"留点余量"：编译后模块位于 `dist/panoramic/graph/`，到 `dist/` 恰好 2 级
 * （`graph → panoramic → dist`）。每多一级，就把"tsx/vitest 直跑 `src/` 时误命中仓库 dist"的
 * 窗口开大一级。模块若迁移，由深度不变量测试（`builder-stamp.test.ts` T-R1e）立刻变红并强制
 * 同步该常量。
 */
export const MAX_ASCENT = 2;

/** 非 null、非数组的普通对象判定（数组也是 object，必须显式排除）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 把任意值解析为 `GraphBuilderStamp`；不合规返回 `null`（不抛）。
 *
 * 生产侧（解析 build-meta JSON）与消费侧（`graph-quality` 读外部 graph.json 的该字段）共用同一
 * 收口，避免两侧对"什么算合法 stamp"各持一套口径——**值域校验也因此对两侧同时生效**，是控制
 * 字符 / 路径 / 时间戳这三类值的唯一闸口（复审 F3）。
 *
 * 降级粒度是"整体 `null`"而非"逐字段清洗"：一份 stamp 里出现值域外的东西，说明它要么不是
 * `stampBuild` 写的、要么被改过，此时保留其余字段等于给一份来路不明的 provenance 背书。
 *
 * 字段书写顺序即序列化顺序，MUST NOT 为"代码整洁"重排——"解析后再序列化"的 byte-identical
 * 依赖此顺序。
 */
/**
 * `GraphBuilderStamp` 的完整键集合。顺序即序列化顺序，与 {@link parseGraphBuilderStamp} 的
 * 返回字面量保持一致；两处一起改，MUST NOT 只改一处。
 */
const STAMP_KEYS: readonly string[] = [
  'formatVersion',
  'commit',
  'dirty',
  'sourceDirty',
  'distSha256',
];

/**
 * 用 {@link parseGraphBuilderStamp} 的投影覆盖 `value` 是否**无损**——即 `value` 不含任何本版本
 * 不认识的键。
 *
 * 存在理由（对抗复审 A-W1，第四轮）：投影会**丢弃额外键**，而本模块的演进口径恰恰是
 * "加字段**不必** bump `formatVersion`"（见文件头「key 集合严格性刻意弱于 F249」一段的论证）。
 * 两者相乘的后果是：一份由**更新版本**写出的 `formatVersion: 1` + 新字段的 stamp，是**可解析**的，
 * 于是走投影分支，新字段被旧版本静默抹掉——这正是裁决 D6 要根除的形态，只是换了个入口。
 * D6 的三条用例全部用 `formatVersion: 2` 或非对象形态构造，系统性绕开了这个唯一现实的冲突点。
 *
 * 因此保留通道的判据不是"能不能解析"，而是"**覆盖会不会丢信息**"：会丢就一个字都不动。
 */
export function isStampProjectionLossless(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => STAMP_KEYS.includes(key));
}

export function parseGraphBuilderStamp(value: unknown): GraphBuilderStamp | null {
  if (!isPlainObject(value)) return null;

  const { formatVersion, commit, dirty, sourceDirty, distSha256 } = value;
  if (formatVersion !== SUPPORTED_FORMAT_VERSION) return null;
  if (typeof commit !== 'string' || !COMMIT_VALUE_PATTERN.test(commit)) return null;
  if (typeof dirty !== 'boolean') return null;
  if (typeof sourceDirty !== 'boolean') return null;
  if (typeof distSha256 !== 'string' || !DIST_SHA256_VALUE_PATTERN.test(distSha256)) return null;

  return { formatVersion: SUPPORTED_FORMAT_VERSION, commit, dirty, sourceDirty, distSha256 };
}

/**
 * 把 `stampBuild` 写出的 build-meta（7 字段）投影为 stamp（5 字段）。
 *
 * 刻意丢弃的三项：
 * - `builtAtIso`：唯一的墙钟字段，纳入即摧毁 byte-stable（本模块最致命的一面）；
 * - `note`：给人看的固定散文，进图只是噪声；
 * - `distFileCount`：`distSha256` 已绑定 dist 全部内容，文件数是它的弱化投影，零增量信息。
 */
function metaToStamp(meta: unknown): GraphBuilderStamp | null {
  if (!isPlainObject(meta)) return null;
  return parseGraphBuilderStamp({
    formatVersion: SUPPORTED_FORMAT_VERSION,
    commit: meta['commit'],
    dirty: meta['dirty'],
    sourceDirty: meta['sourceDirty'],
    distSha256: meta['distSha256'],
  });
}

/**
 * 纯函数：从 `startDir` 起**有界向上**找 `.spectra-build-meta.json`，找不到 / 畸形返回 `null`。
 *
 * 精确规则：
 * 1. 依次检查 `startDir`、`startDir/..`、`startDir/../..`（共 `MAX_ASCENT + 1 = 3` 个目录）；
 * 2. **只查祖先目录本身，绝不查 `<祖先>/dist`**（也不查任何其他子目录）——否则 tsx/vitest 直跑
 *    `src/panoramic/graph/` 时会误把仓库 dist 的盖章当成"自己的 builder"，产出一条彻底错误的
 *    provenance（这正是 T-R1c 反例钉住的那条）；
 * 3. 第一个命中即定论：解析失败或字段畸形 → 返回 `null`，**不继续向上找**。找到了自己的 meta
 *    却读不懂，是异常而非"没盖章"，继续上溯只会捞到别人的 meta；
 * 4. 全程 `try/catch` 兜底，任何 I/O 异常 → `null`，MUST NOT 抛出中断写盘。
 *
 * 三种运行形态：(a) 编译后 `dist/panoramic/graph/` → 命中 `dist/`（生产建图路径，本次修复的目标
 * 场景）；(b) vitest / tsx 直跑 `src/panoramic/graph/` → `null`（诚实降级，结构性不可能误命中）；
 * (c) npm 全局安装的 dist → 相对结构同 (a)，命中该安装包 build 时的 stamp。
 */
export function resolveBuilderStamp(startDir: string): GraphBuilderStamp | null {
  try {
    let dir = path.resolve(startDir);
    for (let ascent = 0; ascent <= MAX_ASCENT; ascent += 1) {
      const metaPath = path.join(dir, BUILD_META_NAME);
      if (fs.existsSync(metaPath)) {
        // 命中即定论（规则 3）：读不懂就是 null，不再上溯
        return metaToStamp(JSON.parse(fs.readFileSync(metaPath, 'utf-8')));
      }
      const parent = path.dirname(dir);
      // 已到文件系统根：再上溯没有新目录，提前退出
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  } catch {
    // JSON 畸形 / 读权限 / 竞态删除等一律归为"未盖章"，绝不中断写盘
    return null;
  }
}

/**
 * **模块加载期**抓取的 stamp（复审 F5：第一轮是"首次写盘时惰性抓取"，已订正）。
 *
 * 为什么必须在加载期而不是首次调用时：惰性抓取会给**旧代码建的图盖上新 build 的章**。真实剧本
 * ——`spectra batch` 跑数分钟，期间另一个终端跑 `npm run build` 刷新了 `dist/.spectra-build-meta.json`；
 * 本进程执行的仍是**旧 dist 的代码**，但首次写盘才去读 meta ⇒ 图自述**新** build，把本机制要抓的
 * 东西反向掩盖成"看起来很新"。加载期抓取把这个窗口从**分钟级**（进程启动 → 首次写盘）收窄到
 * **毫秒级**（Node 解析本模块的那一瞬）。
 *
 * **残余窗口如实登记**：仍不为零——若 `npm run build` 恰好落在"本进程已加载旧 dist 的其它模块、
 * 但尚未加载本模块"的窗口内，读到的仍是新 meta。要彻底消除需要 dist 侧的原子版本切换，超出
 * 本 advisory 字段的收益边界，故只收窄不声称消除。
 *
 * 第一轮注释称 memoize"结构性保证一次运行 = 一个 builder 身份"——**它保证的是自洽，不是正确**
 * （一次运行内两次写盘取值一致，但那个值可能根本不是本进程执行的那版 dist）。加载期抓取同时
 * 拿到自洽与"尽可能正确"，一次运行仍恒为同一对象引用。
 *
 * 值域不合规同样在这里定论为 `null`（见 {@link parseGraphBuilderStamp}），事后出现的合法 meta
 * 不会翻案。
 *
 * 纯函数 `resolveBuilderStamp(startDir)` 仍单独导出供测试直接打；本常量的加载期语义由
 * `builder-stamp-load-time.test.ts` 用 `node:fs` mock + `vi.resetModules()` 钉住。
 */
const LOAD_TIME_STAMP: GraphBuilderStamp | null = resolveBuilderStamp(
  path.dirname(fileURLToPath(import.meta.url)),
);

/** 生产入口：返回模块加载那一刻抓到的 builder 身份（可能为 `null`，即诚实降级）。 */
export function getBuilderStamp(): GraphBuilderStamp | null {
  return LOAD_TIME_STAMP;
}
