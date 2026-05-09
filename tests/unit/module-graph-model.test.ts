/**
 * module-graph model schema 单元测试（W1.4 重命名自 dependency-graph-model）
 */
import { describe, it, expect } from 'vitest';
import {
  ModuleImportTypeSchema,
  ModuleNodeSchema,
  ModuleEdgeSchema,
  ModuleStronglyConnectedSetSchema,
  ModuleGraphSchema,
} from '../../src/knowledge-graph/module-derivation.js';

describe('module-graph model schemas', () => {
  it('ModuleImportTypeSchema 应接受 static/dynamic/type-only', () => {
    expect(ModuleImportTypeSchema.parse('static')).toBe('static');
    expect(ModuleImportTypeSchema.parse('dynamic')).toBe('dynamic');
    expect(ModuleImportTypeSchema.parse('type-only')).toBe('type-only');
  });

  it('ModuleNodeSchema 校验通过', () => {
    const node = ModuleNodeSchema.parse({
      source: 'src/a.ts',
      isOrphan: false,
      inDegree: 1,
      outDegree: 2,
      level: 0,
    });
    expect(node.source).toBe('src/a.ts');
  });

  it('ModuleEdgeSchema 校验通过', () => {
    const edge = ModuleEdgeSchema.parse({
      from: 'src/a.ts',
      to: 'src/b.ts',
      isCircular: false,
      importType: 'static',
    });
    expect(edge.importType).toBe('static');
  });

  it('ModuleStronglyConnectedSetSchema 要求 modules 至少一个元素', () => {
    expect(() =>
      ModuleStronglyConnectedSetSchema.parse({
        id: 0,
        modules: [],
      }),
    ).toThrow();
  });

  it('ModuleGraphSchema 完整对象校验通过', () => {
    const graph = ModuleGraphSchema.parse({
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
