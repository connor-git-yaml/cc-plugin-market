/**
 * F217 FR-009/010：sourceCommit 写盘注入 + freshness 四态判定。
 *
 * 唯一含 `child_process` 调用的模块——git 交互全部走只读命令
 * （`git rev-parse HEAD` / `git status --porcelain=v1 -z --untracked-files=all` /
 * `git diff --name-only -z --end-of-options <sha> <sha>`）。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { DIRTY_SOURCE_SURFACES, surfaceMatchesFile } from '../../collector-surface.js';
import {
  computeCollectorFingerprint,
  fingerprintsEqual,
  parseCollectorFingerprint,
} from './collector-fingerprint.js';
import type { FreshnessStaleReason, GraphFreshnessVerdict } from './quality/quality-types.js';

/** git 只读命令输出上限（FIX-3：防大仓库输出超默认 1MB 被截断触发 ENOBUFS）。 */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * 在 projectRoot 执行 `git rev-parse HEAD`；非 git 仓库 / 命令失败均返回 null，不抛异常（FR-009）。
 *
 * detached HEAD 场景下 `git rev-parse HEAD` 本身就能正常解析出具体 commit SHA，无需特判。
 */
export function resolveSourceCommit(projectRoot: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });
    const sha = out.trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

/**
 * F249 决策 4 / FR-003：判定某路径是否落在 dirty 判定面内。
 *
 * dirty 判定面 = 六条生产者管线（tsjsSkeletonWalk / pyWalk / javaAdapter / goAdapter /
 * moduleDerivationScan / pythonSymbolScan）各自按**自身匹配形态**判定后取并集，事实源为
 * `collector-surface.ts` 的公开 seam `DIRTY_SOURCE_SURFACES`。
 *
 * W-004：整条判定委托 `surfaceMatchesFile(surface, filePath)`，**不再**由本模块先自行
 * "lastIndexOf('.') 切片"提取扩展名再查表。原写法对两族生产者都不等价——对 endsWith 族
 * 恰好同解，对 `path.extname` 族则把纯点文件误判为命中（`src/.go` 的 `path.extname` 是空串，
 * generic collector 根本不会采集它，但旧切片法算出 `.go` → 误报 dirty）。扩展名提取口径
 * 本身就属于"管线匹配形态"的一部分，必须留在事实源里、不能外泄给调用方各自实现。
 *
 * 为什么不能沿用原 `getDirtySourceExtensions()` 的扁平 `Set<string>`：扁平集合的
 * `.has(ext)` 契约只能表达单一全局语义，无法同时表达"TSJS/PY 大小写敏感、Java/Go 与
 * module 派生扫描大小写不敏感"。若为覆盖 `.JAVA` 而把整个扁平集合改成大小写不敏感，
 * 就会重新引入 FIX-4 修过的"`.TS` 因 TSJS 面被误判 dirty"问题；反之保持全局敏感则
 * 继续漏报 `.JAVA`。逐管线谓词是这两个约束的唯一交集。
 *
 * 副产品：本模块不再 `new JavaLanguageAdapter()`/`new GoLanguageAdapter()`，
 * `panoramic/graph` → `adapters/` 的直接依赖随之解除。
 *
 * 与 F248 的关系（rebase 调和）：F248 把本模块原有的私有 `extname` 收敛到共享
 * `collector-extname.ts::extractExtension`。本轮改造更进一步——dirty 判定不再在本模块做任何
 * 扩展名提取（提取口径随管线而异，已内化进 `surfaceMatchesFile`），因此这里连
 * `extractExtension` 也不需要 import。F248 的"消除双实现"意图完全达成（零重复提取实现），
 * 其共享叶子 `collector-extname.ts` 此前仍由 `ignore-oracle.ts` 这一消费方引用；该消费方
 * 实际手上持有的是完整文件路径而非仅扩展名，已于 F252 一并迁移至 `surfaceMatchesFile`，
 * `collector-extname.ts` 随之零消费方退役并删除。
 */
function isDirtyJudgedSourceFile(filePath: string): boolean {
  return DIRTY_SOURCE_SURFACES.some((surface) => surfaceMatchesFile(surface, filePath));
}

/**
 * M11 卡 D 对抗审查（角 A C-4）：`.gitignore`（含嵌套）是 walk 的**采集范围输入**而非旁观者——
 * `source-discovery` 的 ts/js 与 py walk 都叠了 `isGitignored` 过滤层；只改 `.gitignore` 的 commit
 * 会让一批文件进入 / 退出采集范围，而扩展名谓词对它必然落空。故与源码同列判定面（dirty 与 committed 两侧同源）。
 */
function isCollectionScopeInputFile(filePath: string): boolean {
  return path.posix.basename(filePath) === '.gitignore';
}

function isJudgedSourceFile(filePath: string): boolean {
  return isDirtyJudgedSourceFile(filePath) || isCollectionScopeInputFile(filePath);
}

/**
 * git 对象名的形态校验（sha1 40 hex / sha256 64 hex）。`recordedSourceCommit` 来自 `JSON.parse` 的外部图产物，
 * 不校验就会原样进入 git 位置参数：`-s` / `--quiet` 让 diff 输出被抑制而判 fresh，`--output=<path>` 是以调用者身份
 * 的任意文件写，`HEAD` 这种合法 rev 无需恶意即可让判定恒 fresh（对抗审查角 A C-2 实测）。
 */
export function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value);
}

/**
 * 解析 `git status --porcelain=v1 -z --untracked-files=all` 的 NUL 分隔输出。
 *
 * 每条记录格式为 `XY PATH`；rename/copy 记录（X 或 Y 为 'R'/'C'）额外携带一个
 * NUL 分隔的 ORIG_PATH 字段（无 `->` 分隔符，与非 -z 格式不同）。
 * 返回涉及到的全部路径（rename 场景含新旧两条）。
 */
function parsePorcelainZPaths(raw: string): string[] {
  const parts = raw.split('\x00');
  // split 会在末尾产生一个空字符串（末尾 NUL 终止符），过滤掉
  const records = parts.filter((p) => p.length > 0);
  const paths: string[] = [];
  let i = 0;
  while (i < records.length) {
    const record = records[i];
    if (record === undefined) break;
    const statusCode = record.slice(0, 2);
    const pathPart = record.slice(3);
    paths.push(pathPart);
    const isRenameOrCopy =
      statusCode[0] === 'R' || statusCode[0] === 'C' || statusCode[1] === 'R' || statusCode[1] === 'C';
    if (isRenameOrCopy) {
      i += 1;
      const origPath = records[i];
      if (origPath !== undefined) paths.push(origPath);
    }
    i += 1;
  }
  return paths;
}

/**
 * M11 卡 D（簇⑦）：`recordedSourceCommit..currentHead` 之间**提交历史**改动的采集面源码路径。
 *
 * source-commit 维度的 stale 语义由「HEAD 是否移动」改为「sourceCommit 之后的提交是否改动了采集面源码」：
 * 只改文档 / 账本 / 图产物本身的 commit 不该让图变 stale，否则每次 commit 后 repo:check 必 warn
 * （F270 / F275 / F277 三次再现，09-14 又手动重建两次）。判定面与 dirty 同源（`DIRTY_SOURCE_SURFACES`）。
 * `git diff` 失败（sourceCommit 不在当前历史：历史改写 / 浅克隆）→ readFailed，调用方按 stale 保守处理。
 */
function getCommittedSourceChanges(projectRoot: string, fromCommit: string, toCommit: string): DirtySourceFilesResult {
  // 不是 commit SHA 的值一律不进 argv（角 A C-2）；与「range 解析失败」同一保守出口
  if (!isCommitSha(fromCommit) || !isCommitSha(toCommit)) {
    return { paths: [], readFailed: true };
  }
  let raw: string;
  try {
    raw = execFileSync(
      'git',
      [
        // 角 A C-1 / 角 B C-2：默认 diff.renames=true 会把「采集面 → 非采集面」的改名折叠成只列目的路径，旧路径从此
        // 不进谓词；角 A W-7：diff.relative 会按 cwd 截断路径集。两项都钉死，判定不随用户 git 配置漂移。
        '-c', 'diff.renames=false',
        '-c', 'diff.relative=false',
        'diff', '--name-only', '-z', '--end-of-options', fromCommit, toCommit,
      ],
      { cwd: projectRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_GIT_OUTPUT_BYTES },
    );
  } catch {
    return { paths: [], readFailed: true };
  }
  const changed = raw.split('\x00').filter((p) => p.length > 0 && isJudgedSourceFile(p));
  return { paths: [...new Set(changed)].sort(), readFailed: false };
}

/** getDirtySourceFiles 的结果：区分"读取成功但可能为空"与"读取本身失败"（FIX-3）。 */
interface DirtySourceFilesResult {
  paths: string[];
  /** true=`git status --porcelain` 命令执行失败（如 ENOBUFS），而非"工作树确实干净"。 */
  readFailed: boolean;
}

/**
 * 获取工作树中触发 dirty 判定的源码文件路径清单（过滤面按源码扩展名，决策 3）。
 *
 * FIX-3（Codex WARNING）：命令失败（如大仓库输出超限触发 ENOBUFS）此前直接返回空数组，
 * 会被上层误判为"工作树干净"（fresh）——但读取失败与"确实无未提交源码改动"是两回事，
 * 保守起见判为 dirty 并显式标注 readFailed，供调用方向人提示"按 dirty 保守处理"。
 * 此调用不会在 currentHead 解析失败时触发（evaluateFreshness 已提前短路）。
 */
function getDirtySourceFiles(projectRoot: string): DirtySourceFilesResult {
  let raw: string;
  try {
    raw = execFileSync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { cwd: projectRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_GIT_OUTPUT_BYTES },
    );
  } catch {
    return { paths: [], readFailed: true };
  }
  if (!raw) return { paths: [], readFailed: false };

  const allPaths = parsePorcelainZPaths(raw);
  const dirtyPaths = allPaths.filter((p) => isJudgedSourceFile(p));
  return { paths: [...new Set(dirtyPaths)].sort(), readFailed: false };
}

/**
 * M11 卡 D：建图时点的工作树是否脏（判定面与 freshness 的 dirty 同源）。写盘链路把结果记进
 * `graph.graph.sourceTreeDirty`——`sourceCommit` 只是标签不是内容锚：脏树上建的图含未提交内容却盖着 HEAD 的章，
 * 改动丢弃后树干净、HEAD 未动、committed diff 为空，三维全看不出图里残留着任何 commit 都不存在的节点
 * （对抗审查角 A W-6 / 角 B C-1 实测）。porcelain 读取失败按脏保守记录。
 */
export function isSourceTreeDirty(projectRoot: string): boolean {
  const result = getDirtySourceFiles(projectRoot);
  return result.readFailed || result.paths.length > 0;
}

/**
 * F249（FR-009 步骤 3）：聚合 stale 原因。
 *
 * 调用前置：调用方已确认 `recordedSourceCommit` 与 `currentHead` 均非空（步骤 1/2 未短路）。
 *
 * push 顺序即输出顺序，MUST NOT 改为遍历某个 map/对象的键——`staleReasons` 的顺序确定性
 * （SC-007/SC-009）由这份固定书写顺序单独承担，下游文案渲染依赖它。
 *
 * 三类指纹原因互斥（`else if` 链）而非并列：`unrecorded`（没有指纹）/`invalid`（有但不可信）/
 * `collector-fingerprint`（可信但不一致）在语义上是同一维度上递进的三种状态，同时报告两条
 * 只会让诊断文案自相矛盾。
 *
 * W-005：结构收口与内容比较消费的是**同一份** `parseCollectorFingerprint` 返回的 snapshot，
 * 本函数对 `recordedFingerprint` 只做一次属性读取（在 parse 内部完成）。此前是"先
 * `isValidCollectorFingerprint(原对象)`、再 `fingerprintsEqual(原对象, ...)`"两次独立读取，
 * 对带 accessor 的入参会出现"校验通过的值"与"参与比较的值"不是同一个东西，第二次读取抛错时
 * 还会突破 FR-018 的"判定过程不抛异常"约束。
 */
function collectStaleReasons(
  recordedSourceCommit: string,
  currentHead: string,
  recordedFingerprint: unknown,
  projectRoot: string,
  recordedSourceTreeDirty: unknown,
  dirtyResult: DirtySourceFilesResult,
): { reasons: FreshnessStaleReason[]; committedSourceChanges?: string[] } {
  const reasons: FreshnessStaleReason[] = [];
  let committedSourceChanges: string[] | undefined;

  if (recordedSourceCommit !== currentHead) {
    // M11 卡 D：HEAD 移动本身不构成 stale，两棵树之间采集面源码有差异才算（两点 diff 是树比较：中途改了又改回来判 fresh
    // 是对的，三点 diff 会把「图建在后代、HEAD 回到祖先」判成 fresh）；range 解析失败 / SHA 形态不合法按 stale 保守处理
    const committed = getCommittedSourceChanges(projectRoot, recordedSourceCommit, currentHead);
    if (committed.readFailed || committed.paths.length > 0) {
      reasons.push('source-commit');
      committedSourceChanges = committed.paths;
    }
  }

  // 图采集自脏工作树而当前树已干净：未提交内容要么已提交（上面的 committed diff 抓得到）要么已丢弃（三维都抓不到），
  // 两者不可区分，只能保守判 stale。树仍脏时不升格——由调用方按既有优先级判 dirty。
  if (recordedSourceTreeDirty === true && !dirtyResult.readFailed && dirtyResult.paths.length === 0) {
    reasons.push('source-tree-dirty-at-build');
  }

  if (recordedFingerprint === null || recordedFingerprint === undefined) {
    // FR-010：缺失（旧图）与显式 null（直连 API 未写入）同等保守处理，绝不放行为 fresh
    reasons.push('collector-fingerprint-unrecorded');
  } else {
    const snapshot = parseCollectorFingerprint(recordedFingerprint);
    if (snapshot === null) {
      // FR-018：结构畸形 → "指纹存在但不可信"，与"没有指纹"分开报告
      reasons.push('collector-fingerprint-invalid');
    } else if (!fingerprintsEqual(snapshot, computeCollectorFingerprint())) {
      reasons.push('collector-fingerprint');
    }
  }

  return committedSourceChanges === undefined ? { reasons } : { reasons, committedSourceChanges };
}

/**
 * 与当前 HEAD 比对（M11 卡 D：比的是 sourceCommit..HEAD 之间是否有提交改动采集面源码，不是 HEAD 是否移动）
 * + collector 指纹比对 + 工作树 dirty 判定，产出四态之一。
 *
 * 五级优先级（F249 FR-009，顺序本身是合同的一部分）：
 * 1. recordedSourceCommit 为 null/undefined → unknown-provenance（旧图产物 / 非 AST 重建路径）
 * 2. currentHead 无法解析（非 git 仓库 / rev-parse 失败）→ unknown-provenance
 *    （绝不据此比较出 stale；指纹状态**不改变**这一短路结果，SC-017）
 * 3. 聚合 stale：commit 区间源码差异 / 脏树建图且树已干净 / 三类指纹原因任一命中 → stale + staleReasons
 *    （stale 的 verdict 同时携带工作树状态字段，供自动重建方拒绝在脏树上重建）
 * 4. 工作树存在未提交源码改动 → dirty
 * 5. 否则 fresh
 *
 * 为什么指纹判定 MUST 排在 dirty 之前：dirty 是提交前的常态，若指纹判定与之并列或排在其后，
 * "采集器已变、图必须重建"这一信号会被日常脏工作树静默吞没（spec C-006）。
 *
 * @param recordedFingerprint 图产物记录的指纹。类型为 `unknown` 而非 `CollectorFingerprint`：
 *   它来自 `JSON.parse` 后的外部图产物字段，可能是任意畸形值，结构收口交由
 *   `isValidCollectorFingerprint` 完成（FR-018）。
 */
export function evaluateFreshness(
  recordedSourceCommit: string | null | undefined,
  projectRoot: string,
  recordedFingerprint?: unknown,
  recordedSourceTreeDirty?: unknown,
): GraphFreshnessVerdict {
  const currentHead = resolveSourceCommit(projectRoot);

  if (currentHead === null) {
    return {
      state: 'unknown-provenance',
      recordedSourceCommit,
      currentHead: null,
    };
  }

  // 工作树状态先于任何判定读取，且**每个** verdict 都携带测量结果（`dirtyFiles: []` 表示「测过且干净」，与「没测」区分；
  // 读取失败记 porcelainReadFailed）：stale 的 verdict 此前短路在 dirty 之前，repo:sync 在「stale」上看不到树是脏的，
  // 会把未提交状态烤进图（角 B C-1）；图缺失 / 损坏时同样要能回答「树脏不脏」（delta 复审 W-4）。state 的优先级不变。
  const dirtyResult = getDirtySourceFiles(projectRoot);
  const treeState = dirtyResult.readFailed
    ? { porcelainReadFailed: true as const }
    : { dirtyFiles: dirtyResult.paths };

  if (recordedSourceCommit === null || recordedSourceCommit === undefined) {
    return {
      state: 'unknown-provenance',
      recordedSourceCommit,
      currentHead,
      ...treeState,
    };
  }

  const { reasons: staleReasons, committedSourceChanges } = collectStaleReasons(
    recordedSourceCommit,
    currentHead,
    recordedFingerprint,
    projectRoot,
    recordedSourceTreeDirty,
    dirtyResult,
  );
  if (staleReasons.length > 0) {
    return {
      state: 'stale',
      recordedSourceCommit,
      currentHead,
      staleReasons,
      ...(committedSourceChanges !== undefined ? { committedSourceChanges } : {}),
      ...treeState,
    };
  }

  // 图采集自脏工作树而树仍脏：内容可能含已丢弃的未提交改动，但此刻分不清；state 仍是 dirty，
  // 用 builtFromDirtyTree 把这一事实回显给消费方（delta 复审 CRITICAL-2：此前该记录在树脏期间被整个扔掉，零信号）
  const builtFromDirtyTree = recordedSourceTreeDirty === true ? { builtFromDirtyTree: true as const } : {};
  if (dirtyResult.readFailed) {
    return {
      state: 'dirty',
      recordedSourceCommit,
      currentHead,
      porcelainReadFailed: true,
      ...builtFromDirtyTree,
    };
  }
  if (dirtyResult.paths.length > 0) {
    return {
      state: 'dirty',
      recordedSourceCommit,
      currentHead,
      dirtyFiles: dirtyResult.paths,
      ...builtFromDirtyTree,
    };
  }

  return {
    state: 'fresh',
    recordedSourceCommit,
    currentHead,
    dirtyFiles: [],
  };
}
