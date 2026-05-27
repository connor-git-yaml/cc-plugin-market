/**
 * F170c T-RED-5 — SC-005(f3) 类型断言
 *
 * 用专用 type-test tsconfig（启用 exactOptionalPropertyTypes）+ `{} extends Pick<T, K>` 模式
 * 断言新增字段为 `field?: T`（optional），而非 `field: T | undefined`。
 *
 * 该断言独立于项目 tsconfig（exactOptionalPropertyTypes = false）执行，
 * 跑方式: `npm run typecheck:tests`（T-GREEN-7 实施）
 */

import type {
  ImpactEnrichment,
  DetectChangesEnrichment,
  ContextEnrichment,
} from '../../src/mcp/lib/response-helpers.js';

// 工具类型：断言 K 是 T 的 optional 字段
type IsOptional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;

// ImpactEnrichment 三字段
const _impact_topImpacted: IsOptional<ImpactEnrichment, 'topImpacted'> = true;
const _impact_nextStepHint: IsOptional<ImpactEnrichment, 'nextStepHint'> = true;
const _impact_degraded: IsOptional<ImpactEnrichment, '_enrichmentDegraded'> = true;

// DetectChangesEnrichment 四字段
const _dc_riskTier: IsOptional<DetectChangesEnrichment, 'riskTier'> = true;
const _dc_topImpacted: IsOptional<DetectChangesEnrichment, 'topImpacted'> = true;
const _dc_nextStepHint: IsOptional<DetectChangesEnrichment, 'nextStepHint'> = true;
const _dc_degraded: IsOptional<DetectChangesEnrichment, '_enrichmentDegraded'> = true;

// ContextEnrichment 三字段
const _ctx_callers: IsOptional<ContextEnrichment, 'topRelevantCallers'> = true;
const _ctx_nextStepHint: IsOptional<ContextEnrichment, 'nextStepHint'> = true;
const _ctx_degraded: IsOptional<ContextEnrichment, '_enrichmentDegraded'> = true;

// 防止"未使用"警告 — 全部 const 强制 true，导出确保未被 tree-shake
export const __f170c_type_assertions = {
  _impact_topImpacted,
  _impact_nextStepHint,
  _impact_degraded,
  _dc_riskTier,
  _dc_topImpacted,
  _dc_nextStepHint,
  _dc_degraded,
  _ctx_callers,
  _ctx_nextStepHint,
  _ctx_degraded,
};
