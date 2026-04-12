/**
 * 置信度映射器
 * 将各数据源的置信度表达统一映射到三级标签（EXTRACTED / INFERRED / AMBIGUOUS）
 * 供 graph-builder 使用
 */
import type { ConfidenceLevel } from './graph-types.js';

/**
 * 置信度级别到默认数值分数的映射表
 * - EXTRACTED：0.95（AST 直接提取，高确定性）
 * - INFERRED：0.65（LLM 推理，中等置信度）
 * - AMBIGUOUS：0.25（弱信号，低置信度）
 */
export const CONFIDENCE_SCORES: Record<ConfidenceLevel, number> = {
  EXTRACTED: 0.95,
  INFERRED: 0.65,
  AMBIGUOUS: 0.25,
};

/**
 * 将 DocGraphSpecNode.confidence 字符串映射到统一 ConfidenceLevel
 * - 'high'   → 'EXTRACTED'（高置信度，AST 直接提取或明确标注）
 * - 'medium' → 'INFERRED'（中等置信度，LLM 推理）
 * - 'low'    → 'AMBIGUOUS'（低置信度，弱信号）
 * - undefined → 'INFERRED'（未标注时保守推断为中等置信度）
 *
 * @param docConfidence - DocGraphSpecNode 的 confidence 字段值
 * @returns 统一三级置信度标签
 */
export function mapDocConfidence(
  docConfidence: 'high' | 'medium' | 'low' | undefined,
): ConfidenceLevel {
  switch (docConfidence) {
    case 'high':
      return 'EXTRACTED';
    case 'medium':
      return 'INFERRED';
    case 'low':
      return 'AMBIGUOUS';
    default:
      // 未标注时保守推断为 INFERRED
      return 'INFERRED';
  }
}

/**
 * 基于证据数量推断置信度
 * 统一用于 DocGraphReference 和 CrossReferenceLink，两者 evidenceCount 语义相同
 * （均表示引用证据条数），因此共用同一阈值逻辑，不做冗余拆分。
 *
 * 阈值规则：
 * - evidenceCount >= 3 → 'EXTRACTED'（多条证据，高置信度）
 * - evidenceCount >= 1 → 'INFERRED'（有证据但不充分，中等置信度）
 * - evidenceCount < 1  → 'AMBIGUOUS'（无证据，弱信号）
 *
 * @param evidenceCount - 引用证据数量
 * @returns 统一三级置信度标签
 */
export function mapEvidenceConfidence(evidenceCount: number): ConfidenceLevel {
  if (evidenceCount >= 3) return 'EXTRACTED';
  if (evidenceCount >= 1) return 'INFERRED';
  return 'AMBIGUOUS';
}
