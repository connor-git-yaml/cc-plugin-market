/**
 * context-assembler 单元测试
 * 验证上下文组装、token 预算控制、裁剪优先级
 */
import { describe, it, expect } from 'vitest';
import { assembleContext } from '../../src/core/context-assembler.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';

/** 创建测试用 CodeSkeleton */
function createSkeleton(overrides?: Partial<CodeSkeleton>): CodeSkeleton {
  return {
    filePath: 'src/test.ts',
    language: 'typescript',
    loc: 100,
    exports: [
      {
        name: 'hello',
        kind: 'function',
        signature: 'function hello(name: string): string',
        jsDoc: null,
        isDefault: false,
        startLine: 1,
        endLine: 10,
      },
    ],
    imports: [
      {
        moduleSpecifier: 'node:fs',
        isRelative: false,
        isTypeOnly: false,
      },
    ],
    hash: 'a'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'ts-morph',
    ...overrides,
  };
}

describe('context-assembler', () => {
  it('应组装基本的上下文', async () => {
    const skeleton = createSkeleton();
    const result = await assembleContext(skeleton);

    expect(result.prompt).toBeTruthy();
    expect(result.tokenCount).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
    expect(result.truncatedParts).toEqual([]);
  });

  it('应包含骨架信息', async () => {
    const skeleton = createSkeleton();
    const result = await assembleContext(skeleton);

    expect(result.prompt).toContain('src/test.ts');
    expect(result.prompt).toContain('hello');
    expect(result.prompt).toContain('function hello');
  });

  it('应包含依赖 spec 摘要', async () => {
    const skeleton = createSkeleton();
    const result = await assembleContext(skeleton, {
      dependencySpecs: ['依赖模块 A: 提供认证功能'],
    });

    expect(result.prompt).toContain('依赖模块 A');
    expect(result.breakdown.dependencies).toBeGreaterThan(0);
  });

  it('应包含代码片段', async () => {
    const skeleton = createSkeleton();
    const result = await assembleContext(skeleton, {
      codeSnippets: ['function complexLogic() { /* ... */ }'],
    });

    expect(result.prompt).toContain('complexLogic');
    expect(result.breakdown.snippets).toBeGreaterThan(0);
  });

  it('预算不足时应先裁剪 snippets', async () => {
    const skeleton = createSkeleton();
    const result = await assembleContext(skeleton, {
      codeSnippets: ['x'.repeat(10000)],
      dependencySpecs: ['dep summary'],
      maxTokens: 200,
    });

    expect(result.truncated).toBe(true);
    expect(result.truncatedParts).toContain('codeSnippets');
  });

  it('预算不足时应在 snippets 后裁剪 dependencies', async () => {
    const skeleton = createSkeleton();
    const result = await assembleContext(skeleton, {
      dependencySpecs: ['d'.repeat(10000)],
      maxTokens: 200,
    });

    expect(result.truncated).toBe(true);
    expect(result.truncatedParts).toContain('dependencySpecs');
  });

  it('应使用默认 100k 预算', async () => {
    const skeleton = createSkeleton();
    const result = await assembleContext(skeleton);

    // 小骨架不应被裁剪
    expect(result.truncated).toBe(false);
  });

  it('应包含模板指令', async () => {
    const skeleton = createSkeleton();
    const result = await assembleContext(skeleton, {
      templateInstructions: '请分析以下模块',
    });

    expect(result.prompt).toContain('请分析以下模块');
    expect(result.breakdown.instructions).toBeGreaterThan(0);
  });

  it('breakdown 各部分之和应接近 tokenCount', async () => {
    const skeleton = createSkeleton();
    const result = await assembleContext(skeleton, {
      dependencySpecs: ['dep'],
      codeSnippets: ['code'],
      templateInstructions: '指令',
    });

    const sum =
      result.breakdown.skeleton +
      result.breakdown.dependencies +
      result.breakdown.snippets +
      result.breakdown.instructions;

    // 由于组装时有分隔符，tokenCount 可能略大于各部分之和
    expect(result.tokenCount).toBeGreaterThanOrEqual(sum * 0.8);
  });
});
