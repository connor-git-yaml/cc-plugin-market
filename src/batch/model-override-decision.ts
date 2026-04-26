/**
 * 模块 spec 主调用的 model override 决策（Fix 134 提取）
 *
 * 三种触发条件，任一为真即覆盖默认 model 为 sonnet：
 * - 小模块优化（isSmallModule）：文件数 ≤ 2 且总行数 < 200，sonnet 质量足够
 * - 预算 gate 降级（budgetCheaperModelAll）：预算 gate 决定全部模块走更便宜的模型
 * - reading / code-only 模式（effectiveMode !== 'full'）：Fix 134 P0-3 — reading
 *   模式 SC-001 < 120s 的硬指标必须始终满足，与用户配置默认 model 解耦
 */
import type { BatchMode } from '../panoramic/qa/types.js';

export interface ModelOverrideDecisionInput {
  /** 是否为小模块（文件数 ≤ 2 且总行数 < 200） */
  isSmallModule: boolean;
  /** 预算 gate 是否决定全部模块走更便宜的模型 */
  budgetCheaperModelAll: boolean;
  /** 当前 batch 运行模式（full / reading / code-only） */
  effectiveMode: BatchMode;
  /** 用作 override 的 sonnet 模型 ID（由 resolveReverseSpecModel 解析） */
  sonnetModelId: string;
}

/**
 * 决策模块 spec 主调用是否需要 model override。
 *
 * @returns sonnetModelId 表示需要 override；undefined 表示沿用默认 model
 */
export function decideModelOverride(input: ModelOverrideDecisionInput): string | undefined {
  const { isSmallModule, budgetCheaperModelAll, effectiveMode, sonnetModelId } = input;
  const isReadingOrCodeOnly = effectiveMode !== 'full';
  if (isSmallModule || budgetCheaperModelAll || isReadingOrCodeOnly) {
    return sonnetModelId;
  }
  return undefined;
}
