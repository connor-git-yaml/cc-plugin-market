/**
 * 批量编排器
 * 按模块级拓扑顺序编排全项目 Spec 生成（FR-012/FR-014/FR-015/FR-016/FR-017）
 * 参见 contracts/batch-module.md
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildGraph } from '../graph/dependency-graph.js';
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
import type { BatchState, FailedModule, ModuleSpec } from '../models/module-spec.js';

// ============================================================
// 类型定义
// ============================================================

export interface BatchOptions {
  /** 即使 spec 已存在也重新生成 */
  force?: boolean;
  /** 进度回调 */
  onProgress?: (completed: number, total: number) => void;
  /** 每个模块的 LLM 最大重试次数（默认 3） */
  maxRetries?: number;
  /** 检查点文件路径 */
  checkpointPath?: string;
  /** 模块分组选项 */
  grouping?: GroupingOptions;
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
    checkpointPath = DEFAULT_CHECKPOINT_PATH,
  } = options;

  const startTime = Date.now();
  const resolvedRoot = path.resolve(projectRoot);

  // 步骤 1：构建依赖图
  const graph = await buildGraph(resolvedRoot);

  // 步骤 2：文件→模块聚合 + 模块级拓扑排序
  const groupResult = groupFilesToModules(graph, options.grouping);
  const processingOrder = groupResult.moduleOrder;
  const moduleGroups = new Map(groupResult.groups.map((g) => [g.name, g]));
  const rootModuleName = options.grouping?.rootModuleName ?? 'root';

  console.log(`发现 ${graph.modules.length} 个文件，聚合为 ${processingOrder.length} 个模块`);

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

  const completedPaths = new Set(state.completedModules.map((m) => m.path));

  for (const moduleName of processingOrder) {
    const group = moduleGroups.get(moduleName);
    if (!group) continue;

    // 跳过已完成的模块（断点恢复）
    if (completedPaths.has(moduleName)) {
      continue;
    }

    reporter.start(moduleName);
    state.currentModule = moduleName;

    // 检查 spec 是否已存在
    const specPath = path.join('specs', `${moduleName}.spec.md`);
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
          outputDir: 'specs',
          projectRoot: resolvedRoot,
          deep: true,
        };

        if (moduleName === rootModuleName) {
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
            specPath: result.specPath,
            completedAt: new Date().toISOString(),
            tokenUsage: result.tokenUsage,
          });
        }

        // root 模块整体记录
        if (moduleName === rootModuleName) {
          successful.push(moduleName);
          reporter.complete(moduleName, 'success');
          state.completedModules.push({
            path: moduleName,
            specPath: `specs/${rootModuleName}`,
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
    const index = generateIndex(collectedModuleSpecs, graph);
    const indexMarkdown = renderIndex(index as any);
    const indexPath = path.join('specs', '_index.spec.md');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, indexMarkdown, 'utf-8');
    indexGenerated = true;
  } catch {
    console.warn('架构索引生成失败');
  }

  // 步骤 6：写入摘要日志
  const summary = reporter.finish();
  const summaryLogPath = path.join('specs', `batch-summary-${Date.now()}.md`);
  writeSummaryLog(summary, summaryLogPath);

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
    summaryLogPath,
  };
}
