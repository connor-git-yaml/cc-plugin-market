/**
 * Feature 127: frontmatter 生成器的成本字段写入测试
 * 验证 generateFrontmatter 能正确输出 tokenUsage / durationMs / llmModel /
 * fallbackReason，且在未传入时保持历史行为
 */
import { describe, it, expect } from 'vitest';
import { generateFrontmatter } from '../../src/generator/frontmatter.js';

const BASE_INPUT = {
  sourceTarget: 'src/foo',
  relatedFiles: ['src/foo/index.ts'],
  confidence: 'high' as const,
  skeletonHash: 'a'.repeat(64),
};

describe('generateFrontmatter (Feature 127)', () => {
  it('未传入成本字段时保持历史行为（4 个字段全部不存在）', () => {
    const fm = generateFrontmatter(BASE_INPUT);
    expect(fm.tokenUsage).toBeUndefined();
    expect(fm.durationMs).toBeUndefined();
    expect(fm.llmModel).toBeUndefined();
    expect(fm.fallbackReason).toBeUndefined();
  });

  it('传入 tokenUsage 后，4 个成本字段作为一组全部写入', () => {
    const fm = generateFrontmatter({
      ...BASE_INPUT,
      tokenUsage: { input: 12000, output: 3000 },
      durationMs: 42000,
      llmModel: 'claude-opus-4-7',
      fallbackReason: null,
    });
    expect(fm.tokenUsage).toEqual({ input: 12000, output: 3000 });
    expect(fm.durationMs).toBe(42000);
    expect(fm.llmModel).toBe('claude-opus-4-7');
    expect(fm.fallbackReason).toBeNull();
  });

  it('降级路径：tokenUsage 零值 + fallbackReason 字符串正确写入', () => {
    const fm = generateFrontmatter({
      ...BASE_INPUT,
      tokenUsage: { input: 0, output: 0 },
      durationMs: 0,
      llmModel: '',
      fallbackReason: 'LLM 不可用',
    });
    expect(fm.tokenUsage).toEqual({ input: 0, output: 0 });
    expect(fm.durationMs).toBe(0);
    expect(fm.llmModel).toBe('');
    expect(fm.fallbackReason).toBe('LLM 不可用');
  });

  it('传入 tokenUsage 但未传入其它字段时，其它字段填充默认值（0 / "" / null）', () => {
    const fm = generateFrontmatter({
      ...BASE_INPUT,
      tokenUsage: { input: 100, output: 50 },
    });
    expect(fm.tokenUsage).toEqual({ input: 100, output: 50 });
    expect(fm.durationMs).toBe(0);
    expect(fm.llmModel).toBe('');
    expect(fm.fallbackReason).toBeNull();
  });

  it('不影响其它既有字段（language / crossLanguageRefs）', () => {
    const fm = generateFrontmatter({
      ...BASE_INPUT,
      language: 'python',
      crossLanguageRefs: ['ts-js:services/api'],
      tokenUsage: { input: 100, output: 50 },
    });
    expect(fm.language).toBe('python');
    expect(fm.crossLanguageRefs).toEqual(['ts-js:services/api']);
    expect(fm.tokenUsage).toBeDefined();
  });

  // Feature 133 P2-1：canonical spec 显式写入 sourceKind 字段
  describe('sourceKind 显式写入（Feature 133 P2-1）', () => {
    it('传入 sourceKind: canonical 时显式写入 frontmatter', () => {
      const fm = generateFrontmatter({
        ...BASE_INPUT,
        sourceKind: 'canonical',
      });
      expect(fm.sourceKind).toBe('canonical');
    });

    it('传入 sourceKind: bundle_copy 时显式写入', () => {
      const fm = generateFrontmatter({
        ...BASE_INPUT,
        sourceKind: 'bundle_copy',
      });
      expect(fm.sourceKind).toBe('bundle_copy');
    });

    it('传入 sourceKind: derived + derivedFrom 时两个字段同时写入', () => {
      const fm = generateFrontmatter({
        ...BASE_INPUT,
        sourceKind: 'derived',
        derivedFrom: 'specs/modules/parent.spec.md',
      });
      expect(fm.sourceKind).toBe('derived');
      expect(fm.derivedFrom).toBe('specs/modules/parent.spec.md');
    });

    it('未传入 sourceKind 时 frontmatter 不含该字段（向后兼容）', () => {
      const fm = generateFrontmatter(BASE_INPUT);
      expect(fm.sourceKind).toBeUndefined();
    });
  });
});
