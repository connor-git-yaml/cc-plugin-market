/**
 * confidence-mapper 单元测试
 * 覆盖三级置信度映射规则（AC-101-02）
 * 共 7 条断言
 */
import { describe, it, expect } from 'vitest';
import {
  mapDocConfidence,
  mapEvidenceConfidence,
  mapTierToConfidence,
  CONFIDENCE_SCORES,
} from '../../src/panoramic/graph/confidence-mapper.js';

describe('CONFIDENCE_SCORES 常量', () => {
  it('EXTRACTED 分数等于 0.95', () => {
    expect(CONFIDENCE_SCORES.EXTRACTED).toBe(0.95);
  });
});

describe('mapDocConfidence', () => {
  it("'high' 映射为 'EXTRACTED'，且 CONFIDENCE_SCORES.EXTRACTED === 0.95", () => {
    const result = mapDocConfidence('high');
    expect(result).toBe('EXTRACTED');
    expect(CONFIDENCE_SCORES.EXTRACTED).toBe(0.95);
  });

  it("'medium' 映射为 'INFERRED'，且 CONFIDENCE_SCORES.INFERRED 在 [0.5, 0.8] 范围内", () => {
    const result = mapDocConfidence('medium');
    expect(result).toBe('INFERRED');
    expect(CONFIDENCE_SCORES.INFERRED).toBeGreaterThanOrEqual(0.5);
    expect(CONFIDENCE_SCORES.INFERRED).toBeLessThanOrEqual(0.8);
  });

  it("'low' 映射为 'AMBIGUOUS'，且 CONFIDENCE_SCORES.AMBIGUOUS <= 0.4", () => {
    const result = mapDocConfidence('low');
    expect(result).toBe('AMBIGUOUS');
    expect(CONFIDENCE_SCORES.AMBIGUOUS).toBeLessThanOrEqual(0.4);
  });

  it('undefined 映射为 INFERRED（未标注保守推断）', () => {
    const result = mapDocConfidence(undefined);
    expect(result).toBe('INFERRED');
  });
});

describe('mapEvidenceConfidence', () => {
  it('evidenceCount >= 3 映射为 EXTRACTED', () => {
    expect(mapEvidenceConfidence(3)).toBe('EXTRACTED');
    expect(mapEvidenceConfidence(10)).toBe('EXTRACTED');
  });

  it('evidenceCount === 1 映射为 INFERRED，且 CONFIDENCE_SCORES.INFERRED 在 [0.5, 0.8] 范围内', () => {
    const result = mapEvidenceConfidence(1);
    expect(result).toBe('INFERRED');
    expect(CONFIDENCE_SCORES.INFERRED).toBeGreaterThanOrEqual(0.5);
    expect(CONFIDENCE_SCORES.INFERRED).toBeLessThanOrEqual(0.8);
  });

  it('evidenceCount === 0 映射为 AMBIGUOUS', () => {
    const result = mapEvidenceConfidence(0);
    expect(result).toBe('AMBIGUOUS');
  });
});

describe('Feature 151 T-010 — mapTierToConfidence (CL-08 1:1 映射)', () => {
  it('high → EXTRACTED', () => {
    expect(mapTierToConfidence('high')).toBe('EXTRACTED');
  });

  it('medium → INFERRED', () => {
    expect(mapTierToConfidence('medium')).toBe('INFERRED');
  });

  it('low → AMBIGUOUS', () => {
    expect(mapTierToConfidence('low')).toBe('AMBIGUOUS');
  });

  it('与 CONFIDENCE_SCORES 对齐：high → 0.95, medium → 0.65, low → 0.25', () => {
    expect(CONFIDENCE_SCORES[mapTierToConfidence('high')]).toBe(0.95);
    expect(CONFIDENCE_SCORES[mapTierToConfidence('medium')]).toBe(0.65);
    expect(CONFIDENCE_SCORES[mapTierToConfidence('low')]).toBe(0.25);
  });
});
