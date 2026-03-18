/**
 * index-generator 单元测试
 * 验证架构索引生成器的多语言分布展示、条件渲染、百分比计算等
 */
import { describe, it, expect, afterAll } from 'vitest';
import { generateIndex } from '../../src/generator/index-generator.js';
import { renderSpec, initRenderer, resetRenderer } from '../../src/generator/spec-renderer.js';
import type { ModuleSpec } from '../../src/models/module-spec.js';
import type { DependencyGraph } from '../../src/models/dependency-graph.js';
import type { LanguageFileStat } from '../../src/utils/file-scanner.js';

/** 创建测试用 DependencyGraph */
function createGraph(projectRoot = '/test'): DependencyGraph {
  return {
    projectRoot,
    modules: [],
    edges: [],
    topologicalOrder: [],
    sccs: [],
    totalModules: 0,
    totalEdges: 0,
    analyzedAt: new Date().toISOString(),
    mermaidSource: 'graph TD',
  };
}

/** 创建测试用 ModuleSpec */
function createSpec(opts: {
  sourceTarget: string;
  language?: string;
}): ModuleSpec {
  return {
    frontmatter: {
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'reverse-spec v2.0',
      sourceTarget: opts.sourceTarget,
      relatedFiles: [],
      lastUpdated: new Date().toISOString(),
      confidence: 'high',
      skeletonHash: 'a'.repeat(64),
      language: opts.language,
    },
    sections: {
      intent: '测试意图',
      interfaceDefinition: '测试接口',
      businessLogic: '测试逻辑',
      dataStructures: '测试数据',
      constraints: '测试约束',
      edgeCases: '测试边界',
      technicalDebt: '测试债务',
      testCoverage: '测试覆盖',
      dependencies: '测试依赖',
    },
    fileInventory: [],
    baselineSkeleton: {
      filePath: 'test.ts',
      language: 'typescript',
      loc: 10,
      exports: [],
      imports: [],
      hash: 'a'.repeat(64),
      analyzedAt: new Date().toISOString(),
      parserUsed: 'ts-morph',
    },
    outputPath: `specs/${opts.sourceTarget}.spec.md`,
  };
}

describe('index-generator', () => {
  it('T086: 多语言项目索引包含正确的语言分布', () => {
    const specs = [
      createSpec({ sourceTarget: 'src/api', language: 'ts-js' }),
      createSpec({ sourceTarget: 'src/services', language: 'ts-js' }),
      createSpec({ sourceTarget: 'scripts/deploy', language: 'python' }),
    ];
    const graph = createGraph();
    const languageStats = new Map<string, LanguageFileStat>([
      ['ts-js', { adapterId: 'ts-js', fileCount: 10, extensions: ['.ts'] }],
      ['python', { adapterId: 'python', fileCount: 5, extensions: ['.py'] }],
    ]);

    const index = generateIndex(specs, graph, languageStats);

    expect(index.languageDistribution).toBeDefined();
    expect(index.languageDistribution).toHaveLength(2);

    // ts-js 应有 2 个模块
    const tsDist = index.languageDistribution!.find((d) => d.adapterId === 'ts-js')!;
    expect(tsDist.fileCount).toBe(10);
    expect(tsDist.moduleCount).toBe(2);

    // python 应有 1 个模块
    const pyDist = index.languageDistribution!.find((d) => d.adapterId === 'python')!;
    expect(pyDist.fileCount).toBe(5);
    expect(pyDist.moduleCount).toBe(1);
  });

  it('T087: 纯单语言项目索引不包含语言分布 section', () => {
    const specs = [createSpec({ sourceTarget: 'src/api' })];
    const graph = createGraph();
    const languageStats = new Map<string, LanguageFileStat>([
      ['ts-js', { adapterId: 'ts-js', fileCount: 10, extensions: ['.ts'] }],
    ]);

    const index = generateIndex(specs, graph, languageStats);

    expect(index.languageDistribution).toBeUndefined();
  });

  it('T088: 语言过滤后索引展示全部语言但 processed 列正确标注', () => {
    const specs = [
      createSpec({ sourceTarget: 'src/api', language: 'ts-js' }),
    ];
    const graph = createGraph();
    const languageStats = new Map<string, LanguageFileStat>([
      ['ts-js', { adapterId: 'ts-js', fileCount: 10, extensions: ['.ts'] }],
      ['python', { adapterId: 'python', fileCount: 5, extensions: ['.py'] }],
      ['go', { adapterId: 'go', fileCount: 3, extensions: ['.go'] }],
    ]);

    // 仅处理了 ts-js
    const index = generateIndex(specs, graph, languageStats, ['ts-js']);

    expect(index.languageDistribution).toBeDefined();
    expect(index.languageDistribution).toHaveLength(3);

    const tsDist = index.languageDistribution!.find((d) => d.adapterId === 'ts-js')!;
    expect(tsDist.processed).toBe(true);

    const pyDist = index.languageDistribution!.find((d) => d.adapterId === 'python')!;
    expect(pyDist.processed).toBe(false);

    const goDist = index.languageDistribution!.find((d) => d.adapterId === 'go')!;
    expect(goDist.processed).toBe(false);
  });

  it('T089: languageDistribution 中各语言的 percentage 之和约为 100%', () => {
    const specs: ModuleSpec[] = [];
    const graph = createGraph();
    const languageStats = new Map<string, LanguageFileStat>([
      ['ts-js', { adapterId: 'ts-js', fileCount: 30, extensions: ['.ts'] }],
      ['python', { adapterId: 'python', fileCount: 15, extensions: ['.py'] }],
      ['go', { adapterId: 'go', fileCount: 10, extensions: ['.go'] }],
    ]);

    const index = generateIndex(specs, graph, languageStats);

    expect(index.languageDistribution).toBeDefined();
    const totalPercentage = index.languageDistribution!.reduce(
      (sum, d) => sum + d.percentage,
      0,
    );
    // 由于四舍五入，允许 0.5% 误差
    expect(totalPercentage).toBeGreaterThanOrEqual(99.5);
    expect(totalPercentage).toBeLessThanOrEqual(100.5);
  });

  it('T090: 不传 languageStats 时与现有行为完全一致', () => {
    const specs = [createSpec({ sourceTarget: 'src/api' })];
    const graph = createGraph();

    const index = generateIndex(specs, graph);

    expect(index.languageDistribution).toBeUndefined();
    expect(index.frontmatter.type).toBe('architecture-index');
  });

  it('T092: languageDistribution 按文件数降序排列', () => {
    const specs: ModuleSpec[] = [];
    const graph = createGraph();
    const languageStats = new Map<string, LanguageFileStat>([
      ['go', { adapterId: 'go', fileCount: 5, extensions: ['.go'] }],
      ['ts-js', { adapterId: 'ts-js', fileCount: 30, extensions: ['.ts'] }],
      ['python', { adapterId: 'python', fileCount: 15, extensions: ['.py'] }],
    ]);

    const index = generateIndex(specs, graph, languageStats);

    expect(index.languageDistribution).toBeDefined();
    expect(index.languageDistribution![0]!.adapterId).toBe('ts-js');
    expect(index.languageDistribution![1]!.adapterId).toBe('python');
    expect(index.languageDistribution![2]!.adapterId).toBe('go');
  });
});

// ============================================================
// T093: module-spec.hbs 渲染 crossLanguageRefs 列表
// ============================================================
describe('module-spec.hbs 模板渲染', () => {
  afterAll(() => {
    resetRenderer();
  });

  it('T093: 渲染含 crossLanguageRefs 的 frontmatter', () => {
    initRenderer();

    const spec: ModuleSpec = {
      frontmatter: {
        type: 'module-spec',
        version: 'v1',
        generatedBy: 'reverse-spec v2.0',
        sourceTarget: 'src/api',
        relatedFiles: ['src/api/routes.ts'],
        lastUpdated: new Date().toISOString(),
        confidence: 'high',
        skeletonHash: 'a'.repeat(64),
        language: 'ts-js',
        crossLanguageRefs: ['python:scripts/deploy', 'go:go-services/auth'],
      },
      sections: {
        intent: '测试意图',
        interfaceDefinition: '测试接口',
        businessLogic: '测试逻辑',
        dataStructures: '测试数据',
        constraints: '测试约束',
        edgeCases: '测试边界',
        technicalDebt: '测试债务',
        testCoverage: '测试覆盖',
        dependencies: '测试依赖',
      },
      fileInventory: [{ path: 'src/api/routes.ts', loc: 100, purpose: '路由' }],
      baselineSkeleton: {
        filePath: 'src/api/routes.ts',
        language: 'typescript',
        loc: 100,
        exports: [],
        imports: [],
        hash: 'a'.repeat(64),
        analyzedAt: new Date().toISOString(),
        parserUsed: 'ts-morph',
      },
      outputPath: 'specs/src/api.spec.md',
    };

    const markdown = renderSpec(spec);

    // frontmatter 包含 language 字段
    expect(markdown).toContain('language: ts-js');

    // frontmatter 包含 crossLanguageRefs 列表
    expect(markdown).toContain('crossLanguageRefs:');
    expect(markdown).toContain('python:scripts/deploy');
    expect(markdown).toContain('go:go-services/auth');
  });

  it('T093-补充: 无 crossLanguageRefs 时不渲染该字段', () => {
    initRenderer();

    const spec: ModuleSpec = {
      frontmatter: {
        type: 'module-spec',
        version: 'v1',
        generatedBy: 'reverse-spec v2.0',
        sourceTarget: 'src/utils',
        relatedFiles: [],
        lastUpdated: new Date().toISOString(),
        confidence: 'high',
        skeletonHash: 'b'.repeat(64),
      },
      sections: {
        intent: '工具函数',
        interfaceDefinition: '接口',
        businessLogic: '逻辑',
        dataStructures: '数据',
        constraints: '约束',
        edgeCases: '边界',
        technicalDebt: '债务',
        testCoverage: '覆盖',
        dependencies: '依赖',
      },
      fileInventory: [],
      baselineSkeleton: {
        filePath: 'src/utils/index.ts',
        language: 'typescript',
        loc: 50,
        exports: [],
        imports: [],
        hash: 'b'.repeat(64),
        analyzedAt: new Date().toISOString(),
        parserUsed: 'ts-morph',
      },
      outputPath: 'specs/src/utils.spec.md',
    };

    const markdown = renderSpec(spec);

    // 不含 crossLanguageRefs
    expect(markdown).not.toContain('crossLanguageRefs:');
    // 不含 language
    expect(markdown).not.toContain('language:');
  });
});
