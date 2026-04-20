/**
 * 语义边构建器
 * 从 (DocChunk, CodeNode) 相似对生成 GraphEdge
 * 边类型：references（函数名精确匹配）| conceptually_related_to（向量相似度）
 * 不生成 rationale_for 边（仅由 LLM hyperedge 提取生成，FR-013）
 * 去重：同一三元组 (source, target, relation) 保留 confidence 最高版本（FR-014）
 * evidenceText：对称扩展截断算法（plan.md §9，max 200 字符）
 */
import type { GraphEdge, ConfidenceLevel } from '../graph/graph-types.js';
import type { DocChunk } from './chunker.js';
import type { SimilarPair } from './similarity.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * 代码节点精简信息（buildSemanticEdges 所需字段）
 */
export interface CodeNodeInfo {
  /** 节点 ID（通常为文件路径或元素 ID） */
  id: string;
  /** 节点名称（函数名/变量名等，用于 references 边升级检测） */
  name: string;
}

/**
 * buildSemanticEdges 的输入选项
 */
export interface BuildEdgesOptions {
  /** Markdown 文档 chunks */
  chunks: DocChunk[];
  /** 相似对（从 filterByThreshold 产出） */
  pairs: SimilarPair[];
  /** 代码节点信息数组（需含 id 和 name） */
  codeNodes: CodeNodeInfo[];
  /** 项目根目录（计算 repo-relative 路径） */
  projectRoot: string;
  /** evidenceText 最大字符数（默认 200） */
  maxEvidenceLength?: number;
}

// ============================================================
// Confidence 优先级（用于去重）
// ============================================================

/** ConfidenceLevel 的优先级（数值越大优先级越高） */
const CONFIDENCE_PRIORITY: Record<ConfidenceLevel, number> = {
  EXTRACTED: 3,
  INFERRED: 2,
  AMBIGUOUS: 1,
};

// ============================================================
// 主函数
// ============================================================

/**
 * 从相似对构建语义边数组
 * - 精确匹配函数名 → references
 * - 向量相似度 → conceptually_related_to
 * - 所有 embedding 生成的边 confidence 为 INFERRED
 * - INFERRED 边若无 evidenceText 则丢弃（Risk 1 缓解）
 * - 同一三元组去重，保留 confidence 最高版本（FR-014）
 */
export function buildSemanticEdges(options: BuildEdgesOptions): GraphEdge[] {
  const { chunks, pairs, codeNodes, maxEvidenceLength = 200 } = options;

  if (pairs.length === 0 || chunks.length === 0) {
    return [];
  }

  // 构建 nodeId → CodeNodeInfo 的 Map（快速查找）
  const nodeMap = new Map<string, CodeNodeInfo>();
  for (const node of codeNodes) {
    nodeMap.set(node.id, node);
  }

  // 去重 Map：三元组 key → 候选边
  const dedupeMap = new Map<string, GraphEdge>();

  for (const pair of pairs) {
    const chunk = chunks[pair.chunkIndex];
    if (!chunk) {
      continue;
    }

    const node = nodeMap.get(pair.nodeId);
    if (!node) {
      continue;
    }

    // 决定边类型：chunk 文本中精确包含函数名 → references；否则 → conceptually_related_to
    const relation = containsName(chunk.text, node.name)
      ? 'references'
      : 'conceptually_related_to';

    const confidence: ConfidenceLevel = 'INFERRED';

    // 生成 evidenceText（对称扩展截断）
    const evidenceText = buildEvidenceText(chunk.text, node.name, maxEvidenceLength);

    // INFERRED 边必须有非空 evidenceText，否则丢弃（Risk 1 缓解）
    if (!evidenceText) {
      continue;
    }

    // evidenceSource 格式：repo-relative-path:startLine-endLine
    const evidenceSource = `${chunk.filePath}:${chunk.startLine}-${chunk.endLine}`;

    const edge: GraphEdge = {
      source: chunk.filePath,
      target: node.id,
      relation,
      confidence,
      confidenceScore: pair.similarity,
      evidenceText,
      evidenceSource,
    };

    // 去重 key：(source, target, relation)
    const key = `${edge.source}||${edge.target}||${edge.relation}`;
    const existing = dedupeMap.get(key);

    if (!existing) {
      dedupeMap.set(key, edge);
    } else {
      // 保留 confidence 最高版本（FR-014）
      const existPriority = CONFIDENCE_PRIORITY[existing.confidence] ?? 0;
      const newPriority = CONFIDENCE_PRIORITY[edge.confidence] ?? 0;
      if (newPriority > existPriority) {
        dedupeMap.set(key, edge);
      } else if (newPriority === existPriority) {
        // 同 confidence 保留 confidenceScore 较高的
        if (edge.confidenceScore > (existing.confidenceScore ?? 0)) {
          dedupeMap.set(key, edge);
        }
      }
    }
  }

  return [...dedupeMap.values()];
}

// ============================================================
// evidenceText 截断算法（plan.md §9）
// ============================================================

/**
 * 从 chunk 文本中提取 evidenceText
 * 规则：
 * 1. 若 text 包含 nodeName → 从 match 位置向两侧对称扩展
 * 2. 若无精确 match → 取 chunk 前 maxLength 字符（heading 整行保留）
 * 3. 最终结果截断为 maxLength 字符
 */
export function buildEvidenceText(
  text: string,
  nodeName: string,
  maxLength: number = 200,
): string {
  if (!text.trim()) {
    return '';
  }

  const matchIdx = text.indexOf(nodeName);

  if (matchIdx >= 0) {
    // 从 match 位置向两侧对称扩展
    return symmetricExpand(text, matchIdx, nodeName.length, maxLength);
  } else {
    // 无精确 match：取 chunk 前 maxLength 字符
    return truncateFromStart(text, maxLength);
  }
}

/**
 * 从 match 位置对称扩展，heading 行整行纳入
 */
function symmetricExpand(
  text: string,
  matchIdx: number,
  matchLen: number,
  maxLength: number,
): string {
  const halfWindow = Math.floor(maxLength / 2);
  const start = Math.max(0, matchIdx - halfWindow);
  const end = Math.min(text.length, matchIdx + matchLen + halfWindow);

  let excerpt = text.slice(start, end);

  // 若起始处是行中间，尝试找到行头（保留 heading 行完整）
  if (start > 0) {
    const lineStart = text.lastIndexOf('\n', start);
    const lineEnd = text.indexOf('\n', start);
    // 检查该行是否是 heading 行
    if (lineStart >= 0 && lineEnd >= 0) {
      const lineContent = text.slice(lineStart + 1, lineEnd);
      if (lineContent.startsWith('##')) {
        // heading 行：整行纳入
        excerpt = lineContent + '\n' + text.slice(lineEnd + 1, end);
      }
    }
    // 非 heading：添加省略号
    if (!excerpt.startsWith('##')) {
      excerpt = '...' + excerpt;
    }
  }

  if (end < text.length) {
    excerpt = excerpt + '...';
  }

  // 最终截断保证 ≤ maxLength
  return excerpt.slice(0, maxLength);
}

/**
 * 从文本开头截取，优先保留完整 heading 行
 */
function truncateFromStart(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  // 若文本以 heading 开头，保留 heading 行完整
  const firstNewline = text.indexOf('\n');
  const firstLine = firstNewline >= 0 ? text.slice(0, firstNewline) : text;

  if (firstLine.startsWith('##') && firstLine.length < maxLength) {
    // 保留 heading 行，后续内容截断
    const rest = text.slice(firstNewline + 1, maxLength - firstLine.length - 4);
    return firstLine + '\n' + rest + '...';
  }

  return text.slice(0, maxLength - 3) + '...';
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 检查文本中是否精确包含节点名称（区分大小写，整词匹配优先）
 * 整词匹配：前后是非字母数字下划线的字符（或文本边界）
 */
function containsName(text: string, name: string): boolean {
  if (!name || !text) {
    return false;
  }
  // 先做简单包含检查
  if (!text.includes(name)) {
    return false;
  }
  // 整词边界匹配（兼容中文场景，非严格）
  const idx = text.indexOf(name);
  const before = idx > 0 ? text[idx - 1] : ' ';
  const after = idx + name.length < text.length ? text[idx + name.length] : ' ';
  // 前后字符为非单词字符，或者是字符边界
  const wordBoundaryBefore = before !== undefined && !/[a-zA-Z0-9_]/.test(before);
  const wordBoundaryAfter = after !== undefined && !/[a-zA-Z0-9_]/.test(after);
  return wordBoundaryBefore && wordBoundaryAfter;
}
