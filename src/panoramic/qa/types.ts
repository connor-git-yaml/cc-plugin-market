/**
 * F5 Reading UX 核心类型定义
 * 包含 BatchMode、QnAQuery、QnAAnswer、Citation、GraphContext 等所有 F5 公开类型
 */

// ============================================================
// 轻量模式类型（Story 1）
// ============================================================

/**
 * 批处理运行模式
 * - full：完整文档（默认，行为与旧版等价）
 * - reading：轻量模式，跳过产品文档层生成器
 * - code-only：纯 AST 模式，跳过所有 LLM 推断步骤
 */
export type BatchMode = 'full' | 'reading' | 'code-only';

// ============================================================
// 问答类型（Story 2）
// ============================================================

/**
 * 用户提交的自然语言问题（单轮无状态）
 */
export interface QnAQuery {
  /** 问题文本（不允许空字符串，> 2000 字符时截断） */
  text: string;
  /** 可选：提示查询聚焦的模块名或节点 ID */
  focusNodeId?: string;
}

/**
 * 溯源引用单元
 */
export interface Citation {
  /** repo-relative spec 文件路径 */
  specPath: string;
  /** 行区间（1-based，含边界） */
  lineRange: { startLine: number; endLine: number };
  /** 原文摘要（buildEvidenceText 截断到 200 字符） */
  excerpt: string;
  /** 对应 graph 节点 ID（可选，hyperedge citation 可能无对应节点） */
  nodeId?: string;
  /** 余弦相似度得分（RAG 精排路径下填充） */
  similarity?: number;
}

/**
 * 问答 B+C 混合架构中间态
 */
export interface GraphContext {
  /** BFS 命中的候选节点列表 */
  bfsNodes: Array<{ id: string; label: string; kind: string; specPath?: string }>;
  /** embedding 精排后的 Top-K chunk 列表 */
  topChunks: Array<{ chunk: import('../anchoring/chunker.js').DocChunk; similarity: number }>;
  /** F4 hyperedge 关联信息 */
  hyperedges: Array<import('../graph/graph-types.js').Hyperedge>;
  /** BFS 降级模式标识 */
  fallbackMode?: 'rag-only' | 'bfs-only' | 'graph-insufficient';
}

/**
 * 问答预算配置（record-only 模式，不阻断）
 */
export interface QnABudgetConfig {
  /** hardcode 单次上限：约 $0.05/query（估算 5k input + 1k output tokens） */
  readonly hardcodeLimitUsd: 0.05;
  /** 超额时行为：仅记账不阻断 */
  readonly onOverLimit: 'record-only';
}

/**
 * 问答选项
 */
export interface QnAOptions {
  /** 项目根目录 */
  projectRoot: string;
  /** 图谱数据路径（默认从 projectRoot 推断） */
  graphJsonPath?: string;
  /** BFS 节点预算（默认 20） */
  bfsBudget?: number;
  /** BFS 遍历深度（默认 2） */
  bfsDepth?: number;
  /** embedding 精排相似度阈值（默认 0.70） */
  similarityThreshold?: number;
  /** budget 配置（使用 QnABudgetConfig 默认值） */
  budgetConfig?: Partial<QnABudgetConfig>;
}

/**
 * 问答结果
 */
export interface QnAAnswer {
  /** 回答文本 */
  text: string;
  /** 溯源引用列表（100% 覆盖率要求） */
  citations: Citation[];
  /** LLM token 使用记录 */
  tokenUsage: {
    input: number;
    output: number;
    /** 超额时标记为 true，不阻断调用 */
    overBudget: boolean;
  };
  /** 处理耗时（ms） */
  durationMs: number;
  /** 降级模式（如有） */
  fallbackMode?: GraphContext['fallbackMode'];
}

// ============================================================
// graph.html 配置类型（Story 3）
// ============================================================

/**
 * graph.html 生成配置
 */
export interface GraphHtmlOptions {
  /** force layout 启停阈值（< 2000 启用，≥ 2000 切静态） */
  readonly forceLayoutThreshold: 2000;
  /** 是否渲染 hyperedge 凸包层（默认 true） */
  showHyperedges?: boolean;
  /** 是否启用搜索框（默认 true） */
  enableSearch?: boolean;
  /** 是否启用节点点击跳转 spec 文件（默认 true） */
  enableJumpToSpec?: boolean;
  /** 文件体积警告阈值（字节，默认 5 MB = 5 * 1024 * 1024） */
  fileSizeWarnThreshold?: number;
}
