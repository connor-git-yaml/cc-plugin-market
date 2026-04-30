/**
 * Cluster Orchestrator — Spectra v4.1.0 MapReduce 统一调度层
 *
 * 设计权威：specs/140-spectra-doc-pipeline-quality/research/02-mapreduce-architecture.md §二
 * 业务范围：specs/140-spectra-doc-pipeline-quality/spec.md (FR-001 ~ FR-002, FR-014)
 *
 * 职责边界：
 * 1. Phase A 聚类策略（community → directory → single fallback chain）
 * 2. Phase B 并发 Map（maxConcurrency=4，per-call timeout=180s）
 * 3. Phase C 单次 Reduce（timeout=300s，1 次重试）
 * 4. FFD 装箱拆分（cluster 超 maxSize=15 或超 tokenBudget 时按 module 大小降序装箱）
 * 5. 6 个 Telemetry hooks 在正确时机触发
 * 6. mergeConfidence 程序化打分（high/medium/low）
 *
 * 通用性：本模块不写文件、不知道 outputDir。fail-closed 时返回 finalOutput=null + diagnostics，
 * 由调用方（ADR / narrative / hyperedges pipeline）负责写 `_PIPELINE_FAILED.md` 标记
 * （沿用 Feature 135 模式，参见 src/panoramic/batch-project-docs.ts）。
 */

import pLimit from 'p-limit';
import { z } from 'zod';
import type { GraphJSON } from './graph/graph-types.js';
import { detectCommunities, loadGraph } from './community/community-detector.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('cluster-orchestrator');

// ============================================================
// 常量
// ============================================================

/** 默认 Map 并发度（避免触发 Anthropic API 429；Q12 决议）*/
export const DEFAULT_MAX_CONCURRENCY = 4;
/** 默认 Map per-call 超时（180s）*/
export const DEFAULT_PER_CALL_TIMEOUT_MS = 180_000;
/** 默认 Reduce 超时（300s）*/
export const DEFAULT_REDUCE_TIMEOUT_MS = 300_000;
/** 默认 community 聚类 minSize（< minSize 的 input 走 single fallback）*/
export const DEFAULT_COMMUNITY_MIN_SIZE = 3;
/** 默认 community 聚类 maxSize（Q14 决议：与 100k token budget 匹配）*/
export const DEFAULT_COMMUNITY_MAX_SIZE = 15;
/** 默认 cluster 总 token 预算（每 Map call input ≤ 100k tokens）*/
export const DEFAULT_TOKEN_BUDGET = 100_000;
/** 默认 sharedHeader 预留 token 额度 */
export const DEFAULT_SHARED_HEADER_BUDGET = 15_000;
/** chars → tokens 粗算系数（chars / 3.5 ≈ tokens）*/
const CHARS_PER_TOKEN = 3.5;
/** Map 失败容忍阈值：< 50% Map 成功即 fail-closed */
const MIN_MAP_SUCCESS_RATIO = 0.5;
/** mergeConfidence: low 触发阈值 — Map 失败率 > 30% */
const LOW_CONFIDENCE_FAILURE_RATIO = 0.3;

// ============================================================
// Zod schemas（运行时校验 + 类型派生）
// ============================================================

export const callTelemetrySchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  modelId: z.string().min(1),
});

/** 单次 LLM 调用的可观测性元数据 */
export type CallTelemetry = z.infer<typeof callTelemetrySchema>;

// ============================================================
// Cluster 策略类型
// ============================================================

/**
 * Community 策略：复用 src/panoramic/community/ 的 Louvain 检测
 * 调用方需提供 graph 与 input → nodeId 映射；
 * 可选提供 directoryFallback 在 community 失败时降级为 directory 策略（保留三级 fallback chain）
 */
export interface ClusterStrategyCommunity<TInput> {
  kind: 'community';
  /** 最小社区节点数；<= 0 视为不过滤（默认 3）*/
  minSize?: number;
  /** 最大社区节点数；超过则触发 FFD 装箱拆分（默认 15）*/
  maxSize?: number;
  /** Louvain 检测的图（NetworkX node-link 格式）*/
  graph: GraphJSON;
  /** TInput → graph nodeId 映射 */
  getInputId: (input: TInput) => string;
  /**
   * 可选：community 失败时启用 directory 降级所需的路径访问器。
   * 不提供时直接降级到 single（fallback 退化为两级）。
   */
  directoryFallback?: {
    getInputPath: (input: TInput) => string;
  };
}

/** Directory 策略：按 path.dirname 分组 */
export interface ClusterStrategyDirectory<TInput> {
  kind: 'directory';
  /** TInput → 文件路径映射 */
  getInputPath: (input: TInput) => string;
}

/** Single 策略：所有 input 进 1 个 cluster */
export interface ClusterStrategySingle {
  kind: 'single';
}

export type ClusterStrategy<TInput> =
  | ClusterStrategyCommunity<TInput>
  | ClusterStrategyDirectory<TInput>
  | ClusterStrategySingle;

// ============================================================
// Map / Reduce 选项
// ============================================================

export interface MapOptions<TInput, TMapOutput> {
  /**
   * 单 cluster Map 函数；返回 (TMapOutput, telemetry)。
   * 可选 `signal` 在超时时被 abort：caller 应将其转发给底层 LLM SDK 调用
   * （如 `client.messages.create({ ...args, signal })`），以便真正取消 in-flight 请求；
   * 调用方忽略 signal 时本字段无副作用，但 orchestrator 的 timeout 语义会退化为
   * "Promise.race 赢得超时但底层调用继续 background 跑"（不影响 dispatch 正确性，
   * 但会浪费 token 配额）。
   */
  fn: (
    cluster: TInput[],
    sharedHeader: string,
    signal?: AbortSignal,
  ) => Promise<{ output: TMapOutput; telemetry: CallTelemetry }>;
  /** 模型选择（仅记录到 telemetry，不影响 dispatch 行为）*/
  model?: 'sonnet' | 'opus';
  /** 最大并发度（默认 4）*/
  maxConcurrency?: number;
  /** 单次 Map 调用超时 ms（默认 180_000）*/
  perCallTimeout?: number;
}

export interface ReduceOptions<TMapOutput, TReduceOutput> {
  /**
   * 单次 Reduce 函数。`signal` 含义同 MapOptions.fn — caller 转发给 SDK 才能真正取消。
   */
  fn: (
    mapOutputs: TMapOutput[],
    sharedHeader: string,
    signal?: AbortSignal,
  ) => Promise<{ output: TReduceOutput; telemetry: CallTelemetry }>;
  /** 模型选择（仅记录到 telemetry）*/
  model?: 'sonnet' | 'opus';
  /** 单次 Reduce 调用超时 ms（默认 300_000）*/
  timeout?: number;
}

// ============================================================
// Token 预算选项 + Telemetry hooks
// ============================================================

export interface TokenBudgetOptions {
  /** 每 cluster 总 token 预算（含 sharedHeader）（默认 100_000）*/
  totalBudget?: number;
  /** sharedHeader 预留固定额度（默认 15_000）*/
  sharedHeaderBudget?: number;
  /**
   * 计算单 input 的 token 数。默认按 JSON.stringify(input).length / 3.5 粗算。
   * 调用方可注入更精确的估算（如真实 tokenizer）。
   */
  estimateInputTokens?: (input: unknown) => number;
}

export interface TelemetryHooks<TInput, TMapOutput, TReduceOutput> {
  /** 聚类完成后触发，参数为最终 cluster 列表（含 FFD 拆分后）*/
  onClusterPlanned?: (clusters: TInput[][]) => void;
  /** 每 cluster Map 开始前触发（idx 从 0 起）*/
  onMapStart?: (clusterIdx: number, size: number) => void;
  /** 单 cluster Map 成功后触发 */
  onMapComplete?: (clusterIdx: number, output: TMapOutput, telemetry: CallTelemetry) => void;
  /** 单 cluster Map 失败后触发 */
  onMapFailed?: (clusterIdx: number, error: Error) => void;
  /** Reduce 开始前触发 */
  onReduceStart?: (mapOutputCount: number) => void;
  /** Reduce 成功后触发（重试成功时也只触发一次）*/
  onReduceComplete?: (output: TReduceOutput, telemetry: CallTelemetry) => void;
}

// ============================================================
// 完整 Options + Result
// ============================================================

export interface ClusterDispatchOptions<TInput, TMapOutput, TReduceOutput>
  extends TelemetryHooks<TInput, TMapOutput, TReduceOutput> {
  /** Phase A 输入项（通常是 module spec 列表）*/
  inputs: TInput[];
  /** Phase A 聚类策略 */
  clusterStrategy: ClusterStrategy<TInput>;
  /** Phase B shared context — 每个 cluster 都看到的全局信息（避免跨 cluster 依赖丢失）*/
  sharedHeader: () => Promise<string>;
  /** Phase B Map 配置 */
  map: MapOptions<TInput, TMapOutput>;
  /** Phase C Reduce 配置 */
  reduce: ReduceOptions<TMapOutput, TReduceOutput>;
  /** Token 预算配置（控制 FFD 装箱）*/
  tokenBudget?: TokenBudgetOptions;
}

export interface ClusterDispatchDiagnostics {
  /** 最终 cluster 数（含 FFD 拆分后）*/
  clusterCount: number;
  /** 初始聚类策略（含 fallback 后真正生效的）*/
  appliedStrategy: ClusterStrategy<unknown>['kind'];
  /** Map 成功 cluster 数 */
  mapSucceeded: number;
  /** Map 失败 cluster 数 */
  mapFailed: number;
  /** Map 阶段 token 累计 */
  mapTotalTokens: { input: number; output: number };
  /** Reduce 阶段 token 累计（含重试）*/
  reduceTokens: { input: number; output: number };
  /** Reduce 重试次数（0 = 一次成功；1 = 重试 1 次成功；>=1 时 finalOutput=null 表示重试仍失败）*/
  reduceRetries: number;
  /** 总耗时 ms（从 dispatch 入口到 reduce 完成或 fail-closed 决策）*/
  totalDurationMs: number;
  /** 程序化合并置信度 */
  mergeConfidence: 'high' | 'medium' | 'low';
  /** fail-closed 标志（true 时 finalOutput=null）*/
  failClosed: boolean;
  /** fail-closed 原因（仅 failClosed=true 时填充）*/
  failClosedReason?:
    | 'map-below-threshold'
    | 'reduce-failed'
    | 'clustering-failed'
    | 'shared-header-failed';
  /** FFD 拆分次数（>0 表示有 cluster 因超 budget/maxSize 被拆分）*/
  clusterSplits: number;
  /**
   * 单 input 单独超过 token budget 的数量（FFD 无法装下"巨型模块"）。
   * 这些 input 仍然出现在某个 bin 中（保留零模块丢失承诺），但 caller 应感知并决定
   * 是否对其本身做截断或拒绝；orchestrator 不强行删除它们。
   */
  oversizedInputs: number;
}

export interface ClusterDispatchResult<TReduceOutput> {
  /** 成功时为 Reduce 输出；fail-closed 时为 null */
  finalOutput: TReduceOutput | null;
  diagnostics: ClusterDispatchDiagnostics;
}

// ============================================================
// 工具函数：token 估算
// ============================================================

function defaultEstimateTokens(input: unknown): number {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ============================================================
// 工具函数：Promise + timeout + AbortSignal
// ============================================================

/**
 * 在 timeoutMs 内 race 一个由 taskFn 启动的任务；
 * 超时时 abort 内部 AbortController（taskFn 接收 signal，可转发给 fetch / SDK 真正取消）。
 *
 * 限制：JS Promise 模型无 cancellation 原语；如果 taskFn 不消费 signal，
 * 超时只让本函数返回 reject 但底层 promise 仍在 background 运行（产生 token 浪费）。
 */
async function withTimeoutAndSignal<T>(
  taskFn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} 超时（${timeoutMs}ms）`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([taskFn(controller.signal), timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 安全调用 telemetry hook：同时处理同步抛错和 async hook 返回的 rejected Promise，
 * 避免单点观测/上报失败影响 dispatch 主流程（CLAUDE.local.md 守则）。
 *
 * 设计：fire-and-forget — hook 不阻塞 dispatch；async rejection 通过 .catch 吞掉 + warn
 * （否则 Node.js 会抛 unhandledRejection 影响进程稳定性）。
 *
 * 类型放宽到 `() => void | Promise<void>` 是因为生产 telemetry/export hook
 * 通常是异步的（如发送 HTTP 给监控服务）；旧的 `() => void` 类型在 TS 下仍能接受
 * async callback（async function 隐式返回 Promise<void>），不会编译错。
 */
function safeInvokeHook(label: string, fn: (() => void | Promise<void>) | undefined): void {
  if (!fn) return;
  try {
    const result = fn();
    // async hook：捕获 rejected Promise（fire-and-forget，不阻塞 dispatch）
    if (result && typeof (result as Promise<void>).then === 'function') {
      (result as Promise<void>).catch((error: unknown) => {
        logger.warn(`telemetry hook ${label} async rejection 已忽略：${String(error)}`);
      });
    }
  } catch (error) {
    // 同步 throw
    logger.warn(`telemetry hook ${label} 抛出异常已忽略：${String(error)}`);
  }
}

// ============================================================
// Phase A — 聚类策略实现
// ============================================================

interface ClusteringResult<TInput> {
  clusters: TInput[][];
  /** 实际生效的策略（可能因 fallback 异于请求）*/
  appliedStrategy: ClusterStrategy<unknown>['kind'];
}

/**
 * 执行聚类策略，依次尝试 community → directory → single fallback chain。
 * 任何级失败（抛异常 / 产出 0 cluster）均自动降级，不向上抛错。
 */
function applyClusteringStrategy<TInput>(
  inputs: TInput[],
  strategy: ClusterStrategy<TInput>,
  minSize: number,
): ClusteringResult<TInput> {
  // 输入数量低于 minSize：直接 single（避免 Louvain/dirname 在小数据上分散过头）
  if (inputs.length < minSize) {
    return { clusters: [inputs], appliedStrategy: 'single' };
  }

  if (strategy.kind === 'single') {
    return { clusters: [inputs], appliedStrategy: 'single' };
  }

  if (strategy.kind === 'community') {
    try {
      const communityResult = clusterByCommunity(inputs, strategy);
      if (communityResult.length === 0) {
        // Louvain 未产出有效社区（如所有节点不在图中）— 降级 directory
        throw new Error('community detection 产出 0 社区');
      }
      return { clusters: communityResult, appliedStrategy: 'community' };
    } catch (communityError) {
      logger.debug(`community 策略失败，尝试降级：${String(communityError)}`);
      // 通过显式的 directoryFallback 字段降级；若未提供则直接 single
      if (strategy.directoryFallback) {
        try {
          const dirClusters = clusterByDirectory(inputs, {
            kind: 'directory',
            getInputPath: strategy.directoryFallback.getInputPath,
          });
          return { clusters: dirClusters, appliedStrategy: 'directory' };
        } catch (directoryError) {
          logger.debug(`directory 降级也失败，最终走 single：${String(directoryError)}`);
          return { clusters: [inputs], appliedStrategy: 'single' };
        }
      }
      // 没有 directory 路径回退能力，直接 single
      return { clusters: [inputs], appliedStrategy: 'single' };
    }
  }

  // strategy.kind === 'directory'
  try {
    return { clusters: clusterByDirectory(inputs, strategy), appliedStrategy: 'directory' };
  } catch {
    return { clusters: [inputs], appliedStrategy: 'single' };
  }
}

function clusterByCommunity<TInput>(
  inputs: TInput[],
  strategy: ClusterStrategyCommunity<TInput>,
): TInput[][] {
  const minSize = strategy.minSize ?? DEFAULT_COMMUNITY_MIN_SIZE;
  // Louvain 在 graphology 上检测社区
  const graph = loadGraph(strategy.graph);
  const { communities } = detectCommunities(graph, { minSize });

  // input id → input 索引
  const idToInput = new Map<string, TInput>();
  for (const input of inputs) {
    idToInput.set(strategy.getInputId(input), input);
  }

  // community.nodes → input
  const clusters: TInput[][] = [];
  const assigned = new Set<TInput>();
  for (const community of communities) {
    const cluster: TInput[] = [];
    for (const nodeId of community.nodes) {
      const input = idToInput.get(nodeId);
      if (input !== undefined && !assigned.has(input)) {
        cluster.push(input);
        assigned.add(input);
      }
    }
    if (cluster.length > 0) clusters.push(cluster);
  }

  // 关键不变量：community 策略必须真正利用图结构。如果没有任何 input 被分配
  // 到合规社区（图节点不匹配 / 图为空 / Louvain 输出 0 社区），属于 community 策略
  // 失败，向上抛错以触发 fallback chain（→ directory → single）。
  if (assigned.size === 0) {
    throw new Error('community 策略未能分配任何 input（graph 不匹配或 Louvain 产出 0 社区）');
  }

  // 处理未分配 input（图中没有的节点 — 单成 1 cluster 防止丢失）
  const orphans = inputs.filter((i) => !assigned.has(i));
  if (orphans.length > 0) clusters.push(orphans);

  return clusters;
}

function clusterByDirectory<TInput>(
  inputs: TInput[],
  strategy: ClusterStrategyDirectory<TInput>,
): TInput[][] {
  const buckets = new Map<string, TInput[]>();
  for (const input of inputs) {
    const filePath = strategy.getInputPath(input);
    const dir = dirname(filePath);
    const bucket = buckets.get(dir);
    if (bucket) {
      bucket.push(input);
    } else {
      buckets.set(dir, [input]);
    }
  }
  return [...buckets.values()];
}

/** 简单 dirname（避开 Node path 模块的 OS 差异，使用纯字符串处理）*/
function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? '.' : normalized.slice(0, idx) || '/';
}

// ============================================================
// Phase A.5 — FFD 装箱拆分（修复 Codex review finding 2）
// ============================================================

/**
 * First-Fit-Decreasing 装箱拆分：
 * 当 cluster 模块数 > maxSize 或 cluster token 总和 > tokenBudget 时，
 * 按 module token 大小降序排序后装入 capacity=tokenBudget 的子 bin，
 * 不能放入现有 bin 时新建 bin。
 *
 * **保证零模块丢失**（与"截断尾部"模式严格区分；架构 §二 与 spec FR-001）。
 *
 * 巨型模块边界：当单个 input 的 token 数 > tokenBudget 时（"巨型模块"），
 * 仍然把它单独放入一个 bin（保持零模块丢失），但通过返回值的 `oversizedCount`
 * 报告这一情况，由 caller 决定是否对该 input 自身做截断或拒绝。
 * orchestrator 不强行删除 oversized input，因为这违反"零模块丢失"承诺。
 *
 * @returns `{ bins, oversizedCount }`；合规时 bins=[cluster] 且 oversizedCount=0
 */
function splitClusterByFFD<TInput>(
  cluster: TInput[],
  maxSize: number,
  tokenBudget: number,
  estimateTokens: (input: unknown) => number,
): { bins: TInput[][]; oversizedCount: number } {
  // 单 cluster 内每个 input 的 token 估算
  const sizes = cluster.map((input) => ({ input, tokens: estimateTokens(input) }));
  const totalTokens = sizes.reduce((acc, s) => acc + s.tokens, 0);
  const oversizedCount = sizes.filter((s) => s.tokens > tokenBudget).length;

  // 合规则不拆分（即便有零个 token 估算项，也归为合规分支）
  if (cluster.length <= maxSize && totalTokens <= tokenBudget) {
    return { bins: [cluster], oversizedCount: 0 };
  }

  // 按 token 降序排序（FFD 第 1 步）
  sizes.sort((a, b) => b.tokens - a.tokens);

  // 装箱：每 bin capacity = tokenBudget；同时保持 |bin| ≤ maxSize
  // 巨型 input：当 tokens > tokenBudget 时，会落到一个独占 bin（仍超 budget，
  // 但保持零模块丢失；caller 通过 diagnostics.oversizedInputs 感知）。
  const bins: { items: TInput[]; tokens: number }[] = [];
  for (const { input, tokens } of sizes) {
    let placed = false;
    for (const bin of bins) {
      if (bin.tokens + tokens <= tokenBudget && bin.items.length < maxSize) {
        bin.items.push(input);
        bin.tokens += tokens;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bins.push({ items: [input], tokens });
    }
  }

  return { bins: bins.map((bin) => bin.items), oversizedCount };
}

// ============================================================
// 主入口：clusterDispatch
// ============================================================

/**
 * MapReduce 统一调度入口。
 *
 * 阶段：
 *   1. 聚类（Phase A）— 三级 fallback chain
 *   2. FFD 装箱拆分（Phase A.5）— 超 maxSize/tokenBudget 拆分，零模块丢失
 *   3. 计算 sharedHeader（一次，传给所有 Map）
 *   4. Map 并发调度（Phase B）— maxConcurrency=4，per-call timeout=180s
 *   5. Map < 50% 成功 → fail-closed 不进 Reduce
 *   6. Reduce + 1 次重试（Phase C）— timeout=300s
 *   7. 计算 mergeConfidence（high/medium/low）
 *   8. 触发 6 个 telemetry hooks
 */
export async function clusterDispatch<TInput, TMapOutput, TReduceOutput>(
  options: ClusterDispatchOptions<TInput, TMapOutput, TReduceOutput>,
): Promise<ClusterDispatchResult<TReduceOutput>> {
  const start = Date.now();
  const tokenBudget = options.tokenBudget?.totalBudget ?? DEFAULT_TOKEN_BUDGET;
  const sharedHeaderBudget =
    options.tokenBudget?.sharedHeaderBudget ?? DEFAULT_SHARED_HEADER_BUDGET;
  const estimateTokens = options.tokenBudget?.estimateInputTokens ?? defaultEstimateTokens;
  const clusterTokenBudget = Math.max(0, tokenBudget - sharedHeaderBudget);
  const maxSize =
    options.clusterStrategy.kind === 'community'
      ? options.clusterStrategy.maxSize ?? DEFAULT_COMMUNITY_MAX_SIZE
      : DEFAULT_COMMUNITY_MAX_SIZE;
  const minSize =
    options.clusterStrategy.kind === 'community'
      ? options.clusterStrategy.minSize ?? DEFAULT_COMMUNITY_MIN_SIZE
      : DEFAULT_COMMUNITY_MIN_SIZE;
  const maxConcurrency = options.map.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const perCallTimeout = options.map.perCallTimeout ?? DEFAULT_PER_CALL_TIMEOUT_MS;
  const reduceTimeout = options.reduce.timeout ?? DEFAULT_REDUCE_TIMEOUT_MS;

  // -------- Phase A: 聚类 --------
  let initialClusters: TInput[][];
  let appliedStrategy: ClusterStrategy<unknown>['kind'];
  try {
    const clusteringResult = applyClusteringStrategy(
      options.inputs,
      options.clusterStrategy,
      minSize,
    );
    initialClusters = clusteringResult.clusters;
    appliedStrategy = clusteringResult.appliedStrategy;
  } catch (error) {
    // applyClusteringStrategy 内部已 fallback 到 single；走到 catch 说明 single 都失败（理论不可达）
    logger.warn(`applyClusteringStrategy 三级 fallback 全失败：${String(error)}`);
    return {
      finalOutput: null,
      diagnostics: {
        clusterCount: 0,
        appliedStrategy: 'single',
        mapSucceeded: 0,
        mapFailed: 0,
        mapTotalTokens: { input: 0, output: 0 },
        reduceTokens: { input: 0, output: 0 },
        reduceRetries: 0,
        totalDurationMs: Date.now() - start,
        mergeConfidence: 'low',
        failClosed: true,
        failClosedReason: 'clustering-failed',
        clusterSplits: 0,
        oversizedInputs: 0,
      },
    };
  }

  // -------- Phase A.5: FFD 装箱拆分 --------
  const finalClusters: TInput[][] = [];
  let clusterSplits = 0;
  let oversizedInputs = 0;
  for (const cluster of initialClusters) {
    const { bins, oversizedCount } = splitClusterByFFD(
      cluster,
      maxSize,
      clusterTokenBudget,
      estimateTokens,
    );
    if (bins.length > 1) clusterSplits += bins.length - 1;
    oversizedInputs += oversizedCount;
    finalClusters.push(...bins);
  }
  if (oversizedInputs > 0) {
    // 巨型模块（单 input > tokenBudget）：保留 + 警告（caller 决策是否截断）
    logger.warn(
      `检测到 ${oversizedInputs} 个 input 单独超过 tokenBudget=${clusterTokenBudget}；` +
      `已按"零模块丢失"策略保留它们，但 Map 调用可能因超 token 失败。` +
      `建议 caller 对这些 input 自身做截断或拒绝。`,
    );
  }

  // 触发 onClusterPlanned hook（safeInvokeHook 包裹防止用户回调抛错破坏主流程）
  safeInvokeHook('onClusterPlanned', () => options.onClusterPlanned?.(finalClusters));

  // -------- Phase B 准备：计算 sharedHeader --------
  // sharedHeader() 抛错或超时不应让整个 dispatch reject；走 fail-closed 返回 diagnostics
  let sharedHeader: string;
  try {
    sharedHeader = await options.sharedHeader();
  } catch (error) {
    logger.warn(`sharedHeader() 失败 → fail-closed：${String(error)}`);
    return {
      finalOutput: null,
      diagnostics: {
        clusterCount: finalClusters.length,
        appliedStrategy,
        mapSucceeded: 0,
        mapFailed: 0,
        mapTotalTokens: { input: 0, output: 0 },
        reduceTokens: { input: 0, output: 0 },
        reduceRetries: 0,
        totalDurationMs: Date.now() - start,
        mergeConfidence: 'low',
        failClosed: true,
        failClosedReason: 'shared-header-failed',
        clusterSplits,
        oversizedInputs,
      },
    };
  }

  // -------- Phase B: Map 并发调度 --------
  const limit = pLimit(maxConcurrency);
  const mapResults: Array<{
    output: TMapOutput | null;
    telemetry: CallTelemetry | null;
    success: boolean;
  }> = new Array(finalClusters.length).fill(null).map(() => ({
    output: null,
    telemetry: null,
    success: false,
  }));

  await Promise.all(
    finalClusters.map((cluster, idx) =>
      limit(async () => {
        safeInvokeHook(`onMapStart[${idx}]`, () => options.onMapStart?.(idx, cluster.length));
        try {
          const { output, telemetry } = await withTimeoutAndSignal(
            (signal) => options.map.fn(cluster, sharedHeader, signal),
            perCallTimeout,
            `Map cluster #${idx}`,
          );
          // 校验 telemetry schema（防止 caller 返回不合规 telemetry 污染 diagnostics）
          callTelemetrySchema.parse(telemetry);
          mapResults[idx] = { output, telemetry, success: true };
          safeInvokeHook(`onMapComplete[${idx}]`, () =>
            options.onMapComplete?.(idx, output, telemetry),
          );
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          safeInvokeHook(`onMapFailed[${idx}]`, () => options.onMapFailed?.(idx, err));
          // success=false 已在初始化时设置
        }
      }),
    ),
  );

  const mapSucceeded = mapResults.filter((r) => r.success).length;
  const mapFailed = finalClusters.length - mapSucceeded;
  const mapTotalTokens = mapResults.reduce(
    (acc, r) => {
      if (r.telemetry) {
        acc.input += r.telemetry.inputTokens;
        acc.output += r.telemetry.outputTokens;
      }
      return acc;
    },
    { input: 0, output: 0 },
  );

  // -------- Phase B 失败检查：< 50% 成功 → fail-closed --------
  const successRatio = finalClusters.length > 0 ? mapSucceeded / finalClusters.length : 0;
  if (successRatio < MIN_MAP_SUCCESS_RATIO) {
    return {
      finalOutput: null,
      diagnostics: {
        clusterCount: finalClusters.length,
        appliedStrategy,
        mapSucceeded,
        mapFailed,
        mapTotalTokens,
        reduceTokens: { input: 0, output: 0 },
        reduceRetries: 0,
        totalDurationMs: Date.now() - start,
        mergeConfidence: 'low',
        failClosed: true,
        failClosedReason: 'map-below-threshold',
        clusterSplits,
        oversizedInputs,
      },
    };
  }

  // -------- Phase C: Reduce + 1 次重试 --------
  const successfulOutputs = mapResults
    .filter((r): r is { output: TMapOutput; telemetry: CallTelemetry; success: true } => r.success)
    .map((r) => r.output);

  safeInvokeHook('onReduceStart', () => options.onReduceStart?.(successfulOutputs.length));

  let reduceOutput: TReduceOutput | null = null;
  let reduceTelemetry: CallTelemetry | null = null;
  let reduceRetries = 0;
  const reduceTokens = { input: 0, output: 0 };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await withTimeoutAndSignal(
        (signal) => options.reduce.fn(successfulOutputs, sharedHeader, signal),
        reduceTimeout,
        `Reduce 调用 (attempt ${attempt + 1})`,
      );
      callTelemetrySchema.parse(result.telemetry);
      reduceOutput = result.output;
      reduceTelemetry = result.telemetry;
      reduceTokens.input += result.telemetry.inputTokens;
      reduceTokens.output += result.telemetry.outputTokens;
      break; // 成功，跳出重试循环
    } catch {
      reduceRetries = attempt + 1;
      // 第 1 次失败累计 retry，进入第 2 次循环；第 2 次失败保持 reduceOutput=null
    }
  }

  if (reduceOutput === null) {
    // Reduce 重试仍失败：fail-closed
    return {
      finalOutput: null,
      diagnostics: {
        clusterCount: finalClusters.length,
        appliedStrategy,
        mapSucceeded,
        mapFailed,
        mapTotalTokens,
        reduceTokens,
        reduceRetries,
        totalDurationMs: Date.now() - start,
        mergeConfidence: 'low',
        failClosed: true,
        failClosedReason: 'reduce-failed',
        clusterSplits,
        oversizedInputs,
      },
    };
  }

  // 触发 onReduceComplete（仅成功时一次，不在重试时重复触发）
  if (reduceTelemetry) {
    const finalOutput = reduceOutput;
    const finalTelemetry = reduceTelemetry;
    safeInvokeHook('onReduceComplete', () => options.onReduceComplete?.(finalOutput, finalTelemetry));
  }

  // -------- mergeConfidence 计算 --------
  // high: 0 map failures + 0 reduce retries
  // medium: 0 < map failures ≤ 30% OR reduce retried 1 次成功
  // low: > 30% map failures
  // （borderline reduce 输出由 caller 通过自定义后处理判定，超出本 orchestrator 范围）
  const failureRatio = finalClusters.length > 0 ? mapFailed / finalClusters.length : 0;
  let mergeConfidence: 'high' | 'medium' | 'low';
  if (failureRatio > LOW_CONFIDENCE_FAILURE_RATIO) {
    mergeConfidence = 'low';
  } else if (failureRatio > 0 || reduceRetries > 0) {
    mergeConfidence = 'medium';
  } else {
    mergeConfidence = 'high';
  }

  return {
    finalOutput: reduceOutput,
    diagnostics: {
      clusterCount: finalClusters.length,
      appliedStrategy,
      mapSucceeded,
      mapFailed,
      mapTotalTokens,
      reduceTokens,
      reduceRetries,
      totalDurationMs: Date.now() - start,
      mergeConfidence,
      failClosed: false,
      clusterSplits,
      oversizedInputs,
    },
  };
}

// ============================================================
// 暴露内部辅助函数（供单测使用，不进 public API）
// ============================================================

/** @internal — 仅供单元测试导入；生产代码请使用 clusterDispatch 主入口 */
export const __internal = {
  splitClusterByFFD,
  applyClusteringStrategy,
  defaultEstimateTokens,
  withTimeoutAndSignal,
  safeInvokeHook,
  dirname,
};
