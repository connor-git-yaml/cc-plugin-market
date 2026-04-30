/**
 * 多模态提取管道（Feature 107 + Feature 140 T21）
 * 协调三路提取器（Markdown、OpenAPI、图像），集成缓存，控制并发
 *
 * 行为契约（extraction-pipeline.contract.md）：
 * - includeDocs=false && includeImages=false 时立即返回空 output
 * - 所有提取失败时返回空 output，不抛出异常
 * - 返回的 ExtractionResult[] 已通过 Zod schema 验证
 * - Markdown LLM 并发上限 5，单次超时 8 秒（FR-016）
 * - 图片数量 > 50 输出警告（FR-017）
 *
 * **Feature 140 FR-010 行为变更**：返回类型从 `ExtractionResult[]` 改为 `ExtractionPipelineOutput`
 * 包装对象，新增 `readmeContent?: string` 字段：当 `includeDocs=true` 且 projectRoot 下存在
 * `README.md`（不区分大小写：README.md / readme.md / Readme.md）时，读取其全量内容（不截断）
 * 放入 `readmeContent`，供下游 architecture-narrative / hyperedge 等 pipeline 作为 shared
 * header 注入（架构 §三 ADR shared header / §四 Narrative Phase B）。
 *
 * 与原有 ExtractionResult[] 的关系：README.md 仍会被走 Markdown LLM 提取通道（产生 nodes/edges
 * 进入 results 数组），同时其 raw 内容也独立放入 readmeContent；二者并存不冲突，但下游使用
 * readmeContent 比拼 nodes 更直接（保留原始语境）。
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

/**
 * Feature 140 FR-010 — 提取管道输出。
 *
 * - `results`: 既有 ExtractionResult[]（每个文件一个 ExtractionResult，含 nodes/edges）
 * - `readmeContent`: 仅 includeDocs=true 时，projectRoot 下的 README 全量内容（不截断）；
 *   未启用或不存在时为 undefined。下游 narrative / hyperedge 用作 shared header 注入。
 */
export interface ExtractionPipelineOutput {
  results: ExtractionResult[];
  readmeContent?: string;
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
 * 在 projectRoot 下定位 README 文件（不区分大小写）。
 * 优先级：README.md > readme.md > Readme.md > 其他大小写组合（按目录条目自然顺序）。
 * 找不到时返回 undefined。
 *
 * **导出原因**：batch-orchestrator 在 generateBatchProjectDocs 之前需要早期 README 读取
 * （narrative 在 docs 阶段生成，早于 extraction-pipeline）；共享同一个 findReadmePath
 * 助手避免两处大小写匹配候选列表漂移（修复 Codex review CRITICAL 2）。
 *
 * @param projectRoot - 项目根目录绝对路径
 * @returns README 文件绝对路径；找不到返回 undefined
 */
export function findReadmePath(projectRoot: string): string | undefined {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  // 优先匹配规范命名 README.md，否则任何大小写
  const candidates = entries.filter(
    (e) => e.isFile() && /^readme\.md$/i.test(e.name),
  );
  if (candidates.length === 0) return undefined;
  // 优先返回 'README.md' 本身（spec 锁定首选规范名）
  const canonical = candidates.find((e) => e.name === 'README.md');
  return path.join(projectRoot, (canonical ?? candidates[0]!).name);
}

/**
 * 运行多模态提取管道
 *
 * @param options - 管道选项
 * @returns ExtractionPipelineOutput — { results, readmeContent? }；不抛出异常
 */
export async function runExtractionPipeline(
  options: ExtractionPipelineOptions,
): Promise<ExtractionPipelineOutput> {
  const { projectRoot, outputDir, includeDocs, includeImages } = options;

  // 快速返回：两个标志均未启用
  if (!includeDocs && !includeImages) {
    return { results: [] };
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

  // Feature 140 FR-010：includeDocs=true 时单独读取 README 全量内容（不走 LLM 提取链路）
  // 不截断（移除 v4.0.x 时代的 5k token 限制）；读取失败 → undefined（下游不阻断）。
  // 注意：README 仍会被上方 markdown LLM 提取链路处理（产生 nodes/edges 进入 results），
  // 此处的 readmeContent 是 raw 内容并存，供 narrative / hyperedge 等下游 pipeline 直接消费。
  let readmeContent: string | undefined;
  if (includeDocs) {
    const readmePath = findReadmePath(projectRoot);
    if (readmePath) {
      try {
        readmeContent = fs.readFileSync(readmePath, 'utf-8');
      } catch (err) {
        logger.warn(`README 读取失败（不阻断主流程）: ${path.relative(projectRoot, readmePath)} — ${String(err)}`);
      }
    }
  }

  return { results: allResults, readmeContent };
}
