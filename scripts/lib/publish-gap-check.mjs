import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// Feature 265（G0-2，FR-010 ~ FR-013）— 发布断层预警判据。
//
// 背景：4.4.0 发布之后，仓库累积了 18 个改动 `src/` 的 commit 却从未再发布过 npm 包
// （M10 SSoT §0）。这个断层在整条治理链上是隐身的——没有任何门禁会提到它。本模块把
// "HEAD 领先已发布版本多少个 src commit"变成 `release:check` 的一条**非阻断 warning**。
//
// ## 结构性不变量（架构决策 A，勿删）
//
// `checkPublishGap()` 的返回值**只有 `{ checks, warnings }`，永远不含 `errors` 键**。
// 调用方 `validate-release-contracts.mjs` 的 `payload.status` 只由 `payload.errors.length`
// 决定，本模块的输出从不进入那个数组的构造表达式——因此本判据在结构上不可能把
// `release:check` 弄红。这一点很重要：`prepublishOnly` 串着 `release:check`，判据一旦能
// 变红，发布路径就被自己堵死了（正是本卡要解决的问题的反面）。
// `tests/unit/publish-gap-check.test.ts` 有一条断言锁死这个不变量。
//
// ## 量测面只有 `src/`（对抗审查 C-2，如实登记的口径边界）
//
// npm tarball 的 `files` 有多个 path root，纯 `plugins/` 的断层本判据**看不见**。
// 「只量 src」是卡面（G0-2 / spec / 变异测试）锚定的度量语义，扩大量测面等于改口径，
// 需另行拍板；在那之前，warning 文案与 evidence 都必须把这条边界写在明面上，
// 而不是让读者以为 N=0 就是"全仓没有未发布改动"。
//
// ## 事实源不可达时必须**可见**（F258 教训：新门禁自己 fail-open 是本仓反复出现的缺陷）
//
// npm registry 不可达 / 返回体没有 `gitHead` / `gitHead` 对应的 commit 在本地仓不存在
// （CI 浅克隆是常态）/ git 本身不可用 / 量测路径在 HEAD 上不存在 / 计数读不出来，
// 这些情形一律输出 `sourceStatus: 'indeterminate'` 并进 warnings，**不静默跳过**——
// 否则判据会退化成"永远不报"，跟没有一样。每种病因有各自的 `reason` 枚举与文案：
// 用同一句话覆盖多种病因，会把读者钉在错误的排查方向上（对抗审查 W-2 / W-8）。
//
// 🔴 reason 只输出**枚举值**，不输出 git / npm 的 stderr 原文：stderr 会带上 ref 原串，
// 与 doctor 侧（F240 A4③）的脱敏口径直接冲突。
//
// ## `SPECTRA_PUBLISHED_REF`
//
// 测试注入入口，**不是**面向用户的生产配置：只在这里读，不写进 README / CHANGELOG，
// CI workflow 也不设置它（CI 必须走真实 `npm view` 路径，否则"离线降级"分支得不到回归覆盖）。
//
// 🔴 存在性检查**挡不住**误用（对抗审查 C-4，此前这里写的"误用收口"是不实陈述）：
// 它只能挡掉指向本地不存在的 commit 的注入值；`SPECTRA_PUBLISHED_REF=HEAD` 这类
// 完全合法的本地 ref 会得到 `N=0 → pass`，人可读输出里此前零痕迹。因此凡走注入路径，
// 一律**无条件**追加一条 override 提示 warning（与领先量 warning 是两条不同的串），
// 让"这个绿是注入出来的"这件事在输出里必然可见。
//
// ## 脱敏
//
// warning 文案只含领先量 N 与已发布**版本号**，不含 commit 原串——与 doctor 侧
// （F240 A4③）的脱敏口径一致。

const NPM_VIEW_TIMEOUT_MS = 5000;
const GAP_WARNING_THRESHOLD = 5;

// I-4（对抗审查）：显式设 maxBuffer。Node 默认 stdout 上限仅 1MB，超限会抛 ENOBUFS——
// 那会被本模块的 catch 归成"事实源不可达"，把一个缓冲区问题说成网络问题。
// 量级跟随 `scripts/lib/graph-quality-core.mjs` 的 FIX-2 先例。
const MAX_SPAWN_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * 量测面（C-2）：只统计这些路径下的 commit。
 * 改这个常量等于改判据口径，必须与 spec / 变异测试 / warning 文案同步。
 */
const MEASURED_PATHS = Object.freeze(['src']);
/** 传给 `git rev-list -- <pathspec>` 的形态，同时也是 evidence 里对外声明的量测面 */
const PATHSPEC_ARGS = Object.freeze(MEASURED_PATHS.map((p) => `${p}/`));
const PATHSPEC_TEXT = PATHSPEC_ARGS.join(' / ');

/** 注入 ref 时无条件追加的提示串（与领先量 warning 刻意不共享任何前缀） */
const OVERRIDE_WARNING =
  '本次判定使用注入 ref（SPECTRA_PUBLISHED_REF），非 npm registry 事实源，结论不代表真实发布状态。';

function createCheck(id, title, status, evidence = {}) {
  return { id, title, status, evidence };
}

/** 默认的 npm registry 查询实现。测试通过 `execNpmView` 参数整体替换，不打桩全局。 */
function defaultExecNpmView(packageName) {
  return execFileSync('npm', ['view', packageName, '--json'], {
    timeout: NPM_VIEW_TIMEOUT_MS,
    encoding: 'utf-8',
    maxBuffer: MAX_SPAWN_BUFFER_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** 默认的本地 git 调用实现。`execFileSync` 不经 shell，避免命令注入面。 */
function defaultExecGit(args, projectRoot) {
  return execFileSync('git', ['-C', projectRoot, ...args], {
    encoding: 'utf-8',
    maxBuffer: MAX_SPAWN_BUFFER_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * 从 `package.json` 读包名（W-3：此前硬编码 `spectra-cli`，改名后判据会静默查错包）。
 * @returns {string|null} 读不到 / 不是非空字符串 → `null`（调用方落 indeterminate，不猜）
 */
function readPackageName(projectRoot) {
  try {
    const parsed = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
    const name = parsed?.name;
    return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * `npm view` 失败时区分"包不存在"与"网络类失败"。
 *
 * `npm view <pkg> --json` 在 E404 下**仍然把 JSON 写到 stdout** 并以非零码退出，
 * 于是 `err.stdout` 里能拿到 `{"error":{"code":"E404"}}`。不解析它就会把"这个包还没
 * 首次发布"说成"registry 不可达"——两者的下一步动作完全不同。
 * @returns {'package-not-found'|'network'}
 */
function classifyNpmViewFailure(err) {
  try {
    const parsed = JSON.parse(String(err?.stdout ?? ''));
    return parsed?.error?.code === 'E404' ? 'package-not-found' : 'network';
  } catch {
    return 'network';
  }
}

/**
 * 解析"已发布版本对应哪个 commit"。
 * @returns {{source: 'env-override'|'npm-view', ref: string, publishedVersion: string|null}
 *          | {source: 'env-override'|'npm-view', ref: null, reason: string, publishedVersion: string|null}}
 */
function resolvePublishedRef({ publishedRefOverride, execNpmView, packageName }) {
  if (typeof publishedRefOverride === 'string' && publishedRefOverride.trim() !== '') {
    return { source: 'env-override', ref: publishedRefOverride.trim(), publishedVersion: null };
  }

  if (packageName === null) {
    return {
      source: 'npm-view',
      ref: null,
      reason: 'package-name-unreadable',
      publishedVersion: null,
    };
  }

  let raw;
  try {
    raw = execNpmView(packageName);
  } catch (err) {
    return {
      source: 'npm-view',
      ref: null,
      reason: classifyNpmViewFailure(err),
      publishedVersion: null,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { source: 'npm-view', ref: null, reason: 'malformed-response', publishedVersion: null };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { source: 'npm-view', ref: null, reason: 'malformed-response', publishedVersion: null };
  }

  const publishedVersion = typeof parsed.version === 'string' ? parsed.version : null;
  const gitHead = typeof parsed.gitHead === 'string' ? parsed.gitHead.trim() : '';
  if (gitHead === '') {
    return { source: 'npm-view', ref: null, reason: 'missing-git-head', publishedVersion };
  }
  return { source: 'npm-view', ref: gitHead, publishedVersion };
}

/**
 * 每种 indeterminate 病因一句**各自**的文案（W-2 / W-8）。
 *
 * 🔴 `fetch-depth: 0` 的提示只挂在 `unreachable-commit` 上：它是那一种病因的解药，
 * 挂在别的病因上会把排查方向钉死在错误的地方。
 */
const INDETERMINATE_REASON_TEXT = Object.freeze({
  network: 'npm registry 不可达或查询超时',
  'package-not-found': 'npm registry 上没有这个包（E404）——它可能尚未首次发布，或包名已变更',
  'package-name-unreadable': '读不到 package.json 的 name 字段，无从确定该查询哪个包',
  'missing-git-head': 'npm registry 返回体缺 gitHead 字段',
  'malformed-response': 'npm registry 返回体不是可解析的 JSON 对象',
  'git-unavailable': 'git 不可用，或当前目录不是 git 工作区',
  'pathspec-empty': `HEAD 上不存在量测路径 ${PATHSPEC_TEXT}——判据数的就是该路径下的 commit，路径不存在时"计数 0"与"真的没有断层"不可区分`,
  'unreachable-commit':
    '已发布版本对应的 commit 在本地仓库不可达（CI 浅克隆时属常态，需 fetch-depth: 0）',
  'revlist-failed': 'git rev-list 执行失败，领先量无从计算',
  'count-unparseable': 'git rev-list 的输出不是非负整数，计数不可信',
});

/**
 * 计算 HEAD 相对已发布版本的 src commit 领先量，产出非阻断 warning。
 *
 * @param {object} [options]
 * @param {string} [options.projectRoot] 仓库根，默认 `process.cwd()`
 * @param {string} [options.publishedRefOverride] 已发布 ref 覆盖入口，默认读 `SPECTRA_PUBLISHED_REF`
 * @param {(packageName: string) => string} [options.execNpmView] `npm view` 实现（依赖注入，便于离线单测）
 * @param {(args: string[], projectRoot: string) => string} [options.execGit] git 实现（依赖注入）
 * @returns {{checks: Array<object>, warnings: string[]}} **不含 `errors` 键**（结构性不变量）
 */
export function checkPublishGap(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const publishedRefOverride = options.publishedRefOverride ?? process.env.SPECTRA_PUBLISHED_REF;
  const execNpmView = options.execNpmView ?? defaultExecNpmView;
  const execGit = options.execGit ?? defaultExecGit;

  const checks = [];
  const warnings = [];

  const resolution = resolvePublishedRef({
    publishedRefOverride,
    execNpmView,
    packageName: readPackageName(projectRoot),
  });

  // 🔴 C-4：注入路径**无条件**留痕，且早于任何 return 分支——注入值造出的"绿"
  // 与真实事实源得到的绿，在人可读输出里必须能一眼分开。
  if (resolution.source === 'env-override') {
    warnings.push(OVERRIDE_WARNING);
  }

  const baseEvidence = {
    refSource: resolution.source,
    publishedVersion: resolution.publishedVersion ?? null,
    pathspec: [...PATHSPEC_ARGS],
  };

  const indeterminate = (reason) => {
    const text = INDETERMINATE_REASON_TEXT[reason] ?? reason;
    checks.push(
      createCheck('gap', '发布断层领先量可判定', 'warn', {
        sourceStatus: 'indeterminate',
        reason,
        ...baseEvidence,
      }),
    );
    warnings.push(`发布断层领先量无法判定（sourceStatus: indeterminate）——${text}。`);
    return { checks, warnings };
  };

  if (resolution.ref === null) {
    return indeterminate(resolution.reason);
  }

  // git 本身可用吗（C-3 的前置）：不可用 / 不在 git 工作区时，下面每一条 git 调用都会失败，
  // 但失败原因是"没有 git"而不是"路径不存在"或"commit 不可达"，必须分开说。
  try {
    execGit(['rev-parse', '--git-dir'], projectRoot);
  } catch {
    return indeterminate('git-unavailable');
  }

  // 🔴 C-3：pathspec 匹配不到任何东西时 `rev-list --count` 恒为 0，与"真的没有断层"
  // 逐字符相同。src 改名 / `--project-root` 指错地方都会命中这一支，先验证量测路径在
  // HEAD 上确实存在，再去数。
  for (const measured of MEASURED_PATHS) {
    try {
      execGit(['cat-file', '-e', `HEAD:${measured}`], projectRoot);
    } catch {
      return indeterminate('pathspec-empty');
    }
  }

  // 事实源拿到了，但它必须在本地仓可达才能算领先量。
  try {
    execGit(['cat-file', '-e', `${resolution.ref}^{commit}`], projectRoot);
  } catch {
    return indeterminate('unreachable-commit');
  }

  let count;
  try {
    // 🔴 `--full-history`（C-1）：默认的 history simplification 会在合并场景下裁掉
    // "对最终结果无贡献"的一侧（`-s ours` 合并即是），把真实存在的 src 改动数说成 0。
    // 线性历史下该 flag 不改变结果（本仓实测仍为 18），但它移除的是一整类假 pass。
    const stdout = execGit(
      ['rev-list', '--full-history', '--count', `${resolution.ref}..HEAD`, '--', ...PATHSPEC_ARGS],
      projectRoot,
    );
    count = Number.parseInt(String(stdout).trim(), 10);
  } catch {
    return indeterminate('revlist-failed');
  }

  if (!Number.isInteger(count) || count < 0) {
    return indeterminate('count-unparseable');
  }

  const evidence = {
    sourceStatus: 'ok',
    publishedCommitStatus: 'resolved',
    ...baseEvidence,
    srcCommitsAhead: count,
    threshold: GAP_WARNING_THRESHOLD,
  };

  if (count >= GAP_WARNING_THRESHOLD) {
    const versionText = resolution.publishedVersion ? ` ${resolution.publishedVersion}` : '';
    checks.push(createCheck('gap', '发布断层领先量超阈值', 'warn', evidence));
    warnings.push(
      `HEAD 领先已发布版本${versionText} ${count} 个 src commit（阈值 ${GAP_WARNING_THRESHOLD}；` +
        `量测面仅 ${PATHSPEC_TEXT}，不含 plugins/ 等其它发布路径）——` +
        '这些代码改动对 npm 用户尚不存在，考虑发布一个新版本。本提示不阻断任何流程。',
    );
    return { checks, warnings };
  }

  checks.push(createCheck('gap', '发布断层领先量在阈值内', 'pass', evidence));
  return { checks, warnings };
}
