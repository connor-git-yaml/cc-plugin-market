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
  'codex-home-hooks-json',
  'config-toml-readable',
  'config-toml-hooks-state',
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
  probeMethod: Object.freeze(['none-available']),
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
  }),
  'global-cli': Object.freeze({
    binaryName: 'enum',
    semver: 'semver',
    // 版本行的两个**派生**特征位（C1：原始 commit 子串在 schema 层不可承载）
    hadVPrefix: 'boolean',
    commitSuffixPresent: 'boolean',
    exitCode: 'boundedInt',
    errorClass: 'enum',
    rawShape: 'enum',
  }),
  'plugin-build': Object.freeze({
    probedSources: 'probeList',
    activeInstallPath: 'scopedRelPath',
    semver: 'semver',
    rawShape: 'enum',
  }),
  'mcp-server': Object.freeze({
    probeMethod: 'enum',
    knownGap: 'boolean',
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
 */
const SUMMARY_TEMPLATES = Object.freeze({
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
  'mcp-server-known-gap': {
    params: { product: 'enum:product' },
    render: (p) => `${p.product} MCP server 当前不暴露版本自省能力，此诊断为已知产品缺口`,
  },
  'mcp-server-not-applicable': {
    params: { product: 'enum:product' },
    render: (p) => `${p.product} 没有对应的 MCP server，该组合在设计上不存在对应物`,
  },
  'hook-trust-not-applicable': {
    params: {},
    render: () => 'Codex 家目录下不存在 hooks.json，hook 信任状态不适用',
  },
  'hook-trust-untrusted': {
    params: {},
    render: () => 'hooks.json 已存在但未见信任记录，hook 在授予信任前不会执行',
  },
  'hook-trust-modified': {
    params: {},
    render: () => 'hook 脚本内容已变更导致既有信任失效，需要重新授予信任',
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
 * 经实测验证确实能达成目标状态」，而 hook 信任授予的确切命令形态尚未经 SC-013 人工
 * 验证（T062 挂账）。填一个看似合理实则无效的步骤，比不给步骤更有害。
 */
const REMEDIATION_TEMPLATES = Object.freeze({
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
    text: '请在 MCP 客户端中重新加载该 server 后重跑本诊断。',
  },
  'grant-hook-trust': {
    command: null,
    text: '请参考 Codex 官方文档，在 Codex 客户端中完成 hook 信任授予；在授予完成前 hook 不会执行。',
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
 * @param {{hooksJsonPresent: boolean,
 *          hooksJsonProbe?: {outcome: string, errorClass: string|null}|null,
 *          configProbe: {outcome: string, errorClass: string|null},
 *          stateSection: {kind: string, trustedHash?: string|null},
 *          currentHash: string|null}} input
 */
export function classifyHookTrust(input) {
  const { hooksJsonPresent, hooksJsonProbe = null, configProbe, stateSection, currentHash } = input;
  const hooksProbeEntry = {
    id: 'codex-home-hooks-json',
    outcome: hooksJsonProbe?.outcome ?? (hooksJsonPresent ? 'found' : 'absent'),
    errorClass: hooksJsonProbe?.errorClass ?? null,
  };
  const stateProbeEntry = { id: 'config-toml-hooks-state', ...deriveHooksStateProbe(configProbe, stateSection) };
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
  ];

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
    return {
      status: 'not-applicable',
      trustStatus: 'not-applicable',
      summaryCode: 'hook-trust-not-applicable',
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
