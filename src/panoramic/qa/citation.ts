/**
 * qa/citation.ts
 * Step 5：Citation 对象构建 + lineRange 越界验证
 *
 * 支持四种 citation 来源路径：
 * 1. Graph-first：解析 evidenceSource "specs/xxx.md:15-18"
 * 2. RAG 精排：DocChunk → buildEvidenceText（节点名称截断提取）
 * 3. Debt：CodeDebtEntry → { specPath, line, excerpt }
 * 4. Hyperedge：{ specPath: '[graph hyperedge]', lineRange: {0,0}, excerpt: he.rationale }
 *
 * lineRange 越界检查（R6 / FR-012）：
 * - 从磁盘读取目标文件的实际行数
 * - 若 startLine/endLine 超出实际行数，记录 warn 并跳过该 citation（不阻断整体问答）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildEvidenceText } from '../anchoring/edge-builder.js';
import type { GraphContext, Citation } from './types.js';
import type { RerankResult } from './rag-reranker.js';
import type { DebtContextResult } from './debt-context.js';

// ============================================================
// 类型定义
// ============================================================

/** 节点元数据（用于 RAG 精排路径 citation 构建） */
export interface BfsNodeInfo {
  id: string;
  label: string;
  kind: string;
  specPath?: string;
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 获取文件的实际行数（用于 lineRange 越界检查）
 * 文件不存在或读取失败时返回 0
 */
function getFileLinesCount(filePath: string, projectRoot: string): number {
  try {
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(projectRoot, filePath);
    const content = fs.readFileSync(absPath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

/**
 * 验证 lineRange 是否在文件实际行数范围内
 * 返回 true 表示合法；false 表示越界（需跳过 + 记录 warn）
 */
function validateLineRange(
  lineRange: { startLine: number; endLine: number },
  filePath: string,
  projectRoot: string,
): boolean {
  // [graph hyperedge] 和 line=0 视为合法（hyperedge 路径）
  if (filePath === '[graph hyperedge]') return true;
  if (lineRange.startLine === 0 && lineRange.endLine === 0) return true;

  const totalLines = getFileLinesCount(filePath, projectRoot);
  if (totalLines === 0) {
    // 文件不存在：记录 warn 但允许（可能是 projectRoot 不匹配的跨仓库引用）
    return true;
  }

  if (lineRange.startLine > totalLines || lineRange.endLine > totalLines) {
    console.warn(
      `[warn] qa/citation: lineRange 越界，跳过 citation。` +
      `文件 ${filePath} 共 ${totalLines} 行，但 lineRange=[${lineRange.startLine},${lineRange.endLine}]`,
    );
    return false;
  }

  return true;
}

/**
 * 解析 evidenceSource 格式 "path:startLine-endLine"
 * 失败时返回 null
 */
function parseEvidenceSource(evidenceSource: string): {
  filePath: string;
  startLine: number;
  endLine: number;
} | null {
  // 格式：repo-relative-path:startLine-endLine
  const lastColon = evidenceSource.lastIndexOf(':');
  if (lastColon < 0) return null;

  const filePart = evidenceSource.slice(0, lastColon);
  const rangePart = evidenceSource.slice(lastColon + 1);
  const dashIdx = rangePart.indexOf('-');
  if (dashIdx < 0) return null;

  const startLine = parseInt(rangePart.slice(0, dashIdx), 10);
  const endLine = parseInt(rangePart.slice(dashIdx + 1), 10);

  if (isNaN(startLine) || isNaN(endLine)) return null;

  return { filePath: filePart, startLine, endLine };
}

// ============================================================
// Citation 构建函数
// ============================================================

/**
 * 从 RerankResult（RAG 精排路径）构建 Citation 列表
 */
function buildRagCitations(
  rerankResult: RerankResult,
  bfsNodes: BfsNodeInfo[],
  projectRoot: string,
): Citation[] {
  const citations: Citation[] = [];
  const nodeMap = new Map(bfsNodes.map((n) => [n.id, n]));

  for (const ranked of rerankResult.rankedChunks) {
    const { chunk, similarity, nodeId } = ranked;
    const node = nodeMap.get(nodeId);
    const nodeName = node?.label ?? nodeId;

    // 使用 buildEvidenceText 生成 excerpt（对称扩展截断）
    const excerpt = buildEvidenceText(chunk.text, nodeName, 200);

    const lineRange = { startLine: chunk.startLine, endLine: chunk.endLine };

    // lineRange 越界检查（R6）
    if (!validateLineRange(lineRange, chunk.filePath, projectRoot)) {
      continue;
    }

    citations.push({
      specPath: chunk.filePath,
      lineRange,
      excerpt: excerpt || chunk.text.slice(0, 200),
      nodeId,
      similarity,
    });
  }

  return citations;
}

/**
 * 从 GraphContext 的 bfsNodes（Graph-first 路径）构建 Citation 列表
 * 基于节点的 specPath 字段（若有 evidenceSource 格式则解析行号）
 */
function buildGraphCitations(
  graphCtx: GraphContext,
  projectRoot: string,
): Citation[] {
  const citations: Citation[] = [];

  for (const node of graphCtx.bfsNodes) {
    if (!node.specPath) continue;

    // 尝试解析 specPath 中是否带有行号信息（格式 path:start-end）
    const parsed = parseEvidenceSource(node.specPath);
    if (parsed) {
      const lineRange = { startLine: parsed.startLine, endLine: parsed.endLine };
      if (!validateLineRange(lineRange, parsed.filePath, projectRoot)) {
        continue;
      }
      citations.push({
        specPath: parsed.filePath,
        lineRange,
        excerpt: `[来自 ${node.label} 节点]`,
        nodeId: node.id,
      });
    } else {
      // 无行号信息：用 specPath 作为文件引用，lineRange 取第一行
      const lineRange = { startLine: 1, endLine: 1 };
      citations.push({
        specPath: node.specPath,
        lineRange,
        excerpt: `[来自 ${node.label} 节点]`,
        nodeId: node.id,
      });
    }
  }

  return citations;
}

/**
 * 从 Hyperedge 列表构建 Citation 列表（Hyperedge 路径）
 */
function buildHyperedgeCitations(graphCtx: GraphContext): Citation[] {
  return graphCtx.hyperedges.map((he) => ({
    specPath: '[graph hyperedge]',
    lineRange: { startLine: 0, endLine: 0 },
    excerpt: he.rationale.slice(0, 200),
    nodeId: undefined,
  }));
}

// ============================================================
// 主函数
// ============================================================

/**
 * 构建完整的 Citation 列表
 * 合并四种路径：Graph-first（bfsNodes.specPath）、RAG 精排、Debt、Hyperedge
 *
 * @param rerankResult - rag-reranker 的输出（含精排 chunks）
 * @param graphCtx - graph-retriever 的输出（含 bfsNodes + hyperedges）
 * @param debtCitations - debt-context 的输出（已是 Citation[] 格式）
 * @param projectRoot - 项目根目录（用于 lineRange 越界检查的文件读取）
 * @returns 合并后的 Citation[]（过滤越界，保留合法条目）
 */
export function buildCitations(
  rerankResult: RerankResult,
  graphCtx: GraphContext,
  debtCitations: Citation[],
  projectRoot: string,
): Citation[] {
  // RAG 精排路径 citation（优先级最高）
  const ragCitations = buildRagCitations(rerankResult, graphCtx.bfsNodes, projectRoot);

  // Graph-first 路径 citation（BFS 节点 specPath）
  const graphCitations = buildGraphCitations(graphCtx, projectRoot);

  // Hyperedge 路径 citation
  const hyperedgeCitations = buildHyperedgeCitations(graphCtx);

  // 合并所有 citations（RAG > Graph > Debt > Hyperedge）
  return [
    ...ragCitations,
    ...graphCitations,
    ...debtCitations,
    ...hyperedgeCitations,
  ];
}
