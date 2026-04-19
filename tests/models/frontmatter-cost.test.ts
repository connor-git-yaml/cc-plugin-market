/**
 * Feature 127: frontmatter 成本字段的 Zod 解析 / 序列化测试
 * 验证新字段全部 optional，不破坏历史 spec 的读取
 */
import { describe, it, expect } from 'vitest';
import {
  SpecFrontmatterSchema,
  CostMetadataSchema,
  TokenUsageSchema,
  CompletedModuleSchema,
} from '../../src/models/module-spec.js';

const BASE_FRONTMATTER = {
  type: 'module-spec' as const,
  version: 'v1',
  generatedBy: 'spectra v3.0',
  sourceTarget: 'src/foo',
  relatedFiles: ['src/foo/bar.ts'],
  lastUpdated: '2026-04-19T00:00:00.000Z',
  confidence: 'high' as const,
  skeletonHash: 'a'.repeat(64),
};

describe('SpecFrontmatterSchema (Feature 127)', () => {
  it('解析不含成本字段的历史 frontmatter（向后兼容）', () => {
    const parsed = SpecFrontmatterSchema.parse(BASE_FRONTMATTER);
    expect(parsed.tokenUsage).toBeUndefined();
    expect(parsed.durationMs).toBeUndefined();
    expect(parsed.llmModel).toBeUndefined();
    expect(parsed.fallbackReason).toBeUndefined();
  });

  it('解析包含完整成本字段的 frontmatter', () => {
    const input = {
      ...BASE_FRONTMATTER,
      tokenUsage: { input: 12500, output: 3800 },
      durationMs: 42000,
      llmModel: 'claude-opus-4-7',
      fallbackReason: null,
    };
    const parsed = SpecFrontmatterSchema.parse(input);
    expect(parsed.tokenUsage).toEqual({ input: 12500, output: 3800 });
    expect(parsed.durationMs).toBe(42000);
    expect(parsed.llmModel).toBe('claude-opus-4-7');
    expect(parsed.fallbackReason).toBeNull();
  });

  it('允许降级路径写 fallbackReason 字符串 + 零成本', () => {
    const input = {
      ...BASE_FRONTMATTER,
      tokenUsage: { input: 0, output: 0 },
      durationMs: 0,
      llmModel: '',
      fallbackReason: 'LLM 不可用',
    };
    const parsed = SpecFrontmatterSchema.parse(input);
    expect(parsed.fallbackReason).toBe('LLM 不可用');
    expect(parsed.tokenUsage).toEqual({ input: 0, output: 0 });
  });

  it('拒绝 tokenUsage 的负值', () => {
    const input = {
      ...BASE_FRONTMATTER,
      tokenUsage: { input: -1, output: 0 },
    };
    expect(() => SpecFrontmatterSchema.parse(input)).toThrow();
  });
});

describe('CostMetadataSchema', () => {
  it('要求 tokenUsage / durationMs / llmModel / fallbackReason 全部存在', () => {
    const cost = {
      tokenUsage: { input: 100, output: 50 },
      durationMs: 1234,
      llmModel: 'claude-sonnet-4-6',
      fallbackReason: null,
    };
    expect(() => CostMetadataSchema.parse(cost)).not.toThrow();
  });

  it('拒绝缺少 fallbackReason 的输入（必须显式为 null）', () => {
    const cost = {
      tokenUsage: { input: 100, output: 50 },
      durationMs: 1234,
      llmModel: 'claude-sonnet-4-6',
    };
    expect(() => CostMetadataSchema.parse(cost)).toThrow();
  });
});

describe('TokenUsageSchema', () => {
  it('接受 input / output 零值', () => {
    expect(() => TokenUsageSchema.parse({ input: 0, output: 0 })).not.toThrow();
  });
});

describe('CompletedModuleSchema (Feature 127)', () => {
  it('同时接受历史 tokenUsage 数字 + 新 costMetadata 对象', () => {
    const completed = {
      path: 'modules/auth',
      specPath: 'specs/modules/auth.spec.md',
      completedAt: '2026-04-19T00:00:00.000Z',
      tokenUsage: 16300,
      costMetadata: {
        tokenUsage: { input: 12500, output: 3800 },
        durationMs: 42000,
        llmModel: 'claude-opus-4-7',
        fallbackReason: null,
      },
    };
    const parsed = CompletedModuleSchema.parse(completed);
    expect(parsed.tokenUsage).toBe(16300);
    expect(parsed.costMetadata?.llmModel).toBe('claude-opus-4-7');
  });

  it('接受仅有历史 tokenUsage 字段的旧 checkpoint', () => {
    const completed = {
      path: 'modules/auth',
      specPath: 'specs/modules/auth.spec.md',
      completedAt: '2026-04-19T00:00:00.000Z',
      tokenUsage: 16300,
    };
    const parsed = CompletedModuleSchema.parse(completed);
    expect(parsed.costMetadata).toBeUndefined();
  });
});
