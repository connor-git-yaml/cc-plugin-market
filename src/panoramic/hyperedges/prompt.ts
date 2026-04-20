/**
 * Hyperedge LLM prompt 构造器
 *
 * 输入：代码节点列表 + 文档 chunk 列表 + 可选的项目摘要
 * 输出：用于指导 LLM 提取 design-doc 显式命名流程/阶段的 prompt 字符串
 *
 * 约束：
 * - 代码节点最多取 20 个（仅非文档类节点，FR-021）
 * - 文档 chunk 最多取 10 个
 * - prompt 体积控制在 4000 tokens 以内（字符数 / 4 粗估）
 * - 明确指示 LLM 每次最多输出 10 个 hyperedge（FR-018）
 * - 明确指示 rationale_for 边的生成条件
 */
import type { GraphNode } from '../graph/graph-types.js';
import type { DocChunk } from '../anchoring/chunker.js';

// ============================================================
// 文档类节点 kind 集合（需要从代码节点列表中排除）
// ============================================================

/** 视为"文档类节点"的 kind 值，提取 hyperedge 时不作为代码节点 */
const DOC_NODE_KINDS = new Set<GraphNode['kind']>(['spec', 'document']);

// ============================================================
// 公开 API
// ============================================================

/**
 * 构造 LLM hyperedge 提取 prompt
 *
 * 流程：
 * 1. 过滤出代码节点（kind 不在 DOC_NODE_KINDS 中），最多 20 个
 * 2. 取 docChunks 最多 10 个
 * 3. 序列化为 prompt 字符串，体积控制在 ~4000 tokens
 *
 * @param nodes - 图谱节点列表（来自 GraphJSON.nodes）
 * @param docChunks - 文档切片列表（来自 chunkMarkdownFiles）
 * @param projectSummary - 可选的项目简介（用于帮助 LLM 理解上下文）
 * @returns LLM 用户 prompt 字符串
 */
export function buildHyperedgePrompt(
  nodes: GraphNode[],
  docChunks: DocChunk[],
  projectSummary?: string,
): string {
  // 只保留代码节点（过滤掉文档类节点），最多 20 个
  const codeNodes = nodes
    .filter((n) => !DOC_NODE_KINDS.has(n.kind))
    .slice(0, 20);

  // 最多取 10 个 doc chunk
  const selectedChunks = docChunks.slice(0, 10);

  // 序列化代码节点列表
  const nodesSection = codeNodes.length > 0
    ? codeNodes
        .map((n) => `- id: ${n.id} | kind: ${n.kind} | label: ${n.label}`)
        .join('\n')
    : '（无代码节点）';

  // 序列化文档 chunk 列表
  const chunksSection = selectedChunks.length > 0
    ? selectedChunks
        .map((c, i) => {
          // 每个 chunk 文本截断到 300 字符，避免 prompt 超限
          const text = c.text.length > 300 ? `${c.text.slice(0, 300)}...` : c.text;
          return `[Chunk ${i + 1}] ${c.filePath}#${c.headingPath}\n${text}`;
        })
        .join('\n\n')
    : '（无文档内容）';

  // 可选项目摘要
  const summarySection = projectSummary
    ? `项目简介：\n${projectSummary.slice(0, 500)}\n\n`
    : '';

  return `你是一位软件架构分析专家。请从以下设计文档内容中，识别**显式命名的流程、阶段、协作模式**，并为每个识别到的流程提取一个"超边（hyperedge）"。

超边表示一个命名流程/阶段，连接参与该流程的 3 个或更多代码模块节点。

## 代码节点列表（可参与超边）

${nodesSection}

## 设计文档内容

${summarySection}${chunksSection}

## 输出要求

请输出 JSON 格式，结构如下：
\`\`\`json
{
  "hyperedges": [
    {
      "id": "he-<唯一编号，如 he-001>",
      "label": "<流程名称，最多 8 个中文/英文字符>",
      "nodes": ["<代码节点ID1>", "<代码节点ID2>", "<代码节点ID3>", ...],
      "rationale": "<说明为何这些节点共同参与该流程，最多 200 字符>",
      "confidence": "INFERRED"
    }
  ]
}
\`\`\`

## 规则

1. **每次最多输出 10 个 hyperedge**（FR-018）
2. **nodes 列表必须包含至少 3 个节点**，且**至少 1 个必须来自"代码节点列表"**
3. **label 最多 8 个 Unicode 字符**（含中文、英文字符均算 1 个）
4. **rationale 不能为空，最多 200 字符**，说明 LLM 识别该流程的依据
5. **confidence 固定填写 "INFERRED"**（LLM 推理结果）
6. **rationale_for 边说明**：如果某个文档章节明确为某代码决策提供了设计依据（如"为什么选择 X 方案"），在 rationale 中注明 "rationale_for:<设计决策描述>"
7. **只提取设计文档中有明确名称的流程或阶段**，不要凭空臆造
8. **nodes 中的 ID 必须来自"代码节点列表"中的真实 ID**，不要使用未列出的 ID
9. 若无法识别任何合法的超边，输出 \`{ "hyperedges": [] }\`

请直接输出 JSON，不要添加其他说明文字。`;
}
