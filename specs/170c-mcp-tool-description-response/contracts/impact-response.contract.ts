/**
 * F170c — `impact` tool response 契约
 *
 * Producer（handleImpact）在 success 路径 MUST 总是产出以下新增字段。
 * Schema 侧声明为 optional，兼容旧 consumer（FR-014）。
 *
 * 注意：此文件仅作为契约说明，不用于运行时导入。
 * 实际类型定义在 src/mcp/lib/response-helpers.ts。
 */

import type { TopImpacted } from '../../../src/mcp/lib/response-helpers.js';

/**
 * impact tool response 新增字段（F170c Phase B）
 *
 * - 新字段均为 optional（schema 合同），但 producer 在 success 路径 MUST 产出
 * - handler error 路径：不包含任何以下字段（FR-013）
 * - enrichment degraded 路径：topImpacted=[], nextStepHint="", _enrichmentDegraded=true
 */
export interface ImpactResponseEnrichment {
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

// 向后兼容声明：impact tool 不产出 riskTier 顶层字段（仅 detect_changes 产出）
// 不产出 topRelevantCallers（仅 context 产出）
