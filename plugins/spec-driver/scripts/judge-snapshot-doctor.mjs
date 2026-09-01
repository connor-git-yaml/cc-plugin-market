/**
 * judge-snapshot-doctor.mjs
 * Feature 236 — 判定器快照漂移信号：CLI 编排层
 *
 * 独立、只读、开发者主动调用的 doctor 命令（npm run judge:doctor）。
 * 比对仓库侧与已安装快照侧的判定器文件（集合以 JUDGE_FILE_SET 的枚举为准），产出四态结果。
 * 不接入 repo:check、不接入 Stop hook、drift 恒退出码 0（诊断非门禁，FR-009）。
 * 输出只描述状态，不含任何重装/同步/修复建议（FR-011）。
 *
 * Feature 278 项④ — 可选 `--since <ref>`：在既有报告之后追加一段增量视图，
 * 回答「这条漂移是本次改动引入的，还是 <ref> 时刻就已经存在」（FR-012~FR-017）。
 *
 * 运行相关测试:
 *   node --test plugins/spec-driver/tests/judge-snapshot-doctor.test.mjs
 *   node --test plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs
 */

import process from 'node:process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  JUDGE_FILE_SET,
  resolveActiveSnapshot,
  compareFile,
  aggregateStatus,
} from './lib/judge-snapshot-core.mjs';
import {
  computeSha256,
  validatePluginRoot,
  readSpecDriverPathFile,
  readInstalledPluginsMetadata,
  scanInstalledSnapshotPresence,
  canonicalize,
} from './lib/judge-snapshot-io.mjs';

/** 仓库侧判定器文件相对 projectRoot 的子目录前缀 */
const REPO_PLUGIN_SUBDIR = path.join('plugins', 'spec-driver');

/**
 * 同一前缀的 git 路径规格形式。git 的 pathspec 恒用 `/`，不能复用上面 path.join 的版本——
 * 那在 Windows 上是 `\`，喂给 git 必然找不到路径。
 */
const REPO_PLUGIN_POSIX_SUBDIR = 'plugins/spec-driver';

/** git 子进程 stdout 上限。判定器都是小文本文件，超出即视为异常（按 fatal 处理） */
const GIT_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * 解析命令行参数。支持 --project-root <path> 与 --since <ref>（后者可选）。
 * 未知参数或缺值 → { ok:false, error }。
 */
function parseArgs(argv) {
  let projectRoot = process.cwd();
  let since;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-root') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return { ok: false, error: '--project-root 需要一个路径参数' };
      }
      projectRoot = value;
      i += 1;
    } else if (arg === '--since') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return { ok: false, error: '--since 需要一个 git ref 参数' };
      }
      since = value;
      i += 1;
    } else {
      return { ok: false, error: `未知参数: ${arg}` };
    }
  }
  return { ok: true, projectRoot, since };
}

/**
 * 从 env.CLAUDE_PLUGIN_ROOT 组装 SourceProbe。
 */
function probeClaudePluginRoot(env) {
  const raw = env && typeof env.CLAUDE_PLUGIN_ROOT === 'string' ? env.CLAUDE_PLUGIN_ROOT.trim() : '';
  if (raw === '') return { kind: 'unavailable' };
  const validation = validatePluginRoot(raw);
  switch (validation.kind) {
    case 'ok':
      // 与 io 层 mapValidationToProbe 保持三来源对称：canonicalPath 须 realpath 规范化，
      // 否则 CLAUDE_PLUGIN_ROOT 指向 symlink 时输出未解析路径，行为与另两来源不一致（data-model §3.3）。
      return { kind: 'ok', path: raw, canonicalPath: canonicalize(raw) };
    case 'invalid':
      return { kind: 'invalid', reason: validation.reason };
    case 'error':
    default:
      return { kind: 'error', errorCode: validation.errorCode };
  }
}

/**
 * 核心编排（data-model.md §6）。projectRoot 为核心合同，env/claudeHome 可显式注入便于测试。
 */
export function checkJudgeSnapshotDrift({
  projectRoot,
  env = process.env,
  claudeHome = path.join(os.homedir(), '.claude'),
}) {
  // 步骤 1：仓库侧参照探测。仅「确定性缺失」(missing) 才判 not-applicable；
  // 「不确定性错误」(error/EACCES) 不得压成 not-applicable——入口存在但不可读时，
  // 快照若确定且内容真实漂移会被误吞（C2）。error 时不提前退出，继续解析 active snapshot，
  // 并在逐文件比较中把入口记为 indeterminate/repo（首次摘要结果复用，避免读入口两次）。
  const repoBase = path.join(projectRoot, REPO_PLUGIN_SUBDIR);
  const repoReference = path.join(repoBase, JUDGE_FILE_SET[0]);
  const repoReferenceProbe = computeSha256(repoReference);
  if (repoReferenceProbe.status === 'missing') {
    return {
      status: 'not-applicable',
      reason: 'repo-reference-missing',
      snapshotPath: null,
      resolutionSource: null,
      files: [],
    };
  }

  // 步骤 2：active 快照解析
  const sources = {
    claudePluginRoot: probeClaudePluginRoot(env),
    specDriverPath: readSpecDriverPathFile(projectRoot),
    installedMetadata: readInstalledPluginsMetadata(claudeHome),
  };
  const resolution = resolveActiveSnapshot(sources);

  if (resolution.resolutionSource === 'indeterminate') {
    // 2b：已有明确的错误/歧义信息 → 直接 indeterminate/resolution，不查 scanPresence
    if (resolution.reason === 'source-error' || resolution.reason === 'installed-plugins-metadata-ambiguous') {
      return {
        status: 'indeterminate',
        indeterminateKind: 'resolution',
        reason: resolution.reason,
        ...(resolution.detail ? { detail: resolution.detail } : {}),
        snapshotPath: null,
        resolutionSource: null,
        files: [],
      };
    }
    // 2c：no-active-snapshot-resolvable → 查 scanPresence 决定 not-applicable vs indeterminate
    const presence = scanInstalledSnapshotPresence(claudeHome);
    if (presence === 'absent') {
      return {
        status: 'not-applicable',
        reason: 'no-installed-snapshot',
        snapshotPath: null,
        resolutionSource: null,
        files: [],
      };
    }
    return {
      status: 'indeterminate',
      indeterminateKind: 'resolution',
      reason: presence === 'error' ? 'installed-snapshot-scan-error' : 'no-active-snapshot-resolvable',
      snapshotPath: null,
      resolutionSource: null,
      files: [],
    };
  }

  // 步骤 3：逐文件比对。入口文件（JUDGE_FILE_SET[0]）复用步骤 1 的探测结果，
  // 避免二次读盘；error 时 compareFile 将其判为 indeterminate/repo（保留其余已确认明细）。
  const files = JUDGE_FILE_SET.map((entry, index) => {
    const repoDigest = index === 0 ? repoReferenceProbe : computeSha256(path.join(repoBase, entry));
    const snapDigest = computeSha256(path.join(resolution.snapshotPath, entry));
    // snapshotDigest 随行返回：`--since` 的基线比较必须复用**这一次**读到的字节，
    // 而不是对同一路径再读一遍。两次读之间插件被重装/更新，会让同一行的 baseline 与 current
    // 基于不同字节算出，凭空造出一条分类（TOCTOU）。该字段不参与任何输出格式（SC-004）。
    return { file: entry, ...compareFile(repoDigest, snapDigest), snapshotDigest: snapDigest };
  });

  // 步骤 4：汇总
  const agg = aggregateStatus(files);
  if (agg === 'indeterminate') {
    return {
      status: 'indeterminate',
      indeterminateKind: 'comparison',
      reason: 'partial-file-read-failure',
      snapshotPath: resolution.snapshotPath,
      resolutionSource: resolution.resolutionSource,
      files,
    };
  }
  return {
    status: agg, // 'drift' | 'in-sync'
    snapshotPath: resolution.snapshotPath,
    resolutionSource: resolution.resolutionSource,
    files,
  };
}

const HEADER = [
  '判定器快照漂移诊断（judge-snapshot-doctor）',
  '============================================',
];

/** 逐文件明细区块（in-sync / drift / comparison-indeterminate 共用） */
function formatFileDetails(files) {
  const lines = [`文件明细（${files.length}）：`];
  for (const f of files) {
    let suffix = '';
    if (f.status === 'indeterminate') {
      suffix = `   (side: ${f.side}, errorCode: ${f.errorCode ?? 'unknown'})`;
    }
    lines.push(`  [${f.status}] ${f.file}${suffix}`);
  }
  return lines;
}

/** 汇总计数区块 */
function formatSummary(files) {
  const counts = {};
  for (const f of files) counts[f.status] = (counts[f.status] || 0) + 1;
  const parts = Object.entries(counts).map(([k, v]) => `${v} ${k}`);
  return `汇总: ${parts.join(' / ')}`;
}

/**
 * 按 status（及 indeterminateKind）分支格式化人类可读报告（FR-011：不含修复建议）。
 */
function formatReport(result, projectRoot) {
  const lines = [...HEADER];
  if (projectRoot) lines.push(`projectRoot:      ${projectRoot}`);

  if (result.status === 'not-applicable') {
    lines.push('status:           not-applicable');
    lines.push(`reason:           ${result.reason}`);
    return lines.join('\n');
  }

  if (result.status === 'indeterminate' && result.indeterminateKind === 'resolution') {
    lines.push('status:           indeterminate（resolution：无法确定本机 active 快照目录）');
    lines.push(`reason:           ${result.reason}`);
    if (result.detail) {
      lines.push(
        `detail:           source=${result.detail.source}` +
          (result.detail.errorCode ? `, errorCode=${result.detail.errorCode}` : ''),
      );
    }
    return lines.join('\n');
  }

  // 以下三态均已定位快照目录，打印 snapshotPath / resolutionSource / 文件明细
  lines.push(`snapshotPath:     ${result.snapshotPath}`);
  lines.push(`resolutionSource: ${result.resolutionSource}`);

  if (result.status === 'indeterminate') {
    // comparison
    lines.push('status:           indeterminate（comparison：快照已定位，但部分文件读取失败，以下为已确认明细）');
  } else {
    lines.push(`status:           ${result.status}`);
  }
  lines.push('');
  lines.push(...formatFileDetails(result.files));
  lines.push('');
  lines.push(formatSummary(result.files));
  if (result.status === 'indeterminate') {
    lines.push('说明: 存在读取失败的文件，无法对其完成比较；已确认的明细如上，不因此被隐藏。');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// `--since <ref>` 增量视图（Feature 278 项④）
// ---------------------------------------------------------------------------

/**
 * 与 judge-snapshot-io.mjs 的 computeSha256 同源：都对**原始 Buffer** 算 sha256。
 * MUST NOT 先转成 utf-8 字符串——那会在含 BOM / CRLF / 非 UTF-8 字节的文件上产出
 * 与 computeSha256 不同的摘要，凭空造出一片假 mismatch。
 */
function sha256OfBuffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * 调 git 前必须从环境里剔除的「仓库位置」变量。
 *
 * `git -C <dir>` **不覆盖** `$GIT_DIR`（本机 git 2.53.0 实测：在一个普通非 git 目录里注入
 * `GIT_DIR=<另一个仓>/.git`，`git -C <非仓目录> rev-parse --git-dir` 仍 exit 0 并返回被注入的仓）。
 * git hook 恒导出 `GIT_DIR` / `GIT_INDEX_FILE`，而本仓大量在 worktree 里跑插件脚本——不剔除就会
 * 把**另一个仓库**的内容当成基线，产出一份看起来完全正常、实则整份伪造的增量报告。
 *
 * 逐个 delete 而非白名单式重建 env：重建会丢掉 PATH / HOME 等 git 自身必需的变量。
 */
const GIT_LOCATION_ENV_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
];

function sanitizedGitEnv() {
  const env = { ...process.env };
  for (const key of GIT_LOCATION_ENV_KEYS) delete env[key];
  return env;
}

/** 统一的 git 子进程调用。刻意不设 encoding：stdout 保持 Buffer，摘要才与 io 层同源 */
function runGit(projectRoot, args) {
  return spawnSync('git', ['-C', projectRoot, ...args], {
    maxBuffer: GIT_MAX_BUFFER,
    env: sanitizedGitEnv(),
  });
}

/**
 * 归一化 `spawnSync` 的**全部**失败形态。返回 `null` 表示真正成功（status===0 且无 error/signal）。
 *
 * 这个函数是承重件：所有 git 调用点一律写成
 * `const failure = classifyGitResult(r); if (failure) …`，于是「又冒出一种失败形态」不需要每个
 * 调用点都记得补 `if`。已知四种形态（本机实测）：
 *
 * | 形态 | 判据 | 说明 |
 * |------|------|------|
 * | `spawn`     | `error !== undefined`   | ENOENT（git 不存在）、ERR_CHILD_PROCESS_STDIO_MAXBUFFER 等 |
 * | `signal`    | `signal` 非空           | 被信号杀死（OOM killer / cgroup / `timeout -s KILL`）。此时 `status === null` 且 `error === undefined`——只判 `error` 或只判 `status !== 0` 都漏 |
 * | `no-status` | `status` 不是数字       | 进程既没给退出码也没报信号 |
 * | `exit`      | `status !== 0`          | git 真跑成了并给出非零退出码 |
 *
 * **只有 `exit` 携带「git 的判断」**；其余三种一律是「git 根本没跑成」，绝不允许被解读成
 * 任何业务结论（尤其不允许被读成「该路径不存在」）。
 *
 * @param {{ error?: Error & { code?: string }, signal?: string|null, status?: number|null }} result
 * @returns {{ kind: 'spawn'|'signal'|'no-status'|'exit', detail: string } | null}
 */
export function classifyGitResult(result) {
  if (result.error !== undefined && result.error !== null) {
    return { kind: 'spawn', detail: result.error.code ?? result.error.message ?? 'unknown' };
  }
  if (result.signal !== undefined && result.signal !== null) {
    return { kind: 'signal', detail: String(result.signal) };
  }
  if (typeof result.status !== 'number') {
    return { kind: 'no-status', detail: String(result.status) };
  }
  if (result.status !== 0) {
    return { kind: 'exit', detail: String(result.status) };
  }
  return null;
}

/** classifyGitResult 的非 `exit` 形态统一转成「git 不可用」的错误文案 */
function gitUnavailableError(failure) {
  return `--since 无法执行：git 不可用（${failure.kind}: ${failure.detail}）`;
}

/** 两个路径是否指向同一目录（realpath 归一，覆盖 /tmp → /private/tmp 与 symlink 入口） */
function sameDirectory(a, b) {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * commit sha 的形状校验。承重：空串会让 `${sha}:${relPath}` 退化成 `:<path>`，
 * 那是「读 index 暂存区」的合法 rev 规格，会把索引内容冒充成基线内容。
 *
 * 40 位 = sha1 仓；64 位 = sha256 仓（`git init --object-format=sha256`，本机 git 2.53.0 实测
 * `rev-parse` 返回 64 位）。只认 40 位会让 sha256 仓上的 `--since` 永久不可用，
 * 且报错文案会误导用户以为 ref 写错了。
 */
export function isCommitShaShape(value) {
  return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value);
}

/**
 * 一次性枚举 `<resolvedSha>` 下 `plugins/spec-driver` 子树的全部条目，作为
 * 「该 ref 下这个文件到底存不存在」的**唯一**判定依据。
 *
 * ## 为什么不能用逐文件的存在性探针（本项最关键的结构性修正）
 *
 * 此前用 `rev-parse --verify --quiet <sha>:<path>` 做存在性探针。本机 git 2.53.0 实测：
 *
 * | 情形 | exit | stderr |
 * |------|------|--------|
 * | 路径在该 ref 下真的不存在 | 1 | 0 字节 |
 * | 基线对象库损坏（子树对象被删） | 1 | 0 字节 |
 *
 * 去掉 `--quiet` 两者都是 exit 128 + 同一句「需要一个单独的版本」。**退出码与 stderr 都不带
 * 区分度**，探针根本区分不了这两件事，「基线读不出来」被静默降级成「该 ref 下不存在」。
 *
 * 降级之后的 fail-open 方向是「替本次改动开脱」：`deriveDelta` 只在 `baselineStatus === 'match'`
 * 时才可能产出 `introduced`，而被强转成 missing 的基线在派生表里恒落进 `resolved` / `pre-existing`
 * （旧表）或 `added-since`（新表），永远出不了 `introduced`。实测端到端后果——删掉基线 commit 的
 * `scripts/lib` 子树对象后跑 `--since <baseline>`，一条本次改动引入的漂移被判 `pre-existing`，
 * 另有 7 个文件被凭空判 `resolved`，`exit=0` 且 stderr 空。
 *
 * 同一形态还有两条已实测的真实触发面：离线 partial clone（`--filter=tree:0` 且 promisor remote
 * 不可达）逐路径 exit 128；git 被信号杀死时 `status:null, signal:'SIGKILL', error:undefined`。
 *
 * ## `ls-tree` 为什么有区分度（本机实测）
 *
 * | 情形 | exit | stdout |
 * |------|------|--------|
 * | 健康仓 | 0 | 列全子树下所有条目 |
 * | 子树对象被删 | **1** | 部分输出 + stderr 报 `Could not read <tree>` |
 * | 路径在该 ref 下整体不存在 | 0 | 空 |
 *
 * 于是「不存在」只由这张清单判定（清单里没有 ⇒ 合法 missing），任何 git 层面的异常都在这里
 * fail-loud，逐文件阶段再没有任何机会把「读不出来」读成「不存在」。
 *
 * `-z` 用 NUL 分隔，路径含空格/引号/换行也安全（`-z` 下 git 不做 C-quoting）。
 * 输出形如 `<mode> SP <type> SP <object> TAB <path> NUL`，一次同时拿到 type 与 blob sha。
 *
 * @returns {{ ok: true, entries: Map<string, { type: string, objectSha: string }> } | { ok: false, error: string }}
 */
function listBaselineEntries(projectRoot, ref, resolvedSha) {
  // --full-tree：路径与 pathspec 都相对仓库根，与下面 `<rev>:<path>` 的根相对语义一致
  const listing = runGit(projectRoot, [
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    resolvedSha,
    '--',
    REPO_PLUGIN_POSIX_SUBDIR,
  ]);
  const failure = classifyGitResult(listing);
  if (failure) {
    return {
      ok: false,
      error:
        `--since 无法枚举 ${ref} 下的 ${REPO_PLUGIN_POSIX_SUBDIR} 子树` +
        `（${failure.kind}: ${failure.detail}）——基线对象不可读，拒绝在此基础上产出增量结论`,
    };
  }

  const entries = new Map();
  for (const record of listing.stdout.toString('utf8').split('\0')) {
    if (record === '') continue;
    const tabIndex = record.indexOf('\t');
    const meta = tabIndex < 0 ? [] : record.slice(0, tabIndex).split(' ');
    if (meta.length !== 3) {
      return { ok: false, error: `--since 无法解析 git ls-tree 的输出记录：${JSON.stringify(record)}` };
    }
    entries.set(record.slice(tabIndex + 1), { type: meta[1], objectSha: meta[2] });
  }
  return { ok: true, entries };
}

/**
 * `--since` 预检：一次性判定 (c) git 不可执行 / (a-1) 不在 git 仓库内 / (a-2) ref 无效，
 * 把 ref 解析成 commit sha，并枚举该 sha 下的基线子树清单。
 *
 * ref 有效性与基线可读性都只在这里判**一次**，逐文件阶段只用解析出的 sha 与清单。于是走到逐文件
 * 阶段时，「路径不存在」是那里唯一可能的负结果——「ref/对象不可读」与「文件在该 ref 下不存在」
 * 在代码结构上不可能落进同一分支，而不是靠开发者记得写 if 去区分（FR-015）。
 *
 * @returns {{ ok: true, resolvedSha: string, entries: Map<string, object> } | { ok: false, error: string }}
 */
function preflightGitBaseline(projectRoot, ref) {
  const repoProbe = runGit(projectRoot, ['rev-parse', '--git-dir']);
  const repoFailure = classifyGitResult(repoProbe);
  // 只有 exit 形态才允许被解读成「这里不是 git 仓库」；spawn/signal/no-status 是「git 没跑成」
  if (repoFailure && repoFailure.kind !== 'exit') return { ok: false, error: gitUnavailableError(repoFailure) };
  if (repoFailure) return { ok: false, error: `--since 无法执行：${projectRoot} 不在 git 仓库内` };

  // 基线路径 `<sha>:plugins/spec-driver/…` 相对**仓库根**解析，而当前侧读的是
  // `<projectRoot>/plugins/spec-driver/…`。projectRoot 若是仓库子目录，两侧读的是不同文件，
  // 基线就来自另一个目录——与 GIT_DIR 泄漏同型的 fail-open，故在此 fail-loud。
  const topProbe = runGit(projectRoot, ['rev-parse', '--show-toplevel']);
  const topFailure = classifyGitResult(topProbe);
  if (topFailure) return { ok: false, error: gitUnavailableError(topFailure) };
  const toplevel = topProbe.stdout.toString('utf8').trim();
  if (!sameDirectory(projectRoot, toplevel)) {
    return {
      ok: false,
      error: `--since 无法执行：${projectRoot} 不是 git 仓库根（仓库根为 ${toplevel}），基线与当前侧会读到不同目录`,
    };
  }

  // --end-of-options 防止形如 `--upload-pack=…` 的 ref 被 git 当成选项（本机 git 2.53.0 实测可用）
  const refProbe = runGit(projectRoot, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  const refFailure = classifyGitResult(refProbe);
  if (refFailure && refFailure.kind !== 'exit') return { ok: false, error: gitUnavailableError(refFailure) };
  if (refFailure) return { ok: false, error: `--since 无法执行：无效的 git ref「${ref}」` };

  const resolvedSha = refProbe.stdout.toString('utf8').trim();
  if (!isCommitShaShape(resolvedSha)) {
    return { ok: false, error: `--since 无法执行：无法把「${ref}」解析成 commit sha` };
  }

  const listing = listBaselineEntries(projectRoot, ref, resolvedSha);
  if (!listing.ok) return { ok: false, error: listing.error };
  return { ok: true, resolvedSha, entries: listing.entries };
}

/**
 * 取 `<resolvedSha>:<relPath>` 的内容摘要，形状与 io 层 computeSha256 的 DigestResult 一致，
 * 可直接喂给 core 的 compareFile。
 *
 * 「该 ref 下不存在」**只**由预检枚举出的清单判定（见 listBaselineEntries 的 JSDoc）；本函数里
 * 任何 git 层面的异常一律 fatal，不存在把异常读成 missing 的路径。
 *
 * @param {{ projectRoot: string, ref: string, entries: Map<string, object> }} baseline
 * @returns {{ ok: true, digest: object } | { ok: false, error: string }}
 */
function digestAtRef(baseline, relPath) {
  const { projectRoot, ref, entries } = baseline;
  const entry = entries.get(relPath);
  if (entry === undefined) {
    // 清单已成功列全 ⇒ 不在清单里就是确定性的「该 ref 下没有这个路径」（FR-015 的 (b) 正常态）
    return { ok: true, digest: { status: 'missing', sha256: null } };
  }
  if (entry.type !== 'blob') {
    // 子模块（`160000 commit`）等非普通文件条目。方向是 fail-loud，不静默当成「文件不存在」
    return {
      ok: false,
      error: `--since 无法读取 ${ref}:${relPath}：该路径在此 ref 下不是普通文件（type=${entry.type}）`,
    };
  }

  const content = runGit(projectRoot, ['cat-file', 'blob', entry.objectSha]);
  const failure = classifyGitResult(content);
  if (failure) {
    return {
      ok: false,
      error: `--since 无法读取 ${ref}:${relPath} 的内容（git 对象存在但不可读：${failure.kind}: ${failure.detail}）`,
    };
  }
  return { ok: true, digest: { status: 'ok', sha256: sha256OfBuffer(content.stdout) } };
}

/** 增量分类词表，顺序即汇总行的打印顺序 */
const DELTA_VOCABULARY = ['unchanged', 'introduced', 'added-since', 'resolved', 'pre-existing', 'indeterminate'];

/**
 * 由 baseline/current 两个 compareFile status + absentAtRef 派生 delta。
 *
 * ## 完整派生表（plan D4.1 已按此重画）
 *
 * `absentAtRef` 不是可有可无的旁注，而是**分类的一个维度**：文件在 `<ref>` 下根本不存在时，
 * 「这条漂移开工前就有」是不可能成立的命题——那时连文件都没有。FR-015(b) 原文即要求
 * 「`<ref>` 合法但目标文件在该 ref 下不存在 → 判定为该 ref 之后新增」，故独立成
 * `added-since` 一档，并进入汇总行。
 *
 * 记 M=match、X=mismatch、R=missingInRepo、S=missingInSnapshot、B=missingBoth、I=indeterminate。
 *
 * **absentAtRef = false**（该 ref 下文件存在）：
 *
 * | baseline \ current | M | X | R | S | B | I |
 * |---|---|---|---|---|---|---|
 * | M | unchanged | introduced | introduced | introduced | introduced | indeterminate |
 * | X | resolved | pre-existing | pre-existing | pre-existing | pre-existing | indeterminate |
 * | R † | resolved | pre-existing | pre-existing | pre-existing | pre-existing | indeterminate |
 * | S | resolved ‡ | pre-existing | pre-existing | pre-existing | pre-existing | indeterminate |
 * | B † | resolved | pre-existing | pre-existing | pre-existing | pre-existing | indeterminate |
 * | I | indeterminate | indeterminate | indeterminate | indeterminate | indeterminate | indeterminate |
 *
 * **absentAtRef = true**（该 ref 下文件不存在）：
 *
 * | baseline \ current | M | X | R | S | B | I |
 * |---|---|---|---|---|---|---|
 * | M † | added-since | added-since | added-since | added-since | unchanged | indeterminate |
 * | X † | added-since | added-since | added-since | added-since | unchanged | indeterminate |
 * | R | added-since | added-since | added-since | added-since | unchanged ★ | indeterminate |
 * | S † | added-since | added-since | added-since | added-since | unchanged | indeterminate |
 * | B | added-since | added-since | added-since | added-since | unchanged | indeterminate |
 * | I | indeterminate | indeterminate | indeterminate | indeterminate | indeterminate | indeterminate |
 *
 * †/★ = 不可达组合（函数仍是全函数，写出来只为让表完整、可被逐格测试钉住）：
 * - 预检之后 refDigest 只可能是 `ok` 或 `missing`（error 一律 fatal），故
 *   `absentAtRef ⟺ refDigest.status === 'missing'`；`R`/`B` 只在 absentAtRef=true 下出现，
 *   `M`/`X`/`S` 只在 absentAtRef=false 下出现。
 * - ★ `R × B`：R 意味着 snapshot 侧**有**该文件，B 意味着 snapshot 侧**没有**——两次比较用的是
 *   同一份 snapshot 摘要，故矛盾、不可达。
 *
 * ## 两处边界的归档裁决
 *
 * - **`absentAtRef && current === 'match'` → `added-since`**（不是 `resolved`）。
 *   `resolved` 断言的是「本次改动消除了一条既存漂移」，而该 ref 下压根没有这个文件，没有漂移可消除；
 *   说成 resolved 是给本次改动记一笔不存在的功劳。归 `added-since` 后，「当前已一致」这一事实由行内
 *   打印的 `当前 match` 如实承载——delta 列回答「相对 ref」，status 列回答「相对当前快照」。
 * - **`missingBoth × missingBoth` → `unchanged`**（不是 `added-since`）。
 *   三处（ref 侧 / 当前 repo / snapshot）都没有这个文件，什么都没被新增，说 `added-since` 是假话；
 *   相对 ref 的关系确实未变，故归 `unchanged`。注意此处 `unchanged` 的含义是
 *   「repo↔snapshot 的关系相对 ref 未变」，不是「两边都存在且一致」。
 *
 * `indeterminate` 优先于其余一切分支：把「读取失败」折叠进任何一档都是编数据，正是本项要防的病。
 *
 * @param {string} baselineStatus compareFile(refDigest, snapshotDigest).status
 * @param {string} currentStatus compareFile(repoDigest, snapshotDigest).status
 * @param {boolean} absentAtRef refDigest.status === 'missing'
 */
export function deriveDelta(baselineStatus, currentStatus, absentAtRef = false) {
  if (baselineStatus === 'indeterminate' || currentStatus === 'indeterminate') return 'indeterminate';
  if (absentAtRef) return currentStatus === 'missingBoth' ? 'unchanged' : 'added-since';
  if (baselineStatus === 'match') return currentStatus === 'match' ? 'unchanged' : 'introduced';
  return currentStatus === 'match' ? 'resolved' : 'pre-existing';
}

/**
 * 逐文件计算增量行。
 *
 * baseline 侧与主报告刻意共用**同一份当前生效快照**：它回答的是
 * 「这条漂移在 <ref> 时刻相对当前快照是否已经存在」，也就是「本次改动引入 vs 开工前就有」。
 *
 * @returns {{ ok: true, rows: object[] } | { ok: false, error: string }}
 */
function buildSinceRows(result, baseline) {
  const rows = [];
  for (const file of result.files) {
    const refDigest = digestAtRef(baseline, path.posix.join(REPO_PLUGIN_POSIX_SUBDIR, file.file));
    if (!refDigest.ok) return { ok: false, error: refDigest.error };
    // 快照侧摘要复用主报告那一次读到的字节（file.snapshotDigest），不对同一路径再读一遍：
    // 两次读之间插件被重装/更新，会让同一行的 baseline 与 current 基于不同字节算出（TOCTOU）。
    // compareFile 返回的是 { status, side?, errorCode? } 对象，不是裸字符串
    const { status: baselineStatus } = compareFile(refDigest.digest, file.snapshotDigest);
    const absentAtRef = refDigest.digest.status === 'missing';
    rows.push({
      file: file.file,
      delta: deriveDelta(baselineStatus, file.status, absentAtRef),
      baselineStatus,
      currentStatus: file.status,
      // 已进入分类（added-since）；此处保留为行内旁注，让「分类」与「原始事实」同时可见
      absentAtRef,
    });
  }
  return { ok: true, rows };
}

/**
 * 增量区块的人类可读格式（plan D4.6）。与 formatReport 完全解耦：
 * 不带 --since 时本函数根本不执行，逐字节向后兼容因此是结构事实而非测试兜底（SC-004）。
 */
function formatSinceSection(rows, ref, resolvedSha, status) {
  if (rows.length === 0) {
    return `增量视图（相对 ${ref}）：无文件明细可叠加（当前诊断状态为 ${status}，未进入逐文件比较阶段）`;
  }

  // 标签列宽 = 最长 delta 词长 + 包裹它的 `[]` 两个字符 + 1 个分隔空格
  const labelWidth = Math.max(...rows.map((r) => r.delta.length)) + '[]'.length + 1;
  const pathWidth = Math.max(...rows.map((r) => r.file.length));
  const lines = [`增量视图（相对 ${ref} → ${resolvedSha.slice(0, 12)}）：`];
  for (const row of rows) {
    const label = `[${row.delta}]`.padEnd(labelWidth);
    const absent = row.absentAtRef ? ', 该 ref 下不存在' : '';
    lines.push(`  ${label}${row.file.padEnd(pathWidth + 1)}(基线 ${row.baselineStatus} → 当前 ${row.currentStatus}${absent})`);
  }

  const counts = new Map();
  for (const row of rows) counts.set(row.delta, (counts.get(row.delta) || 0) + 1);
  const parts = DELTA_VOCABULARY.filter((d) => counts.has(d)).map((d) => `${counts.get(d)} ${d}`);
  lines.push('');
  lines.push(`增量汇总: ${parts.join(' / ')}`);
  return lines.join('\n');
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n`);
    process.exitCode = 1;
    return;
  }

  if (parsed.since === undefined) {
    const result = checkJudgeSnapshotDrift({ projectRoot: parsed.projectRoot });
    process.stdout.write(`${formatReport(result, parsed.projectRoot)}\n`);
    process.exitCode = 0;
    return;
  }

  // 环境类失败（git 不可用 / 不在仓库内 / ref 无效 / 对象不可读）一律 stderr + exit 1 且
  // stdout 完全为空——「环境不满足、诊断根本没跑成」与「跑成了、结论是 drift」是两回事。
  const preflight = preflightGitBaseline(parsed.projectRoot, parsed.since);
  if (!preflight.ok) {
    process.stderr.write(`${preflight.error}\n`);
    process.exitCode = 1;
    return;
  }

  const result = checkJudgeSnapshotDrift({ projectRoot: parsed.projectRoot });
  const sinceRows = buildSinceRows(result, {
    projectRoot: parsed.projectRoot,
    ref: parsed.since,
    entries: preflight.entries,
  });
  if (!sinceRows.ok) {
    process.stderr.write(`${sinceRows.error}\n`);
    process.exitCode = 1;
    return;
  }

  const report = formatReport(result, parsed.projectRoot);
  const section = formatSinceSection(sinceRows.rows, parsed.since, preflight.resolvedSha, result.status);
  process.stdout.write(`${report}\n${section}\n`);
  // 增量视图里有多少 introduced 都不改退出码：doctor 是诊断不是门禁（FR-016）
  process.exitCode = 0;
}

// 仅作为入口脚本直接运行时执行（被 import 时不触发，便于单测）
function isDirectExecution() {
  return process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
}

if (isDirectExecution()) {
  main(process.argv.slice(2));
}
