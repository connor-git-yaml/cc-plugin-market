/**
 * dependency-graph model schema 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  ImportTypeSchema,
  GraphNodeSchema,
  DependencyEdgeSchema,
  SCCSchema,
  DependencyGraphSchema,
} from '../../src/models/dependency-graph.js';

describe('dependency-graph model schemas', () => {
  it('ImportTypeSchema 应接受 static/dynamic/type-only', () => {
    expect(ImportTypeSchema.parse('static')).toBe('static');
    expect(ImportTypeSchema.parse('dynamic')).toBe('dynamic');
    expect(ImportTypeSchema.parse('type-only')).toBe('type-only');
  });

  it('GraphNodeSchema 校验通过', () => {
    const node = GraphNodeSchema.parse({
      source: 'src/a.ts',
      isOrphan: false,
      inDegree: 1,
      outDegree: 2,
      level: 0,
    });
    expect(node.source).toBe('src/a.ts');
  });

  it('DependencyEdgeSchema 校验通过', () => {
    const edge = DependencyEdgeSchema.parse({
      from: 'src/a.ts',
      to: 'src/b.ts',
      isCircular: false,
      importType: 'static',
    });
    expect(edge.importType).toBe('static');
  });

  it('SCCSchema 要求 modules 至少一个元素', () => {
    expect(() =>
      SCCSchema.parse({
        id: 0,
        modules: [],
      }),
    ).toThrow();
  });

  it('DependencyGraphSchema 完整对象校验通过', () => {
    const graph = DependencyGraphSchema.parse({
      projectRoot: '/tmp/project',
      modules: [
        {
          source: 'src/a.ts',
          isOrphan: false,
          inDegree: 0,
          outDegree: 1,
          level: 0,
        },
      ],
      edges: [
        {
          from: 'src/a.ts',
          to: 'src/b.ts',
          isCircular: false,
          importType: 'static',
        },
      ],
      topologicalOrder: ['src/a.ts', 'src/b.ts'],
      sccs: [{ id: 0, modules: ['src/a.ts'] }],
      totalModules: 2,
      totalEdges: 1,
      analyzedAt: new Date().toISOString(),
      mermaidSource: 'graph LR',
    });
    expect(graph.totalModules).toBe(2);
  });
});

