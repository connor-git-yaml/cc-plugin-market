/**
 * CodeSkeleton 兼容性测试
 * 验证 Zod Schema 扩展后的前向兼容性（SC-004, US4）
 *
 * 测试矩阵：
 * - 旧值（typescript/javascript）仍可 parse
 * - 新值（python/go 等）可 parse
 * - 非法值 parse 失败
 * - ExportKind / MemberKind 新增值可 parse
 * - filePath 正则支持新语言扩展名
 */
import { describe, it, expect } from 'vitest';
import {
  LanguageSchema,
  ExportKindSchema,
  MemberKindSchema,
  CodeSkeletonSchema,
} from '../../src/models/code-skeleton.js';

describe('CodeSkeleton 兼容性测试', () => {
  // ============================================================
  // LanguageSchema
  // ============================================================

  it('旧值 language: "typescript" parse 成功', () => {
    expect(LanguageSchema.parse('typescript')).toBe('typescript');
  });

  it('旧值 language: "javascript" parse 成功', () => {
    expect(LanguageSchema.parse('javascript')).toBe('javascript');
  });

  it('新值 language: "python" parse 成功', () => {
    expect(LanguageSchema.parse('python')).toBe('python');
  });

  it('新值 language: "go" parse 成功', () => {
    expect(LanguageSchema.parse('go')).toBe('go');
  });

  it('新值 language: "rust" parse 成功', () => {
    expect(LanguageSchema.parse('rust')).toBe('rust');
  });

  it('非法值 language: "unknown" parse 失败', () => {
    expect(() => LanguageSchema.parse('unknown')).toThrow();
  });

  // ============================================================
  // ExportKindSchema
  // ============================================================

  it('旧值 kind: "function" parse 成功', () => {
    expect(ExportKindSchema.parse('function')).toBe('function');
  });

  it('新值 kind: "struct" parse 成功', () => {
    expect(ExportKindSchema.parse('struct')).toBe('struct');
  });

  it('新值 kind: "trait" parse 成功', () => {
    expect(ExportKindSchema.parse('trait')).toBe('trait');
  });

  it('新值 kind: "data_class" parse 成功', () => {
    expect(ExportKindSchema.parse('data_class')).toBe('data_class');
  });

  // ============================================================
  // MemberKindSchema
  // ============================================================

  it('旧值 memberKind: "method" parse 成功', () => {
    expect(MemberKindSchema.parse('method')).toBe('method');
  });

  it('新值 memberKind: "classmethod" parse 成功', () => {
    expect(MemberKindSchema.parse('classmethod')).toBe('classmethod');
  });

  it('新值 memberKind: "associated_function" parse 成功', () => {
    expect(MemberKindSchema.parse('associated_function')).toBe('associated_function');
  });

  // ============================================================
  // filePath 正则
  // ============================================================

  it('旧版 filePath "src/foo.ts" 通过新正则验证', () => {
    const skeleton = buildMinimalSkeleton({ filePath: 'src/foo.ts', language: 'typescript' });
    expect(() => CodeSkeletonSchema.parse(skeleton)).not.toThrow();
  });

  it('新语言 filePath "src/main.py" 通过新正则验证', () => {
    const skeleton = buildMinimalSkeleton({ filePath: 'src/main.py', language: 'python' });
    expect(() => CodeSkeletonSchema.parse(skeleton)).not.toThrow();
  });

  it('新语言 filePath "src/main.go" 通过新正则验证', () => {
    const skeleton = buildMinimalSkeleton({ filePath: 'src/main.go', language: 'go' });
    expect(() => CodeSkeletonSchema.parse(skeleton)).not.toThrow();
  });

  it('新语言 filePath "lib/parser.rs" 通过新正则验证', () => {
    const skeleton = buildMinimalSkeleton({ filePath: 'lib/parser.rs', language: 'rust' });
    expect(() => CodeSkeletonSchema.parse(skeleton)).not.toThrow();
  });

  it('新语言 filePath "app/service.kt" 通过新正则验证', () => {
    const skeleton = buildMinimalSkeleton({ filePath: 'app/service.kt', language: 'kotlin' });
    expect(() => CodeSkeletonSchema.parse(skeleton)).not.toThrow();
  });
});

// ============================================================
// 辅助函数
// ============================================================

/**
 * 构建最小化 CodeSkeleton 对象用于 Schema 验证
 */
function buildMinimalSkeleton(overrides: { filePath: string; language: string }): unknown {
  return {
    filePath: overrides.filePath,
    language: overrides.language,
    loc: 10,
    exports: [],
    imports: [],
    hash: 'a'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'ts-morph',
  };
}
