/**
 * CrossPackageAnalyzer 单元测试
 * 覆盖 isApplicable、extract、generate、render、统计信息、拓扑排序、注册集成
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import {
  CrossPackageAnalyzer,
  type CrossPackageInput,
  type CrossPackageOutput,
} from '../../src/panoramic/cross-package-analyzer.js';
import type { WorkspacePackageInfo } from '../../src/panoramic/workspace-index-generator.js';
import type { DependencyGraph, GraphNode, DependencyEdge } from '../../src/models/dependency-graph.js';
import { GeneratorRegistry, bootstrapGenerators } from '../../src/panoramic/generator-registry.js';

// ============================================================
// 辅助函数
// ============================================================

/** 创建临时目录 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cross-pkg-test-'));
}

/** 清理临时目录 */
function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** 构建最小 ProjectContext */
function createContext(
  projectRoot: string,
  overrides: Partial<ProjectContext> = {},
): ProjectContext {
  return {
    projectRoot,
    configFiles: new Map(),
    packageManager: 'unknown',
    workspaceType: 'single',
    detectedLanguages: [],
    existingSpecs: [],
    ...overrides,
  };
}

/** 写入文件并确保目录存在 */
function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * 从 packages 构建 CrossPackageInput，跳过 extract() 直接构建
 * 用于 generate/render 方法的单元测试
 */
function buildInputFromPackages(
  packages: WorkspacePackageInfo[],
  projectName = 'test-project',
  workspaceType: 'npm' | 'pnpm' | 'uv' = 'npm',
): CrossPackageInput {
  const packageNameSet = new Set(packages.map((p) => p.name));

  // 计算入度
  const inDegreeMap = new Map<string, number>();
  for (const pkg of packages) {
    inDegreeMap.set(pkg.name, 0);
  }
  for (const pkg of packages) {
    for (const dep of pkg.dependencies) {
      if (dep === pkg.name || !packageNameSet.has(dep)) continue;
      inDegreeMap.set(dep, (inDegreeMap.get(dep) ?? 0) + 1);
    }
  }

  const modules: GraphNode[] = [];
  const edges: DependencyEdge[] = [];

  for (const pkg of packages) {
    const validDeps = pkg.dependencies.filter(
      (dep) => dep !== pkg.name && packageNameSet.has(dep),
    );
    const outDegree = validDeps.length;
    const inDegree = inDegreeMap.get(pkg.name) ?? 0;

    modules.push({
      source: pkg.name,
      isOrphan: inDegree === 0 && outDegree === 0,
      inDegree,
      outDegree,
      level: 0,
      language: pkg.language,
    });

    for (const dep of validDeps) {
      edges.push({
        from: pkg.name,
        to: dep,
        isCircular: false,
        importType: 'static',
      });
    }
  }

  const graph: DependencyGraph = {
    projectRoot: '/tmp/test',
    modules,
    edges,
    topologicalOrder: [],
    sccs: [],
    totalModules: modules.length,
    totalEdges: edges.length,
    analyzedAt: new Date().toISOString(),
    mermaidSource: '',
  };

  return { projectName, workspaceType, packages, graph };
}

// 用于测试的 fixture 工厂函数

/** 3 包线性依赖：A -> B -> C */
function linearDepsPackages(): WorkspacePackageInfo[] {
  return [
    { name: 'A', path: 'packages/A', description: '', language: 'TypeScript', dependencies: ['B'] },
    { name: 'B', path: 'packages/B', description: '', language: 'TypeScript', dependencies: ['C'] },
    { name: 'C', path: 'packages/C', description: '', language: 'TypeScript', dependencies: [] },
  ];
}

/** 3 包循环依赖：A -> B -> C -> A */
function cyclicDepsPackages(): WorkspacePackageInfo[] {
  return [
    { name: 'A', path: 'packages/A', description: '', language: 'TypeScript', dependencies: ['B'] },
    { name: 'B', path: 'packages/B', description: '', language: 'TypeScript', dependencies: ['C'] },
    { name: 'C', path: 'packages/C', description: '', language: 'TypeScript', dependencies: ['A'] },
  ];
}

/** 双组独立循环：A <-> B 和 C <-> D */
function multiCyclePackages(): WorkspacePackageInfo[] {
  return [
    { name: 'A', path: 'packages/A', description: '', language: 'TypeScript', dependencies: ['B'] },
    { name: 'B', path: 'packages/B', description: '', language: 'TypeScript', dependencies: ['A'] },
    { name: 'C', path: 'packages/C', description: '', language: 'TypeScript', dependencies: ['D'] },
    { name: 'D', path: 'packages/D', description: '', language: 'TypeScript', dependencies: ['C'] },
  ];
}

/** 3 个独立包（无依赖） */
function noDepsPackages(): WorkspacePackageInfo[] {
  return [
    { name: 'X', path: 'packages/X', description: '', language: 'TypeScript', dependencies: [] },
    { name: 'Y', path: 'packages/Y', description: '', language: 'TypeScript', dependencies: [] },
    { name: 'Z', path: 'packages/Z', description: '', language: 'TypeScript', dependencies: [] },
  ];
}

/** 单包 */
function singlePackage(): WorkspacePackageInfo[] {
  return [
    { name: 'Solo', path: 'packages/Solo', description: '', language: 'TypeScript', dependencies: [] },
  ];
}

// ============================================================
// Phase 3: US1 - isApplicable 测试（T007）
// ============================================================

describe('CrossPackageAnalyzer - isApplicable (T007)', () => {
  let analyzer: CrossPackageAnalyzer;

  beforeEach(() => {
    analyzer = new CrossPackageAnalyzer();
  });

  it('workspaceType=monorepo 时返回 true', () => {
    const context = createContext('/tmp/fake', { workspaceType: 'monorepo' });
    expect(analyzer.isApplicable(context)).toBe(true);
  });

  it('workspaceType=single 时返回 false', () => {
    const context = createContext('/tmp/fake', { workspaceType: 'single' });
    expect(analyzer.isApplicable(context)).toBe(false);
  });
});

// ============================================================
// Phase 3: US1 - extract 测试（T008-T009）
// ============================================================

describe('CrossPackageAnalyzer - extract (T008)', () => {
  let tmpDir: string;
  let analyzer: CrossPackageAnalyzer;

  beforeEach(() => {
    tmpDir = createTempDir();
    analyzer = new CrossPackageAnalyzer();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('3 包线性依赖: graph 有 3 个节点和 2 条边，方向正确', async () => {
    // 构造 npm workspace
    writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-mono',
        workspaces: ['packages/*'],
      }),
    );

    writeFile(
      path.join(tmpDir, 'packages', 'A', 'package.json'),
      JSON.stringify({ name: 'A', dependencies: { B: 'workspace:*' } }),
    );
    writeFile(
      path.join(tmpDir, 'packages', 'B', 'package.json'),
      JSON.stringify({ name: 'B', dependencies: { C: 'workspace:*' } }),
    );
    writeFile(
      path.join(tmpDir, 'packages', 'C', 'package.json'),
      JSON.stringify({ name: 'C' }),
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await analyzer.extract(context);

    expect(input.graph.modules).toHaveLength(3);
    expect(input.graph.edges).toHaveLength(2);

    // 验证边方向
    const edgePairs = input.graph.edges.map((e) => `${e.from}->${e.to}`);
    expect(edgePairs).toContain('A->B');
    expect(edgePairs).toContain('B->C');
  });
});

describe('CrossPackageAnalyzer - extract 边界测试 (T009)', () => {
  let tmpDir: string;
  let analyzer: CrossPackageAnalyzer;

  beforeEach(() => {
    tmpDir = createTempDir();
    analyzer = new CrossPackageAnalyzer();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('自依赖被过滤', async () => {
    writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', workspaces: ['packages/*'] }),
    );
    writeFile(
      path.join(tmpDir, 'packages', 'A', 'package.json'),
      JSON.stringify({ name: 'A', dependencies: { A: 'workspace:*' } }),
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await analyzer.extract(context);

    expect(input.graph.edges).toHaveLength(0);
  });

  it('不存在的依赖被过滤', async () => {
    writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', workspaces: ['packages/*'] }),
    );
    writeFile(
      path.join(tmpDir, 'packages', 'A', 'package.json'),
      JSON.stringify({ name: 'A', dependencies: { 'nonexistent-pkg': 'workspace:*' } }),
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await analyzer.extract(context);

    expect(input.graph.edges).toHaveLength(0);
  });

  it('无依赖场景下 edges 为空', async () => {
    writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', workspaces: ['packages/*'] }),
    );
    writeFile(
      path.join(tmpDir, 'packages', 'A', 'package.json'),
      JSON.stringify({ name: 'A' }),
    );
    writeFile(
      path.join(tmpDir, 'packages', 'B', 'package.json'),
      JSON.stringify({ name: 'B' }),
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await analyzer.extract(context);

    expect(input.graph.edges).toHaveLength(0);
    expect(input.graph.modules).toHaveLength(2);
  });
});

// ============================================================
// Phase 3: US1 - generate 正常依赖图测试（T010）
// ============================================================

describe('CrossPackageAnalyzer - generate 正常依赖图 (T010)', () => {
  let analyzer: CrossPackageAnalyzer;

  beforeEach(() => {
    analyzer = new CrossPackageAnalyzer();
  });

  it('3 包线性依赖: hasCycles=false, Mermaid 包含 graph TD 和正确方向的边', async () => {
    const input = buildInputFromPackages(linearDepsPackages());
    const output = await analyzer.generate(input);

    expect(output.hasCycles).toBe(false);
    expect(output.cycleGroups).toHaveLength(0);
    expect(output.mermaidDiagram).toContain('graph TD');

    // 验证包含所有节点
    expect(output.mermaidDiagram).toContain('"A"');
    expect(output.mermaidDiagram).toContain('"B"');
    expect(output.mermaidDiagram).toContain('"C"');

    // 验证正确方向的边（实线）
    expect(output.mermaidDiagram).toContain('A --> B');
    expect(output.mermaidDiagram).toContain('B --> C');

    // 不应有虚线边
    expect(output.mermaidDiagram).not.toContain('-.->');
  });
});

// ============================================================
// Phase 3: US2 - generate 循环依赖测试（T011-T012）
// ============================================================

describe('CrossPackageAnalyzer - generate 循环依赖 (T011)', () => {
  let analyzer: CrossPackageAnalyzer;

  beforeEach(() => {
    analyzer = new CrossPackageAnalyzer();
  });

  it('A->B->C->A 循环: hasCycles=true, cycleGroups 包含完整循环路径, Mermaid 有虚线边', async () => {
    const input = buildInputFromPackages(cyclicDepsPackages());
    const output = await analyzer.generate(input);

    expect(output.hasCycles).toBe(true);
    expect(output.cycleGroups.length).toBeGreaterThanOrEqual(1);

    // 验证循环路径包含所有 3 个包
    const allCyclePackages = output.cycleGroups.flatMap((g) => g.packages);
    expect(allCyclePackages).toContain('A');
    expect(allCyclePackages).toContain('B');
    expect(allCyclePackages).toContain('C');

    // 验证 cyclePath 格式（包含 ->）
    for (const group of output.cycleGroups) {
      expect(group.cyclePath).toContain('->');
    }

    // 验证 Mermaid 图包含虚线边标注
    expect(output.mermaidDiagram).toContain('-.->');
    expect(output.mermaidDiagram).toContain('cycle');

    // 验证 classDef cycle 样式
    expect(output.mermaidDiagram).toContain('classDef cycle');
    expect(output.mermaidDiagram).toContain('fill:#ffcccc');
  });
});

describe('CrossPackageAnalyzer - generate 多组独立循环 (T012)', () => {
  let analyzer: CrossPackageAnalyzer;

  beforeEach(() => {
    analyzer = new CrossPackageAnalyzer();
  });

  it('A<->B 和 C<->D 两组循环: cycleGroups.length === 2 且分别列出', async () => {
    const input = buildInputFromPackages(multiCyclePackages());
    const output = await analyzer.generate(input);

    expect(output.hasCycles).toBe(true);
    expect(output.cycleGroups).toHaveLength(2);

    // 验证两组循环分别包含正确的包
    const group1Packages = output.cycleGroups[0]!.packages.sort();
    const group2Packages = output.cycleGroups[1]!.packages.sort();

    // 两组循环应该分别是 [A, B] 和 [C, D]（顺序不定）
    const allGroupsSorted = [group1Packages, group2Packages].sort((a, b) =>
      a[0]!.localeCompare(b[0]!),
    );
    expect(allGroupsSorted[0]).toEqual(['A', 'B']);
    expect(allGroupsSorted[1]).toEqual(['C', 'D']);
  });
});

// ============================================================
// Phase 3: US1 - render 测试（T013）
// ============================================================

describe('CrossPackageAnalyzer - render (T013)', () => {
  let analyzer: CrossPackageAnalyzer;

  beforeEach(() => {
    analyzer = new CrossPackageAnalyzer();
  });

  it('输出为非空字符串、包含 Mermaid 代码块和文档标题', async () => {
    const input = buildInputFromPackages(linearDepsPackages());
    const output = await analyzer.generate(input);
    const markdown = analyzer.render(output);

    expect(typeof markdown).toBe('string');
    expect(markdown.length).toBeGreaterThan(0);

    // 包含 Mermaid 代码块
    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('graph TD');

    // 包含文档标题
    expect(markdown).toContain('跨包依赖分析');
    expect(markdown).toContain('test-project');
  });

  it('循环依赖场景渲染包含警告区块', async () => {
    const input = buildInputFromPackages(cyclicDepsPackages());
    const output = await analyzer.generate(input);
    const markdown = analyzer.render(output);

    // 包含循环依赖警告
    expect(markdown).toContain('检测到循环依赖');
    expect(markdown).toContain('循环');
  });

  it('无循环依赖场景渲染包含"未检测到"声明', async () => {
    const input = buildInputFromPackages(linearDepsPackages());
    const output = await analyzer.generate(input);
    const markdown = analyzer.render(output);

    expect(markdown).toContain('未检测到循环依赖');
  });
});

// ============================================================
// Phase 4: US3 - 统计信息测试（T020-T022）
// ============================================================

describe('CrossPackageAnalyzer - 统计信息 (T020)', () => {
  let analyzer: CrossPackageAnalyzer;

  beforeEach(() => {
    analyzer = new CrossPackageAnalyzer();
  });

  it('3 包线性依赖: stats 正确', async () => {
    const input = buildInputFromPackages(linearDepsPackages());
    const output = await analyzer.generate(input);

    // A 无入度（root）
    expect(output.stats.rootPackages).toContain('A');
    // C 无出度（leaf）
    expect(output.stats.leafPackages).toContain('C');
    expect(output.stats.totalEdges).toBe(2);
    expect(output.stats.totalPackages).toBe(3);
  });
});

describe('CrossPackageAnalyzer - 统计信息 无依赖场景 (T021)', () => {
  let analyzer: CrossPackageAnalyzer;

  beforeEach(() => {
    analyzer = new CrossPackageAnalyzer();
  });

  it('3 个独立包: 所有包同时出现在 rootPackages 和 leafPackages, totalEdges=0', async () => {
    const input = buildInputFromPackages(noDepsPackages());
    const output = await analyzer.generate(input);

    expect(output.stats.totalEdges).toBe(0);
    expect(output.stats.rootPackages.sort()).toEqual(['X', 'Y', 'Z']);
    expect(output.stats.leafPackages.sort()).toEqual(['X', 'Y', 'Z']);
    expect(output.stats.totalPackages).toBe(3);
  });
});

describe('CrossPackageAnalyzer - 统计信息 单包场景 (T022)', () => {
  let analyzer: CrossPackageAnalyzer;

  beforeEach(() => {
    analyzer = new CrossPackageAnalyzer();
  });

  it('单包: rootPackages=[Solo], leafPackages=[Solo], totalEdges=0', async () => {
    const input = buildInputFromPackages(singlePackage());
    const output = await analyzer.generate(input);

    expect(output.stats.rootPackages).toEqual(['Solo']);
    expect(output.stats.leafPackages).toEqual(['Solo']);
    expect(output.stats.totalEdges).toBe(0);
    expect(output.stats.totalPackages).toBe(1);
  });
});

// ============================================================
// Phase 5: US4 - 拓扑排序测试（T023-T024）
// ============================================================

describe('CrossPackageAnalyzer - 拓扑排序 (T023)', () => {
  let analyzer: CrossPackageAnalyzer;

  beforeEach(() => {
    analyzer = new CrossPackageAnalyzer();
  });

  it('3 包线性依赖: topologicalOrder 中被依赖方排在依赖方之前', async () => {
    const input = buildInputFromPackages(linearDepsPackages());
    const output = await analyzer.generate(input);

    const order = output.topologicalOrder;
    const idxA = order.indexOf('A');
    const idxB = order.indexOf('B');
    const idxC = order.indexOf('C');

    // 所有节点都应该在排序结果中
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxC).toBeGreaterThanOrEqual(0);

    // Kahn 算法从入度=0 的节点开始（根节点优先）
    // A 是根（无入度），排在最前面
    // C 是叶子（无出度），排在最后
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });
});

describe('CrossPackageAnalyzer - 层级分组 (T024)', () => {
  let analyzer: CrossPackageAnalyzer;

  beforeEach(() => {
    analyzer = new CrossPackageAnalyzer();
  });

  it('levels 数组中 level 0 包含 A（root），最高层包含 C（leaf），层级数与依赖深度一致', async () => {
    const input = buildInputFromPackages(linearDepsPackages());
    const output = await analyzer.generate(input);

    // 3 层：A(level 0) -> B(level 1) -> C(level 2)
    expect(output.levels.length).toBe(3);

    // Kahn 算法中，入度=0 的节点（A）在 level 0
    const aLevel = output.levels.find((l) =>
      l.packages.includes('A'),
    );
    expect(aLevel).toBeDefined();
    expect(aLevel!.level).toBe(0);

    // C 在最高层级
    const cLevel = output.levels.find((l) =>
      l.packages.includes('C'),
    );
    expect(cLevel).toBeDefined();
    expect(cLevel!.level).toBe(2);

    // C 的层级应高于 A 的层级
    expect(cLevel!.level).toBeGreaterThan(aLevel!.level);
  });
});

// ============================================================
// Phase 6: US5 - GeneratorRegistry 注册测试（T025-T026）
// ============================================================

describe('CrossPackageAnalyzer - GeneratorRegistry 注册 (T025)', () => {
  beforeEach(() => {
    GeneratorRegistry.resetInstance();
  });

  afterEach(() => {
    GeneratorRegistry.resetInstance();
  });

  it('bootstrapGenerators 后可通过 cross-package-deps id 查询', () => {
    bootstrapGenerators();
    const registry = GeneratorRegistry.getInstance();
    const generator = registry.get('cross-package-deps');

    expect(generator).toBeDefined();
    expect(generator!.id).toBe('cross-package-deps');
    expect(generator).toBeInstanceOf(CrossPackageAnalyzer);
  });
});

describe('CrossPackageAnalyzer - filterByContext (T026)', () => {
  beforeEach(() => {
    GeneratorRegistry.resetInstance();
  });

  afterEach(() => {
    GeneratorRegistry.resetInstance();
  });

  it('monorepo 上下文下 CrossPackageAnalyzer 出现在过滤结果中', async () => {
    bootstrapGenerators();
    const registry = GeneratorRegistry.getInstance();
    const context = createContext('/tmp/fake', { workspaceType: 'monorepo' });
    const applicable = await registry.filterByContext(context);

    const ids = applicable.map((g) => g.id);
    expect(ids).toContain('cross-package-deps');
  });

  it('single 上下文下 CrossPackageAnalyzer 不出现在过滤结果中', async () => {
    bootstrapGenerators();
    const registry = GeneratorRegistry.getInstance();
    const context = createContext('/tmp/fake', { workspaceType: 'single' });
    const applicable = await registry.filterByContext(context);

    const ids = applicable.map((g) => g.id);
    expect(ids).not.toContain('cross-package-deps');
  });
});
