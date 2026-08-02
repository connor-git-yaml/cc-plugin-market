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

import { checkFreshness, readEmbeddedSourceCommit } from './lib/graph-bootstrap-status.mjs';
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

export const AUDIT_SCHEMA_VERSION = 2;
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
 * 读出**已验证**的 `graph.sourceCommit`：非空字符串才算数，其余一律 null（B1-C1）。
 *
 * `readEmbeddedSourceCommit` 的 `ok:true` 只保证"文件读到了、JSON 解析通过"，字段本身缺失时
 * 它回的是 `value: null`（那是 F239 为"旧格式图仍可评估"留的三态语义）。消费侧不能沿用那条
 * 宽松语义：一份查不出 provenance 的图，`annotate-caveat` 无从做快照校验、freshness 无从落地，
 * 对图消费决策而言与"读不出来"等价。判据与 canonical `inspectBuiltGraph` 逐字一致，
 * 避免"构建后判为不可用、决策时又判为可用"的自相矛盾。
 *
 * @returns {string|null}
 */
function readVerifiedSourceCommit(graphJsonPath) {
  const embedded = readEmbeddedSourceCommit(graphJsonPath);
  if (!embedded.ok) return null;
  return typeof embedded.value === 'string' && embedded.value.length > 0 ? embedded.value : null;
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
    return { graphAvailability: missing ? 'missing' : 'corrupt', graphSourceCommit: null };
  }

  const sourceCommit = readVerifiedSourceCommit(graphJsonPath);
  return sourceCommit === null
    ? { graphAvailability: 'corrupt', graphSourceCommit: null }
    : { graphAvailability: 'present', graphSourceCommit: sourceCommit };
}

/**
 * 覆盖范围判据：本轮变更文件是否**全部**落在图 walker 的扩展名白名单之外。
 *
 * "全部之外"而非"存在之外"：混合改动（既有 `.ts` 又有 `.mjs`）里 `.ts` 部分的 impact 仍然有值，
 * 一有 `.mjs` 就整体判 out-of-scope 会把有效信号一起丢掉。
 * 无变更文件时不声称 out-of-scope——那是"不知道"，不是"范围外"。
 */
function collectCoverageScope(files) {
  if (!Array.isArray(files) || files.length === 0) return 'in-graph-scope';
  const anyInScope = files.some((filePath) => {
    const dot = filePath.lastIndexOf('.');
    const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    if (dot <= slash) return false;
    return GRAPH_SCOPE_EXTENSIONS.includes(filePath.slice(dot).toLowerCase());
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

  const { graphAvailability, graphSourceCommit } = collectGraphAvailability(graphJsonPath);
  // freshness 的唯一权威来源是 canonical 的 checkFreshness（RG-006）：本文件既不缓存它、
  // 也不自己拿 graph.sourceCommit 去比 HEAD 复算一份。
  const freshnessVerdict = await checkFreshness(projectRoot, { graphJsonPath, spectraBin });
  const inputs = {
    changeClass,
    graphAvailability,
    freshness: freshnessVerdict.state,
    coverageScope: collectCoverageScope(files),
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
  const graphSourceCommitAtAnnotation = readVerifiedSourceCommit(path.join(projectRoot, GRAPH_REL));

  // 快照校验：decide 读的是 G1、impact 却跑在 G2 上，这类跨快照拼接必须被显式检出，
  // 而不是静默拼成一条对不上号却"看起来完整"的记录。
  const snapshotMatches = (decision.graphSourceCommit ?? null) === graphSourceCommitAtAnnotation;
  const impactStatus = snapshotMatches ? impactStatusFlag : 'snapshot-mismatch';
  const annotated = snapshotMatches
    ? annotateImpactCaveat(decision, impactStatus === 'completed' ? impactResult : null, target)
    : { ...decision, caveats: [] };

  const event = {
    kind: 'caveat-annotation',
    schemaVersion: AUDIT_SCHEMA_VERSION,
    decisionId: decision.decisionId ?? null,
    ts: new Date().toISOString(),
    impactStatus,
    caveats: annotated.caveats,
    graphSourceCommitAtAnnotation,
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
