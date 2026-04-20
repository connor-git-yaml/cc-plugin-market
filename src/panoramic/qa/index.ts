/**
 * qa/index.ts
 * 公开 API 汇聚点：answerQuestion()
 *
 * 职责：
 * - 入参校验（空字符串拒绝、> 2000 字符截断）
 * - 空图谱检查（nodes.length === 0 时返回友好提示）
 * - 串联 7 步 pipeline：
 *   Step 1-2：graph-retriever（BFS + hyperedge 扩展）
 *   Step 3：rag-reranker（chunk 切分 + embedding 精排）
 *   Step 4：debt-context（债务上下文注入）
 *   Step 5：citation（Citation 构建 + lineRange 验证）
 *   Step 6：prompt-builder（LLM prompt 组装）
 *   Step 7：llm-caller（budget-gate + Anthropic SDK 调用）
 * - 结构化日志（F-015 LOW）：BFS 命中数、fallbackMode、各步耗时、总 durationMs
 */
import { GraphQueryEngine } from '../graph/graph-query.js';
import { resolveGraphJsonPath } from '../graph/graph-paths.js';
import { retrieveGraphContext } from './graph-retriever.js';
import { rerankWithEmbedding } from './rag-reranker.js';
import { injectDebtContext } from './debt-context.js';
import { buildCitations } from './citation.js';
import { buildQnAPrompt } from './prompt-builder.js';
import { callQnALlm } from './llm-caller.js';
import type { QnAQuery, QnAAnswer, QnAOptions } from './types.js';

// ============================================================
// 常量
// ============================================================

/** 问题最大字符数，超出时截断 */
const MAX_QUERY_LENGTH = 2000;

// ============================================================
// 引擎缓存（模块级，按 projectRoot 缓存，避免重复加载 graph.json）
// ============================================================

const engineCache = new Map<string, GraphQueryEngine>();

/**
 * 获取 GraphQueryEngine 实例（按 projectRoot 缓存）
 * 图谱文件不存在时抛出 Error（明确告知用户需要先生成图谱）
 */
function getEngine(projectRoot: string, graphJsonPath?: string): GraphQueryEngine {
  const graphPath = graphJsonPath ?? resolveGraphJsonPath(projectRoot);
  const cacheKey = graphPath;

  let engine = engineCache.get(cacheKey);
  if (!engine) {
    engine = GraphQueryEngine.loadFromFile(graphPath);
    engineCache.set(cacheKey, engine);
  }
  return engine;
}

/**
 * 测试专用：清除引擎缓存
 */
export function clearEngineCache(): void {
  engineCache.clear();
}

// ============================================================
// 主函数
// ============================================================

/**
 * 自然语言问答 — 公开 API
 *
 * 7 步 pipeline：
 * 1-2. GraphRetriever：BFS 候选节点 + hyperedge 扩展
 * 3.   RAGReranker：chunk 切分 + embedding 精排
 * 4.   DebtContext：债务上下文注入（按关键词路由）
 * 5.   Citation：构建溯源引用列表
 * 6.   PromptBuilder：组装 LLM prompt
 * 7.   LLMCaller：budget-gate + Anthropic SDK 调用
 *
 * @param query - 用户问题（含 text + 可选 focusNodeId）
 * @param options - 问答选项（projectRoot 等）
 * @returns QnAAnswer（含 text、citations、tokenUsage、durationMs）
 * @throws InvalidQueryError 当 query.text 为空字符串时
 */
export async function answerQuestion(
  query: QnAQuery,
  options: QnAOptions,
): Promise<QnAAnswer> {
  const t0 = Date.now();

  // ── 入参校验 ──────────────────────────────────────────────

  // Edge Case 3：空字符串查询直接拒绝
  if (!query.text || query.text.trim().length === 0) {
    throw new Error('问题不能为空，请提供有效的查询文本');
  }

  // Edge Case 4：> 2000 字符截断并 warn
  let questionText = query.text;
  if (questionText.length > MAX_QUERY_LENGTH) {
    console.warn(
      `[warn] qa/index: 问题文本超过 ${MAX_QUERY_LENGTH} 字符，已截断为前 ${MAX_QUERY_LENGTH} 字符。` +
      `原始长度：${questionText.length}`,
    );
    questionText = questionText.slice(0, MAX_QUERY_LENGTH);
  }

  const { projectRoot, graphJsonPath, bfsBudget, bfsDepth, similarityThreshold } = options;

  // ── 加载图谱引擎 ──────────────────────────────────────────

  let engine: GraphQueryEngine;
  try {
    engine = getEngine(projectRoot, graphJsonPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[warn] qa/index: 图谱加载失败，返回空图谱提示。原因：${message}`);
    return {
      text: '图谱为空或无法加载，无法回答该问题。请先运行 `spectra graph` 生成图谱。',
      citations: [],
      tokenUsage: { input: 0, output: 0, overBudget: false },
      durationMs: Date.now() - t0,
      fallbackMode: 'graph-insufficient',
    };
  }

  // ── Step 1-2：Graph BFS + hyperedge 扩展 ─────────────────

  const t1 = Date.now();
  const graphCtx = retrieveGraphContext(questionText, engine, {
    budget: bfsBudget,
    depth: bfsDepth,
  });
  const retrieverMs = Date.now() - t1;

  // Edge Case 1：空图谱（BFS 命中 0 节点）
  if (graphCtx.bfsNodes.length === 0) {
    console.info(
      `[info] qa: 图谱为空，bfs_hits=0, duration_retriever=${retrieverMs}ms, total=${Date.now() - t0}ms`,
    );
    return {
      text: '图谱为空，无法回答该问题。图谱可能尚未生成或不包含任何节点。',
      citations: [],
      tokenUsage: { input: 0, output: 0, overBudget: false },
      durationMs: Date.now() - t0,
      fallbackMode: graphCtx.fallbackMode,
    };
  }

  // 结构化日志：BFS 命中数和 fallbackMode
  console.info(
    `[info] qa: bfs_hits=${graphCtx.bfsNodes.length}, ` +
    `hyperedges=${graphCtx.hyperedges.length}, ` +
    `fallback=${graphCtx.fallbackMode ?? 'none'}, ` +
    `retriever_ms=${retrieverMs}`,
  );

  // ── Step 3：RAG embedding 精排 ────────────────────────────

  const t2 = Date.now();

  // 收集 BFS 节点对应的 spec 文件路径（过滤无 specPath 的节点）
  const specPaths = graphCtx.bfsNodes
    .filter((n) => !!n.specPath)
    .map((n) => n.specPath!)
    // 去重
    .filter((p, i, arr) => arr.indexOf(p) === i);

  const rerankResult = await rerankWithEmbedding(
    graphCtx,
    specPaths,
    questionText,
    projectRoot,
    { similarityThreshold },
  );
  const embeddingMs = Date.now() - t2;

  // 将精排结果合并到 graphCtx.topChunks（供下游使用）
  graphCtx.topChunks = rerankResult.rankedChunks.map((r) => ({
    chunk: r.chunk,
    similarity: r.similarity,
  }));

  // 若 rag-reranker 降级为 bfs-only，更新 fallbackMode
  if (rerankResult.fallbackMode === 'bfs-only') {
    graphCtx.fallbackMode = 'bfs-only';
  }

  console.info(`[info] qa: embedding_chunks=${rerankResult.rankedChunks.length}, embedding_ms=${embeddingMs}`);

  // ── Step 4：debt 上下文注入 ───────────────────────────────

  // 注意：scanProjectDebt 需要 registry，但 QnAOptions 未提供
  // 此处传入 null registry，injectDebtContext 中有 try/catch 保护
  // plan §7 说明：F5 问答仅需 AST 扫描，registry 不参与债务扫描的核心逻辑
  const debtResult = await injectDebtContext(
    questionText,
    projectRoot,
    // registry 设为 undefined cast，scanProjectDebt 内部 dryRun=true 时不依赖 registry
    undefined as unknown as Parameters<typeof injectDebtContext>[2],
  );

  // ── Step 5：Citation 构建 ─────────────────────────────────

  const citations = buildCitations(rerankResult, graphCtx, debtResult.citations, projectRoot);

  // ── Step 6：LLM prompt 组装 ───────────────────────────────

  const prompt = buildQnAPrompt(graphCtx, citations, questionText);

  // ── Step 7：LLM 调用 ──────────────────────────────────────

  const t3 = Date.now();
  let llmResult;
  try {
    llmResult = await callQnALlm(prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[error] qa/index: LLM 调用失败。原因：${message}`);
    throw new Error(`问答 LLM 调用失败：${message}`);
  }
  const llmMs = Date.now() - t3;

  const totalMs = Date.now() - t0;
  console.info(
    `[info] qa: llm_ms=${llmMs}, total_ms=${totalMs}, ` +
    `input_tokens=${llmResult.tokenUsage.input}, output_tokens=${llmResult.tokenUsage.output}, ` +
    `over_budget=${llmResult.tokenUsage.overBudget}`,
  );

  // ── 合并 citations：优先使用 LLM 解析的 citations，若为空则用构建的 citations ──

  const finalCitations =
    llmResult.parsedCitations.length > 0
      ? llmResult.parsedCitations
      : citations;

  return {
    text: llmResult.answer,
    citations: finalCitations,
    tokenUsage: llmResult.tokenUsage,
    durationMs: totalMs,
    fallbackMode: graphCtx.fallbackMode,
  };
}
