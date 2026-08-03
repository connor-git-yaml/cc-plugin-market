// Feature 241（M9 轨道 B4）— 图消费决策 CLI（FR-008/009/010）。
//
// 与 `orchestrator-cli.mjs` / `goal-loop-cli.mjs` 并列的兄弟 CLI。刻意**不**挂进 goal-loop-cli：
// 决策判定同时服务 goal_loop 闭环与 `agent_mode: single` 的常规 implement/verify 散文路径，
// 两侧地位对等；塞进"goal-loop 专属 CLI"会让文件语义漂移，也会让散文层看起来在借用别人的工具。
//
// **两个子命令，不是一个**（FR-009 / plan §1.4）：`impact` 是 Spectra MCP tool，`.mjs` 脚本不持有
// MCP client 协议栈，也没有等价的 `spectra impact` CLI 出口可 spawn，所以 impact 必须由调用方
// （编排 agent）自己发起。时序固定为：`decide` →（若出口需要消费）调用方发起 MCP impact →
// `annotate-caveat`。
//
//   node graph-consumption-cli.mjs decide --project-root <path> [--phase <name>]
//        [--base-ref <ref> | --base-ref-from-trace <trace.md>] --refresh-policy allowed|declined
//        [--advisory [--tasks-file <tasks.md>]] [--dry-run] [--format json|text]
//        [--spectra-bin <path>] [--refresh-deadline-ms <n>]
//   node graph-consumption-cli.mjs annotate-caveat --project-root <path> --decision <json|@file>
//        [--impact-result <json|@file>] [--target <symbolId>]
//        --impact-status completed|failed|skipped [--format json|text]
//
// `--target` 是调用方对"这次 impact 问的是哪个 symbol"的显式声明。真实 MCP 返回体里没有这个
// 字段，缺省时 CLI **不猜**：无从判断目标是否在图覆盖范围内，就不做 FR-006 caveat 注解。
//
// **调用方合同（跨调用 once-ness，CLI 不自保证）**：同一 phase + 同一 projectRoot 下，第一次调用
// 可传 `--refresh-policy allowed`，第二次起必须传 `declined`。CLI 是无状态进程，且禁止跨进程锁
// （EC-13）、禁止让生产决策代码读审计文件（W3）——它无法也不试图自行判断"本 phase 是否已刷过"。
// `--phase` 缺省用 sentinel `"unscoped"`：所有未指明 phase 的调用聚为同一组，省略 ≠ 豁免。
//
// **审计是只写不读的观测产物**：本文件只对审计事件流做 append，绝不 readFile 它（RG-006）。
//
// **`--tasks-file` 的作用域边界（D3）**：它只补 `changeClass` 这一个维度，且只在 `--advisory` +
// 工作树无变更文件时生效。`coverageScope` 仍只看 git 变更文件——tasks.md 声明的路径是"打算改什么"，
// 不是"改了什么"，拿它去判图覆盖范围会让一份预判决定要不要花一次全量重建。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { checkFreshness, readEmbeddedGraphMeta } from './lib/graph-bootstrap-status.mjs';
import {
  decideGraphConsumption,
  finalizeAfterRefresh,
  annotateImpactCaveat,
  DEGRADED_REASONS,
  DEGRADED_REASON_HINTS,
  GRAPH_SCOPE_EXTENSIONS,
} from './lib/graph-consumption-decision.mjs';
import { classifyChangeSet } from './lib/git-change-classifier.mjs';
import { executeRefresh } from './lib/graph-refresh-executor.mjs';
import { extractTaskPaths, classifyFromTaskPaths } from './lib/tasks-path-signal.mjs';

// 3（F254）：`decide` 输出与两类审计事件新增 `scopeExtensionsSource`，`decide` 侧另加
// `coverageUnionApplied`（annotate 侧无此字段——注解时点不存在"重建可达面"这一说）。additive 字段
// 不破坏任何现有消费方（审计只写不读），但 schemaVersion 的用途就是让"形状变了"可被显式识别——
// 该 bump 却不 bump，这个字段就会逐渐失去指示意义。
export const AUDIT_SCHEMA_VERSION = 3;
const AUDIT_REL = path.join('.specify', 'graph-consumption-audit.jsonl');
const GRAPH_REL = path.join('specs', '_meta', 'graph.json');
const DEFAULT_PHASE = 'unscoped';
const REFRESH_POLICIES = new Set(['allowed', 'declined']);
const IMPACT_STATUSES = new Set(['completed', 'failed', 'skipped']);

/* --------------------------------------------------------------- 参数解析 */

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

/** `--decision '{"..."}'` 与 `--decision @path/to.json` 两种形态都收。 */
function readJsonArgument(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const raw = value.startsWith('@') ? fs.readFileSync(value.slice(1), 'utf-8') : value;
  return JSON.parse(raw);
}

/* ------------------------------------------------------- phase 起点锚点 */

/**
 * 从 trace.md 文本里取某个 phase 的起点 ref，语义为 **last-match wins**（T-W1）。
 *
 * goal_loop 的多轮 rerun 会往 trace 追加新的 `[HH:MM:SS] phase_start_ref: implement=<sha>` 行，
 * 读取方必须取最后一条——取第一条会让第 N 轮拿着第 1 轮的起点去算 diff，把前面几轮的改动
 * 重复算进本轮变更集。
 *
 * 这条语义之所以做成函数而不是留在散文里让调用方 `grep | tail -1`：散文里的 shell 片段没法被
 * 集成测试断言，而 T-W1 明确要求它进断言。
 *
 * @param {string} traceText
 * @param {string} phase
 * @returns {string|null} 找不到时返回 null，**不猜测**
 */
export function resolvePhaseStartRef(traceText, phase) {
  if (typeof traceText !== 'string' || typeof phase !== 'string' || phase.length === 0) return null;
  const marker = `phase_start_ref: ${phase}=`;
  let found = null;
  for (const line of traceText.split('\n')) {
    const index = line.indexOf(marker);
    if (index === -1) continue;
    const value = line.slice(index + marker.length).trim();
    if (value.length > 0) found = value;
  }
  return found;
}

/* ----------------------------------------------------------- 五维输入采集 */

function runGit(projectRoot, args) {
  const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? (result.stdout ?? '') : '';
}

/**
 * `changeClass` + 变更文件清单。
 *
 * `--base-ref` 缺省时只看工作树差异（`baseRefMissing: true`）——这不是等价替代：
 * 已 commit 的改动会整体看不见，因此调用方在权威判定时必须传 base-ref。
 */
function collectChangeSet(projectRoot, baseRef) {
  const nameStatusText = baseRef ? runGit(projectRoot, ['diff', '--name-status', '-z', `${baseRef}..`]) : '';
  const porcelainText = runGit(projectRoot, ['status', '--porcelain', '-z', '--untracked-files=all']);
  return classifyChangeSet({ nameStatusText, porcelainText });
}

/**
 * D3 advisory 轮 1 的替补信号：tasks.md 已声明目标文件路径的存在性。
 *
 * **仅在 advisory 且 git 侧无任何变更文件时才会被调用**（调用点强制，见 `runDecide`）。
 * 存在性相对 `--project-root` 解析——tasks.md 里写的是仓内相对路径。
 *
 * 读不到文件只降级为 warning：advisory 是"预判"，缺了它退回 `unknown` 即可，不该阻断决策。
 *
 * @returns {'modifies-existing'|'additive-only'|'unknown'}
 */
function classifyFromTasksFile(projectRoot, tasksFilePath) {
  let text;
  try {
    text = fs.readFileSync(tasksFilePath, 'utf-8');
  } catch (error) {
    process.stderr.write(
      `[warning] --tasks-file 读取失败，本次不使用 tasks.md 预判信号：${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 'unknown';
  }
  // B1-W2 纵深防御：抽取器已拒绝绝对路径与 `..` 段，探测器再按 resolve 后的结果复核一次
  // 包含关系。判据用 `path.relative` 而非字符串前缀——后者会把 `/repo-evil` 当成 `/repo` 的
  // 子路径。落在 projectRoot 之外的候选一律按"不存在"处理，不去碰仓外文件系统。
  const rootWithSep = projectRoot.endsWith(path.sep) ? projectRoot : `${projectRoot}${path.sep}`;
  return classifyFromTaskPaths(extractTaskPaths(text), (filePath) => {
    const resolved = path.resolve(projectRoot, filePath);
    if (resolved !== projectRoot && !resolved.startsWith(rootWithSep)) return false;
    return fs.existsSync(resolved);
  });
}

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
function verifiedSourceCommitOf(meta) {
  if (!meta.ok) return null;
  const sourceCommit = meta.value.sourceCommit;
  return typeof sourceCommit === 'string' && sourceCommit.length > 0 ? sourceCommit : null;
}

/**
 * 只需要 sourceCommit、不需要 fingerprint 的读取路径（刷新后重读产物）。
 *
 * @returns {string|null}
 */
function readVerifiedSourceCommit(graphJsonPath) {
  return verifiedSourceCommitOf(readEmbeddedGraphMeta(graphJsonPath));
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
function collectGraphAvailability(graphJsonPath) {
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

/**
 * 从图内嵌的 collector fingerprint（F249）推导覆盖范围判据用的扩展名并集。
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
 * @param {unknown} fingerprint `graph.json` 的 `graph.fingerprint` 字段，可能是 undefined/null/畸形对象
 * @returns {string[] | null} 排序后的扩展名并集；无法可靠推导时返回 null
 */
function deriveScopeExtensionsFromFingerprint(fingerprint) {
  if (fingerprint === null || typeof fingerprint !== 'object' || Array.isArray(fingerprint)) return null;
  // 未来格式演进：不认就回落，不猜测新形状
  if (fingerprint.formatVersion !== SUPPORTED_FINGERPRINT_FORMAT_VERSION) return null;

  const surface = fingerprint.extensionSurface;
  if (surface === null || typeof surface !== 'object' || Array.isArray(surface)) return null;

  // 严格 key 集合：长度相等 + 已知 key 全在 ⟹ 集合相等（FINGERPRINT_SURFACE_KEYS 无重复项）
  const presentKeys = Object.keys(surface);
  if (presentKeys.length !== FINGERPRINT_SURFACE_KEYS.length) return null;

  const union = new Set();
  for (const key of FINGERPRINT_SURFACE_KEYS) {
    const entry = surface[key];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
    if (!Array.isArray(entry.extensions)) return null;
    for (const extension of entry.extensions) {
      if (typeof extension !== 'string' || extension.length === 0) return null;
      union.add(extension);
    }
  }
  return union.size > 0 ? [...union].sort() : null;
}

/**
 * 覆盖范围判据：本轮变更文件是否**全部**落在图覆盖面之外。
 *
 * "全部之外"而非"存在之外"：混合改动（既有面内文件又有面外文件）里面内部分的 impact 仍然有值，
 * 一有面外文件就整体判 out-of-scope 会把有效信号一起丢掉。
 * 无变更文件时不声称 out-of-scope——那是"不知道"，不是"范围外"。
 *
 * `scopeExtensions` 由调用方算好后显式传入（图自述动态面，或静态 fallback），使本判据与
 * `annotateImpactCaveat` 在同一次调用内消费同一份面（C-002）。
 */
function collectCoverageScope(files, scopeExtensions) {
  if (!Array.isArray(files) || files.length === 0) return 'in-graph-scope';
  const anyInScope = files.some((filePath) => {
    const dot = filePath.lastIndexOf('.');
    const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    if (dot <= slash) return false;
    return scopeExtensions.includes(filePath.slice(dot).toLowerCase());
  });
  return anyInScope ? 'in-graph-scope' : 'out-of-graph-scope';
}

/**
 * 刷新之后的产物复核 + 出口收口（B1-C3）。
 *
 * 审查抓到的形态：刷新成功后输出与 decision 事件仍带着**决策时**读到的 G1，而盘上的图已经是 G2。
 * `annotate-caveat` 会拿 decision 里的 `graphSourceCommit` 和注解时刻的图内嵌值比对，于是主路径
 * （stale → 刷新 → 消费 impact）必然被判 `snapshot-mismatch`，caveat 全丢——FR-006 通道在最常见
 * 的路径上直接失效。
 *
 * 因此刷新成功后必须重读**已验证的产物**：重读值即 G2，写进输出与事件；重读拿不到可用的
 * sourceCommit（刷新与重读之间图被并发抹掉）→ 不得继续声称刷新成功，收口到
 * `refresh-failed-artifact-unusable`，与"进程 exit 0 但产物不可用"的假成功同一处置。
 *
 * 做成导出的纯函数，是因为那条竞态分支在真实进程里靠 sleep 碰不稳；断言必须确定性。
 *
 * @param {{ decision: object, inputs: object,
 *           refresh: { ok: boolean, degradedReason?: string|null },
 *           rereadSourceCommit: unknown }} args
 * @returns {{ decision: object, refreshOk: boolean, graphSourceCommit: string|null,
 *             extraDetail: string|null }}
 */
export function finalizeRefreshOutcome({ decision, inputs, refresh, rereadSourceCommit }) {
  const verified =
    typeof rereadSourceCommit === 'string' && rereadSourceCommit.length > 0 ? rereadSourceCommit : null;

  // 刷新本就失败：出口由 finalizeAfterRefresh 按刷新前 availability 决定；
  // 快照标识如实取重读实况（图被毁掉就是 null，绝不回填刷新前的 G1 冒充"图还在"）
  if (refresh?.ok !== true) {
    return {
      decision: finalizeAfterRefresh({ decision, input: inputs, refresh }),
      refreshOk: refresh?.ok ?? false,
      graphSourceCommit: verified,
      extraDetail: null,
    };
  }

  if (verified !== null) {
    return {
      decision: finalizeAfterRefresh({ decision, input: inputs, refresh }),
      refreshOk: true,
      graphSourceCommit: verified,
      extraDetail: null,
    };
  }

  return {
    decision: finalizeAfterRefresh({
      decision,
      input: inputs,
      refresh: { ok: false, degradedReason: DEGRADED_REASONS.REFRESH_FAILED_ARTIFACT_UNUSABLE },
    }),
    refreshOk: false,
    graphSourceCommit: null,
    extraDetail: 'post-refresh-reread-failed',
  };
}

/* ------------------------------------------------------------- 审计写入器 */

/**
 * append-only 事件写入器，`decide` 与 `annotate-caveat` 共用同一条路径。
 *
 * 单次 `appendFileSync` 写完整一行（行内不含裸换行）以对并发写安全；
 * 写失败降级为 stderr warning，**不得**阻断决策返回——审计是观测产物，不是决策前置条件。
 *
 * @returns {boolean} 是否写成功
 */
function appendAuditEvent(projectRoot, event) {
  const auditPath = path.join(projectRoot, AUDIT_REL);
  try {
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.appendFileSync(auditPath, `${JSON.stringify(event)}\n`);
    return true;
  } catch (error) {
    process.stderr.write(
      `[warning] 审计事件写入失败（不影响决策结果）：${error instanceof Error ? error.message : String(error)}\n`,
    );
    return false;
  }
}

/* -------------------------------------------------------------- 输出渲染 */

function renderDecisionText(payload) {
  const lines = [
    `outcome: ${payload.outcome}`,
    `matchedRule: ${payload.matchedRule}`,
    `advisory: ${payload.advisory}`,
    `inputs: ${JSON.stringify(payload.inputs)}`,
    // 这两个字段的立项理由就是可观测性；只进 JSON 而人读格式看不见，等于自相矛盾
    `scopeExtensionsSource: ${payload.scopeExtensionsSource}`,
    `coverageUnionApplied: ${payload.coverageUnionApplied}`,
  ];
  if (payload.degradedReason !== null) {
    lines.push(`degradedReason: ${payload.degradedReason}`);
    lines.push(`hint: ${DEGRADED_REASON_HINTS[payload.degradedReason] ?? ''}`);
  }
  if (payload.caveats.length > 0) lines.push(`caveats: ${payload.caveats.join(', ')}`);
  if (payload.refreshAttempted) lines.push(`refresh: ok=${payload.refreshOk} durationMs=${payload.refreshDurationMs}`);
  for (const entry of payload.plan) lines.push(entry);
  return `${lines.join('\n')}\n`;
}

/* ---------------------------------------------------------------- decide */

async function runDecide(flags) {
  const projectRoot = typeof flags['project-root'] === 'string' ? path.resolve(flags['project-root']) : null;
  if (projectRoot === null) {
    process.stderr.write('缺少必需参数 --project-root <path>\n');
    return 2;
  }
  const refreshPolicy = flags['refresh-policy'];
  if (!REFRESH_POLICIES.has(refreshPolicy)) {
    process.stderr.write('参数 --refresh-policy 必须是 allowed | declined\n');
    return 2;
  }

  const format = flags.format === 'text' ? 'text' : 'json';
  const advisory = flags.advisory === true;
  const dryRun = flags['dry-run'] === true;
  const phase = typeof flags.phase === 'string' ? flags.phase : DEFAULT_PHASE;
  // `--base-ref-from-trace` 是给编排层用的便捷入口：直接指 trace.md，由 CLI 按 last-match-wins
  // 取出该 phase 最后一次的起点 ref（T-W1）。显式 `--base-ref` 优先级更高。
  let baseRef = typeof flags['base-ref'] === 'string' ? flags['base-ref'] : null;
  if (baseRef === null && typeof flags['base-ref-from-trace'] === 'string') {
    try {
      baseRef = resolvePhaseStartRef(fs.readFileSync(flags['base-ref-from-trace'], 'utf-8'), phase);
    } catch {
      // trace 读不到就当没有锚点：输出会标 baseRefMissing:true，不静默冒充"有"
      baseRef = null;
    }
  }
  const spectraBin = typeof flags['spectra-bin'] === 'string' ? flags['spectra-bin'] : 'spectra';
  // 缺省时沿用 canonical 的默认重建预算；显式传入是给有时间预算的调用方（CI / 短 phase）用的
  const refreshDeadlineMs = Number(flags['refresh-deadline-ms']);
  if (flags['refresh-deadline-ms'] !== undefined && !(Number.isFinite(refreshDeadlineMs) && refreshDeadlineMs > 0)) {
    process.stderr.write('参数 --refresh-deadline-ms 必须是正整数毫秒\n');
    return 2;
  }
  const graphJsonPath = path.join(projectRoot, GRAPH_REL);

  const { changeClass: gitChangeClass, files } = collectChangeSet(projectRoot, baseRef);

  // D3 双合同的分界线就在这几行：
  // - 权威合同（无 `--advisory`）**只认 git diff**，传了 `--tasks-file` 也忽略并显式告警。
  //   静默忽略等于让调用方以为预判被采纳了，那才是最坏形态。
  // - advisory 合同下 git 信号仍然优先：只有工作树确实没有任何变更文件（轮 1 的真实形态）时，
  //   才退而用 tasks.md 的目标路径存在性补位。
  const tasksFile = typeof flags['tasks-file'] === 'string' ? flags['tasks-file'] : null;
  let changeClass = gitChangeClass;
  if (tasksFile !== null) {
    if (!advisory) {
      process.stderr.write(
        '[warning] --tasks-file 仅在 --advisory 合同下生效（权威判定只认 git diff，D3）；本次已忽略该参数\n',
      );
    } else if (files.length === 0) {
      changeClass = classifyFromTasksFile(projectRoot, tasksFile);
    }
  }

  const { graphAvailability, graphSourceCommit, graphFingerprint } = collectGraphAvailability(graphJsonPath);
  // F254：覆盖面优先取图自述的采集面（图能回答"我收了哪些扩展名"就以它为准），推不出来才回落静态面。
  const derivedScopeExtensions = deriveScopeExtensionsFromFingerprint(graphFingerprint);
  const scopeExtensionsSource = derivedScopeExtensions !== null ? 'graph-fingerprint' : 'static-fallback';

  // ---------------------------------------------------------------------------
  // W-1：coverage 判据的面**按 refreshPolicy 分支**，因为两种策略下问的根本不是同一个问题。
  //
  // - `declined`（不允许重建）问的是：「**手里这份图**能不能反映这次改动？」
  //   → 用图自述面（推不出来才回落静态面）。图确实不含该扩展，判 out-of-graph-scope 是正确的。
  //
  // - `allowed`（允许重建）问的是：「**重建之后**的图能不能反映这次改动？」
  //   → 用 union(图自述面, 静态面) 这个「重建可达面」。静态面锚定的是**本仓源码 SSoT**
  //     （`src/collector-surface.ts`，由跨语言合同测试守护）；重建则由**分开安装**的 spectra
  //     二进制执行，合同测试锚不到那个运行时的面。因此"静态面 = 重建后新图会自述的面"只在
  //     plugin 与执行重建的 collector **同版本**时成立。
  //
  // 不分支会自锁（复审沙箱实测）：一份扩面之前建的旧图（自述面窄）遇上面外扩展的改动，
  // 矩阵行 2 在 availability/freshness 之前早退成 consume-degraded → 刷新永不发生 → 图永远还是
  // 那份旧图 → 下次同样早退。而重建恰恰能解决它——面窄正是因为图旧。
  //
  // **行 2 的位置前提在分支化之后依然成立**（这是不能动矩阵的原因，也是这段注释的要点）：
  // 行 2 的论证是「范围外的目标即便重建也进不了图，刷新纯属浪费」。分支化之后，`allowed` 下能走到
  // 行 2 的只剩「目标同时落在图自述面**和**本仓静态面之外」——那才是货真价实的"重建也进不去"。
  // 严格地说：该论证**在 plugin 与执行重建的 collector 同版本这一前提下恒真**；跨版本 skew 时
  // （安装的 spectra 比 plugin 新、采集面更宽）并集仍可能窄于重建后的真实面，此时该改动会被判
  // 范围外而错过一次本可命中的重建——残留风险与修复前**同向**（都是"该刷没刷"，不会反向变成
  // "不该刷却刷"），量级则远小于修复前（修复前是任何面外扩展恒自锁）。
  // 落在并集内、但不在图自述面内的目标现在不再命中行 2，而是继续走 availability/freshness 分支
  // （stale×allowed → 行 8 刷新）——这正是修复的那条路径。
  //
  // EC-07 不受影响：本分支只改矩阵**入参**的算法，`finalizeAfterRefresh` 仍不重跑矩阵。
  // ---------------------------------------------------------------------------
  const refreshAllowed = refreshPolicy === 'allowed';
  const coverageUnionApplied = refreshAllowed && derivedScopeExtensions !== null;
  const coverageScopeExtensions = coverageUnionApplied
    ? [...new Set([...derivedScopeExtensions, ...GRAPH_SCOPE_EXTENSIONS])].sort()
    : (derivedScopeExtensions ?? GRAPH_SCOPE_EXTENSIONS);

  // freshness 的唯一权威来源是 canonical 的 checkFreshness（RG-006）：本文件既不缓存它、
  // 也不自己拿 graph.sourceCommit 去比 HEAD 复算一份。
  const freshnessVerdict = await checkFreshness(projectRoot, { graphJsonPath, spectraBin });
  const inputs = {
    changeClass,
    graphAvailability,
    freshness: freshnessVerdict.state,
    coverageScope: collectCoverageScope(files, coverageScopeExtensions),
    refreshPolicy,
  };

  let decision = decideGraphConsumption(inputs);
  const plan = [];
  let refreshAttempted = false;
  let refreshOk = null;
  let refreshDurationMs = null;
  let refreshDetail = null;
  // 未发生刷新时，报出的快照标识就是决策时刻读到的那一个
  let effectiveGraphSourceCommit = graphSourceCommit;

  if (decision.outcome === 'refresh-then-consume') {
    if (dryRun) {
      plan.push(`[dry-run] 拟执行全量重建: ${spectraBin} batch --mode graph-only（cwd=${projectRoot}）`);
    } else {
      // FR-008 进程内 single-flight：整条链路里这是唯一一次构建 spawn，刷新后不重跑矩阵
      const refresh = await executeRefresh({
        projectRoot,
        spectraBin,
        refreshPolicy,
        deadlineMs: Number.isFinite(refreshDeadlineMs) ? refreshDeadlineMs : undefined,
      });
      refreshAttempted = refresh.attempted;
      refreshDurationMs = refresh.durationMs;
      refreshDetail = refresh.detail;

      // B1-C3：刷新动过图，决策时读到的 G1 已经作废——必须重读已验证产物拿 G2，
      // 否则 annotate-caveat 的快照校验会在主路径上恒判 snapshot-mismatch，caveat 全丢
      const finalized = finalizeRefreshOutcome({
        decision,
        inputs,
        refresh,
        rereadSourceCommit: readVerifiedSourceCommit(graphJsonPath),
      });
      decision = finalized.decision;
      refreshOk = finalized.refreshOk;
      effectiveGraphSourceCommit = finalized.graphSourceCommit;
      if (finalized.extraDetail !== null) {
        refreshDetail = [refreshDetail, finalized.extraDetail].filter((part) => part).join(' ');
      }
    }
  }
  if (dryRun) plan.push('[dry-run] 拟追加 kind:"decision" 审计事件（本次未写）');

  const decisionId = crypto.randomUUID();
  const ts = new Date().toISOString();

  // FR-010：非 dry-run 时**无条件当场**落一条 decision 事件——无论出口为何、无论调用方是否
  // 再跑 annotate-caveat。两步之间 crash 也不会漏记。
  const auditWritten = dryRun
    ? false
    : appendAuditEvent(projectRoot, {
        kind: 'decision',
        schemaVersion: AUDIT_SCHEMA_VERSION,
        decisionId,
        ts,
        projectRoot,
        phase,
        advisory,
        inputs,
        scopeExtensionsSource,
        coverageUnionApplied,
        outcome: decision.outcome,
        degradedReason: decision.degradedReason,
        caveats: [],
        graphSourceCommit: effectiveGraphSourceCommit,
        refreshAttempted,
        refreshOk,
        refreshDurationMs,
      });

  const payload = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    decisionId,
    ts,
    projectRoot,
    phase,
    advisory,
    dryRun,
    inputs,
    // 决策元信息（可观测性），刻意不混进 inputs 五维——它们不是决策矩阵的输入维度。
    // `coverageUnionApplied`：本次 coverage 判据是否用了「重建可达面」并集（见上方 W-1 分支注释）。
    // 它虽可由 `inputs.refreshPolicy === 'allowed' && scopeExtensionsSource === 'graph-fingerprint'`
    // 反推，但那要求读者先知道分支规则；而这个布尔决定了"要不要花一次全量重建"，
    // 审计应当直接陈述，而不是让人重新实现一遍策略逻辑。
    //
    // **时点**：这两个字段与 `inputs` 同属**决策时点**，刷新成功后不重算——因此它们描述的图
    // 与刷新后重读得到的 `graphSourceCommit`（刷新时点）**不是同一份图**。读审计时别把两者
    // 当成同一快照的两个侧面。
    scopeExtensionsSource,
    coverageUnionApplied,
    changedFiles: files,
    outcome: decision.outcome,
    // advisory 结论不得被当作权威判定（FR-011）：它只允许决定"要不要预刷一次图"与注入语气，
    // 不允许产生"impact 不适用"这类终态结论，因此权威字段在 advisory 下恒为 null。
    authoritativeOutcome: advisory ? null : decision.outcome,
    degradedReason: decision.degradedReason,
    fallbackHint: decision.fallbackHint,
    caveats: decision.caveats,
    matchedRule: decision.matchedRule,
    graphSourceCommit: effectiveGraphSourceCommit,
    baseRefMissing: baseRef === null,
    refreshAttempted,
    refreshOk,
    refreshDurationMs,
    refreshDetail,
    auditWritten,
    plan,
  };

  process.stdout.write(format === 'text' ? renderDecisionText(payload) : `${JSON.stringify(payload, null, 2)}\n`);
  return 0;
}

/* -------------------------------------------------------- annotate-caveat */

function runAnnotateCaveat(flags) {
  const projectRoot = typeof flags['project-root'] === 'string' ? path.resolve(flags['project-root']) : null;
  if (projectRoot === null) {
    process.stderr.write('缺少必需参数 --project-root <path>\n');
    return 2;
  }

  let decision;
  try {
    decision = readJsonArgument(flags.decision);
  } catch (error) {
    process.stderr.write(`--decision 解析失败：${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  if (decision === null || typeof decision !== 'object') {
    process.stderr.write('缺少必需参数 --decision <json|@file>（decide 的原样输出）\n');
    return 2;
  }

  const impactStatusFlag = flags['impact-status'];
  if (!IMPACT_STATUSES.has(impactStatusFlag)) {
    process.stderr.write('参数 --impact-status 必须是 completed | failed | skipped\n');
    return 2;
  }

  let impactResult = null;
  try {
    impactResult = readJsonArgument(flags['impact-result']);
  } catch (error) {
    process.stderr.write(`--impact-result 解析失败：${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  const format = flags.format === 'text' ? 'text' : 'json';
  // `--target` 由调用方显式声明本次 impact 查询的 symbolId：真实 MCP 返回体里没有这个字段，
  // 只有发起查询的人知道问的是谁。缺省不猜（B1-C4）——猜错方向是"凭空给出可信度声明"。
  const target = typeof flags.target === 'string' ? flags.target : null;
  if (target === null && impactStatusFlag === 'completed') {
    process.stderr.write(
      '[warning] 未传 --target <symbolId>：无从判断查询目标是否在图覆盖范围内，本次不做 FR-006 caveat 注解\n',
    );
  }
  // 一次读取拿两个字段：快照标识与覆盖面必须来自**同一次**解析，否则两者可能分属不同图状态。
  const graphMetaAtAnnotation = readEmbeddedGraphMeta(path.join(projectRoot, GRAPH_REL));
  const graphSourceCommitAtAnnotation = verifiedSourceCommitOf(graphMetaAtAnnotation);

  // F254：覆盖面按**注解时点**独立重新推导，绝不透传 decide 阶段的值。decide 与 annotate-caveat
  // 是两个独立进程，中间隔着一次真实 MCP impact 调用，图状态可能已经变了。快照校验（FR-010）
  // 已经在处理"图变了"这件事；覆盖面若仍沿用上一份图的口径，就会多出一个
  // "sourceCommit 校验过了、判据却是旧图的"不一致窗口。
  const derivedScopeExtensionsAtAnnotation = graphMetaAtAnnotation.ok
    ? deriveScopeExtensionsFromFingerprint(graphMetaAtAnnotation.value.fingerprint)
    : null;
  const scopeExtensionsAtAnnotation = derivedScopeExtensionsAtAnnotation ?? GRAPH_SCOPE_EXTENSIONS;
  const scopeExtensionsSource = derivedScopeExtensionsAtAnnotation !== null ? 'graph-fingerprint' : 'static-fallback';

  // 快照校验：decide 读的是 G1、impact 却跑在 G2 上，这类跨快照拼接必须被显式检出，
  // 而不是静默拼成一条对不上号却"看起来完整"的记录。
  const snapshotMatches = (decision.graphSourceCommit ?? null) === graphSourceCommitAtAnnotation;
  const impactStatus = snapshotMatches ? impactStatusFlag : 'snapshot-mismatch';
  const annotated = snapshotMatches
    ? annotateImpactCaveat(
        decision,
        impactStatus === 'completed' ? impactResult : null,
        target,
        scopeExtensionsAtAnnotation,
      )
    : { ...decision, caveats: [] };

  const event = {
    kind: 'caveat-annotation',
    schemaVersion: AUDIT_SCHEMA_VERSION,
    decisionId: decision.decisionId ?? null,
    ts: new Date().toISOString(),
    impactStatus,
    caveats: annotated.caveats,
    graphSourceCommitAtAnnotation,
    scopeExtensionsSource,
  };
  const auditWritten = appendAuditEvent(projectRoot, event);

  const payload = { ...event, decision: annotated, auditWritten };
  process.stdout.write(
    format === 'text'
      ? `impactStatus: ${impactStatus}\ncaveats: ${annotated.caveats.join(', ') || '(none)'}\n`
      : `${JSON.stringify(payload, null, 2)}\n`,
  );
  return 0;
}

/* ------------------------------------------------------------------ main */

export async function main(argv) {
  const [subcommand, ...rest] = argv;
  const flags = parseFlags(rest);

  if (subcommand === 'decide') return runDecide(flags);
  if (subcommand === 'annotate-caveat') return runAnnotateCaveat(flags);

  process.stderr.write(`未知子命令: ${subcommand ?? '(空)'}（可用：decide | annotate-caveat）\n`);
  return 2;
}

/**
 * 自调用守卫必须比到 **realpath**，不能只 `path.resolve`。
 *
 * `import.meta.url` 给的是 Node 解析后的真实路径，而 `process.argv[1]` 是用户敲进来的字面路径。
 * 只要中间隔着一层符号链接（macOS 的 `/tmp` → `/private/tmp` 就是；符号链接的插件安装目录同理），
 * 两者恒不相等 → `main()` 永不执行 → 进程 exit 0、stdout 全空。这是最危险的一类失败：
 * 看起来成功，实际什么都没做。SC-019 的仓外安装态用例正是在 `/tmp` 下把它抓出来的。
 */
function realPathOrResolve(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  realPathOrResolve(process.argv[1]) === realPathOrResolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`graph-consumption-cli 内部错误：${String(error)}\n`);
      process.exitCode = 1;
    });
}
