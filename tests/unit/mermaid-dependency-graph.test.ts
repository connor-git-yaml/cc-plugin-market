/**
 * mermaid-dependency-graph 单元测试
 */
import { describe, it, expect } from 'vitest';
import { generateDependencyDiagram } from '../../src/generator/mermaid-dependency-graph.js';

function makeSkeleton(imports: Array<{
  moduleSpecifier: string;
  isRelative: boolean;
  isTypeOnly: boolean;
}>) {
  return {
    filePath: 'src/user-service.ts',
    language: 'typescript' as const,
    loc: 10,
    exports: [],
    imports,
    hash: 'a'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'ts-morph' as const,
  };
}

describe('generateDependencyDiagram', () => {
  it('无依赖时返回 null', () => {
    const result = generateDependencyDiagram(makeSkeleton([]));
    expect(result).toBeNull();
  });

  it('应区分内部依赖与外部依赖', () => {
    const result = generateDependencyDiagram(
      makeSkeleton([
        { moduleSpecifier: './domain/user', isRelative: true, isTypeOnly: false },
        { moduleSpecifier: 'zod', isRelative: false, isTypeOnly: false },
        { moduleSpecifier: 'node:fs', isRelative: false, isTypeOnly: true },
      ]),
    );

    expect(result).toContain('graph LR');
    expect(result).toContain('M["src/user-service"]');
    expect(result).toContain('domain/user');
    expect(result).toContain('📦 zod');
    expect(result).not.toContain('node:fs');
  });

  it('大量依赖时会显示省略节点', () => {
    const manyInternal = Array.from({ length: 17 }, (_, i) => ({
      moduleSpecifier: `./internal-${i}`,
      isRelative: true,
      isTypeOnly: false,
    }));
    const manyExternal = Array.from({ length: 12 }, (_, i) => ({
      moduleSpecifier: `pkg-${i}`,
      isRelative: false,
      isTypeOnly: false,
    }));

    const result = generateDependencyDiagram(makeSkeleton([...manyInternal, ...manyExternal]));
    expect(result).toContain('其他 2 个内部模块');
    expect(result).toContain('其他 2 个外部包');
  });
});

