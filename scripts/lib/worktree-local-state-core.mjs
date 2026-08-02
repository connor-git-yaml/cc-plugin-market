import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Feature 239（M9 轨道 A）— worktree/local 状态的内容合同校验。
//
// 两个消费方共用本模块的同一份纯函数（plan 决策 3/4「同一纯函数双消费」）：
// - `tests/unit/worktreeinclude-contract.test.ts` 直接 import（开发期红绿迭代快）
// - `scripts/lib/repo-maintenance-core.mjs::validateRepository` 聚合为第 14 族（提交前强制门禁）
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
 * `git check-ignore` 退出码：0 = 命中忽略规则，1 = 未命中，其余（128 等）= 无法判定。
 * 无法判定时返回 null，由调用方按"不拒绝"处理——门禁不应因 git 自身异常把合法条目判红。
 *
 * @returns {boolean | null}
 */
function isGitIgnored(projectRoot, entry) {
  const result = spawnSync('git', ['check-ignore', '--quiet', '--', entry], { cwd: projectRoot });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return null;
}

/**
 * 校验单个条目是否落在 FR-001 定义的安全公共子集内。
 *
 * 8 类拒绝 reason：absolute-path / dot-dot-segment / glob-char / negation-prefix / escape-char /
 * trailing-slash / not-ignored / not-regular-file；语法类（前 6）整体优先于存在性与 ignored 类。
 *
 * FR-001(c)：路径**存在**时必须是常规文件；**不存在不视为违规**——ignored 文件在干净 checkout
 * 中缺席是常态（CI 里 `.env.local` 本就不存在）。
 *
 * @param {string} entry
 * @param {{ projectRoot: string, gitAvailable?: boolean }} options
 * @returns {{ valid: true } | { valid: false, reason: string }}
 */
export function validateWorktreeIncludeEntry(entry, { projectRoot, gitAvailable = true }) {
  for (const [reason, matches] of SYNTAX_RULES) {
    if (matches(entry)) return { valid: false, reason };
  }

  if (gitAvailable && isGitIgnored(projectRoot, entry) === false) {
    return { valid: false, reason: 'not-ignored' };
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

  if (!fs.existsSync(manifestPath)) {
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

  checks.push(
    createCheck('worktreeinclude-exists', '.worktreeinclude 清单存在', 'pass', {
      manifestPath: WORKTREEINCLUDE_FILENAME,
    }),
  );

  const entries = parseWorktreeInclude(fs.readFileSync(manifestPath, 'utf-8'));
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
 * 第 14 族 `worktree-local-state` 的聚合入口，供 repo:check 通过 `aggregateValidation` 调用。
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
