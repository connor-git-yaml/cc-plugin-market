/**
 * Hyperedge Extractor
 *
 * 通过 LLM（Anthropic SDK）从 design-doc 中提取超边（hyperedge）。
 *
 * 架构决策（analyze F06）：
 * - feature flag 作为 boolean 参数传入，extractor 不读取 process.env 或 argv
 * - CLI 层面（doc-graph-builder.ts）负责从 SPECTRA_HYPEREDGES_ENABLED env + --hyperedges CLI 合并后传入
 *
 * 失败处理策略：
 * - Zod 校验失败：静默丢弃，写入 failedSamples + trace 日志
 * - 整 batch 失败：返回空数组，不抛出异常
 * - LLM 网络错误：抛出异常（由上层处理）
 * - 所有 nodes 均为文档类节点：语义校验过滤，返回空数组
 */
import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { GraphNode, Hyperedge } from '../graph/graph-types.js';
import type { DocChunk } from '../anchoring/chunker.js';
import type { EmbeddingTokenUsage } from '../anchoring/embedding-provider.js';
import { buildHyperedgePrompt } from './prompt.js';
import { HyperedgesOutputSchema } from './schema.js';
import { extractJsonArray } from '../utils/llm-facade.js';

// ============================================================
// 视为"文档类节点"的 kind 集合（不参与代码节点语义校验）
// ============================================================

/** 文档类节点 kind：这类节点不算"代码节点" */
const DOC_NODE_KINDS = new Set<GraphNode['kind']>(['spec', 'document']);

// ============================================================
// 对外接口类型
// ============================================================

/**
 * extractHyperedges 的输入选项
 */
export interface ExtractHyperedgesOptions {
  /**
   * feature flag：是否启用 hyperedge 提取
   * 由 caller（doc-graph-builder.ts）从 env + CLI 合并后传入
   * extractor 本身不读取 process.env 或 argv
   */
  enabled: boolean;
  /** 图谱代码节点列表（用于构造 prompt + 语义校验） */
  codeNodes: GraphNode[];
  /** 文档切片列表（来自 chunkMarkdownFiles） */
  docChunks: DocChunk[];
  /** 可选的项目摘要（帮助 LLM 理解上下文） */
  projectSummary?: string;
  /** Anthropic SDK 客户端实例（由 caller 传入，便于测试 mock） */
  anthropicClient: Anthropic;
  /** LLM 模型 ID，默认 claude-haiku-4-5-20251001 */
  model?: string;
}

/**
 * extractHyperedges 的返回值
 */
export interface ExtractResult {
  /** 提取并通过校验的超边列表 */
  hyperedges: Hyperedge[];
  /**
   * LLM 调用的 token 使用记录（与 EmbeddingTokenUsage 格式兼容）
   * feature flag 关闭时为空数组
   */
  usage: EmbeddingTokenUsage[];
  /**
   * Zod 校验失败的原始样本
   * 用于 trace 日志记录
   */
  failedSamples: Array<{ raw: unknown; errors: z.ZodError }>;
}

// ============================================================
// 默认配置
// ============================================================

/** 默认 LLM 模型（Haiku，成本低，适合结构化提取） */
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/** LLM 最大输出 token 数 */
const MAX_TOKENS = 2048;

/** LLM 温度（低温，提高结构化输出稳定性） */
const TEMPERATURE = 0.1;

// ============================================================
// 主函数
// ============================================================

/**
 * 从 design-doc 中提取 hyperedge 超边
 *
 * 步骤：
 * 1. 检查 feature flag，关闭时直接返回空结果
 * 2. 检查 docChunks，无文档内容时直接返回空结果
 * 3. 构造 LLM prompt
 * 4. 调用 Anthropic SDK，记录 tokenUsage
 * 5. 解析 JSON 响应
 * 6. HyperedgesOutputSchema.safeParse 校验
 * 7. 语义校验：每条 hyperedge 的 nodes 中至少 1 个为代码节点
 * 8. 返回合法 hyperedge 列表
 *
 * @param options ExtractHyperedgesOptions
 * @returns ExtractResult
 */
export async function extractHyperedges(
  options: ExtractHyperedgesOptions,
): Promise<ExtractResult> {
  const {
    enabled,
    codeNodes,
    docChunks,
    projectSummary,
    anthropicClient,
    model = DEFAULT_MODEL,
  } = options;

  // Step 1：feature flag 关闭 → 提前返回空结果
  if (!enabled) {
    return { hyperedges: [], usage: [], failedSamples: [] };
  }

  // Step 2：无文档内容 → 提前返回空结果（FR-015 零 doc chunk 降级）
  if (docChunks.length === 0) {
    return { hyperedges: [], usage: [], failedSamples: [] };
  }

  // Step 3：构造 prompt
  const prompt = buildHyperedgePrompt(codeNodes, docChunks, projectSummary);

  // Step 4：调用 LLM，记录 tokenUsage 和耗时
  const startMs = performance.now();
  let rawContent: string;
  let inputTokens: number;
  let outputTokens: number;

  const response = await anthropicClient.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    messages: [{ role: 'user', content: prompt }],
  });

  const durationMs = performance.now() - startMs;

  rawContent = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  inputTokens = response.usage.input_tokens;
  outputTokens = response.usage.output_tokens;

  const tokenUsage: EmbeddingTokenUsage = {
    llmModel: model,
    inputTokens,
    outputTokens,
    durationMs,
  };

  // Step 5：解析 JSON
  let parsedRaw: unknown;
  try {
    parsedRaw = extractJsonArray(rawContent);
    // extractJsonArray 期望返回数组，但 LLM 输出是 { hyperedges: [] } 对象
    // 需要特殊处理：尝试直接 JSON.parse
  } catch {
    // extractJsonArray 可能失败（LLM 返回对象而不是数组），尝试直接 parse
    try {
      parsedRaw = JSON.parse(rawContent);
    } catch {
      // JSON 解析失败 → trace 日志，返回空结果
      console.error('[hyperedges/extractor] LLM 返回无效 JSON，原始内容:', rawContent.slice(0, 200));
      return {
        hyperedges: [],
        usage: [tokenUsage],
        failedSamples: [{ raw: rawContent, errors: new Error('JSON 解析失败') as unknown as z.ZodError }],
      };
    }
  }

  // 如果 extractJsonArray 返回数组（兜底），包装为正确格式
  if (Array.isArray(parsedRaw)) {
    parsedRaw = { hyperedges: parsedRaw };
  }

  // Step 6：Zod schema 校验（schema 层：结构 + label ≤ 8 + nodes ≥ 3 + batch ≤ 10）
  const parseResult = HyperedgesOutputSchema.safeParse(parsedRaw);

  if (!parseResult.success) {
    // 校验失败 → trace 日志，返回空结果
    console.error(
      '[hyperedges/extractor] Zod 校验失败:',
      parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
    console.error('[hyperedges/extractor] 原始输出:', JSON.stringify(parsedRaw).slice(0, 300));
    return {
      hyperedges: [],
      usage: [tokenUsage],
      failedSamples: [{ raw: parsedRaw, errors: parseResult.error }],
    };
  }

  // Step 7：语义校验——每条 hyperedge 至少 1 个代码节点（FR-020）
  // 构造当前代码节点 ID set（kind 不在 DOC_NODE_KINDS 中的节点）
  const codeNodeIdSet = new Set(
    codeNodes.filter((n) => !DOC_NODE_KINDS.has(n.kind)).map((n) => n.id),
  );

  const semanticallyValid: Hyperedge[] = [];
  for (const he of parseResult.data.hyperedges) {
    const hasCodeNode = he.nodes.some((nodeId) => codeNodeIdSet.has(nodeId));
    if (!hasCodeNode) {
      // 语义校验失败：全部节点为文档类节点，trace 日志
      console.error(
        `[hyperedges/extractor] hyperedge "${he.id}" (label: "${he.label}") 语义校验失败：nodes 中无代码节点，已丢弃`,
      );
      continue;
    }
    // 转换为 Hyperedge 类型（结构兼容，直接使用）
    semanticallyValid.push({
      id: he.id,
      label: he.label,
      nodes: he.nodes,
      rationale: he.rationale,
      confidence: he.confidence,
    });
  }

  return {
    hyperedges: semanticallyValid,
    usage: [tokenUsage],
    failedSamples: [],
  };
}
