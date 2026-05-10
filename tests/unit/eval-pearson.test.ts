/**
 * Feature 162 Phase B2 (T037) — Pearson correlation 5 case 单元测试
 *
 * 覆盖：
 *   case 1：完美正相关 → r ≈ 1.0
 *   case 2：完美负相关 → r ≈ -1.0
 *   case 3：弱/无相关 — 与 SciPy 实测对比
 *   case 4：与 SciPy 实测对比 ε ≤ 1e-6（非线性 + 噪声序列）
 *   case 5：边界 — 长度 < 2 或 zero-variance
 *
 * SciPy 对照值通过 `scipy.stats.pearsonr(xs, ys).statistic` 离线计算后 hardcode。
 */
import { describe, it, expect } from 'vitest';
import { pearson } from '../../scripts/lib/pearson.mjs';

const EPSILON = 1e-6;

describe('pearson() — Feature 162 T037', () => {
  it('case 1: 完美正相关 [1,2,3,4,5] vs [2,4,6,8,10] → r ≈ 1.0', () => {
    const r = pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(Math.abs(r - 1.0)).toBeLessThan(EPSILON);
  });

  it('case 2: 完美负相关 [1,2,3,4,5] vs [10,8,6,4,2] → r ≈ -1.0', () => {
    const r = pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
    expect(Math.abs(r - -1.0)).toBeLessThan(EPSILON);
  });

  it('case 3: 弱相关 [1,2,3,4,5] vs [3,1,4,1,5] — 与 SciPy 对齐', () => {
    // SciPy 等价计算（canonical Pearson 公式）：
    //   sum((xi-x̄)(yi-ȳ)) / sqrt(Σ(xi-x̄)² · Σ(yi-ȳ)²)
    //   x̄ = 3, ȳ = 2.8
    //   num = -2*0.2 + -1*-1.8 + 0*1.2 + 1*-1.8 + 2*2.2 = 4.0
    //   dx2 = 4+1+0+1+4 = 10
    //   dy2 = 0.04+3.24+1.44+3.24+4.84 = 12.8
    //   r = 4.0 / sqrt(10 * 12.8) = 4 / sqrt(128) = 0.35355339059327373
    const r = pearson([1, 2, 3, 4, 5], [3, 1, 4, 1, 5]);
    const scipyExpected = 0.35355339059327373;
    expect(Math.abs(r - scipyExpected)).toBeLessThan(EPSILON);
  });

  it('case 4: 非线性带噪声 与 SciPy 对齐 ε ≤ 1e-6', () => {
    // SciPy 等价计算（canonical Pearson 公式，离线 Python 验证）：
    //   xs = [1..7], ys = [1.1, 2.0, 3.2, 3.9, 5.1, 5.9, 7.2]
    //   r = 0.9982698068562739
    const xs = [1, 2, 3, 4, 5, 6, 7];
    const ys = [1.1, 2.0, 3.2, 3.9, 5.1, 5.9, 7.2];
    const r = pearson(xs, ys);
    const scipyExpected = 0.9982698068562739;
    expect(Math.abs(r - scipyExpected)).toBeLessThan(EPSILON);
  });

  it('case 5: 边界 — 长度 < 2 throw + zero-variance 返回 0 + 长度不等 throw', () => {
    // 长度 < 2 → throw
    expect(() => pearson([1], [1])).toThrow(/at least 2 points/);
    expect(() => pearson([], [])).toThrow(/at least 2 points/);

    // 长度不一致 → throw
    expect(() => pearson([1, 2, 3], [1, 2])).toThrow(/length mismatch/);

    // zero-variance（ys 全相同）→ denom = 0 → 返回 0（不抛 NaN）
    const r1 = pearson([1, 2, 3], [5, 5, 5]);
    expect(r1).toBe(0);

    // 长度恰为 2（最小有效输入，正相关）
    const r2 = pearson([1, 2], [10, 20]);
    expect(Math.abs(r2 - 1.0)).toBeLessThan(EPSILON);

    // 长度恰为 2（最小有效输入，负相关）
    const r3 = pearson([1, 2], [20, 10]);
    expect(Math.abs(r3 - -1.0)).toBeLessThan(EPSILON);
  });
});
