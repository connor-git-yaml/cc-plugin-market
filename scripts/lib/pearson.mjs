/**
 * Feature 162 Phase B2 (T036) — 零依赖 Pearson correlation 实现
 *
 * 公式：r = Σ((Xi-X̄)(Yi-Ȳ)) / sqrt(Σ(Xi-X̄)² · Σ(Yi-Ȳ)²)
 *
 * 实现选择 two-pass 算法：先一次扫描求均值，再一次扫描计算 dx/dy/dx²/dy²/dx·dy。
 * 不使用 single-pass `E(XY) - E(X)E(Y)` 公式，因为该公式在均值很大、方差很小的场景下
 * 容易出现 catastrophic cancellation（两个接近相等的大数相减导致有效位丢失）。
 *
 * 与 SciPy `scipy.stats.pearsonr` 的对齐目标：|diff| ≤ 1e-6（plan §2.5.3）。
 *
 * 边界处理：
 *   - 输入长度不一致或 < 2：throw（无法计算）
 *   - 任一序列方差为 0（denom = 0）：返回 0（与 numpy.corrcoef 行为一致；SciPy 在该
 *     退化情况下返回 NaN，但本仓库 calibration runner 把 0 视为"不相关"语义更稳）
 *
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {number} r ∈ [-1, 1]
 */
export function pearson(xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys)) {
    throw new Error('pearson: xs/ys must be arrays');
  }
  if (xs.length !== ys.length) {
    throw new Error(`pearson: xs/ys length mismatch (${xs.length} vs ${ys.length})`);
  }
  if (xs.length < 2) {
    throw new Error(`pearson: need at least 2 points, got ${xs.length}`);
  }

  const n = xs.length;

  // First pass：累加求和。用 Number 累加足够（n 通常远小于 10^6）。
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    if (typeof xs[i] !== 'number' || typeof ys[i] !== 'number') {
      throw new Error(`pearson: non-number at index ${i}`);
    }
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;

  // Second pass：用 deviation form 累加 num / dx² / dy²，避免 single-pass 大数相减。
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }

  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) {
    // zero-variance：返回 0（不相关），不返回 NaN，方便下游阈值判定。
    return 0;
  }
  return num / denom;
}
