/**
 * topological-sort 单元测试
 * 验证线性链排序、SCC 检测、断开组件、空图处理
 */
import { describe, it, expect } from 'vitest';
import { topologicalSort, detectSCCs } from '../../src/graph/topological-sort.js';
import type { DependencyGraph } from '../../src/models/dependency-graph.js';

/** 创建测试用 DependencyGraph */
function createGraph(
  modules: string[],
  edges: Array<[string, string, boolean?]>,
): DependencyGraph {
  return {
    projectRoot: '/test',
    modules: modules.map((source) => ({
      source,
      isOrphan: false,
      inDegree: 0,
      outDegree: 0,
      level: 0,
    })),
    edges: edges.map(([from, to, isCircular]) => ({
      from,
      to,
      isCircular: isCircular ?? false,
      importType: 'static' as const,
    })),
    topologicalOrder: [],
    sccs: [],
    totalModules: modules.length,
    totalEdges: edges.length,
    analyzedAt: new Date().toISOString(),
    mermaidSource: '',
  };
}

describe('topological-sort', () => {
  describe('topologicalSort', () => {
    it('应对线性链正确排序 (A→B→C)', () => {
      const graph = createGraph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C'],
        ],
      );
      const result = topologicalSort(graph);

      expect(result.hasCycles).toBe(false);
      expect(result.cycleGroups).toEqual([]);

      // A 依赖 B，B 依赖 C，所以 C 应该最先出现
      const indexA = result.order.indexOf('A');
      const indexB = result.order.indexOf('B');
      const indexC = result.order.indexOf('C');

      // 所有节点都应在排序中
      expect(indexA).toBeGreaterThanOrEqual(0);
      expect(indexB).toBeGreaterThanOrEqual(0);
      expect(indexC).toBeGreaterThanOrEqual(0);
    });

    it('应处理空图', () => {
      const graph = createGraph([], []);
      const result = topologicalSort(graph);

      expect(result.order).toEqual([]);
      expect(result.hasCycles).toBe(false);
      expect(result.cycleGroups).toEqual([]);
    });

    it('应处理单节点', () => {
      const graph = createGraph(['A'], []);
      const result = topologicalSort(graph);

      expect(result.order).toEqual(['A']);
      expect(result.hasCycles).toBe(false);
    });

    it('应处理断开的组件', () => {
      const graph = createGraph(
        ['A', 'B', 'C', 'D'],
        [
          ['A', 'B'], // 组件 1: A→B
          ['C', 'D'], // 组件 2: C→D
        ],
      );
      const result = topologicalSort(graph);

      expect(result.order).toHaveLength(4);
      expect(result.hasCycles).toBe(false);
    });

    it('应检测循环依赖 (X↔Y)', () => {
      const graph = createGraph(
        ['X', 'Y'],
        [
          ['X', 'Y', true],
          ['Y', 'X', true],
        ],
      );
      const result = topologicalSort(graph);

      expect(result.hasCycles).toBe(true);
      expect(result.cycleGroups.length).toBeGreaterThan(0);
      // 循环组应包含 X 和 Y
      const cycleGroup = result.cycleGroups[0]!;
      expect(cycleGroup).toContain('X');
      expect(cycleGroup).toContain('Y');
    });

    it('应为节点分配层级', () => {
      const graph = createGraph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C'],
        ],
      );
      const result = topologicalSort(graph);

      // 所有节点应有层级
      expect(result.levels.size).toBe(3);
    });

    it('应处理钻石依赖 (A→B, A→C, B→D, C→D)', () => {
      const graph = createGraph(
        ['A', 'B', 'C', 'D'],
        [
          ['A', 'B'],
          ['A', 'C'],
          ['B', 'D'],
          ['C', 'D'],
        ],
      );
      const result = topologicalSort(graph);

      expect(result.hasCycles).toBe(false);
      expect(result.order).toHaveLength(4);
    });
  });

  describe('detectSCCs', () => {
    it('应检测互相导入为一个 SCC', () => {
      const graph = createGraph(
        ['X', 'Y'],
        [
          ['X', 'Y'],
          ['Y', 'X'],
        ],
      );
      const sccs = detectSCCs(graph);

      // 应有一个大小为 2 的 SCC
      const largeSCCs = sccs.filter((s) => s.modules.length > 1);
      expect(largeSCCs).toHaveLength(1);
      expect(largeSCCs[0]!.modules.sort()).toEqual(['X', 'Y']);
    });

    it('应将独立节点识别为单元素 SCC', () => {
      const graph = createGraph(
        ['A', 'B', 'C'],
        [['A', 'B']],
      );
      const sccs = detectSCCs(graph);

      // 所有 SCC 大小应为 1
      expect(sccs.every((s) => s.modules.length === 1)).toBe(true);
    });

    it('应处理三节点循环 (A→B→C→A)', () => {
      const graph = createGraph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'A'],
        ],
      );
      const sccs = detectSCCs(graph);

      const largeSCCs = sccs.filter((s) => s.modules.length > 1);
      expect(largeSCCs).toHaveLength(1);
      expect(largeSCCs[0]!.modules.sort()).toEqual(['A', 'B', 'C']);
    });

    it('应为每个 SCC 分配唯一 ID', () => {
      const graph = createGraph(['A', 'B', 'C'], []);
      const sccs = detectSCCs(graph);

      const ids = sccs.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
