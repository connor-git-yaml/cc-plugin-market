/**
 * 批量编排器
 * 按模块级拓扑顺序编排全项目 Spec 生成（FR-012/FR-014/FR-015/FR-016/FR-017）
 * 支持多语言混合项目：按语言分组、分组依赖图构建、图合并拓扑排序（Feature 031）
 * 参见 contracts/batch-module.md
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildGraph } from '../graph/dependency-graph.js';
import { buildDirectoryGraph } from '../graph/directory-graph.js';
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
import { createReporter, writeSummaryLog, type ProgressMode } from './progress-reporter.js';
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
import { createLogger } from '../panoramic/utils/logger.js';
import { groupFilesToModules, type GroupingOptions } from './module-grouper.js';
import { groupFilesByLanguage, type LanguageGroup } from './language-grouper.js';
import { scanFiles, type LanguageFileStat } from '../utils/file-scanner.js';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';
import type { DependencyGraph, GraphNode, DependencyEdge } from '../models/dependency-graph.js';
import type { BatchState, FailedModule, ModuleSpec } from '../models/module-spec.js';
import {
  buildDocGraph,
  scanStoredModuleSpecs,
  type StoredModuleSpecSummary,
} from '../panoramic/builders/doc-graph-builder.js';
import { buildCrossReferenceIndex } from '../panoramic/cross-reference-index.js';
import { renderSpec } from '../generator/spec-renderer.js';
import { CoverageAuditor } from '../panoramic/pipelines/coverage-auditor.js';
import { buildProjectContext } from '../panoramic/project-context.js';
import {
  generateBatchProjectDocs,
  generateDocsQualityReport,
  type BatchProjectDocsResult,
} from '../panoramic/batch-project-docs.js';
import { resolveReverseSpecModel } from '../core/model-selection.js';
import { orchestrateDocsBundle } from '../panoramic/pipelines/docs-bundle-orchestrator.js';
import type { DocsBundleProfileSummary } from '../panoramic/models/docs-bundle-types.js';
import { BATCH_OUTPUT_SUBDIRS } from '../panoramic/output-filenames.js';
import { buildKnowledgeGraph, writeKnowledgeGraph } from '../panoramic/graph/index.js';
import { SpecStore } from '../spec-store/index.js';
import { createRequire } from 'node:module';

// 从 package.json 读取版本号（避免硬编码）
const _require = createRequire(import.meta.url);
const SPECTRA_VERSION: string = (_require('../../package.json') as { version: string }).version;

// ============================================================
// 类型定义
// ============================================================

export interface BatchOptions {
  /** 即使 spec 已存在也重新生成 */
  force?: boolean;
  /** 仅重生成受影响的 spec */
  incremental?: boolean;
  /** 输出目录（默认 'specs'，相对路径基于 projectRoot） */
  outputDir?: string;
  /** 进度回调 */
  onProgress?: (completed: number, total: number) => void;
  /** 每个模块的 LLM 最大重试次数（默认 3） */
  maxRetries?: number;
  /** 并发处理的模块数上限（默认 1 = 顺序处理，建议 3-5） */
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
}

const logger = createLogger('batch-orchestrator');

// ============================================================
// 内部辅助函数
// ============================================================

/**
 * 合并多个语言的 DependencyGraph 用于全局拓扑排序
 * 仅合并 modules 和 edges，SCC/Mermaid 按语言独立保留（TD-002 选项 C）
 */
export function mergeGraphsForTopologicalSort(
  graphs: DependencyGraph[],
  projectRoot: string,
): DependencyGraph {
  const allModules: GraphNode[] = [];
  const allEdges: DependencyEdge[] = [];

  for (const graph of graphs) {
    allModules.push(...graph.modules);
    allEdges.push(...graph.edges);
  }

  // 合并 Mermaid 源码（各语言用注释分隔）
  const mermaidParts = graphs
    .filter((g) => g.mermaidSource.trim().length > 0)
    .map((g) => g.mermaidSource);
  const mermaidSource = mermaidParts.join('\n');

  return {
    projectRoot,
    modules: allModules,
    edges: allEdges,
    topologicalOrder: allModules.map((m) => m.source),
    sccs: graphs.flatMap((g) => g.sccs),
    totalModules: allModules.length,
    totalEdges: allEdges.length,
    analyzedAt: new Date().toISOString(),
    mermaidSource,
  };
}

/**
 * 检测跨语言引用
 * 扫描模块 imports 是否引用了其他语言组的路径
 */
export function detectCrossLanguageRefs(
  moduleFiles: string[],
  languageGroups: LanguageGroup[],
  graph: DependencyGraph,
): string[] {
  const refs: string[] = [];

  // 构建文件到语言组的映射
  const fileToLang = new Map<string, string>();
  for (const group of languageGroups) {
    for (const file of group.files) {
      fileToLang.set(file, group.adapterId);
    }
  }

  // 查找当前模块文件的语言
  const moduleFileSet = new Set(moduleFiles);
  const moduleLangs = new Set<string>();
  for (const file of moduleFiles) {
    const lang = fileToLang.get(file);
    if (lang) moduleLangs.add(lang);
  }

  // 查找依赖边中指向其他语言的引用
  for (const edge of graph.edges) {
    if (!moduleFileSet.has(edge.from)) continue;
    const targetLang = fileToLang.get(edge.to);
    if (targetLang && !moduleLangs.has(targetLang)) {
      refs.push(`${targetLang}:${edge.to}`);
    }
  }

  return [...new Set(refs)];
}

/**
 * 生成跨语言调用提示文本（CQ-001）
 */
export function generateCrossLanguageHint(languageNames: string[]): string {
  return `\n\n> 注意：本项目包含多种编程语言（${languageNames.join('、')}），` +
    '模块间可能存在 AST 不可见的隐式跨语言调用' +
    '（如 REST API、gRPC、FFI、subprocess 等），' +
    '建议人工审查跨语言交互边界。';
}

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
  const {
    force = false,
    incremental = false,
    maxRetries = 3,
    outputDir = 'specs',
  } = options;

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
  const normalizeProjectPath = (inputPath: string): string => inputPath.split(path.sep).join('/');

  // 步骤 1：扫描文件获取 languageStats
  const scanResult = scanFiles(resolvedRoot, { projectRoot: resolvedRoot });
  const languageStats = scanResult.languageStats;
  const detectedLanguages = languageStats
    ? Array.from(languageStats.keys())
    : [];

  // 步骤 1.5：语言分组 + 过滤告警
  const langGroupResult = groupFilesByLanguage(
    scanResult.files,
    options.languages,
  );
  const languageGroupsList = langGroupResult.groups;
  let processedLanguages = langGroupResult.groups.map((g) => g.adapterId);

  for (const warning of langGroupResult.warnings) {
    console.warn(`\u26A0 ${warning}`);
  }

  if (processedLanguages.length === 0 && !options.languages?.length) {
    processedLanguages = detectedLanguages;
  }

  const isMultiLang = processedLanguages.length >= 2;
  const isSingleNonTsJs = processedLanguages.length === 1 && processedLanguages[0] !== 'ts-js';

  // 步骤 1.6：根据语言组合选择主依赖图
  let mergedGraph: DependencyGraph;
  if (isMultiLang) {
    const perLangGraphs: DependencyGraph[] = [];
    for (const langGroup of languageGroupsList) {
      perLangGraphs.push(await buildGraphForLanguageGroup(langGroup, resolvedRoot));
    }

    // 步骤 1.7：合并拓扑排序
    mergedGraph = perLangGraphs.length > 0
      ? mergeGraphsForTopologicalSort(perLangGraphs, resolvedRoot)
      : await buildGraph(resolvedRoot);
  } else if (isSingleNonTsJs && languageGroupsList[0]) {
    mergedGraph = await buildGraphForLanguageGroup(languageGroupsList[0], resolvedRoot);
  } else {
    // 纯 TS/JS 或未识别受支持语言：保持 dependency-cruiser 现有路径
    mergedGraph = await buildGraph(resolvedRoot);
  }

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
  const storedSpecByTarget = new Map(existingStoredSpecs.map((spec) => [spec.sourceTarget, spec]));

  let deltaReport: DeltaReport | undefined;
  if (incremental) {
    if (force) {
      deltaReport = {
        title: 'Delta Regeneration Report',
        generatedAt: new Date().toISOString(),
        projectRoot: resolvedRoot,
        mode: 'full',
        totalTargets: groupResult.groups.reduce((sum, group) => {
          const isRootGroup = group.name === rootModuleName || group.name.startsWith(`${rootModuleName}--`);
          return sum + (isRootGroup ? group.files.length : 1);
        }, 0),
        regenerateTargets: [],
        directChanges: [],
        propagatedChanges: [],
        unchangedTargets: [],
        fallbackReason: 'force-enabled',
      };
    } else {
      const deltaRegenerator = new DeltaRegenerator();
      deltaReport = await deltaRegenerator.plan({
        projectRoot: resolvedRoot,
        dependencyGraph: mergedGraph,
        moduleGroups: groupResult.groups,
        storedSpecs: existingStoredSpecs,
      });
    }
  }

  const regenerateTargets = new Set(deltaReport?.regenerateTargets ?? []);
  const forceFullRegeneration = force || (incremental && deltaReport?.mode === 'full');
  const shouldUseIncrementalPlan = incremental && !force && deltaReport?.mode === 'incremental';

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
      forceRegenerate: force,
      // 多语言扩展字段
      languageGroups: isMultiLang
        ? Object.fromEntries(languageGroupsList.map((g) => [g.adapterId, g.files]))
        : undefined,
      filterLanguages: options.languages,
    };
  }

  if (isResume) {
    console.log(`恢复断点: 已完成 ${state.completedModules.length}/${state.totalModules} 模块`);
  }

  // 步骤 4：按模块级拓扑顺序处理
  const reporter = createReporter(processingOrder.length, options.progressMode);
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
  const concurrency = options.concurrency ?? 1;
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

  // H3 修复：通过集中模型配置解析 Sonnet 模型 ID，避免硬编码版本字符串
  const sonnetModelId = resolveReverseSpecModel({ cwd: resolvedRoot, agentId: 'specify-sonnet' }).model;

  /** 单个模块的处理逻辑（提取为函数以支持并行调度） */
  async function processOneModule(moduleName: string): Promise<void> {
    const group = moduleGroups.get(moduleName);
    if (!group) return;

    if (completedPaths.has(moduleName)) return;

    const isRoot = moduleName === rootModuleName || moduleName.startsWith(`${rootModuleName}--`);
    const specPath = path.join(modulesDir, `${moduleName}.spec.md`);
    // H4 修复：文件级降级场景下 moduleSourceTarget 须与 targetPath 保持一致（文件路径）
    // 否则 --incremental 的 regenerateTargets 查询和 storedSpecByTarget 查询全部错位
    const hasDirPathConflict = !isRoot && group.files.length === 1 && conflictingDirPaths.has(group.dirPath);
    const moduleSourceTarget = hasDirPathConflict
      ? normalizeProjectPath(group.files[0]!)
      : normalizeProjectPath(group.dirPath);
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
          ? regenerateTargets.has(moduleSourceTarget)
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
          skipEnrichment: isSmallModule || budgetSkipEnrichmentAll,
          modelOverride:
            isSmallModule || budgetCheaperModelAll ? sonnetModelId : undefined,
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
          for (const file of group.files) {
            const sourceTarget = normalizeProjectPath(file);
            if (!rootTargetsToGenerate.includes(sourceTarget)) continue;
            const fullPath = path.join(resolvedRoot, file);
            const storedSpec = storedSpecByTarget.get(sourceTarget);
            const result = await generateSpec(fullPath, {
              ...genOptions,
              existingVersion: storedSpec?.version,
            });
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

          successful.push(moduleName);
          reporter.complete(moduleName, 'success');
          checkedState.completedModules.push({
            path: moduleName,
            specPath: generatedRootSpecs[0]!,
            completedAt: new Date().toISOString(),
          });
        } else {
          // BUG-A 修复：同一 dirPath 下有多个单文件模块时（如 graphify/ 下有 a.py/b.py），
          // 使用文件路径避免多个模块覆盖同一个 {dirName}.spec.md；
          // 否则仍使用目录路径（每个目录只有一个文件时，目录名才是有意义的模块标识）
          // 注意：hasDirPathConflict 已在上方计算（H4 修复）
          const targetPath = hasDirPathConflict
            ? path.join(resolvedRoot, group.files[0]!)
            : path.join(resolvedRoot, group.dirPath);
          const result = await generateSpec(targetPath, {
            ...genOptions,
            existingVersion: storedSpecByTarget.get(moduleSourceTarget)?.version,
          });

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

          if (result.confidence === 'low' && result.warnings.some((w) => w.includes('降级'))) {
            degraded.push(moduleName);
            reporter.complete(moduleName, 'degraded');
          } else {
            successful.push(moduleName);
            reporter.complete(moduleName, 'success');
          }

          checkedState.completedModules.push({
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
        if (retryCount >= maxRetries) {
          const failedModule: FailedModule = {
            path: moduleName,
            error: error.message ?? String(error),
            failedAt: new Date().toISOString(),
            retryCount,
            degradedToAstOnly: false,
          };
          failed.push(failedModule);
          checkedState.failedModules.push(failedModule);
          reporter.complete(moduleName, 'failed');
        }
      }
    }

    checkedState.lastUpdatedAt = new Date().toISOString();
    saveCheckpoint(checkedState, checkpointPath);

    options.onProgress?.(
      checkedState.completedModules.length + failed.length + skipped.length,
      processingOrder.length,
    );
  }

  // 步骤 4：并发控制调度
  if (concurrency <= 1) {
    // 顺序处理（向后兼容默认行为）
    for (const moduleName of processingOrder) {
      await processOneModule(moduleName);
    }
  } else {
    // 并行处理：使用信号量控制并发数
    const pending: Promise<void>[] = [];
    let activeCount = 0;

    for (const moduleName of processingOrder) {
      // 等待直到有空闲槽位
      while (activeCount >= concurrency) {
        // H2 修复：pending 为空时 Promise.race([]) 永不 resolve，会死锁
        if (pending.length === 0) break;
        await Promise.race(pending);
      }

      activeCount++;
      const task = processOneModule(moduleName).finally(() => {
        activeCount--;
        // 从 pending 中移除已完成的 promise
        const idx = pending.indexOf(task);
        if (idx >= 0) pending.splice(idx, 1);
      });
      pending.push(task);
    }

    // 等待所有剩余任务完成
    await Promise.allSettled(pending);
  }

  // 步骤 5：生成架构索引（使用收集的 ModuleSpec）
  let deltaReportPath: string | undefined;
  let docGraphPath: string | undefined;
  let coverageReportPath: string | undefined;
  let projectDocs: string[] | undefined;
  let projectDocsResult: BatchProjectDocsResult | undefined;
  let docsBundleManifestPath: string | undefined;
  let docsBundleProfiles: DocsBundleProfileSummary[] | undefined;
  const allIndexSpecs = mergeIndexSpecs(collectedModuleSpecs, existingStoredSpecs, toProjectPath);
  // SpecStore 统一查询入口：Step B-F 各消费方逐步迁移到此
  const specStore = new SpecStore({
    currentSpecs: collectedModuleSpecs,
    storedSpecs: existingStoredSpecs,
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
    try {
      projectDocsResult = await generateBatchProjectDocs({
        projectRoot: resolvedRoot,
        outputDir: projectDir,
        specsRootDir: resolvedOutputDir,
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

      // Feature 107: 多模态提取管道（--include-docs / --include-images）
      let extractionResults: import('../extraction/index.js').ExtractionResult[] | undefined;
      if (options.includeDocs || options.includeImages) {
        try {
          const { runExtractionPipeline } = await import('../extraction/index.js');
          extractionResults = await runExtractionPipeline({
            projectRoot: resolvedRoot,
            outputDir: resolvedOutputDir,
            includeDocs: options.includeDocs ?? false,
            includeImages: options.includeImages ?? false,
          });
        } catch (extractErr) {
          logger.warn(`多模态提取失败，跳过: ${String(extractErr)}`);
        }
      }

      const graphJson = buildKnowledgeGraph({
        architectureIR: projectDocsResult?.architectureIR,
        docGraph,
        crossReferenceLinks,
        extractionResults,  // Feature 107 第四路数据源
      });

      // Feature 102: 社区分析（写盘前执行，使 degree 信息写入 graph.json）
      try {
        const { runCommunityAnalysis } = await import('../panoramic/community/index.js');
        const reportPath = runCommunityAnalysis(graphJson, resolvedOutputDir);
        logger.info(`community-analysis: GRAPH_REPORT.md 已生成: ${reportPath}`);
      } catch (communityErr) {
        logger.warn(`community-analysis: 社区分析失败，跳过报告生成: ${communityErr instanceof Error ? communityErr.message : String(communityErr)}`);
      }

      // 社区分析完成后写盘（graphJson 已含 degree metadata）
      const graphWrittenPath = writeKnowledgeGraph(graphJson, resolvedOutputDir);
      docGraphPath = toProjectPath(graphWrittenPath);
    } catch (graphErr) {
      logger.warn(`graph-persistence: 图构建失败，跳过 graph.json 生成: ${graphErr instanceof Error ? graphErr.message : String(graphErr)}`);
    }

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
  } catch (err) {
    logger.warn(`文档图谱生成失败: ${String(err)}`);
  }

  // 步骤 6：生成架构索引（使用收集的 ModuleSpec）
  let indexGenerated = false;
  try {
    initRenderer();
    const index = generateIndex(
      allIndexSpecs,
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

  // Feature 127：聚合 LLM 成本（在质量报告前计算，供其追加成本节）
  const costSummary: CostSummary = aggregateCostSummary(costRecords);

  if (projectDocsResult) {
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

  // 步骤 6：写入摘要日志（输出到 _meta/ 子目录）
  const summary = reporter.finish();
  fs.mkdirSync(metaDir, { recursive: true });
  const summaryLogPathAbs = path.join(metaDir, `batch-summary-${Date.now()}.md`);
  fs.mkdirSync(path.dirname(summaryLogPathAbs), { recursive: true });
  writeSummaryLog(summary, summaryLogPathAbs, costSummary);

  // 步骤 7：生成人类友好的 README.md 索引
  try {
    const { generateBatchReadme } = await import('./batch-readme-generator.js');
    const readmeContent = generateBatchReadme({
      projectName: path.basename(resolvedRoot),
      version: SPECTRA_VERSION,
      // 通过 SpecStore.allKnownSpecs() 获取：新生成 + 历史存储，已排除 orphan/bundle_copy/derived
      // 精确匹配 modulesDir 前缀（相对于 resolvedRoot），避免将 bundles/*/docs/modules/ 误计入
      moduleSpecs: (() => {
        const modulesDirRel = path.relative(resolvedRoot, modulesDir).split(path.sep).join('/') + '/';
        return specStore.allKnownSpecs()
          .filter(s => {
            const p = s.outputPath.replace(/\\/g, '/');
            return p.startsWith(modulesDirRel) && !path.basename(s.outputPath).startsWith('_');
          })
          .map(s => path.basename(s.outputPath, '.spec.md'));
      })(),
      projectDocs: projectDocs ?? [],
      bundles: docsBundleProfiles,
      outputDir: resolvedOutputDir,
    });
    fs.writeFileSync(path.join(resolvedOutputDir, 'README.md'), readmeContent, 'utf-8');
    logger.info('README.md 索引已生成');
  } catch (err) {
    logger.warn(`README.md 生成失败: ${String(err)}`);
  }

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
    projectDocs,
    docsBundleManifestPath,
    docsBundleProfiles,
    costSummary,
    budgetDecision: budgetDecisionResult,
  };
}

async function buildGraphForLanguageGroup(
  langGroup: LanguageGroup,
  projectRoot: string,
): Promise<DependencyGraph> {
  const registry = LanguageAdapterRegistry.getInstance();
  const adapter = registry.getAllAdapters().find((item) => item.id === langGroup.adapterId);

  if (adapter?.buildDependencyGraph) {
    try {
      const langGraph = await adapter.buildDependencyGraph(projectRoot);
      for (const node of langGraph.modules) {
        node.language = langGroup.adapterId;
      }
      return langGraph;
    } catch (err) {
      logger.debug(`语言专属依赖图构建失败，回落到目录图: ${String(err)}`);
    }
  }

  return buildFallbackGraph(langGroup, projectRoot);
}

/**
 * 使用 buildDirectoryGraph 为语言组构建兜底依赖图
 */
async function buildFallbackGraph(
  langGroup: LanguageGroup,
  projectRoot: string,
): Promise<DependencyGraph> {
  // buildDirectoryGraph 需要 CodeSkeleton，但此处我们没有骨架
  // 创建最小化的图（仅节点，无边）
  const { buildDirectoryGraph } = await import('../graph/directory-graph.js');
  const emptySkeletons: any[] = langGroup.files.map((f) => ({
    filePath: f,
    language: langGroup.languageName,
    loc: 0,
    exports: [],
    imports: [],
    hash: '0'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'tree-sitter',
  }));
  return buildDirectoryGraph(langGroup.files, projectRoot, emptySkeletons);
}

function mergeIndexSpecs(
  currentSpecs: ModuleSpec[],
  storedSpecs: StoredModuleSpecSummary[],
  toProjectPath: (absPath: string) => string,
): Array<{
  frontmatter: ModuleSpec['frontmatter'];
  outputPath: string;
  sections?: Pick<ModuleSpec['sections'], 'intent'>;
  intentSummary?: string;
}> {
  const merged = new Map<string, {
    frontmatter: ModuleSpec['frontmatter'];
    outputPath: string;
    sections?: Pick<ModuleSpec['sections'], 'intent'>;
    intentSummary?: string;
  }>();

  for (const storedSpec of storedSpecs) {
    if (!storedSpec.skeletonHash) {
      continue;
    }

    merged.set(storedSpec.outputPath, {
      frontmatter: {
        type: 'module-spec',
        version: storedSpec.version ?? 'v1',
        generatedBy: 'spectra v3.0',
        sourceTarget: storedSpec.sourceTarget,
        relatedFiles: storedSpec.relatedFiles,
        lastUpdated: new Date().toISOString(),
        confidence: storedSpec.confidence ?? 'medium',
        skeletonHash: storedSpec.skeletonHash,
        language: storedSpec.language,
        crossLanguageRefs: storedSpec.crossLanguageRefs,
      },
      outputPath: storedSpec.outputPath,
      intentSummary: storedSpec.intentSummary,
    });
  }

  for (const currentSpec of currentSpecs) {
    const normalizedOutputPath = path.isAbsolute(currentSpec.outputPath)
      ? toProjectPath(path.resolve(currentSpec.outputPath))
      : currentSpec.outputPath;
    merged.set(normalizedOutputPath, {
      frontmatter: currentSpec.frontmatter,
      outputPath: normalizedOutputPath,
      sections: {
        intent: currentSpec.sections.intent,
      },
    });
  }

  return [...merged.values()].sort((a, b) => a.outputPath.localeCompare(b.outputPath));
}
