/**
 * 单模块 Spec 生成编排器
 * /reverse-spec 命令入口 — 串联三阶段流水线
 * 参见 contracts/core-pipeline.md
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { CodeSkeleton } from '../models/code-skeleton.js';
import type { ModuleSpec, SpecSections } from '../models/module-spec.js';
import { scanFiles } from '../utils/file-scanner.js';
import { analyzeFile, analyzeFiles } from './ast-analyzer.js';
import { redact } from './secret-redactor.js';
import { assembleContext, type AssembledContext } from './context-assembler.js';
import { callLLM, parseLLMResponse, buildSystemPrompt, type LLMResponse, LLMUnavailableError } from './llm-client.js';
import { generateFrontmatter } from '../generator/frontmatter.js';
import { renderSpec, initRenderer } from '../generator/spec-renderer.js';
import { generateClassDiagram } from '../generator/mermaid-class-diagram.js';
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
 * 单模块 Spec 生成端到端编排
 *
 * 流水线步骤：
 * 1. 扫描目标路径中的 TS/JS 文件
 * 2. AST 分析 → CodeSkeleton[]
 * 3. 脱敏敏感信息
 * 4. 在 token 预算内组装 LLM 上下文
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
  const {
    deep = false,
    outputDir = 'specs',
    existingVersion,
    projectRoot,
  } = options;
  const warnings: string[] = [];
  let tokenUsage = 0;
  let llmDegraded = false;

  // --- 阶段 1：预处理 ---

  // 步骤 1：扫描文件
  const resolvedTarget = path.resolve(targetPath);
  let filePaths: string[];

  const stat = fs.statSync(resolvedTarget);
  if (stat.isFile()) {
    filePaths = [resolvedTarget];
  } else {
    const scanResult = scanFiles(resolvedTarget, { projectRoot });
    filePaths = scanResult.files.map((f) => path.join(resolvedTarget, f));
    if (filePaths.length === 0) {
      throw new Error(`目标路径中未找到 TS/JS 文件: ${targetPath}`);
    }
  }

  // 步骤 2：AST 分析
  const skeletons = await analyzeFiles(filePaths);

  // 合并为代表性骨架
  const mergedSkeleton = mergeSkeletons(skeletons);

  // 步骤 3：脱敏
  const codeSnippets: string[] = [];
  if (deep) {
    // deep 模式：读取源代码作为代码片段
    for (const filePath of filePaths) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      if (lines.length > CHUNK_THRESHOLD) {
        // 大文件分块
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

  // 步骤 4：组装 LLM 上下文
  const systemPrompt = buildSystemPrompt('spec-generation');
  const context: AssembledContext = await assembleContext(mergedSkeleton, {
    codeSnippets,
    templateInstructions: systemPrompt,
  });

  // --- 阶段 3：生成增强 ---

  // 步骤 5：调用 LLM
  let llmContent: string;
  try {
    const llmResponse: LLMResponse = await callLLM(context);
    llmContent = llmResponse.content;
    tokenUsage = llmResponse.inputTokens + llmResponse.outputTokens;
  } catch (error) {
    if (error instanceof LLMUnavailableError) {
      // LLM 不可用，降级为 AST-only 输出
      llmDegraded = true;
      warnings.push('LLM 不可用，已降级为 AST-only Spec');
      llmContent = generateAstOnlyContent(mergedSkeleton);
    } else {
      throw error;
    }
  }

  // 步骤 6：解析 LLM 响应
  const parsed = parseLLMResponse(llmContent);
  warnings.push(...parsed.parseWarnings);

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
  initRenderer();

  // 生成 Mermaid 类图
  const classDiagram = generateClassDiagram(mergedSkeleton);

  // 生成 frontmatter
  const frontmatter = generateFrontmatter({
    sourceTarget: targetPath,
    relatedFiles: filePaths.map((f) => path.relative(process.cwd(), f)),
    confidence,
    skeletonHash: mergedSkeleton.hash,
    existingVersion,
  });

  // 构建 fileInventory
  const fileInventory = skeletons.map((s) => ({
    path: s.filePath,
    loc: s.loc,
    purpose: s.exports.length > 0
      ? `导出 ${s.exports.map((e) => e.name).join(', ')}`
      : '内部模块',
  }));

  // 构建 ModuleSpec
  const specName = path.basename(targetPath).replace(/\.[^.]+$/, '');
  const outputPath = path.join(outputDir, `${specName}.spec.md`);

  const moduleSpec: ModuleSpec = {
    frontmatter,
    sections: parsed.sections,
    mermaidDiagrams: classDiagram
      ? [{ type: 'classDiagram', source: classDiagram, title: '模块类图' }]
      : undefined,
    fileInventory,
    baselineSkeleton: mergedSkeleton,
    outputPath,
  };

  const markdown = renderSpec(moduleSpec);

  // 步骤 9：写入文件
  const resolvedOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, markdown, 'utf-8');

  return {
    specPath: outputPath,
    skeleton: mergedSkeleton,
    tokenUsage,
    confidence,
    warnings,
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
