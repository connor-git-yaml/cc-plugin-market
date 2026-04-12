/**
 * extraction-types.ts 单元测试
 * 覆盖 Zod schema 验证、常量不变性、枚举完整性
 */
import { describe, it, expect } from 'vitest';
import {
  ExtractedNodeSchema,
  ExtractedEdgeSchema,
  ExtractionResultSchema,
  EMPTY_EXTRACTION_RESULT,
} from '../../src/extraction/extraction-types.js';

describe('ExtractedNodeSchema', () => {
  it('合法节点通过验证', () => {
    const node = {
      id: 'doc:docs/adr-001.md',
      label: 'ADR-001',
      kind: 'document' as const,
      source_file: '/project/docs/adr-001.md',
      confidence: 'EXTRACTED' as const,
      metadata: { headings: ['Background'] },
    };
    const result = ExtractedNodeSchema.safeParse(node);
    expect(result.success).toBe(true);
  });

  it('缺少必填字段 id 时验证失败', () => {
    const node = {
      label: 'ADR-001',
      kind: 'document',
      source_file: '/project/docs/adr-001.md',
      confidence: 'EXTRACTED',
    };
    const result = ExtractedNodeSchema.safeParse(node);
    expect(result.success).toBe(false);
  });

  it('非法 kind 值时验证失败', () => {
    const node = {
      id: 'doc:docs/adr-001.md',
      label: 'ADR-001',
      kind: 'unknown-kind',  // 非法枚举值
      source_file: '/project/docs/adr-001.md',
      confidence: 'EXTRACTED',
    };
    const result = ExtractedNodeSchema.safeParse(node);
    expect(result.success).toBe(false);
  });

  it('metadata 字段可选', () => {
    const node = {
      id: 'api:GET:/users:openapi.yaml',
      label: 'GET /users',
      kind: 'api' as const,
      source_file: '/project/openapi.yaml',
      confidence: 'EXTRACTED' as const,
    };
    const result = ExtractedNodeSchema.safeParse(node);
    expect(result.success).toBe(true);
  });

  it('支持所有合法 kind 枚举值', () => {
    const kinds = ['document', 'api', 'api-schema', 'event', 'diagram'] as const;
    for (const kind of kinds) {
      const result = ExtractedNodeSchema.safeParse({
        id: `${kind}:test`,
        label: 'test',
        kind,
        source_file: '/project/test.file',
        confidence: 'EXTRACTED',
      });
      expect(result.success, `kind=${kind} 应通过验证`).toBe(true);
    }
  });
});

describe('ExtractedEdgeSchema', () => {
  it('合法边通过验证', () => {
    const edge = {
      source: 'doc:docs/adr-001.md',
      target: 'module:src/auth/auth.ts',
      relation: 'references',
      confidence: 'INFERRED' as const,
    };
    const result = ExtractedEdgeSchema.safeParse(edge);
    expect(result.success).toBe(true);
  });

  it('weight 默认值为 1.0', () => {
    const edge = {
      source: 'doc:docs/adr-001.md',
      target: 'module:src/auth/auth.ts',
      relation: 'references',
      confidence: 'INFERRED' as const,
    };
    const result = ExtractedEdgeSchema.safeParse(edge);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.weight).toBe(1.0);
    }
  });

  it('非法 confidence 值时验证失败', () => {
    const edge = {
      source: 'doc:docs/adr-001.md',
      target: 'module:src/auth/auth.ts',
      relation: 'references',
      confidence: 'VERY_CONFIDENT',  // 非法枚举值
    };
    const result = ExtractedEdgeSchema.safeParse(edge);
    expect(result.success).toBe(false);
  });
});

describe('ExtractionResultSchema', () => {
  it('空 nodes/edges 通过验证', () => {
    const result = ExtractionResultSchema.safeParse({ nodes: [], edges: [] });
    expect(result.success).toBe(true);
  });

  it('含合法节点和边通过验证', () => {
    const input = {
      nodes: [
        {
          id: 'doc:docs/adr-001.md',
          label: 'ADR-001',
          kind: 'document',
          source_file: '/project/docs/adr-001.md',
          confidence: 'EXTRACTED',
        },
      ],
      edges: [
        {
          source: 'doc:docs/adr-001.md',
          target: 'module:src/auth/auth.ts',
          relation: 'references',
          confidence: 'INFERRED',
        },
      ],
    };
    const result = ExtractionResultSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('nodes 字段不存在时验证失败', () => {
    const result = ExtractionResultSchema.safeParse({ edges: [] });
    expect(result.success).toBe(false);
  });
});

describe('EMPTY_EXTRACTION_RESULT', () => {
  it('nodes 和 edges 均为空数组', () => {
    expect(EMPTY_EXTRACTION_RESULT.nodes).toEqual([]);
    expect(EMPTY_EXTRACTION_RESULT.edges).toEqual([]);
  });

  it('对象被冻结（不可变）', () => {
    expect(Object.isFrozen(EMPTY_EXTRACTION_RESULT)).toBe(true);
  });

  it('尝试修改冻结对象会失败（严格模式）', () => {
    expect(() => {
      // @ts-expect-error 故意违反类型约束测试冻结行为
      (EMPTY_EXTRACTION_RESULT as Record<string, unknown>).nodes = ['should-fail'];
    }).toThrow();
  });

  it('通过 ExtractionResultSchema 验证', () => {
    const result = ExtractionResultSchema.safeParse(EMPTY_EXTRACTION_RESULT);
    expect(result.success).toBe(true);
  });
});
