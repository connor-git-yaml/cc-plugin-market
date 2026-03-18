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
import { createReporter, writeSummaryLog } from './progress-reporter.js';
import { groupFilesToModules, type GroupingOptions } from './module-grouper.js';
import { groupFilesByLanguage, type LanguageGroup } from './language-grouper.js';
import { scanFiles, type LanguageFileStat } from '../utils/file-scanner.js';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';
import type { DependencyGraph, GraphNode, DependencyEdge } from '../models/dependency-graph.js';
import type { BatchState, FailedModule, ModuleSpec } from '../models/module-spec.js';

// ============================================================
// 类型定义
// ============================================================

export interface BatchOptions {
  /** 即使 spec 已存在也重新生成 */
  force?: boolean;
  /** 输出目录（默认 'specs'，相对路径基于 projectRoot） */
  outputDir?: string;
  /** 进度回调 */
  onProgress?: (completed: number, total: number) => void;
  /** 每个模块的 LLM 最大重试次数（默认 3） */
  maxRetries?: number;
  /** 检查点文件路径 */
  checkpointPath?: string;
  /** 模块分组选项 */
  grouping?: GroupingOptions;
  /** 语言过滤（如 ['typescript', 'python']），仅处理指定语言的模块 */
  languages?: string[];
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
}

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

  // 步骤 1：构建依赖图（TS/JS 用 dependency-cruiser）
  const graph = await buildGraph(resolvedRoot);

  // 步骤 1.5：扫描文件获取 languageStats
  const scanResult = scanFiles(resolvedRoot, { projectRoot: resolvedRoot });
  const languageStats = scanResult.languageStats;
  const detectedLanguages = languageStats
    ? Array.from(languageStats.keys())
    : [];
  const isMultiLang = detectedLanguages.length >= 2;

  // 步骤 1.6：语言分组 + 按语言构建依赖图
  let mergedGraph = graph;
  let languageGroupsList: LanguageGroup[] = [];
  let processedLanguages: string[] = detectedLanguages;

  if (isMultiLang) {
    const langGroupResult = groupFilesByLanguage(
      scanResult.files,
      options.languages,
    );
    languageGroupsList = langGroupResult.groups;
    processedLanguages = langGroupResult.groups.map((g) => g.adapterId);

    // 输出过滤警告
    for (const warning of langGroupResult.warnings) {
      console.warn(`\u26A0 ${warning}`);
    }

    // 为每个语言组构建依赖图
    const registry = LanguageAdapterRegistry.getInstance();
    const perLangGraphs: DependencyGraph[] = [];

    for (const langGroup of languageGroupsList) {
      const adapter = registry.getAllAdapters().find((a) => a.id === langGroup.adapterId);
      if (adapter?.buildDependencyGraph) {
        // 适配器有 buildDependencyGraph（如 ts-js）
        try {
          const langGraph = await adapter.buildDependencyGraph(resolvedRoot);
          // 为节点标记语言
          for (const node of langGraph.modules) {
            node.language = langGroup.adapterId;
          }
          perLangGraphs.push(langGraph);
        } catch {
          // buildDependencyGraph 失败，使用 buildDirectoryGraph 兜底
          perLangGraphs.push(await buildFallbackGraph(langGroup, resolvedRoot));
        }
      } else {
        // 使用 buildDirectoryGraph 兜底
        perLangGraphs.push(await buildFallbackGraph(langGroup, resolvedRoot));
      }
    }

    // 步骤 1.7：合并拓扑排序
    if (perLangGraphs.length > 0) {
      mergedGraph = mergeGraphsForTopologicalSort(perLangGraphs, resolvedRoot);
    }
  }

  // 步骤 2：文件→模块聚合 + 模块级拓扑排序
  const groupingOptions: GroupingOptions = {
    ...options.grouping,
    languageAware: isMultiLang,
  };
  const groupResult = groupFilesToModules(mergedGraph, groupingOptions);
  const processingOrder = groupResult.moduleOrder;
  const moduleGroups = new Map(groupResult.groups.map((g) => [g.name, g]));
  const rootModuleName = options.grouping?.rootModuleName ?? 'root';

  console.log(`发现 ${mergedGraph.modules.length} 个文件，聚合为 ${processingOrder.length} 个模块`);
  if (isMultiLang) {
    console.log(`检测到 ${detectedLanguages.length} 种语言: ${detectedLanguages.join(', ')}`);
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
      currentModule: null,
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
  const reporter = createReporter(processingOrder.length);
  const successful: string[] = [];
  const failed: FailedModule[] = [];
  const skipped: string[] = [];
  const degraded: string[] = [];
  const collectedModuleSpecs: ModuleSpec[] = [];

  // 预计算跨语言提示文本（多语言项目）
  const crossLangHint = isMultiLang
    ? generateCrossLanguageHint(detectedLanguages)
    : '';

  const completedPaths = new Set(state.completedModules.map((m) => m.path));

  for (const moduleName of processingOrder) {
    const group = moduleGroups.get(moduleName);
    if (!group) continue;

    // 跳过已完成的模块（断点恢复）
    if (completedPaths.has(moduleName)) {
      continue;
    }

    // 检查是否匹配根模块名（支持语言感知拆分后的 root--lang 变体）
    const isRoot = moduleName === rootModuleName || moduleName.startsWith(`${rootModuleName}--`);

    reporter.start(moduleName);
    state.currentModule = moduleName;

    // 检查 spec 是否已存在
    const specPath = path.join(resolvedOutputDir, `${moduleName}.spec.md`);
    if (!force && fs.existsSync(specPath)) {
      skipped.push(moduleName);
      reporter.complete(moduleName, 'skipped');
      continue;
    }

    // 处理模块
    let retryCount = 0;
    let moduleSuccess = false;

    while (retryCount < maxRetries && !moduleSuccess) {
      try {
        const genOptions: GenerateSpecOptions = {
          outputDir: resolvedOutputDir,
          projectRoot: resolvedRoot,
          deep: true,
          onStageProgress: (progress) => {
            reporter.stage(moduleName, progress);
            // context 阶段完成时触发进度条半步更新（US3）
            if (progress.stage === 'context' && progress.duration !== undefined) {
              const currentCompleted = state!.completedModules.length + failed.length + skipped.length;
              options.onProgress?.(currentCompleted + 0.5, processingOrder.length);
            }
          },
        };

        if (isRoot) {
          // root 模块：散文件逐个处理
          for (const file of group.files) {
            const fullPath = path.join(resolvedRoot, file);
            const result = await generateSpec(fullPath, genOptions);
            collectedModuleSpecs.push(result.moduleSpec);
          }
        } else {
          // 正常模块：传入目录路径
          const fullDirPath = path.join(resolvedRoot, group.dirPath);
          const result = await generateSpec(fullDirPath, genOptions);

          // 多语言项目：注入 language 到 frontmatter + 跨语言提示到 constraints
          if (isMultiLang && group.language) {
            (result.moduleSpec.frontmatter as any).language = group.language;

            // 检测跨语言引用
            const crossRefs = detectCrossLanguageRefs(
              group.files,
              languageGroupsList,
              mergedGraph,
            );
            if (crossRefs.length > 0) {
              (result.moduleSpec.frontmatter as any).crossLanguageRefs = crossRefs;
            }

            // 注入跨语言调用提示到 constraints section（CQ-001/T063）
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

          state.completedModules.push({
            path: moduleName,
            specPath: toProjectPath(path.resolve(result.specPath)),
            completedAt: new Date().toISOString(),
            tokenUsage: result.tokenUsage,
          });
        }

        // root 模块整体记录
        if (isRoot) {
          successful.push(moduleName);
          reporter.complete(moduleName, 'success');
          state.completedModules.push({
            path: moduleName,
            specPath: toProjectPath(path.join(resolvedOutputDir, `${moduleName}.spec.md`)),
            completedAt: new Date().toISOString(),
          });
        }

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
          state.failedModules.push(failedModule);
          reporter.complete(moduleName, 'failed');
        }
      }
    }

    // 每个模块后保存检查点
    state.currentModule = null;
    state.lastUpdatedAt = new Date().toISOString();
    saveCheckpoint(state, checkpointPath);

    options.onProgress?.(
      state.completedModules.length + failed.length + skipped.length,
      processingOrder.length,
    );
  }

  // 步骤 5：生成架构索引（使用收集的 ModuleSpec）
  let indexGenerated = false;
  try {
    initRenderer();
    const index = generateIndex(
      collectedModuleSpecs,
      mergedGraph,
      languageStats,
      processedLanguages,
    );
    const indexMarkdown = renderIndex(index as any);
    const indexPath = path.join(resolvedOutputDir, '_index.spec.md');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, indexMarkdown, 'utf-8');
    indexGenerated = true;
  } catch {
    console.warn('架构索引生成失败');
  }

  // 步骤 6：写入摘要日志
  const summary = reporter.finish();
  const summaryLogPathAbs = path.join(resolvedOutputDir, `batch-summary-${Date.now()}.md`);
  fs.mkdirSync(path.dirname(summaryLogPathAbs), { recursive: true });
  writeSummaryLog(summary, summaryLogPathAbs);

  // 步骤 7：成功后清理检查点
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
    detectedLanguages: isMultiLang ? detectedLanguages : undefined,
    languageStats,
  };
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
