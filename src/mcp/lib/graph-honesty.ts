/**
 * F266 (M10 P0-C) — MCP 返回面诚实化：`honesty` 标注的**事实计算**层。
 *
 * 三层边界（plan Q3）：
 *   graph-honesty.ts（算事实：读 graph metadata / 调 evaluateFreshness / 维护缓存）
 *     → response-helpers.ts（按 GraphHonesty 生成文案，保持零 I/O 纯函数）
 *     → agent-context-tools.ts（三处 ≤10 行装配）
 *
 * 为什么单独成模块而不并进 `response-helpers.ts`：后者是零 I/O 的纯文案模块，
 * 把 git 探测 + 模块级缓存塞进去会毁掉它的可测性；而 `agent-context-tools.ts` 已 977 行，
 * 判定逻辑再堆进去只会让那个文件继续膨胀。
 *
 * 诚实边界（plan Q1，必须读懂再改）：本模块**不产出**独立的"解析缺口"成因。
 * graph.json 里唯一可得的缺口量 `Σ callSitesCount - calls 边数` 天然混合了
 * ①真正的解析/链接失败 与 ②合法的图外调用（`console.log`、宿主 API、第三方包方法），
 * 二者的判别证据只存在于抽取期、未被持久化。把整个差值贴成任一类都是造假，
 * 因此合并为 `coverage-gap` 并在结构里**显式**带 `separable: false`。
 */

import type { GraphJSON, GraphNode } from '../../panoramic/graph/graph-types.js';
import type { GraphFreshnessVerdict } from '../../panoramic/graph/quality/quality-types.js';
import { evaluateFreshness } from '../../panoramic/graph/source-commit.js';
import {
  getBuilderStamp,
  parseGraphBuilderStamp,
  type GraphBuilderStamp,
} from '../../panoramic/graph/builder-stamp.js';
import { safeStderrLog } from './response-helpers.js';

// ============================================================
// 字段契约（plan Q2）
// ============================================================

/** 零结果 / 无调用方的成因（①③ + ②③合并态），三者互斥 */
export type ResolutionReason =
  /** ①：图内无未成边的调用点，且该 symbol 无对外暴露面 —— 可判为确认为零 */
  | 'confirmed-zero'
  /** ③：symbol 有导出面 / 是 external 节点 —— 图覆盖范围外可能存在结果 */
  | 'boundary-exposed'
  /** ②③合并态：图中存在已探测但未成边的 call site，本版本无法区分"解析失败"与"合法图外调用" */
  | 'coverage-gap';

export interface ResolutionVerdict {
  reason: ResolutionReason;
  /**
   * 该判定所依据证据的粒度 —— 诚实标注的承重字段：
   * 禁止让 graph 级证据（全图缺口统计）冒充 symbol 级证据（被查对象自身的导出面）。
   */
  evidenceScope: 'symbol' | 'graph';
  /** 中文说明，含具体证据（导出面来源 / 缺口数量 / 缺席数据源） */
  detail: string;
}

/**
 * `unaccounted` 的三种成因（delta 审查 D2）——排查动作不同，MUST NOT 合并成一个值。
 *
 * `no-accounting` 之外的两种都是 D2 新增，它们收的是同一个洞：**一个合法节点不能代表全图**，
 * 以及**"抽到 0"与"没抽取"在磁盘上长得一模一样**。
 */
export type CoverageUnaccountedReason =
  /** 图中不存在任何合法的 callSitesCount 记账（或图中根本没有 module 节点） */
  | 'no-accounting'
  /** 只有部分 module 节点带合法记账 —— 剩下那些模块测没测过，图里查不出来 */
  | 'partial-accounting'
  /** 全部模块都有记账、且全为 0、且图内无 calls 边 —— 无法区分"抽取未执行"与"项目确无调用点" */
  | 'all-zero';

/**
 * 图内调用点记账的评估结果（四态，互斥）。
 *
 * 为什么必须四态而不是 `CoverageGap | null`：`null` 会把**两件完全不同的事**编码成同一个值——
 * ①「图里根本没有任何 callSitesCount 记账」（没测量）与 ②「测得未成边调用点为 0」（测了，为零）。
 * 二者混为一谈后，一张连记账机制都不在场的图会被判成 `confirmed-zero`——那是本模块能说出的
 * 最强断言，却建立在零证据上。同理，`detected < linked` 的不自洽记账过去被 `Math.max(0, …)`
 * 洗成"无缺口"，同样冒充成确证。
 */
export type CoverageAssessment =
  /**
   * 记账的**存在性**不成立 —— 无法确认"测量已执行"。
   * `accountedModules` / `totalModules` 随行，让"缺了多少"这件事可见（detail 会引用它们）。
   */
  | {
      kind: 'unaccounted';
      reason: CoverageUnaccountedReason;
      accountedModules: number;
      totalModules: number;
    }
  /** 记账自相矛盾（探测到的调用点数 < calls 边数），任何据此推出的结论都不可信 */
  | { kind: 'inconsistent'; callSitesDetected: number; callEdgesLinked: number }
  /** 记账在场且自洽，且存在未成边调用点 */
  | { kind: 'gap'; gap: CoverageGap }
  /** 记账在场、自洽、未成边调用点为 0 —— 唯一允许支撑 `confirmed-zero` 的正向证据 */
  | { kind: 'measured-zero'; callSitesDetected: number; callEdgesLinked: number };

/** ②③合并缺口的量化。仅当图中存在未成边 call site 时出现 */
export interface CoverageGap {
  /** Σ module/component 节点 metadata.callSitesCount —— 已被探测到的调用点总数 */
  callSitesDetected: number;
  /** relation === 'calls' 的边数 —— 真正连上了两端的调用点 */
  callEdgesLinked: number;
  /** 前两者之差；恒 > 0（不为正的情形分别落 `measured-zero` / `inconsistent`，不在本结构内表达） */
  unlinkedCallSites: number;
  /**
   * callEdgesLinked / callSitesDetected，四位定点。
   *
   * **只是一个比值，不是质量分**：分母含 `console.log` / 宿主 API / 第三方包方法等
   * 永远不可能在本图内成边的调用点，故真实工程上它天然偏低（实测本仓 3.1%、外部 TS 语料 6.9%）。
   * 任何按它分档下"解析未完成"结论的做法都是把 `separable:false` 的混合量单方面归因，
   * MUST NOT 复活（对抗审查 A3）。
   */
  linkageRatio: number;
  /** 恒为 false：本版本无法把缺口拆成"解析缺口"与"合法图外调用"（plan Q1） */
  separable: false;
  /** 图覆盖边界的补充证据：建图时缺席的数据源 */
  skippedSources: Array<{ source: string; reason: string }>;
}

/**
 * MCP advisory 层对 `GraphFreshnessVerdict` 的**瘦身投影**。
 *
 * 为什么截断发生在这里而不是 `source-commit.ts`：那里的 `dirtyFiles` 是全量事实源，
 * 图质量门 / CLI 报告都依赖它的完整性；只有 MCP 返回体（每次工具调用都带、进 agent 上下文）
 * 需要为 token 预算做有界化。故收窄只在投影层发生，且**必带**全量计数与被截条数，
 * 让"这里只给了前 N 条"这件事本身可见（截断不可静默）。
 */
export interface TrimmedFreshnessVerdict extends GraphFreshnessVerdict {
  /** dirtyFiles 的全量条数（存在 dirtyFiles 时必带） */
  dirtyFileCount?: number;
  /** 被截掉的条数；0 表示未截断 */
  dirtyFilesTruncated?: number;
}

/** MCP 返回体里 `dirtyFiles` 的呈现上限（超出部分只报计数，见 TrimmedFreshnessVerdict） */
export const MCP_DIRTY_FILES_LIMIT = 5;

export interface GraphFreshnessAdvisory {
  /** 直接内嵌 F249 既有判定结果（fresh|dirty|stale|unknown-provenance + staleReasons），不重新发明 */
  verdict: TrimmedFreshnessVerdict;
  /**
   * 裁决 1（builder 戳只可见不判定）：独立字段。
   * MUST NOT 进 `verdict.staleReasons`、MUST NOT 参与 resolution 判定、
   * MUST NOT 影响工具的成功/失败状态。
   * `null` = 无法判定（图未记录 builder 戳 / 当前进程无盖章 / 记录不可识别）。
   */
  builderMismatch: boolean | null;
  /** builderMismatch 的人读说明（复用 graph-quality 的 `[builder]` 语汇），无法判定时为 null 亦有说明 */
  builderDetail: string | null;
}

export interface ComparisonScopeDeclaration {
  /** 三点记法 `<base>...HEAD` 只比两个**已提交**状态 */
  notation: 'three-dot';
  /** 实际执行的 git range 字面量，如 "765a9608...HEAD" */
  gitRange: string;
  /** 恒 false —— 这就是 FR-012 要声明的那件事 */
  includesUncommitted: false;
  /**
   * 工作树是否另有未纳入本次比较的改动。取自 freshness verdict，**不额外 spawn git**。
   *
   * 三态，且 `null` 是承重值（对抗审查 A2）：`evaluateFreshness` 的优先级里 stale 判定
   * **排在 dirty 检测之前并短路返回** —— 判 stale 时 `git status --porcelain` 根本没跑过。
   * 把那种情形渲染成 `false` 就是拿"没测量"冒充"测得为无"，在最需要提醒的陈旧图上谎报干净。
   * 故：`dirty`→true（且 porcelain 读取失败的保守 dirty → null）、`fresh`→false（porcelain
   * 确实跑过且干净）、`stale` / `unknown-provenance` / 标注自身降级 → null。
   */
  uncommittedChangesPresent: boolean | null;
  detail: string;
}

/**
 * 零结果**却不产出 resolution** 的结构化成因（delta 审查 D4，追加式字段）。
 *
 * 为什么必须结构化而不是"什么都不说"：三个成因的缺席都发生在零结果场景，而零结果正是最需要
 * hedge 的时刻。只让 resolution 消失，下游 hint 层就只剩一句"受影响范围为空"——比完全不带
 * honesty 的兜底文案还裸（后者至少有一句"图的覆盖范围未知"）。
 */
export type ResolutionOmissionReason =
  /** `context` 的 `include` 不含 `'callers'`：callers 根本没查，`length === 0` 是"没查"不是"查了为空" */
  | 'callers-not-queried'
  /** `impact(direction:'downstream')`：问的是 callee，本模块只有 caller 侧证据机制，答非所问 */
  | 'non-caller-oriented-query'
  /** `detect_changes`：改动文件全部未落入图内 ⇒ 没有起点 symbol ⇒ 上游 BFS 一次都没跑 */
  | 'no-symbols-in-graph'
  /**
   * 第三轮对抗审查 E4：`budget` / `depth` 被约束到 0 ⇒ 遍历根本没执行（或一层都没展开）。
   * 此时的零结果由**入参**决定，与图里有什么毫无关系；拿图覆盖面去解释它，等于用一份
   * 与本次查询无关的证据为一个没跑过的查询作证（实测 `impact(budget:0)` 会产出
   * `boundary-exposed` + 一句"该 symbol 有对外暴露面…"的 hint）。
   */
  | 'query-constrained-to-zero';

export interface GraphHonesty {
  /** 仅在结果集为空 / 无调用方时出现；非空结果不附加（避免噪声） */
  resolution?: ResolutionVerdict;
  /**
   * D4：零结果、但本次查询不具备产出 resolution 的前提时出现（与 `resolution` 互斥）。
   * 结果集非空时二者皆缺席——那不是"缺席"，是本就不需要。
   */
  resolutionOmitted?: { reason: ResolutionOmissionReason };
  /** 仅当 unlinkedCallSites > 0 时出现 */
  coverage?: CoverageGap;
  /** ④，与 resolution 正交，三工具恒带 */
  freshness: GraphFreshnessAdvisory;
  /** 仅 detect_changes 且走 baseRef 比较模式时出现（FR-012） */
  comparisonScope?: ComparisonScopeDeclaration;
  /**
   * 标注自身计算失败时置 true —— 宁可显式说"这次标注没算出来"，
   * 也不把兜底值伪装成真实判定（否则 fail-open 的 `unknown-provenance` 会冒充真结论）。
   */
  annotationDegraded?: true;
}

// ============================================================
// 缓存（plan Q4）
// ============================================================

/**
 * freshness 判定的缓存有效期。
 *
 * TTL 只作用于 **MCP 响应体**，不作用于 graph.json 产物，因此与 FR-014 byte-stable 无关。
 *
 * 取 15s 而非更短：agent 的调用节奏是"连续几次工具调用属于同一轮思考"，2s 窗口几乎每次都
 * miss，等于每次 MCP 调用都同步 spawn 一次 `git status`（实测冷调用 +27ms）。
 * 取舍：图文件本身的失效判据（mtime / size）仍是**即时**的，被缓存的只有工作树 dirty 漂移，
 * 最长滞后 15s —— freshness 是 advisory 而非门禁，这个滞后不改变任何判定的成败。
 */
export const FRESHNESS_TTL_MS = 15_000;

interface HonestyCacheEntry {
  graphPath: string;
  /** 与 `getCachedGraphData` **完全相同**的失效判据，两者同源不分叉 */
  mtimeMs: number;
  sizeBytes: number;
  at: number;
  freshness: GraphFreshnessAdvisory;
  coverage: CoverageAssessment;
}

const honestyCache = new Map<string, HonestyCacheEntry>();

/** 供测试 `beforeEach` 清理，避免用例间经模块级缓存串味 */
export function __resetHonestyCache(): void {
  honestyCache.clear();
}

// ============================================================
// 入参
// ============================================================

/** 可注入的依赖 seam：单测据此做到零 git spawn、零真实时钟 */
export interface HonestyDeps {
  evaluateFreshnessFn?: typeof evaluateFreshness;
  now?: () => number;
  getBuilderStampFn?: () => GraphBuilderStamp | null;
}

export interface HonestyAnnotationParams {
  projectRoot: string;
  /** 直接复用 `getCachedGraphData` 的返回结构，避免第二次 stat（失效判据同源） */
  graph: {
    graphData: Readonly<GraphJSON>;
    graphPath: string;
    mtimeMs: number;
    sizeBytes: number;
  };
  /** 被查 symbol 的 canonical id；detect_changes 无单一被查对象，传 null */
  symbolId?: string | null;
  /** 结果集是否为空 —— 只有为空时才产出 resolution */
  resultsEmpty: boolean;
  /**
   * 本次查询**是否具备产出 resolution 的前提**；不具备时必须直接给出结构化成因
   * （`true | ResolutionOmissionReason`）。必填、无默认值：调用方必须显式表态，
   * 否则新增一个工具时会静默继承"当然查了"的错误前提（F238 教训：控制信号必须由 caller 传参）。
   *
   * 为什么 resolution 依赖它（对抗审查 A1 / A5 + delta 审查 D4）：本模块产出的全部证据都是
   * **caller 取向**的——导出面意味着"图外可能有调用方"、未成边 call site 意味着"调用边可能没连上"。
   *   - `context` 的 `include` 不含 `'callers'` 时，callers 数组根本没被查询，`length === 0`
   *     是"没查"而不是"查了为空"，据此说"在图中无调用方"是彻头彻尾的假话
   *     → `'callers-not-queried'`。
   *   - `impact(direction:'downstream')` 问的是 callee，本模块没有任何 callee 侧的边界证据机制，
   *     用导出面去解释一个 callee 零结果是答非所问 → `'non-caller-oriented-query'`。
   *   - `detect_changes` 的改动文件全部未落入图内时，起点 symbol 集合为空、上游 BFS 一次都没跑，
   *     此时的"零受影响"是**查询未执行**，拿图级覆盖证据去解释它同样是答非所问
   *     → `'no-symbols-in-graph'`。
   *   - `budget` / `depth` 被约束到 0 时（E4），遍历根本没执行 / 一层都没展开，零结果由入参决定，
   *     与图里有什么无关 → `'query-constrained-to-zero'`（**优先于**上面三条判定）。
   * 以上情形一律**不产出 resolution**（诚实缺席，改由 `resolutionOmitted` 结构化说明），
   * freshness 照常携带。
   */
  resolutionBasis: true | ResolutionOmissionReason;
  /** detect_changes 走 baseRef 模式时的三点记法 range 字面量；其余情况传 null */
  gitRange?: string | null;
  deps?: HonestyDeps;
}

// ============================================================
// 主入口
// ============================================================

/**
 * 计算一次 MCP 调用的 `honesty` 标注。
 *
 * **本函数不抛异常**：它挂在三个工具的成功路径上，一次抛出就会把 advisory 反过来变成故障源
 * （FR-011 明文要求 freshness 的附加不得改变工具成功/失败状态）。但兜底**不静默**——
 * 失败时置 `annotationDegraded: true` 并写 stderr，绝不让编造的默认值冒充真实判定。
 */
export function buildHonestyAnnotation(params: HonestyAnnotationParams): GraphHonesty {
  try {
    return computeHonesty(params);
  } catch (e) {
    safeStderrLog(`[F266] honesty annotation degraded: ${String(e)}\n`);
    const degraded: GraphHonesty = {
      freshness: {
        verdict: { state: 'unknown-provenance', recordedSourceCommit: null, currentHead: null },
        builderMismatch: null,
        builderDetail: null,
      },
      annotationDegraded: true,
    };
    // FR-012 的比较口径声明 MUST NOT 随标注降级一起消失（对抗审查 B5）：它的三个承重字段
    // （notation / gitRange / includesUncommitted）是纯常量与入参，与会失败的 freshness 计算无关。
    // 让它跟着一起没了，等于在最需要提醒"本次比较不含未提交改动"的时候闭嘴 —— fail-open。
    const gitRange = params.gitRange ?? null;
    if (gitRange !== null) {
      degraded.comparisonScope = buildComparisonScope(gitRange, null);
    }
    return degraded;
  }
}

function computeHonesty(params: HonestyAnnotationParams): GraphHonesty {
  const { projectRoot, graph, resultsEmpty, resolutionBasis, deps } = params;
  const symbolId = params.symbolId ?? null;
  const gitRange = params.gitRange ?? null;

  const cached = getOrComputeCacheEntry(projectRoot, graph, deps);

  const honesty: GraphHonesty = { freshness: cached.freshness };

  // resolution 与 coverage 同条件附加：coverage 是零结果判定的佐证，非零结果时它只是
  // 每次调用都重复的一坨数字（返回体膨胀），对 agent 没有可操作性（对抗审查 B3c）。
  if (resultsEmpty) {
    if (resolutionBasis === true) {
      if (cached.coverage.kind === 'gap') {
        honesty.coverage = cached.coverage.gap;
      }
      const node = symbolId === null ? null : findNodeById(graph.graphData, symbolId);
      honesty.resolution = decideResolution(node, symbolId, cached.coverage, skippedSourcesOf(graph.graphData));
    } else {
      // D4：缺席也要说出口——零结果场景下"什么都不说"比不带 honesty 还裸
      honesty.resolutionOmitted = { reason: resolutionBasis };
    }
  }

  if (gitRange !== null) {
    honesty.comparisonScope = buildComparisonScope(gitRange, cached.freshness.verdict);
  }

  return honesty;
}

function getOrComputeCacheEntry(
  projectRoot: string,
  graph: HonestyAnnotationParams['graph'],
  deps: HonestyDeps | undefined,
): HonestyCacheEntry {
  const nowFn = deps?.now ?? Date.now;
  const hit = honestyCache.get(projectRoot);
  if (hit !== undefined) {
    // 时钟回拨（NTP 校正 / 手动改表）会让 `now - at` 变成负数，任何 `< TTL` 的写法都恒真——
    // 缓存条目就此被无限期冻结，MCP 会一直返回一份可能早已过期的 fresh 判定。
    // 负 delta 一律判 miss：回拨的代价只是多跑一次 git，冻结的代价是持续说假话。
    const delta = nowFn() - hit.at;
    if (
      hit.graphPath === graph.graphPath &&
      hit.mtimeMs === graph.mtimeMs &&
      hit.sizeBytes === graph.sizeBytes &&
      delta >= 0 &&
      delta < FRESHNESS_TTL_MS
    ) {
      return hit;
    }
  }

  const evaluate = deps?.evaluateFreshnessFn ?? evaluateFreshness;
  const meta = graph.graphData.graph;
  const verdict = trimVerdictForMcp(evaluate(meta.sourceCommit, projectRoot, meta.fingerprint));
  const entry: HonestyCacheEntry = {
    graphPath: graph.graphPath,
    mtimeMs: graph.mtimeMs,
    sizeBytes: graph.sizeBytes,
    at: nowFn(),
    freshness: {
      verdict,
      ...describeBuilder(graph.graphData, deps?.getBuilderStampFn ?? getBuilderStamp),
    },
    coverage: assessCoverage(graph.graphData),
  };
  honestyCache.set(projectRoot, entry);
  return entry;
}

/**
 * 把全量 verdict 投影成 MCP 返回体用的瘦身版（对抗审查 B3c）。
 *
 * 只动 `dirtyFiles`：一次大 rebase 后它可以有几百条，逐条进 agent 上下文纯属浪费预算，
 * 而 agent 真正需要的信息是"有多少"与"典型是哪些"。截断后**必带**全量计数与被截条数，
 * 保证"这里只给了前 N 条"可见 —— 静默截断本身就是一种失真。
 */
function trimVerdictForMcp(verdict: GraphFreshnessVerdict): TrimmedFreshnessVerdict {
  const files = verdict.dirtyFiles;
  if (files === undefined) return verdict;
  return {
    ...verdict,
    dirtyFiles: files.slice(0, MCP_DIRTY_FILES_LIMIT),
    dirtyFileCount: files.length,
    dirtyFilesTruncated: Math.max(0, files.length - MCP_DIRTY_FILES_LIMIT),
  };
}

// ============================================================
// coverage（②③合并态的量化）
// ============================================================

/**
 * 图产物是**外部输入**：`metadata` 可能整体缺席、为 `null`、或被写成标量。
 * 裸下标 `n.metadata['x']` 在这三种形态上直接 throw，而本模块挂在三个工具的成功路径上——
 * 单个畸形节点就会把整个 honesty 信封打成 `annotationDegraded`（delta 审查 D3）。
 *
 * 用 `hasOwnProperty.call` 而非 `in` / 直接取值：防原型链注入（`{"__proto__":{"callSitesCount":9999}}`
 * 经 `JSON.parse` 虽不会污染原型，但同一读取路径也用于其他来源的对象，与 F261 的口径保持一致）。
 */
function readOwnMetadata(node: unknown, key: string): unknown {
  if (node === null || typeof node !== 'object') return undefined;
  // E5-4：外层 `node.metadata` 的读取与内层 key 读取用**同一口径**——原实现内层查了
  // `hasOwnProperty`、外层却直接取属性，等于把原型链防护开在第二道门却敞着第一道。
  if (!Object.prototype.hasOwnProperty.call(node, 'metadata')) return undefined;
  const meta = (node as { metadata?: unknown }).metadata;
  if (meta === null || typeof meta !== 'object') return undefined;
  return Object.prototype.hasOwnProperty.call(meta, key)
    ? (meta as Record<string, unknown>)[key]
    : undefined;
}

/**
 * 读取并校验一个节点的调用点记账；不合法一律 `null`（"字段被写坏了" ≠ "测得为 0"）。
 *
 * 判据是 `Number.isInteger`（D3）而非 `Number.isFinite`：调用点是可数对象，`2.5 个调用点`
 * 不是一个偏小的测量值而是坏数据。`Number.isInteger` 同时排除 NaN / ±Infinity。
 */
function readCallSitesCount(node: unknown): number | null {
  const raw = readOwnMetadata(node, 'callSitesCount');
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null;
}

/**
 * 记账的**责任节点**判据：`callSitesCount` 由 graph-builder 只写在 module 节点上
 * （`deriveNodesFromSkeletons` → `metadata.callSitesCount = sk.callSites?.length ?? 0`，
 * 经 §3.5 透传到 GraphNode）。两个判据取 OR 是刻意的：`unifiedKind` 由 unified-graph 路写入，
 * 而先于它落库的节点只有 `kind` —— 只认其中一个会让分母缩水，把"缺记账"说成"全都有记账"。
 */
function isModuleNode(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  if (readOwnMetadata(node, 'unifiedKind') === 'module') return true;
  // E5-4：`kind` 与 metadata 键同口径（自有属性才算数），不认继承自原型链的 `kind`
  if (!Object.prototype.hasOwnProperty.call(node, 'kind')) return false;
  return (node as { kind?: unknown }).kind === 'module';
}

/**
 * 评估图内调用点记账，产出四态之一（对抗审查 A4 + delta 审查 D2）。
 *
 * 承重前提：`confirmed-zero` 是本模块能说的最强断言，因此它 MUST 建立在**测量存在的正向证据**上。
 * A4 给了三个条件，D2 把其中的 (a) 拆细并补了 (d)——每一条都对应一次实证的假话：
 *   (a) 记账**全覆盖**：图中每个 module 节点都带合法 `callSitesCount`。
 *       原判据是全图 OR（"至少一个节点带记账"），于是 500 个模块里 1 个带记账就足以宣称
 *       "测量执行过"，另外 499 个模块测没测过压根不看。
 *   (b) 记账自洽——探测到的调用点数 ≥ calls 边数；
 *   (c) 未成边调用点为 0；
 *   (d) `Σ callSitesCount > 0`。**这是 D2 的核心**：生产端把「没抽取」与「抽到 0」折叠成了
 *       同一个磁盘值 —— `src/knowledge-graph/index.ts` 写的是 `sk.callSites?.length ?? 0`，
 *       tree-sitter 解析失败（EC-1 降级）产出 `callSites: undefined` 时同样落 `0`。
 *       于是"全零记账 + 零 calls 边"这张图在磁盘上与"项目确实一个调用都没有"完全同形，
 *       判成 `measured-zero → confirmed-zero` 就是在一张可能根本没抽取过的图上说最强的话。
 *       落 `unaccounted/all-zero`（hedge 方向）是这里唯一诚实的选择。
 *   移交线索：让 (d) 重新可判的前提是 producer 侧区分"未抽取"与"抽得 0"（如显式
 *   `callSitesCount: null` 或 stage 标签），属 M10 P1「边 stage 标签」卡的范围，不在本卡。
 *
 * 求和面仍遍历全部节点、而责任面只数 module 节点：不是两套口径，而是"谁必须有记账"与
 * "有记账的都算进总量"两个不同问题——非 module 节点若也带了合法计数，漏加它才会低估缺口。
 */
export function assessCoverage(graphData: Readonly<GraphJSON>): CoverageAssessment {
  let callSitesDetected = 0;
  let totalModules = 0;
  let accountedModules = 0;
  const nodes = Array.isArray(graphData.nodes) ? graphData.nodes : [];
  for (const n of nodes) {
    const c = readCallSitesCount(n);
    if (c !== null) callSitesDetected += c;
    if (isModuleNode(n)) {
      totalModules += 1;
      if (c !== null) accountedModules += 1;
    }
  }
  let callEdgesLinked = 0;
  const links = Array.isArray(graphData.links) ? graphData.links : [];
  for (const l of links) {
    // D3：`links` 里混进 null / 标量时，裸读 `l.relation` 会 throw 掉整个标注
    if (l !== null && typeof l === 'object' && (l as { relation?: unknown }).relation === 'calls') {
      callEdgesLinked += 1;
    }
  }

  if (accountedModules === 0) {
    return { kind: 'unaccounted', reason: 'no-accounting', accountedModules, totalModules };
  }
  if (accountedModules < totalModules) {
    return { kind: 'unaccounted', reason: 'partial-accounting', accountedModules, totalModules };
  }
  if (callSitesDetected < callEdgesLinked) {
    return { kind: 'inconsistent', callSitesDetected, callEdgesLinked };
  }
  if (callSitesDetected === 0) {
    // 走到这里必有 callEdgesLinked === 0（否则上一条已判 inconsistent）
    return { kind: 'unaccounted', reason: 'all-zero', accountedModules, totalModules };
  }

  const unlinkedCallSites = callSitesDetected - callEdgesLinked;
  if (unlinkedCallSites === 0) {
    return { kind: 'measured-zero', callSitesDetected, callEdgesLinked };
  }
  // 分母恒 > 0：`callSitesDetected === 0` 已在上面落 `unaccounted/all-zero`（D2）
  const ratio = Math.round((callEdgesLinked / callSitesDetected) * 10_000) / 10_000;
  return {
    kind: 'gap',
    gap: {
      callSitesDetected,
      callEdgesLinked,
      unlinkedCallSites,
      linkageRatio: ratio,
      separable: false,
      skippedSources: skippedSourcesOf(graphData),
    },
  };
}

/** `assessCoverage` 的窄化视图：只在"记账在场且自洽且有缺口"时给出量化，其余一律 null */
export function computeCoverageGap(graphData: Readonly<GraphJSON>): CoverageGap | null {
  const assessment = assessCoverage(graphData);
  return assessment.kind === 'gap' ? assessment.gap : null;
}

function skippedSourcesOf(graphData: Readonly<GraphJSON>): Array<{ source: string; reason: string }> {
  const raw = graphData.graph.skippedSources;
  if (!Array.isArray(raw)) return [];
  // 图产物是外部输入：逐条收口成 {source, reason} 字符串对，畸形项丢弃而非透传
  return raw
    .filter(
      (s): s is { source: string; reason: string } =>
        s !== null && typeof s === 'object' && typeof s.source === 'string' && typeof s.reason === 'string',
    )
    .map((s) => ({ source: s.source, reason: s.reason }));
}

// ============================================================
// resolution（三分互斥判定）
// ============================================================

/** exportKind 是图产物里的外部字符串，只有形如标识符的取值才允许回显（防控制字符注入文案） */
const SAFE_EXPORT_KIND = /^[A-Za-z_][A-Za-z0-9_-]{0,31}$/;

/**
 * 判定优先级固定（plan Q2）：
 *   1. symbol 级证据（external 节点 / 导出面）                        → boundary-exposed
 *   2. 图级缺口（无记账 / 记账不自洽 / 有未成边 call site / 缺席数据源）→ coverage-gap
 *   3. 三项正向证据齐备                                              → confirmed-zero
 *
 * 为什么 symbol 级优先于 graph 级：更强的证据（可归因到被查对象本身）优先，且更可操作；
 * 同时 `coverage` 数值恒随行，②③的缺口信息不因优先级而丢失。反过来让全图缺口吃掉一切的话，
 * `boundary-exposed` 在真实图上永远不可达，沦为死枚举。
 */
/** `unaccounted` 三种成因各自的人读说明（delta 审查 D2：三者的排查动作完全不同） */
function describeUnaccounted(
  coverage: Extract<CoverageAssessment, { kind: 'unaccounted' }>,
): string {
  switch (coverage.reason) {
    case 'no-accounting':
      return (
        '图内没有任何调用点记账（无节点带 callSitesCount），无法确认调用点测量是否执行过。' +
        '在"没测量"的图上不存在把零结果判为确认为零的依据'
      );
    case 'partial-accounting':
      return (
        `图内 ${coverage.totalModules - coverage.accountedModules}/${coverage.totalModules} 个模块缺记账` +
        `（仅 ${coverage.accountedModules} 个模块带合法 callSitesCount），` +
        '有记账的那部分不能代表全图，缺记账模块内的调用点测没测过无从判断'
      );
    case 'all-zero':
      return (
        '图内调用点记账全为零且图内无调用边，无法区分"调用点抽取未执行/已降级"与"项目确无调用点"' +
        '（建图侧把二者折叠成了同一个值 0），故不判为确认为零'
      );
  }
}

export function decideResolution(
  node: GraphNode | null,
  symbolId: string | null,
  coverage: CoverageAssessment,
  skippedSources: Array<{ source: string; reason: string }>,
): ResolutionVerdict {
  if (node !== null) {
    // D3：与 assessCoverage 同一读取口径——节点来自磁盘，metadata 可能缺席/为 null/被写成标量
    if (readOwnMetadata(node, 'external') === true) {
      return {
        reason: 'boundary-exposed',
        evidenceScope: 'symbol',
        detail: '该 symbol 是图外部节点（external=true），其调用方本就不在本图覆盖范围内，零结果不等于没有调用方',
      };
    }
    const exportKind = readOwnMetadata(node, 'exportKind');
    if (typeof exportKind === 'string' && exportKind.length > 0) {
      const kindText = SAFE_EXPORT_KIND.test(exportKind) ? `exportKind=${exportKind}` : '存在导出面';
      return {
        reason: 'boundary-exposed',
        evidenceScope: 'symbol',
        detail:
          `该 symbol 有对外导出面（${kindText}），图覆盖范围外（其他包 / 未建图语言 / 运行时动态调用）` +
          '可能存在调用方，零结果不等于没有调用方',
      };
    }
  }

  if (coverage.kind === 'unaccounted') {
    return {
      reason: 'coverage-gap',
      evidenceScope: 'graph',
      detail: describeUnaccounted(coverage),
    };
  }

  if (coverage.kind === 'inconsistent') {
    return {
      reason: 'coverage-gap',
      evidenceScope: 'graph',
      detail:
        `图内调用点记账不自洽（探测到 ${coverage.callSitesDetected} 个调用点，` +
        `却有 ${coverage.callEdgesLinked} 条 calls 边），记账与边集互相矛盾，` +
        '其上的任何覆盖度结论都不可信',
    };
  }

  if (coverage.kind === 'gap') {
    const g = coverage.gap;
    const pct = (g.linkageRatio * 100).toFixed(1);
    return {
      reason: 'coverage-gap',
      evidenceScope: 'graph',
      detail:
        `图中已探测到 ${g.callSitesDetected} 个调用点，其中 ${g.callEdgesLinked} 个连成 calls 边` +
        `（linkageRatio ${pct}%），${g.unlinkedCallSites} 个未成边。` +
        '未成边的部分同时包含"解析/链接失败"与"合法的图外调用"（宿主 API、第三方包方法等），' +
        '本版本不可区分二者（separable=false），故本次零结果不判为确认为零',
    };
  }

  if (skippedSources.length > 0) {
    return {
      reason: 'coverage-gap',
      evidenceScope: 'graph',
      detail:
        `建图时有 ${skippedSources.length} 个数据源缺席（${skippedSources.map((s) => s.source).join('、')}），` +
        '图的覆盖范围不完整，零结果可能只是覆盖不足',
    };
  }

  // 走到这里：记账在场、自洽、未成边为 0，且无缺席数据源 —— 三项正向证据齐备。
  if (node !== null) {
    return {
      reason: 'confirmed-zero',
      evidenceScope: 'symbol',
      detail:
        `图内调用点记账完整（探测 ${coverage.callSitesDetected} 个调用点全部成边）、无缺席数据源，` +
        '且该 symbol 无对外导出面，可判为确认为零',
    };
  }
  return {
    reason: 'confirmed-zero',
    evidenceScope: 'graph',
    detail:
      symbolId === null
        ? `图内调用点记账完整（探测 ${coverage.callSitesDetected} 个调用点全部成边）、无缺席数据源，` +
          '本次比较范围内确实不存在受影响的上游调用方'
        : // 被查 symbol 未在图中定位到节点：此时 MUST NOT 断言"它没有导出面"——那是对一个
          // 不存在的对象下结论。三个 handler 都在更早的分支拦掉了 not-found，故此路当前不可达，
          // 保留它只为让判据自身不依赖"上游一定拦住了"这一外部前提。
          `图内调用点记账完整（探测 ${coverage.callSitesDetected} 个调用点全部成边）、无缺席数据源；` +
          '被查 symbol 未在图中定位到节点，故未能核对其导出面',
  };
}

function findNodeById(graphData: Readonly<GraphJSON>, id: string): GraphNode | null {
  for (const n of graphData.nodes) {
    // E5-3：与 D3 同口径——图产物是外部输入，`nodes` 里混进 null / 标量时裸读 `.id` 直接 throw，
    // 一个畸形节点就把整个 honesty 信封打成 annotationDegraded。
    if (n === null || typeof n !== 'object') continue;
    if (n.id === id) return n;
  }
  return null;
}

// ============================================================
// builder 戳（裁决 1：只可见不判定）
// ============================================================

/**
 * 产出 `builderMismatch` / `builderDetail` 两个**独立** advisory 字段。
 *
 * 同一性由 `distSha256` 判定（对齐 `describeBuilderStamp` 的口径）：它是 dist 全树 .js 的
 * 内容 hash，相同即"执行的编译产物就是同一份"；commit / 脏标志只是盖章时刻的元数据，
 * 让它们主导结论会同时制造自相矛盾的断言与高频误报。
 *
 * 记录侧三态（没记 / 记了 null / 记了但读不懂）MUST NOT 合并——排查动作各不相同。
 * "读不懂"分支的说明 MUST 是与记录内容无关的常量串：磁盘上会长期存在更新版本写出的、
 * 本版本读不懂的 builder 值，任何回显都会重新打开注入面（F261 已实证）。
 */
function describeBuilder(
  graphData: Readonly<GraphJSON>,
  getCurrent: () => GraphBuilderStamp | null,
): { builderMismatch: boolean | null; builderDetail: string | null } {
  // why 这次断言不是类型逃逸：`GraphJSON['graph']` 的显式契约（graph-types.ts）里没有 `builder`
  // 这一键，而磁盘上的图产物是**外部输入**——旧版本可能没写、更新版本可能写了本版本读不懂的值。
  // 转成 Record 是为了走 hasOwnProperty + unknown 的防御性读取路径，把三种记录侧形态分辨开；
  // 若改成给契约加个 `builder?: unknown`，等于让类型层承认一个本模块不拥有的字段。
  const meta = graphData.graph as unknown as Record<string, unknown>;
  const hasField = Object.prototype.hasOwnProperty.call(meta, 'builder');
  const raw: unknown = hasField ? meta['builder'] : undefined;

  if (raw === undefined) {
    return {
      builderMismatch: null,
      builderDetail: '[builder] unrecorded — 图未记录 builder，无从判断由哪一版 build 建出',
    };
  }
  if (raw === null) {
    return {
      builderMismatch: null,
      builderDetail: '[builder] unstamped — 图记录 builder 为 null（未盖章 build / 源码直跑写出），无 build 身份可比对',
    };
  }
  const recorded = parseGraphBuilderStamp(raw);
  if (recorded === null) {
    return {
      builderMismatch: null,
      builderDetail: '[builder] unrecognized — builder 记录存在但不可识别（更新版本写出、或已被篡改）',
    };
  }
  const current = getCurrent();
  if (current === null) {
    return {
      builderMismatch: null,
      builderDetail: '[builder] 无法比对：当前进程未找到 build 盖章（源码直跑，或 dist 缺 .spectra-build-meta.json）',
    };
  }
  const sameProduct = recorded.distSha256 === current.distSha256;
  if (sameProduct) {
    return {
      builderMismatch: false,
      builderDetail: '[builder] 图由当前运行的这一份编译产物写出（dist 按 sha256 相同）',
    };
  }
  return {
    builderMismatch: true,
    builderDetail:
      `[builder] 图记录 dist ${recorded.distSha256.slice(0, 12)}；当前运行 ${current.distSha256.slice(0, 12)} — ` +
      '不是同一个 build（advisory：本字段不参与任何判定，不影响本次调用的成功状态）',
  };
}

// ============================================================
// comparisonScope（FR-012）
// ============================================================

/**
 * @param verdict `null` = 标注自身降级（freshness 根本没算出来），工作树状态无从谈起
 */
function buildComparisonScope(
  gitRange: string,
  verdict: GraphFreshnessVerdict | null,
): ComparisonScopeDeclaration {
  // 三点记法比的是两个已提交状态，工作树改动天然在比较范围之外。
  // dirty 态直接取自 freshness verdict —— 不为这一个字段再 spawn 一次 git。
  const { value, suffix } = describeWorkingTreeState(verdict);
  return {
    notation: 'three-dot',
    gitRange,
    includesUncommitted: false,
    uncommittedChangesPresent: value,
    detail:
      `本次比较使用三点记法 \`${gitRange}\`，只比较两个已提交状态，不含工作区未提交改动` +
      `（比较基点是 merge-base(base, HEAD)，base 分支自身在分叉后的改动不计入）；${suffix}`,
  };
}

/**
 * 把 freshness verdict 翻译成工作树状态的三态判定 + 人读说明。
 *
 * 关键：只有 `fresh` 与"确实读到了 porcelain 结果"的 `dirty` 才是**测量过**的结论。
 * `stale` 在 `evaluateFreshness` 的优先级里排在 dirty 检测之前并短路返回，
 * 此时 `git status` 一次都没跑过 —— 任何 true/false 都是编的。
 */
function describeWorkingTreeState(
  verdict: GraphFreshnessVerdict | null,
): { value: boolean | null; suffix: string } {
  if (verdict === null) {
    return { value: null, suffix: '当前工作树是否另有未提交改动未判定（诚实标注自身计算失败）' };
  }
  switch (verdict.state) {
    case 'dirty':
      // porcelainReadFailed 的 dirty 是"读失败后保守按脏处理"，不是测得为脏：
      // 渲染成肯定句「确实有未提交改动」就是把兜底假设冒充成观测事实。
      return verdict.porcelainReadFailed === true
        ? {
            value: null,
            suffix: '当前工作树状态检测失败（git status 读取失败），保守按可能有未提交改动处理',
          }
        : { value: true, suffix: '当前工作树另有未提交的源码改动，未纳入本次比较' };
    case 'fresh':
      return { value: false, suffix: '当前工作树无未提交的源码改动' };
    case 'stale':
      return { value: null, suffix: '当前工作树是否另有未提交改动未判定（图已陈旧，工作树状态未检测）' };
    default:
      return { value: null, suffix: '当前工作树是否另有未提交改动未判定（图来源版本不可知，工作树状态未检测）' };
  }
}
