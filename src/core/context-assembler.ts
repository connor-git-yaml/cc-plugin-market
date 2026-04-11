/**
 * 上下文组装器
 * 从骨架 + 依赖 spec + 代码片段 + 代码切片 + README 组合 LLM Prompt，强制 100k token 预算
 * 裁剪优先级：skeleton > codeSlices > readmeContext > codeSnippets > dependencies（FR-010）
 * 参见 contracts/core-pipeline.md
 */
import type { CodeSkeleton } from '../models/code-skeleton.js';
import type { CodeSlice } from '../models/code-skeleton.js';
import { estimateFast } from './token-counter.js';

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
  /** 各部分 token 分布 */
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
    truncated: truncatedParts.length > 0,
    truncatedParts,
  };
}
