// Feature 241（M9 轨道 B4）— 图消费决策核心。
//
// 回答一个问题：**手里这份知识图谱，现在该不该拿来做影响面分析？**
// F239 已经能算出 graph provenance / freshness，但插件侧零消费——图 stale 时 impact 照常返回
// 结果、返回体不带任何标记，agent 与人都无从判断影响面是不是过期的。本模块把「什么时候该刷图、
// 什么时候不该消费 impact、降级时留什么证据」做成一份可穷举、可测的判定。
//
// 三条硬约束（FR-001 / D2）：
// - **纯函数、零 I/O**：本文件不 import 任何模块。刷新执行、freshness 采集、审计落盘全在外层。
//   单测靠静态断言守这条——一旦有人为了图方便在这里 spawn 一次，测试立刻红。
// - **矩阵求值顺序是安全属性**：见下方 FR-003 v2 表。顺序错了会产生"为范围外目标白白重建"
//   与"对不存在的图做降级消费"两类错误，不是风格偏好。
// - **措辞红线（D7）**：freshness 通过 ≠ impact 可信。因此 degraded reason 与 caveat 是**两组
//   不相交的封闭枚举**，让「图是新的、在范围内、但仍可能漏边」成为一个可表达、不与降级混淆的态。

/**
 * 降级原因封闭枚举（FR-004，12 值）。
 *
 * 值本身是对外契约（进审计事件、进 CLI 输出、进 iteration log），不得随手改写；
 * 消费方一律引用本常量，禁止散落字符串字面量。
 */
export const DEGRADED_REASONS = Object.freeze({
  IMPACT_NOT_APPLICABLE_ADDITIVE_ONLY: 'impact-not-applicable-additive-only',
  CLASSIFICATION_UNKNOWN: 'classification-unknown',
  GRAPH_MISSING: 'graph-missing',
  GRAPH_CORRUPT: 'graph-corrupt',
  GRAPH_STALE_REFRESH_DECLINED: 'graph-stale-refresh-declined',
  GRAPH_DIRTY_UNCOMMITTED: 'graph-dirty-uncommitted',
  GRAPH_UNKNOWN_PROVENANCE: 'graph-unknown-provenance',
  REFRESH_FAILED_SPECTRA_MISSING: 'refresh-failed-spectra-missing',
  REFRESH_FAILED_TIMEOUT: 'refresh-failed-timeout',
  REFRESH_FAILED_NONZERO_EXIT: 'refresh-failed-nonzero-exit',
  REFRESH_FAILED_ARTIFACT_UNUSABLE: 'refresh-failed-artifact-unusable',
  COVERAGE_GAP_OUT_OF_GRAPH_SCOPE: 'coverage-gap-out-of-graph-scope',
});

/**
 * Caveat 封闭枚举（FR-004b，1 值）—— **不改变出口**的附注，走独立通道。
 *
 * 与 DEGRADED_REASONS 交集必须为空：caveat 描述的是"图可用但覆盖面有已登记缺口"，
 * 把它折进降级原因等于抹掉"可以消费、只是要打折扣"这一态。
 */
export const CAVEAT_CODES = Object.freeze({
  COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT: 'coverage-gap-known-extraction-limit',
});

/**
 * 图 walker 的扩展名白名单（O-5：`source-discovery.ts` 只收这四类）。
 *
 * **全仓唯一定义处**：coverageScope 判据（CLI 侧）与 FR-006 的 caveat 判据共用同一份，
 * 两份白名单迟早会漂移成"范围内不注解、范围外反而注解"的自相矛盾。
 */
export const GRAPH_SCOPE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.js', '.jsx']);

const CHANGE_CLASSES = new Set(['modifies-existing', 'additive-only', 'unknown']);
const GRAPH_AVAILABILITIES = new Set(['present', 'missing', 'corrupt']);
const FRESHNESS_STATES = new Set(['fresh', 'dirty', 'stale', 'unknown-provenance']);
const COVERAGE_SCOPES = new Set(['in-graph-scope', 'out-of-graph-scope']);
const REFRESH_POLICIES = new Set(['allowed', 'declined']);

const REQUIRED_DIMENSIONS = Object.freeze([
  ['changeClass', CHANGE_CLASSES],
  ['graphAvailability', GRAPH_AVAILABILITIES],
  ['freshness', FRESHNESS_STATES],
  ['coverageScope', COVERAGE_SCOPES],
  ['refreshPolicy', REFRESH_POLICIES],
]);

/**
 * 12 个降级原因 ↔ 固定人读模板的**唯一**映射表（SC-004）。
 *
 * 两个用途合一，刻意不拆成两张表：CLI `--format text` 的人读渲染，与 decision 的 `fallbackHint`。
 * 拆成两张迟早会漂移成"CLI 说退回 Grep、JSON 里却建议重建"这类自相矛盾的输出。
 *
 * 降级必须给出路：只说"降级了"而不说"那现在该干什么"，消费方只会忽略它。
 */
export const DEGRADED_REASON_HINTS = Object.freeze({
  [DEGRADED_REASONS.IMPACT_NOT_APPLICABLE_ADDITIVE_ONLY]:
    '本轮全部为新增文件，impact 语义上不适用（新代码尚无 caller）；改用 context / graph_query 做模块级定位，或直接 Grep',
  [DEGRADED_REASONS.COVERAGE_GAP_OUT_OF_GRAPH_SCOPE]:
    '目标路径整体不在图覆盖范围内（根因 O-5：图 walker 扩展名白名单），impact 结果不具参考性；请退回 Grep / Read',
  [DEGRADED_REASONS.CLASSIFICATION_UNKNOWN]:
    '变更类别无法机械判定，impact 结果按参考值使用，勿作为"改动面已穷尽"的依据',
  [DEGRADED_REASONS.GRAPH_MISSING]: '图不存在且本次不允许刷新；请退回 Grep / Read，或另行运行 spectra batch --mode graph-only',
  [DEGRADED_REASONS.GRAPH_CORRUPT]: '图不可解析/不可查询且本次不允许刷新；请退回 Grep / Read',
  [DEGRADED_REASONS.GRAPH_STALE_REFRESH_DECLINED]:
    '图落后于 HEAD 且本次不允许刷新；impact 反映的是旧快照，新增/改名的 symbol 可能整体缺失',
  [DEGRADED_REASONS.GRAPH_DIRTY_UNCOMMITTED]:
    '工作树有未提交改动，图不反映实际待验证代码；impact 结果按旧快照理解',
  [DEGRADED_REASONS.GRAPH_UNKNOWN_PROVENANCE]:
    'freshness 无法判定（多为工具面失败，如 spectra CLI 缺失/超时）；不要把不可知当作可信',
  [DEGRADED_REASONS.REFRESH_FAILED_SPECTRA_MISSING]: '刷新失败：spectra CLI 不可执行；请检查安装后重试，本轮退回 Grep / Read',
  [DEGRADED_REASONS.REFRESH_FAILED_TIMEOUT]: '刷新失败：重建超出 deadline；本轮退回 Grep / Read',
  [DEGRADED_REASONS.REFRESH_FAILED_NONZERO_EXIT]: '刷新失败：重建进程非零退出；本轮退回 Grep / Read',
  [DEGRADED_REASONS.REFRESH_FAILED_ARTIFACT_UNUSABLE]:
    '刷新失败：进程退出 0 但产物缺失/不可解析/缺 sourceCommit（假成功）；本轮退回 Grep / Read',
});

const INVALID_INPUT_HINT =
  '决策入参必须严格包含五维：changeClass / graphAvailability / freshness / coverageScope / refreshPolicy，缺项或字面量非法一律 fail-loud，不做默认值补齐';

function makeDecision({ outcome, degradedReason = null, matchedRule, fallbackHint = null }) {
  return {
    outcome,
    degradedReason,
    caveats: [],
    fallbackHint: fallbackHint ?? (degradedReason === null ? null : DEGRADED_REASON_HINTS[degradedReason] ?? null),
    matchedRule,
  };
}

function validate(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return false;
  for (const [dimension, allowed] of REQUIRED_DIMENSIONS) {
    if (!Object.prototype.hasOwnProperty.call(input, dimension)) return false;
    if (!allowed.has(input[dimension])) return false;
  }
  return true;
}

/**
 * FR-003 决策矩阵 v2 —— 按固定顺序求值，第一个命中的分支即为出口。
 *
 * | 序 | 条件 | 出口 |
 * |----|------|------|
 * | 1  | additive-only                       | skip-impact          |
 * | 2  | out-of-graph-scope                  | consume-degraded     |
 * | 3  | corrupt × allowed                   | refresh-then-consume |
 * | 4  | corrupt × declined                  | unavailable          |
 * | 5  | missing × allowed                   | refresh-then-consume |
 * | 6  | missing × declined                  | unavailable          |
 * | 7  | changeClass=unknown                 | consume-degraded     |
 * | 8  | stale × allowed                     | refresh-then-consume |
 * | 9  | stale × declined                    | consume-degraded     |
 * | 10 | dirty × allowed                     | refresh-then-consume |
 * | 11 | dirty × declined                    | consume-degraded     |
 * | 12 | unknown-provenance                  | consume-degraded     |
 * | 13 | 其余（fresh × in-scope × present）  | consume-impact       |
 *
 * 顺序上三处**不能动**的设计（每处都对应一个已被证伪的更"自然"排法）：
 *
 * - **行 2 升到第二位**：范围外的目标即便重建也进不了图，刷新纯属浪费一次全量重建 + 一次图覆写
 *   风险。`stale × out-of-scope × allowed` 若先命中刷新行，重建完还是得降级。
 * - **行 7 下移到 availability 之后**：图都不存在时给 `consume-degraded`，等于让消费方去消费一份
 *   不存在的图。`unknown × missing × allowed` 的正确出口是行 5 刷新（EC-01）。
 * - **行 7 仍在 freshness 之前**：变更类别都判不出来时，不值得为它额外花一次刷新预算。
 *
 * `dirty` 与 `unknown-provenance` 一律不折进 `fresh`：前者表示图与实际待验证代码不一致，
 * 后者表示无法判定——把不可知当作可信是最危险的静默降级。
 * `unknown-provenance`（行 12）不分 allowed/declined：其绝大多数成因是工具面失败
 * （spectra CLI 缺失 / 超时 / 输出不可解析），刷新解决不了，只会在每次调用上再叠一次超时预算。
 *
 * **维度非独立（实测 V-5 / O-6）**：图缺失或损坏时 `graph-quality` 必然回报
 * `freshness.state = unknown-provenance`，故以下 6 类组合在构造上根本不可达。
 * 矩阵对它们仍给出正确结果，靠的正是 availability（行 3-6）排在 freshness（行 8-12）之前——
 * 这是必须锁住的不变量，单测以「missing 探针」守之。
 *
 *   unreachable-by-construction #1: graphAvailability=missing × freshness=fresh
 *   unreachable-by-construction #2: graphAvailability=missing × freshness=dirty
 *   unreachable-by-construction #3: graphAvailability=missing × freshness=stale
 *   unreachable-by-construction #4: graphAvailability=corrupt × freshness=fresh
 *   unreachable-by-construction #5: graphAvailability=corrupt × freshness=dirty
 *   unreachable-by-construction #6: graphAvailability=corrupt × freshness=stale
 *
 * @param {{ changeClass: string, graphAvailability: string, freshness: string,
 *           coverageScope: string, refreshPolicy: string }} input 严格五维，无第六字段
 * @returns {{ outcome: string, degradedReason: string|null, caveats: string[],
 *             fallbackHint: string|null, matchedRule: number }}
 */
export function decideGraphConsumption(input) {
  if (!validate(input)) {
    return makeDecision({ outcome: 'invalid-input', matchedRule: 0, fallbackHint: INVALID_INPUT_HINT });
  }

  const { changeClass, graphAvailability, freshness, coverageScope, refreshPolicy } = input;
  const allowed = refreshPolicy === 'allowed';

  if (changeClass === 'additive-only') {
    return makeDecision({
      outcome: 'skip-impact',
      degradedReason: DEGRADED_REASONS.IMPACT_NOT_APPLICABLE_ADDITIVE_ONLY,
      matchedRule: 1,
    });
  }

  if (coverageScope === 'out-of-graph-scope') {
    return makeDecision({
      outcome: 'consume-degraded',
      degradedReason: DEGRADED_REASONS.COVERAGE_GAP_OUT_OF_GRAPH_SCOPE,
      matchedRule: 2,
    });
  }

  if (graphAvailability === 'corrupt') {
    return allowed
      ? makeDecision({ outcome: 'refresh-then-consume', matchedRule: 3 })
      : makeDecision({
          outcome: 'unavailable',
          degradedReason: DEGRADED_REASONS.GRAPH_CORRUPT,
          matchedRule: 4,
        });
  }

  if (graphAvailability === 'missing') {
    return allowed
      ? makeDecision({ outcome: 'refresh-then-consume', matchedRule: 5 })
      : makeDecision({
          outcome: 'unavailable',
          degradedReason: DEGRADED_REASONS.GRAPH_MISSING,
          matchedRule: 6,
        });
  }

  if (changeClass === 'unknown') {
    return makeDecision({
      outcome: 'consume-degraded',
      degradedReason: DEGRADED_REASONS.CLASSIFICATION_UNKNOWN,
      matchedRule: 7,
    });
  }

  if (freshness === 'stale') {
    return allowed
      ? makeDecision({ outcome: 'refresh-then-consume', matchedRule: 8 })
      : makeDecision({
          outcome: 'consume-degraded',
          degradedReason: DEGRADED_REASONS.GRAPH_STALE_REFRESH_DECLINED,
          matchedRule: 9,
        });
  }

  if (freshness === 'dirty') {
    return allowed
      ? makeDecision({ outcome: 'refresh-then-consume', matchedRule: 10 })
      : makeDecision({
          outcome: 'consume-degraded',
          degradedReason: DEGRADED_REASONS.GRAPH_DIRTY_UNCOMMITTED,
          matchedRule: 11,
        });
  }

  if (freshness === 'unknown-provenance') {
    return makeDecision({
      outcome: 'consume-degraded',
      degradedReason: DEGRADED_REASONS.GRAPH_UNKNOWN_PROVENANCE,
      matchedRule: 12,
    });
  }

  return makeDecision({ outcome: 'consume-impact', matchedRule: 13 });
}

/**
 * 刷新之后的收口（FR-003 收口规则 + FR-007 失败改写）。
 *
 * **绝不重跑矩阵。** 脏工作树重建后依然 `dirty`、commit 后的图依然可能 commit 级 stale——
 * 把 freshness 当作"可以消费"的前置条件会让 `dirty × allowed` 陷入刷新→仍 dirty→再刷新的循环
 * （EC-07）。刷新后的消费前置条件只有一个：**产物可用**（`refresh.ok === true`）。
 *
 * 也正因如此，本函数只读 `input.changeClass` 与 `input.graphAvailability` 两个维度，
 * 绝不触碰 `freshness` / `coverageScope` / `refreshPolicy`——单测用 Proxy 记录属性读取来守这条。
 *
 * @param {{ decision: object, input: object, refresh: { ok: boolean, degradedReason?: string } }} args
 * @returns {object} 收口后的 decision
 */
export function finalizeAfterRefresh({ decision, input, refresh }) {
  if (decision?.outcome !== 'refresh-then-consume') {
    return { ...decision, caveats: [...(decision?.caveats ?? [])] };
  }

  const { changeClass, graphAvailability } = input ?? {};

  if (refresh?.ok === true) {
    // 收口规则：类别不可知时仍然降级消费（图是新的，但"改了什么"依旧判不出来）
    return changeClass === 'unknown'
      ? makeDecision({
          outcome: 'consume-degraded',
          degradedReason: DEGRADED_REASONS.CLASSIFICATION_UNKNOWN,
          matchedRule: decision.matchedRule,
        })
      : makeDecision({ outcome: 'consume-impact', matchedRule: decision.matchedRule });
  }

  // 刷新失败：图在手（present）还能降级消费旧快照；图本就 missing/corrupt 则彻底不可用
  const degradedReason = refresh?.degradedReason ?? DEGRADED_REASONS.REFRESH_FAILED_ARTIFACT_UNUSABLE;
  return makeDecision({
    outcome: graphAvailability === 'present' ? 'consume-degraded' : 'unavailable',
    degradedReason,
    matchedRule: decision.matchedRule,
  });
}

/**
 * 注入闸门（FR-011）——「哪些出口允许把 impact 喂进 prompt」的**唯一定义处**。
 *
 * 这条规则会同时出现在 goal_loop 步骤 2 与 SKILL 通用 phase 循环两处散文里；写成一个函数，
 * 是为了让两边引用同一份判定，而不是各自复述一遍再慢慢漂移。
 *
 * 只有 `consume-impact` 放行。`refresh-then-consume` 是**中间态**：真刷完之后
 * `finalizeAfterRefresh` 会把它收口成 `consume-impact` 或降级；它仍以终态出现只可能是 dry-run
 * （什么都没刷），此时注入等于消费一份没被刷新的图。
 *
 * @param {{ outcome?: string }} decision
 * @returns {boolean}
 */
export function shouldConsumeImpact(decision) {
  return decision !== null && typeof decision === 'object' && decision.outcome === 'consume-impact';
}

/**
 * FR-011 —— 把 impact 摘要组装成注入块的**唯一**实现（B1-C7）。
 *
 * 为什么要有这个函数：SC-008 原本用「iteration log 里有没有 graphDecision 字段」来证明
 * "允许态注入 / 拒绝态不注入"。那证明的是日志写对了，不是 prompt 里到底有没有 impact 内容——
 * 一个把 impact 摘要照旧拼进 prompt、只是顺手多记一行日志的实现，也能让那组断言全绿。
 *
 * 把组装动作收敛成纯函数之后，正反两向可以吃**同一份** `impactSummary` 输入做对照断言：
 * 允许态的返回值必须含它，拒绝态必须返回 `null`（因而必然不含）。
 *
 * 闸门直接复用 `shouldConsumeImpact`，不在这里重写一遍出口判断——两处判定迟早漂移。
 *
 * @param {{ outcome?: string, caveats?: string[] }} decision
 * @param {string} impactSummary 编排层从 MCP impact 结果解释出的人读摘要
 * @returns {string|null} 允许注入时返回注入块文本；任何拒绝态返回 `null`
 */
export function buildImpactInjectionBlock(decision, impactSummary) {
  if (!shouldConsumeImpact(decision)) return null;
  if (typeof impactSummary !== 'string' || impactSummary.trim().length === 0) return null;

  const caveats = Array.isArray(decision.caveats) ? decision.caveats : [];
  const lines = ['## 影响面参考（Spectra impact）', '', impactSummary.trim()];

  // D7 红线：caveat 必须与 impact 内容同时可见。把它另起一处输出，等于允许消费方只读上半段。
  if (caveats.length > 0) {
    lines.push(
      '',
      `> 已登记覆盖缺口：${caveats.join(', ')}。图是新的且目标在覆盖范围内，但该目标命中已登记的抽取器漏边形态：` +
        'impact 结果按参考值使用，可能缺失的 caller 需另行用 Grep / Read 复核。',
    );
  }

  return `${lines.join('\n')}\n`;
}

/** 从 symbol id / 文件路径取小写扩展名；`::` 与 `#` 两种 symbol 分隔符都认。 */
function extensionOf(target) {
  if (typeof target !== 'string' || target.length === 0) return null;
  const filePath = target.split('::')[0].split('#')[0];
  const dot = filePath.lastIndexOf('.');
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (dot <= slash) return '';
  return filePath.slice(dot).toLowerCase();
}

/**
 * 从 impact 返回体里取 `directCallers`，兼容真实 MCP 形状与合成顶层形状（B1-C4）。
 *
 * Spectra MCP `impact` 的真实返回把计数放在 `summary.directCallers`，顶层没有这个字段。
 * 原实现只认顶层，于是**真实**返回一律取不到 0，FR-006 的 caveat 在生产路径上从未触发过——
 * 而单测因为喂的是合成的顶层形状，全绿。
 *
 * `summary` 优先：两处并存时以工具的权威结构为准，顶层只作为合成/历史形态的补位。
 *
 * @returns {number|null} 拿不到数字返回 null（不猜 0——猜 0 会凭空造出一个 caveat）
 */
function normalizeDirectCallers(impactResult) {
  if (impactResult === null || typeof impactResult !== 'object') return null;
  const fromSummary = impactResult.summary?.directCallers;
  if (typeof fromSummary === 'number' && Number.isFinite(fromSummary)) return fromSummary;
  const fromTop = impactResult.directCallers;
  if (typeof fromTop === 'number' && Number.isFinite(fromTop)) return fromTop;
  return null;
}

/**
 * FR-006 —— 对 fresh 且在范围内的 impact 结果做**后置** caveat 注解。
 *
 * 为什么是后置独立函数而不是决策的第六维：impact 结果只有在决定"要消费"之后才会被拿到，
 * 把它塞进决策入参会让五维严格性（FR-002）失效，也会让纯函数依赖一次 MCP 往返的时序。
 *
 * 触发的现象（O-3 实证）：图刚重建完、目标是 TS 源、`impact` 却回报 `directCallers: 0`，
 * 而实际调用方就在同文件的 inline arrow callback 里——调用抽取器不下钻实参箭头函数体。
 * 这既不是"图旧了"也不是"范围外"，所以它**不改出口、不写 degradedReason**，只挂 caveat。
 *
 * **`target` 必须由调用方显式传入（B1-C4）**：真实 MCP 返回体里没有 target 字段，只有发起
 * 查询的人知道自己问的是哪个 symbol。原实现从返回体里找 target，找不到就**跳过**范围判断
 * 直接注解——于是对任意目标（包括图根本不收的 `.mjs` / `.md`）都会挂上"该目标命中已登记漏边
 * 形态"这句无根据的断言。现在反过来：target 缺失或不是图覆盖范围内的扩展名，一律**不注解**。
 * 宁可漏一次提示，也不能给出误导性的可信度声明（与 D7 红线同向）。
 *
 * @param {object} decision `decideGraphConsumption` / `finalizeAfterRefresh` 的输出
 * @param {{ summary?: { directCallers?: number }, directCallers?: number }} impactResult
 * @param {string} target 调用方声明的 impact 查询目标 symbolId（`路径::符号` / `路径#符号` / 纯路径）
 * @returns {object} 新对象（不就地改写入参）
 */
export function annotateImpactCaveat(decision, impactResult, target) {
  const annotated = { ...decision, caveats: [...(decision?.caveats ?? [])] };

  if (decision?.outcome !== 'consume-impact') return annotated;
  if (normalizeDirectCallers(impactResult) !== 0) return annotated;

  // 判据与 coverageScope 共用同一份白名单（C-002：防第二份白名单漂移）
  const extension = extensionOf(target);
  if (extension === null || !GRAPH_SCOPE_EXTENSIONS.includes(extension)) return annotated;

  annotated.caveats.push(CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT);
  return annotated;
}
