/**
 * 多模态提取管道（Feature 107）
 * 协调三路提取器（Markdown、OpenAPI、图像），集成缓存，控制并发
 *
 * 行为契约（extraction-pipeline.contract.md）：
 * - includeDocs=false && includeImages=false 时立即返回 []
 * - 所有提取失败时返回 []，不抛出异常
 * - 返回的 ExtractionResult[] 已通过 Zod schema 验证
 * - Markdown LLM 并发上限 5，单次超时 8 秒（FR-016）
 * - 图片数量 > 50 输出警告（FR-017）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../panoramic/utils/logger.js';
import type { ExtractionResult } from './extraction-types.js';
import { ExtractionResultSchema, EMPTY_EXTRACTION_RESULT } from './extraction-types.js';
import { classifyFile, EXCLUDED_DIR_SEGMENTS } from './artifact-classifier.js';
import { fileExtractHash, loadExtractCache, saveExtractCache } from './extraction-cache.js';
import { extractMarkdown } from './markdown-extractor.js';
import { extractOpenApi } from './openapi-extractor.js';
import { extractImage } from './image-extractor.js';

const logger = createLogger('extraction-pipeline');

// ============================================================
// 接口定义
// ============================================================

/** 提取管道选项 */
export interface ExtractionPipelineOptions {
  /** 目标项目根目录（绝对路径） */
  projectRoot: string;
  /** 输出目录（绝对路径，缓存写入 {outputDir}/_meta/extraction-cache/） */
  outputDir: string;
  /** 是否启用 Markdown + API 规范提取 */
  includeDocs: boolean;
  /** 是否启用图像/图表 Vision 提取 */
  includeImages: boolean;
}

// ============================================================
// 文件扫描（递归）
// ============================================================

/**
 * 递归扫描目录，收集符合条件的文件路径
 */
function scanDirectory(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 目录级剪枝：跳过排除目录，避免展开 node_modules 等巨型目录
      if (EXCLUDED_DIR_SEGMENTS.has(entry.name)) continue;
      results.push(...scanDirectory(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * 扫描项目根目录，返回按类型分组的文件列表
 */
function scanProjectFiles(
  projectRoot: string,
  includeDocs: boolean,
  includeImages: boolean,
): { docFiles: string[]; apiSpecFiles: string[]; imageFiles: string[] } {
  const allFiles = scanDirectory(projectRoot);
  const docFiles: string[] = [];
  const apiSpecFiles: string[] = [];
  const imageFiles: string[] = [];

  for (const filePath of allFiles) {
    const kind = classifyFile(filePath);
    if (kind === 'document' && includeDocs) {
      docFiles.push(filePath);
    } else if (kind === 'api-spec' && includeDocs) {
      apiSpecFiles.push(filePath);
    } else if (kind === 'image' && includeImages) {
      imageFiles.push(filePath);
    }
  }

  return { docFiles, apiSpecFiles, imageFiles };
}

// ============================================================
// 手写并发池（不引入 p-limit）
// ============================================================

/**
 * 手写并发池
 * 同时最多 maxConcurrency 个 Promise 在执行
 *
 * @param tasks - 异步任务工厂函数列表
 * @param maxConcurrency - 并发上限
 * @returns 所有任务结果（按完成顺序收集）
 */
async function concurrentPool<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  const executing = new Set<Promise<void>>();

  for (const taskFn of tasks) {
    const promise = taskFn().then((result) => {
      results.push(result);
    }).catch((err) => {
      // 单个任务失败不影响池子继续，但记录日志保持可观测性
      logger.debug(`并发任务失败: ${String(err)}`);
    });

    const tracked = promise.finally(() => {
      executing.delete(tracked);
    });
    executing.add(tracked);

    if (executing.size >= maxConcurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

// ============================================================
// 单文件提取（含缓存集成）
// ============================================================

/**
 * 从单个文件提取结果，优先走缓存
 */
async function extractWithCache(
  filePath: string,
  outputDir: string,
  projectRoot: string,
  kind: 'document' | 'api-spec' | 'image',
): Promise<ExtractionResult> {
  // 读取文件内容（用于计算 hash）
  let content: string;
  if (kind === 'image') {
    // 图像是二进制文件，用 hex 编码计算 hash
    try {
      content = fs.readFileSync(filePath).toString('hex');
    } catch {
      content = '';
    }
  } else {
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      content = '';
    }
  }

  const isMarkdown = kind === 'document';
  const hash = fileExtractHash(filePath, content, isMarkdown);

  // 缓存命中
  const cached = loadExtractCache(hash, outputDir);
  if (cached) {
    logger.debug(`缓存命中，跳过提取: ${path.relative(projectRoot, filePath)}`);
    return cached;
  }

  // 缓存未命中，调用对应提取器
  let result: ExtractionResult;
  try {
    if (kind === 'document') {
      result = await extractMarkdown(filePath, content, projectRoot);
    } else if (kind === 'api-spec') {
      result = extractOpenApi(filePath, projectRoot);
    } else {
      result = await extractImage(filePath, { projectRoot });
    }
  } catch (err) {
    logger.warn(`提取失败，降级为空结果: ${filePath} — ${String(err)}`);
    return EMPTY_EXTRACTION_RESULT;
  }

  // Zod 验证（FR-015）
  const validated = ExtractionResultSchema.safeParse(result);
  if (!validated.success) {
    logger.warn(`提取结果 Zod 验证失败，丢弃: ${filePath}`);
    return EMPTY_EXTRACTION_RESULT;
  }

  // 写入缓存
  await saveExtractCache(hash, outputDir, validated.data, filePath).catch((err) => {
    logger.debug(`缓存写入失败（非致命）: ${String(err)}`);
  });

  return validated.data;
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 运行多模态提取管道
 *
 * @param options - 管道选项
 * @returns 所有提取结果数组（每个文件一个 ExtractionResult），不抛出异常
 */
export async function runExtractionPipeline(
  options: ExtractionPipelineOptions,
): Promise<ExtractionResult[]> {
  const { projectRoot, outputDir, includeDocs, includeImages } = options;

  // 快速返回：两个标志均未启用
  if (!includeDocs && !includeImages) {
    return [];
  }

  // 扫描文件
  const { docFiles, apiSpecFiles, imageFiles } = scanProjectFiles(projectRoot, includeDocs, includeImages);

  // 图片数量警告（FR-017）
  if (imageFiles.length > 50) {
    logger.warn(
      `检测到 ${imageFiles.length} 张图片，Vision API 调用成本较高。` +
      '建议仅在必要时使用 --include-images 标志。'
    );
  }

  const allResults: ExtractionResult[] = [];

  // API 规范文件（确定性，无 LLM，直接提取）
  for (const filePath of apiSpecFiles) {
    try {
      const result = await extractWithCache(filePath, outputDir, projectRoot, 'api-spec');
      if (result.nodes.length > 0 || result.edges.length > 0) {
        allResults.push(result);
      }
    } catch (err) {
      logger.warn(`API 规范提取失败: ${filePath} — ${String(err)}`);
    }
  }

  // Markdown 文件（含 LLM，并发上限 5）
  const markdownTasks = docFiles.map((filePath) => async () => {
    try {
      const result = await extractWithCache(filePath, outputDir, projectRoot, 'document');
      if (result.nodes.length > 0 || result.edges.length > 0) {
        allResults.push(result);
      }
    } catch (err) {
      logger.warn(`Markdown 提取失败: ${filePath} — ${String(err)}`);
    }
  });

  // FR-016：并发上限 5
  await concurrentPool(markdownTasks, 5);

  // 图像文件（Vision API）
  const imageTasks = imageFiles.map((filePath) => async () => {
    try {
      const result = await extractWithCache(filePath, outputDir, projectRoot, 'image');
      if (result.nodes.length > 0 || result.edges.length > 0) {
        allResults.push(result);
      }
    } catch (err) {
      logger.warn(`图像提取失败: ${filePath} — ${String(err)}`);
    }
  });

  await concurrentPool(imageTasks, 3);

  return allResults;
}
