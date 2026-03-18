/**
 * module-grouper 单元测试
 * 验证文件→模块分组、模块级拓扑排序、边界情况处理
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { groupFilesToModules } from '../../src/batch/module-grouper.js';
import type { DependencyGraph } from '../../src/models/dependency-graph.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';

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

  // ============================================================
  // Phase 4: 语言感知分组测试（T038-T045）
  // ============================================================

  describe('语言感知分组（languageAware）', () => {
    beforeEach(() => {
      LanguageAdapterRegistry.resetInstance();
      bootstrapAdapters();
    });

    afterEach(() => {
      LanguageAdapterRegistry.resetInstance();
    });

    it('T038: 同目录下 .ts + .py 文件拆分为两个双连字符子模块', () => {
      const graph = createGraph([
        'src/services/auth.ts',
        'src/services/middleware.ts',
        'src/services/auth.py',
      ]);

      const result = groupFilesToModules(graph, { languageAware: true });

      const names = result.groups.map((g) => g.name).sort();
      expect(names).toContain('services--ts-js');
      expect(names).toContain('services--python');

      const tsGroup = result.groups.find((g) => g.name === 'services--ts-js')!;
      expect(tsGroup.files).toHaveLength(2);
      expect(tsGroup.language).toBe('ts-js');

      const pyGroup = result.groups.find((g) => g.name === 'services--python')!;
      expect(pyGroup.files).toHaveLength(1);
      expect(pyGroup.language).toBe('python');
    });

    it('T039: 同目录下三种语言文件正确拆分为三个双连字符子模块', () => {
      const graph = createGraph([
        'src/services/auth.ts',
        'src/services/auth.py',
        'src/services/handler.go',
      ]);

      const result = groupFilesToModules(graph, { languageAware: true });

      const names = result.groups.map((g) => g.name).sort();
      expect(names).toContain('services--go');
      expect(names).toContain('services--python');
      expect(names).toContain('services--ts-js');
    });

    it('T040: 纯单语言目录不追加语言后缀', () => {
      const graph = createGraph([
        'src/services/auth.ts',
        'src/services/middleware.ts',
      ]);

      const result = groupFilesToModules(graph, { languageAware: true });

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0]!.name).toBe('services');
      expect(result.groups[0]!.language).toBe('ts-js');
    });

    it('T041: languageAware=false 时行为与现有逻辑完全一致（回归）', () => {
      const graph = createGraph([
        'src/services/auth.ts',
        'src/services/auth.py',
      ]);

      const result = groupFilesToModules(graph, { languageAware: false });

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0]!.name).toBe('services');
      expect(result.groups[0]!.language).toBeUndefined();
    });

    it('T042: root 模块在多语言场景下正确拆分', () => {
      const graph = createGraph([
        'src/entry.ts',
        'src/main.py',
        'src/agents/foo.ts',
      ]);

      const result = groupFilesToModules(graph, { languageAware: true });

      const rootNames = result.groups
        .filter((g) => g.name.startsWith('root'))
        .map((g) => g.name)
        .sort();
      expect(rootNames).toContain('root--ts-js');
      expect(rootNames).toContain('root--python');
    });

    it('T043: 已包含连字符的模块名追加语言后缀', () => {
      const graph = createGraph([
        'src/auth-service/handler.ts',
        'src/auth-service/helper.py',
      ]);

      const result = groupFilesToModules(graph, { languageAware: true });

      const names = result.groups.map((g) => g.name).sort();
      expect(names).toContain('auth-service--ts-js');
      expect(names).toContain('auth-service--python');
    });

    it('T044: 每个 ModuleGroup 的 language 字段正确设置', () => {
      const graph = createGraph([
        'src/api/routes.ts',
        'src/api/handler.go',
      ]);

      const result = groupFilesToModules(graph, { languageAware: true });

      for (const group of result.groups) {
        expect(group.language).toBeDefined();
        if (group.name.includes('ts-js')) {
          expect(group.language).toBe('ts-js');
        }
        if (group.name.includes('go')) {
          expect(group.language).toBe('go');
        }
      }
    });

    it('T045: 不同深度的目录分组与语言感知同时启用时正确交互', () => {
      const graph = createGraph([
        'src/agents/core/runner.ts',
        'src/agents/core/helper.py',
        'src/agents/ext/plugin.ts',
      ]);

      const result = groupFilesToModules(graph, {
        depth: 2,
        languageAware: true,
      });

      const names = result.groups.map((g) => g.name).sort();
      // agents/core 有两种语言，应拆分
      expect(names).toContain('agents/core--ts-js');
      expect(names).toContain('agents/core--python');
      // agents/ext 仅一种语言，不拆分
      expect(names).toContain('agents/ext');
    });
  });
});
