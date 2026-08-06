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
import { fileURLToPath } from 'node:url';

import { checkFreshness, readEmbeddedGraphMeta } from './lib/graph-bootstrap-status.mjs';
import {
  decideGraphConsumption,
  finalizeAfterRefresh,
  annotateImpactCaveat,
  DEGRADED_REASONS,
  DEGRADED_REASON_HINTS,
  GRAPH_SCOPE_SURFACES,
} from './lib/graph-consumption-decision.mjs';
import {
  collectChangeSet,
  collectCoverageScope,
  collectGraphAvailability,
  deriveScopeSurfacesFromFingerprint,
  verifiedSourceCommitOf,
} from './lib/graph-consumption-inputs.mjs';
import { executeRefresh } from './lib/graph-refresh-executor.mjs';
import { extractTaskPaths, classifyFromTaskPaths } from './lib/tasks-path-signal.mjs';

// 五维输入采集随实现一起搬进 `lib/graph-consumption-inputs.mjs`（F258 CLEANUP），其中**三个**
// 常量是跨语言合同测试的锚点，此处**再导出**以保持
// `tests/unit/graph-scope-extensions-contract.test.ts` 的既有 import 路径不变——
// 这三个常量的存在理由就是"给合同测试一个锚点"，锚点位置不应因内部搬运而漂移。
// （`export … from` 是 live binding：改 lib 侧而不改本文件，合同测试同样会红。已实测验证。）
export {
  FINGERPRINT_SURFACE_KEYS,
  FINGERPRINT_ENTRY_KEYS,
  SUPPORTED_FINGERPRINT_FORMAT_VERSION,
} from './lib/graph-consumption-inputs.mjs';

// 3（F254）：`decide` 输出与两类审计事件新增 `scopeExtensionsSource`，`decide` 侧另加
// `coverageUnionApplied`（annotate 侧无此字段——注解时点不存在"重建可达面"这一说）。additive 字段
// 不破坏任何现有消费方（审计只写不读），但 schemaVersion 的用途就是让"形状变了"可被显式识别——
// 该 bump 却不 bump，这个字段就会逐渐失去指示意义。
//
// 4（F258）：形状确实又变了——
//   ① `decide` 输出与 `kind:'decision'` 事件新增 `baseRefResolution` / `worktreeStatusReadFailed`；
//   ② 新增 `kind:'decide-aborted'` 事件与 abort payload（失败路径也留证据）；
//   ③ `scopeExtensionsSource` 新增取值 `static-fallback-malformed-fingerprint`（P2 落地）。
//
// ⚠️ **本文件当前有 5 处写入点**：`decide-aborted` 事件、abort payload、`decision` 事件、
// `decide` payload、`caveat-annotation` 事件。本仓**无入库 audit fixture**，漏改某处不会被
// fixture 抓到，因此五处一律引用本常量，禁止任何地方写字面量版本号。
//
// 这条"共 N 处"的清单本身也会随扩面静默变成假话（F258 P3 复审实测：上一版写"三处"时实际已是
// 五处）。故它不是一句自述，而是由 `graph-consumption-cli.test.mjs` 的
// `SCHEMA_VERSION_WRITE_SITES` 静态断言锚住的——新增写入点却不更新这段注释即测试红。
export const AUDIT_SCHEMA_VERSION = 4;
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
 * 只需要 sourceCommit、不需要 fingerprint 的读取路径（刷新后重读产物）。
 *
 * @returns {string|null}
 */
function readVerifiedSourceCommit(graphJsonPath) {
  return verifiedSourceCommitOf(readEmbeddedGraphMeta(graphJsonPath));
}

/**
 * 指纹被拒时的**主动信号**（F258 D4：新增的观测取值必须有人读）。
 *
 * `scopeExtensionsSource` 的全仓非测试消费点只有"人读渲染 + 写审计"，skills 一次都不读，审计按
 * RG-006 只写不读——只加一个取值等于加一个没人会知道的字段。stderr warn 是这条链上唯一能主动
 * 到达调用方的通道，且与 stdout 的结构化输出互不干扰（调用方用 `$( )` 捕获的是 stdout）。
 */
/**
 * `scopeExtensionsSource` 三值（F258 §5.5）——"没有指纹"与"指纹不被认识"必须可区分。
 *
 * 两者的处置相同（都用静态面），但成因与该做的事完全不同：前者是旧图的正常形态，后者说明
 * 图产物与消费侧口径已经对不上，需要有人去看。压成同一个取值就是把后者藏进前者里。
 */
function resolveScopeSource(derived) {
  if (derived.surfaces !== null) return 'graph-fingerprint';
  return derived.rejection !== null ? 'static-fallback-malformed-fingerprint' : 'static-fallback';
}

function warnMalformedFingerprint(rejection) {
  process.stderr.write(
    `[warning] 图自述 collector fingerprint 不被认识，本次覆盖面整体回落静态面` +
      `（scopeExtensionsSource=static-fallback-malformed-fingerprint）：${rejection}\n`,
  );
}

/**
 * 逐管线合并动态面与静态面（W-1 的"重建可达面"并集，F258 起按管线 id 配对）。
 *
 * `matchSemantics` 两侧同 id 却不一致时**不合并、也不 throw**：该 id 按两条独立条目并存。
 * 宁可多判一次 in-scope，也不静默选一个语义——与 TS 侧 `mergeSurfaces` 遇语义分歧即 throw 的
 * 纪律同向（都拒绝静默选一个），只是消费侧的保守方向是"并存"而不是"中断决策"。
 */
function mergeScopeSurfaces(dynamicSurfaces, staticSurfaces) {
  const staticById = new Map(staticSurfaces.map((surface) => [surface.id, surface]));
  const merged = [];
  for (const dynamic of dynamicSurfaces) {
    const staticPeer = staticById.get(dynamic.id);
    staticById.delete(dynamic.id);
    if (staticPeer === undefined) {
      merged.push(dynamic);
    } else if (staticPeer.matchSemantics !== dynamic.matchSemantics) {
      merged.push(dynamic, staticPeer);
    } else {
      merged.push({
        id: dynamic.id,
        extensions: [...new Set([...dynamic.extensions, ...staticPeer.extensions])].sort(),
        matchSemantics: dynamic.matchSemantics,
      });
    }
  }
  // 静态面独有的管线（动态面缺该 id）同样并入：并集的语义是"重建后可达"
  for (const remaining of staticById.values()) merged.push(remaining);
  return merged;
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

/* ------------------------------------------------------- base-ref abort 出口 */

/** abort payload 里 `gitStderr` 的回显上限：诊断够用即可，不做无界回显。 */
const ABORT_STDERR_LIMIT = 512;

/**
 * 恢复口径（F258 §4.5）——**没有恢复口径 = 把本仓常规路径整条关掉，比原缺陷更坏**。
 *
 * 本仓 rebase 交付是强制流程，`phase_start_ref` 指向被改写的旧 sha 是常规形态，而
 * `resolvePhaseStartRef` 是纯读取、无回退。因此 abort 必须同时告诉调用方**怎么出去**：
 *
 * (a) 显式传一个可达的 `--base-ref` 覆盖 trace 锚点（CLI 已有该参数）；
 * (b) 由编排器**显式**重记 `phase_start_ref` 并在 trace / iteration log 留一条可审计记录。
 *
 * 红线与 (b) 的差别是**可审计性、不是动作本身**：禁止的是"自行、静默把锚点重记为当前 HEAD"
 * （凭空重定义基线且无人知道）；显式 + 留痕 + 声明覆盖面损失的重记是允许的。
 *
 * 实现层刻意**不**做自动重记——自动重记就是把红线要防的事做成默认行为。CLI 只 abort + 给 hint。
 */
const ABORT_HINT_UNRESOLVABLE =
  'phase 起点锚点不可达（rebase 改写历史会造成该形态）。不得据此判定变更类别；' +
  '请改用可达的 --base-ref 重跑，或由编排器显式重记 phase_start_ref 并在 trace / iteration log 留痕' +
  '（记明原锚点不可达、新锚点是什么、此前变更不在本次影响面证据内）。本次不提供影响面证据。';

/**
 * `diff-failed` **必须**用不同的话说。
 *
 * 这条分支的定义恰恰是"锚点已经 probe 通过"——失败在 diff 本身（索引损坏 / 仓库状态异常 /
 * spawn 层 ENOBUFS）。若沿用 unresolvable 的文案，操作者会照着去重记 `phase_start_ref`：
 * 那个动作对本形态毫无作用，还会按红线要求在 trace 里留下一条**事实错误**的"原锚点不可达"记录。
 * 出口相同（都 exit 3、都不给影响面证据），但恢复动作不同，话就不能混着说。
 */
const ABORT_HINT_DIFF_FAILED =
  'phase 起点锚点本身可解析，但 git diff 执行失败（索引损坏 / 仓库状态异常 / 输出超出缓冲区）。' +
  '不得据此判定变更类别；**不要**重记 phase_start_ref——锚点没有问题。' +
  '请先排查仓库状态（gitStderr / gitSpawnError 字段给出了原因），修好后重跑。本次不提供影响面证据。';

const ABORT_HINTS = {
  unresolvable: ABORT_HINT_UNRESOLVABLE,
  'diff-failed': ABORT_HINT_DIFF_FAILED,
};

/**
 * base-ref 不可信时的硬失败出口：退出码 3，stdout 仍是可解析 JSON。
 *
 * **封闭键集，刻意不含 `degradedReason` / `fallbackHint`**：abort 发生在矩阵求值之前，它没有
 * outcome、也不是一种降级——把它塞进 `DEGRADED_REASONS` 就是与"变更类别真判不出来"共用出口，
 * 正是用户裁决明确否掉的。调用方 SKILL 侧必须相应改记 `error` / `hint`，否则会写出一行 `undefined`。
 *
 * stdout 仍输出 JSON 而不是只写 stderr：调用方现状用 `DECISION=$(...)` 捕获 stdout，
 * 让它拿到可解析内容才谈得上"把原因并入注入块"。abort payload **不随 `--format text` 变形**：
 * 人读渲染器是按决策形状写的（outcome/matchedRule/caveats），abort 一个都没有，给它套一层
 * 半空的人读模板只会让"这不是一次决策"这件事变模糊；人读通道由下方 stderr 承担。
 *
 * @returns {3} 固定退出码 3（0 成功 / 1 内部异常 / 2 用法错误 之外的第四个语义：锚点不可信）
 */
function abortUnresolvableBaseRef({ projectRoot, phase, advisory, dryRun, baseRef, changeSet }) {
  const hint = ABORT_HINTS[changeSet.baseRefResolution];
  const event = {
    kind: 'decide-aborted',
    schemaVersion: AUDIT_SCHEMA_VERSION,
    ts: new Date().toISOString(),
    projectRoot,
    phase,
    advisory,
    error: 'base-ref-unresolvable',
    baseRefResolution: changeSet.baseRefResolution,
    baseRef,
    gitStatus: changeSet.gitStatus,
  };
  // dry-run 的"零副作用"合同不因失败路径而失效：锚点坏没坏与要不要写盘是两件事
  const auditWritten = dryRun ? false : appendAuditEvent(projectRoot, event);

  const payload = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    error: 'base-ref-unresolvable',
    ts: event.ts,
    projectRoot,
    phase,
    advisory,
    baseRef,
    baseRefResolution: changeSet.baseRefResolution,
    gitStatus: changeSet.gitStatus,
    gitStderr: changeSet.gitStderr.slice(0, ABORT_STDERR_LIMIT),
    // spawn 层失败时 `gitStatus` 为 null、`gitStderr` 为空串——那时这个字段是唯一的诊断来源
    gitSpawnError: changeSet.gitSpawnError,
    hint,
    auditWritten,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  // 人读通道也要出声：exit 3 若只体现在退出码上，散文调用方漏检时连线索都没有
  process.stderr.write(
    `[error] phase 起点锚点不可信（${changeSet.baseRefResolution}）：${baseRef}\n${hint}\n`,
  );
  return 3;
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
  // 锚点类参数的**类型闸门**（F258，与附带项 6.2 的 `--refresh-deadline-ms` 同形）：
  // `parseFlags` 对"下一个 token 以 `--` 开头或缺省"置 `true`，于是 `--base-ref --format json`
  // 这类手滑会让 `typeof !== 'string'` 分支把它静默降级成"压根没给锚点"，输出 `baseRefMissing:true`
  // 照常出决策——**调用方明明声称了锚点，我们却当它没说过**。这与本 fix 要消灭的"base-ref 坏了
  // 还照常给结论"是同一种病，只是发生在参数解析层。
  //
  // 出口取 **2（用法错误）而非 3（锚点不可信）**：命令行本身写错了，责任在编排层，语义不是
  // "锚点不可达"。SKILL 对 RC==2 的处置正是"停下修调用"，与责任方一致。
  for (const key of ['base-ref', 'base-ref-from-trace']) {
    if (flags[key] === undefined) continue;
    if (typeof flags[key] !== 'string') {
      process.stderr.write(`参数 --${key} 缺少取值（下一个 token 是另一个 flag 或已到末尾）\n`);
      return 2;
    }
    // 空串 / 纯空白同样是"声称了却没给"：`--base-ref "$REF"` 而 `REF` 未设是最常见的 shell 形态，
    // 而空串会从 `typeof === 'string'` 的缝里漏进"未提供锚点"分支，得到一份 exit 0 的权威决策。
    // 尤其危险的是：abort 的恢复口径 (a) **就是**"显式传 --base-ref <可达 ref> 重跑"——编排 agent
    // 若算出空值，恢复动作本身会把一次响亮的 abort 换成一次静默的错误决策。
    if (flags[key].trim().length === 0) {
      process.stderr.write(`参数 --${key} 取值为空（空串或纯空白不是合法锚点；请给出可达的 ref / trace 路径）\n`);
      return 2;
    }
  }
  // `--base-ref-from-trace` 是给编排层用的便捷入口：直接指 trace.md，由 CLI 按 last-match-wins
  // 取出该 phase 最后一次的起点 ref（T-W1）。显式 `--base-ref` 优先级更高。
  let baseRef = typeof flags['base-ref'] === 'string' ? flags['base-ref'] : null;
  const baseRefTraceSource = typeof flags['base-ref-from-trace'] === 'string' ? flags['base-ref-from-trace'] : null;
  if (baseRef === null && baseRefTraceSource !== null) {
    try {
      baseRef = resolvePhaseStartRef(fs.readFileSync(baseRefTraceSource, 'utf-8'), phase);
    } catch {
      // trace 读不到就当没有锚点：输出会标 baseRefMissing:true，不静默冒充"有"
      baseRef = null;
    }
    // EC-29 的原文要求是「`--base-ref` 缺失时，authoritative 合同下应在输出中**明确警示**」，
    // 而"调用方指定了 trace 却取不到锚点"此前一句警示都没有（stderr 恒 0 字节）：它与"压根没传
    // `--base-ref*`"落进同一个 `not-provided`，事后连审计都分不出来。出口维持 exit 0 不变
    // （EC-29 回归护栏，见红用例 R2-3），但**必须出声**——"没有锚点"和"锚点源答不出来"是两件事。
    if (baseRef === null) {
      process.stderr.write(
        `[warning] --base-ref-from-trace 指定了 ${baseRefTraceSource}，但其中取不到 phase=${phase} 的 ` +
          `phase_start_ref（文件不存在 / 无该 phase 的锚点行 / --phase 与 trace 里记的名字不一致）。` +
          `本次按"无锚点"处理：只看工作树差异，已 commit 的改动整体看不见，结论据此产生。\n`,
      );
    }
  }
  const spectraBin = typeof flags['spectra-bin'] === 'string' ? flags['spectra-bin'] : 'spectra';
  // 缺省时沿用 canonical 的默认重建预算；显式传入是给有时间预算的调用方（CI / 短 phase）用的。
  //
  // **类型闸门必须在 Number() 之前（F258 附带项 6.2）**：`parseFlags` 对"下一个 token 以 `--` 开头
  // 或缺省"置 `true`，而 `Number(true) === 1` 恰好通过 `isFinite && > 0` 校验——于是
  // `--refresh-deadline-ms --format json` 这种手滑会把重建预算静默压成 1 ms（必然超时），
  // 表现为"刷新老是失败"而不是"参数写错了"。
  if (flags['refresh-deadline-ms'] !== undefined && typeof flags['refresh-deadline-ms'] !== 'string') {
    process.stderr.write('参数 --refresh-deadline-ms 缺少取值（下一个 token 是另一个 flag 或已到末尾）\n');
    return 2;
  }
  const refreshDeadlineMs = Number(flags['refresh-deadline-ms']);
  if (flags['refresh-deadline-ms'] !== undefined && !(Number.isFinite(refreshDeadlineMs) && refreshDeadlineMs > 0)) {
    process.stderr.write('参数 --refresh-deadline-ms 必须是正整数毫秒\n');
    return 2;
  }
  const graphJsonPath = path.join(projectRoot, GRAPH_REL);

  const changeSet = collectChangeSet(projectRoot, baseRef);

  // ---------------------------------------------------------------------------
  // F258 缺陷 2：锚点不可信 ⇒ **本次拒绝给出决策**（exit 3），在矩阵求值之前收口。
  //
  // 为什么不退到 `changeClass = 'unknown'` 让它"保守刷图"（fix-report R1 已实证证伪）：
  // `unknown` 命中矩阵行 7 `consume-degraded`，**排在 stale（行 8）之前**短路，而只有
  // `refresh-then-consume` 才会 `executeRefresh` —— unknown 根本不刷图，还会把
  // `graph-stale-refresh-declined` / `graph-dirty-uncommitted` 等真实信号永久遮蔽。
  // 那是比原缺陷更坏的静默降级。
  //
  // abort 发生在这里（`collectGraphAvailability` / `checkFreshness` 之前）不是顺手为之：
  // 锚点不可信时，"图新不新""覆盖面够不够"问了也没有意义，而多问一次就多一次 spawn；
  // 更重要的是，**没有发生任何刷新**这一事实是 §4.5「abort 不消耗刷新预算」口径的实现侧依据。
  //
  // `--advisory` 同样 exit 3：advisory 与权威合同的区别是"结论的权威度"，不是"事实源可不可以
  // 骗人"。给 advisory 开一条软路，等于恢复一条"锚点坏了但照常出结论"的静默通道。
  // ---------------------------------------------------------------------------
  if (changeSet.baseRefResolution === 'unresolvable' || changeSet.baseRefResolution === 'diff-failed') {
    return abortUnresolvableBaseRef({ projectRoot, phase, advisory, dryRun, baseRef, changeSet });
  }

  const { changeClass: gitChangeClass, files } = changeSet;

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
  // F254：覆盖面优先取图自述的采集面（图能回答"我收了哪些扩展名、按什么语义匹配"就以它为准），
  // 推不出来才回落静态面。F258：回落分两种——"图本就没有指纹"与"有指纹但不被认识"，后者出声。
  const derived = deriveScopeSurfacesFromFingerprint(graphFingerprint);
  const scopeExtensionsSource = resolveScopeSource(derived);
  if (derived.rejection !== null) warnMalformedFingerprint(derived.rejection);

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
  // 范围外而错过一次本可命中的重建——这一支的残留风险与修复前**同向**（"该刷没刷"），
  // 量级则远小于修复前（修复前是任何面外扩展恒自锁）。
  //
  // ⚠️ **但"不会反向"这句原话是 over-claim，已按实证撤回（F258 审查修复轮）**：union 分支存在
  // 第三个方向——`freshness=fresh` × `allowed` 时，落在 union 内、图自述面**外**的目标不再命中
  // 行 2，却也不会走到刷新（图是 fresh 的，没什么可刷），于是直接拿到全信 `consume-impact`：
  // 手里这份图**根本不含**该扩展，impact 结果却按"覆盖完整"消费。更糟的是 `annotate-caveat`
  // 时点用的是图自述面（不带 union），该目标在那边判面外 ⇒ 不注解 ⇒ 两侧同时静默。
  // 即"该降级却全信"，与"该刷没刷"方向**相反**。
  //
  // 收敛它要动决策矩阵语义（在 fresh 分支下让 coverage 判据回到图自述面，或给 union 分支补一条
  // 显式 caveat），且病灶来自 F254 W-1 而非本 fix，故按**独立 fix 卡**登记、本轮不改行为。
  // 这里只保证登记如实——原文案会让下一轮审查者按"方向安全"放过它。
  // 落在并集内、但不在图自述面内的目标现在不再命中行 2，而是继续走 availability/freshness 分支
  // （stale×allowed → 行 8 刷新）——这正是修复的那条路径。
  //
  // EC-07 不受影响：本分支只改矩阵**入参**的算法，`finalizeAfterRefresh` 仍不重跑矩阵。
  // ---------------------------------------------------------------------------
  const refreshAllowed = refreshPolicy === 'allowed';
  const coverageUnionApplied = refreshAllowed && derived.surfaces !== null;
  const coverageScopeSurfaces = coverageUnionApplied
    ? mergeScopeSurfaces(derived.surfaces, GRAPH_SCOPE_SURFACES)
    : (derived.surfaces ?? GRAPH_SCOPE_SURFACES);

  // freshness 的唯一权威来源是 canonical 的 checkFreshness（RG-006）：本文件既不缓存它、
  // 也不自己拿 graph.sourceCommit 去比 HEAD 复算一份。
  const freshnessVerdict = await checkFreshness(projectRoot, { graphJsonPath, spectraBin });
  const inputs = {
    changeClass,
    graphAvailability,
    freshness: freshnessVerdict.state,
    coverageScope: collectCoverageScope(files, coverageScopeSurfaces),
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
        // F258：锚点与工作树两路输入各自的可信度如实入审计。成功路径上 `baseRefResolution`
        // 只可能是 `not-provided` / `resolved`——`unresolvable` / `diff-failed` 走 decide-aborted 事件。
        baseRefResolution: changeSet.baseRefResolution,
        worktreeStatusReadFailed: changeSet.worktreeStatusReadFailed,
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
    // 语义不变（`baseRef === null` = 调用方压根没给锚点），保留既有断言与调用方读法
    baseRefMissing: baseRef === null,
    // F258 新增两个如实标注：
    // - `baseRefResolution`：把"没给"与"给了且可达"分开——`baseRefMissing` 只能说前一半。
    // - `worktreeStatusReadFailed`：`git status --porcelain` 读失败的如实标注。刻意与
    //   `graph-quality` 的 `porcelainReadFailed` 同名同义（措辞复用，读者不必学第二套词汇）。
    baseRefResolution: changeSet.baseRefResolution,
    worktreeStatusReadFailed: changeSet.worktreeStatusReadFailed,
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
  const derivedAtAnnotation = graphMetaAtAnnotation.ok
    ? deriveScopeSurfacesFromFingerprint(graphMetaAtAnnotation.value.fingerprint)
    : { surfaces: null, rejection: null };
  const scopeSurfacesAtAnnotation = derivedAtAnnotation.surfaces ?? GRAPH_SCOPE_SURFACES;
  const scopeExtensionsSource = resolveScopeSource(derivedAtAnnotation);
  if (derivedAtAnnotation.rejection !== null) warnMalformedFingerprint(derivedAtAnnotation.rejection);

  // 快照校验：decide 读的是 G1、impact 却跑在 G2 上，这类跨快照拼接必须被显式检出，
  // 而不是静默拼成一条对不上号却"看起来完整"的记录。
  const snapshotMatches = (decision.graphSourceCommit ?? null) === graphSourceCommitAtAnnotation;
  const impactStatus = snapshotMatches ? impactStatusFlag : 'snapshot-mismatch';
  const annotated = snapshotMatches
    ? annotateImpactCaveat(
        decision,
        impactStatus === 'completed' ? impactResult : null,
        target,
        scopeSurfacesAtAnnotation,
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
