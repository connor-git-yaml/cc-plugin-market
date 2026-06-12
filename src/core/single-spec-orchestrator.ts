/**
 * 单模块 Spec 生成编排器
 * /spectra 命令入口 — 串联三阶段流水线
 * 参见 contracts/core-pipeline.md
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { CodeSkeleton } from '../models/code-skeleton.js';
import type { CodeSlice } from '../models/code-skeleton.js';
import type { CostMetadata, ModuleSpec, SpecSections, StageProgressCallback } from '../models/module-spec.js';
import { scanFiles } from '../utils/file-scanner.js';
import { analyzeFile, analyzeFiles } from './ast-analyzer.js';
import { redact } from './secret-redactor.js';
import { assembleContext, type AssembledContext } from './context-assembler.js';
import { estimateFast } from './token-counter.js';
import { callLLM, parseLLMResponse, type LLMResponse, type RetryCallback, LLMUnavailableError } from './llm-client.js';
import { combineSkeletonHashes, type SkeletonHashEntry } from './skeleton-hash.js';
import { extractCodeSlices } from './code-slice-extractor.js';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';
import { generateFrontmatter } from '../generator/frontmatter.js';
import { renderSpec, initRenderer } from '../generator/spec-renderer.js';
import { generateClassDiagram } from '../generator/mermaid-class-diagram.js';
import { generateDependencyDiagram } from '../generator/mermaid-dependency-graph.js';
import { splitIntoChunks, CHUNK_THRESHOLD } from '../utils/chunk-splitter.js';

// ============================================================
// AST 渲染规模上限（Feature 148）
// ============================================================

/**
 * 接口定义章节：详细展开的文件数上限。
 * 超过该数量后，仅展开导出最多的 Top-K 文件，剩余折叠为汇总表。
 * 取值依据：以 spec.md ≤ 1500 行总预算为目标，AST 两章节合计 ≤ 800 行。
 * 大模块（如 panoramic 130 文件）触发折叠；中型模块（如 batch 12 文件）也会折叠后 6 个，避免 1500-2000 行级别 outlier。
 */
const FILE_DETAIL_LIMIT = 6;

/**
 * 数据结构章节：详细展开的数据类型数上限。
 * 超过该数量后，仅展开成员最多的 Top-K 数据结构，剩余折叠为汇总表。
 */
const DATA_DETAIL_LIMIT = 10;

/**
 * 单个 class/interface 内每张子表的成员数上限（独立应用于字段表 / 方法表 / 枚举值表）。
 * 超过该数量后，仅展示前 N 个，剩余以省略提示替代，防止 god class 把 spec 撑爆。
 * 注意：数据结构章节中字段表与方法表分开应用，单个 class 极端情况下可输出 2N 行成员。
 */
const MEMBER_DETAIL_LIMIT = 10;

/**
 * 接口定义章节：详细展开文件内的导出数上限。
 * 单文件含数十个导出时（如 panoramic 的 model 聚合文件），仅显示前 N 个表格行，剩余以省略提示替代。
 */
const EXPORTS_PER_FILE_LIMIT = 12;

/**
 * 折叠汇总表的最大行数。
 * 超大模块（如 panoramic 130 文件 / 400 数据结构）即使折叠也会撑出数百行表格；
 * 加 row limit 后保证 spec.md 总体可控，剩余条目只在 spectra prepare 中可发现。
 */
const FOLDED_TABLE_ROW_LIMIT = 30;

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
  /** 跳过 Section 2 二次增强（小模块优化，减少 LLM 调用次数） */
  skipEnrichment?: boolean;
  /** 覆盖 LLM 模型（batch 中小模块可降级为 Sonnet） */
  modelOverride?: string;
  /**
   * 生成本 spec 的批处理模式（Bug 142）。
   * batch 流程传入 effectiveMode 后，会写入 frontmatter 的 generatedByMode 字段，
   * 用于后续 mode-aware 增量缓存判定；单文件 generate 不传，frontmatter 中不写入该字段。
   */
  generatedByMode?: 'full' | 'reading' | 'code-only';
  /**
   * 显式注入的待分析文件列表（绝对路径）（Feature 182）。
   * batch 路径传入 group.files（语言限定子集），替代 prepareContext 内的目录重扫，
   * 既消除写读两侧文件集来源分叉（混语言 cache miss 根因），又避免混语言目录双倍分析。
   * 不传时（如 CLI 单文件 generate）维持原有 scanFiles 行为（向后兼容）。
   */
  files?: string[];
  /**
   * 显式输出文件名（含 .spec.md 后缀的纯文件名，不含目录）（Feature 182 修复 1）。
   * batch 的 languageSplit 组传入 `${moduleName}.spec.md`（如 utils--ts-js.spec.md），
   * 避免同目录多语言组都按 basename(targetPath) 派生为同名 `<dir>.spec.md` 互相覆盖。
   * 不传时维持 basename 派生（零行为变化）。
   */
  outputFileName?: string;
  /**
   * 持久化到 frontmatter 的增量缓存 key（Feature 182 修复 2）。
   * batch 的 languageSplit 组传入 moduleCacheKey（`${sourceTarget}::${language}`），
   * 在首次写盘时即写入 frontmatter.sourceTargetKey，消除「post-mutation 依赖 doc-graph
   * re-render 落盘晚于 checkpoint save」的崩溃窗口。不传时 frontmatter 不含该字段。
   */
  sourceTargetKey?: string;
}

export interface GenerateSpecResult {
  /** 写入的 spec 文件路径 */
  specPath: string;
  /** 提取的骨架 */
  skeleton: CodeSkeleton;
  /** LLM token 消耗（input + output 总和，向后兼容保留） */
  tokenUsage: number;
  /** 置信度等级 */
  confidence: 'high' | 'medium' | 'low';
  /** 非致命警告 */
  warnings: string[];
  /** 完整的 ModuleSpec 对象（用于索引生成） */
  moduleSpec: ModuleSpec;
  /** 成本元数据（Feature 127，可选以兼容历史 mock） */
  costMetadata?: CostMetadata;
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
  /** 提取的代码切片（控制流骨架，FR-001） */
  codeSlices: CodeSlice[];
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

  if (options.files) {
    // Feature 182：batch 路径注入语言限定文件子集，跳过目录重扫。
    // 注入文件统一归一化为绝对路径，保证 AST 分析与 hash 口径与目录扫描路径一致。
    filePaths = options.files.map((f) => path.resolve(f));
    if (filePaths.length === 0) {
      throw new Error(`注入的文件列表为空: ${targetPath}`);
    }
  } else {
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
        throw new Error(`目标路径中未找到支持的源文件: ${targetPath}`);
      }

      onStageProgress?.({ stage: 'scan', message: '文件扫描完成', duration: Date.now() - scanStart });
    }
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

  // 步骤 2.5：提取代码切片（控制流骨架，FR-001）
  // 降级保护：extractCodeSlices 内部有 try/catch，失败时返回空数组
  let codeSlices: CodeSlice[] = [];
  try {
    codeSlices = extractCodeSlices(skeletons, undefined, {
      maxTokens: 200_000,
    });
    if (codeSlices.length > 0) {
      onStageProgress?.({ stage: 'context', message: `代码切片提取完成（${codeSlices.length} 个函数，~${codeSlices.reduce((s, c) => s + c.estimatedTokens, 0).toLocaleString()} tokens）` });
    }
  } catch (err) {
    // FR-011：降级保护，切片提取失败不影响主流程
    onStageProgress?.({ stage: 'context', message: `⚠ 代码切片提取失败，已降级（${err instanceof Error ? err.message : String(err)}）` });
    codeSlices = [];
  }

  // 步骤 2.6：读取 README.md（FR-007）
  const README_MAX_CHARS = 6000;
  let readmeContext: string | undefined;
  const targetDir = fs.statSync(path.resolve(targetPath)).isDirectory()
    ? path.resolve(targetPath)
    : path.dirname(path.resolve(targetPath));
  const projectRootDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  for (const readmeDir of [targetDir, projectRootDir]) {
    const readmePath = path.join(readmeDir, 'README.md');
    if (fs.existsSync(readmePath)) {
      try {
        const readmeContent = fs.readFileSync(readmePath, 'utf-8');
        readmeContext = readmeContent.slice(0, README_MAX_CHARS);
        if (readmeContent.length > README_MAX_CHARS) {
          readmeContext += '\n\n...(README 内容已截断)';
        }
        break;
      } catch {
        // 读取失败时跳过（降级保护）
      }
    }
  }

  // 步骤 2.7：扫描 Markdown 知识文件（FR-009）
  const KNOWLEDGE_MAX_CHARS = 8000;
  let knowledgeFiles: string | undefined;
  try {
    const knowledgePatterns = ['SKILL.md', 'AGENTS.md', 'CLAUDE.md'];
    const knowledgeDirs = ['skills', 'commands', 'agents'];
    const knowledgeParts: string[] = [];
    let knowledgeChars = 0;

    // 扫描根目录的知识文件
    for (const pattern of knowledgePatterns) {
      const filePath = path.join(projectRootDir, pattern);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const snippet = content.slice(0, 2000);
          knowledgeParts.push(`### ${pattern}\n\n${snippet}${content.length > 2000 ? '\n...(已截断)' : ''}`);
          knowledgeChars += snippet.length;
        } catch { /* 跳过 */ }
      }
    }

    // 扫描 skills/、commands/、agents/ 目录下的 .md 文件
    for (const dir of knowledgeDirs) {
      const dirPath = path.join(projectRootDir, dir);
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        try {
          const entries = fs.readdirSync(dirPath);
          for (const entry of entries) {
            if (knowledgeChars >= KNOWLEDGE_MAX_CHARS) break;
            const fullPath = path.join(dirPath, entry);
            // 支持 skills/wiki/SKILL.md 嵌套结构
            const mdPath = fs.statSync(fullPath).isDirectory()
              ? path.join(fullPath, 'SKILL.md')
              : (entry.endsWith('.md') ? fullPath : null);
            if (mdPath && fs.existsSync(mdPath)) {
              try {
                const content = fs.readFileSync(mdPath, 'utf-8');
                const maxChunk = Math.min(1500, KNOWLEDGE_MAX_CHARS - knowledgeChars);
                if (maxChunk <= 0) break;
                const snippet = content.slice(0, maxChunk);
                knowledgeParts.push(`### ${path.relative(projectRootDir, mdPath)}\n\n${snippet}${content.length > maxChunk ? '\n...(已截断)' : ''}`);
                knowledgeChars += snippet.length;
              } catch { /* 跳过 */ }
            }
          }
        } catch { /* 跳过 */ }
      }
    }

    if (knowledgeParts.length > 0) {
      knowledgeFiles = knowledgeParts.join('\n\n---\n\n');
      onStageProgress?.({ stage: 'context', message: `知识文件发现 ${knowledgeParts.length} 个` });
    }
  } catch {
    // FR-011：知识文件扫描失败不影响主流程
  }

  // 步骤 2.8：构建调用方上下文（FR-008）
  let callerContext: string | undefined;
  try {
    // 从 skeleton 的 imports 反向推断：哪些模块的 exports 被当前模块引用
    const callerModules = mergedSkeleton.imports
      .filter(imp => imp.isRelative)
      .map(imp => imp.moduleSpecifier)
      .slice(0, 10);
    if (callerModules.length > 0) {
      callerContext = `当前模块依赖以下 ${callerModules.length} 个内部模块：\n${callerModules.map(m => `- \`${m}\``).join('\n')}\n\n请基于这些依赖关系理解本模块在架构中的定位。`;
    }
  } catch {
    // 降级保护
  }

  // 步骤 2.9：扫描测试文件，注入测试覆盖上下文（FR-008 测试文件感知）
  let testContext: string | undefined;
  try {
    const testInfo = scanTestFiles(projectRootDir);
    if (testInfo) {
      testContext = `## 项目测试文件概览\n\n${testInfo}\n\n请在生成 Section 8（测试覆盖）时参考以上实际测试文件列表，列出已覆盖的功能模块，并指出尚未覆盖的关键路径。`;
      onStageProgress?.({ stage: 'context', message: `测试文件扫描完成` });
    }
  } catch {
    // FR-011：测试文件扫描失败不影响主流程
  }

  // 将测试上下文追加到 README 上下文中（避免增加新参数，复用 readmeContext 扩展）
  const combinedReadmeContext = [readmeContext, testContext].filter(Boolean).join('\n\n---\n\n') || undefined;

  const context: AssembledContext = await assembleContext(mergedSkeleton, {
    codeSnippets,
    codeSlices: codeSlices.length > 0 ? codeSlices : undefined,
    readmeContext: combinedReadmeContext,
    knowledgeFiles,
    callerContext,
  });

  // token 数警告（当 token 超过 400,000——即 500,000 预算的 80%）
  if (context.tokenCount > 400_000) {
    onStageProgress?.({ stage: 'context', message: `⚠ 上下文 token 数较大 (${context.tokenCount.toLocaleString()})，可能影响质量` });
  }

  onStageProgress?.({ stage: 'context', message: '上下文组装完成', duration: Date.now() - contextStart });

  return { skeletons, mergedSkeleton, context, codeSnippets, filePaths, codeSlices };
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

  // Feature 127：成本元数据采集
  let costInputTokens = 0;
  let costOutputTokens = 0;
  let costDurationMs = 0;
  let costLlmModel = '';
  let costFallbackReason: string | null = null;

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

  // 从 Registry 获取目标语言的术语映射
  const adapter = LanguageAdapterRegistry.getInstance().getAdapter(mergedSkeleton.filePath);
  const languageTerminology = adapter?.getTerminology();

  let llmContent: string;
  try {
    const llmResponse: LLMResponse = await callLLM(
      context,
      { languageTerminology, ...(options.modelOverride ? { model: options.modelOverride } : {}) },
      onRetry,
    );
    llmContent = llmResponse.content;
    tokenUsage = llmResponse.inputTokens + llmResponse.outputTokens;
    // Feature 127：记录 LLM#1 成本
    costInputTokens += llmResponse.inputTokens;
    costOutputTokens += llmResponse.outputTokens;
    costDurationMs += llmResponse.duration;
    costLlmModel = llmResponse.model;
  } catch (error) {
    if (error instanceof LLMUnavailableError) {
      // LLM 不可用，降级为 AST-only 输出
      llmDegraded = true;
      warnings.push('LLM 不可用，已降级为 AST-only Spec');
      costFallbackReason = 'LLM 不可用';
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

  // 步骤 7.5：混合渲染策略（FR-007）
  // 叙述优先：LLM 的文字描述放前面（对人友好），AST 精确表格放后面（作参考）
  // LLM 优先的章节（意图、业务逻辑、约束、边界、技术债务、测试覆盖、依赖关系）保持 LLM 为主
  const astInterfaceDef = generateAstInterfaceDefinition(skeletons);
  const astDataStructures = generateAstDataStructures(skeletons);

  const sections = { ...parsed.sections };

  // 接口定义（Section 3）：LLM 叙述在前 + AST 精确参考表在后
  {
    const llmInterface = sections.interfaceDefinition?.trim();
    const hasAst = astInterfaceDef && astInterfaceDef !== '本模块无公共导出。';

    if (llmInterface && hasAst) {
      // 最佳情况：LLM 叙述 + AST 参考表
      sections.interfaceDefinition = llmInterface + '\n\n---\n\n### 完整接口参考（AST 精确提取）\n\n' + astInterfaceDef;
    } else if (hasAst) {
      // LLM 无内容：仅 AST 表格
      sections.interfaceDefinition = astInterfaceDef;
    } else if (!llmInterface) {
      sections.interfaceDefinition = '本模块无公共导出。';
    }
  }

  // 数据结构（Section 4）：LLM 叙述在前 + AST 字段表在后
  {
    const llmDataStructures = sections.dataStructures?.trim();
    const hasAst = !!astDataStructures;

    if (llmDataStructures && hasAst) {
      sections.dataStructures = llmDataStructures + '\n\n---\n\n### 完整字段定义（AST 精确提取）\n\n' + astDataStructures;
    } else if (hasAst) {
      sections.dataStructures = astDataStructures;
    }
    // 若 AST 无数据结构，保留 LLM 内容不变
  }

  // 步骤 7.6：Section 2（业务逻辑）二次生成 — 用完整上下文重新生成更详细的版本
  // 策略：先完成其他 Section 的分析积累上下文，再用所有已有内容重新生成 Section 2
  // skipEnrichment: batch 中小模块可跳过此步骤以减少 LLM 调用
  if (!llmDegraded && sections.businessLogic && !options.skipEnrichment) {
    try {
      // 构建包含 Section 3-9 的富上下文摘要
      const otherSectionsContext = [
        sections.interfaceDefinition ? `## 已分析的接口定义摘要\n${sections.interfaceDefinition.slice(0, 3000)}` : '',
        sections.dataStructures ? `## 已分析的数据结构摘要\n${sections.dataStructures.slice(0, 2000)}` : '',
        sections.constraints ? `## 已分析的约束条件\n${sections.constraints}` : '',
        sections.edgeCases ? `## 已分析的边界条件\n${sections.edgeCases}` : '',
      ].filter(Boolean).join('\n\n---\n\n');

      // 仅当上下文足够丰富时才执行二次生成（避免空上下文浪费 LLM 调用）
      if (otherSectionsContext.length > 500) {
        const enrichStart = Date.now();
        onStageProgress?.({ stage: 'enrich', message: '二次生成 Section 2（业务逻辑）...' });

        const enrichPrompt = `你是代码架构分析专家。请基于以下上下文为一个代码模块撰写**非常详细的**业务逻辑分析。

## 模块骨架信息

${context.prompt.slice(0, 8000)}

## 其他 Section 已分析的内容（作为参考，你可以引用其中的函数名和常量值）

${otherSectionsContext}

## 第一版业务逻辑（需要扩展和深化）

${sections.businessLogic}

## 任务

请重写上面的"第一版业务逻辑"，使其**大幅扩展**：

1. **必须覆盖所有处理阶段**（不要只深入一个阶段而忽略其他阶段）
2. 每个阶段用 **加粗段落**（如 **阶段 N — 名称**）作为视觉分隔，后跟 3-5 行描述
3. 每个阶段包含：关键函数名（引用接口定义中的函数，标注文件名）、输入→输出数据类型、核心算法 2-3 步、特殊处理
4. **必须**保留 Mermaid 流程图（flowchart TD，涵盖全部阶段）和时序图
5. 篇幅应为第一版的 **2-3 倍**，但重点是**广度**（全阶段覆盖），不是某一阶段的极致深度

只输出 Section 2 的内容，不要输出其他 Section。不要输出标题行"## 2. 业务逻辑"。用中文撰写，技术术语保持英文。`;

        try {
          const enrichResponse = await callLLM(
            { ...context, prompt: enrichPrompt, tokenCount: estimateFast(enrichPrompt) },
            { languageTerminology, ...(options.modelOverride ? { model: options.modelOverride } : {}) },
            onRetry,
          );
          // Feature 127（Codex review 修复）：enrichment 的 LLM 调用总是消耗 tokens，
          // 无论生成内容是否被最终采纳，都必须在所有口径（tokenUsage +
          // costMetadata）中记录，否则会系统性低报 LLM 花销。采纳与否只影响
          // section 内容替换，不改变已发生的真实成本。
          tokenUsage += enrichResponse.inputTokens + enrichResponse.outputTokens;
          costInputTokens += enrichResponse.inputTokens;
          costOutputTokens += enrichResponse.outputTokens;
          costDurationMs += enrichResponse.duration;

          const enrichedContent = enrichResponse.content.trim();
          // 仅当二次生成的内容比第一版长才替换（防止退化）
          if (enrichedContent.length > sections.businessLogic.length * 1.2) {
            sections.businessLogic = enrichedContent;
          }
          onStageProgress?.({ stage: 'enrich', message: 'enrich 完成', duration: Date.now() - enrichStart });
        } catch {
          // 二次生成失败时保留第一版，不影响主流程
          onStageProgress?.({ stage: 'enrich', message: '⚠ Section 2 二次生成失败，保留第一版', duration: Date.now() - enrichStart });
        }
      }
    } catch {
      // 降级保护
    }
  }

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

  // 统一基准路径（供 sourceTarget、relatedFiles、fileInventory、Mermaid、baseline 共用）
  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();

  // 将 skeleton 的 filePath 转换为相对路径（供 Mermaid 图和 baseline 使用）
  const relMerged = { ...mergedSkeleton, filePath: path.relative(baseDir, mergedSkeleton.filePath) };
  const relSkeletons = skeletons.map((s) => ({ ...s, filePath: path.relative(baseDir, s.filePath) }));

  // 生成 Mermaid 图表（类图 + 依赖图）
  const classDiagram = generateClassDiagram(relMerged);
  const depDiagram = generateDependencyDiagram(relMerged, relSkeletons);

  // 生成 displayName：从 targetPath 提取最后一级目录名作为人类可读标题
  const resolvedTarget = path.resolve(targetPath);
  const displayName = path.basename(resolvedTarget);

  // Feature 127：成本元数据（LLM#1 + enrichment 累加）
  const costMetadata: CostMetadata = {
    tokenUsage: { input: costInputTokens, output: costOutputTokens },
    durationMs: costDurationMs,
    llmModel: costLlmModel,
    fallbackReason: costFallbackReason,
  };

  // Feature 140 FR-012：从 AssembledContext 提取 token 来源细分
  // costBreakdown 仅在 LLM 实际调用过的路径写入（AST-only 降级时跳过，避免误导观测）；
  // 即便 LLM 失败但 context 已组装，contextTruncated 仍然如实反映本次 budget 决策。
  //
  // 类型契约：AssembledContext.tokenBreakdown 是必填字段（非 optional），
  // 测试 mock 必须按 TS 类型完整提供该字段；此处不再加 fallback，
  // 由 type system 在编译期捕获不合规 mock。
  const costBreakdown = llmDegraded
    ? undefined
    : {
        contextAssembly: context.tokenBreakdown.contextAssembly,
        promptTemplate: context.tokenBreakdown.promptTemplate,
        sourceFile: context.tokenBreakdown.sourceFile,
        llmReasoning: costOutputTokens,
      };

  // Feature 182：skeletonHash 改由唯一权威 combineSkeletonHashes 计算，
  // 复用已有 skeletons（不二次 analyzeFiles），sortKey = 项目相对 POSIX 路径，
  // 与读侧 delta-regenerator 的 computeModuleSkeletonHash 口径单点对齐。
  const skeletonHashEntries: SkeletonHashEntry[] = skeletons.map((skeleton) => ({
    sortKey: path.relative(baseDir, skeleton.filePath).split(path.sep).join('/'),
    hash: skeleton.hash,
  }));
  const skeletonHash = combineSkeletonHashes(skeletonHashEntries);

  // 生成 frontmatter
  const frontmatter = generateFrontmatter({
    sourceTarget: path.relative(baseDir, resolvedTarget),
    displayName,
    relatedFiles: filePaths.map((f) => path.relative(baseDir, f)),
    confidence,
    skeletonHash,
    existingVersion,
    // Feature 182 修复 2：languageSplit 组首写即落入 sourceTargetKey（消除崩溃窗口）；
    // 未传时 generateFrontmatter 不写该字段（单语言 / 单文件零行为变化）。
    ...(options.sourceTargetKey !== undefined
      ? { sourceTargetKey: options.sourceTargetKey }
      : {}),
    tokenUsage: costMetadata.tokenUsage,
    durationMs: costMetadata.durationMs,
    llmModel: costMetadata.llmModel,
    fallbackReason: costMetadata.fallbackReason,
    // Feature 133 P2-1：canonical spec 显式写入 sourceKind 字段，让用户在
    // 视觉/grep 扫描时一眼识别 spec 身份（不再依赖"无字段=canonical"的隐式默认）。
    // bundle_copy / derived 类型的 spec 由 spec-store / docs-bundle 等调用方
    // 在各自路径独立设置，不受此默认影响。
    sourceKind: 'canonical',
    // Bug 142：batch 流程传入 effectiveMode 时写入 generatedByMode；
    // 单文件 generate 不传，frontmatter 中省略该字段。
    ...(options.generatedByMode !== undefined
      ? { generatedByMode: options.generatedByMode }
      : {}),
    // Feature 140 FR-012：context 来源 input token 细分 + 是否被 budget 裁剪
    ...(costBreakdown !== undefined ? { costBreakdown } : {}),
    contextTruncated: context.truncated,
  });

  // 构建 fileInventory（使用短路径：基于 sourceTarget 公共前缀）
  const sourceTargetDir = path.dirname(path.relative(baseDir, resolvedTarget));
  const fileInventory = skeletons.map((s) => {
    const relPath = path.relative(baseDir, s.filePath);
    // shortPath：去掉与 sourceTarget 相同的前缀目录
    const shortPath = relPath.startsWith(sourceTargetDir + path.sep)
      ? relPath.slice(sourceTargetDir.length + 1)
      : path.basename(relPath);
    return {
      path: relPath,
      shortPath,
      loc: s.loc,
      purpose: s.exports.length > 0
        ? `导出 ${s.exports.map((e) => e.name).join(', ')}`
        : '内部模块',
    };
  });

  // 构建 ModuleSpec
  // Feature 182 修复 1：languageSplit 组显式传入 outputFileName（如 utils--ts-js.spec.md），
  // 避免同目录多语言组都按 basename(targetPath) 派生为同名 `<dir>.spec.md` 互相覆盖；
  // 未传时维持 basename 派生（per-file root 命名 + 单语言目录命名零变化）。
  const outputFileName =
    options.outputFileName ?? `${path.basename(targetPath).replace(/\.[^.]+$/, '')}.spec.md`;
  const outputPath = path.join(outputDir, outputFileName);

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
    // 使用混合渲染后的 sections（步骤 7.5 已将 AST 内容合并到 interfaceDefinition 和 dataStructures）
    sections,
    mermaidDiagrams: diagrams.length > 0 ? diagrams : undefined,
    fileInventory,
    baselineSkeleton: relMerged,
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
    costMetadata,
  };
}

// ============================================================
// AST 直出辅助函数（FR-001, FR-002, FR-003, FR-004）
// ============================================================

/**
 * 从多个 CodeSkeleton 的 exports 生成按源文件分组的接口定义表格（FR-001, FR-002）
 * 每组输出 `### <文件名>` 子标题 + Markdown 表格
 * 表格列：名称、类型(kind)、签名、成员数
 * 含 members 的类/接口展开为缩进子表格
 *
 * @param skeletons - 各文件的 CodeSkeleton 数组
 * @returns Markdown 格式的接口定义文本
 */
export function generateAstInterfaceDefinition(skeletons: CodeSkeleton[]): string {
  // 过滤掉没有任何导出的骨架
  const withExports = skeletons.filter((s) => s.exports.length > 0);

  if (withExports.length === 0) {
    return '本模块无公共导出。';
  }

  // Feature 148: 按导出数量倒序，文件名升序作 tiebreaker；保证大模块下渲染顺序稳定。
  // 用字典序比较（不调 localeCompare，避免依赖 ICU/locale 在不同 OS 漂移）。
  const sortedSkeletons = [...withExports].sort((a, b) => {
    const countDiff = b.exports.length - a.exports.length;
    if (countDiff !== 0) return countDiff;
    const nameA = path.basename(a.filePath);
    const nameB = path.basename(b.filePath);
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
  });

  const detailedSkeletons = sortedSkeletons.slice(0, FILE_DETAIL_LIMIT);
  const foldedSkeletons = sortedSkeletons.slice(FILE_DETAIL_LIMIT);

  const parts: string[] = [];

  for (const skeleton of detailedSkeletons) {
    const fileName = path.basename(skeleton.filePath);
    parts.push(`### ${fileName}`);
    parts.push('');
    parts.push('| 名称 | 类型 | 签名 | 成员数 |');
    parts.push('|------|------|------|--------|');

    // Feature 148: 单文件导出数过多时只显示前 N 个，避免聚合 model 文件爆炸。
    const shownExports = skeleton.exports.slice(0, EXPORTS_PER_FILE_LIMIT);
    for (const exp of shownExports) {
      // 处理签名中的竖线避免破坏表格
      const safeSig = exp.signature.replace(/\|/g, '\\|');
      const memberCount = exp.members ? exp.members.length : '-';
      parts.push(`| \`${exp.name}\` | ${exp.kind} | \`${safeSig}\` | ${memberCount} |`);
    }
    const exportsOmitted = skeleton.exports.length - shownExports.length;
    if (exportsOmitted > 0) {
      parts.push('');
      parts.push(`*另 ${exportsOmitted} 个导出省略（完整骨架见 \`spectra prepare\`）*`);
    }

    // 展开含 members 的类/接口为缩进子表格（FR-001 US-1 验收场景 3）。
    // 仅在已显示的 exports 范围内展开，避免被截断的 class 又被全量展开。
    const classLike = shownExports.filter(
      (e) => (e.kind === 'class' || e.kind === 'interface') && e.members && e.members.length > 0,
    );

    for (const cls of classLike) {
      parts.push('');
      parts.push(`**${cls.name} 成员**`);
      parts.push('');
      parts.push('| 成员 | 类型 | 签名 | 可见性 |');
      parts.push('|------|------|------|--------|');

      const allMembers = cls.members!;
      const shownMembers = allMembers.slice(0, MEMBER_DETAIL_LIMIT);
      for (const member of shownMembers) {
        const safeMemberSig = member.signature.replace(/\|/g, '\\|');
        const visibility = member.visibility ?? 'public';
        parts.push(`| \`${member.name}\` | ${member.kind} | \`${safeMemberSig}\` | ${visibility} |`);
      }
      const omitted = allMembers.length - shownMembers.length;
      if (omitted > 0) {
        parts.push('');
        parts.push(`*另 ${omitted} 个成员省略（完整骨架见 \`spectra prepare\`）*`);
      }
    }

    parts.push('');
  }

  // Feature 148: 折叠剩余文件为单一汇总表，保留可发现性但避免 spec 体量爆炸。
  if (foldedSkeletons.length > 0) {
    const totalFoldedExports = foldedSkeletons.reduce((sum, s) => sum + s.exports.length, 0);
    parts.push(`### 其他 ${foldedSkeletons.length} 个文件（共 ${totalFoldedExports} 导出）`);
    parts.push('');
    parts.push('*完整骨架见 `spectra prepare`。*');
    parts.push('');
    parts.push('| 文件 | 导出数 | 主要符号 |');
    parts.push('|------|--------|----------|');

    const shownInFolded = foldedSkeletons.slice(0, FOLDED_TABLE_ROW_LIMIT);
    for (const skeleton of shownInFolded) {
      const fileName = path.basename(skeleton.filePath);
      const top = skeleton.exports.slice(0, 3).map((e) => `\`${e.name}\``).join(', ');
      const extra = skeleton.exports.length > 3 ? ` (+${skeleton.exports.length - 3})` : '';
      parts.push(`| ${fileName} | ${skeleton.exports.length} | ${top}${extra} |`);
    }
    const filesOmittedFromTable = foldedSkeletons.length - shownInFolded.length;
    if (filesOmittedFromTable > 0) {
      parts.push('');
      parts.push(`*另 ${filesOmittedFromTable} 个文件未在汇总表中列出（完整骨架见 \`spectra prepare\`）*`);
    }
    parts.push('');
  }

  return parts.join('\n').trimEnd();
}

/**
 * 从 CodeSkeleton 中提取数据结构并生成字段/值表格（FR-003, FR-004）
 * 处理 kind === 'class' | 'interface' | 'type' | 'enum'
 * 对含 members 的类生成字段表格，对 enum 生成值列表
 *
 * @param skeletons - 各文件的 CodeSkeleton 数组
 * @returns Markdown 格式的数据结构文本
 */
export function generateAstDataStructures(skeletons: CodeSkeleton[]): string {
  // 从所有骨架筛选数据结构相关导出
  const dataExports = skeletons.flatMap((s) =>
    s.exports
      .filter((e) => e.kind === 'class' || e.kind === 'interface' || e.kind === 'type' || e.kind === 'enum' || e.kind === 'data_class')
      .map((e) => ({ exp: e, filePath: s.filePath })),
  );

  if (dataExports.length === 0) {
    return '';
  }

  // Feature 148: 按 members 数倒序，无 members 的 type/enum 排后；同分时文件名+符号名稳定排序。
  // 用字典序比较（不调 localeCompare，避免依赖 ICU/locale 在不同 OS 漂移）。
  const sortedDataExports = [...dataExports].sort((a, b) => {
    const aMembers = a.exp.members?.length ?? 0;
    const bMembers = b.exp.members?.length ?? 0;
    if (aMembers !== bMembers) return bMembers - aMembers;
    const fileA = path.basename(a.filePath);
    const fileB = path.basename(b.filePath);
    if (fileA !== fileB) return fileA < fileB ? -1 : 1;
    return a.exp.name < b.exp.name ? -1 : a.exp.name > b.exp.name ? 1 : 0;
  });

  const detailedExports = sortedDataExports.slice(0, DATA_DETAIL_LIMIT);
  const foldedExports = sortedDataExports.slice(DATA_DETAIL_LIMIT);

  const parts: string[] = [];

  for (const { exp, filePath } of detailedExports) {
    const fileName = path.basename(filePath);

    if (exp.kind === 'enum') {
      // enum：生成值列表表格
      parts.push(`#### \`${exp.name}\` (enum) — ${fileName}`);
      parts.push('');

      if (exp.members && exp.members.length > 0) {
        const shownMembers = exp.members.slice(0, MEMBER_DETAIL_LIMIT);
        parts.push('| 枚举值 | 签名 |');
        parts.push('|--------|------|');
        for (const member of shownMembers) {
          const safeSig = member.signature.replace(/\|/g, '\\|');
          parts.push(`| \`${member.name}\` | \`${safeSig}\` |`);
        }
        const omitted = exp.members.length - shownMembers.length;
        if (omitted > 0) {
          parts.push('');
          parts.push(`*另 ${omitted} 个枚举值省略（完整骨架见 \`spectra prepare\`）*`);
        }
      } else {
        // 没有成员信息时，展示签名
        const safeSig = exp.signature.replace(/\|/g, '\\|');
        parts.push(`\`${safeSig}\``);
      }
      parts.push('');
    } else if (exp.kind === 'class' || exp.kind === 'interface' || exp.kind === 'data_class') {
      // class/interface/dataclass：生成字段表格
      const kindLabel = exp.kind === 'data_class' ? 'dataclass' : exp.kind;
      parts.push(`#### \`${exp.name}\` (${kindLabel}) — ${fileName}`);
      parts.push('');

      if (exp.members && exp.members.length > 0) {
        // 分离属性（property）和方法（method）
        const properties = exp.members.filter((m) => m.kind === 'property' || m.kind === 'getter' || m.kind === 'setter');
        const methods = exp.members.filter((m) => m.kind !== 'property' && m.kind !== 'getter' && m.kind !== 'setter');

        if (properties.length > 0) {
          parts.push('**字段**');
          parts.push('');
          parts.push('| 字段名 | 类型/签名 | 可见性 |');
          parts.push('|--------|-----------|--------|');
          const shownProps = properties.slice(0, MEMBER_DETAIL_LIMIT);
          for (const prop of shownProps) {
            const safeSig = prop.signature.replace(/\|/g, '\\|');
            const visibility = prop.visibility ?? 'public';
            parts.push(`| \`${prop.name}\` | \`${safeSig}\` | ${visibility} |`);
          }
          const propOmitted = properties.length - shownProps.length;
          if (propOmitted > 0) {
            parts.push('');
            parts.push(`*另 ${propOmitted} 个字段省略（完整骨架见 \`spectra prepare\`）*`);
          }
          parts.push('');
        }

        if (methods.length > 0) {
          parts.push('**方法**');
          parts.push('');
          parts.push('| 方法名 | 签名 | 可见性 |');
          parts.push('|--------|------|--------|');
          const shownMethods = methods.slice(0, MEMBER_DETAIL_LIMIT);
          for (const method of shownMethods) {
            const safeSig = method.signature.replace(/\|/g, '\\|');
            const visibility = method.visibility ?? 'public';
            parts.push(`| \`${method.name}\` | \`${safeSig}\` | ${visibility} |`);
          }
          const methodOmitted = methods.length - shownMethods.length;
          if (methodOmitted > 0) {
            parts.push('');
            parts.push(`*另 ${methodOmitted} 个方法省略（完整骨架见 \`spectra prepare\`）*`);
          }
          parts.push('');
        }

        if (properties.length === 0 && methods.length === 0) {
          const safeSig = exp.signature.replace(/\|/g, '\\|');
          parts.push(`\`${safeSig}\``);
          parts.push('');
        }
      } else {
        // 没有成员信息时，展示签名
        const safeSig = exp.signature.replace(/\|/g, '\\|');
        parts.push(`\`${safeSig}\``);
        parts.push('');
      }
    } else if (exp.kind === 'type') {
      // type alias：展示签名
      const safeSig = exp.signature.replace(/\|/g, '\\|');
      parts.push(`#### \`${exp.name}\` (type) — ${fileName}`);
      parts.push('');
      parts.push(`\`${safeSig}\``);
      parts.push('');
    }
  }

  // Feature 148: 折叠剩余数据结构为汇总表。
  if (foldedExports.length > 0) {
    parts.push(`#### 其他数据结构（共 ${foldedExports.length} 个）`);
    parts.push('');
    parts.push('*完整骨架见 `spectra prepare`。*');
    parts.push('');
    parts.push('| 名称 | 类型 | 文件 | 成员数 |');
    parts.push('|------|------|------|--------|');
    const shownInFolded = foldedExports.slice(0, FOLDED_TABLE_ROW_LIMIT);
    for (const { exp, filePath } of shownInFolded) {
      const fileName = path.basename(filePath);
      const kindLabel = exp.kind === 'data_class' ? 'dataclass' : exp.kind;
      const memberCount = exp.members ? exp.members.length : '-';
      parts.push(`| \`${exp.name}\` | ${kindLabel} | ${fileName} | ${memberCount} |`);
    }
    const dataOmittedFromTable = foldedExports.length - shownInFolded.length;
    if (dataOmittedFromTable > 0) {
      parts.push('');
      parts.push(`*另 ${dataOmittedFromTable} 个数据结构未在汇总表中列出（完整骨架见 \`spectra prepare\`）*`);
    }
    parts.push('');
  }

  return parts.join('\n').trimEnd();
}

/**
 * 扫描项目测试目录，统计测试文件数和测试函数名（FR-008）
 * 支持模式：.test.* / .spec.* / test_*.py
 *
 * @param projectRootDir - 项目根目录
 * @returns 测试文件统计信息文本，如无测试目录返回空字符串
 */
function scanTestFiles(projectRootDir: string): string {
  const testDirCandidates = ['tests', 'test', '__tests__', 'spec'];
  const testFilePatterns = [
    /\.test\.(ts|tsx|js|jsx|py)$/,
    /\.spec\.(ts|tsx|js|jsx|py)$/,
    /^test_.*\.py$/,
  ];

  const foundFiles: Array<{ filePath: string; relativePath: string }> = [];

  // 递归扫描测试文件
  function walkDir(dir: string, depth: number = 0): void {
    if (depth > 5) return; // 避免无限递归
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isFile()) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // 跳过 node_modules、.git 等
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue;
          walkDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const isTestFile = testFilePatterns.some((p) => p.test(entry.name));
          if (isTestFile) {
            foundFiles.push({
              filePath: fullPath,
              relativePath: path.relative(projectRootDir, fullPath),
            });
          }
        }
      }
    } catch {
      // 目录读取失败时跳过
    }
  }

  // 先检查常规测试目录
  for (const candidate of testDirCandidates) {
    const candidatePath = path.join(projectRootDir, candidate);
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
      walkDir(candidatePath);
    }
  }

  // 如果没有找到，也扫描项目根目录（处理测试文件散布的情况）
  if (foundFiles.length === 0) {
    walkDir(projectRootDir);
  }

  if (foundFiles.length === 0) {
    return '';
  }

  // 提取测试函数名（轻量正则扫描，不做完整 AST）
  const TEST_FUNCTION_PATTERNS = [
    /(?:describe|it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g,  // JS/TS: describe('name'), it('name'), test('name')
    /def\s+(test_\w+)/g,                                   // Python: def test_xxx
    /func\s+(Test\w+)/g,                                    // Go: func TestXxx
  ];

  let totalTestFunctions = 0;
  const fileDetails: string[] = [];
  const displayFiles = foundFiles.slice(0, 100);

  for (const { filePath, relativePath } of displayFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const funcNames: string[] = [];
      for (const pattern of TEST_FUNCTION_PATTERNS) {
        const re = new RegExp(pattern.source, pattern.flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
          if (m[1]) funcNames.push(m[1]);
        }
      }
      totalTestFunctions += funcNames.length;
      const funcSummary = funcNames.length > 0
        ? `（${funcNames.length} 个测试: ${funcNames.slice(0, 5).join(', ')}${funcNames.length > 5 ? ` ...+${funcNames.length - 5}` : ''}）`
        : '';
      fileDetails.push(`- \`${relativePath}\`${funcSummary}`);
    } catch {
      fileDetails.push(`- \`${relativePath}\``);
    }
  }

  const parts: string[] = [];
  parts.push(`扫描到 **${foundFiles.length} 个测试文件**，共 **${totalTestFunctions} 个测试函数**${foundFiles.length > 100 ? '（以下展示前 100 个）' : ''}：`);
  parts.push('');
  parts.push(...fileDetails);

  return parts.join('\n');
}

/**
 * LLM 不可用时的 AST-only 降级内容生成
 * Section 2 从 skeleton.exports 生成签名表格
 * Section 3 从 skeleton.imports 生成 Mermaid 依赖图
 */
function generateAstOnlyContent(skeleton: CodeSkeleton): string {
  const sections: string[] = [];

  sections.push('## 1. 意图');
  sections.push(`[推断: LLM 不可用] 本模块位于 ${skeleton.filePath}，包含 ${skeleton.exports.length} 个导出符号。`);

  // Section 2：从 exports 生成签名表格
  sections.push('## 2. 接口定义');
  if (skeleton.exports.length > 0) {
    sections.push('| 名称 | 类型 | 签名 |');
    sections.push('|------|------|------|');
    for (const exp of skeleton.exports) {
      // 处理签名中的竖线以避免破坏表格
      const safeSig = exp.signature.replace(/\|/g, '\\|');
      sections.push(`| \`${exp.name}\` | ${exp.kind} | \`${safeSig}\` |`);
    }
    // 列出成员详情（如有）
    const classExports = skeleton.exports.filter((e) => e.kind === 'class' && e.members && e.members.length > 0);
    if (classExports.length > 0) {
      sections.push('');
      sections.push('**类成员**');
      for (const cls of classExports) {
        sections.push(`\n*${cls.name}*`);
        sections.push('| 成员 | 类型 | 签名 |');
        sections.push('|------|------|------|');
        for (const member of cls.members!) {
          const vis = member.visibility ? `[${member.visibility}] ` : '';
          const safeMemberSig = member.signature.replace(/\|/g, '\\|');
          sections.push(`| \`${member.name}\` | ${member.kind} | ${vis}\`${safeMemberSig}\` |`);
        }
      }
    }
  } else {
    sections.push('无导出符号。');
  }

  // Section 3：从 imports 生成 Mermaid 依赖图
  sections.push('## 3. 业务逻辑');
  sections.push('[推断: LLM 不可用] 以下为基于 AST 骨架推断的模块依赖关系。');
  if (skeleton.imports.length > 0) {
    // 仅取内部相对导入绘图（外部依赖较多时图太乱）
    const relativeImports = skeleton.imports.filter((imp) => imp.isRelative);
    const externalImports = skeleton.imports.filter((imp) => !imp.isRelative);
    if (relativeImports.length > 0) {
      sections.push('');
      sections.push('```mermaid');
      sections.push('flowchart TD');
      const modName = path.basename(skeleton.filePath, path.extname(skeleton.filePath));
      for (const imp of relativeImports) {
        const depName = path.basename(imp.moduleSpecifier);
        sections.push(`  ${modName}["${modName}"] --> ${depName}["${depName}"]`);
      }
      sections.push('```');
    }
    if (externalImports.length > 0) {
      sections.push('');
      sections.push('**外部依赖**');
      for (const imp of externalImports) {
        sections.push(`- \`${imp.moduleSpecifier}\``);
      }
    }
  } else {
    sections.push('无模块依赖。');
  }

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
      const names = imp.namedImports?.join(', ') ?? imp.defaultImport ?? '*';
      sections.push(`- \`${names}\` from \`${imp.moduleSpecifier}\``);
    }
  } else {
    sections.push('无导入依赖。');
  }

  return sections.join('\n\n');
}
