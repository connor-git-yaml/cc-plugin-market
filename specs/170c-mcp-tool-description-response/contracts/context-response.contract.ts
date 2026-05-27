/**
 * F170c — `context` tool response 契约
 *
 * Producer（handleContext）在 success 路径 MUST 总是产出以下新增字段。
 * Schema 侧声明为 optional，兼容旧 consumer（FR-014）。
 *
 * 注意：此文件仅作为契约说明，不用于运行时导入。
 * 实际类型定义在 src/mcp/lib/response-helpers.ts。
 */

import type { TopRelevantCaller } from '../../../src/mcp/lib/response-helpers.js';

/**
 * context tool response 新增字段（F170c Phase B）
 */
export interface ContextResponseEnrichment {
  /**
   * 关键调用方排名（按 confidence 降序），最多 3 项。
   * 当前公式：score = confidence（distance=1 时 0.7+0.3 权重退化为纯 confidence 排序）。
   * success 路径 MUST 产出。
   */
  topRelevantCallers?: TopRelevantCaller[];

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

// 向后兼容声明：context tool 不产出 riskTier（仅 detect_changes）
// 不产出 topImpacted（仅 impact 和 detect_changes）
// 现有字段：definition, callers, callees, imports, relatedSpec 结构不变（FR-012）
