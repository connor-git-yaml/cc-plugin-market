/**
 * Feature 176 — 报告禁用词扫描单测（tasks T-F2；SC-007）。
 */
import { describe, expect, it } from 'vitest';
import { scanForbiddenClaims } from '../../scripts/lib/forbidden-claims-scan.mjs';

describe('scanForbiddenClaims', () => {
  it('裸用 SOTA → violation', () => {
    const r = scanForbiddenClaims('Spectra MCP 达到 SOTA 水平。');
    expect(r.ok).toBe(false);
    expect(r.violations[0].pattern).toBe('sota');
  });

  it('带 internal-cohort-only 限定 → 放行', () => {
    const r = scanForbiddenClaims('cohort 3 在本组内 directional 上领先（internal-cohort-only，不声称绝对可比）。');
    expect(r.ok).toBe(true);
  });

  it('裸用 outperforms → violation；带 directional 限定 → 放行', () => {
    expect(scanForbiddenClaims('cohort3 outperforms all others.').ok).toBe(false);
    expect(scanForbiddenClaims('cohort3 outperforms cohort1 (directional, internal-cohort-only).').ok).toBe(true);
  });

  it('跨实验室绝对可比 → violation', () => {
    expect(scanForbiddenClaims('本结果与各厂商跨实验室绝对可比。').ok).toBe(false);
  });

  it('干净文本 → ok', () => {
    const r = scanForbiddenClaims('cohort 3 vs cohort 1 directional lift = 1.8×（仅组内，internal-cohort-only）。');
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });
});
