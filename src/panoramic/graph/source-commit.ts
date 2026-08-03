/**
 * F217 FR-009/010：sourceCommit 写盘注入 + freshness 四态判定。
 *
 * 唯一含 `child_process` 调用的模块——git 交互全部走只读命令
 * （`git rev-parse HEAD` / `git status --porcelain=v1 -z --untracked-files=all`）。
 */
import { execFileSync } from 'node:child_process';
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
 * 其共享叶子仍由 `ignore-oracle.ts` 这一分派型消费方使用，未被孤立。
 */
function isDirtyJudgedSourceFile(filePath: string): boolean {
  return DIRTY_SOURCE_SURFACES.some((surface) => surfaceMatchesFile(surface, filePath));
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
  const dirtyPaths = allPaths.filter((p) => isDirtyJudgedSourceFile(p));
  return { paths: [...new Set(dirtyPaths)].sort(), readFailed: false };
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
): FreshnessStaleReason[] {
  const reasons: FreshnessStaleReason[] = [];

  if (recordedSourceCommit !== currentHead) {
    reasons.push('source-commit');
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

  return reasons;
}

/**
 * 与当前 HEAD 比对 + collector 指纹比对 + 工作树 dirty 判定，产出四态之一。
 *
 * 五级优先级（F249 FR-009，顺序本身是合同的一部分）：
 * 1. recordedSourceCommit 为 null/undefined → unknown-provenance（旧图产物 / 非 AST 重建路径）
 * 2. currentHead 无法解析（非 git 仓库 / rev-parse 失败）→ unknown-provenance
 *    （绝不据此比较出 stale；指纹状态**不改变**这一短路结果，SC-017）
 * 3. 聚合 stale：commit mismatch 与三类指纹原因任一命中 → stale + staleReasons
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
): GraphFreshnessVerdict {
  const currentHead = resolveSourceCommit(projectRoot);

  if (recordedSourceCommit === null || recordedSourceCommit === undefined) {
    return {
      state: 'unknown-provenance',
      recordedSourceCommit,
      currentHead,
    };
  }

  if (currentHead === null) {
    return {
      state: 'unknown-provenance',
      recordedSourceCommit,
      currentHead: null,
    };
  }

  const staleReasons = collectStaleReasons(recordedSourceCommit, currentHead, recordedFingerprint);
  if (staleReasons.length > 0) {
    return {
      state: 'stale',
      recordedSourceCommit,
      currentHead,
      staleReasons,
    };
  }

  const dirtyResult = getDirtySourceFiles(projectRoot);
  if (dirtyResult.readFailed) {
    return {
      state: 'dirty',
      recordedSourceCommit,
      currentHead,
      porcelainReadFailed: true,
    };
  }
  if (dirtyResult.paths.length > 0) {
    return {
      state: 'dirty',
      recordedSourceCommit,
      currentHead,
      dirtyFiles: dirtyResult.paths,
    };
  }

  return {
    state: 'fresh',
    recordedSourceCommit,
    currentHead,
  };
}
