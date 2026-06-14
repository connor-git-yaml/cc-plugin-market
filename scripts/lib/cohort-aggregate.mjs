/**
 * Feature 176 — cross-cohort 聚合（tasks T-D5；spec FR-B-001/002/003/004 + SC-003/004）。
 *
 * 纯函数：输入归一化的 run 记录，输出 per-cohort oracle passRate + bootstrap CI95、
 * lift=c3/c1、c3_vs_c4、token-per-completed-task、fixture-by-fixture 表。
 *
 * 关键不变量（KD-2 / FR-A-001b）：
 *   - pass/fail 只读 oracle 真值（oraclePassed），**不读 jury**；
 *   - oraclePassed===null（ORACLE-UNAVAILABLE）从 passRate 分母剔除并计数；
 *   - tokens===null（TOKENS-UNAVAILABLE）从 token 分母剔除并计数。
 *
 * 与既有设施一致：bootstrap CI 复用 scripts/lib/bootstrap-ci.mjs（不另造）。
 */

import { createSeededRng } from './bootstrap-ci.mjs';
// Feature 187 FR-004-b：cohort id 单一来源 cohort-registry.mjs（再从此 re-export 保持既有 import 兼容）。
import { COHORT_IDS } from './cohort-registry.mjs';

export { COHORT_IDS };

/**
 * proportion 的 percentile bootstrap CI（codex CRITICAL：passRate 是比例，必须每次重采样取
 * **mean**，不能用 bootstrap-ci.mjs 的 median helper —— 0/1 样本的 median 恒为 0/1，CI 无意义）。
 * @param {number[]} samples01  0/1 数组
 */
export function bootstrapProportionCi(samples01, opts = {}) {
  const { b = 1000, alpha = 0.05, rng = Math.random } = opts;
  const n = samples01.length;
  if (n < 3) return { low: null, high: null, samples: n, method: 'percentile-mean', reason: 'insufficient-samples' };
  const replicates = new Array(b);
  for (let i = 0; i < b; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * n);
      sum += samples01[idx >= n ? n - 1 : idx];
    }
    replicates[i] = sum / n; // 比例 = mean
  }
  replicates.sort((a, c) => a - c);
  const loIdx = Math.floor((alpha / 2) * b);
  const hiIdx = Math.min(b - 1, Math.ceil((1 - alpha / 2) * b) - 1);
  return { low: replicates[loIdx], high: replicates[hiIdx], samples: n, method: 'percentile-mean' };
}

/**
 * @typedef {Object} RunRecord
 * @property {string} cohort
 * @property {string} taskId
 * @property {number} repeatIndex
 * @property {boolean|null} oraclePassed  null = ORACLE-UNAVAILABLE（剔除出 passRate 分母）
 * @property {number|null} tokens         null = TOKENS-UNAVAILABLE（剔除出 token 分母）
 */

/** 单 cohort 统计。 */
export function cohortStats(runs, cohort, { rng } = {}) {
  const mine = runs.filter((r) => r.cohort === cohort);
  const oracleAvailable = mine.filter((r) => r.oraclePassed !== null);
  const oracleUnavailable = mine.length - oracleAvailable.length;
  const passes = oracleAvailable.filter((r) => r.oraclePassed === true);
  const passRate = oracleAvailable.length > 0 ? passes.length / oracleAvailable.length : null;

  // run-level 0/1 proportion bootstrap CI（剔除 ORACLE-UNAVAILABLE；mean 而非 median）
  const samples = oracleAvailable.map((r) => (r.oraclePassed ? 1 : 0));
  const ci = bootstrapProportionCi(samples, { rng: rng ?? createSeededRng(176) });

  // token-per-completed-task：仅 oracle-pass 且 tokens 可得的 run
  const passWithTokens = passes.filter((r) => typeof r.tokens === 'number');
  const tokensUnavailable = passes.length - passWithTokens.length;
  const tokenPerCompleted = passWithTokens.length > 0
    ? passWithTokens.reduce((a, r) => a + r.tokens, 0) / passWithTokens.length
    : null;

  return {
    cohort,
    runCount: mine.length,
    oracleAvailableCount: oracleAvailable.length,
    oracleUnavailableCount: oracleUnavailable,
    passCount: passes.length,
    passRate,
    ci95: { low: ci.low, high: ci.high, ...(ci.reason ? { reason: ci.reason } : {}) },
    tokenPerCompletedTask: tokenPerCompleted,
    tokensUnavailableCount: tokensUnavailable,
  };
}

/** 两 cohort CI 是否重叠（用于 c3_vs_c4 显著性的粗判）。 */
function ciOverlap(a, b) {
  if (a.low == null || b.low == null) return null;
  return a.low <= b.high && b.low <= a.high;
}

/**
 * 全量聚合。
 * @param {RunRecord[]} runs
 * @param {object} [opts] { rng, cohortIds }
 */
export function aggregateCohorts(runs, opts = {}) {
  const cohortIds = opts.cohortIds ?? COHORT_IDS;
  const rng = opts.rng ?? createSeededRng(176);
  const byCohort = {};
  for (const c of cohortIds) byCohort[c] = cohortStats(runs, c, { rng });

  const c1 = byCohort['baseline-claude'];
  const c3 = byCohort['spec-driver-spectra-mcp'];
  const c4 = byCohort['SuperPowers'];

  // SC-003：lift = c3/c1（directional，不声称绝对可比）
  const lift = c1 && c3 && c1.passRate != null && c1.passRate > 0 && c3.passRate != null
    ? c3.passRate / c1.passRate
    : null;

  // SC-004：c3 vs c4（aggregate 差值 + CI 重叠）
  const c3_vs_c4 = c3 && c4 && c3.passRate != null && c4.passRate != null
    ? {
        c3PassRate: c3.passRate,
        c4PassRate: c4.passRate,
        diff: c3.passRate - c4.passRate,
        c3AtLeastC4: c3.passRate >= c4.passRate,
        ciOverlap: ciOverlap(c3.ci95, c4.ci95),
      }
    : null;

  // token directional：c3 相对 c1 的 token-per-completed-task 比
  const tokenRatioC3overC1 = c1 && c3 && c1.tokenPerCompletedTask && c3.tokenPerCompletedTask
    ? c3.tokenPerCompletedTask / c1.tokenPerCompletedTask
    : null;

  return {
    byCohort,
    lift,
    c3_vs_c4,
    tokenRatioC3overC1,
    fixtureMatrix: buildFixtureMatrix(runs, cohortIds),
    internalCohortOnly: true, // 全程 directional，不声称绝对可比（FR-C-008）
  };
}

/** fixture-by-fixture：task × cohort 的 pass/total 明细（FR-B-004）。 */
export function buildFixtureMatrix(runs, cohortIds) {
  const tasks = [...new Set(runs.map((r) => r.taskId))].sort();
  const matrix = {};
  for (const taskId of tasks) {
    matrix[taskId] = {};
    for (const c of cohortIds) {
      const cell = runs.filter((r) => r.taskId === taskId && r.cohort === c && r.oraclePassed !== null);
      const pass = cell.filter((r) => r.oraclePassed === true).length;
      matrix[taskId][c] = { pass, total: cell.length };
    }
  }
  return matrix;
}
