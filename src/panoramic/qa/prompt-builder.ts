/**
 * qa/prompt-builder.ts
 * Step 6：LLM prompt 组装
 *
 * 职责：
 * - 将 GraphContext + Citation 列表 + 问题文本组装为 LLM 可用的 prompt
 * - 在 system prompt 中要求 LLM 100% 引用 citation（FR-012）
 * - 在 user prompt 中显式列出 hyperedge.label 候选（R3 缓解：让 LLM 挑选而非发散）
 * - citation 内联格式：[来源：path:startLine-endLine]
 *
 * 输出：{ systemPrompt, userPrompt }（分离 system/user 便于 Anthropic SDK messages 格式）
 */
import type { GraphContext, Citation } from './types.js';

// ============================================================
// 类型定义
// ============================================================

/** prompt-builder 的输入选项 */
export interface PromptBuildOptions {
  /** 是否在 prompt 中包含债务上下文（默认 true） */
  includeDebtContext?: boolean;
}

/** prompt-builder 的输出 */
export interface QnAPrompt {
  /** 系统 prompt（Anthropic SDK 的 system 参数） */
  systemPrompt: string;
  /** 用户 prompt（messages 数组中 user 角色的 content） */
  userPrompt: string;
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 将 Citation 格式化为内联引用文本
 * 格式：[来源：path:startLine-endLine]
 */
function formatCitationInline(citation: Citation): string {
  const { specPath, lineRange } = citation;
  if (specPath === '[graph hyperedge]') {
    return '[来源：graph-hyperedge]';
  }
  return `[来源：${specPath}:${lineRange.startLine}-${lineRange.endLine}]`;
}

/**
 * 格式化单条 Citation 为提示上下文块
 */
function formatCitationBlock(citation: Citation, index: number): string {
  const inline = formatCitationInline(citation);
  const lines: string[] = [];
  lines.push(`### 引用 ${index + 1} ${inline}`);
  if (citation.excerpt) {
    lines.push('');
    lines.push('```');
    lines.push(citation.excerpt.slice(0, 500));
    lines.push('```');
  }
  return lines.join('\n');
}

/**
 * 格式化 BFS 节点元数据为摘要列表
 */
function formatBfsNodesSummary(
  bfsNodes: GraphContext['bfsNodes'],
): string {
  if (bfsNodes.length === 0) return '（无相关节点）';

  return bfsNodes
    .slice(0, 15)
    .map((n) => `- ${n.label}（kind: ${n.kind}, id: ${n.id}）`)
    .join('\n');
}

/**
 * 格式化 hyperedge 候选列表（R3 缓解：让 LLM 从列表中选而非自由发散）
 */
function formatHyperedgeCandidates(
  hyperedges: GraphContext['hyperedges'],
): string {
  if (hyperedges.length === 0) return '（无超边数据）';

  return hyperedges
    .slice(0, 10)
    .map((he) => {
      const nodesPreview = he.nodes.slice(0, 3).join(', ');
      const moreHint = he.nodes.length > 3 ? ` ...（共 ${he.nodes.length} 个节点）` : '';
      return `- [${he.label}]：${he.rationale.slice(0, 100)}。涉及节点：${nodesPreview}${moreHint}`;
    })
    .join('\n');
}

// ============================================================
// 主函数
// ============================================================

/**
 * 组装问答 LLM prompt
 *
 * @param graphCtx - graph-retriever 的输出（含 bfsNodes + hyperedges）
 * @param citations - 所有来源的 Citation 列表（RAG + Graph + Debt + Hyperedge）
 * @param questionText - 用户原始问题文本
 * @param options - 选项
 * @returns QnAPrompt（systemPrompt + userPrompt）
 */
export function buildQnAPrompt(
  graphCtx: GraphContext,
  citations: Citation[],
  questionText: string,
  options?: PromptBuildOptions,
): QnAPrompt {
  // ── System prompt ──────────────────────────────────────────
  const systemPrompt = `你是一个专业的代码库知识问答助手，基于知识图谱和文档内容回答问题。

## 回答规则（严格遵守）

1. **100% citation 覆盖要求（FR-012）**：回答中的每一个关键论断都必须附上溯源引用。
   - 引用格式：[来源：path:startLine-endLine]
   - 每个关键论断之后必须立即跟随至少一个 [来源：...] 引用
   - 禁止出现没有引用支撑的推测性论断

2. **仅基于提供的上下文回答**：不得凭借通用知识推断未在上下文中出现的内容。

3. **如果上下文不足以回答问题**：明确说明"根据当前图谱数据无法回答该问题"，不要编造答案。

4. **hyperedge 超边候选列表**：若问题涉及跨模块流程，请从下方的超边候选列表中选择最相关的项目，
   不要自行创造不在列表中的流程名称（R3 缓解）。

## 输出格式

请以 JSON 格式返回结果：
\`\`\`json
{
  "answer": "回答文本（含内联 [来源：...] 引用）",
  "citations": [
    {
      "specPath": "引用的文件路径（或 [graph hyperedge]）",
      "startLine": 行号数字,
      "endLine": 行号数字,
      "excerpt": "原文摘要（最多 200 字符）"
    }
  ]
}
\`\`\``;

  // ── User prompt ────────────────────────────────────────────
  const parts: string[] = [];

  // 1. 用户问题
  parts.push('## 用户问题');
  parts.push('');
  parts.push(questionText);
  parts.push('');

  // 2. 相关节点摘要
  parts.push('## 相关代码节点（BFS 检索结果）');
  parts.push('');
  parts.push(formatBfsNodesSummary(graphCtx.bfsNodes));
  parts.push('');

  // 3. hyperedge 超边候选列表（R3 缓解：显式列出，让 LLM 挑选）
  parts.push('## 超边候选列表（跨模块流程）');
  parts.push('');
  parts.push(formatHyperedgeCandidates(graphCtx.hyperedges));
  parts.push('');

  // 4. 参考文档摘要（Citation 列表）
  if (citations.length > 0) {
    parts.push('## 参考文档摘要（用于回答和 citation）');
    parts.push('');
    citations.forEach((citation, idx) => {
      parts.push(formatCitationBlock(citation, idx));
      parts.push('');
    });
  } else {
    parts.push('## 参考文档摘要');
    parts.push('');
    parts.push('（无可用文档摘要，请根据节点元数据回答，并注明数据来源有限）');
    parts.push('');
  }

  // 5. 降级提示（当 fallbackMode 存在时）
  if (graphCtx.fallbackMode) {
    parts.push(`> 注意：当前处于 ${graphCtx.fallbackMode} 降级模式，图谱检索结果有限，回答可能不完整。`);
    parts.push('');
  }

  parts.push('请基于以上上下文，按 JSON 格式回答用户问题。回答中每个关键论断后面必须附上对应的 [来源：...] 引用。');

  const userPrompt = parts.join('\n');

  return { systemPrompt, userPrompt };
}
