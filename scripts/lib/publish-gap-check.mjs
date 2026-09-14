import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
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
// `checkPublishGap()` 的返回值**只有 `{ checks, warnings }`，永远不含 `errors` 键**，且**不得抛出**：
// 消费方 `validate-release-contracts.mjs` 裸调本函数，抛出会直接崩掉 `prepublishOnly`（比"弄红"更糟）。
// 所有外部调用（npm / tar / git / JSON.parse）都必须落在 try 里并归到某个 `reason`（第三轮审查 INFO-4）。
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
// npm registry 不可达 / 返回体没有 `gitHead` 且 tarball 内读不到 build-meta / 锚点 commit 在本地仓不存在
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
// `gitHead` 缺席时的第二事实源：下载已发布 tarball 读 `dist/.spectra-build-meta.json`（F176 盖章，
// `prepublishOnly` 的 build 必经 postbuild-stamp）。registry 是否回传 gitHead 不由本仓控制：
// 实测 4.1.1 / 4.5.0 缺席，4.3.0 / 4.4.0 / 4.6.0 在——缺席时本判据整版 indeterminate（M10 §13.3 簇③）。
// 4.1.1 / 4.2.0 的 tarball 里也没有 build-meta（盖章自 4.3.0 起），那两版两条事实源都拿不到。
//
// 🔴 这条路径的输入（版本号）来自 registry 返回体，pack 的对象是外部 tarball：
//   - 版本号必须是**精确 semver**。`npm pack pkg@.` 会打包**当前目录**（对抗审查 C-1：本地未发布的
//     build-meta 被当成已发布锚点 ⇒ pass + 零 warning 的假绿），range / dist-tag（`4`、`latest`）会静默
//     重解析到别的版本（C-2 / I-3）。拿不到精确版本一律 indeterminate，**不回退 latest**。
//   - 包名同样过白名单：`-x` 这类以 `-` 开头的串会被 npm 当 flag 吃掉再回落到打包 cwd（W-4）。
//     白名单只为 argv 安全（首字符非 `-`），**不**强制小写：npm 老包名（`JSONStream` 一类）至今合法，
//     强制小写会让这类仓库整条判据永久 indeterminate（第二角审查 W-1）。
//   - pack 的 cwd 是**项目根**而不是空临时目录：项目级 `.npmrc` / `publishConfig` 决定 registry，
//     换到别的 cwd 会静默改用公网源——私有源仓库上要么 E404 假红、要么拉到公网同名包（第二角 W-4）。
//     `name@精确版本` 形态的 spec 永远走 registry 解析，不会打包 cwd（本仓根实测拉到的是 4.5.0 的
//     6d4e8188，而非本地 dist 的 commit）；产物用 `--pack-destination` 隔离到临时目录，并回验 name/version。
//   - 不相信 npm 报的 `filename`（npm 8 对 scoped 包报带 `/` 的串，第二角 W-5）：临时目录是本次专属且空的，
//     直接枚举其中**唯一**的 `.tgz`。
//   - `npm publish --dry-run` 会把 `npm_config_dry_run` 传给生命周期脚本，npm pack 在此环境下只报
//     filename 不落盘（W-2）——pack 的 env 显式剥掉它，并在 tar 前 existsSync。代价：`publish --dry-run`
//     在缺 gitHead 的版本上会真下载一次 tarball（本仓 3.1MB，冷缓存 ~9s）。
//   - tar 读不出来有三种病因（本机没有 tar / tar 超时 / 包损坏），它们都**不是**「这个版本发布于盖章之前」，
//     必须与「成员不存在」分开（第二角 W-2）：混在一起会让运维读到"无事可做"而判据静默哑火。
const NPM_PACK_TIMEOUT_MS = 30000;
const TAR_TIMEOUT_MS = 10000;
const BUILD_META_TARBALL_PATH = 'package/dist/.spectra-build-meta.json';
// 不放行 `+build`：npm 解析 spec 时会丢掉 build metadata，回验 version 必然不等（第二角 I-1）——与其报成
// 「拉取失败」不如在入口就判 published-version-unknown。prerelease 放行（`zod@4.5.0-canary.…` 实测原样回传）。
const EXACT_SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// 首字符禁 `-`：以 `-` 开头的串会被 npm 当 flag 吃掉（argv 安全优先）；大小写都放行（npm 老包名允许大写）
const NPM_PACKAGE_NAME_PATTERN = /^(?:@[A-Za-z0-9][A-Za-z0-9-._~]*\/)?[A-Za-z0-9][A-Za-z0-9-._~]*$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const NPM_ENV_KEYS_TO_STRIP = Object.freeze(['npm_config_dry_run', 'npm_config_tag']);

/** tarball 成功拉到且能解压，但里面没有 build-meta 成员——4.1.1/4.2.0 这类盖章前版本的形态。 */
export class BuildMetaMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BuildMetaMissingError';
    this.code = 'BUILD_META_MISSING';
  }
}

/** tarball 拉到了但读不出内容（本机没有 tar / tar 超时 / 包损坏）：不是"未盖章"，也不是"拉不到"。 */
export class TarballReadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TarballReadError';
    this.code = 'TARBALL_READ_FAILED';
  }
}

/** 传给 `npm pack` 的环境：剥掉会让 pack 不落盘或跨 tag 错配的继承配置。导出供单测钉住。 */
export function buildPackEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const key of NPM_ENV_KEYS_TO_STRIP) {
    delete env[key];
  }
  return env;
}

/**
 * 从本地 tarball 抽出 build-meta 原文。失败各自成类，调用方据此给出不同的 reason：
 * - tarball 文件本身不存在 → 普通 Error（归"拉取失败"）
 * - 0 字节文件（下载中断 / 磁盘满）→ `TarballReadError`：bsdtar 对空档案与「成员不存在」的 stderr 逐字相同
 *   （都是 `Not found in archive`），只看 stderr 会把它判成"该版本未盖章"（第三轮审查 WARNING-1），故先看文件大小
 * - tar 报「成员不存在」（bsdtar / GNU tar 都是 `Not found in archive`）→ `BuildMetaMissingError`
 * - 本机没有 tar（ENOENT）/ tar 被信号终止（超时 SIGKILL、maxBuffer 溢出 SIGTERM）/ 解压失败（包损坏、格式不识别）
 *   → `TarballReadError`（`execFileSync` 走 spawnSync，超时只体现在 `err.signal`，没有 `killed` 字段）
 * 导出供单测用本地 tgz 覆盖真实 tar 路径。
 * @returns {string}
 */
export function readBuildMetaFromTarball(tgzPath) {
  if (!existsSync(tgzPath)) {
    throw new Error(`tarball 未落盘: ${path.basename(tgzPath)}`);
  }
  if (statSync(tgzPath).size === 0) {
    throw new TarballReadError('tarball 是 0 字节文件（下载中断或磁盘满）');
  }
  try {
    return execFileSync('tar', ['-xOzf', tgzPath, BUILD_META_TARBALL_PATH], {
      timeout: TAR_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      encoding: 'utf-8',
      maxBuffer: MAX_SPAWN_BUFFER_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new TarballReadError('本机没有可执行的 tar');
    }
    if (err?.signal) {
      throw new TarballReadError(`tar 被 ${err.signal} 终止（超时或输出超过缓冲区）`);
    }
    if (/not found in archive/i.test(String(err?.stderr ?? ''))) {
      throw new BuildMetaMissingError(`tarball 内无 ${BUILD_META_TARBALL_PATH}`);
    }
    throw new TarballReadError('tar 解压失败（包损坏或格式不识别）');
  }
}
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

/**
 * 默认的 npm registry 查询实现。测试通过 `execNpmView` 参数整体替换，不打桩全局。
 * cwd 与 pack 一致钉在项目根：两条事实源必须由同一份项目级 `.npmrc` / `publishConfig` 决定 registry，
 * 否则 `--project-root` 与进程 cwd 不同时 view 打 A 源、pack 打 B 源（第三轮审查 WARNING-4）。
 */
function defaultExecNpmView(packageName, { projectRoot = process.cwd() } = {}) {
  return execFileSync('npm', ['view', packageName, '--json'], {
    cwd: projectRoot,
    timeout: NPM_VIEW_TIMEOUT_MS,
    encoding: 'utf-8',
    maxBuffer: MAX_SPAWN_BUFFER_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * 默认的 tarball build-meta 读取实现：以项目根为 cwd（吃项目级 `.npmrc` / `publishConfig` 的 registry）
 * 执行 `npm pack <pkg>@<精确版本> --pack-destination <本次专属空临时目录>`，回验返回的 name / version
 * 与请求一致，再从临时目录里枚举**唯一**的 `.tgz` 交给 `readBuildMetaFromTarball`。两步都走 `execFileSync`
 * （不经 shell）。调用方已把 name / version 过过白名单，这里再守一次（防被绕过后直接调用）。临时目录无论成败都清理。
 * 导出供单测用 PATH 上的 npm shim 离线覆盖这条生产路径（第二角 W-3：此前 40 例单测一律注入替身，本函数从未被执行）。
 * @returns {string} build-meta 文件原文；抛 `BuildMetaMissingError` = 有包无 meta，`TarballReadError` = 包在但读不出，
 *          其余抛错 = 拉取失败
 */
export function defaultExecNpmPackMeta(packageName, publishedVersion, { projectRoot = process.cwd() } = {}) {
  if (!NPM_PACKAGE_NAME_PATTERN.test(String(packageName)) || !EXACT_SEMVER_PATTERN.test(String(publishedVersion))) {
    throw new Error('拒绝 pack：包名或版本不合法（须精确 semver）');
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'spectra-publish-gap-'));
  try {
    const packed = execFileSync('npm', ['pack', `${packageName}@${publishedVersion}`, '--pack-destination', dir, '--json'], {
      cwd: projectRoot,
      env: buildPackEnv(),
      timeout: NPM_PACK_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      encoding: 'utf-8',
      maxBuffer: MAX_SPAWN_BUFFER_BYTES,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const info = JSON.parse(packed)?.[0];
    if (info?.name !== packageName || info?.version !== publishedVersion) {
      throw new Error('npm pack 返回的包名 / 版本与请求不一致，拒绝采信');
    }
    const tarballs = readdirSync(dir).filter((name) => name.endsWith('.tgz'));
    if (tarballs.length !== 1) {
      throw new Error(`npm pack 未在目标目录留下唯一的 tarball（实际 ${tarballs.length} 个）`);
    }
    return readBuildMetaFromTarball(path.join(dir, tarballs[0]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
 * @returns {{source: 'env-override'|'npm-view'|'tarball-build-meta', ref: string, publishedVersion: string|null, buildDirty?: boolean}
 *          | {source: 'env-override'|'npm-view'|'tarball-build-meta', ref: null, reason: string, publishedVersion: string|null}}
 */
function resolvePublishedRef({ publishedRefOverride, execNpmView, execNpmPackMeta, packageName, projectRoot }) {
  if (typeof publishedRefOverride === 'string' && publishedRefOverride.trim() !== '') {
    return { source: 'env-override', ref: publishedRefOverride.trim(), publishedVersion: null };
  }

  // 「读不到 name」与「读到了但不是合法包名」是两种病因，排查方向不同（第二角 W-1：此前混用一条文案）
  if (packageName === null) {
    return { source: 'npm-view', ref: null, reason: 'package-name-unreadable', publishedVersion: null };
  }
  if (!NPM_PACKAGE_NAME_PATTERN.test(packageName)) {
    return { source: 'npm-view', ref: null, reason: 'package-name-invalid', publishedVersion: null };
  }

  let raw;
  try {
    raw = execNpmView(packageName, { projectRoot });
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
  // gitHead 与 tarball 侧同一严格度：只认 40 位 commit sha。代理型 registry 可能把它改写成 `HEAD` / 分支名，
  // 那种串本地恰好可解析就会得到 N=0 的零 warning 假绿（第二角 I-3）；不是 sha 就当缺席，走 tarball 路径。
  const gitHead = typeof parsed.gitHead === 'string' ? parsed.gitHead.trim().toLowerCase() : '';
  if (COMMIT_SHA_PATTERN.test(gitHead)) {
    return { source: 'npm-view', ref: gitHead, publishedVersion };
  }
  // registry 缺 gitHead（或其值不是 commit sha）：退到 tarball 内的 build-meta（第二事实源）。没有精确版本号
  // 就没有可采信的 pack 目标——不回退 latest（fail-closed）。
  if (typeof publishedVersion !== 'string' || !EXACT_SEMVER_PATTERN.test(publishedVersion)) {
    return { source: 'tarball-build-meta', ref: null, reason: 'published-version-unknown', publishedVersion };
  }
  let metaRaw;
  try {
    metaRaw = execNpmPackMeta(packageName, publishedVersion, { projectRoot });
  } catch (err) {
    const reason = err?.code === 'BUILD_META_MISSING' ? 'missing-build-meta'
      : err?.code === 'TARBALL_READ_FAILED' ? 'tarball-read-failed'
        : 'tarball-fetch-failed';
    return { source: 'tarball-build-meta', ref: null, reason, publishedVersion };
  }
  let meta;
  try {
    meta = JSON.parse(String(metaRaw));
  } catch {
    // 成员在但不是 JSON：重复成员被 `tar -xO` 拼接、篡改或损坏——不是"该版本未盖章"（第三轮审查 WARNING-1）
    return { source: 'tarball-build-meta', ref: null, reason: 'tarball-read-failed', publishedVersion };
  }
  const commit = typeof meta?.commit === 'string' ? meta.commit.trim().toLowerCase() : '';
  if (!COMMIT_SHA_PATTERN.test(commit)) {
    return { source: 'tarball-build-meta', ref: null, reason: 'missing-build-meta', publishedVersion };
  }
  // dirty 看全树（再生 doc 脏也算），sourceDirty 只看 build 输入：锚点能否复现 dist 取决于后者（F176 盖章注释）
  return { source: 'tarball-build-meta', ref: commit, publishedVersion, buildDirty: meta.sourceDirty === true };
}

/**
 * 每种 indeterminate 病因一句**各自**的文案（W-2 / W-8）。
 *
 * 🔴 `fetch-depth: 0` 的提示只挂在两种「锚点 commit 本地不可达」病因上（registry gitHead 与 tarball build-meta
 * 记录的都是仓库里的普通 commit，浅克隆下同样不可达，解药相同——第二角审查 C-1 用 `--depth 1` 克隆 +
 * `git fetch --unshallow` 端到端证实；此前把 tarball 一侧写成"fetch-depth 对这类根因无效"是**假的排除断言**）。
 * 挂在别的病因上会把排查方向钉死在错误的地方。
 */
const INDETERMINATE_REASON_TEXT = Object.freeze({
  network: 'npm registry 不可达或查询超时',
  'package-not-found': 'npm registry 上没有这个包（E404）——它可能尚未首次发布，或包名已变更',
  'package-name-unreadable': '读不到 package.json 的 name 字段，无从确定该查询哪个包',
  'package-name-invalid': 'package.json 的 name 不是合法的 npm 包名（以 - 开头、含空白或非法字符），拒绝把它交给 npm 命令行',
  'published-version-unknown': 'npm registry 返回体缺 gitHead 字段（或其值不是 40 位 commit sha），且 version 字段缺失或不是精确 semver（含 +build 形态），没有可采信的 tarball 可拉（不回退 latest）',
  'tarball-fetch-failed': 'npm registry 返回体缺 gitHead 字段（或其值不是 40 位 commit sha），且拉取已发布 tarball 失败（npm pack 不可用 / 网络超时 / 返回的包名版本与请求不一致 / dry-run 环境下未落盘）',
  'tarball-read-failed': 'npm registry 返回体缺 gitHead 字段（或其值不是 40 位 commit sha），tarball 已拉到但读不出内容（本机没有 tar / tar 超时 / 0 字节或损坏的包 / build-meta 不是 JSON）——这不是"该版本未盖章"，请先检查本机 tar 与下载完整性',
  'missing-build-meta': 'npm registry 返回体缺 gitHead 字段（或其值不是 40 位 commit sha），tarball 已拉到但其中没有可用的 dist/.spectra-build-meta.json（缺文件——4.1.1/4.2.0 这类盖章前的版本——或 commit 非 40 位 hex）',
  'unreachable-commit-tarball': '已发布 tarball 的 build-meta 记录的 commit 在本地仓库不可达——最常见原因与 registry 锚点相同：浅克隆（CI 需 fetch-depth: 0，本地可 git fetch --unshallow）；若已是全历史，再考虑历史被改写、从未 push 的本地构建发布、或 build-meta 来自别的仓库',
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
 * @param {(packageName: string, ctx: { projectRoot: string }) => string} [options.execNpmView] `npm view` 实现（依赖注入，便于离线单测）
 * @param {(args: string[], projectRoot: string) => string} [options.execGit] git 实现（依赖注入）
 * @param {(packageName: string, publishedVersion: string|null, ctx: { projectRoot: string }) => string} [options.execNpmPackMeta] gitHead 缺席时读 tarball build-meta 的实现（依赖注入，便于离线单测）
 * @returns {{checks: Array<object>, warnings: string[]}} **不含 `errors` 键**（结构性不变量）
 */
export function checkPublishGap(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const publishedRefOverride = options.publishedRefOverride ?? process.env.SPECTRA_PUBLISHED_REF;
  const execNpmView = options.execNpmView ?? defaultExecNpmView;
  const execGit = options.execGit ?? defaultExecGit;
  const execNpmPackMeta = options.execNpmPackMeta ?? defaultExecNpmPackMeta;

  const checks = [];
  const warnings = [];

  const resolution = resolvePublishedRef({
    publishedRefOverride,
    execNpmView,
    execNpmPackMeta,
    packageName: readPackageName(projectRoot),
    projectRoot,
  });

  // 🔴 C-4：注入路径**无条件**留痕，且早于任何 return 分支——注入值造出的"绿"
  // 与真实事实源得到的绿，在人可读输出里必须能一眼分开。
  if (resolution.source === 'env-override') {
    warnings.push(OVERRIDE_WARNING);
  }
  if (resolution.buildDirty === true) {
    warnings.push('已发布 tarball 的 build-meta 标记 sourceDirty:true——构建输入相对锚点 commit 有未提交改动，dist 不可由该 commit 复现，领先量只描述已提交部分。');
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
    // 两种锚点在浅克隆下同样不可达，处方相同；分成两个 reason 只为让 evidence 说清锚点来自哪条事实源
    return indeterminate(resolution.source === 'tarball-build-meta' ? 'unreachable-commit-tarball' : 'unreachable-commit');
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
