/**
 * F147 Sprint 3 Phase B.2 — LLM 单价表
 *
 * 来源：vendor 官网公开 pricing page（截至 2026-04-30）。**估算值**，用于 fixture cost 回填，
 * 让 SC-008 budget pass/fail 不再对"in-session 无 metering"留 25 个空缺。
 *
 * 字段单位：USD per million tokens
 * - 当 vendor 单价以人民币标注时，按 ¥1 ≈ $0.14 换算（SiliconFlow 大多为此情况）
 * - 估算误差预期 ≤ 20%，对 sub-cent fixture 不影响 SC-008 pass/fail 判定
 */

export const PRICING_TABLE = {
  // SiliconFlow GLM 系列（人民币换算）
  'siliconflow:Pro/zai-org/GLM-5.1': { inputPerM: 0.55, outputPerM: 2.20, source: 'siliconflow.cn 公开定价 ¥4/M in + ¥16/M out (2026-04)', tier: 'estimate' },
  'siliconflow:Pro/zai-org/GLM-4.5': { inputPerM: 0.55, outputPerM: 2.20, source: 'siliconflow.cn 公开定价（同 GLM-5.1 tier）', tier: 'estimate' },
  'siliconflow:Pro/moonshotai/Kimi-K2.6': { inputPerM: 0.85, outputPerM: 3.40, source: 'siliconflow.cn 公开定价（Kimi tier）', tier: 'estimate' },

  // Anthropic
  'cli:claude-opus-4-7': { inputPerM: 15, outputPerM: 75, source: 'docs.anthropic.com pricing 2026-04', tier: 'official' },
  'cli:claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15, source: 'docs.anthropic.com pricing 2026-04', tier: 'official' },
  'claude-opus-4-7': { inputPerM: 15, outputPerM: 75, source: 'docs.anthropic.com pricing 2026-04', tier: 'official' },
  'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15, source: 'docs.anthropic.com pricing 2026-04', tier: 'official' },

  // OpenAI (Codex GPT-5.5)
  'codex:gpt-5.5': { inputPerM: 5, outputPerM: 20, source: 'openai.com/api/pricing 2026-04 (gpt-5.5 tier 估算)', tier: 'estimate' },
};

/**
 * 计算单次调用 cost（USD）。
 * @param {object} usage - { inputTokens, outputTokens, cacheReadTokens? }
 * @param {string} modelKey - 价目表 key（vendor:model 或裸 model）
 * @returns {{ cost: number|null, source: string|null, tier: string|null }}
 */
export function estimateCost(usage, modelKey) {
  if (!usage) return { cost: null, source: null, tier: null };
  const input = usage.inputTokens ?? usage.executorPromptTokens ?? null;
  const output = usage.outputTokens ?? usage.executorCompletionTokens ?? null;
  if (input == null || output == null) return { cost: null, source: null, tier: null };

  const entry = PRICING_TABLE[modelKey];
  if (!entry) return { cost: null, source: null, tier: 'unknown-model' };

  const cost = (input * entry.inputPerM + output * entry.outputPerM) / 1_000_000;
  return {
    cost: Math.round(cost * 10000) / 10000, // 4 位小数（sub-cent 精度）
    source: entry.source,
    tier: entry.tier,
  };
}

/**
 * 从 fixture taskExecution 段提取 model key + usage，并回填 costUsd 字段。
 * 返回 patched fixture 对象（不写盘）。
 */
export function backfillTaskFixtureCost(fx) {
  const te = fx.taskExecution;
  if (!te) return fx;
  if (te.costUsd != null) return fx; // 已有数据不动

  const executor = te.executor; // 形如 "siliconflow:Pro/zai-org/GLM-5.1"
  if (!executor) return fx;

  const usage = {
    inputTokens: te.executorPromptTokens,
    outputTokens: te.executorCompletionTokens,
  };
  const result = estimateCost(usage, executor);
  if (result.cost == null) return fx;

  te.costUsd = result.cost;
  te.costUsdSource = result.source;
  te.costUsdTier = result.tier; // "official" | "estimate" | "unknown-model"
  return fx;
}
