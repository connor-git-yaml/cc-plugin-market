/**
 * module-grouper 单元测试
 * 验证文件→模块分组、模块级拓扑排序、边界情况处理
 */
import { describe, it, expect } from 'vitest';
import { groupFilesToModules } from '../../src/batch/module-grouper.js';
import type { DependencyGraph } from '../../src/models/dependency-graph.js';

/** 创建测试用 DependencyGraph */
function createGraph(
  modules: string[],
  edges: Array<[string, string]> = [],
): DependencyGraph {
  return {
    projectRoot: '/test-project',
    modules: modules.map((source) => ({
      source,
      isOrphan: false,
      inDegree: 0,
      outDegree: 0,
      level: 0,
    })),
    edges: edges.map(([from, to]) => ({
      from,
      to,
      isCircular: false,
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

describe('module-grouper', () => {
  describe('groupFilesToModules', () => {
    it('按 src/ 下第一级目录分组', () => {
      const graph = createGraph([
        'src/agents/live-model-filter.ts',
        'src/agents/context-pruning.ts',
        'src/config/index.ts',
        'src/config/loader.ts',
        'src/memory/store.ts',
      ]);

      const result = groupFilesToModules(graph);

      expect(result.groups).toHaveLength(3);

      const names = result.groups.map((g) => g.name).sort();
      expect(names).toEqual(['agents', 'config', 'memory']);

      const agentsGroup = result.groups.find((g) => g.name === 'agents')!;
      expect(agentsGroup.dirPath).toBe('src/agents');
      expect(agentsGroup.files).toHaveLength(2);
    });

    it('散文件归入 root 模块', () => {
      const graph = createGraph([
        'src/entry.ts',
        'src/index.ts',
        'src/agents/foo.ts',
      ]);

      const result = groupFilesToModules(graph);

      const rootGroup = result.groups.find((g) => g.name === 'root');
      expect(rootGroup).toBeDefined();
      expect(rootGroup!.files).toEqual(['src/entry.ts', 'src/index.ts']);
    });

    it('深嵌套文件归入顶层模块', () => {
      const graph = createGraph([
        'src/agents/pi-extensions/context-pruning.ts',
        'src/agents/test-helpers/fast-core-tools.ts',
        'src/agents/index.ts',
      ]);

      const result = groupFilesToModules(graph);

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0]!.name).toBe('agents');
      expect(result.groups[0]!.files).toHaveLength(3);
    });

    it('模块间拓扑排序正确（被依赖的先处理）', () => {
      const graph = createGraph(
        [
          'src/agents/runner.ts',
          'src/config/loader.ts',
          'src/utils/helper.ts',
        ],
        [
          // agents 依赖 config，config 依赖 utils
          ['src/agents/runner.ts', 'src/config/loader.ts'],
          ['src/config/loader.ts', 'src/utils/helper.ts'],
        ],
      );

      const result = groupFilesToModules(graph);

      // utils 应在 config 前，config 应在 agents 前
      const utilsIdx = result.moduleOrder.indexOf('utils');
      const configIdx = result.moduleOrder.indexOf('config');
      const agentsIdx = result.moduleOrder.indexOf('agents');

      expect(utilsIdx).toBeLessThan(configIdx);
      expect(configIdx).toBeLessThan(agentsIdx);
    });

    it('循环依赖不导致排序卡死', () => {
      const graph = createGraph(
        [
          'src/a/foo.ts',
          'src/b/bar.ts',
        ],
        [
          ['src/a/foo.ts', 'src/b/bar.ts'],
          ['src/b/bar.ts', 'src/a/foo.ts'],
        ],
      );

      const result = groupFilesToModules(graph);

      // 两个模块都应出现在排序结果中
      expect(result.moduleOrder).toHaveLength(2);
      expect(result.moduleOrder).toContain('a');
      expect(result.moduleOrder).toContain('b');
    });

    it('无 src/ 目录时按根目录第一级目录分组', () => {
      const graph = createGraph([
        'lib/utils.ts',
        'lib/core.ts',
        'helpers/format.ts',
      ]);

      const result = groupFilesToModules(graph);

      const names = result.groups.map((g) => g.name).sort();
      expect(names).toEqual(['helpers', 'lib']);
    });

    it('空图返回空结果', () => {
      const graph = createGraph([]);

      const result = groupFilesToModules(graph);

      expect(result.groups).toHaveLength(0);
      expect(result.moduleOrder).toHaveLength(0);
      expect(result.moduleEdges).toHaveLength(0);
    });

    it('自定义 depth=2 时按两级目录分组', () => {
      const graph = createGraph([
        'src/agents/pi-extensions/foo.ts',
        'src/agents/pi-extensions/bar.ts',
        'src/agents/core/runner.ts',
      ]);

      const result = groupFilesToModules(graph, { depth: 2 });

      const names = result.groups.map((g) => g.name).sort();
      expect(names).toEqual(['agents/core', 'agents/pi-extensions']);
    });

    it('模块内部边不生成模块级边', () => {
      const graph = createGraph(
        [
          'src/agents/a.ts',
          'src/agents/b.ts',
        ],
        [
          ['src/agents/a.ts', 'src/agents/b.ts'],
        ],
      );

      const result = groupFilesToModules(graph);

      // 同模块内的边不应生成模块间边
      expect(result.moduleEdges).toHaveLength(0);
    });

    it('模块间边正确去重', () => {
      const graph = createGraph(
        [
          'src/agents/a.ts',
          'src/agents/b.ts',
          'src/config/c.ts',
        ],
        [
          // agents 的两个文件都依赖 config
          ['src/agents/a.ts', 'src/config/c.ts'],
          ['src/agents/b.ts', 'src/config/c.ts'],
        ],
      );

      const result = groupFilesToModules(graph);

      // 应只有一条 agents→config 的模块级边
      expect(result.moduleEdges).toHaveLength(1);
      expect(result.moduleEdges[0]).toEqual({ from: 'agents', to: 'config' });
    });

    it('自定义 rootModuleName', () => {
      const graph = createGraph([
        'src/entry.ts',
        'src/agents/foo.ts',
      ]);

      const result = groupFilesToModules(graph, { rootModuleName: '_entry' });

      const rootGroup = result.groups.find((g) => g.name === '_entry');
      expect(rootGroup).toBeDefined();
      expect(rootGroup!.files).toEqual(['src/entry.ts']);
    });
  });
});
