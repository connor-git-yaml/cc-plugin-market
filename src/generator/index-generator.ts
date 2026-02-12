/**
 * 架构索引生成器
 * 生成 specs/_index.spec.md（FR-013）
 * 参见 contracts/generator.md
 */
import type {
  ArchitectureIndex,
  ModuleMapEntry,
  TechStackEntry,
  IndexFrontmatter,
} from '../models/module-spec.js';
import type { ModuleSpec } from '../models/module-spec.js';
import type { DependencyGraph } from '../models/dependency-graph.js';

/**
 * 从依赖图识别横切关注点（被多个模块依赖的共享模块）
 */
function identifyCrossCuttingConcerns(graph: DependencyGraph): string[] {
  const concerns: string[] = [];

  for (const node of graph.modules) {
    // 入度 >= 3 的模块视为横切关注点
    if (node.inDegree >= 3) {
      concerns.push(`${node.source} — 被 ${node.inDegree} 个模块依赖`);
    }
  }

  return concerns;
}

/**
 * 从 ModuleSpec 列表构建模块映射表
 */
function buildModuleMap(
  specs: ModuleSpec[],
  graph: DependencyGraph,
): ModuleMapEntry[] {
  return specs.map((spec) => {
    // 从依赖图中查找该模块的层级和依赖
    const node = graph.modules.find(
      (n) => spec.frontmatter.sourceTarget.includes(n.source),
    );

    const edges = graph.edges.filter(
      (e) => spec.frontmatter.sourceTarget.includes(e.from),
    );

    return {
      name: spec.frontmatter.sourceTarget,
      specPath: spec.outputPath,
      description: spec.sections.intent.split('\n')[0]?.slice(0, 100) ?? '',
      level: node?.level ?? 0,
      dependencies: edges.map((e) => e.to),
    };
  });
}

/**
 * 生成项目级架构索引
 *
 * @param specs - 所有已生成的 ModuleSpec
 * @param graph - 项目 DependencyGraph
 * @returns ArchitectureIndex
 */
export function generateIndex(
  specs: ModuleSpec[],
  graph: DependencyGraph,
): ArchitectureIndex {
  const frontmatter: IndexFrontmatter = {
    type: 'architecture-index',
    version: 'v1',
    generatedBy: 'reverse-spec v2.0',
    projectRoot: graph.projectRoot,
    totalModules: specs.length,
    lastUpdated: new Date().toISOString(),
  };

  const moduleMap = buildModuleMap(specs, graph);
  const crossCuttingConcerns = identifyCrossCuttingConcerns(graph);

  // 从依赖图推断系统目的和架构模式
  const systemPurpose =
    specs.length > 0
      ? `本项目包含 ${specs.length} 个模块，涵盖 ${[...new Set(specs.map((s) => s.frontmatter.sourceTarget.split('/')[0]))].join('、')} 等功能域。`
      : '待分析';

  const architecturePattern =
    graph.sccs.filter((s) => s.modules.length > 1).length > 0
      ? '存在循环依赖，建议关注 SCC 模块的解耦'
      : '模块间依赖为有向无环图（DAG），层次清晰';

  // 从 package.json 推断技术栈（此处用空数组，实际使用时由调用方填充）
  const technologyStack: TechStackEntry[] = [];

  return {
    frontmatter,
    systemPurpose,
    architecturePattern,
    moduleMap,
    crossCuttingConcerns,
    technologyStack,
    dependencyDiagram: graph.mermaidSource,
    outputPath: 'specs/_index.spec.md',
  };
}
