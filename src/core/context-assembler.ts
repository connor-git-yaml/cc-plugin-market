/**
 * 上下文组装器
 * 从骨架 + 依赖 spec + 代码片段组合 LLM Prompt，强制 100k token 预算（FR-003）
 * 裁剪优先级：snippets → dependencies → skeleton
 * 参见 contracts/core-pipeline.md
 */
import type { CodeSkeleton } from '../models/code-skeleton.js';
import { estimateFast } from './token-counter.js';

// ============================================================
// 类型定义
// ============================================================

export interface AssemblyOptions {
  /** 已生成的依赖规格摘要数组 */
  dependencySpecs?: string[];
  /** 用于深度分析的复杂函数体代码片段 */
  codeSnippets?: string[];
  /** token 预算（默认 100_000） */
  maxTokens?: number;
  /** LLM 系统提示词模板 */
  templateInstructions?: string;
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
      parts.push('```typescript');
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
 */
function formatSnippets(snippets: string[]): string {
  if (snippets.length === 0) return '';
  const parts = snippets.map(
    (s, i) => `### 代码片段 ${i + 1}\n\`\`\`typescript\n${s}\n\`\`\``,
  );
  return `## 关键代码片段\n\n${parts.join('\n\n')}`;
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
  const maxTokens = options.maxTokens ?? 100_000;
  const truncatedParts: string[] = [];

  // 准备各部分内容
  const instructionsText = options.templateInstructions ?? '';
  const skeletonText = formatSkeleton(skeleton);
  let dependenciesText = formatDependencies(options.dependencySpecs ?? []);
  let snippetsText = formatSnippets(options.codeSnippets ?? []);

  // 估算各部分 token
  let instructionsTokens = estimateFast(instructionsText);
  let skeletonTokens = estimateFast(skeletonText);
  let dependenciesTokens = estimateFast(dependenciesText);
  let snippetsTokens = estimateFast(snippetsText);

  let total = instructionsTokens + skeletonTokens + dependenciesTokens + snippetsTokens;

  // 裁剪优先级：snippets → dependencies → skeleton
  // 阶段 1：裁剪 snippets
  if (total > maxTokens && snippetsText) {
    const available = maxTokens - instructionsTokens - skeletonTokens - dependenciesTokens;
    if (available <= 0) {
      snippetsText = '';
      snippetsTokens = 0;
      truncatedParts.push('codeSnippets');
    } else {
      // 逐个移除片段直到符合预算
      const snippets = options.codeSnippets ?? [];
      let kept = snippets.length;
      while (kept > 0 && estimateFast(formatSnippets(snippets.slice(0, kept))) > available) {
        kept--;
      }
      if (kept < snippets.length) {
        truncatedParts.push('codeSnippets');
      }
      snippetsText = formatSnippets(snippets.slice(0, kept));
      snippetsTokens = estimateFast(snippetsText);
    }
    total = instructionsTokens + skeletonTokens + dependenciesTokens + snippetsTokens;
  }

  // 阶段 2：裁剪 dependencies
  if (total > maxTokens && dependenciesText) {
    const available = maxTokens - instructionsTokens - skeletonTokens - snippetsTokens;
    if (available <= 0) {
      dependenciesText = '';
      dependenciesTokens = 0;
      truncatedParts.push('dependencySpecs');
    } else {
      const deps = options.dependencySpecs ?? [];
      let kept = deps.length;
      while (kept > 0 && estimateFast(formatDependencies(deps.slice(0, kept))) > available) {
        kept--;
      }
      if (kept < deps.length) {
        truncatedParts.push('dependencySpecs');
      }
      dependenciesText = formatDependencies(deps.slice(0, kept));
      dependenciesTokens = estimateFast(dependenciesText);
    }
    total = instructionsTokens + skeletonTokens + dependenciesTokens + snippetsTokens;
  }

  // 阶段 3：最后手段 — 标记 skeleton 被裁剪（但不实际裁剪，因为它是核心）
  if (total > maxTokens) {
    truncatedParts.push('skeleton');
  }

  // 组装最终 prompt
  const promptParts = [instructionsText, skeletonText, dependenciesText, snippetsText].filter(
    Boolean,
  );
  const prompt = promptParts.join('\n\n---\n\n');
  const tokenCount = estimateFast(prompt);

  return {
    prompt,
    tokenCount,
    breakdown: {
      skeleton: skeletonTokens,
      dependencies: dependenciesTokens,
      snippets: snippetsTokens,
      instructions: instructionsTokens,
    },
    truncated: truncatedParts.length > 0,
    truncatedParts,
  };
}
