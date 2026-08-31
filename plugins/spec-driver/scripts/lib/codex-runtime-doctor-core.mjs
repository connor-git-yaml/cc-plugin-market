/**
 * codex-runtime-doctor-core.mjs
 * Feature 240 / A4-2 — 四方一致性诊断：纯函数层（零 I/O、零依赖）
 *
 * 职责：常量与受限类型词汇表、`sanitizeDetails` / `createCheck` / `buildSummary` /
 * `buildRemediation` 构造漏斗、`normalizeVersion`、`aggregateOverallStatus`、
 * `classifyHookTrust`、文本渲染。全部输入必须已被 io 层归约为受限类型。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 为什么**不**复用 `src/core/secret-redactor.ts`（FR-012.1 / plan §8.7）
 *
 * 那个模块是「正则模式 + Shannon 熵」的**内容启发式黑名单** —— 它先假定凭据长什么样，
 * 再把长得像的过滤掉。F228 已实测：内容猜测必被改写绕过（换个编码、拆个串就穿）。
 * 本模块走的是**结构性边界**：报告里每个字段先有一个受约束类型，值不满足类型就丢弃，
 * 于是凭据在结构上**没有可承载的字段**，与它长什么样无关。
 * 二者不可混用；此外 secret-redactor 属 npm `spectra` 包（需 build 产出 dist），
 * 而本模块从 plugin cache 直接 `node` 执行，包边界也不允许跨。
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 运行相关测试：
 *   npx vitest run tests/unit/codex-runtime-doctor.test.ts
 *   npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts
 */

export const SCHEMA_VERSION = 1;

export const OVERALL_STATUSES = Object.freeze(['ok', 'warning', 'fail']);

export const CHECK_STATUSES = Object.freeze(['ok', 'warning', 'fail', 'indeterminate', 'not-applicable']);

export const CHECK_CATEGORIES = Object.freeze([
  'repo-version',
  'global-cli',
  'plugin-build',
  'mcp-server',
  'hook-trust',
]);

export const PRODUCTS = Object.freeze(['spectra', 'spec-driver']);

/**
 * 🔴 `marketplace.metadata.version` 是 marketplace 自身版本，**不是**产品版本。
 * 以命名常量承载「显式排除」这一决定，并由 SC-012 单测断言它从不参与比较。
 */
export const EXCLUDED_VERSION_PATHS = Object.freeze(['marketplace.metadata.version']);

/** 产品 → release contract 中的版本字段路径（比较域的唯一来源） */
export const PRODUCT_VERSION_PATHS = Object.freeze({
  spectra: 'products.spectra.version',
  'spec-driver': 'products.spec-driver.version',
});

/**
 * plugin-build 一方的**可枚举排查点清单**（plan §4 消解 #3 强标准）。
 * 落 `indeterminate` 的唯一合法路径是这 5 项全部执行且全部非 `found`；
 * 任一探查抛错记 `error`（仍算已执行），但不得因此跳过其余探查。
 */
export const PLUGIN_BUILD_PROBES = Object.freeze([
  'codex-plugin-manifest',
  'codex-cli-help',
  'codex-doctor-checks',
  'codex-home-paths',
  'app-server-rpc',
]);

/**
 * hook 信任状态的探查点（FR-009）。
 *
 * 🔴 `config-toml-readable` 与 `config-toml-hooks-state` 是**两个**探查点，不是一个：
 * 前者只回答「config.toml 这个文件读到了吗」，后者只回答「`hooks.state` 段在不在」。
 * 二者曾由同一条 id 为 `...hooks-state` 的记录兼表，导致「文件读到了但全文无 hooks 段」
 * 被输出成 `{id:'config-toml-hooks-state', outcome:'found'}` —— 判定结论虽仍由
 * `stateSection` 正确驱动，但读报告的人会把它读成「找到了 hooks.state 段」。
 * 一条 id 已经承诺了语义，其 outcome 就必须描述它承诺的那件事（W2 同源要求）。
 */
export const HOOK_TRUST_PROBES = Object.freeze([
  'app-server-hooks-list',
  'codex-home-hooks-json',
  'config-toml-readable',
  'config-toml-hooks-state',
  // F275 对抗审查后新增（B2）：`$CODEX_HOME/plugins/cache/*/spec-driver` 目录存在性，
  // 纯文件读，用作 `app-server-hooks-list` 探测失败时的 tie-break 证据
  'codex-home-plugin-cache',
]);

/**
 * 探查点结局。
 *
 * 🔴 `absent` 与 `not-probed` 的边界是本枚举的核心不变量：`absent` 只能表示
 * **真探测过、且确定那里没有**；凡是「这条路径根本没走」（例如只跑了 `--help`
 * 却没有真的向 app-server 要 plugin 清单）一律记 `not-probed`。二者混用会把
 * 「没查」伪装成「查过了没有」，正是 W2 指出的伪确定性来源。
 */
export const PROBE_OUTCOMES = Object.freeze(['found', 'absent', 'error', 'not-executable', 'not-probed']);

export const ERROR_CLASSES = Object.freeze([
  'ENOENT',
  'ETIMEDOUT',
  'EACCES',
  'non-zero-exit',
  'parse-failed',
  'rpc-error',
  // 版本行整行语法校验未通过（含「输出里恰好含仓库同款 semver 的垃圾文本」）
  'version-parse-failed',
  // 候选快照存在但 manifest 未能读出版本 ⇒ 该来源结论必须歧义化
  'snapshot-unreadable',
  // 同版本多候选：版本可比较，但没有任何事实依据指认哪个快照是 active
  'multiple-snapshots',
  'unknown',
]);

/** CLI 顶层参数错误的固定原因枚举（不回显 argv 值本身，FR-012） */
export const CLI_ARG_ERRORS = Object.freeze(['missing-project-root', 'invalid-format', 'unknown-argument']);

export const REMEDIATION_CODES = Object.freeze([
  'upgrade-global-cli',
  'reinstall-plugin',
  'reload-mcp-client',
  'grant-hook-trust',
  'manual-investigate',
]);

/**
 * 版本字符串的形态。
 *
 * 🔴 W1 修复后**移除**了 `unprintable`：它曾表示「首行含受限语法之外的内容」，
 * 与 `unparseable` 的区别只在于「我们当时还打算把原文印出来」。既然报告里已经
 * 没有任何字段承载原文（C1），这个区分就没有消费者了，留着只会让人以为
 * 存在第三种、其实永远取不到的形态。
 */
export const RAW_SHAPES = Object.freeze(['bare-semver', 'decorated-semver', 'unparseable', 'absent']);

/**
 * commit 比对的**派生**结论（F265 G0-3 / FR-014、FR-015）。
 *
 * 🔴 这四个字面量是 commit 维度对外的**唯一**出口。C1 裁决（F236/F240）不可回退：
 * commit 后缀在语法上与一个 32/40 位十六进制凭据完全同构，语法证明不了那串东西
 * 不是密钥。因此报告 schema 里没有任何字段能承载 commit 原串，比对只在读取函数的
 * 局部作用域内发生，跨出去的只有这里的四个枚举值之一。
 *
 * - `match` / `mismatch`：两方都读到了 commit，按较短一方的长度取前缀比较后相同 / 不同
 * - `absent`：至少一方没有 commit 信息（该方不携带 commit，或本地基准不可读）
 * - `unreadable`：读到了东西，但形态不是 commit（长度不足 7 位 / 非十六进制）
 */
export const COMMIT_COMPARISONS = Object.freeze(['match', 'mismatch', 'absent', 'unreadable']);

export const TRUST_STATUSES = Object.freeze([
  'trusted',
  'untrusted',
  'modified',
  'indeterminate',
  'not-applicable',
]);

/** 路径型字段无法相对化到任一已知根时的固定枚举值（不输出原路径） */
export const OUTSIDE_KNOWN_ROOTS = 'outside-known-roots';

// ─────────────────────────────────────────────────────────────────────────────
// (1) 受限类型词汇表
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 枚举字段的值域表（键名 → 闭合字面量集合）。
 * 之所以按**键名**而不是按 category 组织：同名键在不同 category 下语义一致，
 * 分散定义只会制造两份可能漂移的事实源。
 */
const ENUM_DOMAINS = Object.freeze({
  versionField: Object.freeze(Object.values(PRODUCT_VERSION_PATHS)),
  rawShape: RAW_SHAPES,
  errorClass: ERROR_CLASSES,
  binaryName: Object.freeze(['spectra']),
  // F240 时期只有 `none-available`（MCP 侧确无自省通道）。F265 落地 `server_build_info`
  // 后该值**已无产出路径**——报告里再出现它就是在陈述一个不再成立的事实，故整体替换为
  // 实际使用的探测方法名。自省失败不退回 `none-available`：那会把「问了但没问到」
  // 说成「压根没有可问的通道」，是两回事。
  probeMethod: Object.freeze(['stdio-server-build-info']),
  // 探测对象的自述（F265 对抗审查 C-2）：域里只有这一个值，是**刻意**的——
  // 它存在的意义不是分类，而是让报告自己说清"这一条讲的是 PATH 上那个二进制，
  // 不是客户端此刻连着的那个进程"。真要判在跑的进程，只能由客户端侧自己调
  // `server_build_info`，doctor 结构上做不到（见 probeMcpServerBuild 的 docstring）。
  probeTarget: Object.freeze(['path-binary']),
  // 基准方（本地 HEAD）自身的可读性（F265 对抗审查 I-1）。刻意**不复用**
  // `commitComparison`：基准与自己比恒得 `match`，那个 `match` 与真实的跨方比对
  // 在渲染上无法区分，读者会以为"仓库这一方也比过了"。
  baselineCommit: Object.freeze(['available', 'absent']),
  commitComparison: COMMIT_COMPARISONS,
  trustStatus: TRUST_STATUSES,
});

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SEMVER_EXTRACT_RE = /(\d+)\.(\d+)\.(\d+)/;

/**
 * 受限版本行语法。
 *
 * 🔴 **对 plan §8.7(1) 的收紧（实施期偏离，已记入交付报告）**：plan 原定义是字符白名单
 * `/^[A-Za-z0-9 ._+()-]{0,48}$/`。该白名单**不足以**满足 SC-014 —— canary 形如
 * `F240CANARY-<uuid>` 全部由 `[A-Za-z0-9-]` 构成、长度 47，能原样通过白名单直达
 * `details.versionLine`。故这里改为**完整语法约束**：可选的程序名 + 可选 `v` 前缀 +
 * 三元语义版本 + 可选的十六进制 commit 后缀。`spectra v4.4.0 (0ae3eb7)` 恰好命中，
 * 任何携带额外自由文本的行一律落 `null`。
 *
 * 🔴 **但语法合法 ≠ 可以输出**（C1）：40 位十六进制 commit 后缀在语法上与一个
 * 32/40 位十六进制凭据完全同构，`v4.4.0 (deadbeefcafebabefeedface01234567)` 能原样
 * 通过本语法。因此本正则**只用于判定**，其匹配到的任何子串（尤其 commit）
 * **一律不得进入报告**；报告侧只承载 `parseVersionLine` 派生出的
 * `semver` / `hadVPrefix` / `commitSuffixPresent` 三个受限值。
 */
const VERSION_LINE_RE = /^(?:([A-Za-z][A-Za-z0-9._-]{0,23}) )?(v)?(\d+)\.(\d+)\.(\d+)(?: \([0-9a-f]{7,40}\))?$/;
const VERSION_LINE_MAX_LEN = 48;

/** ANSI CSI 转义序列（着色输出会把它们混进版本行，须在语法校验前剥除） */
const ANSI_CSI_RE = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;

/** 相对路径字符白名单（不含 `..`，长度上限 200） */
const SCOPED_REL_PATH_RE = /^[A-Za-z0-9._/-]{1,200}$/;

/**
 * 把子进程输出首行归约为受限版本行；不满足语法即 `null`（绝不降级为原样输出）。
 *
 * 归约顺序：剥 ANSI → 取首行 → 剥 CR → trim → 长度上限 → **整行**语法校验。
 * 「整行」是关键：只要出现语法之外的任何自由文本（哪怕行内恰好含一个合法 semver），
 * 整行判负 —— 否则 `warning: expected 4.4.0 but no binary was executed` 这类垃圾
 * 输出会被当成一次成功的版本读取（W1）。
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function constrainVersionLine(raw) {
  if (typeof raw !== 'string') return null;
  const firstLine = raw.replace(ANSI_CSI_RE, '').split('\n', 1)[0].replace(/\r/g, '').trim();
  if (firstLine.length === 0 || firstLine.length > VERSION_LINE_MAX_LEN) return null;
  return VERSION_LINE_RE.test(firstLine) ? firstLine : null;
}

/**
 * 版本行 → **派生字段**（C1 的唯一出口）。
 *
 * 返回值中不含任何来自子进程的原始子串：`semver` 由三段数字重新拼装，
 * `v` 前缀与 commit 后缀只以布尔存在性表达。commit 的值本身在此被结构性丢弃。
 *
 * `expectedProgram` 非空时，版本行**必须**以该程序名开头（W1）：程序名缺失或不符
 * 一律判负，避免任意携带 semver 的文本冒充一次成功读取。
 *
 * @param {unknown} raw
 * @param {{expectedProgram?: string|null}} [opts]
 * @returns {{ok: true, semver: string, hadVPrefix: boolean, commitSuffixPresent: boolean} | {ok: false}}
 */
export function parseVersionLine(raw, opts = {}) {
  const line = constrainVersionLine(raw);
  if (line === null) return { ok: false };
  const match = VERSION_LINE_RE.exec(line);
  if (!match) return { ok: false };
  const [, program, vPrefix, major, minor, patch] = match;
  const expected = opts.expectedProgram ?? null;
  if (expected !== null && program !== expected) return { ok: false };
  return {
    ok: true,
    // 由三个数字捕获组重新拼装，而非回传原子串：输出侧结构上只可能是 `N.N.N`
    semver: `${major}.${minor}.${patch}`,
    hadVPrefix: vPrefix === 'v',
    commitSuffixPresent: /\([0-9a-f]{7,40}\)$/.test(line),
  };
}

/** commit 的形态判据：7~40 位十六进制（大小写不敏感，比较前统一小写） */
const COMMIT_RE = /^[0-9a-f]{7,40}$/i;

/**
 * 两个 commit 的比对（F265 G0-3）——**报告侧 commit 维度的唯一出口**。
 *
 * 🔴 本函数是 C1 脱敏纪律与「按 commit 比对」需求的交汇点：入参可以是原串，
 * 返回值**只可能**是 `COMMIT_COMPARISONS` 的四个字面量之一。调用方因此在结构上
 * 无法把 commit 原串带进 details / summary / 日志 —— 与其说这是"注意不要"，
 * 不如说是「没有一条路径能把它带出去」。
 *
 * 判定顺序（先命中先返回）：
 * 1. 任一方是 `null` / `undefined` / 空串 ⇒ `absent`（那一方**没有** commit 信息，
 *    例如 release contract schema 从来不含 commit 字段、非 git 工作区读不到 HEAD）；
 * 2. 任一方不是字符串、或不满足 7~40 位十六进制 ⇒ `unreadable`（读到了东西但不是 commit）；
 * 3. 按**较短一方的长度**取前缀（小写）比较 ⇒ `match` / `mismatch`。之所以不恒取 7 位：
 *    7 位十六进制只有 28 bit，两个全长 SHA 会因为前 7 位撞车被判成同一个 build
 *    （对抗审查 W-2）。按较短方长度比较意味着信息给多少就用多少——双方都是 40 位时
 *    做的就是全长比较，只有在一方只暴露 commit(7)（`spectra --version` 的形态）时
 *    才退到 7 位，而 7 位是 `COMMIT_RE` 保证的下限。
 *
 * 🔴 信任边界：本比对的两输入均来自被测方自述（`--version` 的输出、MCP 自省回传的
 * 字段），**无任何完整性绑定**——它证明不了那个二进制真的编自它自称的那个 commit。
 * 这里判的是"两方各自说的是不是同一个值"，不是"它们真的是同一份代码"。
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {'match'|'mismatch'|'absent'|'unreadable'}
 */
export function compareCommits(a, b) {
  const isAbsent = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim().length === 0);
  if (isAbsent(a) || isAbsent(b)) return 'absent';
  if (typeof a !== 'string' || typeof b !== 'string') return 'unreadable';
  const left = a.trim();
  const right = b.trim();
  if (!COMMIT_RE.test(left) || !COMMIT_RE.test(right)) return 'unreadable';
  // 较短一方的长度即可比较的信息量上限；`COMMIT_RE` 已保证它 >= 7
  const width = Math.min(left.length, right.length);
  return left.slice(0, width).toLowerCase() === right.slice(0, width).toLowerCase()
    ? 'match'
    : 'mismatch';
}

/**
 * 把绝对路径归约为相对已知根的受限相对路径；无法相对化 / 不满足字符约束 →
 * 固定枚举值 `outside-known-roots`（**不输出**原路径，避免带出家目录与用户名）。
 *
 * @param {unknown} absPath
 * @param {{projectRoot?: string, codexHome?: string, claudeHome?: string}} roots
 * @returns {string}
 */
export function toScopedRelPath(absPath, roots = {}) {
  if (typeof absPath !== 'string' || absPath.length === 0) return OUTSIDE_KNOWN_ROOTS;
  const candidates = [roots.projectRoot, roots.codexHome, roots.claudeHome].filter(
    (root) => typeof root === 'string' && root.length > 0,
  );
  for (const root of candidates) {
    const prefix = root.endsWith('/') ? root : `${root}/`;
    if (!absPath.startsWith(prefix)) continue;
    const rel = absPath.slice(prefix.length);
    if (rel.length === 0 || rel.includes('..')) return OUTSIDE_KNOWN_ROOTS;
    return SCOPED_REL_PATH_RE.test(rel) ? rel : OUTSIDE_KNOWN_ROOTS;
  }
  return OUTSIDE_KNOWN_ROOTS;
}

/** 逐类型校验器：返回 `{ ok: true, value }` 或 `{ ok: false }` */
const TYPE_VALIDATORS = Object.freeze({
  enum(key, value) {
    const domain = ENUM_DOMAINS[key];
    if (!domain) return { ok: false };
    return domain.includes(value) ? { ok: true, value } : { ok: false };
  },
  semver(_key, value) {
    if (value === null) return { ok: true, value: null };
    return typeof value === 'string' && SEMVER_RE.test(value) ? { ok: true, value } : { ok: false };
  },
  // 🔴 C1：此处**刻意不存在** `constrainedVersionLine` 之类「可承载子进程原文」的类型。
  // 版本行的语法即便合法，其 commit 后缀与一个 32/40 位十六进制凭据同构，
  // 语法校验证明不了那串东西是 commit 而不是密钥。于是报告 schema 里
  // **没有任何字段**能承载来自子进程的原始子串——只承载派生出的布尔与三段数字。
  boundedInt(_key, value) {
    if (value === null) return { ok: true, value: null };
    return Number.isInteger(value) && value >= 0 && value <= 255 ? { ok: true, value } : { ok: false };
  },
  scopedRelPath(_key, value) {
    if (typeof value !== 'string') return { ok: false };
    if (value === OUTSIDE_KNOWN_ROOTS) return { ok: true, value };
    return SCOPED_REL_PATH_RE.test(value) && !value.includes('..') ? { ok: true, value } : { ok: false };
  },
  boolean(_key, value) {
    return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
  },
  probeList(_key, value) {
    if (!Array.isArray(value)) return { ok: false };
    const normalized = [];
    for (const item of value) {
      if (typeof item !== 'object' || item === null) return { ok: false };
      const id = item.id;
      const outcome = item.outcome;
      const errorClass = item.errorClass ?? null;
      const knownId = PLUGIN_BUILD_PROBES.includes(id) || HOOK_TRUST_PROBES.includes(id);
      if (!knownId) return { ok: false };
      if (!PROBE_OUTCOMES.includes(outcome)) return { ok: false };
      if (errorClass !== null && !ERROR_CLASSES.includes(errorClass)) return { ok: false };
      // 只保留三个受限字段——任何自由文本字段在此被结构性丢弃
      normalized.push({ id, outcome, errorClass });
    }
    return { ok: true, value: normalized };
  },
});

/**
 * (2) 每个 category 的 details 键 → 类型映射（键 allowlist 与值 schema 合一）。
 *
 * 与 plan §8.7(2) 的差异：`repo-version` 追加了 `errorClass`。理由——FR-008(5) 要求
 * 「读不到时落 indeterminate」并以固定枚举表达失败原因，而 plan 的原映射里
 * repo-version 没有任何键能承载它，会迫使实现要么静默丢失原因、要么把原因塞进
 * 自由文本 summary（后者正是 FR-012(3) 禁止的）。
 */
export const DETAILS_SCHEMA = Object.freeze({
  'repo-version': Object.freeze({
    contractPath: 'scopedRelPath',
    versionField: 'enum',
    semver: 'semver',
    rawShape: 'enum',
    errorClass: 'enum',
    // 基准方的 commit 维度（F265）：release contract schema 从不含 commit 字段，
    // 该方的 commit 取运行 doctor 那一刻的本地 `git rev-parse HEAD`（活读取、不持久化）。
    // 🔴 这里记的是**基准立没立得住**（`available` / `absent`），不是一次比对结论——
    // 用 `commitComparison: 'match'` 表达"基准和自己一样"是自比，渲染出来与真实的
    // 跨方 `match` 无法区分（对抗审查 I-1）。基准 `absent` 时其余三方必然也是 `absent`。
    baselineCommit: 'enum',
  }),
  'global-cli': Object.freeze({
    binaryName: 'enum',
    semver: 'semver',
    // 版本行的两个**派生**特征位（C1：原始 commit 子串在 schema 层不可承载）
    hadVPrefix: 'boolean',
    commitSuffixPresent: 'boolean',
    // 与基准 commit 的比对结论（F265）；`commitSuffixPresent` 只说"有没有后缀"，
    // 这一项才回答"是不是同一个 build"
    commitComparison: 'enum',
    exitCode: 'boundedInt',
    errorClass: 'enum',
    rawShape: 'enum',
  }),
  'plugin-build': Object.freeze({
    probedSources: 'probeList',
    activeInstallPath: 'scopedRelPath',
    semver: 'semver',
    rawShape: 'enum',
    // 🔴 恒为 `absent`：`.codex-plugin/plugin.json` 的 manifest schema 从来没有 commit 字段，
    // 而快照目录名是**快照哈希**、`probeCodexPluginManifest` 已明令绝不能当版本/构建标识用
    // （F236 教训）。这是**如实反映"该方无 commit 信息"**，不是未完成事项；
    // 有锁定测试防止未来有人"顺手"把快照哈希接上来冒充 commit。
    commitComparison: 'enum',
  }),
  'mcp-server': Object.freeze({
    probeMethod: 'enum',
    // 探测对象自述（F265 对抗审查 C-2）：`path-binary` —— PATH 上的 `spectra`，
    // 而不是 MCP 客户端此刻连着的那个进程
    probeTarget: 'enum',
    // F265：MCP server 自省 build 与基准 commit 的比对结论（本类目的主判据）
    commitComparison: 'enum',
    // 该 build 是否编自未提交的工作树（F265 对抗审查 C-1）。生产侧一直如实回传这一位，
    // 消费侧此前零引用，于是"脏树 build"被渲染成干净的 `match / ok` —— 而开发期的
    // 主路径恰恰就是脏树。缺失/非布尔时**不写这个键**（写 undefined 会触发
    // sanitizeDetails 的类型违规分支，把一次"对方没报"误记成 parse-failed）。
    buildDirty: 'boolean',
    // 自省同时回传 version，作为**次级**信号记录，不驱动本类目状态（版本漂移由 global-cli 承载）
    semver: 'semver',
    errorClass: 'enum',
  }),
  'hook-trust': Object.freeze({
    attemptedProbes: 'probeList',
    trustStatus: 'enum',
    hooksJsonPath: 'scopedRelPath',
  }),
});

/**
 * details 的**唯一**净化出口：键不在映射内 → 丢弃；值不满足类型 → 丢弃
 * （而非降级为原样输出），并在该 category 支持 `errorClass` 键时记 `parse-failed`。
 *
 * @param {string} category
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function sanitizeDetails(category, raw) {
  const schema = DETAILS_SCHEMA[category];
  if (!schema) {
    throw new TypeError(`sanitizeDetails：未知 category「${category}」`);
  }
  const out = {};
  let sawTypeViolation = false;
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, value] of Object.entries(raw)) {
      const type = schema[key];
      if (!type) continue; // 键 allowlist：未登记直接丢弃
      const validator = TYPE_VALIDATORS[type];
      const verdict = validator(key, value);
      if (verdict.ok) {
        out[key] = verdict.value;
      } else {
        sawTypeViolation = true;
      }
    }
  }
  if (sawTypeViolation && schema.errorClass && out.errorClass === undefined) {
    out.errorClass = 'parse-failed';
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// (3) 全通道模板化构造：summary / remediation 的唯一产出路径
// ─────────────────────────────────────────────────────────────────────────────

/**
 * summary 模板表：`code → { params, render }`。
 * `params` 声明每个模板参数的受限类型；render 只能消费已通过校验的参数，
 * **禁止**任何形式的自由输入拼接。
 *
 * 🔴 F275：导出仅用于**测试内省**（断言新增文案不出现某段字面文本），模板表本身不承载
 * 任何来自子进程/用户输入的自由文本，导出不构成脱敏纪律的例外。
 */
export const SUMMARY_TEMPLATES = Object.freeze({
  'repo-version-read': {
    params: { product: 'enum:product', semver: 'semver' },
    render: (p) => `${p.product} 仓库声明版本为 ${p.semver}`,
  },
  'repo-version-unreadable': {
    params: { errorClass: 'enum:errorClass' },
    render: (p) => `release contract 不可读（errorClass=${p.errorClass}），仓库版本一方不可判定`,
  },
  'repo-version-unparseable': {
    params: { product: 'enum:product' },
    render: (p) => `${p.product} 的仓库版本字段不是合法语义版本，该方不可判定`,
  },
  'global-cli-not-applicable': {
    params: { product: 'enum:product' },
    render: (p) => `${p.product} 没有独立的全局 CLI，该组合在设计上不存在对应物`,
  },
  'global-cli-match': {
    params: { product: 'enum:product', semver: 'semver' },
    render: (p) => `全局 ${p.product} CLI 版本与仓库一致（${p.semver}）`,
  },
  'global-cli-drift': {
    params: { product: 'enum:product', semver: 'semver', observed: 'semver' },
    render: (p) => `全局 ${p.product} CLI 版本漂移：仓库 ${p.semver}，实际 ${p.observed}`,
  },
  'global-cli-unparseable': {
    params: { product: 'enum:product' },
    render: (p) => `无法从全局 ${p.product} CLI 输出中提取语义版本，该方不可判定`,
  },
  'global-cli-unavailable': {
    params: { product: 'enum:product', errorClass: 'enum:errorClass' },
    render: (p) => `全局 ${p.product} CLI 不可用（errorClass=${p.errorClass}），该方不可判定`,
  },
  /**
   * F265：语义版本一致、但 build commit 不是同一个。
   * 落 `warning` 而非 `fail` —— 版本号没漂，只是二进制不是本地这份代码编出来的，
   * 这是"你自用的 CLI 不是这次改动"的诚实信号，不是发布契约破损。
   * 🔴 参数里**没有** commit 值本身（`buildSummary` 的参数校验也不认识这种类型）。
   */
  'global-cli-commit-mismatch': {
    params: { product: 'enum:product', semver: 'semver' },
    render: (p) =>
      `全局 ${p.product} CLI 版本号与仓库一致（${p.semver}），但 build commit 与本地 HEAD 不同（commitComparison=mismatch）`,
  },
  'global-cli-compare-unavailable': {
    params: { product: 'enum:product' },
    render: (p) => `全局 ${p.product} CLI 版本已读到，但仓库侧参照不可判定，无法比较`,
  },
  'plugin-build-match': {
    params: { product: 'enum:product', semver: 'semver' },
    render: (p) => `active ${p.product} plugin build 版本与仓库一致（${p.semver}）`,
  },
  'plugin-build-drift': {
    params: { product: 'enum:product', semver: 'semver', observed: 'semver' },
    render: (p) => `active ${p.product} plugin build 版本漂移：仓库 ${p.semver}，实际 ${p.observed}`,
  },
  'plugin-build-unknown': {
    params: { product: 'enum:product' },
    render: (p) =>
      `已走完全部 ${PLUGIN_BUILD_PROBES.length} 个排查点仍未找到 ${p.product} 的 active plugin 标记（reason=codex-active-marker-unknown）`,
  },
  'plugin-build-compare-unavailable': {
    params: { product: 'enum:product' },
    render: (p) => `已读到 ${p.product} 的 active plugin build 版本，但仓库侧参照不可判定，无法比较`,
  },
  /**
   * F265 G0-3：`mcp-server-known-gap`（"当前不暴露版本自省能力，属已知产品缺口"）已**移除** ——
   * 该缺口由本卡的 `server_build_info` 工具关闭，继续输出它就是在报告一个不再成立的事实。
   * 下面四条按自省探测的实际结局分支，替代原先那条恒定文案。
   */
  /**
   * 🔴 措辞只到能证成的范围（F265 对抗审查 C-2）：doctor 探的是**PATH 上的 `spectra`
   * 二进制**（自己拉起一个新进程问它），不是 MCP 客户端此刻连着的那个进程。说成
   * "正在运行的 MCP server"会把本卡最想抓的失效态——客户端连着旧进程没重连——
   * 描述成已经检查过了，而那恰恰是这条探测结构上够不着的地方。
   */
  'mcp-server-commit-match': {
    params: { product: 'enum:product' },
    render: (p) =>
      `PATH 上的 ${p.product} 二进制所构建的 MCP server 与本地 HEAD 是同一个 commit（commitComparison=match）`,
  },
  /**
   * F265 对抗审查 C-1：commit 相同、但那个 build 编自未提交的工作树。
   * 落 `warning` 而非 `ok` —— commit 一致只说明"基于同一次提交"，脏树 build 里
   * 装的是当时工作区的任意状态，跟当前代码可以毫无关系。开发期这是主路径，
   * 把它渲染成干净的 `ok` 等于让诊断在最常见的场景下说假话。
   */
  'mcp-server-commit-match-dirty': {
    params: { product: 'enum:product' },
    render: (p) =>
      `PATH 上的 ${p.product} 二进制所构建的 MCP server 与本地 HEAD 是同一个 commit，` +
      '但该 build 编自未提交的工作树（dirty），行为可能对不上当前代码',
  },
  'mcp-server-commit-mismatch': {
    params: { product: 'enum:product' },
    render: (p) =>
      `PATH 上的 ${p.product} 二进制所构建的 MCP server 与本地 HEAD 不是同一个 commit（commitComparison=mismatch），MCP 行为可能对不上当前代码`,
  },
  /**
   * 自省成功、但**对方没有** commit 信息（clean checkout / tsx 直跑的 build 不盖章），
   * 或本地基准读不到 —— 是"没有可比的东西"，不是错误。
   * 与下面的 `-unreadable` 分开：同文件的 PROBE_OUTCOMES 早就写过这条纪律 ——
   * "没给"和"给了但读不懂"是两种事实，套同一句文案会把排查方向指错（对抗审查 W-1）。
   */
  'mcp-server-commit-absent': {
    params: { product: 'enum:product' },
    render: (p) =>
      `PATH 上的 ${p.product} 二进制的 MCP server 自省已读到，但比对所需的一方没有 commit 信息，该维度不可判定`,
  },
  /** 自省成功、对方也回传了 commit，但那串东西的形态不是 commit（非十六进制 / 长度越界） */
  'mcp-server-commit-unreadable': {
    params: { product: 'enum:product' },
    render: (p) =>
      `PATH 上的 ${p.product} 二进制的 MCP server 回传了 commit，但形态不合法（非 7~40 位十六进制），该维度不可判定`,
  },
  /** 自省通道本身没走通（二进制不可执行 / 超时 / 旧 build 没有该工具） */
  'mcp-server-introspection-unavailable': {
    params: { product: 'enum:product', errorClass: 'enum:errorClass' },
    render: (p) =>
      `无法从 PATH 上的 ${p.product} 二进制读到 MCP server 自省 build 信息（errorClass=${p.errorClass}），该方无 commit 信息，不可判定`,
  },
  'mcp-server-not-applicable': {
    params: { product: 'enum:product' },
    render: (p) => `${p.product} 没有对应的 MCP server，该组合在设计上不存在对应物`,
  },
  'hook-trust-not-applicable': {
    params: {},
    render: () => 'Codex 家目录下不存在 hooks.json，hook 信任状态不适用',
  },
  /**
   * 🔴 F275 对抗审查后新增（终版矩阵，前置门 `not-probed` 分支）：与 `hook-trust-not-applicable`
   * 的区别是——本条明确说明"没探"（前置门判定两处都无痕迹后主动跳过 RPC），而不是暗示
   * "探过了、确定没有"。二者指向同一个 `not-applicable` 状态，但文案的诚实程度不同。
   */
  'hook-trust-not-probed': {
    params: {},
    render: () => '未发现 Codex 插件或合并器 hooks 痕迹，hook 信任状态不适用',
  },
  /**
   * 🔴 F275 对抗审查后新增（终版矩阵行 6）：`app-server-hooks-list` 确实尝试过但失败
   * （`not-executable`/`error`），且既无 `hooks.json` 也无插件 cache 目录佐证——与
   * `hook-trust-not-probed` 的区别是这里**真的发起过** RPC 探测，只是没能拿到结论。
   */
  'hook-trust-not-applicable-no-evidence': {
    params: {},
    render: () => '未发现本插件安装痕迹（Codex 原生探测未完成），hook 信任状态不适用',
  },
  'hook-trust-untrusted': {
    params: {},
    render: () => 'hooks.json 已存在但未见信任记录，hook 在授予信任前不会执行',
  },
  /**
   * 🔴 F275 对抗审查后更正（spec C1）：T062 实测证伪「脚本内容变更导致信任失效」——
   * `currentHash` 覆盖的是 `hooks.json` 里的 hook **声明**（如 command 串），不覆盖被
   * 调用脚本本身的字节内容（改脚本 1 字节，`hooks/list` 回读的 `trustStatus` 不变）。
   * 旧文案的因果表述已被证伪，改为中性表述——只说"记录与当前声明不一致"，不猜测原因。
   */
  'hook-trust-modified': {
    params: {},
    render: () => '信任记录与当前 hook 声明不一致，需要重新授予信任',
  },
  'hook-trust-trusted': {
    params: {},
    render: () => 'hook 信任记录与当前脚本内容一致',
  },
  'hook-trust-indeterminate': {
    params: {},
    render: () => 'hook 信任状态不可判定（探测手段均未给出确定结论），不假设已信任',
  },
  /**
   * 🔴 W3：`hooks.json` 存在但读不出 / 不是合法 JSON 对象时，问题在**配置本身**，
   * 授予信任并不能修好它。此分支必须与 `untrusted` 区分开，并且**不给** `grant-hook-trust`。
   */
  'hook-trust-unreadable': {
    params: { errorClass: 'enum:errorClass' },
    render: (p) => `hooks.json 存在但不可解析为合法配置（errorClass=${p.errorClass}），hook 信任状态不可判定`,
  },
  /**
   * 🔴 以下 5 条为 F275 新增：判定来源是 `codex app-server` 的 `hooks/list` RPC
   * （原生注册路径，见 plan §2 第 1/2 优先级），**不提及** `hooks.json` 存在性 ——
   * F264 主路径下 `$CODEX_HOME/hooks.json` 根本不存在，复用旧文案会让报告说出一句
   * 不成立的事实。新文案让用户能从 summary 本身分辨"这次判定走的是原生路径还是
   * 合并器路径"（plan §3.1）。
   */
  'hook-trust-native-untrusted': {
    params: {},
    render: () => 'Codex 原生已注册本插件的 hook，其信任状态为 untrusted，hook 在授予信任前不会执行',
  },
  /**
   * 🔴 F275 对抗审查后更正（spec C1）：同上，T062 实测证伪「脚本内容变更」这一因果——
   * `currentHash` 绑定的是 `hooks.json` 的 hook **声明**，不是被调用脚本的字节内容。
   * 改为实测支撑的表述："信任所绑定的 hook 声明内容已变更"。
   */
  'hook-trust-native-modified': {
    params: {},
    render: () =>
      'Codex 原生已注册本插件的 hook，其信任状态为 modified（信任所绑定的 hook 声明内容已变更），需要重新授予信任',
  },
  'hook-trust-native-trusted': {
    params: {},
    render: () => 'Codex 原生已注册本插件的 hook，其信任状态为 trusted，与当前脚本内容一致',
  },
  'hook-trust-native-managed': {
    params: {},
    render: () =>
      'Codex 原生报告本插件 hook 信任状态为 managed（企业托管），本诊断无法判定其是否已生效',
  },
  'hook-trust-native-probe-failed': {
    params: { errorClass: 'enum:errorClass' },
    render: (p) => `Codex 原生 hooks/list 探测失败（errorClass=${p.errorClass}），hook 信任状态不可判定`,
  },
  /**
   * 🔴 F275 对抗审查后新增（终版矩阵行 5，假阴 C4）：RPC 探测失败，但插件 cache 证据表明
   * 本插件确实曾被 Codex 的插件管理器安装过——与 `hook-trust-native-probe-failed` 共享
   * "探测失败"这一事实，但额外点出"已知装过"，指引用户去排查为什么原生路径探不通，
   * 而不是误以为"这台机器根本没装这个插件"。
   */
  'hook-trust-native-unreachable': {
    params: { errorClass: 'enum:errorClass' },
    render: (p) =>
      `检测到本插件已安装，但 Codex 原生 hooks 探测未能完成（errorClass=${p.errorClass}），hook 信任状态不可判定`,
  },
  'cli-internal-error': {
    params: { errorClass: 'enum:errorClass' },
    render: (p) => `诊断执行失败（errorClass=${p.errorClass}）`,
  },
  /** I1：CLI 参数错误也走同一模板漏斗，reason 为固定枚举，绝不回显 argv 值 */
  'cli-argument-error': {
    params: { reason: 'enum:cliArgError' },
    render: (p) => `命令行参数非法（reason=${p.reason}）`,
  },
});

export const SUMMARY_CODES = Object.freeze(Object.keys(SUMMARY_TEMPLATES));

function validateTemplateParam(type, value) {
  if (type === 'semver') return typeof value === 'string' && SEMVER_RE.test(value);
  if (type === 'enum:product') return PRODUCTS.includes(value);
  if (type === 'enum:errorClass') return ERROR_CLASSES.includes(value);
  if (type === 'enum:cliArgError') return CLI_ARG_ERRORS.includes(value);
  return false;
}

/**
 * summary 的唯一产出路径（FR-012(3)）。参数必须逐一通过受限类型校验，
 * 任一不合法即**构造失败**（抛错），不允许静默降级。
 *
 * @param {string} code
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
export function buildSummary(code, params = {}) {
  const template = SUMMARY_TEMPLATES[code];
  if (!template) {
    throw new TypeError(`buildSummary：未知 summaryCode「${code}」`);
  }
  const checked = {};
  for (const [name, type] of Object.entries(template.params)) {
    const value = params[name];
    if (!validateTemplateParam(type, value)) {
      throw new TypeError(`buildSummary：模板「${code}」的参数「${name}」不满足受限类型 ${type}`);
    }
    checked[name] = value;
  }
  return template.render(checked);
}

/**
 * remediation 模板表。
 *
 * 🔴 `grant-hook-trust` 的 `command` 恒为 `null`：FR-009 明确要求「任何步骤 MUST 事先
 * 经实测验证确实能达成目标状态」。`text` 于 F275 起逐字回填自 T062 人工验证报告
 * （`specs/240-codex-runtime-closeout/verification/t062-manual-report-2026-08-31.md`
 * L1824-1826）——这是**唯一**经实测确证可指导操作的步骤描述，不得改写措辞。
 *
 * 🔴 导出仅用于测试内省（与 `SUMMARY_TEMPLATES` 同理），不构成脱敏纪律例外。
 */
export const REMEDIATION_TEMPLATES = Object.freeze({
  'upgrade-global-cli': {
    command: 'npm install -g spectra@latest',
    text: '全局 CLI 与仓库声明版本不一致或不可用，升级全局安装后重跑本诊断。',
  },
  'reinstall-plugin': {
    command: null,
    text: 'active plugin build 与仓库声明版本不一致，请在对应客户端中重新安装该 plugin 后重跑本诊断。',
  },
  'reload-mcp-client': {
    command: null,
    // 🔴 F265 对抗审查 C-2：本诊断探的是 PATH 上的二进制，不是客户端已连接的那个进程。
    // 不点破这一点，读者会把"PATH 上是新的"当成"我正在用的 MCP 也是新的"。
    text:
      '请在 MCP 客户端中重新加载该 server 后重跑本诊断。' +
      '注意本诊断读的是 PATH 上的二进制，客户端已连接的旧进程需重连后本结论才适用。',
  },
  'grant-hook-trust': {
    command: null,
    text:
      '在目标 CODEX_HOME 下启动 Codex，输入 /hooks；选择标记为 untrusted 或 modified 的事件并按 Enter；' +
      '确认命令与来源后，按界面提示的小写 t 授予当前哈希信任。显示 Trust Trusted 后退出并重跑 doctor。' +
      '若没有显示 "Press t to trust"，不要猜测按键，按 Esc 返回并人工排查。',
  },
  'manual-investigate': {
    command: null,
    text: '该维度不可自动判定，需人工排查后重跑本诊断。',
  },
});

/**
 * remediation 的唯一产出路径。
 * @param {string} code
 * @returns {{code: string, command: string|null, text: string}}
 */
export function buildRemediation(code) {
  const template = REMEDIATION_TEMPLATES[code];
  if (!template) {
    throw new TypeError(`buildRemediation：未知 remediation code「${code}」`);
  }
  return { code, command: template.command, text: template.text };
}

/**
 * check 的**唯一**构造出口：强制过 `sanitizeDetails` + `buildSummary` + `buildRemediation`。
 * 任何绕过本函数直接拼 check 对象的写法都是缺陷。
 */
export function createCheck({
  id,
  category,
  product = null,
  status,
  summaryCode,
  summaryParams = {},
  details = {},
  remediationCode = null,
}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('createCheck：id 必须为非空字符串');
  }
  if (!CHECK_CATEGORIES.includes(category)) {
    throw new TypeError(`createCheck：非法 category「${category}」`);
  }
  if (!CHECK_STATUSES.includes(status)) {
    throw new TypeError(`createCheck：非法 status「${status}」`);
  }
  if (product !== null && !PRODUCTS.includes(product)) {
    throw new TypeError(`createCheck：非法 product「${product}」`);
  }
  if (remediationCode !== null && !REMEDIATION_CODES.includes(remediationCode)) {
    throw new TypeError(`createCheck：非法 remediation code「${remediationCode}」`);
  }
  return {
    id,
    category,
    product,
    status,
    summary: buildSummary(summaryCode, summaryParams),
    details: sanitizeDetails(category, details),
    remediation: remediationCode === null ? null : buildRemediation(remediationCode),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 版本归一化与状态聚合
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 版本字符串归一化：取**首个** `MAJOR.MINOR.PATCH` 匹配用于相等性比较；
 * `v` 前缀与 commit 后缀不参与判定。无法提取 → `semver: null`
 * （调用方据此落 `indeterminate`，**MUST NOT** 退化为原始字符串直接比较后判 fail）。
 *
 * @param {unknown} raw
 * @returns {{semver: string|null, rawShape: string}}
 */
export function normalizeVersion(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { semver: null, rawShape: 'absent' };
  }
  const text = raw.trim();
  const match = SEMVER_EXTRACT_RE.exec(text);
  if (!match) {
    return { semver: null, rawShape: 'unparseable' };
  }
  const semver = `${match[1]}.${match[2]}.${match[3]}`;
  return { semver, rawShape: semver === text ? 'bare-semver' : 'decorated-semver' };
}

/**
 * `overallStatus` 真值表（plan §4 消解 #5，按顺序求值，先命中先返回）。
 *
 * `indeterminate` 映射到 `warning` 而非 `fail`：`fail` 语义保留给确定性的不一致结论，
 * `indeterminate` 是「我们不知道」。若二者都映射到 `fail`，`--strict` 会在「本机没装
 * Codex」这种完全正常的场景退出 1，使该开关永远不可用于 CI。
 *
 * @param {Array<{status: string}>} checks
 * @returns {{overallStatus: string, reason: string|null}}
 */
export function aggregateOverallStatus(checks) {
  const list = Array.isArray(checks) ? checks : [];
  if (list.length === 0) {
    return { overallStatus: 'warning', reason: 'no-checks-executed' };
  }
  if (list.some((c) => c.status === 'fail')) return { overallStatus: 'fail', reason: null };
  if (list.some((c) => c.status === 'indeterminate')) return { overallStatus: 'warning', reason: null };
  if (list.some((c) => c.status === 'warning')) return { overallStatus: 'warning', reason: null };
  return { overallStatus: 'ok', reason: null };
}

/**
 * 由「config.toml 文件级读取结果 + 段判定结果」推导 `config-toml-hooks-state` 的结局。
 *
 * 🔴 该探针的 id 承诺的是**段**，故其 outcome 只能描述段：文件读到了但段不在 →
 * `absent`（真探过、确定没有）；文件根本读不到 → 沿用文件级失败结局（没能探到段），
 * **绝不**因为「文件读到了」就报 `found`。文件是否可读由 `config-toml-readable` 单独承载。
 *
 * @param {{outcome: string, errorClass: string|null}} configProbe config.toml 文件级探测结果
 * @param {{kind: string}} stateSection
 * @returns {{outcome: string, errorClass: string|null}}
 */
function deriveHooksStateProbe(configProbe, stateSection) {
  if (configProbe.outcome === 'error' || configProbe.outcome === 'not-executable') {
    return { outcome: configProbe.outcome, errorClass: configProbe.errorClass ?? null };
  }
  switch (stateSection?.kind) {
    case 'confirmed':
    case 'present-unconfirmed':
      return { outcome: 'found', errorClass: null };
    case 'absent':
      // 文件不存在也归此处：「没有文件」蕴含「没有段」，是确定性事实而非「没查」
      return { outcome: 'absent', errorClass: null };
    default:
      // `unavailable` / 未知 kind：段这条路径没真走过 —— 记 `not-probed`，不得伪装成 `absent`
      return { outcome: 'not-probed', errorClass: null };
  }
}

/**
 * `nativeProbe.entries` 的原始 `trustStatus` 闭集（F275 §2）——`hooks/list` RPC 报告的
 * 四种真实值。任一命中条目不属于此闭集视为协议漂移，不参与聚合。
 */
const NATIVE_TRUST_VALUE_SET = new Set(['managed', 'untrusted', 'trusted', 'modified']);

/**
 * 由 RPC 探到的我方条目原始 `trustStatus` 列表聚合出唯一判定结果（取严，F275 §2 优先级 1）。
 * 协议漂移（任一值不在四值闭集内）→ 返回 `null`，调用方据此判 error/parse-failed，不猜测聚合。
 *
 * @param {string[]} entries
 * @returns {'untrusted'|'modified'|'managed'|'trusted'|null}
 */
function aggregateNativeTrust(entries) {
  for (const entry of entries) {
    if (!NATIVE_TRUST_VALUE_SET.has(entry)) return null;
  }
  if (entries.includes('untrusted')) return 'untrusted';
  if (entries.includes('modified')) return 'modified';
  if (entries.includes('managed')) return 'managed';
  return 'trusted';
}

/**
 * hook 信任状态判定（纯函数，FR-009 / `_grounding.md` §9.7 的 T003 算法）。
 *
 * 🔴 `stateSection.kind === 'present-unconfirmed'` → `indeterminate`：信任段的**确切
 * TOML 形态（键名层级、哈希算法与哈希输入）尚未经实测确证**（T062 人工挂账）。
 * §9.7 明令「段存在但形态不符预期 → indeterminate，禁止猜测解析」。`confirmed` 分支
 * 已按算法实现并有单测覆盖，待 T062 确证后由 io 层改喂 `confirmed` 即可接线。
 *
 * 🔴 W3：`hooksJsonProbe` 显式区分「文件不在」与「文件在但读不出 / 不是合法 JSON 对象」。
 * 后者是**配置本身坏了**，授予信任修不了它，因此既不能报 `untrusted`
 * 也不能给 `grant-hook-trust`，只能落 `indeterminate` + `manual-investigate`。
 *
 * 🔴 F275：新增 `nativeProbe` 入参（`codex app-server` 的 `hooks/list` RPC 结果）。
 *
 * 🔴 F275 对抗审查后修订（终版判定矩阵，2026-08-31）——原「`error` 无条件短路成
 * `indeterminate`」被两路异构对抗同时证伪（误报面：制造无插件机噪声；假阴面：在
 * F264 主路径上复活原始 bug）。新增第三个证据维度做 tie-break：`pluginCacheEvidence`
 * （`$CODEX_HOME/plugins/cache/*\/spec-driver` 是否存在，纯文件读、与 RPC 独立）。
 *
 * | nativeProbe.outcome | hooksJsonPresent | pluginCacheEvidence | 结论 |
 * |---|---|---|---|
 * | `found`（≥1 条我方条目） | — | — | 按 entries 聚合取严 |
 * | `absent`（RPC 成功、结构完好、确证无我方条目） | 任意 | — | 回退合并器判据 |
 * | `not-probed`（前置门跳过） | false（前置门保证） | false（前置门保证） | `not-applicable` |
 * | `not-executable` / `error` | **true** | — | **回退合并器判据**（RPC 失败仅 probe 留痕） |
 * | `not-executable` / `error` | false | **true** | **`indeterminate`** + `manual-investigate` |
 * | `not-executable` / `error` | false | false | `not-applicable` |
 *
 * `probes` 统一追加 `{id:'app-server-hooks-list', outcome, errorClass}` 与
 * `{id:'codex-home-plugin-cache', outcome, errorClass:null}` 两条留痕，无论最终走哪条分支。
 *
 * @param {{hooksJsonPresent: boolean,
 *          hooksJsonProbe?: {outcome: string, errorClass: string|null}|null,
 *          configProbe: {outcome: string, errorClass: string|null},
 *          stateSection: {kind: string, trustedHash?: string|null},
 *          currentHash: string|null,
 *          nativeProbe?: {outcome: string, errorClass: string|null, entries: string[]}|null,
 *          pluginCacheEvidence?: boolean}} input
 */
export function classifyHookTrust(input) {
  const {
    hooksJsonPresent,
    hooksJsonProbe = null,
    configProbe,
    stateSection,
    currentHash,
    nativeProbe = null,
    pluginCacheEvidence = false,
  } = input;
  const hooksProbeEntry = {
    id: 'codex-home-hooks-json',
    outcome: hooksJsonProbe?.outcome ?? (hooksJsonPresent ? 'found' : 'absent'),
    errorClass: hooksJsonProbe?.errorClass ?? null,
  };
  const stateProbeEntry = { id: 'config-toml-hooks-state', ...deriveHooksStateProbe(configProbe, stateSection) };
  const nativeProbeEntry = {
    id: 'app-server-hooks-list',
    outcome: nativeProbe?.outcome ?? 'not-probed',
    errorClass: nativeProbe?.errorClass ?? null,
  };
  const pluginCacheProbeEntry = {
    id: 'codex-home-plugin-cache',
    outcome: pluginCacheEvidence ? 'found' : 'absent',
    errorClass: null,
  };
  const probes = [
    hooksProbeEntry,
    // 文件级事实：config.toml 读到了 / 不在 / 读不出。判定不直接消费它以外的含义
    {
      id: 'config-toml-readable',
      outcome: configProbe.outcome,
      errorClass: configProbe.errorClass ?? null,
    },
    // 段级事实：hooks.state 段在不在（由 stateSection 驱动，与判定同源）
    stateProbeEntry,
    // F275：原生 RPC 探针留痕，无论走哪条优先级分支均记录
    nativeProbeEntry,
    // F275 对抗审查后新增：插件 cache 证据留痕（tie-break 依据，纯文件读）
    pluginCacheProbeEntry,
  ];

  // F275 §2 优先级 1：RPC 探到 ≥1 条我方条目 → 由原始 trustStatus 聚合（主信息源）
  if (
    nativeProbe !== null &&
    nativeProbe.outcome === 'found' &&
    Array.isArray(nativeProbe.entries) &&
    nativeProbe.entries.length > 0
  ) {
    const aggregated = aggregateNativeTrust(nativeProbe.entries);
    if (aggregated === null) {
      // 协议漂移防御：命中条目的 trustStatus 有不属于四值闭集的第 5 个值，不猜测聚合
      return {
        status: 'indeterminate',
        trustStatus: 'indeterminate',
        summaryCode: 'hook-trust-native-probe-failed',
        summaryParams: { errorClass: 'parse-failed' },
        remediationCode: 'manual-investigate',
        probes,
      };
    }
    if (aggregated === 'untrusted') {
      return {
        status: 'warning',
        trustStatus: 'untrusted',
        summaryCode: 'hook-trust-native-untrusted',
        remediationCode: 'grant-hook-trust',
        probes,
      };
    }
    if (aggregated === 'modified') {
      return {
        status: 'warning',
        trustStatus: 'modified',
        summaryCode: 'hook-trust-native-modified',
        remediationCode: 'grant-hook-trust',
        probes,
      };
    }
    if (aggregated === 'managed') {
      // 决议 1.1：不猜测 managed 的语义，统一落 indeterminate
      return {
        status: 'indeterminate',
        trustStatus: 'indeterminate',
        summaryCode: 'hook-trust-native-managed',
        remediationCode: 'manual-investigate',
        probes,
      };
    }
    // aggregated === 'trusted'
    return {
      status: 'ok',
      trustStatus: 'trusted',
      summaryCode: 'hook-trust-native-trusted',
      remediationCode: null,
      probes,
    };
  }

  // F275 对抗审查后修订（终版矩阵行 4/5/6）：`not-executable`/`error` 不再无条件短路成
  // `indeterminate`。`hooksJsonPresent===true` 时合并器结论本身是可判定的，RPC 失败只是
  // 主信息源没探成，不能用它掩盖一个已经拿得出手的合并器结论（消误报 C-1/C-2）；
  // `hooksJsonPresent===false` 时按插件 cache 证据 tie-break：有证据 → "装了但探不通"
  // 落 `indeterminate`（消假阴 C4）；无证据 → 没有任何插件安装痕迹，落 `not-applicable`
  // （消误报 C-1 的只读 CODEX_HOME / 旧版 Codex / EACCES / NODE_OPTIONS 污染四种噪声形态）。
  if (
    nativeProbe !== null &&
    (nativeProbe.outcome === 'not-executable' || nativeProbe.outcome === 'error') &&
    !hooksJsonPresent
  ) {
    if (pluginCacheEvidence) {
      return {
        status: 'indeterminate',
        trustStatus: 'indeterminate',
        summaryCode: 'hook-trust-native-unreachable',
        summaryParams: { errorClass: nativeProbe.errorClass ?? 'unknown' },
        remediationCode: 'manual-investigate',
        probes,
      };
    }
    return {
      status: 'not-applicable',
      trustStatus: 'not-applicable',
      summaryCode: 'hook-trust-not-applicable-no-evidence',
      remediationCode: null,
      probes,
    };
  }

  // F275 §2 优先级 3（fallback）：以下为原有四分支逻辑，逐字未改
  // hooks.json 在，但不可读 / 不是合法 JSON 对象 → 不可判定（且**不给**信任授予步骤）
  if (hooksProbeEntry.outcome === 'error') {
    return {
      status: 'indeterminate',
      trustStatus: 'indeterminate',
      summaryCode: 'hook-trust-unreadable',
      summaryParams: { errorClass: hooksProbeEntry.errorClass ?? 'unknown' },
      remediationCode: 'manual-investigate',
      probes,
    };
  }

  // hooks.json 不存在 → 与 A3 解耦（plan §10.3），是确定性事实而非「读不到」
  if (!hooksJsonPresent) {
    // F275 对抗审查后修订（W-5）：not-applicable 的措辞按 nativeProbe.outcome 分化——
    // `not-probed`（前置门主动跳过）明确说"没探"；其余情形（`absent` 确证 / `null` 遗留
    // 未接线场景）沿用既有措辞，不过度声明。
    return {
      status: 'not-applicable',
      trustStatus: 'not-applicable',
      summaryCode: nativeProbe !== null && nativeProbe.outcome === 'not-probed'
        ? 'hook-trust-not-probed'
        : 'hook-trust-not-applicable',
      remediationCode: null,
      probes,
    };
  }

  // config 读取本身失败 → 不可判定。🔴 MUST NOT 静默假设「已信任」
  if (configProbe.outcome === 'error' || configProbe.outcome === 'not-executable') {
    return {
      status: 'indeterminate',
      trustStatus: 'indeterminate',
      summaryCode: 'hook-trust-indeterminate',
      remediationCode: 'manual-investigate',
      probes,
    };
  }

  // 段缺失 + hooks.json 存在 → untrusted（§9.7：段缺失 ≠ 已信任）
  if (stateSection.kind === 'absent') {
    return {
      status: 'warning',
      trustStatus: 'untrusted',
      summaryCode: 'hook-trust-untrusted',
      remediationCode: 'grant-hook-trust',
      probes,
    };
  }

  if (stateSection.kind === 'confirmed') {
    const matched =
      typeof stateSection.trustedHash === 'string' &&
      typeof currentHash === 'string' &&
      stateSection.trustedHash === currentHash;
    return matched
      ? {
          status: 'ok',
          trustStatus: 'trusted',
          summaryCode: 'hook-trust-trusted',
          remediationCode: null,
          probes,
        }
      : {
          status: 'warning',
          trustStatus: 'modified',
          summaryCode: 'hook-trust-modified',
          remediationCode: 'grant-hook-trust',
          probes,
        };
  }

  // 'present-unconfirmed' / 'unavailable' / 未知 kind → 不猜测解析
  return {
    status: 'indeterminate',
    trustStatus: 'indeterminate',
    summaryCode: 'hook-trust-indeterminate',
    remediationCode: 'manual-investigate',
    probes,
  };
}

/**
 * 由已构造好的 check 列表装配最终报告（与 `codex doctor --json` 同构）。
 * @param {{checks: Array<object>, generatedAt: string}} input
 */
export function assembleReport({ checks, generatedAt }) {
  const agg = aggregateOverallStatus(checks);
  const indexed = {};
  for (const check of checks) {
    indexed[check.id] = check;
  }
  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    overallStatus: agg.overallStatus,
    checks: indexed,
  };
  if (agg.reason !== null) report.reason = agg.reason;
  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// 文本渲染（与 JSON 通道共用同一批已脱敏对象，禁止另开打印原始输入的路径）
// ─────────────────────────────────────────────────────────────────────────────

function renderDetailValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => `${item.id}=${item.outcome}${item.errorClass ? `(${item.errorClass})` : ''}`).join(', ');
  }
  return String(value);
}

/**
 * 人类可读报告。输入必须是 `assembleReport` 的产物（即已过脱敏漏斗的对象）。
 * @param {object} report
 * @returns {string}
 */
export function formatTextReport(report) {
  const lines = [
    'Codex 运行时四方一致性诊断（codex-runtime-doctor）',
    '=================================================',
    `generatedAt:   ${report.generatedAt}`,
    `overallStatus: ${report.overallStatus}${report.reason ? ` (${report.reason})` : ''}`,
    '',
  ];
  for (const check of Object.values(report.checks)) {
    lines.push(`[${check.status}] ${check.id}`);
    lines.push(`    ${check.summary}`);
    const detailKeys = Object.keys(check.details);
    if (detailKeys.length > 0) {
      for (const key of detailKeys) {
        lines.push(`    - ${key}: ${renderDetailValue(check.details[key])}`);
      }
    }
    if (check.remediation !== null) {
      lines.push(`    → next-step [${check.remediation.code}]: ${check.remediation.text}`);
      if (check.remediation.command !== null) {
        lines.push(`      $ ${check.remediation.command}`);
      }
    }
    lines.push('');
  }
  lines.push('说明: 本命令是诊断而非门禁，默认恒退出 0；仅 --strict 下 overallStatus=fail 才退出 1。');
  return lines.join('\n');
}
