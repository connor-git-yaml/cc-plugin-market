/**
 * Hyperedge Zod schema 定义
 *
 * 校验 LLM 输出的超边结构，确保：
 * - label 最多 8 个 Unicode 字符
 * - nodes 至少 3 个（语义上混合节点约束由 extractor.ts 做语义校验）
 * - rationale 非空且最多 200 字符
 * - confidence 为三级枚举之一
 * - 每 batch 最多 10 个 hyperedge（FR-018）
 */
import { z } from 'zod';

// ============================================================
// 单条 Hyperedge schema
// ============================================================

/**
 * 单条超边的 Zod schema
 *
 * label 使用 refine 做严格 Unicode grapheme 计数（每个中文字符算 1 个）
 */
export const HyperedgeSchema = z.object({
  /** 超边唯一标识符 */
  id: z.string().min(1),
  /** 超边标签：最多 8 个 Unicode 字符 */
  label: z
    .string()
    .min(1, { message: 'hyperedge label 不能为空' })
    .refine((v) => [...v].length <= 8, { message: 'hyperedge label 最多 8 个 Unicode 字符' }),
  /** 参与节点 ID 列表：至少 3 个 */
  nodes: z
    .array(z.string().min(1))
    .min(3, { message: 'hyperedge nodes 至少需要 3 个节点' }),
  /** LLM 提取的设计依据：非空，最多 200 字符 */
  rationale: z
    .string()
    .min(1, { message: 'hyperedge rationale 不能为空' })
    .max(200, { message: 'hyperedge rationale 最多 200 字符' }),
  /** 置信度：三级枚举 */
  confidence: z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']),
});

// ============================================================
// Batch 输出 schema（每 batch 最多 10 条）
// ============================================================

/**
 * LLM batch 输出的 Zod schema
 * LLM 需返回包含 hyperedges 数组的 JSON 对象
 */
export const HyperedgesOutputSchema = z.object({
  hyperedges: z
    .array(HyperedgeSchema)
    .max(10, { message: '每 batch 最多 10 个 hyperedge' }),
});

// ============================================================
// 推断类型
// ============================================================

/** 单条 hyperedge 的输入类型（Zod 推断） */
export type HyperedgeInput = z.infer<typeof HyperedgeSchema>;

/** LLM batch 输出类型（Zod 推断） */
export type HyperedgeOutput = z.infer<typeof HyperedgesOutputSchema>;
