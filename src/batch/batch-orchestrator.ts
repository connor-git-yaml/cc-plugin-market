/**
 * 批量编排器
 * 按模块级拓扑顺序编排全项目 Spec 生成（FR-012/FR-014/FR-015/FR-016/FR-017）
 * 支持多语言混合项目：按语言分组、分组依赖图构建、图合并拓扑排序（Feature 031）
 * 参见 contracts/batch-module.md
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import pLimit from 'p-limit';
import { findReadmePath } from '../extraction/index.js';
import { generateSpec, type GenerateSpecOptions } from '../core/single-spec-orchestrator.js';
import { generateIndex } from '../generator/index-generator.js';
import { renderIndex, initRenderer } from '../generator/spec-renderer.js';
import {
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
  DEFAULT_CHECKPOINT_PATH,
} from './checkpoint.js';
import { DeltaRegenerator, type DeltaReport } from './delta-regenerator.js';
import { createReporter, type ProgressMode } from './progress-reporter.js';
import {
  aggregateCostSummary,
  type CostSummary,
  type ModuleCostRecord,
} from './cost-summary.js';
import {
  estimateModuleCost,
  buildDryRunReport,
  renderDryRunReport,
  runBudgetGate,
  type BudgetPolicy,
  type BudgetGateAttempt,
  type ModuleEstimate,
} from './budget-gate.js';
import { decideModelOverride } from './model-override-decision.js';
import { createLogger } from '../panoramic/utils/logger.js';
import { groupFilesToModules, type GroupingOptions } from './module-grouper.js';
import { buildSpecCacheKey, normalizeProjectPath, resolveRegenPlan, resolveSourceTarget, type RegenPlan } from './regen-plan.js';
import type { LanguageFileStat } from '../utils/file-scanner.js';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';
import type { BatchState, CompletedModule, FailedModule, ModuleSpec } from '../models/module-spec.js';
import {
  buildDocGraph,
  isBatchGenerated,
  runAnchorIntegration,
  runHyperedgeIntegration,
  scanStoredModuleSpecs,
  type StoredModuleSpecSummary,
} from '../panoramic/builders/doc-graph-builder.js';
import { chunkMarkdownFiles } from '../panoramic/anchoring/chunker.js';
import { createEmbeddingProvider } from '../panoramic/anchoring/providers/factory.js';
import { DOC_NODE_KINDS } from '../panoramic/hyperedges/constants.js';
import type { GraphNode as PanoramicGraphNode } from '../panoramic/graph/graph-types.js';
import { buildCrossReferenceIndex } from '../panoramic/cross-reference-index.js';
import { renderSpec } from '../generator/spec-renderer.js';
import { CoverageAuditor } from '../panoramic/pipelines/coverage-auditor.js';
import { buildProjectContext } from '../panoramic/project-context.js';
import {
  generateBatchProjectDocs,
  generateDocsQualityReport,
  type BatchProjectDocsResult,
} from '../panoramic/batch-project-docs.js';
import { resolveReverseSpecModel, getCanonicalSonnetModelId } from '../core/model-selection.js';
import { detectAuth } from '../auth/auth-detector.js';
import { orchestrateDocsBundle } from '../panoramic/pipelines/docs-bundle-orchestrator.js';
import {
  generateDebtIntelligence,
  type DebtPipelineResult,
} from '../panoramic/pipelines/debt-intelligence-pipeline.js';
import type { SimpleLLMClient as DebtSimpleLLMClient } from '../debt-scanner/design-docs/llm-topic-inferrer.js';
import type { DocsBundleProfileSummary } from '../panoramic/models/docs-bundle-types.js';
import { BATCH_OUTPUT_SUBDIRS } from '../panoramic/output-filenames.js';
import { collectGenericLanguageCodeSkeletons } from './generic-language-skeleton-collector.js';
import { resolveSourceCommit } from '../panoramic/graph/source-commit.js';
import { buildKnowledgeGraph, writeKnowledgeGraph, normalizeGraphForWrite } from '../panoramic/graph/index.js';
import {
  buildUnifiedGraph,
  setCurrentUnifiedGraph,
  getCurrentUnifiedGraph,
} from '../knowledge-graph/index.js';
import { buildHtmlTemplate } from '../panoramic/exporters/html-template.js';
import { SpecStore } from '../spec-store/index.js';
import { createRequire } from 'node:module';
import type { BatchMode } from '../panoramic/qa/types.js';
import {
  upsertCompletedModule,
  recordFailedModule,
  isInManagedOutputDir,
} from './stages/checkpoint-state.js';
import {
  collectPythonCodeSkeletons,
  collectTsJsCodeSkeletons,
  buildDesignDocAbsPaths,
  discoverSourceLanguages,
} from './stages/source-discovery.js';
import {
  detectCrossLanguageRefs,
  generateCrossLanguageHint,
  selectPrimaryModuleGraph,
} from './stages/graph-assembly.js';
import { normalizeConcurrency } from './stages/generation-scheduling.js';
import { writeBatchReportingArtifacts } from './stages/artifact-reporting.js';

// ============================================================
// F220 五段拆分 — facade 导出契约（14 符号逐字保留，见 specs/220-*/refactor-plan.md §4）
// ============================================================
export {
  PY_SKELETON_IGNORE_DIRS,
  TSJS_SKELETON_IGNORE_DIRS,
  collectPythonCodeSkeletons,
  collectTsJsCodeSkeletons,
  buildDesignDocAbsPaths,
} from './stages/source-discovery.js';
export {
  mergeGraphsForTopologicalSort,
  detectCrossLanguageRefs,
  generateCrossLanguageHint,
  buildAstGraphOnly,
} from './stages/graph-assembly.js';
export type { GraphOnlyResult } from './stages/graph-assembly.js';
export { normalizeConcurrency } from './stages/generation-scheduling.js';

// 从 package.json 读取版本号（避免硬编码）
const _require = createRequire(import.meta.url);
const SPECTRA_VERSION: string = (_require('../../package.json') as { version: string }).version;

/**
 * Bug 142：单模块重试累计 input token 预算上限。
 * 超过该值时提前终止重试，避免相同 prompt 反复失败导致的 token 浪费。
 * 默认 40_000（p-queue 实测：单模块合理上限 ~10k，4× 仍属充足容忍）。
 * 可通过环境变量 SPECTRA_RETRY_TOKEN_BUDGET 覆盖。
 */
const RETRY_TOKEN_BUDGET = Number(process.env['SPECTRA_RETRY_TOKEN_BUDGET'] ?? 40_000);

/**
 * Bug 142：LLM 调用失败抛异常时（最常见失败模式），无法从 result.costMetadata 取到实际 token，
 * 此时按估算值累积。基于 bench.ts 实测：单次失败的 input prompt 约 15k tokens。
 * 这是关键修复点：若仅在成功路径累积 token，最常见的"LLM 调用本身失败"场景下
 * cumulativeInputTokens 永远是 0，预算检查彻底失效。
 */
const ESTIMATED_FAILED_CALL_INPUT = 15_000;

// ============================================================
// 类型定义
// ============================================================

export interface BatchOptions {
  /** 即使 spec 已存在也重新生成（--full 的等义别名，FR-003） */
  force?: boolean;
  /** 仅重生成受影响的 spec */
  incremental?: boolean;
  /** 显式全量重生成（regen 轴逃生口，绕过增量 cache + checkpoint，FR-003） */
  full?: boolean;
  /** 输出目录（默认 'specs'，相对路径基于 projectRoot） */
  outputDir?: string;
  /** 进度回调 */
  onProgress?: (completed: number, total: number) => void;
  /** 每个模块的 LLM 最大重试次数（默认 3） */
  maxRetries?: number;
  /**
   * 并发处理的模块数上限（默认 3，顺序处理请传 1）。
   *
   * Feature 146：默认值从 1 提升到 3。理由：Sonnet 单次调用 15-30s，
   * concurrency=3 时吞吐量显著提升且 429 风险可控（Anthropic RPM ~50-60）。
   *
   * 双层重试语义（FR-016）：
   * - SDK 层：maxRetries=2（含退避），处理单次请求级 429/529
   * - 应用层：maxRetries=3（模块级），处理更高层次的模块失败
   * - 理论最差情况：每模块 3×3=9 次 HTTP 请求（9N 放大）
   * - concurrency 作为速率总闸，限制总体并发流量
   *
   * 边界规范化（FR-002，在 runBatch 内执行）：
   * - <=0 → 静默修正为 1 并输出 warn
   * - 非整数 → Math.floor 向下取整
   *
   * 优先级链（CLI 层和 runBatch 层共同保证）：
   * CLI flag --concurrency=N > spec-driver.config.yaml batch.concurrency > 默认值 3
   */
  concurrency?: number;
  /** 检查点文件路径 */
  checkpointPath?: string;
  /** 模块分组选项 */
  grouping?: GroupingOptions;
  /** 语言过滤（如 ['typescript', 'python']），仅处理指定语言的模块 */
  languages?: string[];
  /** 进度报告输出模式（默认根据 process.stdout.isTTY 自动检测） */
  progressMode?: ProgressMode;
  /** 启用 Markdown 文档 + OpenAPI/AsyncAPI 规范提取（--include-docs），默认 false — Feature 107 */
  includeDocs?: boolean;
  /** 启用图像/图表 Vision 提取（--include-images），默认 false — Feature 107 */
  includeImages?: boolean;
  /** Feature 127：仅预估模式，跳过所有 LLM 调用，产出 dry-run 报告 */
  dryRun?: boolean;
  /** Feature 127：预算上限（input+output tokens 总数），超出触发 gate */
  budget?: number;
  /** Feature 127：超预算时的非交互策略（CI 场景） */
  onOverBudget?: BudgetPolicy;
  /** Feature 130：是否生成 technical-debt.md（默认 true） */
  enableDebtIntelligence?: boolean;
  /** Feature 130：debt-intelligence 的 LLM 客户端注入（未注入则降级为 no-llm-client） */
  debtLlmClient?: DebtSimpleLLMClient;
  /** F5：批处理运行模式（full | reading | code-only，默认 full） */
  mode?: BatchMode;
  /**
   * 是否在知识图谱写盘后生成 graph.html 可视化文件。
   *
   * **Feature 140 FR-011 行为变更**：默认从 `false` 改为 `true`，graph.html 始终生成
   * （之前需要 `--html` flag opt-in；现在 batch 末尾无条件生成）。
   * 调用方仍可显式传 `generateHtml: false` 跳过（如 CI 资源紧张场景）。
   * 极小图（节点数 < 3）会在生成的 HTML 中注入说明 banner（T19）。
   */
  generateHtml?: boolean;
  /**
   * Feature 133 P1-1（adversarial-review post-fix）：是否启用 hyperedge LLM 提取
   * 默认 false，需要显式 opt-in（CLI `--hyperedges` 或 env `SPECTRA_HYPEREDGES_ENABLED=true`）。
   * 同样要求 mode === 'full' 且未触发 budget gate skip-enrichment 降级。
   */
  hyperedgesEnabled?: boolean;
  /**
   * Feature 135 Bug 1：是否显式启用 ADR pipeline。
   * v4.0.1 临时禁用（默认 false），evidence-binding 重构完成后（v4.1）恢复默认。
   * 需用 CLI `--enable-adr` 显式开启。
   */
  enableAdr?: boolean;
}

export interface BatchResult {
  totalModules: number;
  successful: string[];
  failed: FailedModule[];
  skipped: string[];
  degraded: string[];
  duration: number;
  indexGenerated: boolean;
  summaryLogPath: string;
  /** 检测到的语言列表 */
  detectedLanguages?: string[];
  /** 语言统计信息 */
  languageStats?: Map<string, LanguageFileStat>;
  /** 044 输出的文档图谱调试文件 */
  docGraphPath?: string;
  /** 046 输出的覆盖率审计 Markdown */
  coverageReportPath?: string;
  /** 049 输出的差量分析 Markdown */
  deltaReportPath?: string;
  /**
   * F175：本轮增量决策的 DeltaReport 对象（增量路径生成；全量/兼容路径为 undefined）。
   * 供调用方与 E2E 断言 mode / directChanges / propagatedChanges / regenerateTargets / fallbackReason。
   */
  deltaReport?: DeltaReport;
  /** 053 输出的项目级文档 Markdown 列表 */
  projectDocs?: string[];
  /** 055 输出的 bundle manifest 路径 */
  docsBundleManifestPath?: string;
  /** 055 输出的 profile 摘要 */
  docsBundleProfiles?: DocsBundleProfileSummary[];
  /** 127 输出的 LLM 成本汇总 */
  costSummary?: CostSummary;
  /** 127 dry-run 模式输出的预估报告路径 */
  dryRunReportPath?: string;
  /** 127 预算决策结果（超预算场景） */
  budgetDecision?: {
    policy: BudgetPolicy;
    message: string;
    interactive: boolean;
    /** Codex review 修复：每轮 gate 的审计记录 */
    attempts?: BudgetGateAttempt[];
    /** 是否采纳了 skip-enrichment 降级 */
    skipEnrichmentApplied?: boolean;
    /** 是否采纳了 cheaper-model 降级 */
    cheaperModelApplied?: boolean;
  };
  /** 130 debt-intelligence pipeline 结果 */
  debt?: DebtPipelineResult;
  /** F5 Story 3：生成的 graph.html 路径（--html flag 触发时写入） */
  graphHtmlPath?: string;
}

const logger = createLogger('batch-orchestrator');

// ============================================================
// 核心 API
// ============================================================

/**
 * 按模块级拓扑顺序编排全项目 Spec 生成
 *
 * @param projectRoot - 项目根目录
 * @param options - 批量选项
 * @returns 批量结果
 */
export async function runBatch(
  projectRoot: string,
  options: BatchOptions = {},
): Promise<BatchResult> {
  // F5：mode 校验，无效值在启动阶段立即报错
  const validModes: BatchMode[] = ['full', 'reading', 'code-only'];
  if (options.mode !== undefined && !validModes.includes(options.mode)) {
    throw new Error(
      `无效的 mode 值: "${options.mode}"。有效值：full | reading | code-only`,
    );
  }

  const effectiveMode: BatchMode = options.mode ?? 'full';

  // F5：FR-006 — 日志输出当前 mode
  logger.info(`[info] batch mode: ${effectiveMode}`);

  const {
    maxRetries = 3,
    outputDir = 'specs',
  } = options;

  // F175 FR-002：唯一默认值来源——对直接调用方兜底解析 RegenPlan（CLI/MCP 已在各自入口解析后传入有效值）。
  // 删除原 `incremental = false` 硬编码，默认增量（regenPlan.incremental）由 resolveRegenPlan 决定（FR-001）。
  const regenPlan: RegenPlan = resolveRegenPlan({
    incremental: options.incremental,
    full: options.full,
    force: options.force,
  });

  const startTime = Date.now();
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedOutputDir = path.isAbsolute(outputDir)
    ? outputDir
    : path.join(resolvedRoot, outputDir);
  const checkpointPath = options.checkpointPath
    ? (path.isAbsolute(options.checkpointPath)
      ? options.checkpointPath
      : path.join(resolvedRoot, options.checkpointPath))
    : path.join(resolvedOutputDir, path.basename(DEFAULT_CHECKPOINT_PATH));

  const toProjectPath = (absPath: string): string => {
    const rel = path.relative(resolvedRoot, absPath);
    return rel.startsWith('..') ? absPath : rel;
  };

  // 步骤 1 / 1.5：源发现与语言分组（F220 B6 seam → stage ① source-discovery）
  const {
    scanResult,
    languageStats,
    languageGroups: languageGroupsList,
    processedLanguages,
    isMultiLang,
    isSingleNonTsJs,
  } = discoverSourceLanguages(resolvedRoot, options.languages);

  // 步骤 1.6 / 1.7：语言组合选择主依赖图（F220 B5 seam → stage ② graph-assembly）
  const mergedGraph = await selectPrimaryModuleGraph({
    languageGroups: languageGroupsList,
    resolvedRoot,
    isMultiLang,
    isSingleNonTsJs,
  });

  // 步骤 2：文件→模块聚合 + 模块级拓扑排序
  const groupingOptions: GroupingOptions = {
    ...options.grouping,
    languageAware: isMultiLang,
    classifyDirectories: options.grouping?.classifyDirectories ?? true, // 默认启用目录语义分类（排除 examples/vendor/dist 等）
    projectRoot: resolvedRoot,
  };
  const groupResult = groupFilesToModules(mergedGraph, groupingOptions);
  const processingOrder = groupResult.moduleOrder;
  const moduleGroups = new Map(groupResult.groups.map((g) => [g.name, g]));
  const rootModuleName = options.grouping?.rootModuleName ?? 'root';
  const existingStoredSpecs = scanStoredModuleSpecs(resolvedOutputDir, resolvedRoot);
  // Feature 182：以 cache key 入索引（languageSplit 组带 `::language` 后缀），与 processOneModule
  // 的 moduleCacheKey 口径对齐；旧 spec 无 sourceTargetKey 时回落纯路径 sourceTarget。
  const storedSpecByTarget = new Map(
    existingStoredSpecs.map((spec) => [spec.sourceTargetKey ?? spec.sourceTarget, spec]),
  );

  // F175：全量逃生口（--full / --force 合并为 regenPlan.full）打可观测日志，
  // 替代原 fallbackReason='force-enabled' 内部信号（W-1 取舍）。
  if (regenPlan.full) {
    logger.info(`[regen] full regeneration (source=${regenPlan.source})`);
  }

  // F175：仅增量路径（regenPlan.incremental）调用 DeltaRegenerator；full 路径直接走全量。
  let deltaReport: DeltaReport | undefined;
  if (regenPlan.incremental) {
    const deltaRegenerator = new DeltaRegenerator();
    deltaReport = await deltaRegenerator.plan({
      projectRoot: resolvedRoot,
      dependencyGraph: mergedGraph,
      moduleGroups: groupResult.groups,
      storedSpecs: existingStoredSpecs,
      // Bug 142：传入 effectiveMode 启用 mode-aware cache，
      // 旧 spec（无 generatedByMode）或 mode 不匹配时强制 cache miss。
      effectiveMode,
    });
  }

  const regenerateTargets = new Set(deltaReport?.regenerateTargets ?? []);
  // EC-001 force/full 优先：regenPlan.full 直接全量；增量路径 deltaReport.mode==='full'
  //（首次运行 / 无历史 spec / mode 切换）退化全量仍走 forceFullRegeneration。
  // Feature 182：改为 let——full-resume 时序修复需在 checkpoint 加载后回写（见下方 isResume 块）。
  let forceFullRegeneration = regenPlan.full || (regenPlan.incremental && deltaReport?.mode === 'full');
  let shouldUseIncrementalPlan = regenPlan.incremental && deltaReport?.mode === 'incremental';

  console.log(`发现 ${mergedGraph.modules.length} 个文件，聚合为 ${processingOrder.length} 个模块`);
  if (isMultiLang) {
    console.log(`检测到 ${processedLanguages.length} 种语言: ${processedLanguages.join(', ')}`);
  }

  // Feature 127：dry-run 模式 — AST + 模块聚合已完成，直接产出预估报告后返回
  if (options.dryRun) {
    const estimates: ModuleEstimate[] = [];
    for (const moduleName of processingOrder) {
      const group = moduleGroups.get(moduleName);
      if (!group) continue;
      estimates.push(estimateModuleCost(moduleName, group.files, resolvedRoot));
    }
    const report = buildDryRunReport(estimates);
    fs.mkdirSync(path.join(resolvedOutputDir, BATCH_OUTPUT_SUBDIRS.META), { recursive: true });
    const dryRunPath = path.join(
      resolvedOutputDir,
      BATCH_OUTPUT_SUBDIRS.META,
      'dry-run-estimate.md',
    );
    fs.writeFileSync(dryRunPath, renderDryRunReport(report), 'utf-8');
    console.log(`[dry-run] 预估报告: ${toProjectPath(dryRunPath)}`);
    console.log(
      `[dry-run] 预估总 tokens: ${(report.totalEstimatedInput + report.totalEstimatedOutput).toLocaleString()} ` +
        `(input ${report.totalEstimatedInput.toLocaleString()} + output ${report.totalEstimatedOutput.toLocaleString()})`,
    );
    return {
      totalModules: processingOrder.length,
      successful: [],
      failed: [],
      skipped: processingOrder.slice(),
      degraded: [],
      duration: Date.now() - startTime,
      indexGenerated: false,
      summaryLogPath: '',
      detectedLanguages: isMultiLang ? processedLanguages : undefined,
      languageStats,
      dryRunReportPath: toProjectPath(dryRunPath),
    };
  }

  // Feature 127：预算守护 gate — AST + 模块聚合完成后预估，超预算时驱动 gate 循环
  // Codex review 修复（Finding 1）：降级 policy 后必须 re-estimate 并进入二次 gate，
  // 否则 cheaper-model / skip-enrichment 形同虚设；最多循环一轮后强制 cancel。
  let budgetDecisionResult:
    | {
        policy: BudgetPolicy;
        message: string;
        interactive: boolean;
        attempts?: BudgetGateAttempt[];
        skipEnrichmentApplied?: boolean;
        cheaperModelApplied?: boolean;
      }
    | undefined;
  let budgetSkipEnrichmentAll = false;
  let budgetCheaperModelAll = false;
  if (typeof options.budget === 'number' && options.budget > 0) {
    const estimates: ModuleEstimate[] = [];
    for (const moduleName of processingOrder) {
      const group = moduleGroups.get(moduleName);
      if (!group) continue;
      estimates.push(estimateModuleCost(moduleName, group.files, resolvedRoot));
    }
    const baseTotal = estimates.reduce(
      (s, e) => s + e.estimatedInput + e.estimatedOutput,
      0,
    );
    const gateResult = await runBudgetGate({
      baseEstimate: baseTotal,
      budget: options.budget,
      preset: options.onOverBudget,
      isTTY: !!process.stdout.isTTY,
    });
    budgetSkipEnrichmentAll = gateResult.skipEnrichmentApplied;
    budgetCheaperModelAll = gateResult.cheaperModelApplied;
    for (const a of gateResult.attempts) {
      console.log(`[budget] ${a.message}`);
    }
    // final message 取最后一条 attempt
    const last = gateResult.attempts[gateResult.attempts.length - 1]!;
    budgetDecisionResult = {
      policy: gateResult.finalPolicy,
      message: last.message,
      interactive: false,
      attempts: gateResult.attempts,
      skipEnrichmentApplied: gateResult.skipEnrichmentApplied,
      cheaperModelApplied: gateResult.cheaperModelApplied,
    };
    if (gateResult.finalPolicy === 'cancel') {
      // 取消：不调用任何 LLM，立即返回
      return {
        totalModules: processingOrder.length,
        successful: [],
        failed: [],
        skipped: processingOrder.slice(),
        degraded: [],
        duration: Date.now() - startTime,
        indexGenerated: false,
        summaryLogPath: '',
        detectedLanguages: isMultiLang ? processedLanguages : undefined,
        languageStats,
        budgetDecision: budgetDecisionResult,
      };
    }
    // continue 分支：budgetSkipEnrichmentAll / budgetCheaperModelAll 用于下方 genOptions 注入
  }

  // 步骤 3：检查是否存在检查点
  let state: BatchState | null = loadCheckpoint(checkpointPath);

  // F175 FR-016/EC-007：full/force 启动时丢弃已加载的 checkpoint completed + failed state，
  // 防止残留 checkpoint 命中导致全量语义被绕过（必须在 completedPaths 构建前清空——
  // 加载时即清，而非在 processOneModule 内"忽略"，避免中途崩溃 resume 复用脏 set）。
  // W-1：必须同时清空 failedModules——否则 full 后 summary（:1749 起用 checkedState.failedModules）
  // 仍混入上一轮的旧失败详情，与"full 是干净全量"语义矛盾。
  if (
    state &&
    regenPlan.full &&
    (state.completedModules.length > 0 || state.failedModules.length > 0)
  ) {
    logger.info(
      `[regen] full regeneration 丢弃残留 checkpoint state（completed ${state.completedModules.length} / failed ${state.failedModules.length} 模块）`,
    );
    state = { ...state, completedModules: [], failedModules: [] };
    saveCheckpoint(state, checkpointPath);
  }

  const isResume = state !== null;

  if (!state) {
    state = {
      batchId: `batch-${Date.now()}`,
      projectRoot: resolvedRoot,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      totalModules: processingOrder.length,
      processingOrder,
      completedModules: [],
      failedModules: [],
      forceRegenerate: regenPlan.full,
      // 多语言扩展字段
      languageGroups: isMultiLang
        ? Object.fromEntries(languageGroupsList.map((g) => [g.adapterId, g.files]))
        : undefined,
      filterLanguages: options.languages,
    };
  }

  if (isResume) {
    console.log(`恢复断点: 已完成 ${state.completedModules.length}/${state.totalModules} 模块`);
    // Feature 182 修复面 5：恢复中断的 --full run 意图。
    // 背景：首轮 --full 把 forceRegenerate=true 落盘到 checkpoint（:660），但 runtime 仅用本轮
    // regenPlan 重算的 forceFullRegeneration——裸增量 resume 时为 false，剩余模块静默降级为增量，
    // 产出半新半旧混合产物。此处从 checkpoint 恢复 full 意图，剩余模块继续全量。
    // 时序安全：两变量消费点全在 processOneModule 内（在此回写之后才被调用）。
    // 注意：full-resume 不清空 completed（:636 清空条件用 regenPlan.full 而非本变量），正是 resume 语义。
    if (state.forceRegenerate && !forceFullRegeneration) {
      forceFullRegeneration = true;
      shouldUseIncrementalPlan = false;
      logger.info('[resume] 检测到中断的 full run，剩余模块继续全量');
    }
  }

  // 步骤 4：按模块级拓扑顺序处理
  // Feature 146 FR-010/FR-011：通过 getActiveCount getter 注入 limit.activeCount，
  // 使 TTY 进度条可展示「进行中」三维状态，而无需修改 ProgressReporter 接口。
  // 这里使用闭包延迟读取：reporter 在 limit 之前创建，runtime 调用时 limit 已就位。
  let limitRef: ReturnType<typeof pLimit> | undefined;
  const reporter = createReporter(
    processingOrder.length,
    options.progressMode,
    { getActiveCount: () => limitRef?.activeCount ?? 0 },
  );
  const successful: string[] = [];
  const failed: FailedModule[] = [];
  const skipped: string[] = [];
  const degraded: string[] = [];
  const collectedModuleSpecs: ModuleSpec[] = [];
  // Feature 127：累积每模块成本，用于 batch 汇总 + 质量报告
  const costRecords: ModuleCostRecord[] = [];

  // 预计算跨语言提示文本（多语言项目）
  const crossLangHint = isMultiLang
    ? generateCrossLanguageHint(processedLanguages)
    : '';

  const completedPaths = new Set(state.completedModules.map((m) => m.path));
  // Feature 146 — concurrency 读取与规范化（FR-002、FR-003）
  // 默认值 3：Sonnet 调用 15-30s，concurrency=3 显著提升吞吐量且 429 风险可控。
  // 优先级链：调用方（CLI）已合并 CLI flag > config，传入 options.concurrency；
  // 此处仅做最后一道防线的规范化（防御非法传入），具体规则见 normalizeConcurrency 注释。
  const concurrency = normalizeConcurrency(
    options.concurrency ?? 3,
    (msg) => logger.warn(msg),
  );
  const modulesDir = path.join(resolvedOutputDir, BATCH_OUTPUT_SUBDIRS.MODULES);

  // BUG-A 预计算：统计每个 dirPath 下有多少个单文件模块，冲突路径才使用文件路径
  const dirPathGroupCount = new Map<string, number>();
  for (const group of groupResult.groups) {
    if (group.files.length === 1) {
      dirPathGroupCount.set(group.dirPath, (dirPathGroupCount.get(group.dirPath) ?? 0) + 1);
    }
  }
  const conflictingDirPaths = new Set(
    [...dirPathGroupCount.entries()]
      .filter(([, count]) => count > 1)
      .map(([dirPath]) => dirPath),
  );

  // state 在此处保证非 null（第 341 行的 if 分支已确保初始化）
  const checkedState = state!;

  // H3 修复：通过集中模型配置解析 Sonnet 模型 ID，避免硬编码版本字符串。
  // Fix 134：直接从 LOGICAL_*_MODEL_MAP 取 'sonnet'，不走 yaml fallback
  // 链——之前用 `agentId: 'specify-sonnet'` 在 yaml agents 不存在时回落到
  // preset，当用户配置 quality-first 时 sonnetModelId 实际是 opus，破坏了
  // 小模块/budget 降级/reading 模式 强制 sonnet 的设计意图（graphify E2E 暴露）。
  // 按当前认证 runtime 决定 sonnet ID（claude → claude-sonnet-4-6；codex → gpt-5.4），
  // 与 callLLM 内 detectAuth 的运行时保持一致；探测失败时默认 claude。
  const detectedRuntime = (() => {
    try {
      const auth = detectAuth();
      return auth.preferred?.provider === 'codex' ? 'codex' : 'claude';
    } catch {
      return 'claude';
    }
  })();
  const sonnetModelId = getCanonicalSonnetModelId(detectedRuntime);

  /** 单个模块的处理逻辑（提取为函数以支持并行调度） */
  async function processOneModule(moduleName: string): Promise<void> {
    const group = moduleGroups.get(moduleName);
    if (!group) return;

    const isRoot = moduleName === rootModuleName || moduleName.startsWith(`${rootModuleName}--`);
    const specPath = path.join(modulesDir, `${moduleName}.spec.md`);
    // FR-019：target 口径与 DeltaRegenerator 共用 resolveSourceTarget（文件级降级分支一致），
    // 否则 --incremental 的 regenerateTargets 查询和 storedSpecByTarget 查询全部错位。
    // T020：target 计算前移到 checkpoint 判定之前，供增量 resume 失效判定使用。
    const moduleSourceTarget = resolveSourceTarget(group, conflictingDirPaths, isRoot);
    // Feature 182：cache key（languageSplit 组带 `::language` 后缀），用于 regenerateTargets /
    // storedSpecByTarget / existingVersion 查询，消除同目录多语言组键碰撞；targetPath 与
    // frontmatter 继续用纯路径 moduleSourceTarget（statSync 路径 + panoramic 匹配口径不变）。
    const moduleCacheKey = buildSpecCacheKey(moduleSourceTarget, group);

    // F175 FR-016：checkpoint 判定。full 路径已在加载时清空 completedPaths（必为干净）；
    // 增量 resume 下若 checkpoint 命中但本轮 delta 要求重生成该 target，则失效重跑。
    // C-3：root 模块的 regenerateTargets 是文件级（DeltaRegenerator 对 root 按每个文件
    // 产出 snapshot），但 moduleSourceTarget（root 时为 group.dirPath）不在文件级集合里，
    // 用 dirPath 查永远 miss → mustRegen=false → root 文件变更时 checkpoint 命中被错误跳过。
    // 故 root 模块改判 group.files 中任一文件 target 是否命中 regenerateTargets。
    if (completedPaths.has(moduleName)) {
      const mustRegen =
        shouldUseIncrementalPlan &&
        (isRoot
          ? group.files.some((filePath) =>
              regenerateTargets.has(normalizeProjectPath(filePath)),
            )
          : regenerateTargets.has(moduleCacheKey));
      if (!mustRegen) return;
    }

    const rootTargetsToGenerate = isRoot
      ? group.files
        .map((filePath) => normalizeProjectPath(filePath))
        .filter((sourceTarget) => {
          if (forceFullRegeneration) return true;
          if (shouldUseIncrementalPlan) return regenerateTargets.has(sourceTarget);
          const storedSpec = storedSpecByTarget.get(sourceTarget);
          return !storedSpec || !fs.existsSync(path.join(resolvedRoot, storedSpec.outputPath));
        })
      : [];

    if (isRoot) {
      if (rootTargetsToGenerate.length === 0) {
        skipped.push(moduleName);
        reporter.complete(moduleName, 'skipped');
        return;
      }
    } else {
      const shouldGenerate = forceFullRegeneration
        || (shouldUseIncrementalPlan
          ? regenerateTargets.has(moduleCacheKey)
          : !fs.existsSync(specPath));
      if (!shouldGenerate) {
        skipped.push(moduleName);
        reporter.complete(moduleName, 'skipped');
        return;
      }
    }

    reporter.start(moduleName);

    let retryCount = 0;
    let moduleSuccess = false;

    // Bug 142：单模块累计 input token 跟踪。
    // 在「成功路径 + 失败路径」两侧都必须累积，否则最常见的 LLM 调用失败场景下，
    // cumulativeInputTokens 永远为 0，预算检查彻底失效（参见 ESTIMATED_FAILED_CALL_INPUT 注释）。
    let cumulativeInputTokens = 0;
    let moduleTokenBudgetExceeded = false;

    // 各阶段耗时（毫秒）— 用于模块完成后打印可观测性摘要行
    const stageDurations: Partial<Record<string, number>> = {};
    const moduleStartTime = Date.now();

    while (retryCount < maxRetries && !moduleSuccess) {
      try {
        // 小模块优化：文件数 ≤ 2 且总行数 < 200 时降级为 Sonnet + 跳过 enrichment
        const totalLoc = group.files.reduce((sum, f) => {
          try { return sum + fs.readFileSync(path.join(resolvedRoot, f), 'utf-8').split('\n').length; } catch { return sum; }
        }, 0);
        const isSmallModule = group.files.length <= 2 && totalLoc < 200;

        // Feature 127：预算降级策略（Codex review 修复）：
        // 降级在 gate 循环中就已采纳，此处只读取 budgetSkipEnrichmentAll /
        // budgetCheaperModelAll 注入到每个模块的 genOptions，确保所有模块一致降级。
        const genOptions: GenerateSpecOptions = {
          outputDir: modulesDir,
          projectRoot: resolvedRoot,
          deep: true,
          // Feature 133 P0-2：reading/code-only 模式都跳过 enrichment（SC-001 < 120s
          // 目标）；同时尊重 small-module 优化和 budget gate 降级——任一为真都跳过
          skipEnrichment: isSmallModule || budgetSkipEnrichmentAll || effectiveMode !== 'full',
          // Fix 134 P0-3：reading/code-only 模式同样强制 sonnet override，
          // 与默认 model 解耦（即使用户配置 quality-first/opus，reading 仍走
          // sonnet，确保 SC-001 < 120s 始终满足）；提取为 decideModelOverride 便于单测
          modelOverride: decideModelOverride({
            isSmallModule,
            budgetCheaperModelAll,
            effectiveMode,
            sonnetModelId,
          }),
          // Bug 142：将 batch effectiveMode 写入 spec frontmatter 的 generatedByMode 字段，
          // 供下次 batch 运行的 mode-aware cache 判定使用。
          generatedByMode: effectiveMode,
          onStageProgress: (progress) => {
            reporter.stage(moduleName, progress);
            if (progress.duration !== undefined) {
              if (progress.stage === 'llm') {
                // 首次 llm 完成记为 LLM#1，后续不覆盖（enrich 已独立为 'enrich' stage）
                if (!('llm' in stageDurations)) {
                  stageDurations['llm'] = progress.duration;
                }
              } else {
                stageDurations[progress.stage] = progress.duration;
              }
            }
            if (progress.stage === 'context' && progress.duration !== undefined) {
              const currentCompleted = checkedState.completedModules.length + failed.length + skipped.length;
              options.onProgress?.(currentCompleted + 0.5, processingOrder.length);
            }
          },
        };

        if (isRoot) {
          const generatedRootSpecs: string[] = [];
          // Feature 222：root 模块由多个文件各自生成一份 spec，任一文件降级即整模块记为
          // 降级——否则扁平项目（只有 root 组）即使全量 AST-only，degraded 仍为空，
          // 降级占比提示与 --require-llm 的事后校验双双失效。
          let rootLlmDegraded = false;
          for (const file of group.files) {
            const sourceTarget = normalizeProjectPath(file);
            if (!rootTargetsToGenerate.includes(sourceTarget)) continue;
            const fullPath = path.join(resolvedRoot, file);
            const storedSpec = storedSpecByTarget.get(sourceTarget);
            // genOptions.skipEnrichment 已在 L648 处理 reading/code-only 模式分派
            const result = await generateSpec(fullPath, {
              ...genOptions,
              existingVersion: storedSpec?.version,
            });
            // Bug 142：root 分支也必须累积 token——否则 root 模块的 budget 永远是 0，
            // short-circuit 在 root 路径无效（前次实施漏掉这里导致 review 发现 CRITICAL）。
            if (result.costMetadata?.tokenUsage.input) {
              cumulativeInputTokens += result.costMetadata.tokenUsage.input;
            }
            if (result.llmDegraded) {
              rootLlmDegraded = true;
            }
            collectedModuleSpecs.push(result.moduleSpec);
            generatedRootSpecs.push(toProjectPath(path.resolve(result.specPath)));
            // Feature 127：root 子模块也采集成本（mock 未返回时跳过）
            if (result.costMetadata) {
              let fileLoc = 0;
              try {
                fileLoc = fs.readFileSync(fullPath, 'utf-8').split('\n').length;
              } catch { /* ignore */ }
              costRecords.push({
                moduleName: `${moduleName}/${path.basename(file)}`,
                loc: fileLoc,
                cost: result.costMetadata,
              });
            }
          }

          if (generatedRootSpecs.length === 0) {
            skipped.push(moduleName);
            reporter.complete(moduleName, 'skipped');
            moduleSuccess = true;
            continue;
          }

          if (rootLlmDegraded) {
            degraded.push(moduleName);
            reporter.complete(moduleName, 'degraded');
          } else {
            successful.push(moduleName);
            reporter.complete(moduleName, 'success');
          }
          // Feature 182：replace 语义（失效重跑时去重 + completed/failed 互斥）
          upsertCompletedModule(checkedState, {
            path: moduleName,
            specPath: generatedRootSpecs[0]!,
            completedAt: new Date().toISOString(),
          });
        } else {
          // BUG-A / H4 修复：targetPath 直接由 moduleSourceTarget 推导（FR-019：resolveSourceTarget
          // 已处理"同一 dirPath 多单文件冲突走文件路径"的降级分支），与 sourceTarget 口径保持一致。
          const targetPath = path.join(resolvedRoot, moduleSourceTarget);
          // genOptions.skipEnrichment 已在 L648 处理 reading/code-only 模式分派
          const result = await generateSpec(targetPath, {
            ...genOptions,
            // Feature 182：注入 group.files（语言限定子集，绝对路径），使写侧只分析本语言文件，
            // 与读侧 group.files 文件集口径一致（消除混语言 hash 分叉 + 双倍分析）。
            files: group.files.map((f) => path.join(resolvedRoot, f)),
            existingVersion: storedSpecByTarget.get(moduleCacheKey)?.version,
            // Feature 182 修复 1：仅 languageSplit 组按 moduleName 显式命名输出文件，
            // 避免同目录多语言组(ts / py)都派生为同名 `<dir>.spec.md` 互相覆盖；
            // 非拆分组不传 → basename 派生，存量单语言仓库命名零变化。
            ...(group.languageSplit ? { outputFileName: `${moduleName}.spec.md` } : {}),
            // Feature 182 修复 2：languageSplit 组首写即落入 frontmatter.sourceTargetKey，
            // 消除「post-mutation 依赖 doc-graph re-render 落盘晚于 checkpoint save」崩溃窗口；
            // in-memory moduleSpec.frontmatter 由 generateFrontmatter 返回自然带上。
            sourceTargetKey: group.languageSplit ? moduleCacheKey : undefined,
          });
          // Bug 142：非 root 分支累积 input token，供 catch 块统一做预算检查。
          if (result.costMetadata?.tokenUsage.input) {
            cumulativeInputTokens += result.costMetadata.tokenUsage.input;
          }

          if (isMultiLang && group.language) {
            (result.moduleSpec.frontmatter as any).language = group.language;

            const crossRefs = detectCrossLanguageRefs(
              group.files,
              languageGroupsList,
              mergedGraph,
            );
            if (crossRefs.length > 0) {
              (result.moduleSpec.frontmatter as any).crossLanguageRefs = crossRefs;
            }

            if (crossLangHint) {
              result.moduleSpec.sections.constraints += crossLangHint;
            }
          }

          collectedModuleSpecs.push(result.moduleSpec);

          // Feature 222：改用 orchestrator 暴露的结构化 llmDegraded，与 root 分支同源，
          // 不再依赖匹配中文 warning 子串（文案微调即静默失效且无测试能捕获）。
          if (result.llmDegraded) {
            degraded.push(moduleName);
            reporter.complete(moduleName, 'degraded');
          } else {
            successful.push(moduleName);
            reporter.complete(moduleName, 'success');
          }

          // Feature 182：replace 语义（失效重跑时去重 + completed/failed 互斥）
          upsertCompletedModule(checkedState, {
            path: moduleName,
            specPath: toProjectPath(path.resolve(result.specPath)),
            completedAt: new Date().toISOString(),
            tokenUsage: result.tokenUsage,
            // Feature 127：结构化成本元数据（mock 未返回时省略）
            ...(result.costMetadata ? { costMetadata: result.costMetadata } : {}),
          });
          // Feature 127：采集用于 batch 汇总（基于 module group 行数）
          if (result.costMetadata) {
            costRecords.push({
              moduleName,
              loc: group.files.reduce((sum, f) => {
                try {
                  return sum + fs.readFileSync(path.join(resolvedRoot, f), 'utf-8').split('\n').length;
                } catch {
                  return sum;
                }
              }, 0),
              cost: result.costMetadata,
            });
          }
        }

        // 耗时可观测性：打印各阶段耗时摘要
        const fmt = (ms: number | undefined) => ms !== undefined ? `${(ms / 1000).toFixed(1)}s` : '-';
        const totalMs = Date.now() - moduleStartTime;
        process.stderr.write(
          `[${moduleName}] AST: ${fmt(stageDurations['ast'])} | context: ${fmt(stageDurations['context'])} | LLM#1: ${fmt(stageDurations['llm'])} | enrich: ${fmt(stageDurations['enrich'])} | render: ${fmt(stageDurations['render'])} | total: ${fmt(totalMs)}\n`,
        );

        moduleSuccess = true;
      } catch (error: any) {
        retryCount++;
        // Bug 142：LLM 调用本身抛异常时（最常见失败模式），无法从 result.costMetadata 取到 token，
        // 按估算值累积。这是关键修复点：仅靠成功路径累积无法覆盖此场景。
        cumulativeInputTokens += ESTIMATED_FAILED_CALL_INPUT;

        // Bug 142 hotfix（v4.0.2）：把 budget 检查从 retrospective 改为 forecast。
        // 旧逻辑 `cumulativeInputTokens > RETRY_TOKEN_BUDGET` 是事后判断：
        // default 配置下（maxRetries=3, ESTIMATED=15k, BUDGET=40k）3 次失败后 cumulative=45k
        // 才触发 break，但此时 retryCount 已经达到 maxRetries 本来就会停，
        // budget 检查只是给最后一次失败贴个不同 label，实际省 0 个 token。
        // 新逻辑：再做一次重试是否会超预算？(forecast) 如果超 → 不再重试，标 reason 退出。
        // 按 default 配置：第 2 次失败 cumulative=30k → 30k+15k=45k > 40k → break，
        // 不进第 3 次，省 1 次 LLM 调用（~15k tokens）。
        if (cumulativeInputTokens + ESTIMATED_FAILED_CALL_INPUT > RETRY_TOKEN_BUDGET) {
          moduleTokenBudgetExceeded = true;
          const failedModule: FailedModule = {
            path: moduleName,
            error:
              `累计 input token ${cumulativeInputTokens} 已达预算上限 ${RETRY_TOKEN_BUDGET}，` +
              `下一次重试预计将超出预算，提前终止重试。原始错误：${error.message ?? String(error)}`,
            failedAt: new Date().toISOString(),
            retryCount,
            degradedToAstOnly: false,
            reason: 'retry-budget-exceeded',
          };
          failed.push(failedModule);
          // Feature 182：replace 语义（失效重跑时去重 + completed/failed 互斥）
          recordFailedModule(checkedState, failedModule);
          reporter.complete(moduleName, 'failed');
          break;
        }

        // Budget 与 maxRetries 互补：budget 控制 token 总量，maxRetries 控制失败次数。
        if (retryCount >= maxRetries) {
          const failedModule: FailedModule = {
            path: moduleName,
            error: error.message ?? String(error),
            failedAt: new Date().toISOString(),
            retryCount,
            degradedToAstOnly: false,
          };
          failed.push(failedModule);
          // Feature 182：replace 语义（失效重跑时去重 + completed/failed 互斥）
          recordFailedModule(checkedState, failedModule);
          reporter.complete(moduleName, 'failed');
        }
      }
    }

    // 安全保险：moduleTokenBudgetExceeded 在 catch 块已 break，
    // 此处仅用于消除"已声明未使用"的 TS 警告（保留变量便于未来观测性扩展）。
    void moduleTokenBudgetExceeded;

    checkedState.lastUpdatedAt = new Date().toISOString();
    saveCheckpoint(checkedState, checkpointPath);

    options.onProgress?.(
      checkedState.completedModules.length + failed.length + skipped.length,
      processingOrder.length,
    );
  }

  // 步骤 4：并发调度（Feature 146 — 使用 p-limit 替换手写信号量）
  // 历史背景：原手写信号量（pending 队列 + 活跃计数 + race 等待）出现过死锁 bug（H2 修复痕迹），
  // 且 concurrency<=1 与并发分支双路径增加维护成本。
  // clarify.md AU-005 决议：统一走 pLimit(concurrency) 路径，pLimit(1) 语义等同顺序执行（队列串行）。
  // FR-006/FR-007：limit 内部捕获异常 + Promise.allSettled 双重保护，确保单模块失败不阻塞其他模块。
  // FR-008（并发安全性）：JS 单线程事件循环保证：所有 successful.push / failed.push / costRecords.push /
  // cumulativeInputTokens += 等共享状态修改，均发生在 await 返回后的同步执行段，
  // 多个模块的修改语句不会在指令级交错（不存在原生意义的「数据竞态」）。
  // FR-009：BatchResult.duration 由 startTime/endTime 在 runBatch 入口/出口取一次 Date.now() 计算，
  // 反映墙钟耗时（并发下小于各模块耗时之和），无需额外修改。
  const limit = pLimit(concurrency);
  limitRef = limit; // 注入到 reporter 的 getActiveCount getter（FR-010）
  const tasks = processingOrder.map((moduleName) =>
    limit(async () => {
      try {
        await processOneModule(moduleName);
      } catch (err) {
        // 兜底：processOneModule 内部已捕获 LLM 重试失败并写入 failed[]，但
        // saveCheckpoint / onProgress / reporter.complete 等 try 之外的副作用调用
        // 仍可能抛出未预期错误（如 EACCES / 磁盘满）。Codex 对抗审查指出，仅
        // logger.warn 而不写 failed[] 会让这类模块从最终结果中静默消失，破坏
        // BatchResult 的 totalModules == successful + failed + skipped 不变量。
        // 此处补齐 failed[] + reporter.complete，保证「每个模块都有最终状态」。
        logger.warn(`模块 ${moduleName} 出现未捕获异常: ${String(err)}`);
        const failedModule: FailedModule = {
          path: moduleName,
          error: err instanceof Error ? err.message : String(err),
          failedAt: new Date().toISOString(),
          retryCount: 0,
          degradedToAstOnly: false,
          reason: 'unhandled-exception',
        };
        failed.push(failedModule);
        // Feature 182：replace 语义（失效重跑时去重 + completed/failed 互斥）
        recordFailedModule(checkedState, failedModule);
        try {
          reporter.complete(moduleName, 'failed');
        } catch {
          // reporter.complete 自身抛出（如 TTY 已关闭）不能再向外冒泡。
        }
      }
    }),
  );
  await Promise.allSettled(tasks);

  // 步骤 5：生成架构索引（使用收集的 ModuleSpec）
  let deltaReportPath: string | undefined;
  let docGraphPath: string | undefined;
  let coverageReportPath: string | undefined;
  let projectDocs: string[] | undefined;
  let graphHtmlPath: string | undefined;
  let projectDocsResult: BatchProjectDocsResult | undefined;
  let docsBundleManifestPath: string | undefined;
  let docsBundleProfiles: DocsBundleProfileSummary[] | undefined;
  // F175 FR-017/EC-008/EC-009：删除孤儿 spec（源文件已删除的 batch 产物），使增量产物文件集与全量一致。
  // 必须在构造 SpecStore 之前执行 + 从 storedSpecs 集合中剔除已删项（C-2）——否则后续
  // 所有聚合（index/graph/coverage/cross-ref）仍引用陈旧的已删 spec 视图，产生 stale 输出。
  // 仅在增量/全量路径执行；ownership 边界缺一不删：(1) generatedByMode 存在（batch 专属标记）+
  // (2) 位于受管 modules/ 输出目录内（path.relative 防目录穿越，禁字符串 startsWith）+
  // (3) sourceTarget 已无任何在库源文件（EC-008：删除模块最后一个源文件后，空目录仍 existsSync=true，
  //     故不能仅靠目录存在性判定——以当前扫描到的源文件集合为准）。
  let storedSpecsForStore = existingStoredSpecs;
  if (regenPlan.incremental || regenPlan.full) {
    // 当前扫描到的源文件（项目相对，正斜杠口径），用于判定 sourceTarget 是否仍有活跃源文件
    const liveSourceFiles = new Set(scanResult.files.map((f) => normalizeProjectPath(f)));
    const hasLiveSource = (sourceTarget: string): boolean => {
      const prefix = `${sourceTarget}/`;
      for (const f of liveSourceFiles) {
        if (f === sourceTarget || f.startsWith(prefix)) return true;
      }
      return false;
    };
    // 已确认删除的孤儿 outputPath 集合，用于从 storedSpecs 中剔除，使 SpecStore 不持有陈旧视图。
    const deletedOrphanPaths = new Set<string>();
    for (const orphan of existingStoredSpecs) {
      if (!isBatchGenerated(orphan)) continue; // 必要条件1：无 generatedByMode → 跳过（防误删手写 / 单文件 generate 产物）
      if (hasLiveSource(orphan.sourceTarget)) continue; // 必要条件3：仍有活跃源文件 → 非孤儿
      const absPath = path.isAbsolute(orphan.outputPath)
        ? orphan.outputPath
        : path.join(resolvedRoot, orphan.outputPath);
      if (!isInManagedOutputDir(absPath, modulesDir)) continue; // 必要条件2：受管 modules/ 目录外 → 跳过
      // 磁盘文件已被本轮其它逻辑清理：视为已删除，从内存视图剔除（保持内存与磁盘一致）。
      if (!fs.existsSync(absPath)) {
        deletedOrphanPaths.add(orphan.outputPath);
        continue;
      }
      // W-1（quality-review）：rmSync 是破坏性新操作，权限/OS 错误不应让整个 batch 崩溃。
      // 失败时 warn + 跳过，且【不】加入 deletedOrphanPaths——文件仍在磁盘，内存视图须保留它，
      // 避免"内存说已删、磁盘还在"的不一致。仅删除成功才剔除内存视图。
      try {
        logger.info(`[orphan-cleanup] 删除孤儿 spec: ${orphan.outputPath}`);
        fs.rmSync(absPath, { force: true });
        deletedOrphanPaths.add(orphan.outputPath);
      } catch (err) {
        logger.warn(
          `[orphan-cleanup] 删除孤儿 spec 失败，保守跳过: ${orphan.outputPath}（${(err as Error).message}）`,
        );
      }
    }
    if (deletedOrphanPaths.size > 0) {
      storedSpecsForStore = existingStoredSpecs.filter(
        (spec) => !deletedOrphanPaths.has(spec.outputPath),
      );
    }
  }

  // SpecStore 统一查询入口：所有消费方（README、graph、coverage、index、cross-ref）共享此源。
  // 使用已剔除孤儿的 storedSpecsForStore，确保后续聚合不引用已删 spec（C-2）。
  const specStore = new SpecStore({
    currentSpecs: collectedModuleSpecs,
    storedSpecs: storedSpecsForStore,
    projectRoot: resolvedRoot,
    toProjectPath,
  });

  const projectDir = path.join(resolvedOutputDir, BATCH_OUTPUT_SUBDIRS.PROJECT);
  const metaDir = path.join(resolvedOutputDir, BATCH_OUTPUT_SUBDIRS.META);
  try {
    // 通过 SpecStore.asDocGraphInput() 获取：已过滤 orphan/bundle_copy/derived
    const { moduleSpecs: docGraphModuleSpecs, existingSpecs: docGraphExistingSpecs } =
      specStore.asDocGraphInput();
    const docGraph = buildDocGraph({
      projectRoot: resolvedRoot,
      dependencyGraph: mergedGraph,
      moduleSpecs: docGraphModuleSpecs,
      existingSpecs: docGraphExistingSpecs,
    });

    for (const moduleSpec of collectedModuleSpecs) {
      moduleSpec.crossReferenceIndex = buildCrossReferenceIndex(moduleSpec, docGraph);
      const specOutputPath = path.isAbsolute(moduleSpec.outputPath)
        ? moduleSpec.outputPath
        : path.join(resolvedRoot, moduleSpec.outputPath);
      fs.mkdirSync(path.dirname(specOutputPath), { recursive: true });
      fs.writeFileSync(specOutputPath, renderSpec(moduleSpec), 'utf-8');
    }

    // 注意：不再生成 _doc-graph.json（Feature 098 — 结构化数据通过内存传递，减少输出冗余）

    if (deltaReport) {
      try {
        const deltaRegenerator = new DeltaRegenerator();
        const deltaMarkdown = deltaRegenerator.render(deltaReport);
        const deltaMarkdownPathAbs = path.join(metaDir, '_delta-report.md');
        fs.mkdirSync(metaDir, { recursive: true });
        fs.writeFileSync(deltaMarkdownPathAbs, deltaMarkdown, 'utf-8');
        deltaReportPath = toProjectPath(deltaMarkdownPathAbs);
      } catch (err) {
        logger.warn(`差量报告生成失败: ${String(err)}`);
      }
    }

    let projectContext = await buildProjectContext(resolvedRoot);

    // Feature 140 T22/T24 — 读取 README 全量内容，供 architecture-narrative 在
    // generateBatchProjectDocs 阶段使用（早于下方 multimodal extraction-pipeline）。
    // 仅 --include-docs=true 时读取；下方 extraction-pipeline 仍会返回相同 readmeContent
    // 供 hyperedge integration 使用，二者读取的是同一文件，无冲突。
    //
    // 共享 findReadmePath（来自 extraction-pipeline）确保大小写匹配候选列表口径一致
    // （修复 Codex review CRITICAL 2 — 之前的硬编码列表 ['README.md', 'readme.md', 'Readme.md']
    // 漏掉 README.MD / Readme.MD 等其他大小写组合）。
    let earlyReadmeContent: string | undefined;
    if (options.includeDocs) {
      try {
        const { findReadmePath } = await import('../extraction/index.js');
        const readmePath = findReadmePath(resolvedRoot);
        if (readmePath) {
          earlyReadmeContent = fs.readFileSync(readmePath, 'utf-8');
        }
      } catch (readmeErr) {
        logger.warn(`README 早期读取失败（不阻断 narrative 主流程）: ${String(readmeErr)}`);
      }
    }

    // Feature 151 Codex Final C-1 修订 — 在 generateBatchProjectDocs 之前构建 UnifiedGraph
    // 让 component-view-builder 能在生成时获取 graph（DI provider getCurrentUnifiedGraph）
    //
    // Feature 152 Codex final C-1 修复 — 同时合并 Python + TS/JS codeSkeletons，
    // 否则用户跑 spectra batch 后 TS 项目 graph.json 中没有 calls 边（US-001 失败）
    setCurrentUnifiedGraph(null);
    try {
      const pythonSkeletons = await collectPythonCodeSkeletons(resolvedRoot);
      const tsJsSkeletons = await collectTsJsCodeSkeletons(resolvedRoot, {
        extractCallSites: true,
      });
      // F217 决策 1：Java/Go 通用采集器接入（默认 adapters = [Java, Go]）
      const genericSkeletons = await collectGenericLanguageCodeSkeletons(resolvedRoot);
      // 合并三个 Map（projectRoot 都已 normalize 为绝对路径，key 形态一致）
      const earlyCodeSkeletons = new Map([...pythonSkeletons, ...tsJsSkeletons, ...genericSkeletons]);
      if (earlyCodeSkeletons.size > 0) {
        const earlyUg = buildUnifiedGraph({
          projectRoot: resolvedRoot,
          codeSkeletons: earlyCodeSkeletons,
        });
        setCurrentUnifiedGraph(earlyUg);
        const callEdges = earlyUg.edges.filter((e) => e.relation === 'calls').length;
        logger.info(
          `[Feature 151+152] 早期 UnifiedGraph 构建：${earlyUg.nodes.length} 节点 / ${callEdges} calls 边 ` +
          `(${pythonSkeletons.size} .py + ${tsJsSkeletons.size} .ts/.tsx/.js/.jsx + ${genericSkeletons.size} .java/.go 文件)`,
        );
      }
    } catch (ugErr) {
      setCurrentUnifiedGraph(null);
      logger.warn(`[Feature 151+152] 早期 UnifiedGraph 构建失败（不阻塞）: ${String(ugErr)}`);
    }

    try {
      projectDocsResult = await generateBatchProjectDocs({
        projectRoot: resolvedRoot,
        outputDir: projectDir,
        specsRootDir: resolvedOutputDir,
        mode: effectiveMode,
        enableAdr: options.enableAdr,
        // Feature 140 T22/T24：透传 readmeContent 给 architecture-narrative
        ...(earlyReadmeContent !== undefined ? { readmeContent: earlyReadmeContent } : {}),
      });
      projectContext = projectDocsResult.projectContext;
      projectDocs = projectDocsResult.generatedDocs
        .flatMap((doc) => doc.writtenFiles)
        .filter((filePath) => filePath.endsWith('.md'))
        .map(toProjectPath)
        .sort((a, b) => a.localeCompare(b));
    } catch (err) {
      logger.warn(`项目级 panoramic 文档生成失败: ${String(err)}`);
    }

    // Feature 101: 知识图谱持久化（graph-persistence）
    // 注入位置：generateBatchProjectDocs 之后，可获取 architectureIR
    try {
      const crossReferenceLinks = collectedModuleSpecs
        .flatMap((spec) =>
          spec.crossReferenceIndex
            ? [...spec.crossReferenceIndex.sameModule, ...spec.crossReferenceIndex.crossModule]
            : [],
        );

      // Feature 145 P0：Python 符号提取（不依赖 flag，始终执行）
      // 从所有 .py 文件提取函数/类符号节点，注入 buildKnowledgeGraph 第四路
      let pythonSymbolResults: import('../extraction/extraction-types.js').ExtractionResult[] = [];
      try {
        const { PythonLanguageAdapter } = await import('../adapters/python-adapter.js');
        const pythonAdapter = new PythonLanguageAdapter();
        pythonSymbolResults = await pythonAdapter.extractSymbolNodes(resolvedRoot);
        if (pythonSymbolResults.length > 0) {
          const symbolCount = pythonSymbolResults.reduce(
            (sum, r) => sum + r.nodes.filter(n => n.kind === 'component').length, 0,
          );
          // Codex 对抗审查 C001 修复：聚合 parseError 数，避免"全失败伪装成功"
          const filesFailed = pythonSymbolResults.reduce(
            (sum, r) => sum + r.nodes.filter(n => n.kind === 'module' && n.metadata?.['parseError'] === true).length, 0,
          );
          const totalFiles = pythonSymbolResults.length;
          if (filesFailed === totalFiles && totalFiles > 0) {
            // 所有 .py 文件都解析失败 — 强信号，必须 warn
            logger.warn(
              `Python 符号提取：${totalFiles} 个文件全部解析失败（可能是 tree-sitter Python WASM 加载或 grammar 问题）；` +
              `graph.json 仅含 module 节点，缺失全部函数/类 component 节点`,
            );
          } else if (filesFailed > 0) {
            logger.warn(
              `Python 符号提取部分失败：${filesFailed}/${totalFiles} 个文件解析失败，` +
              `成功提取 ${symbolCount} 个符号节点`,
            );
          } else {
            logger.info(
              `Python 符号提取完成：${totalFiles} 个文件，${symbolCount} 个符号节点`,
            );
          }
        }
      } catch (pyErr) {
        logger.warn(`Python 符号提取失败，跳过: ${String(pyErr)}`);
      }

      // Feature 107: 多模态提取管道（--include-docs / --include-images）
      // Feature 140 T21/T22：返回类型改为 { results, readmeContent? } 包装对象
      let extractionResults: import('../extraction/index.js').ExtractionResult[] | undefined;
      let extractedReadmeContent: string | undefined;
      if (options.includeDocs || options.includeImages) {
        try {
          const { runExtractionPipeline } = await import('../extraction/index.js');
          const extractionOutput = await runExtractionPipeline({
            projectRoot: resolvedRoot,
            outputDir: resolvedOutputDir,
            includeDocs: options.includeDocs ?? false,
            includeImages: options.includeImages ?? false,
          });
          extractionResults = extractionOutput.results;
          extractedReadmeContent = extractionOutput.readmeContent;
          // Feature 140 FR-010：用户开启 --include-docs 时，明确告知"已加入 N 份 .md 作为
          // 语义上下文"（替代 v4.0.x 时代误导性的"跳过 .md 文件（不支持）"）。
          // N = ExtractionResult 中 kind=document 的节点数 + (有 README 时 +1)。
          if (options.includeDocs) {
            const docNodeCount = (extractionResults ?? []).reduce(
              (sum, r) => sum + r.nodes.filter((n) => n.kind === 'document').length,
              0,
            );
            const totalDocs = docNodeCount + (extractedReadmeContent ? 1 : 0);
            logger.info(`include-docs: 已加入 ${totalDocs} 份 .md 作为语义上下文（含 README: ${extractedReadmeContent ? '是' : '否'}）`);
          }
        } catch (extractErr) {
          logger.warn(`多模态提取失败，跳过: ${String(extractErr)}`);
        }
      }

      // 合并 Python 符号提取结果和多模态提取结果（Feature 145 ADR-002）
      const mergedResults = [
        ...pythonSymbolResults,
        ...(extractionResults ?? []),
      ];

      // Feature 151 — UnifiedGraph 接入 graph-builder 第五路（早期已在 generateBatchProjectDocs 之前构建，此处复用 cache）
      // 复用早期构建结果（Codex Final C-1 修订）：cache 在 generateBatchProjectDocs 之前已 set
      const unifiedGraph = getCurrentUnifiedGraph();
      if (unifiedGraph) {
        const callEdgeCount = unifiedGraph.edges.filter(
          (e) => e.relation === 'calls',
        ).length;
        const dependEdgeCount = unifiedGraph.edges.filter(
          (e) => e.relation === 'depends-on',
        ).length;
        logger.info(
          `[Feature 151] graph-builder 注入 UnifiedGraph：${unifiedGraph.nodes.length} 节点，` +
          `${callEdgeCount} calls 边，${dependEdgeCount} depends-on 边`,
        );
      }

      const graphJson = buildKnowledgeGraph({
        architectureIR: projectDocsResult?.architectureIR,
        docGraph,
        crossReferenceLinks,
        extractionResults: mergedResults.length > 0 ? mergedResults : undefined,  // Feature 107 + 143 第四路数据源
        // Feature 151 T-012a：UnifiedGraph 第五路（calls + depends-on 边 + per-file callSitesCount metadata）
        ...(unifiedGraph ? { unifiedGraph } : {}),
      });

      // Feature 133 P1-1（adversarial-review post-fix）：anchor + hyperedge 集成
      // F4 提供了 runAnchorIntegration / runHyperedgeIntegration 集成函数，
      // 但 batch 编排器从未调用过它们，导致 graph.json 不含 references /
      // conceptually_related_to 边和 hyperedges。本块接通生产路径。
      //
      // Codex adversarial-review 收紧的守卫：
      // - 只在 mode === 'full' 时跑（reading/code-only 不应做 LLM-heavy 富化）
      // - 只在未触发 budget gate skip-enrichment 降级时跑（与模块 spec enrichment
      //   降级策略一致，避免成本超预算）
      // - hyperedge 集成默认 false，需要显式 opt-in（CLI `--hyperedges` 或 env
      //   `SPECTRA_HYPEREDGES_ENABLED=true`）；即使 mode/budget 允许，未 opt-in
      //   也只跑 anchor，不跑 hyperedge
      const semanticIntegrationAllowed =
        effectiveMode === 'full' && !budgetSkipEnrichmentAll;

      // Bug 2（Feature 135）：hyperedgesOptIn 需要在此提前解析，用于 WARNING 可观测性
      const hyperedgesOptInEarly = options.hyperedgesEnabled === true
        || process.env['SPECTRA_HYPEREDGES_ENABLED'] === 'true';

      if (!semanticIntegrationAllowed) {
        const reason = effectiveMode !== 'full'
          ? `mode=${effectiveMode}（非 full）`
          : 'budget gate 已触发 skip-enrichment 降级';
        // 升级为 warn 级别（Bug 2 T09），确保用户能感知到 hyperedges 被静默跳过
        logger.warn(
          `semantic-integration: 跳过 anchor + hyperedge 集成 — ${reason}（保持 graph.json 仅含静态边）`,
        );
        // 若用户显式请求了 --hyperedges 但条件不允许，向 stderr 打印可见 WARNING
        if (hyperedgesOptInEarly) {
          process.stderr.write(
            `[WARNING] --hyperedges 已启用但当前运行条件不满足（${reason}），hyperedge 集成已跳过。\n` +
            `          如需 hyperedge，请使用 --mode full 且未触发 budget gate skip-enrichment。\n`,
          );
        }
      } else {
        try {
          // Feature 140 T27 — 启用扩展来源（README + docs/ + module specs + project-context）
          // 让 hyperedge 在新项目首次 batch 也能产出非空 designDocAbsPaths（FR-007）。
          const designDocResult = buildDesignDocAbsPaths(
            projectDocs ?? [],
            resolvedRoot,
            resolvedOutputDir,
            {
              includeReadme: true,
              includeDocs: options.includeDocs ?? false,
              modulesDir,
              includeProjectContext: true,
            },
          );
          const { paths: designDocAbsPaths, fromDocsCount, fromDiskCount, nestedDirsDetected } = designDocResult;
          // FR-007：诊断日志，显示 designDocAbsPaths 来源与数量
          logger.info(
            `hyperedge: designDocAbsPaths.length=${designDocAbsPaths.length} ` +
            `(fromDocs=${fromDocsCount}, fromDisk=${fromDiskCount}, ` +
            `fromReadme=${designDocResult.fromReadmeCount}, ` +
            `fromDocsDir=${designDocResult.fromDocsDirCount}, ` +
            `fromModuleSpecs=${designDocResult.fromModuleSpecsCount}, ` +
            `fromProjectContext=${designDocResult.fromProjectContextCount})`,
          );
          // Codex 对抗审查 W002 修复：嵌套子目录的 .md 不参与 anchor/hyperedge 集成，向用户暴露
          if (nestedDirsDetected.length > 0) {
            logger.warn(
              `hyperedge: outputDir/project/ 下检测到 ${nestedDirsDetected.length} 个子目录` +
              `（${nestedDirsDetected.join(', ')}），其中嵌套的 .md 文件未被 anchor/hyperedge 集成扫描。` +
              `当前实现只支持扁平 project 目录；如需支持嵌套，请在 spec 中提交需求。`,
            );
          }

          const codeNodes: PanoramicGraphNode[] = graphJson.nodes.filter(
            (n) => !DOC_NODE_KINDS.has(n.kind),
          );

          // Bug 2（T11）：hyperedge 数量状态变量（用于 batch summary 末尾输出）
          let hyperedgeCount = 0;
          let hyperedgeWarningReason: string | undefined;

          if (designDocAbsPaths.length > 0 && codeNodes.length > 0) {
            // 1) anchor 集成 — references / conceptually_related_to 边
            // anchor 用 embedding（local 不计费 / openai 按字符计费），不需要
            // 单独 opt-in，但仍受 mode + budget 守卫保护
            try {
              const provider = createEmbeddingProvider();
              const anchorResult = await runAnchorIntegration(resolvedRoot, {
                markdownFiles: designDocAbsPaths,
                graphNodes: codeNodes,
                provider,
              });
              if (anchorResult.semanticEdges.length > 0) {
                graphJson.links.push(...anchorResult.semanticEdges);
                logger.info(
                  `anchor-integration: 追加 ${anchorResult.semanticEdges.length} 条语义边到 graph.json`,
                );
              }
            } catch (anchorErr) {
              logger.warn(
                `anchor-integration: 失败，跳过语义边生成: ${anchorErr instanceof Error ? anchorErr.message : String(anchorErr)}`,
              );
            }

            // 2) hyperedge 集成 — LLM 提取超边（显式 opt-in 控制）
            // 使用提前解析的 hyperedgesOptInEarly 避免重复声明
            if (!hyperedgesOptInEarly) {
              logger.info(
                'hyperedge-integration: 跳过 — 未显式 opt-in（用 --hyperedges 或 SPECTRA_HYPEREDGES_ENABLED=true 启用）',
              );
            } else {
              try {
                const docChunks = chunkMarkdownFiles(designDocAbsPaths, resolvedRoot);
                // Feature 140 T26 — 注入 README 全量内容作为虚拟 DocChunk（最高优先级，
                // 放在 docChunks 数组首位）。这让 hyperedge extractor 在 LLM 调用中始终
                // 能看到项目顶层叙述（README），不依赖 designDocAbsPaths 的扫描覆盖度。
                // 仅 --include-docs=true 且 README 实际读取成功时注入；未注入时行为完全不变。
                if (extractedReadmeContent && extractedReadmeContent.trim().length > 0) {
                  const readmeText = extractedReadmeContent;
                  const readmeChunk = {
                    filePath: 'README.md',
                    startLine: 1,
                    endLine: readmeText.split('\n').length,
                    headingPath: 'README',
                    text: readmeText,
                    tokenCount: Math.ceil(readmeText.length / 4),
                  };
                  docChunks.unshift(readmeChunk);
                  logger.info(
                    `hyperedge-integration: 注入 README 作为虚拟 DocChunk（${readmeChunk.tokenCount} tokens 估算）`,
                  );
                }
                const hyperResult = await runHyperedgeIntegration({
                  hyperedgesEnabled: true,
                  graphNodes: codeNodes,
                  docChunks,
                });
                if (hyperResult.hyperedges.length > 0) {
                  graphJson.hyperedges = hyperResult.hyperedges;
                  hyperedgeCount = hyperResult.hyperedges.length;
                  logger.info(
                    `hyperedge-integration: 写入 ${hyperResult.hyperedges.length} 条 hyperedge 到 graph.json`,
                  );
                }
              } catch (hyperErr) {
                logger.warn(
                  `hyperedge-integration: 失败，跳过超边生成: ${hyperErr instanceof Error ? hyperErr.message : String(hyperErr)}`,
                );
              }
            }
          } else if (hyperedgesOptInEarly) {
            // Bug 2 T10：用户启用了 --hyperedges 但前置条件未满足（无 projectDocs）
            hyperedgeWarningReason = '前置条件未满足：designDocAbsPaths 为空';
            const warnMsg =
              '[WARNING] --hyperedges 已启用但前置条件未满足：designDocAbsPaths 为空。\n' +
              '          请先不带 --hyperedges 完整运行一次 batch（mode=full），生成项目文档后再启用。\n';
            logger.warn(warnMsg.trim());
            process.stderr.write(warnMsg);
          }

          // Bug 2 T11：batch summary hyperedge 状态行（仅当用户 opt-in 时打印）
          // Codex adversarial review 追加修复：opt-in 时默认 logger level=warn，
          // logger.info 在生产环境不可见，改用 process.stderr.write 强制输出
          if (hyperedgesOptInEarly) {
            if (hyperedgeWarningReason) {
              const msg = `[hyperedges] 已提取 0 条（WARNING: ${hyperedgeWarningReason}）`;
              process.stderr.write(`${msg}\n`);
              logger.warn(msg);
            } else {
              const msg = hyperedgeCount > 0
                ? `[hyperedges] 已提取 ${hyperedgeCount} 条`
                : `[hyperedges] 已提取 0 条（LLM 未返回有效候选；可在 graph.json 验证）`;
              process.stderr.write(`${msg}\n`);
              logger.warn(msg);
            }
          }
        } catch (integrationErr) {
          logger.warn(
            `semantic-integration: 整体失败，graph.json 将不含 anchor/hyperedge 数据: ${integrationErr instanceof Error ? integrationErr.message : String(integrationErr)}`,
          );
        }
      }

      // Feature 102: 社区分析（写盘前执行，使 degree 信息写入 graph.json）
      try {
        const { runCommunityAnalysis } = await import('../panoramic/community/index.js');
        const reportPath = runCommunityAnalysis(graphJson, resolvedOutputDir);
        logger.info(`community-analysis: GRAPH_REPORT.md 已生成: ${reportPath}`);
      } catch (communityErr) {
        logger.warn(`community-analysis: 社区分析失败，跳过报告生成: ${communityErr instanceof Error ? communityErr.message : String(communityErr)}`);
      }

      // F175 FR-006/FR-007：写盘前归一化（byte-stable）——nodes/links/hyperedges 确定性排序，
      // 在追加 semantic edges + 社区分析之后调用，覆盖完整边集。
      // F179：stripTimestamps:true 使 graph.generatedAt 固定为 epoch，落盘 graph.json 真 byte-stable
      // （此前 F175 仅在测试读取侧 delete generatedAt，是 over-claim；现在落盘侧直接固定）。
      normalizeGraphForWrite(graphJson, { stripTimestamps: true });

      // F217 FR-009：runBatch 主链基于当前工作树 AST 重新分析源码，写盘前注入 sourceCommit
      // （非 git 仓库 / rev-parse 失败时 resolveSourceCommit 返回 null，不抛异常）
      graphJson.graph.sourceCommit = resolveSourceCommit(resolvedRoot);

      // 社区分析完成后写盘（graphJson 已含 degree metadata）
      const graphWrittenPath = writeKnowledgeGraph(graphJson, resolvedOutputDir);
      docGraphPath = toProjectPath(graphWrittenPath);

      // Feature 140 FR-011：graph.html 始终生成（之前 `if (options.generateHtml)` 是
      // `--html` flag opt-in，导致大量 batch 输出缺失 graph.html）。改用 `?? true` 默认
      // 生成，调用方仍可显式 false 跳过。极小图（< 3 节点）由 buildHtmlTemplate 注入 banner。
      if (options.generateHtml ?? true) {
        try {
          // T-036：为每个节点注入 specPath 和 specPathExists 字段
          // spec 类型节点：id 本身就是 specPath（形如 "specs/modules/xxx.spec.md"）
          // module/component 类型节点：尝试从 metadata 推导对应的 spec 文件路径
          const enrichedNodes = graphJson.nodes.map((node) => {
            let specPath: string | undefined;
            if (node.kind === 'spec') {
              // spec 节点的 id 就是 spec 文件的 repo-relative 路径
              specPath = node.id;
            } else if (
              typeof node.metadata?.sourceTarget === 'string' &&
              (node.metadata.sourceTarget as string).endsWith('.spec.md')
            ) {
              specPath = node.metadata.sourceTarget as string;
            }
            if (!specPath) return node;
            const absSpecPath = path.join(resolvedRoot, specPath);
            const specPathExists = fs.existsSync(absSpecPath);
            return { ...node, specPath: absSpecPath, specPathExists };
          });
          const enrichedGraphJson = { ...graphJson, nodes: enrichedNodes };
          const graphDataJson = JSON.stringify(enrichedGraphJson);
          // FR-023：节点数 >= 2000 时输出 warn 提示（大图性能风险）
          if (enrichedNodes.length >= 2000) {
            logger.warn('[warn] graph node count exceeds 2000, force layout disabled, using static layout');
          }
          // Feature 140 T19：传入 nodeCount，让 buildHtmlTemplate 在极小图（< 3 节点）时注入说明 banner
          const htmlContent = buildHtmlTemplate(graphDataJson, {
            forceLayoutThreshold: 2000,
            nodeCount: enrichedNodes.length,
          });
          const htmlPath = path.join(resolvedOutputDir, BATCH_OUTPUT_SUBDIRS.META, 'graph.html');
          fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
          fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
          graphHtmlPath = toProjectPath(htmlPath);
          logger.info(`graph.html 已生成: ${graphHtmlPath}`);
          // FR-024：体积超 5 MB 输出 warn（不阻断）
          const htmlSize = Buffer.byteLength(htmlContent, 'utf-8');
          if (htmlSize >= 5 * 1024 * 1024) {
            logger.warn(
              `[warn] graph.html 体积 ${(htmlSize / (1024 * 1024)).toFixed(1)} MB 超过 5 MB，建议考虑减少节点数量`,
            );
          }
        } catch (htmlErr) {
          logger.warn(`graph.html 生成失败，跳过: ${htmlErr instanceof Error ? htmlErr.message : String(htmlErr)}`);
        }
      }
    } catch (graphErr) {
      logger.warn(`graph-persistence: 图构建失败，跳过 graph.json 生成: ${graphErr instanceof Error ? graphErr.message : String(graphErr)}`);
    }

    // F5：reading/code-only 模式跳过 Coverage Audit（依赖完整产品文档集）
    if (effectiveMode === 'full') {
      try {
        const coverageAuditor = new CoverageAuditor();
        const coverageAudit = await coverageAuditor.audit({
          projectRoot: resolvedRoot,
          outputDir: resolvedOutputDir,
          projectContext,
          docGraph,
          moduleGroups: groupResult.groups,
        });
        const coverageMarkdown = coverageAuditor.render(coverageAudit);
        const coverageMarkdownPathAbs = path.join(projectDir, '_coverage-report.md');
        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(coverageMarkdownPathAbs, coverageMarkdown, 'utf-8');
        coverageReportPath = toProjectPath(coverageMarkdownPathAbs);
      } catch (err) {
        logger.warn(`覆盖率审计生成失败: ${String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`文档图谱生成失败: ${String(err)}`);
  }

  // 步骤 6：生成架构索引（使用收集的 ModuleSpec）
  let indexGenerated = false;
  try {
    initRenderer();
    // 通过 SpecStore.allKnownSpecs() 获取：已过滤 orphan/bundle_copy/derived
    const index = generateIndex(
      specStore.allKnownSpecs(),
      mergedGraph,
      languageStats,
      processedLanguages,
    );
    const indexMarkdown = renderIndex(index as any);
    const indexPath = path.join(resolvedOutputDir, BATCH_OUTPUT_SUBDIRS.MODULES, '_index.spec.md');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, indexMarkdown, 'utf-8');
    indexGenerated = true;
  } catch (err) {
    logger.warn(`架构索引生成失败: ${String(err)}`);
  }

  // F5：reading/code-only 模式跳过 Docs Bundle（依赖完整产品文档集）
  if (effectiveMode === 'full') {
    try {
      const docsBundleResult = orchestrateDocsBundle({
        projectRoot: resolvedRoot,
        outputDir: resolvedOutputDir,
        metaDir,
      });
      docsBundleManifestPath = docsBundleResult.manifestPath;
      docsBundleProfiles = docsBundleResult.profiles;
    } catch (err) {
      logger.warn(`文档 bundle 编排失败: ${String(err)}`);
    }
  }

  // Feature 127：聚合 LLM 成本（在质量报告前计算，供其追加成本节）
  const costSummary: CostSummary = aggregateCostSummary(costRecords);

  // Feature 133（adversarial-review post-fix）：reading / code-only 模式跳过
  // docs-quality-evaluator 调用——该评估器依赖 architectureNarrative + 完整产
  // 品文档集，在 mode !== 'full' 时这些上游产物已被跳过，强行调用会得到空报告
  if (projectDocsResult && effectiveMode === 'full') {
    try {
      // 传入 manifestSearchDir 以便质量报告找到 _meta/ 中的 docs-bundle.yaml
      projectDocsResult.qualityInputs.manifestSearchDir = metaDir;
      // Feature 127：将成本汇总注入质量报告
      projectDocsResult.qualityInputs.costSummary = costSummary;
      const qualityDoc = generateDocsQualityReport(projectDocsResult.qualityInputs);
      projectDocs = Array.from(new Set([
        ...(projectDocs ?? []),
        ...qualityDoc.writtenFiles
          .filter((filePath) => filePath.endsWith('.md'))
          .map(toProjectPath),
      ])).sort((a, b) => a.localeCompare(b));
    } catch (err) {
      logger.warn(`文档质量报告生成失败: ${String(err)}`);
    }
  }

  // Feature 130：债务情报 pipeline（写入 project/technical-debt.md + 追加 quality-report）
  let debtResult: DebtPipelineResult | undefined;
  if (options.enableDebtIntelligence !== false) {
    try {
      // Codex review：CLI 不会显式构造 SimpleLLMClient；若环境变量可用则自动注入默认实现，
      // 确保生产路径下 `?` 结尾的 design-doc open question 能走 LLM 主题推断而非被降级丢弃。
      const { tryCreateDefaultLLMClient } = await import('../debt-scanner/llm-clients.js');
      const llmClient = options.debtLlmClient ?? tryCreateDefaultLLMClient();
      debtResult = await generateDebtIntelligence({
        projectRoot: resolvedRoot,
        specsDir: resolvedOutputDir,
        registry: LanguageAdapterRegistry.getInstance(),
        // Codex review：batch 的 --languages 过滤必须传到 debt 扫描，否则 filtered 运行
        // 会扫出并发布不在本次处理范围的债务条目。
        languages: options.languages,
        llmClient,
        budgetLimit: options.budget,
        dryRun: options.dryRun,
      });
      // 把 debt 的 tokenUsage 汇入 cost 汇总（以 debt-intelligence 为模块标签）
      if (debtResult.tokenUsage.input > 0 || debtResult.tokenUsage.output > 0) {
        costRecords.push({
          moduleName: 'debt-intelligence',
          loc: 0,
          cost: {
            tokenUsage: {
              input: debtResult.tokenUsage.input,
              output: debtResult.tokenUsage.output,
            },
            durationMs: debtResult.durationMs,
            llmModel: resolveReverseSpecModel().model,
            fallbackReason: debtResult.fallbackReason ?? null,
          },
        });
        // 重新聚合 cost summary（含 debt tokens）
        Object.assign(costSummary, aggregateCostSummary(costRecords));
      }
    } catch (err) {
      logger.warn(`debt-intelligence pipeline 失败: ${String(err)}`);
    }
  }

  // Feature 140 FR-013：Top 5 contextAssembly token 消费模块
  // 用途：让用户在 batch 末尾直观看到哪些模块在跨模块上下文上消耗最多 token，
  // 便于针对性优化（拆分大模块 / 减少 dependency / 启用 --no-include-docs 等）。
  // 数据源：collectedModuleSpecs[].frontmatter.costBreakdown.contextAssembly（Feature 140 T17 写入）。
  // 缺失字段（mock 路径 / AST-only 降级 / 旧 cache 命中）的模块会被跳过，不参与排序。
  // 输出渠道：process.stderr（与现有 batch summary 行约定一致，避免污染 stdout 数据流）。
  try {
    const topModules = collectedModuleSpecs
      .map((spec) => ({
        sourceTarget: spec.frontmatter.sourceTarget,
        contextAssembly: spec.frontmatter.costBreakdown?.contextAssembly,
      }))
      .filter((m): m is { sourceTarget: string; contextAssembly: number } =>
        typeof m.contextAssembly === 'number' && m.contextAssembly > 0,
      )
      .sort((a, b) => b.contextAssembly - a.contextAssembly)
      .slice(0, 5);
    if (topModules.length > 0) {
      const lines = ['Top 5 input token 消费模块：'];
      topModules.forEach((m, idx) => {
        // 锁定 'en-US' locale，确保 CI（en_US.UTF-8）和开发环境（zh_CN.UTF-8 / de_DE 等）
        // 输出一致的千分位分隔符（"8,500" 而非 "8.500" / "8 500"），便于 grep 与 fixture 断言
        lines.push(`  ${idx + 1}. ${m.sourceTarget}: ${m.contextAssembly.toLocaleString('en-US')} tokens`);
      });
      process.stderr.write(lines.join('\n') + '\n');
    }
  } catch (err) {
    // 聚合失败不应阻断主流程（Top 5 是观测，不是核心交付）
    logger.warn(`Top 5 token 消费模块聚合失败，跳过: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 步骤 6 / 7：摘要日志 + README 索引（F220 B7 seam → stage ⑤ artifact-reporting）
  const summary = reporter.finish();
  const { summaryLogPathAbs } = await writeBatchReportingArtifacts({
    summary,
    metaDir,
    costSummary,
    failedModules: checkedState.failedModules,
    resolvedRoot,
    resolvedOutputDir,
    modulesDir,
    specStore,
    projectDocs,
    docsBundleProfiles,
    spectraVersion: SPECTRA_VERSION,
  });

  // 步骤 8：成功后清理检查点
  if (failed.length === 0) {
    clearCheckpoint(checkpointPath);
  }

  return {
    totalModules: processingOrder.length,
    successful,
    failed,
    skipped,
    degraded,
    duration: Date.now() - startTime,
    indexGenerated,
    summaryLogPath: toProjectPath(summaryLogPathAbs),
    detectedLanguages: isMultiLang ? processedLanguages : undefined,
    languageStats,
    docGraphPath,
    coverageReportPath,
    deltaReportPath,
    deltaReport,
    projectDocs,
    docsBundleManifestPath,
    docsBundleProfiles,
    costSummary,
    budgetDecision: budgetDecisionResult,
    debt: debtResult,
    graphHtmlPath,
  };
}


