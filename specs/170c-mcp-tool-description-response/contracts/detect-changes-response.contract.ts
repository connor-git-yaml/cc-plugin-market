/**
 * F170c — `detect_changes` tool response 契约
 *
 * Producer（handleDetectChanges）在 success 路径 MUST 总是产出以下新增字段。
 * Schema 侧声明为 optional，兼容旧 consumer（FR-014）。
 *
 * 注意：此文件仅作为契约说明，不用于运行时导入。
 * 实际类型定义在 src/mcp/lib/response-helpers.ts。
 */

import type { TopImpacted } from '../../../src/mcp/lib/response-helpers.js';

/**
 * detect_changes tool response 新增字段（F170c Phase B）
 *
 * 重要：现有 riskSummary.riskTier（嵌套字段）保持不变（FR-012）。
 * 此处的顶层 riskTier 是新增的独立字段，值与 riskSummary.riskTier 相同，
 * 目的是为 driver 提供快速访问路径（避免解析嵌套对象）。
 */
export interface DetectChangesResponseEnrichment {
  /**
   * 顶层风险等级（新增，FR-008）。
   * 值始终 mirror riskSummary.riskTier，不独立计算。
   *
   * 三路径行为（修订：响应 codex C-1）：
   * - success：= riskSummary.riskTier（真实值）
   * - enrichment degraded：= riskSummary.riskTier（仍真实，主流程未受影响）
   * - handler error：不出现
   *
   * 注意：不实施 spec Tool×Path 矩阵的 "low" fallback（mirror 更安全，
   * 避免顶层和嵌套字段语义分叉）。详见 plan.md D 节修订。
   *
   * success 与 degraded 路径 MUST 产出。
   */
  riskTier?: 'low' | 'medium' | 'high';

  /** 受影响节点排名（按 score = 1/depth 降序），最多 5 项。success 路径 MUST 产出。 */
  topImpacted?: TopImpacted[];

  /**
   * 下一步引导文本（中文），success 路径 MUST 为非空字符串（≥5 字符）。
   * enrichment degraded 路径允许为空字符串 ""，但字段不可缺失。
   */
  nextStepHint?: string;

  /**
   * enrichment 降级标志。主流程成功 + enrichment 计算抛异常时为 true。
   * success 路径缺失此字段。handler error 路径也缺失此字段。
   */
  _enrichmentDegraded?: true;
}

// 向后兼容声明：现有字段结构不变
// - changedSymbols[i]: { file, changeKind, symbols } 结构不变（FR-012）
// - riskSummary: { totalChanged, totalAffected, riskTier } 结构不变（FR-012）
// - affectedSymbols, unmappedFiles, effectiveBudget, effectiveDepth, warnings 均不变
