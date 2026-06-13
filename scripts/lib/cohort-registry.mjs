/**
 * Feature 187 — 声明式 cohort 注册表（spec FR-004）：cohort 配置单一来源。
 *
 * 此前 cohort 配置散布 6 处（COHORT_TO_TOOL / COHORT_IDS×2 / runner 固定参数 / cohort3 allowedTools /
 * stdinPolicy）。本模块收口为单一 REGISTRY，COHORT_IDS / COHORT_TO_TOOL 等从此派生（FR-004-b）。
 *
 * promptBuilder 委托现有 buildDriverPrompt（按 tool 逐字一致 → 竞品方法论零改动，SC-013 golden 守护）；
 * 漏接 promptBuilder/tool 的 cohort → resolveCohort throw（FR-004-a，不再静默跑成对照组）。
 */
import { buildDriverPrompt } from '../eval-task-runner.mjs';

/**
 * 5 个 F176 cohort 的单一声明。字段：
 * - id：报告/聚合用 cohort 标识
 * - tool：runner --tool 值 + buildDriverPrompt 分支键（buildDriverPrompt 对未知 tool throw）
 * - promptBuilder：(ctx)=>string，委托 buildDriverPrompt 保证逐字一致
 * - claudeArgsProfile：claude 调用参数画像键（'default' 共享；预留 per-cohort 差异化）
 * - prepSteps：跑前准备步骤标识（cohort3 需注册 spectra MCP）
 * - stdinPolicy：prompt 传递方式（全 cohort 走 stdin，--prompt-via-stdin）
 */
const COHORT_DEFS = [
  { id: 'baseline-claude', tool: 'control', claudeArgsProfile: 'default', prepSteps: [], stdinPolicy: 'stdin' },
  { id: 'spec-driver', tool: 'spec-driver', claudeArgsProfile: 'default', prepSteps: [], stdinPolicy: 'stdin' },
  { id: 'spec-driver-spectra-mcp', tool: 'spec-driver-spectra-mcp', claudeArgsProfile: 'spectra-mcp', prepSteps: ['register-spectra-mcp'], stdinPolicy: 'stdin' },
  { id: 'SuperPowers', tool: 'superpowers', claudeArgsProfile: 'default', prepSteps: [], stdinPolicy: 'stdin' },
  { id: 'GStack', tool: 'gstack', claudeArgsProfile: 'default', prepSteps: [], stdinPolicy: 'stdin' },
];

/** 给每个 cohort 注入委托 buildDriverPrompt 的 promptBuilder（逐字一致）。 */
export const REGISTRY = COHORT_DEFS.map((c) => ({
  ...c,
  promptBuilder: ({ taskPrompt, spectraContext, skillInvocation = false }) =>
    buildDriverPrompt({ tool: c.tool, taskPrompt, spectraContext, skillInvocation }),
}));

const BY_ID = new Map(REGISTRY.map((c) => [c.id, c]));

/** cohort id 列表（派生，替代散布的 COHORT_IDS）。 */
export const COHORT_IDS = REGISTRY.map((c) => c.id);

/** cohort id → runner --tool（派生，替代硬编码 COHORT_TO_TOOL）。 */
export const COHORT_TO_TOOL = Object.fromEntries(REGISTRY.map((c) => [c.id, c.tool]));

/**
 * 解析 cohort：未注册或缺 promptBuilder/tool → throw（FR-004-a：漏接不静默跑对照组）。
 * @param {string} cohortId
 * @returns {object} 完整 cohort 声明
 */
export function resolveCohort(cohortId) {
  const c = BY_ID.get(cohortId);
  if (!c) throw new Error(`未注册的 cohort: '${cohortId}'（须在 cohort-registry.mjs 显式声明，禁止裸回退对照组）`);
  if (typeof c.promptBuilder !== 'function') throw new Error(`cohort '${cohortId}' 缺 promptBuilder（漏接配置）`);
  if (!c.tool) throw new Error(`cohort '${cohortId}' 缺 tool`);
  return c;
}

/** 取 cohort 的 promptBuilder（缺则 throw）。 */
export function getPromptBuilder(cohortId) {
  return resolveCohort(cohortId).promptBuilder;
}
