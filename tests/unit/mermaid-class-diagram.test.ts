/**
 * mermaid-class-diagram 单元测试
 * 验证类/接口渲染、<<interface>> 构造型、继承/组合边、空 exports 处理
 */
import { describe, it, expect } from 'vitest';
import { generateClassDiagram } from '../../src/generator/mermaid-class-diagram.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';

/** 创建测试用 CodeSkeleton */
function createSkeleton(
  exports: CodeSkeleton['exports'] = [],
): CodeSkeleton {
  return {
    filePath: 'src/test.ts',
    language: 'typescript',
    loc: 100,
    exports,
    imports: [],
    hash: 'a'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'ts-morph',
  };
}

describe('mermaid-class-diagram', () => {
  it('应为空 exports 返回空字符串', () => {
    const skeleton = createSkeleton();
    const result = generateClassDiagram(skeleton);
    expect(result).toBe('');
  });

  it('应跳过非类/接口的导出', () => {
    const skeleton = createSkeleton([
      {
        name: 'myFunc',
        kind: 'function',
        signature: 'function myFunc(): void',
        jsDoc: null,
        isDefault: false,
        startLine: 1,
        endLine: 3,
      },
      {
        name: 'MY_CONST',
        kind: 'const',
        signature: 'const MY_CONST: string',
        jsDoc: null,
        isDefault: false,
        startLine: 5,
        endLine: 5,
      },
    ]);
    const result = generateClassDiagram(skeleton);
    expect(result).toBe('');
  });

  it('应渲染类及其公共成员', () => {
    const skeleton = createSkeleton([
      {
        name: 'UserService',
        kind: 'class',
        signature: 'class UserService',
        jsDoc: null,
        isDefault: false,
        startLine: 1,
        endLine: 20,
        members: [
          {
            name: 'getUser',
            kind: 'method',
            signature: 'getUser(id: string): User',
            jsDoc: null,
            visibility: 'public',
            isStatic: false,
          },
          {
            name: 'name',
            kind: 'property',
            signature: 'name: string',
            jsDoc: null,
            visibility: 'private',
            isStatic: false,
          },
        ],
      },
    ]);
    const result = generateClassDiagram(skeleton);

    expect(result).toContain('classDiagram');
    expect(result).toContain('class UserService');
    expect(result).toContain('getUser');
    // 私有成员不应出现
    expect(result).not.toContain('+name: string');
  });

  it('应渲染 <<interface>> 构造型', () => {
    const skeleton = createSkeleton([
      {
        name: 'Repository',
        kind: 'interface',
        signature: 'interface Repository',
        jsDoc: null,
        isDefault: false,
        startLine: 1,
        endLine: 10,
        members: [
          {
            name: 'findById',
            kind: 'method',
            signature: 'findById(id: string): Entity',
            jsDoc: null,
            isStatic: false,
          },
        ],
      },
    ]);
    const result = generateClassDiagram(skeleton);

    expect(result).toContain('<<interface>>');
    expect(result).toContain('findById');
  });

  it('应渲染继承关系 --|>', () => {
    const skeleton = createSkeleton([
      {
        name: 'AdminUser',
        kind: 'class',
        signature: 'class AdminUser extends BaseUser',
        jsDoc: null,
        isDefault: false,
        startLine: 1,
        endLine: 10,
      },
    ]);
    const result = generateClassDiagram(skeleton);

    expect(result).toContain('BaseUser <|-- AdminUser');
  });

  it('应渲染实现关系 <|..', () => {
    const skeleton = createSkeleton([
      {
        name: 'SqlRepository',
        kind: 'class',
        signature: 'class SqlRepository implements Repository',
        jsDoc: null,
        isDefault: false,
        startLine: 1,
        endLine: 10,
      },
    ]);
    const result = generateClassDiagram(skeleton);

    expect(result).toContain('Repository <|.. SqlRepository');
  });

  it('应渲染组合关系 *--', () => {
    const skeleton = createSkeleton([
      {
        name: 'OrderService',
        kind: 'class',
        signature: 'class OrderService',
        jsDoc: null,
        isDefault: false,
        startLine: 1,
        endLine: 10,
        members: [
          {
            name: 'repository',
            kind: 'property',
            signature: 'repository: OrderRepository',
            jsDoc: null,
            visibility: 'public',
            isStatic: false,
          },
        ],
      },
    ]);
    const result = generateClassDiagram(skeleton);

    expect(result).toContain('OrderService *-- OrderRepository');
  });

  it('应正确标记静态成员', () => {
    const skeleton = createSkeleton([
      {
        name: 'Config',
        kind: 'class',
        signature: 'class Config',
        jsDoc: null,
        isDefault: false,
        startLine: 1,
        endLine: 10,
        members: [
          {
            name: 'getInstance',
            kind: 'method',
            signature: 'getInstance(): Config',
            jsDoc: null,
            visibility: 'public',
            isStatic: true,
          },
        ],
      },
    ]);
    const result = generateClassDiagram(skeleton);

    expect(result).toContain('$');
  });

  it('Mermaid 语法应以 classDiagram 开头', () => {
    const skeleton = createSkeleton([
      {
        name: 'Simple',
        kind: 'class',
        signature: 'class Simple',
        jsDoc: null,
        isDefault: false,
        startLine: 1,
        endLine: 5,
      },
    ]);
    const result = generateClassDiagram(skeleton);

    expect(result.startsWith('classDiagram')).toBe(true);
  });
});
