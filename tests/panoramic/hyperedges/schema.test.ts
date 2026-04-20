/**
 * hyperedges/schema.ts 单元测试
 *
 * 覆盖：合法输入、label 超长、nodes 不足 3、rationale 为空、
 *       非法 confidence、batch 超 10 个
 */
import { describe, it, expect } from 'vitest';
import { HyperedgeSchema, HyperedgesOutputSchema } from '../../../src/panoramic/hyperedges/schema.js';

// ============================================================
// 辅助：构造合法的 hyperedge 对象
// ============================================================

function validHyperedge(overrides: Partial<{
  id: string;
  label: string;
  nodes: string[];
  rationale: string;
  confidence: string;
}> = {}) {
  return {
    id: 'he-001',
    label: '全量摄取',
    nodes: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    rationale: '设计文档明确描述了摄取流程涉及这三个模块',
    confidence: 'INFERRED',
    ...overrides,
  };
}

// ============================================================
// HyperedgeSchema 单条校验
// ============================================================

describe('HyperedgeSchema', () => {
  it('合法输入应通过校验', () => {
    const result = HyperedgeSchema.safeParse(validHyperedge());
    expect(result.success).toBe(true);
  });

  it('label 恰好 8 个 Unicode 字符应通过校验', () => {
    const result = HyperedgeSchema.safeParse(validHyperedge({ label: '12345678' }));
    expect(result.success).toBe(true);
  });

  it('label 超过 8 个 Unicode 字符（9 个中文字符）应失败', () => {
    // 9 个中文字符，每个 length 为 1
    const result = HyperedgeSchema.safeParse(validHyperedge({ label: '一二三四五六七八九' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('8'))).toBe(true);
    }
  });

  it('label 为 8 个中文字符（边界值）应通过校验', () => {
    const result = HyperedgeSchema.safeParse(validHyperedge({ label: '一二三四五六七八' }));
    expect(result.success).toBe(true);
  });

  it('nodes 长度不足 3 应失败', () => {
    const result = HyperedgeSchema.safeParse(validHyperedge({ nodes: ['src/a.ts', 'src/b.ts'] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('3'))).toBe(true);
    }
  });

  it('nodes 恰好 3 个应通过校验', () => {
    const result = HyperedgeSchema.safeParse(validHyperedge({
      nodes: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    }));
    expect(result.success).toBe(true);
  });

  it('rationale 为空字符串应失败', () => {
    const result = HyperedgeSchema.safeParse(validHyperedge({ rationale: '' }));
    expect(result.success).toBe(false);
  });

  it('rationale 超过 200 字符应失败', () => {
    const longRationale = 'a'.repeat(201);
    const result = HyperedgeSchema.safeParse(validHyperedge({ rationale: longRationale }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('200'))).toBe(true);
    }
  });

  it('非法 confidence 值应失败', () => {
    const result = HyperedgeSchema.safeParse(validHyperedge({ confidence: 'UNKNOWN' }));
    expect(result.success).toBe(false);
  });

  it('confidence 为 EXTRACTED 应通过校验', () => {
    const result = HyperedgeSchema.safeParse(validHyperedge({ confidence: 'EXTRACTED' }));
    expect(result.success).toBe(true);
  });

  it('confidence 为 AMBIGUOUS 应通过校验', () => {
    const result = HyperedgeSchema.safeParse(validHyperedge({ confidence: 'AMBIGUOUS' }));
    expect(result.success).toBe(true);
  });
});

// ============================================================
// HyperedgesOutputSchema batch 校验
// ============================================================

describe('HyperedgesOutputSchema', () => {
  it('合法 batch（3 条）应通过校验', () => {
    const result = HyperedgesOutputSchema.safeParse({
      hyperedges: [
        validHyperedge({ id: 'he-001' }),
        validHyperedge({ id: 'he-002', label: '处理流程' }),
        validHyperedge({ id: 'he-003', label: '输出阶段' }),
      ],
    });
    expect(result.success).toBe(true);
  });

  it('空 hyperedges 数组应通过校验', () => {
    const result = HyperedgesOutputSchema.safeParse({ hyperedges: [] });
    expect(result.success).toBe(true);
  });

  it('hyperedges 数组恰好 10 个应通过校验', () => {
    const hyperedges = Array.from({ length: 10 }, (_, i) =>
      validHyperedge({ id: `he-${String(i + 1).padStart(3, '0')}` }),
    );
    const result = HyperedgesOutputSchema.safeParse({ hyperedges });
    expect(result.success).toBe(true);
  });

  it('hyperedges 数组超过 10 个应失败（FR-018）', () => {
    const hyperedges = Array.from({ length: 11 }, (_, i) =>
      validHyperedge({ id: `he-${String(i + 1).padStart(3, '0')}` }),
    );
    const result = HyperedgesOutputSchema.safeParse({ hyperedges });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('10'))).toBe(true);
    }
  });

  it('batch 中包含非法 hyperedge 应失败', () => {
    const result = HyperedgesOutputSchema.safeParse({
      hyperedges: [
        validHyperedge({ id: 'he-001' }),
        validHyperedge({ id: 'he-002', nodes: ['only-one'] }), // nodes 不足 3
      ],
    });
    expect(result.success).toBe(false);
  });
});
