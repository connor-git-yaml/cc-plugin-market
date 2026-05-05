/**
 * Feature 149 — Percentile Bootstrap Confidence Interval
 *
 * 给 N≥3 个样本计算 95% (默认) percentile bootstrap CI。
 *
 * 设计原则：
 * - pure function，零副作用，零依赖（不引入 simple-statistics 等运行时包，FR-018）
 * - rng 注入便于测试 deterministic（默认 Math.random）
 * - N<3 显式返回 {low: null, high: null, reason: 'insufficient-samples'}（FR-010）
 * - 全相同样本 → low === high === sample[0]（FR-011）
 * - non-finite 输入抛 TypeError
 *
 * 算法（percentile method）：
 * 1. 输入 N 个 sample
 * 2. 重采样 B 次，每次 with-replacement 抽 N 个样本
 * 3. 每次重采样取 median，得到 B 个 replicate
 * 4. replicate 排序，取 [alpha/2, 1-alpha/2] 分位作为 [low, high]
 *
 * 局限性：N=5 时 CI 偏窄是 percentile method well-known issue；
 * 报告应同步标 "small-sample CI, interpret with caution"（spec 风险 1）。
 */

/**
 * 计算 N 个数的 median（不排序原数组）
 * @param {number[]} arr 已排序数组
 * @returns {number}
 */
function medianOfSorted(arr) {
  const n = arr.length;
  if (n % 2 === 1) return arr[(n - 1) / 2];
  return (arr[n / 2 - 1] + arr[n / 2]) / 2;
}

/**
 * Percentile Bootstrap 95% CI helper
 * @param {number[]} samples 数值数组
 * @param {{ b?: number; alpha?: number; rng?: () => number }} [opts]
 * @returns {{
 *   low: number | null;
 *   high: number | null;
 *   b: number;
 *   samples: number;
 *   method: 'percentile';
 *   reason?: string;
 * }}
 */
export function bootstrapPercentileCi(samples, opts = {}) {
  if (!Array.isArray(samples)) {
    throw new TypeError('bootstrapPercentileCi: samples must be an array of finite numbers');
  }
  for (const v of samples) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(`bootstrapPercentileCi: samples must be finite numbers, got ${String(v)}`);
    }
  }

  const { b = 1000, alpha = 0.05, rng = Math.random } = opts;
  if (!Number.isInteger(b) || b < 1) {
    // Codex WARN: 之前用 Number.isFinite，b=1.5 不会拒；现在严格要求整数避免 ~82 次后才 RangeError
    throw new TypeError(`bootstrapPercentileCi: b must be positive integer, got ${String(b)}`);
  }
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    throw new TypeError(`bootstrapPercentileCi: alpha must be in (0, 1), got ${String(alpha)}`);
  }
  if (typeof rng !== 'function') {
    throw new TypeError('bootstrapPercentileCi: rng must be a function');
  }

  const n = samples.length;

  if (n < 3) {
    return {
      low: null,
      high: null,
      b,
      samples: n,
      method: 'percentile',
      reason: 'insufficient-samples',
    };
  }

  // B 次重采样，每次取 median
  const replicates = new Array(b);
  for (let i = 0; i < b; i++) {
    const resample = new Array(n);
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * n);
      // defensive：rng 返回 1.0 时 idx 可能等于 n
      resample[j] = samples[idx >= n ? n - 1 : idx];
    }
    resample.sort((a, c) => a - c);
    replicates[i] = medianOfSorted(resample);
  }
  replicates.sort((a, c) => a - c);

  // percentile method：取 [alpha/2, 1 - alpha/2] 分位
  // 索引使用 floor(alpha/2 * b) / ceil((1 - alpha/2) * b) - 1，clamp 到 [0, b-1]
  const lowIdx = Math.max(0, Math.min(b - 1, Math.floor((alpha / 2) * b)));
  const highIdx = Math.max(0, Math.min(b - 1, Math.ceil((1 - alpha / 2) * b) - 1));

  return {
    low: replicates[lowIdx],
    high: replicates[highIdx],
    b,
    samples: n,
    method: 'percentile',
  };
}

/**
 * 简单的 seedable PRNG（Mulberry32），便于测试 deterministic。
 * 不在 production code path 使用，仅 export 给单测注入。
 *
 * @param {number} seed
 * @returns {() => number}
 */
export function createSeededRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
