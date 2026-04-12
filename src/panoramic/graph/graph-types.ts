/**
 * 知识图谱核心类型定义
 * 定义 GraphNode、GraphEdge、GraphJSON、ConfidenceLevel 等图谱数据模型
 * 遵循 NetworkX node-link 格式，供下游 Feature 102/105/107 消费
 */

// ============================================================
// 置信度类型
// ============================================================

/**
 * 统一三级置信度标签
 * - EXTRACTED：AST 直接提取的确定性关系（import、call、contains）
 * - INFERRED：LLM 推理的语义关系
 * - AMBIGUOUS：弱信号、间接引用
 */
export type ConfidenceLevel = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

// ============================================================
// 图节点与边类型
// ============================================================

/**
 * 图谱节点
 * 表示模块、包、组件、Spec 文档等知识实体
 */
export interface GraphNode {
  /** 节点唯一标识符，通常为文件路径或元素 ID */
  id: string;
  /** 节点类型：模块 / 包 / 组件 / Spec 文档 / 通用文档 */
  kind: 'module' | 'package' | 'component' | 'spec' | 'document';
  /** 显示标签，人类可读名称 */
  label: string;
  /** 附加元数据（来源标记、technology 等扩展信息） */
  metadata: Record<string, unknown>;
}

/**
 * 图谱边（关系）
 * 表示节点之间的有向或无向关系
 */
export interface GraphEdge {
  /** 来源节点 ID */
  source: string;
  /** 目标节点 ID */
  target: string;
  /** 关系类型（来自 ArchitectureIRRelationshipKind 或 DocGraphReference.kind 等） */
  relation: string;
  /** 统一三级置信度标签 */
  confidence: ConfidenceLevel;
  /** 置信度数值分数，范围 [0.0, 1.0] */
  confidenceScore: number;
}

// ============================================================
// 图谱 JSON 输出格式（NetworkX node-link 兼容）
// ============================================================

/**
 * 图谱 JSON 输出格式
 * 严格遵循 NetworkX node-link 格式，可通过 nx.json_graph.node_link_graph() 无错加载
 */
export interface GraphJSON {
  /** 是否有向图（默认 false，无向图） */
  directed: boolean;
  /** 是否多重图（本 Feature 固定为 false） */
  multigraph: false;
  /** 图级元数据 */
  graph: {
    /** 图谱名称，固定为 'spectra-knowledge-graph' */
    name: 'spectra-knowledge-graph';
    /** ISO 8601 生成时间戳 */
    generatedAt: string;
    /** 节点总数 */
    nodeCount: number;
    /** 边总数 */
    edgeCount: number;
    /** 图构建使用的数据源列表 */
    sources: ('architecture-ir' | 'doc-graph' | 'cross-reference')[];
    /** 被跳过的数据源及原因（容错标注） */
    skippedSources?: Array<{
      source: string;
      reason: string;
    }>;
    /** Feature 100 cache：输入内容 hash（SHA-256 前 16 位） */
    inputHash?: string;
    /** graph.json 格式版本号，用于下游 Feature 兼容性判断 */
    schemaVersion: '1.0';
  };
  /** 节点数组 */
  nodes: GraphNode[];
  /** 边数组（NetworkX node-link 格式使用 "links" 键） */
  links: GraphEdge[];
}

// ============================================================
// 图构建选项
// ============================================================

/**
 * buildKnowledgeGraph 的输入选项
 * 所有数据源字段均可选，缺失时 graceful skip
 * 使用宽松类型（unknown 基础结构）避免循环依赖，
 * graph-builder.ts 内部使用 as 转换为具体类型
 */
export interface BuildGraphOptions {
  /** Architecture IR 数据（可选，缺失时跳过 IR 节点和关系） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  architectureIR?: any;
  /** Doc Graph 数据（可选，缺失时跳过文档节点） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  docGraph?: any;
  /** Cross Reference Link 列表（可选，缺失时跳过跨引用边） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  crossReferenceLinks?: any[];
  /** 是否生成有向图，默认 false */
  directed?: boolean;
}
