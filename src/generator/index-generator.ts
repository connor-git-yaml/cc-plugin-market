/**
 * 架构索引生成器
 * 生成 specs/_index.spec.md（FR-013）
 * 支持多语言项目的语言分布展示（Feature 031）
 * 参见 contracts/generator.md
 */
import type {
  ArchitectureIndex,
  ModuleMapEntry,
  TechStackEntry,
  IndexFrontmatter,
  LanguageDistribution,
} from '../models/module-spec.js';
import type { ModuleSpec } from '../models/module-spec.js';
import type { DependencyGraph } from '../models/dependency-graph.js';
import type { LanguageFileStat } from '../utils/file-scanner.js';

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
 * 构建语言分布信息
 *
 * @param languageStats - 完整扫描的语言统计
 * @param specs - 所有已生成的 ModuleSpec
 * @param processedLanguages - 本次实际处理的语言 ID 列表
 * @returns LanguageDistribution 数组（按文件数降序），或 undefined（单语言）
 */
function buildLanguageDistribution(
  languageStats: Map<string, LanguageFileStat>,
  specs: ModuleSpec[],
  processedLanguages?: string[],
): LanguageDistribution[] | undefined {
  // 单语言项目不展示语言分布（FR-008）
  if (languageStats.size <= 1) {
    return undefined;
  }

  const totalFiles = Array.from(languageStats.values())
    .reduce((sum, s) => sum + s.fileCount, 0);

  const distribution = Array.from(languageStats.entries()).map(([adapterId, stat]) => {
    // 模块数：统计 specs 中 frontmatter.language === adapterId 的数量
    const moduleCount = specs.filter(
      (s) => (s.frontmatter as any).language === adapterId,
    ).length;

    // 占比：该语言文件数 / 总文件数 * 100，保留一位小数
    const percentage = totalFiles > 0
      ? Math.round(stat.fileCount / totalFiles * 1000) / 10
      : 0;

    // 是否本次处理
    const processed = processedLanguages
      ? processedLanguages.includes(adapterId)
      : true;

    return {
      language: adapterId,
      adapterId,
      fileCount: stat.fileCount,
      moduleCount,
      percentage,
      processed,
    };
  });

  // 按文件数降序排列
  distribution.sort((a, b) => b.fileCount - a.fileCount);

  return distribution;
}

/**
 * 生成项目级架构索引
 *
 * @param specs - 所有已生成的 ModuleSpec
 * @param graph - 项目 DependencyGraph（或合并后的图）
 * @param languageStats - 完整扫描的语言统计（可选）
 * @param processedLanguages - 本次实际处理的语言列表（可选）
 * @returns ArchitectureIndex
 */
export function generateIndex(
  specs: ModuleSpec[],
  graph: DependencyGraph,
  languageStats?: Map<string, LanguageFileStat>,
  processedLanguages?: string[],
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

  // 构建语言分布信息（多语言项目时填充）
  const languageDistribution = languageStats
    ? buildLanguageDistribution(languageStats, specs, processedLanguages)
    : undefined;

  return {
    frontmatter,
    systemPurpose,
    architecturePattern,
    moduleMap,
    crossCuttingConcerns,
    technologyStack,
    dependencyDiagram: graph.mermaidSource,
    outputPath: 'specs/_index.spec.md',
    languageDistribution,
  };
}
