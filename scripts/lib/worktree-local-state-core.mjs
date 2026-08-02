import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Feature 239（M9 轨道 A）— worktree/local 状态的内容合同校验。
//
// 两个消费方共用本模块的同一份纯函数（plan 决策 3/4「同一纯函数双消费」）：
// - `tests/unit/worktreeinclude-contract.test.ts` 直接 import（开发期红绿迭代快）
// - `scripts/lib/repo-maintenance-core.mjs::validateRepository` 聚合为第 15 族（提交前强制门禁；F238 的 model-literal-gate 先 ship 占 14）
//
// 零第三方依赖：只用 node 内置模块，使本模块在未 `npm install` 的全新 worktree 里也能执行。

export const AGENTS_BYTE_BUDGET = 32768;
export const WORKTREEINCLUDE_FILENAME = '.worktreeinclude';

/** Codex 在仓库根同层「二选一」读取的候选文档（FR-008：按 max 不按 sum）。 */
const AGENTS_CANDIDATES = ['AGENTS.md', 'AGENTS.override.md'];

function createCheck(id, title, status, evidence = {}) {
  return { id, title, status, evidence };
}

/**
 * 解析 `.worktreeinclude` 内容为条目序列。
 *
 * 本函数与 `sync-worktree-local-state.sh::read_worktreeinclude_entries()` 是同一份 grammar 的
 * 两套独立实现，任何改动都必须两侧同步，并由 `worktreeinclude-golden-matrix.test.ts` 逐字节对拍。
 *
 * grammar 五条（plan 决策 4 钉死）：
 *   1. 文件首只剥一次 UTF-8 BOM（不在中间/每行重复剥）
 *   2. 每行剥单个尾部 `\r`（兼容 CRLF）
 *   3. 不做其他任何 trim——含空格的条目按字面处理，交由后续校验自然拒绝
 *   4. `#` 仅当是行首第一个字符时才是整行注释；行内 `#` 不触发注释语义
 *   5. 末行无换行符必须被接受
 *
 * @param {string} content
 * @returns {string[]}
 */
export function parseWorktreeInclude(content) {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const entries = [];

  for (const rawLine of withoutBom.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) continue;
    if (line[0] === '#') continue;
    entries.push(line);
  }

  return entries;
}

/**
 * 语法类拒绝规则（FR-001(a)）。
 *
 * 顺序即判定优先级：先判"首字符位置"类（absolute-path/negation-prefix），再判"字符集"类
 * （escape-char/glob-char），再判 trailing-slash，最后判路径段类（dot-dot-segment）。
 * `trailing-slash` 必须整体排在存在性/ignored 类之前——`.env.local/` 能通过 `git check-ignore`，
 * 且尾斜杠会让存在性检查解析到目录本身而绕过 `not-regular-file` 判定。
 */
const SYNTAX_RULES = [
  ['absolute-path', (entry) => entry.startsWith('/')],
  ['negation-prefix', (entry) => entry.startsWith('!')],
  ['escape-char', (entry) => entry.includes('\\')],
  ['glob-char', (entry) => /[*?[\]]/.test(entry)],
  ['trailing-slash', (entry) => entry.endsWith('/')],
  ['dot-dot-segment', (entry) => entry.split('/').includes('..')],
];

/**
 * 判断 `projectRoot` 是否位于 git 工作树内（决定 ignored 子检查是否可执行）。
 *
 * @param {string} projectRoot
 * @returns {boolean}
 */
export function isGitWorkTree(projectRoot) {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: projectRoot,
    encoding: 'utf-8',
  });
  return result.status === 0 && (result.stdout ?? '').trim() === 'true';
}

/**
 * 单条目 ignored 判定。
 *
 * `git check-ignore` 退出码：0 = 命中忽略规则，1 = 未命中，其余（128 等）= git 无法判定。
 *
 * C2 修订：128 **不再**当作"未拒绝"放行。实测 `git check-ignore -- <穿过 symlink 的路径>`
 * 返回 `fatal: beyond a symbolic link` + 128，旧实现把它视为"无法判定→不拒绝"，于是一条
 * 逃逸到仓库外的路径可以同时绕过 ignored 前提与词法过滤。128 现在有独立 reason，
 * 便于与"确实未被忽略"在日志上区分。
 *
 * @returns {'ignored' | 'not-ignored' | 'error'}
 */
function classifyGitIgnore(projectRoot, entry) {
  const result = spawnSync('git', ['check-ignore', '--quiet', '--', entry], { cwd: projectRoot });
  if (result.status === 0) return 'ignored';
  if (result.status === 1) return 'not-ignored';
  return 'error';
}

/**
 * 在 `root` 下逐段下降，返回第一个是 symlink 的**已存在**路径组件（含最终对象）。
 *
 * 为什么必须逐组件 lstat：`lstat(entry)` 只对**最终对象**免解引用，中间组件仍会被内核解析。
 * 仓库里的 `_reference` 就是指向主工作区的目录软链——`_reference/x/y.env` 在旧实现下
 * `[[ -f ]]` 为真、`lstat().isFile()` 为真，于是一条物理上位于仓库外的路径被判为合法条目。
 *
 * `includeFinal=false` 只判父目录组件：copy 的 **target 侧**最终对象若是 symlink，运行时由
 * `copy_path` 安全处置（`rm -f` 删的是链接自身，绝不写穿，随后写出真实文件——这正是 F213 起
 * 被测试守护的"遗留 .env.local 软链迁移为 copy"路径）；父目录 symlink 则没有这层保护。
 *
 * @param {string} root
 * @param {string} entry
 * @param {{ includeFinal?: boolean }} [options]
 * @returns {string | null} 命中的 symlink 绝对路径；无命中返回 null
 */
function findSymlinkComponent(root, entry, { includeFinal = true } = {}) {
  let current = path.resolve(root);
  const components = entry.split('/').filter((component) => component.length > 0);

  for (const [index, component] of components.entries()) {
    current = path.join(current, component);
    if (!includeFinal && index === components.length - 1) return null;
    let stats;
    try {
      stats = fs.lstatSync(current);
    } catch {
      // 该组件不存在 → 其下更深的组件也不可能存在，无需继续下降
      return null;
    }
    if (stats.isSymbolicLink()) return current;
  }

  return null;
}

/**
 * 校验单个条目是否落在 FR-001 定义的安全公共子集内。
 *
 * 10 类拒绝 reason：absolute-path / dot-dot-segment / glob-char / negation-prefix / escape-char /
 * trailing-slash / not-ignored / check-ignore-error / symlink-component / not-regular-file。
 *
 * 判定顺序（bash 侧 `validate_entry` 必须逐条对齐）：
 *   语法类（前 6）→ check-ignore（0 通过 / 1 not-ignored / 其余 check-ignore-error）
 *   → symlink 组件（跨全部 root）→ not-regular-file
 * 全部校验都在任何读写之前完成（FR-003：拒绝的条目绝不进入 copy 通道）。
 *
 * FR-001(c)：路径**存在**时必须是常规文件；**不存在不视为违规**——ignored 文件在干净 checkout
 * 中缺席是常态（CI 里 `.env.local` 本就不存在）。
 *
 * @param {string} entry
 * @param {{ projectRoot: string, gitAvailable?: boolean, extraRoots?: string[] }} options
 *   `extraRoots`：条目还会被拼接到哪些根下（运行时的 copy target 侧）。source 侧干净、
 *   target 侧父目录是 symlink 时，copy 会把文件写出仓库，因此两侧都要校验。
 * @returns {{ valid: true } | { valid: false, reason: string }}
 */
export function validateWorktreeIncludeEntry(
  entry,
  { projectRoot, gitAvailable = true, extraRoots = [] },
) {
  for (const [reason, matches] of SYNTAX_RULES) {
    if (matches(entry)) return { valid: false, reason };
  }

  if (gitAvailable) {
    const ignoreVerdict = classifyGitIgnore(projectRoot, entry);
    if (ignoreVerdict === 'not-ignored') return { valid: false, reason: 'not-ignored' };
    if (ignoreVerdict === 'error') return { valid: false, reason: 'check-ignore-error' };
  }

  // source 侧连最终对象一起判；extraRoots（copy target 侧）只判父目录，语义与
  // bash 侧 `has_symlink_component ... parents-only` 逐条对齐。
  if (findSymlinkComponent(projectRoot, entry) !== null) {
    return { valid: false, reason: 'symlink-component' };
  }
  for (const root of extraRoots) {
    if (findSymlinkComponent(root, entry, { includeFinal: false }) !== null) {
      return { valid: false, reason: 'symlink-component' };
    }
  }

  const absolutePath = path.resolve(projectRoot, entry);
  let stats;
  try {
    stats = fs.lstatSync(absolutePath);
  } catch {
    return { valid: true };
  }
  if (!stats.isFile()) return { valid: false, reason: 'not-regular-file' };

  return { valid: true };
}

/**
 * 校验 `projectRoot/.worktreeinclude` 的内容合同（FR-001）。
 *
 * 分两层（plan 决策 4 / C7）：清单文件缺失**永远** fail（非 git 沙箱也不豁免）；单条目的 ignored
 * 子检查在非 git 环境降级为 skip（记进 checks，不进 warnings/errors，不拖累整体族状态）。
 *
 * @param {{ projectRoot: string }} options
 * @returns {{ status: 'pass'|'warn'|'skip'|'fail', checks: Array<object>, warnings: string[], errors: string[] }}
 */
export function validateWorktreeIncludeContract({ projectRoot }) {
  const resolvedRoot = path.resolve(projectRoot);
  const warnings = [];
  const errors = [];
  const checks = [];

  const manifestPath = path.join(resolvedRoot, WORKTREEINCLUDE_FILENAME);

  // W7：清单本身也可能异常（缺失 / 目录 / symlink / 不可读）。用 lstat 免解引用地判定，
  // 并把读取异常收敛为**本族的结构化 fail**——第 15 族在 repo:check 里是聚合调用，
  // 裸抛异常会让整份报告变成一段栈，其余 13 族的结论一并丢失。
  let manifestStats = null;
  try {
    manifestStats = fs.lstatSync(manifestPath);
  } catch {
    manifestStats = null;
  }

  if (manifestStats === null) {
    errors.push(
      `未找到 ${WORKTREEINCLUDE_FILENAME}：它是 copy 类本地态清单的唯一事实源（Codex 官方与 sync 脚本共同消费），必须存在于仓库根。`,
    );
    checks.push(
      createCheck('worktreeinclude-exists', '.worktreeinclude 清单存在', 'fail', {
        manifestPath: WORKTREEINCLUDE_FILENAME,
      }),
    );
    return { status: 'fail', checks, warnings, errors };
  }

  if (!manifestStats.isFile()) {
    const kind = manifestStats.isSymbolicLink() ? 'symlink' : manifestStats.isDirectory() ? '目录' : '非常规文件';
    errors.push(
      `${WORKTREEINCLUDE_FILENAME} 必须是常规文件，当前为${kind}——清单本身若可被 symlink 重定向，其内容合同就不再受本仓库控制。`,
    );
    checks.push(
      createCheck('worktreeinclude-exists', '.worktreeinclude 清单存在', 'fail', {
        manifestPath: WORKTREEINCLUDE_FILENAME,
        kind,
      }),
    );
    return { status: 'fail', checks, warnings, errors };
  }

  checks.push(
    createCheck('worktreeinclude-exists', '.worktreeinclude 清单存在', 'pass', {
      manifestPath: WORKTREEINCLUDE_FILENAME,
    }),
  );

  let rawManifest;
  try {
    rawManifest = fs.readFileSync(manifestPath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${WORKTREEINCLUDE_FILENAME} 读取失败：${message}`);
    checks.push(
      createCheck('worktreeinclude-entries', '清单条目全部落在 FR-001 安全公共子集内', 'fail', {
        readError: message,
      }),
    );
    return { status: 'fail', checks, warnings, errors };
  }

  const entries = parseWorktreeInclude(rawManifest);
  const gitAvailable = isGitWorkTree(resolvedRoot);

  const violations = [];
  for (const entry of entries) {
    const verdict = validateWorktreeIncludeEntry(entry, { projectRoot: resolvedRoot, gitAvailable });
    if (!verdict.valid) violations.push({ entry, reason: verdict.reason });
  }

  for (const violation of violations) {
    errors.push(
      `${WORKTREEINCLUDE_FILENAME} 条目 "${violation.entry}" 不满足安全公共子集：${violation.reason}。`,
    );
  }

  checks.push(
    createCheck(
      'worktreeinclude-entries',
      '清单条目全部落在 FR-001 安全公共子集内',
      violations.length > 0 ? 'fail' : 'pass',
      { entryCount: entries.length, violations },
    ),
  );

  checks.push(
    createCheck(
      'worktreeinclude-ignored-verified',
      '清单条目的 git ignored 前提已核验',
      gitAvailable ? 'pass' : 'skip',
      gitAvailable ? { entryCount: entries.length } : { reason: 'not-a-git-repo' },
    ),
  );

  return {
    status: errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
    checks,
    warnings,
    errors,
  };
}

/**
 * 校验 Codex 同层 active 文档的字节预算（FR-008）。
 *
 * 按 max 不按 sum：`AGENTS.override.md` 存在时是**取代** `AGENTS.md` 而非叠加读取，因此两者各自
 * 与预算比较，取较大者决定结论。超限判 error 而非 warning——超出 `project_doc_max_bytes` 时
 * Codex 会静默截断文档，规则后半段直接失效且无任何运行时信号，属于必须阻断的功能性破坏。
 *
 * TODO(follow-up): nested AGENTS.md 累计——当前仓库经实测只有根一份，出现 nested 时需按
 * root→cwd 路径累计计算，本函数在此处扩展 candidate 收集逻辑即可。
 *
 * @param {{ projectRoot: string }} options
 * @returns {{ status: 'pass'|'warn'|'skip'|'fail', checks: Array<object>, warnings: string[], errors: string[] }}
 */
export function validateAgentsByteBudget({ projectRoot }) {
  const resolvedRoot = path.resolve(projectRoot);
  const warnings = [];
  const errors = [];
  const checks = [];

  const present = [];
  for (const name of AGENTS_CANDIDATES) {
    const candidatePath = path.join(resolvedRoot, name);
    if (!fs.existsSync(candidatePath)) continue;
    present.push({ name, bytes: fs.statSync(candidatePath).size });
  }

  if (present.length === 0) {
    checks.push(
      createCheck('agents-byte-budget', 'AGENTS 文档字节数在 Codex 预算内', 'skip', {
        reason: 'no-agents-doc',
        budgetBytes: AGENTS_BYTE_BUDGET,
      }),
    );
    return { status: 'skip', checks, warnings, errors };
  }

  const oversized = present.filter((file) => file.bytes > AGENTS_BYTE_BUDGET);
  for (const file of oversized) {
    errors.push(
      `${file.name} 为 ${file.bytes} bytes，超过 Codex project_doc_max_bytes 预算 ${AGENTS_BYTE_BUDGET}（超限部分会被静默截断），请拆分或精简。`,
    );
  }

  const largest = present.reduce((max, file) => (file.bytes > max.bytes ? file : max));

  checks.push(
    createCheck(
      'agents-byte-budget',
      'AGENTS 文档字节数在 Codex 预算内（按 max 不按 sum）',
      oversized.length > 0 ? 'fail' : 'pass',
      {
        budgetBytes: AGENTS_BYTE_BUDGET,
        files: present,
        largest: largest.name,
        largestBytes: largest.bytes,
      },
    ),
  );

  return {
    status: errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
    checks,
    warnings,
    errors,
  };
}

/**
 * 第 15 族 `worktree-local-state` 的聚合入口，供 repo:check 通过 `aggregateValidation` 调用。
 *
 * @param {{ projectRoot: string }} options
 * @returns {{ status: 'pass'|'warn'|'skip'|'fail', checks: Array<object>, warnings: string[], errors: string[] }}
 */
export function validateWorktreeLocalState({ projectRoot }) {
  const results = [
    validateWorktreeIncludeContract({ projectRoot }),
    validateAgentsByteBudget({ projectRoot }),
  ];

  const checks = results.flatMap((result) => result.checks);
  const warnings = results.flatMap((result) => result.warnings);
  const errors = results.flatMap((result) => result.errors);

  return {
    status: errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
    checks,
    warnings,
    errors,
  };
}
