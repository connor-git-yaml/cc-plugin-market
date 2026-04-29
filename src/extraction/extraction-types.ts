/**
 * 多模态提取模块核心类型定义（Feature 107）
 * 定义 Zod schema + TypeScript 类型，供提取器和图构建器消费
 */
import { z } from 'zod';

// ============================================================
// ArtifactKind：文件类型分类（分类器使用）
// ============================================================

/**
 * 文件制品类型
 * - document：Markdown 文档
 * - api-spec：OpenAPI / AsyncAPI 规范
 * - image：图像（PNG/JPG/JPEG/SVG 等）
 */
export type ArtifactKind = 'document' | 'api-spec' | 'image';

// ============================================================
// ExtractedNodeKind：提取节点类型（与 GraphNode.kind 新增枚举对齐）
// ============================================================

/**
 * 提取节点类型（对应 GraphNode.kind 新增的四个枚举值 + document）
 * Feature 145：新增 'component'（函数/类符号）和 'module'（文件级模块）以支持 Python AST 桥接
 */
export type ExtractedNodeKind = 'document' | 'api' | 'api-schema' | 'event' | 'diagram' | 'service' | 'component' | 'module';

// ============================================================
// Zod Schema 定义
// ============================================================

/**
 * 提取节点 Zod schema
 * id 由提取器按数据模型规则生成，在同一 ExtractionResult 内唯一
 */
export const ExtractedNodeSchema = z.object({
  /** 全局唯一 ID，格式由提取器按 data-model.md 规则生成 */
  id: z.string(),
  /** 人类可读显示标签 */
  label: z.string(),
  /**
   * 节点类型
   * Feature 145：新增 'component'（函数/类符号）和 'module'（文件级模块）以支持 Python AST 桥接
   */
  kind: z.enum(['document', 'api', 'api-schema', 'event', 'diagram', 'service', 'component', 'module']),
  /** 来源文件路径（提取器内部使用绝对路径，合并到图谱时建议转换为相对路径） */
  source_file: z.string(),
  /** 置信度标签：EXTRACTED（确定性提取）| INFERRED（LLM 推断）| AMBIGUOUS（弱信号） */
  confidence: z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']),
  /** 扩展元数据（type-safe 但不约束 key） */
  metadata: z.record(z.unknown()).optional(),
});

export type ExtractedNode = z.infer<typeof ExtractedNodeSchema>;

/**
 * 提取边 Zod schema
 */
export const ExtractedEdgeSchema = z.object({
  /** 来源节点 ID */
  source: z.string(),
  /** 目标节点 ID */
  target: z.string(),
  /** 关系类型（documents / references / defines / uses-schema / publishes / subscribes / depicts） */
  relation: z.string(),
  /** 置信度标签 */
  confidence: z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']),
  /** 社区检测边权重，默认 1.0（FR-021：统一权重） */
  weight: z.number().default(1.0),
});

export type ExtractedEdge = z.infer<typeof ExtractedEdgeSchema>;

/**
 * 提取结果 Zod schema（一个文件对应一个提取结果）
 */
export const ExtractionResultSchema = z.object({
  nodes: z.array(ExtractedNodeSchema),
  edges: z.array(ExtractedEdgeSchema),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// ============================================================
// 常量
// ============================================================

/**
 * 空提取结果常量（Null Object 模式，所有降级路径统一返回此值）
 * 使用 Object.freeze 确保不可变，调用方不得修改
 */
export const EMPTY_EXTRACTION_RESULT: ExtractionResult = Object.freeze({
  nodes: [],
  edges: [],
});
