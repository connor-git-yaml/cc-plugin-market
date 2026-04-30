/**
 * 上下文组装器
 * 从骨架 + 依赖 spec + 代码片段 + 代码切片 + README 组合 LLM Prompt，强制 100k token 预算
 * 裁剪优先级：skeleton > codeSlices > readmeContext > codeSnippets > dependencies（FR-010）
 * 参见 contracts/core-pipeline.md
 */
import type { CodeSkeleton } from '../models/code-skeleton.js';
import type { CodeSlice } from '../models/code-skeleton.js';
import { estimateFast, estimateTokens } from './token-counter.js';

// ============================================================
// 类型定义
// ============================================================

export interface AssemblyOptions {
  /** 已生成的依赖规格摘要数组 */
  dependencySpecs?: string[];
  /** 用于深度分析的复杂函数体代码片段（deep 模式原始文件内容） */
  codeSnippets?: string[];
  /** token 预算（默认 100_000） */
  maxTokens?: number;
  /** LLM 系统提示词模板 */
  templateInstructions?: string;
  /** 代码切片（控制流骨架，FR-001, FR-007） */
  codeSlices?: CodeSlice[];
  /** README 上下文（用于 product-overview 等，FR-007, FR-009） */
  readmeContext?: string;
  /** 调用方上下文：该模块被哪些上游模块引用及其摘要（FR-008） */
  callerContext?: string;
  /** Markdown 知识文件内容（SKILL.md, AGENTS.md 等，FR-009） */
  knowledgeFiles?: string;
}

export interface AssembledContext {
  /** 组装后的完整 prompt */
  prompt: string;
  /** token 计数 */
  tokenCount: number;
  /** 各部分 token 分布（细粒度，按内部分类）*/
  breakdown: {
    skeleton: number;
    dependencies: number;
    snippets: number;
    instructions: number;
    /** 代码切片的 token 数 */
    codeSlices?: number;
    /** README 上下文的 token 数 */
    readmeContext?: number;
    /** 调用方上下文的 token 数 */
    callerContext?: number;
    /** 知识文件的 token 数 */
    knowledgeFiles?: number;
  };
  /**
   * Feature 140 T15 — 三层聚合 token 分布（粗粒度，供 module spec frontmatter 写入）
   *
   * 与 `breakdown` 的关系：
   * - `tokenBreakdown.sourceFile` = `breakdown.skeleton`
   * - `tokenBreakdown.promptTemplate` = `breakdown.instructions`
   * - `tokenBreakdown.contextAssembly` = breakdown 中所有跨模块上下文的总和
   *   （dependencies + snippets + codeSlices + readmeContext + callerContext + knowledgeFiles）
   *
   * 用途：观测每个模块在 LLM 调用中实际消耗的 input token（FR-012），
   * batch-orchestrator 据此计算 Top 5 token 消费模块（FR-013）。
   */
  tokenBreakdown: {
    /** 跨模块上下文（dependencies / snippets / slices / readme / caller / knowledge）总 token */
    contextAssembly: number;
    /** prompt 模板 instructions 的 token */
    promptTemplate: number;
    /** 目标文件 skeleton 的 token */
    sourceFile: number;
  };
  /** 是否有部分被裁剪 */
  truncated: boolean;
  /** 被裁剪的部分 */
  truncatedParts: string[];
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 将 CodeSkeleton 格式化为 LLM 可读文本
 */
function formatSkeleton(skeleton: CodeSkeleton): string {
  const parts: string[] = [];

  parts.push(`## 文件信息`);
  parts.push(`- 路径: ${skeleton.filePath}`);
  parts.push(`- 语言: ${skeleton.language}`);
  parts.push(`- 行数: ${skeleton.loc}`);
  parts.push(`- 解析器: ${skeleton.parserUsed}`);
  if (skeleton.moduleDoc) {
    parts.push(`- 模块说明: ${skeleton.moduleDoc}`);
  }
  parts.push('');

  // 导入
  if (skeleton.imports.length > 0) {
    parts.push(`## 导入依赖`);
    for (const imp of skeleton.imports) {
      const names = imp.namedImports?.join(', ') ?? imp.defaultImport ?? '*';
      const typeOnly = imp.isTypeOnly ? ' (type-only)' : '';
      parts.push(`- ${names} from '${imp.moduleSpecifier}'${typeOnly}`);
    }
    parts.push('');
  }

  // 导出
  if (skeleton.exports.length > 0) {
    parts.push(`## 导出符号`);
    for (const exp of skeleton.exports) {
      parts.push(`### ${exp.kind}: ${exp.name}`);
      parts.push(`\`\`\`${skeleton.language}`);
      parts.push(exp.signature);
      parts.push('```');
      if (exp.jsDoc) {
        parts.push(`JSDoc: ${exp.jsDoc}`);
      }
      if (exp.members && exp.members.length > 0) {
        parts.push('成员:');
        for (const member of exp.members) {
          const vis = member.visibility ? `${member.visibility} ` : '';
          const stat = member.isStatic ? 'static ' : '';
          parts.push(`  - ${vis}${stat}${member.kind}: ${member.signature}`);
        }
      }
      parts.push('');
    }
  }

  // 解析错误
  if (skeleton.parseErrors && skeleton.parseErrors.length > 0) {
    parts.push(`## 解析错误`);
    for (const err of skeleton.parseErrors) {
      parts.push(`- 行 ${err.line}:${err.column}: ${err.message}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * 格式化依赖 spec 摘要
 */
function formatDependencies(deps: string[]): string {
  if (deps.length === 0) return '';
  return `## 依赖模块 Spec 摘要\n\n${deps.join('\n\n---\n\n')}`;
}

/**
 * 格式化代码片段
 * @param snippets - 代码片段列表
 * @param language - 代码块标记语言（默认 'typescript'）
 */
function formatSnippets(snippets: string[], language = 'typescript'): string {
  if (snippets.length === 0) return '';
  const parts = snippets.map(
    (s, i) => `### 代码片段 ${i + 1}\n\`\`\`${language}\n${s}\n\`\`\``,
  );
  return `## 关键代码片段\n\n${parts.join('\n\n')}`;
}

/**
 * 格式化代码切片（控制流骨架）
 * 每个切片包含函数签名 + 控制流关键行，供 LLM 理解函数语义
 *
 * @param slices - CodeSlice 数组
 */
function formatCodeSlices(slices: CodeSlice[]): string {
  if (slices.length === 0) return '';
  const parts = slices.map((slice) => {
    const lines = [
      `### ${slice.symbolName}（P${slice.priority} - ${slice.filePath}:${slice.startLine}-${slice.endLine}）`,
      `\`\`\``,
      slice.signature,
      ...slice.controlFlowLines,
      '```',
    ];
    return lines.join('\n');
  });
  return `## 代码切片（控制流骨架）\n\n> 以下为关键函数的控制流结构，用于理解模块核心逻辑。\n\n${parts.join('\n\n')}`;
}

/**
 * 格式化 README 上下文
 * README 仅作为参考，不得直接复述，提示 LLM 从代码反推产品能力
 *
 * @param readmeContent - README.md 内容
 */
function formatReadmeContext(readmeContent: string): string {
  if (!readmeContent.trim()) return '';
  return `## README 参考（勿直接复述，应从代码结构反推）\n\n${readmeContent.trim()}`;
}

/**
 * 格式化调用方上下文（FR-008）
 * 提供模块在整体架构中的定位信息
 */
function formatCallerContext(callerContext: string): string {
  if (!callerContext.trim()) return '';
  return `## 调用方上下文（该模块被以下模块引用）\n\n${callerContext.trim()}`;
}

/**
 * 格式化 Markdown 知识文件内容（FR-009）
 * 支持 SKILL.md、AGENTS.md 等非代码知识文件
 */
function formatKnowledgeFiles(content: string): string {
  if (!content.trim()) return '';
  return `## 知识文件（Markdown-as-Code）\n\n> 以下为项目中的结构化知识文件（SKILL.md / AGENTS.md 等），描述了非代码逻辑。\n\n${content.trim()}`;
}

/** README 截断上限字符数 */
const README_MAX_CHARS = 6000;

/** 知识文件截断上限字符数 */
const KNOWLEDGE_FILES_MAX_CHARS = 8000;

/**
 * 贪心裁剪列表项以满足 token 预算
 * 使用预计算的 per-item token 数，避免每轮重新格式化（O(n) 而非 O(n²)）
 *
 * @param items - 待裁剪的项列表
 * @param perItemTokens - 每项的 token 估算值
 * @param available - 可用 token 预算
 * @returns 保留的项数量
 */
function trimToAvailable(
  perItemTokens: number[],
  available: number,
): number {
  if (available <= 0) return 0;
  let total = 0;
  for (let i = 0; i < perItemTokens.length; i++) {
    total += perItemTokens[i]!;
    if (total > available) return i;
  }
  return perItemTokens.length;
}

// ============================================================
// 核心 API
// ============================================================

/**
 * 在 token 预算内组装 LLM 上下文
 *
 * @param skeleton - 目标模块的 CodeSkeleton
 * @param options - 组装选项
 * @returns 组装后的上下文
 */
export async function assembleContext(
  skeleton: CodeSkeleton,
  options: AssemblyOptions = {},
): Promise<AssembledContext> {
  const maxTokens = options.maxTokens ?? 500_000;
  const truncatedParts: string[] = [];

  // 准备各部分内容（按裁剪优先级从低到高排列：先裁低优先级）
  const instructionsText = options.templateInstructions ?? '';
  const skeletonText = formatSkeleton(skeleton);
  const codeBlockLanguage = skeleton.language;

  // 可裁剪部分（从低优先级到高优先级排列）
  // 裁剪顺序：snippets → deps → knowledge → caller → readme → slices → skeleton（不裁）
  interface TrimPart { name: string; text: string; tokens: number }
  const parts: TrimPart[] = [];

  // 最低优先级 → 先裁
  const snippets = options.codeSnippets ?? [];
  const snippetsText = formatSnippets(snippets, codeBlockLanguage);
  parts.push({ name: 'codeSnippets', text: snippetsText, tokens: estimateFast(snippetsText) });

  const deps = options.dependencySpecs ?? [];
  const depsText = formatDependencies(deps);
  parts.push({ name: 'dependencySpecs', text: depsText, tokens: estimateFast(depsText) });

  const knowledgeText = options.knowledgeFiles ? formatKnowledgeFiles(options.knowledgeFiles) : '';
  parts.push({ name: 'knowledgeFiles', text: knowledgeText, tokens: estimateFast(knowledgeText) });

  const callerText = options.callerContext ? formatCallerContext(options.callerContext) : '';
  parts.push({ name: 'callerContext', text: callerText, tokens: estimateFast(callerText) });

  const readmeText = options.readmeContext ? formatReadmeContext(options.readmeContext) : '';
  parts.push({ name: 'readmeContext', text: readmeText, tokens: estimateFast(readmeText) });

  const slices = options.codeSlices ?? [];
  const codeSlicesText = formatCodeSlices(slices);
  parts.push({ name: 'codeSlices', text: codeSlicesText, tokens: estimateFast(codeSlicesText) });

  // 固定部分（不裁剪）
  const instructionsTokens = estimateFast(instructionsText);
  const skeletonTokens = estimateFast(skeletonText);
  const fixedTokens = instructionsTokens + skeletonTokens;

  let variableTokens = parts.reduce((sum, p) => sum + p.tokens, 0);
  let total = fixedTokens + variableTokens;

  // 从低优先级开始逐个裁剪整块（O(k) 其中 k 为部分数，而非 O(n²)）
  for (let i = 0; i < parts.length && total > maxTokens; i++) {
    const part = parts[i]!;
    if (part.tokens > 0) {
      total -= part.tokens;
      part.text = '';
      part.tokens = 0;
      truncatedParts.push(part.name);
    }
  }

  // 最后手段 — 标记 skeleton 被裁剪（但不实际裁剪，因为它是核心）
  if (total > maxTokens) {
    truncatedParts.push('skeleton');
  }

  // token breakdown 日志（FR-010）
  if (total > 400_000) {
    const bd = [`skeleton:${skeletonTokens}`, ...parts.filter(p => p.tokens > 0).map(p => `${p.name}:${p.tokens}`)].join(' + ');
    console.warn(`[context-assembler] token 用量 ${total.toLocaleString()}/${maxTokens.toLocaleString()} (${bd})`);
  }

  // 组装最终 prompt（按语义顺序排列）
  const promptParts = [
    instructionsText,
    skeletonText,
    // 按高优先级到低优先级排列（便于 LLM 阅读）
    ...parts.filter(p => p.text).map(p => p.text).reverse(),
  ].filter(Boolean);
  const prompt = promptParts.join('\n\n---\n\n');
  const tokenCount = estimateFast(prompt);

  // 提取各部分 token 到 breakdown
  const partTokenMap = Object.fromEntries(parts.map(p => [p.name, p.tokens]));

  // Feature 140 T15：三层聚合 token 分布（contextAssembly / promptTemplate / sourceFile）
  // 用于 module spec frontmatter `costBreakdown` 字段 + batch summary Top 5 token 消费模块。
  //
  // 口径说明：内部裁剪决策走 estimateFast（CJK-aware，更精准，确保 LLM 实际成本不超 budget）；
  // 对外报告 tokenBreakdown 走 estimateTokens（chars/3.5 简化公式，与 cluster-orchestrator FFD
  // 装箱口径一致），让用户在 module spec frontmatter 看到的 token 数与跨模块 batch summary
  // 一致。两公式对 ASCII 代码场景结果接近（3.5 vs 3.8），CJK 场景下 estimateTokens 偏低约 30%
  // 是 spec FR-012 已接受的精度损失。
  //
  // 反映**裁剪后**的实际 token 数：仅统计仍在 prompt 里（即未被清零）的 part，
  // 排除 instructions（promptTemplate 单独）和 skeleton（sourceFile 单独）。
  const contextAssemblyTokens = parts
    .filter((p) => p.tokens > 0)
    .reduce((sum, p) => sum + estimateTokens(p.text), 0);
  const promptTemplateTokens = estimateTokens(instructionsText);
  const sourceFileTokens = estimateTokens(skeletonText);

  return {
    prompt,
    tokenCount,
    breakdown: {
      skeleton: skeletonTokens,
      dependencies: partTokenMap['dependencySpecs'] ?? 0,
      snippets: partTokenMap['codeSnippets'] ?? 0,
      instructions: instructionsTokens,
      codeSlices: partTokenMap['codeSlices'] ?? 0,
      readmeContext: partTokenMap['readmeContext'] ?? 0,
      callerContext: partTokenMap['callerContext'] ?? 0,
      knowledgeFiles: partTokenMap['knowledgeFiles'] ?? 0,
    },
    tokenBreakdown: {
      contextAssembly: contextAssemblyTokens,
      promptTemplate: promptTemplateTokens,
      sourceFile: sourceFileTokens,
    },
    truncated: truncatedParts.length > 0,
    truncatedParts,
  };
}
