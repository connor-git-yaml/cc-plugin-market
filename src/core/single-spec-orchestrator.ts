/**
 * 单模块 Spec 生成编排器
 * /reverse-spec 命令入口 — 串联三阶段流水线
 * 参见 contracts/core-pipeline.md
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { CodeSkeleton } from '../models/code-skeleton.js';
import type { ModuleSpec, SpecSections, StageProgressCallback } from '../models/module-spec.js';
import { scanFiles } from '../utils/file-scanner.js';
import { analyzeFile, analyzeFiles } from './ast-analyzer.js';
import { redact } from './secret-redactor.js';
import { assembleContext, type AssembledContext } from './context-assembler.js';
import { callLLM, parseLLMResponse, buildSystemPrompt, type LLMResponse, type RetryCallback, LLMUnavailableError } from './llm-client.js';
import { generateFrontmatter } from '../generator/frontmatter.js';
import { renderSpec, initRenderer } from '../generator/spec-renderer.js';
import { generateClassDiagram } from '../generator/mermaid-class-diagram.js';
import { generateDependencyDiagram } from '../generator/mermaid-dependency-graph.js';
import { splitIntoChunks, CHUNK_THRESHOLD } from '../utils/chunk-splitter.js';

// ============================================================
// 类型定义
// ============================================================

export interface GenerateSpecOptions {
  /** 在上下文组装中包含函数体（默认 false） */
  deep?: boolean;
  /** 输出目录（默认 'specs/'） */
  outputDir?: string;
  /** 已有版本号（用于增量更新） */
  existingVersion?: string;
  /** 项目根目录（用于文件扫描） */
  projectRoot?: string;
  /** 阶段进度回调（可选） */
  onStageProgress?: StageProgressCallback;
}

export interface GenerateSpecResult {
  /** 写入的 spec 文件路径 */
  specPath: string;
  /** 提取的骨架 */
  skeleton: CodeSkeleton;
  /** LLM token 消耗 */
  tokenUsage: number;
  /** 置信度等级 */
  confidence: 'high' | 'medium' | 'low';
  /** 非致命警告 */
  warnings: string[];
  /** 完整的 ModuleSpec 对象（用于索引生成） */
  moduleSpec: ModuleSpec;
}

/** prepare 子命令的返回结果（阶段 1-2，不含 LLM 调用） */
export interface PrepareResult {
  /** 各文件的 CodeSkeleton */
  skeletons: CodeSkeleton[];
  /** 合并后的代表性骨架 */
  mergedSkeleton: CodeSkeleton;
  /** 组装后的 LLM 上下文 */
  context: AssembledContext;
  /** 脱敏后的代码片段（仅 deep 模式） */
  codeSnippets: string[];
  /** 扫描到的文件路径 */
  filePaths: string[];
}

// ============================================================
// 置信度计算
// ============================================================

/**
 * 根据流水线执行结果计算置信度
 */
function calculateConfidence(
  skeletons: CodeSkeleton[],
  uncertaintyCount: number,
  contextTruncated: boolean,
  llmDegraded: boolean,
): 'high' | 'medium' | 'low' {
  const totalFiles = skeletons.length;
  const filesWithErrors = skeletons.filter(
    (s) => s.parseErrors && s.parseErrors.length > 0,
  ).length;
  const errorRatio = totalFiles > 0 ? filesWithErrors / totalFiles : 0;

  // LOW: >30% 文件有解析错误，或标记数 >3，或 LLM 降级
  if (errorRatio > 0.3 || uncertaintyCount > 3 || llmDegraded) {
    return 'low';
  }

  // MEDIUM: 有解析错误、标记数 >0 但 ≤3、或上下文被截断
  if (filesWithErrors > 0 || uncertaintyCount > 0 || contextTruncated) {
    return 'medium';
  }

  // HIGH: 零错误、零标记、LLM 正常返回
  return 'high';
}

/**
 * 将多个 CodeSkeleton 合并为一个代表性骨架
 */
function mergeSkeletons(skeletons: CodeSkeleton[]): CodeSkeleton {
  if (skeletons.length === 1) return skeletons[0]!;

  // 合并所有导出和导入
  const allExports = skeletons.flatMap((s) => s.exports);
  const allImports = skeletons.flatMap((s) => s.imports);
  const allErrors = skeletons.flatMap((s) => s.parseErrors ?? []);
  const totalLoc = skeletons.reduce((sum, s) => sum + s.loc, 0);

  // 使用第一个文件的路径（或目录名）
  const filePath = skeletons[0]!.filePath;

  // 计算合并哈希
  const combinedContent = skeletons.map((s) => s.hash).join('');
  const hash = createHash('sha256').update(combinedContent).digest('hex');

  return {
    filePath,
    language: skeletons[0]!.language,
    loc: totalLoc,
    exports: allExports,
    imports: allImports,
    parseErrors: allErrors.length > 0 ? allErrors : undefined,
    hash,
    analyzedAt: new Date().toISOString(),
    parserUsed: skeletons[0]!.parserUsed,
  };
}

// ============================================================
// 核心 API
// ============================================================

/**
 * 预处理 + 上下文组装（阶段 1-2）
 * 不调用 LLM，不需要 API key。
 * 供 prepare 子命令和 generateSpec 共用。
 *
 * @param targetPath - 待分析的目录或文件路径
 * @param options - 生成选项
 * @returns 预处理结果
 */
export async function prepareContext(
  targetPath: string,
  options: GenerateSpecOptions = {},
): Promise<PrepareResult> {
  const { deep = false, projectRoot, onStageProgress } = options;

  // --- 阶段 1：预处理 ---

  // 步骤 1：扫描文件
  const resolvedTarget = path.resolve(targetPath);
  let filePaths: string[];

  const stat = fs.statSync(resolvedTarget);
  if (stat.isFile()) {
    filePaths = [resolvedTarget];
  } else {
    // 单文件时跳过 scan 阶段的独立进度行
    const scanStart = Date.now();
    onStageProgress?.({ stage: 'scan', message: '文件扫描中...' });

    const scanResult = scanFiles(resolvedTarget, { projectRoot });
    filePaths = scanResult.files.map((f) => path.join(resolvedTarget, f));
    if (filePaths.length === 0) {
      throw new Error(`目标路径中未找到 TS/JS 文件: ${targetPath}`);
    }

    onStageProgress?.({ stage: 'scan', message: '文件扫描完成', duration: Date.now() - scanStart });
  }

  // 步骤 2：AST 分析
  const astStart = Date.now();
  onStageProgress?.({ stage: 'ast', message: `AST 分析中 (${filePaths.length} 个文件)...` });

  const skeletons = await analyzeFiles(filePaths);

  onStageProgress?.({ stage: 'ast', message: 'AST 分析完成', duration: Date.now() - astStart });

  // 合并为代表性骨架
  const mergedSkeleton = mergeSkeletons(skeletons);

  // 步骤 3：脱敏
  const codeSnippets: string[] = [];
  if (deep) {
    for (const filePath of filePaths) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      if (lines.length > CHUNK_THRESHOLD) {
        const chunks = splitIntoChunks(content);
        for (const chunk of chunks) {
          const { redactedContent } = redact(chunk.content, filePath);
          codeSnippets.push(redactedContent);
        }
      } else {
        const { redactedContent } = redact(content, filePath);
        codeSnippets.push(redactedContent);
      }
    }
  }

  // --- 阶段 2：上下文组装 ---

  const contextStart = Date.now();
  onStageProgress?.({ stage: 'context', message: '上下文组装中...' });

  const systemPrompt = buildSystemPrompt('spec-generation');
  const context: AssembledContext = await assembleContext(mergedSkeleton, {
    codeSnippets,
    templateInstructions: systemPrompt,
  });

  // token 数警告（FR-007：当 token 超过 80,000——即 100,000 预算的 80%）
  if (context.tokenCount > 80_000) {
    onStageProgress?.({ stage: 'context', message: `⚠ 上下文 token 数较大 (${context.tokenCount.toLocaleString()})，可能影响质量` });
  }

  onStageProgress?.({ stage: 'context', message: '上下文组装完成', duration: Date.now() - contextStart });

  return { skeletons, mergedSkeleton, context, codeSnippets, filePaths };
}

/**
 * 单模块 Spec 生成端到端编排
 *
 * 流水线步骤：
 * 1-4. prepareContext()（预处理 + 上下文组装）
 * 5. 调用 Claude API
 * 6. 解析 + 验证 LLM 响应
 * 7. 注入不确定性标记
 * 8. Handlebars 渲染 → specs/*.spec.md
 * 9. 基线骨架序列化
 *
 * @param targetPath - 待分析的目录或文件路径
 * @param options - 生成选项
 * @returns 生成结果
 */
export async function generateSpec(
  targetPath: string,
  options: GenerateSpecOptions = {},
): Promise<GenerateSpecResult> {
  const { outputDir = 'specs', existingVersion, onStageProgress } = options;
  const warnings: string[] = [];
  let tokenUsage = 0;
  let llmDegraded = false;

  // 阶段 1-2：预处理 + 上下文组装
  const { skeletons, mergedSkeleton, context, filePaths } = await prepareContext(targetPath, options);

  // --- 阶段 3：生成增强 ---

  // 步骤 5：调用 LLM
  const llmStart = Date.now();
  onStageProgress?.({ stage: 'llm', message: 'LLM 调用中...' });

  // 将 onRetry 回调转换为阶段进度格式
  const onRetry: RetryCallback | undefined = onStageProgress
    ? (event) => {
        const typeLabel = event.errorType === 'timeout' ? '超时'
          : event.errorType === 'rate-limit' ? '速率限制'
          : '服务器错误';
        onStageProgress({ stage: 'llm', message: `↻ 重试 ${event.attempt}/${event.maxAttempts} (${typeLabel})...` });
      }
    : undefined;

  let llmContent: string;
  try {
    const llmResponse: LLMResponse = await callLLM(context, undefined, onRetry);
    llmContent = llmResponse.content;
    tokenUsage = llmResponse.inputTokens + llmResponse.outputTokens;
  } catch (error) {
    if (error instanceof LLMUnavailableError) {
      // LLM 不可用，降级为 AST-only 输出
      llmDegraded = true;
      warnings.push('LLM 不可用，已降级为 AST-only Spec');
      onStageProgress?.({ stage: 'llm', message: '⚠ LLM 不可用，降级为 AST-only' });
      llmContent = generateAstOnlyContent(mergedSkeleton);
    } else {
      throw error;
    }
  }

  onStageProgress?.({ stage: 'llm', message: 'LLM 调用完成', duration: Date.now() - llmStart });

  // 步骤 6：解析 LLM 响应
  const parseStart = Date.now();
  onStageProgress?.({ stage: 'parse', message: '响应解析中...' });

  const parsed = parseLLMResponse(llmContent);
  warnings.push(...parsed.parseWarnings);

  onStageProgress?.({ stage: 'parse', message: '响应解析完成', duration: Date.now() - parseStart });

  // 步骤 7：不确定性标记已在 parseLLMResponse 中提取
  const uncertaintyCount = parsed.uncertaintyMarkers.length;

  // 计算置信度
  const confidence = calculateConfidence(
    skeletons,
    uncertaintyCount,
    context.truncated,
    llmDegraded,
  );

  // 步骤 8：渲染 Spec
  const renderStart = Date.now();
  onStageProgress?.({ stage: 'render', message: '渲染写入中...' });

  initRenderer();

  // 生成 Mermaid 图表（类图 + 依赖图）
  const classDiagram = generateClassDiagram(mergedSkeleton);
  const depDiagram = generateDependencyDiagram(mergedSkeleton, skeletons);

  // 生成 frontmatter
  const frontmatter = generateFrontmatter({
    sourceTarget: targetPath,
    relatedFiles: filePaths.map((f) => path.relative(process.cwd(), f)),
    confidence,
    skeletonHash: mergedSkeleton.hash,
    existingVersion,
  });

  // 构建 fileInventory（使用相对路径）
  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const fileInventory = skeletons.map((s) => ({
    path: path.relative(baseDir, s.filePath),
    loc: s.loc,
    purpose: s.exports.length > 0
      ? `导出 ${s.exports.map((e) => e.name).join(', ')}`
      : '内部模块',
  }));

  // 构建 ModuleSpec
  const specName = path.basename(targetPath).replace(/\.[^.]+$/, '');
  const outputPath = path.join(outputDir, `${specName}.spec.md`);

  // 收集所有 Mermaid 图表
  const diagrams: Array<{ type: 'classDiagram' | 'flowchart' | 'graph'; source: string; title: string }> = [];
  if (classDiagram) {
    diagrams.push({ type: 'classDiagram', source: classDiagram, title: '模块类图' });
  }
  if (depDiagram) {
    diagrams.push({ type: 'graph', source: depDiagram, title: '依赖关系图' });
  }

  const moduleSpec: ModuleSpec = {
    frontmatter,
    sections: parsed.sections,
    mermaidDiagrams: diagrams.length > 0 ? diagrams : undefined,
    fileInventory,
    baselineSkeleton: mergedSkeleton,
    outputPath,
  };

  const markdown = renderSpec(moduleSpec);

  // 步骤 9：写入文件
  const resolvedOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, markdown, 'utf-8');

  onStageProgress?.({ stage: 'render', message: '渲染写入完成', duration: Date.now() - renderStart });

  return {
    specPath: outputPath,
    skeleton: mergedSkeleton,
    tokenUsage,
    confidence,
    warnings,
    moduleSpec,
  };
}

/**
 * LLM 不可用时的 AST-only 降级内容生成
 */
function generateAstOnlyContent(skeleton: CodeSkeleton): string {
  const sections: string[] = [];

  sections.push('## 1. 意图');
  sections.push(`[推断: LLM 不可用] 本模块位于 ${skeleton.filePath}，包含 ${skeleton.exports.length} 个导出符号。`);

  sections.push('## 2. 接口定义');
  if (skeleton.exports.length > 0) {
    for (const exp of skeleton.exports) {
      sections.push(`- \`${exp.signature}\``);
    }
  } else {
    sections.push('无导出符号。');
  }

  sections.push('## 3. 业务逻辑');
  sections.push('[推断: LLM 不可用] 无法分析业务逻辑。');

  sections.push('## 4. 数据结构');
  const typeExports = skeleton.exports.filter(
    (e) => e.kind === 'type' || e.kind === 'interface' || e.kind === 'enum',
  );
  if (typeExports.length > 0) {
    for (const exp of typeExports) {
      sections.push(`- \`${exp.signature}\``);
    }
  } else {
    sections.push('无数据结构导出。');
  }

  sections.push('## 5. 约束条件');
  sections.push('[推断: LLM 不可用] 无法分析约束条件。');

  sections.push('## 6. 边界条件');
  sections.push('[推断: LLM 不可用] 无法分析边界条件。');

  sections.push('## 7. 技术债务');
  sections.push('[推断: LLM 不可用] 无法分析技术债务。');

  sections.push('## 8. 测试覆盖');
  sections.push('[推断: LLM 不可用] 无法分析测试覆盖。');

  sections.push('## 9. 依赖关系');
  if (skeleton.imports.length > 0) {
    for (const imp of skeleton.imports) {
      sections.push(`- \`${imp.moduleSpecifier}\``);
    }
  } else {
    sections.push('无导入依赖。');
  }

  return sections.join('\n\n');
}
