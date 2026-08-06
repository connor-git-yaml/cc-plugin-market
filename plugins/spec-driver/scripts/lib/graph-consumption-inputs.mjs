// Feature 241（M9 轨道 B4）/ Feature 258 — 图消费决策的**五维输入采集**层。
//
// 由 `graph-consumption-cli.mjs` 拆出（F258 `[CLEANUP]` 两遍法第二遍）：CLI 文件此前同时承载
// 参数解析 + 输入采集 + 审计 + 渲染 + 两个子命令，输入采集是其中边界最清晰、也最该被单独测的一段。
//
// **本文件各符号的出身不同，别把整份文件当成"原样搬运"**（拆出与重写是同一批落地的两件事）：
// - **原样搬出、逐字节未改**：`verifiedSourceCommitOf` / `collectGraphAvailability` /
//   `FINGERPRINT_SURFACE_KEYS` / `SUPPORTED_FINGERPRINT_FORMAT_VERSION` / `FINGERPRINT_MATCH_SEMANTICS`
// - **搬出时已是 P2 改造后的形态**（相对 F258 基线 commit 有差异，但相对搬运前的工作树逐字节相同）：
//   `deriveScopeSurfacesFromFingerprint` / `collectCoverageScope`
// - **F258 P3 重写 / 全新**：`runGit`（改结构化返回）/ `collectChangeSet`（加锚点预检与三种结局）/
//   `probeBaseRefResolvable`（新增）
// 想对拍搬运纯度时请按上面这三档分别比对，别对整份文件做 `git show HEAD:` 全等比较。
//
// **零 dist 依赖硬约束（W1，沿用 graph-bootstrap-status.mjs 文件头）**：本目录下的 `.mjs` 不得
// import TS 侧编译产物。因此这里存在若干 TS 侧常量的手写副本，由外部合同测试锚定（见各自 JSDoc）。
//
// **RG-006 边界**：本文件属 `resolveImportClosure(CLI_PATH)` 自动纳入的被审集合——
// 不得写出 freshness / source-commit 命名的状态文件、不得自行拿 sourceCommit 比 HEAD 复算
// freshness（freshness 的唯一权威是 canonical `checkFreshness`）、不得读审计事件流。

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import { readEmbeddedGraphMeta } from './graph-bootstrap-status.mjs';
import { classifyChangeSet } from './git-change-classifier.mjs';
import { surfaceMatchesFileMjs } from './graph-consumption-decision.mjs';

/* ------------------------------------------------------------------ git 调用 */

/**
 * 结构化的 git 调用结果（F258 缺陷 2 的 Why 5）。
 *
 * 原实现是 `result.status === 0 ? result.stdout : ''`——"没跑成"与"跑成了但输出为空"被压成
 * 同一个空串，于是下游 `classifyChangeSet` 把"读不到"当成"没有变更"这一**事实**照常判定。
 * 这里把两者在类型层分开：`ok` 是判据，`stdout` 只是数据。
 *
 * @returns {{ ok: boolean, status: number|null, stdout: string, stderr: string, spawnError: string|null }}
 *   `status` 在 spawn 本身失败（git 不可执行 / 被信号终止）时为 `null`——**不得**把它当 0。
 */
function runGit(projectRoot, args) {
  const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    spawnError: result.error ? String(result.error.message ?? result.error) : null,
  };
}

/** 锚点预检的判定结果。`ok:false` 时 `status`/`stderr`/`spawnError` 供 abort payload 如实回显。 */
function probeBaseRefResolvable(projectRoot, baseRef) {
  // `-` 开头的 ref 在任何 git 子命令里都会被当成选项——它不可能是一个合法的 phase 起点锚点。
  // 与其依赖各子命令的 `--` / `--end-of-options` 支持度，不如在进程边界之前就显式拒绝：
  // 判据独立于 git 版本，也断掉了"参数被当选项解释"这条注入面。
  if (baseRef.startsWith('-')) {
    return {
      ok: false,
      status: null,
      stderr: `拒绝以 '-' 开头的 base-ref（会被 git 当成选项）：${baseRef}`,
      spawnError: null,
    };
  }
  // 为什么用 `git cat-file -e <ref>^{commit}` 而不是 git 那个惯用的 revision 解析子命令
  // （其名字是 RG-006 扫描 ② 的被禁 token 之一，判据见 graph-consumption-cli.test.mjs 的
  // 「② freshness 唯一依赖扫描」；此处刻意不写出该 token，免得整条门禁的绿灯挂在
  // "这段注释的排版方式恰好能被 strip 正则剥掉"上——那是一个不该存在的隐式依赖）：
  // 本文件属该门禁的被审 import 闭包，而锚点可解析性与 freshness 毫无关系；
  // 为一条无关需求去放宽一道承重门禁，代价远高于换一个语义等价的命令。
  // `cat-file -e <ref>^{commit}` 回答的正是"这个 ref 能否 peel 成一个本地存在的 commit 对象"，
  // 与预检语义逐字对应；两条命令的退出码谱都收口为"非 0 即不可解析"（保守方向）。
  // 已知差异（登记，非 bug）：本命令对 tree-ish（如 `HEAD^{commit}` 之外的 `HEAD^{tree}`）判拒，
  // 而 `git diff <tree-ish>..` 其实能跑——方向是**过严**（fail-closed），且 phase 锚点本就该是 commit。
  const probe = runGit(projectRoot, ['cat-file', '-e', `${baseRef}^{commit}`]);
  return { ok: probe.ok, status: probe.status, stderr: probe.stderr, spawnError: probe.spawnError };
}

/**
 * `changeClass` + 变更文件清单 + 锚点可解析性 + 工作树读取可信度。
 *
 * `--base-ref` 缺省时只看工作树差异（`baseRefMissing: true`）——这不是等价替代：
 * 已 commit 的改动会整体看不见，因此调用方在权威判定时必须传 base-ref。
 *
 * **为什么 base-ref 失败硬失败、而 porcelain 失败不硬失败（两者责任方不同，出口就不该相同）**：
 * - base-ref 是**调用方显式声称的锚点**。声称了却不可达是合同违反，此时"这个 phase 改了什么"
 *   根本无从回答；继续判定只会得到一个看似正常、实则拿空 diff 算出来的结论（原缺陷形态）。
 *   本仓 rebase 交付是强制流程，`phase_start_ref` 指向被改写的旧 sha 是**常规**而非异常形态，
 *   因此这条路径必须响亮，不能静默。
 * - porcelain 失败是**环境能力缺失**（非 git 项目 / git 不可用），是 CLI 本就支持的合法运行
 *   形态（此时 freshness 同样会落 unknown-provenance）。把它一并硬失败，等于把一整类合法用法
 *   关掉。它标注 `worktreeStatusReadFailed` 并继续出决策。
 *
 * **"不硬失败"≠"没有后果"（审查修复轮 M-5，如实登记）**：`porcelainOk:false` 会经
 * `classifyChangeSet` 的 `unrecognized` 并进 `changeClass='unknown'`，而 `unknown` 命中 FR-003
 * 矩阵行 7 `consume-degraded`、**抢在 stale 行 8 之前短路 ⇒ 本次不刷图**——这正是本 fix 为
 * base-ref 拒绝 `unknown` 时给出的那条理由。两者的区别只在"是否中止整次调用"，不在"有没有代价"。
 *
 * 该后果是**裁决保留**的，不是疏漏：`porcelainOk:false` 意味着工作树变更集真的拿不到，判
 * `unknown` 是对事实的正确读法。反过来把 porcelain 排除出 `unrecognized`（只留标注字段），
 * 会让一份**残缺**的变更集冒充完整的——`git diff` 那一路只看得见已提交部分，于是工作树里的
 * 修改型改动被抹掉、整体被判 `additive-only` 从而**跳过 impact**，那才是不安全的方向。
 * 该裁决由 `graph-consumption-cli.test.mjs` 的 M-5 用例（unknown ⇒ consume-degraded ⇒
 * allowed+stale 也不刷图）钉住：要翻转裁决就得先翻那三条断言。
 *
 * @returns {{ changeClass: string|null, files: string[],
 *             baseRefResolution: 'not-provided'|'resolved'|'unresolvable'|'diff-failed',
 *             worktreeStatusReadFailed: boolean,
 *             gitStatus: number|null, gitStderr: string, gitSpawnError: string|null }}
 *   `baseRefResolution` 为 `unresolvable` / `diff-failed` 时 `changeClass` 恒为 `null`：
 *   让"锚点坏了却还有一个变更类别可读"在类型层就不可能发生。
 */
export function collectChangeSet(projectRoot, baseRef) {
  const readWorktree = () => runGit(projectRoot, ['status', '--porcelain', '-z', '--untracked-files=all']);

  if (typeof baseRef !== 'string' || baseRef.length === 0) {
    const porcelain = readWorktree();
    const { changeClass, files } = classifyChangeSet({
      // 未提供锚点 ≠ 读取失败：这一路我们**根本没问**，故 ok 位如实为 true（空输入 + 可信）
      nameStatusText: '',
      nameStatusOk: true,
      porcelainText: porcelain.stdout,
      porcelainOk: porcelain.ok,
    });
    return {
      changeClass,
      files,
      baseRefResolution: 'not-provided',
      worktreeStatusReadFailed: !porcelain.ok,
      gitStatus: null,
      gitStderr: '',
      gitSpawnError: null,
    };
  }

  const probe = probeBaseRefResolvable(projectRoot, baseRef);
  if (!probe.ok) {
    return {
      changeClass: null,
      files: [],
      baseRefResolution: 'unresolvable',
      worktreeStatusReadFailed: false,
      gitStatus: probe.status,
      gitStderr: probe.stderr,
      gitSpawnError: probe.spawnError,
    };
  }

  const diff = runGit(projectRoot, ['diff', '--name-status', '-z', `${baseRef}..`]);
  if (!diff.ok) {
    // 锚点自身可解析但 diff 仍失败（索引损坏 / 仓库状态异常）：与 unresolvable 同一出口、
    // 不同 detail。同样属于"这个 phase 改了什么答不出来"，同样不得静默给结论。
    return {
      changeClass: null,
      files: [],
      baseRefResolution: 'diff-failed',
      worktreeStatusReadFailed: false,
      gitStatus: diff.status,
      // spawn 层失败（maxBuffer 溢出 ENOBUFS / git 不可执行 / 被信号打断）时 `status` 为 null
      // 且 `stderr` 为空——此时 `spawnError` 是**唯一**有信息量的诊断，丢掉它等于让 abort 只会说
      // "失败了"却说不出为什么。它必须一路走到 payload，不能留成死字段。
      gitStderr: diff.stderr,
      gitSpawnError: diff.spawnError,
    };
  }

  const porcelain = readWorktree();
  const { changeClass, files } = classifyChangeSet({
    nameStatusText: diff.stdout,
    nameStatusOk: diff.ok,
    porcelainText: porcelain.stdout,
    porcelainOk: porcelain.ok,
  });
  return {
    changeClass,
    files,
    baseRefResolution: 'resolved',
    worktreeStatusReadFailed: !porcelain.ok,
    gitStatus: null,
    gitStderr: '',
    gitSpawnError: null,
  };
}

/* --------------------------------------------------------------- 图可用性 */

/**
 * "已验证的 `graph.sourceCommit`"判据的**唯一实现**：非空字符串才算数，其余一律 null（B1-C1）。
 *
 * `readEmbeddedGraphMeta` 的 `ok:true` 只保证"文件读到了、JSON 解析通过"，字段本身缺失时
 * 它回的是 `sourceCommit: null`（那是 F239 为"旧格式图仍可评估"留的三态语义）。消费侧不能沿用
 * 那条宽松语义：一份查不出 provenance 的图，`annotate-caveat` 无从做快照校验、freshness 无从落地，
 * 对图消费决策而言与"读不出来"等价。判据与 canonical `inspectBuiltGraph` 逐字一致，
 * 避免"构建后判为不可用、决策时又判为可用"的自相矛盾。
 *
 * 取 meta 而非路径为入参（F254）：需要同时拿 fingerprint 的调用点只读一次文件即可复用本判据，
 * 不必为省一次读取而把这个 2 行谓词抄成三份。
 *
 * @param {{ ok: boolean, value: { sourceCommit: unknown } }} meta `readEmbeddedGraphMeta` 的返回
 *   （`ok:true` 时 `value` 必存在——本函数对其无条件解引用，依赖该上游保证）
 * @returns {string|null}
 */
export function verifiedSourceCommitOf(meta) {
  if (!meta.ok) return null;
  const sourceCommit = meta.value.sourceCommit;
  return typeof sourceCommit === 'string' && sourceCommit.length > 0 ? sourceCommit : null;
}

/**
 * 图可用性三态。
 *
 * **入口必须是 `lstat`（EC-02 硬合同，B1-C2）**：`statSync` 会跟随符号链接，一条指向不存在目标的
 * `graph.json` symlink 因此报 ENOENT → 被判 `missing` → `allowed` 下走"重建"分支，而重建会
 * 沿着那条 symlink 往仓外写图。路径**存在与否**只能由 lstat 回答；能不能用是另一个问题。
 *
 * 判据收敛为两句话：
 * - lstat 报 ENOENT（路径确实不存在）→ `missing`，这是**唯一**的 missing 通路
 * - 路径存在但拿不到可验证的 `sourceCommit`（断链 / 目录 / 不可读 / 非 JSON / 缺字段 /
 *   空串 / 非字符串 / `graph-too-large`）→ `corrupt`
 */
export function collectGraphAvailability(graphJsonPath) {
  try {
    fs.lstatSync(graphJsonPath);
  } catch (error) {
    // ENOENT 之外的 lstat 失败（父目录不可搜索等）不是"图不存在"，按不可用处理
    const missing = error !== null && typeof error === 'object' && error.code === 'ENOENT';
    return { graphAvailability: missing ? 'missing' : 'corrupt', graphSourceCommit: null, graphFingerprint: null };
  }

  // F254：sourceCommit 与 fingerprint 一次读取、一次解析（图产物可达 MB 级，也避免两次读取
  // 之间图被换掉的窗口）。availability 判据本身逐字不变：仍只看已验证的 sourceCommit。
  const meta = readEmbeddedGraphMeta(graphJsonPath);
  const sourceCommit = verifiedSourceCommitOf(meta);
  return sourceCommit === null
    ? { graphAvailability: 'corrupt', graphSourceCommit: null, graphFingerprint: null }
    : { graphAvailability: 'present', graphSourceCommit: sourceCommit, graphFingerprint: meta.value.fingerprint };
}

/* ------------------------------------------------------- 图自述采集面推导 */

/**
 * `graph.fingerprint.extensionSurface` 的五条管线 key（顺序与 collector-fingerprint.ts 对齐）。
 *
 * **导出仅为合同测试锚点**（`tests/unit/graph-scope-extensions-contract.test.ts`）：这份 key 列表是
 * TS 侧 `collector-fingerprint.ts::EXTENSION_SURFACE_KEYS` 的手写副本——zero-dist-dependency 边界
 * 下无法 import，只能靠外部合同测试锚定，否则就是本 fix 根治的那类镜像漂移的又一处。
 * 漂移的失败方向虽然安全（key 对不上 → 严格核验失败 → 整体回落静态面），但会**静默**丧失动态面
 * 能力：判定照常返回结果，只是永远走 fallback，没有任何报错能提示这件事。
 */
export const FINGERPRINT_SURFACE_KEYS = [
  'tsjsSkeletonWalk',
  'pyWalk',
  'genericAdapters',
  'moduleDerivationScan',
  'pythonSymbolScan',
];

/**
 * 本模块唯一认识的 collector fingerprint 格式版本。
 *
 * **导出仅为合同测试锚点**（同 `FINGERPRINT_SURFACE_KEYS`）：这是 TS 侧
 * `collector-fingerprint.ts::SUPPORTED_FORMAT_VERSION` 的第三处手写副本，zero-dist-dependency 边界
 * 下无法 import。漂移的失败方向同样安全但同样静默——版本号对不上只会让所有指纹被判不认识、
 * 永久回落静态面，不报任何错。由 `tests/unit/graph-scope-extensions-contract.test.ts` 锚定。
 */
export const SUPPORTED_FINGERPRINT_FORMAT_VERSION = 1;

/** 指纹 entry 允许的匹配语义取值（TS 侧 `ExtensionMatchSemantics` 的手写副本，合同测试锚定）。 */
const FINGERPRINT_MATCH_SEMANTICS = new Set(['case-sensitive', 'case-insensitive']);

/**
 * 单条 entry 允许的 key 集合（TS 侧 `collector-fingerprint.ts::SURFACE_ENTRY_KEYS` 的手写副本）。
 *
 * **导出仅为合同测试锚点**（同 `FINGERPRINT_SURFACE_KEYS`）。
 *
 * 审查修复轮 M-6：此前只有顶层 key 做精确等值，entry 内多出的未知 key 被静默照单全收——
 * 同一种失真下沉一层。未来某条 entry 新增**收窄**语义的字段（如 `excludePatterns`）却忘了
 * bump `formatVersion` 时，只读 `extensions` + `matchSemantics` 会算出一个偏**宽**的面，
 * 于是本该判范围外的改动拿到全信 impact。TS 侧 `parseSurfaceEntry` 早就是 `keySetEquals`
 * 口径，这里补齐成同一口径。
 */
export const FINGERPRINT_ENTRY_KEYS = ['extensions', 'matchSemantics'];

/**
 * 从图内嵌的 collector fingerprint（F249）推导覆盖范围判据用的**逐管线采集面**。
 *
 * 消费图**自述**的采集面而非当前代码的采集面，是因为 coverageScope 问的是"这次改动能不能反映在
 * **手里这份图**里"。旧图配新代码时，按代码算会把图里根本没有的扩展判成 in-scope。
 *
 * **只做"够不够安全地取出扩展名列表"的宽松结构核验，不复刻 collector-fingerprint.ts 的整套版本
 * 演进/behaviorVersion 比较**：`plugins/spec-driver/scripts` 是零 dist 依赖的纯 `.mjs`（W1 硬约束，
 * 见 graph-bootstrap-status.mjs 文件头），无法 import TS 侧编译产物。这里刻意重复的只有
 * `formatVersion` 门槛这一个判断——真正会漂移的版本演进与比较语义仍只有一份实现（TS 侧，服务
 * freshness 判定），本函数只解读"扩展名在哪"这一个维度。
 *
 * 结构核验是**全有或全无**：`extensionSurface` 的 key 集合必须**精确等于**五条已知管线（多一个、
 * 少一个都算不认识），且每条形状合法，任一环不合规立即返回 null 整体回落静态面。宁可用旧口径，
 * 也不要用"凑出来的"部分并集——那正是本 fix 要根治的"扩面时悄悄漏一条管线"同类错误。
 *
 * **多出的未知 key 为什么也判不认识**（与 TS 侧 `parseCollectorFingerprint` 的 `keySetEquals` 同口径）：
 * 未来某个 producer 新增第六条管线却忘了 bump `formatVersion` 时，宽容忽略会让我们按残缺的五条
 * 算出一个**看起来合法**的并集，于是新管线覆盖的扩展名被静默判成范围外——正是本 fix 的原始 bug
 * 形态。严格集合把这种失误变成"整体回落静态面"（保守且可诊断，`scopeExtensionsSource` 会显示
 * static-fallback），代价只是"演进格式时必须同时 bump formatVersion"——那本就是它的用途。
 *
 * **entry 级严格校验（F258 R5 的第一个静默还原点 + 审查修复轮 M-6）**：除顶层 key 集合与
 * `formatVersion` 门槛外，每条 entry 自身也要过两关：
 * - **key 集合精确等于** `extensions` + `matchSemantics`（{@link FINGERPRINT_ENTRY_KEYS}），
 *   与顶层同口径、与 TS 侧 `parseSurfaceEntry` 的 `keySetEquals` 同口径。此前只有顶层严格、
 *   entry 内多出的未知 key 照单全收——同一种失真下沉一层，且这一层的漂移方向**不安全**：
 *   未来 entry 新增**收窄**语义的字段（如 `excludePatterns`）而忘了 bump `formatVersion` 时，
 *   只读两维会算出偏**宽**的面 ⇒ 本该判范围外的改动拿到全信 impact。
 * - `matchSemantics` **必须属于已知二值**。"扩展名集合"和"匹配语义"是同等重要的两维，
 *   只取前一维就是本 fix 的根因（`.PY` 被判 in-scope）。
 *
 * 未来若指纹新增第三种语义（或第三个 entry 字段）而消费侧不认识，回落静态面是保守且**可诊断**
 * 的方向（调用方会据此输出 `static-fallback-malformed-fingerprint` 并 warn），静默猜一种则是灾难。
 *
 * @param {unknown} fingerprint `graph.json` 的 `graph.fingerprint` 字段，可能是 undefined/null/畸形对象
 * @returns {{surfaces: {id: string, extensions: string[], matchSemantics: string}[] | null,
 *            rejection: string | null}}
 *   `surfaces` 为 null 时：`rejection` 为 null 表示图**本就没有**指纹（正常的 static-fallback），
 *   非 null 则是"有指纹但不被认识"的具体原因（供 stderr warn 与三值 `scopeExtensionsSource`）。
 */
export function deriveScopeSurfacesFromFingerprint(fingerprint) {
  const reject = (rejection) => ({ surfaces: null, rejection });
  // 图缺失/损坏/旧格式无 fingerprint 字段：这不是畸形，是"没有自述面"
  if (fingerprint === undefined || fingerprint === null) return { surfaces: null, rejection: null };
  if (typeof fingerprint !== 'object' || Array.isArray(fingerprint)) return reject('fingerprint 不是对象');
  // 未来格式演进：不认就回落，不猜测新形状
  if (fingerprint.formatVersion !== SUPPORTED_FINGERPRINT_FORMAT_VERSION) {
    return reject(`formatVersion=${JSON.stringify(fingerprint.formatVersion)} 不受支持（本模块只认 ${SUPPORTED_FINGERPRINT_FORMAT_VERSION}）`);
  }

  const surface = fingerprint.extensionSurface;
  if (surface === null || typeof surface !== 'object' || Array.isArray(surface)) return reject('extensionSurface 不是对象');

  // 严格 key 集合：长度相等 + 已知 key 全在 ⟹ 集合相等（FINGERPRINT_SURFACE_KEYS 无重复项）
  const presentKeys = Object.keys(surface);
  if (presentKeys.length !== FINGERPRINT_SURFACE_KEYS.length) {
    return reject(`extensionSurface 顶层 key 集合不匹配（期望 ${FINGERPRINT_SURFACE_KEYS.length} 条已知管线，实得 ${presentKeys.join(', ') || '(空)'}）`);
  }

  const surfaces = [];
  for (const key of FINGERPRINT_SURFACE_KEYS) {
    const entry = surface[key];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return reject(`${key} 条目缺失或不是对象`);
    // entry 级严格 key 集合（M-6）：与顶层同口径，多一个少一个都判不认识
    const entryKeys = Object.keys(entry);
    if (
      entryKeys.length !== FINGERPRINT_ENTRY_KEYS.length ||
      !FINGERPRINT_ENTRY_KEYS.every((entryKey) => entryKeys.includes(entryKey))
    ) {
      return reject(`${key} 的 key 集合不匹配（只认 ${FINGERPRINT_ENTRY_KEYS.join(' + ')}，实得 ${entryKeys.join(', ') || '(空)'}）`);
    }
    if (!Array.isArray(entry.extensions) || entry.extensions.length === 0) return reject(`${key}.extensions 不是非空数组`);
    for (const extension of entry.extensions) {
      if (typeof extension !== 'string' || extension.length === 0) return reject(`${key}.extensions 含非字符串或空串元素`);
    }
    if (!FINGERPRINT_MATCH_SEMANTICS.has(entry.matchSemantics)) {
      return reject(`${key}.matchSemantics 缺失或未知（实得 ${JSON.stringify(entry.matchSemantics)}，只认 case-sensitive | case-insensitive）`);
    }
    surfaces.push({ id: key, extensions: [...entry.extensions], matchSemantics: entry.matchSemantics });
  }
  return { surfaces, rejection: null };
}

/* ------------------------------------------------------------- 覆盖范围判据 */

/**
 * 覆盖范围判据：本轮变更文件是否**全部**落在图覆盖面之外。
 *
 * "全部之外"而非"存在之外"：混合改动（既有面内文件又有面外文件）里面内部分的 impact 仍然有值，
 * 一有面外文件就整体判 out-of-scope 会把有效信号一起丢掉。
 * 无变更文件时不声称 out-of-scope——那是"不知道"，不是"范围外"。
 *
 * `scopeSurfaces` 由调用方算好后显式传入（图自述动态面，或静态 fallback），使本判据与
 * `annotateImpactCaveat` 在同一次调用内消费同一份面**和同一个匹配器**（C-002）。
 *
 * F258：判定一律走 `surfaceMatchesFileMjs`，不再自行"取扩展名 + toLowerCase"——那份自实现丢掉了
 * 逐管线匹配语义，把 `foo.PY` 判成 in-graph-scope，而 PY walk 是大小写敏感的 `endsWith`。
 * `=== true` 收口：不可判的面在 `deriveScopeSurfacesFromFingerprint` 阶段已被整体拦下，
 * 走到这里的 `null` 只可能来自结构异常，按"不在面内"处理是保守方向。
 */
export function collectCoverageScope(files, scopeSurfaces) {
  if (!Array.isArray(files) || files.length === 0) return 'in-graph-scope';
  const anyInScope = files.some((filePath) =>
    scopeSurfaces.some((surface) => surfaceMatchesFileMjs(surface, filePath) === true),
  );
  return anyInScope ? 'in-graph-scope' : 'out-of-graph-scope';
}
