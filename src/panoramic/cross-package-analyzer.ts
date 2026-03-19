/**
 * CrossPackageAnalyzer -- 跨包依赖分析器
 *
 * 为 Monorepo 项目提供跨包依赖分析能力：
 * - 自动检测子包间的循环依赖（复用 Tarjan SCC）
 * - 计算拓扑排序与层级
 * - 生成带循环标注的 Mermaid 依赖拓扑图
 * - 统计 root/leaf 包和总依赖边数
 *
 * 实现 DocumentGenerator<CrossPackageInput, CrossPackageOutput> 接口。
 * 通过 GeneratorRegistry 注册后可被 `reverse-spec batch` 自动发现和调用。
 *
 * 技术决策：
 * - 复用 WorkspaceIndexGenerator.extract() 获取子包列表（最大复用、最小新增）
 * - 复用 detectSCCs() + topologicalSort() 图算法
 * - 仅新增包级 DependencyGraph 构建、循环标注 Mermaid 生成和 Handlebars 模板渲染
 *
 * @module panoramic/cross-package-analyzer
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import Handlebars from 'handlebars';
import type { DocumentGenerator, ProjectContext, GenerateOptions } from './interfaces.js';
import type { WorkspacePackageInfo } from './workspace-index-generator.js';
import { WorkspaceIndexGenerator, _sanitizeMermaidId } from './workspace-index-generator.js';
import type { DependencyGraph, GraphNode, DependencyEdge } from '../models/dependency-graph.js';
import { detectSCCs, topologicalSort } from '../graph/topological-sort.js';

// ============================================================
// 类型定义（T004-T006）
// ============================================================

/**
 * CrossPackageAnalyzer extract() 产出
 * 包含项目元信息、子包列表和构建好的包级 DependencyGraph
 */
export interface CrossPackageInput {
  /** 项目名称 */
  projectName: string;

  /** workspace 管理器类型 */
  workspaceType: 'npm' | 'pnpm' | 'uv';

  /** 所有子包元信息列表（复用 WorkspacePackageInfo） */
  packages: WorkspacePackageInfo[];

  /** 包级依赖关系图（复用现有 DependencyGraph 类型） */
  graph: DependencyGraph;
}

/**
 * CrossPackageAnalyzer generate() 产出
 * 包含渲染 Markdown 文档所需的全部结构化数据
 */
export interface CrossPackageOutput {
  /** 文档标题 */
  title: string;

  /** 生成日期（YYYY-MM-DD） */
  generatedAt: string;

  /** 项目名称 */
  projectName: string;

  /** workspace 管理器类型 */
  workspaceType: 'npm' | 'pnpm' | 'uv';

  /** Mermaid graph TD 依赖拓扑图源代码（含循环标注） */
  mermaidDiagram: string;

  /** 拓扑排序结果（按 level 分组） */
  levels: TopologyLevel[];

  /** 拓扑排序线性顺序（叶子优先） */
  topologicalOrder: string[];

  /** 是否存在循环依赖 */
  hasCycles: boolean;

  /** 循环依赖组列表（每组为参与循环的包名数组） */
  cycleGroups: CycleGroup[];

  /** 统计摘要 */
  stats: DependencyStats;
}

/**
 * 拓扑排序层级
 */
export interface TopologyLevel {
  /** 层级编号（0 为最底层，无出度） */
  level: number;

  /** 该层级的子包名列表 */
  packages: string[];
}

/**
 * 循环依赖组
 */
export interface CycleGroup {
  /** 参与循环的子包名列表 */
  packages: string[];

  /** 循环路径的人类可读表示（如 "A -> B -> C -> A"） */
  cyclePath: string;
}

/**
 * 依赖统计摘要
 */
export interface DependencyStats {
  /** 子包总数 */
  totalPackages: number;

  /** 总依赖边数（不含自依赖和无效依赖） */
  totalEdges: number;

  /** Root 包列表（入度为 0，不被任何包依赖） */
  rootPackages: string[];

  /** Leaf 包列表（出度为 0，不依赖任何包） */
  leafPackages: string[];
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 构建带循环标注的 Mermaid graph TD 依赖拓扑图
 *
 * @param graph - 包级依赖关系图
 * @param sccNodeSet - SCC 内部节点集合（size > 1 的 SCC 中的节点）
 * @param sccEdgeSet - SCC 内部边集合（"from->to" 格式的字符串集合）
 * @returns Mermaid 源代码字符串
 */
function buildCrossPackageMermaid(
  graph: DependencyGraph,
  sccNodeSet: Set<string>,
  sccEdgeSet: Set<string>,
): string {
  const lines: string[] = ['graph TD'];

  // 添加所有节点
  for (const node of graph.modules) {
    const nodeId = _sanitizeMermaidId(node.source);
    if (sccNodeSet.has(node.source)) {
      // SCC 内部节点添加 cycle 样式类
      lines.push(`    ${nodeId}["${node.source}"]:::cycle`);
    } else {
      lines.push(`    ${nodeId}["${node.source}"]`);
    }
  }

  // 收集边，区分正常边和循环边
  const normalEdges: string[] = [];
  const cycleEdges: string[] = [];
  const cycleEdgeIndices: number[] = [];
  let edgeIndex = 0;

  for (const edge of graph.edges) {
    const sourceId = _sanitizeMermaidId(edge.from);
    const targetId = _sanitizeMermaidId(edge.to);
    const edgeKey = `${edge.from}->${edge.to}`;

    if (sccEdgeSet.has(edgeKey)) {
      // 循环边：虚线 + cycle 标签
      cycleEdges.push(`    ${sourceId} -.->|cycle| ${targetId}`);
      cycleEdgeIndices.push(edgeIndex);
    } else {
      // 正常边：实线
      normalEdges.push(`    ${sourceId} --> ${targetId}`);
    }
    edgeIndex++;
  }

  if (normalEdges.length === 0 && cycleEdges.length === 0) {
    lines.push('    %% 无内部依赖');
  } else {
    lines.push(...normalEdges);
    lines.push(...cycleEdges);
  }

  // 添加 classDef 样式定义
  if (sccNodeSet.size > 0) {
    lines.push('    classDef cycle fill:#ffcccc,stroke:red,stroke-width:2px');
  }

  // 添加 linkStyle 指令为循环边设置红色
  for (const idx of cycleEdgeIndices) {
    lines.push(`    linkStyle ${idx} stroke:red,stroke-width:2px`);
  }

  return lines.join('\n');
}

// ============================================================
// CrossPackageAnalyzer 实现
// ============================================================

/**
 * 跨包依赖分析器
 * 实现 DocumentGenerator<CrossPackageInput, CrossPackageOutput> 接口。
 * 从 Monorepo 项目中分析子包间的依赖关系，检测循环依赖，
 * 生成带循环标注的 Mermaid 依赖拓扑图和统计信息。
 */
export class CrossPackageAnalyzer
  implements DocumentGenerator<CrossPackageInput, CrossPackageOutput>
{
  readonly id = 'cross-package-deps' as const;
  readonly name = '跨包依赖分析器' as const;
  readonly description = '分析 Monorepo 子包间的依赖关系，检测循环依赖并生成拓扑图';

  /** 缓存编译后的 Handlebars 模板 */
  private compiledTemplate: ReturnType<typeof Handlebars.compile> | null = null;

  /**
   * 判断当前项目是否适用此 Generator（T014）
   * 仅当 workspaceType === 'monorepo' 时返回 true
   */
  isApplicable(context: ProjectContext): boolean {
    return context.workspaceType === 'monorepo';
  }

  /**
   * 从项目中提取 workspace 信息并构建包级依赖图（T015）
   *
   * 1. 复用 WorkspaceIndexGenerator.extract() 获取子包列表
   * 2. 将 WorkspacePackageInfo[] 转换为 DependencyGraph
   */
  async extract(context: ProjectContext): Promise<CrossPackageInput> {
    // 复用 040 的 extract() 获取子包列表
    const wig = new WorkspaceIndexGenerator();
    const workspaceInput = await wig.extract(context);

    const { packages, projectName, workspaceType } = workspaceInput;

    // 收集所有包名到 Set，用于过滤无效依赖
    const packageNameSet = new Set(packages.map((p) => p.name));

    // 构建 GraphNode 列表
    // 先计算每个包的入度
    const inDegreeMap = new Map<string, number>();
    for (const pkg of packages) {
      inDegreeMap.set(pkg.name, 0);
    }
    for (const pkg of packages) {
      for (const dep of pkg.dependencies) {
        // 过滤自依赖和不存在的依赖
        if (dep === pkg.name || !packageNameSet.has(dep)) continue;
        inDegreeMap.set(dep, (inDegreeMap.get(dep) ?? 0) + 1);
      }
    }

    const modules: GraphNode[] = [];
    const edges: DependencyEdge[] = [];

    for (const pkg of packages) {
      // 计算有效出度（过滤自依赖和不存在的依赖）
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
        level: 0, // 由 topologicalSort() 填充
        language: pkg.language,
      });

      // 构建边
      for (const dep of validDeps) {
        edges.push({
          from: pkg.name,
          to: dep,
          isCircular: false, // 初始值，detectSCCs() 后更新
          importType: 'static', // 包级依赖均为静态引用
        });
      }
    }

    const graph: DependencyGraph = {
      projectRoot: context.projectRoot,
      modules,
      edges,
      topologicalOrder: [],
      sccs: [],
      totalModules: modules.length,
      totalEdges: edges.length,
      analyzedAt: new Date().toISOString(),
      mermaidSource: '',
    };

    return {
      projectName,
      workspaceType,
      packages,
      graph,
    };
  }

  /**
   * 将提取的数据转换为结构化文档输出（T016-T017）
   *
   * 1. 调用 detectSCCs 检测循环依赖
   * 2. 调用 topologicalSort 计算拓扑排序
   * 3. 构建循环标注 Mermaid 图
   * 4. 计算统计信息
   * 5. 按 level 分组拓扑排序结果
   */
  async generate(
    input: CrossPackageInput,
    _options?: GenerateOptions,
  ): Promise<CrossPackageOutput> {
    const { graph } = input;

    // 1. 检测 SCC
    const sccs = detectSCCs(graph);

    // 2. 拓扑排序
    const topoResult = topologicalSort(graph);

    // 3. 构建 SCC 内部节点和边集合（仅 size > 1 的 SCC）
    const sccNodeSet = new Set<string>();
    const sccEdgeSet = new Set<string>();
    const cycleGroups: CycleGroup[] = [];

    for (const scc of sccs) {
      if (scc.modules.length > 1) {
        const sccModuleSet = new Set(scc.modules);
        for (const mod of scc.modules) {
          sccNodeSet.add(mod);
        }

        // 标记 SCC 内部边
        for (const edge of graph.edges) {
          if (sccModuleSet.has(edge.from) && sccModuleSet.has(edge.to)) {
            sccEdgeSet.add(`${edge.from}->${edge.to}`);
            edge.isCircular = true;
          }
        }

        // 构建人类可读的循环路径
        const cyclePath = [...scc.modules, scc.modules[0]!].join(' -> ');
        cycleGroups.push({
          packages: [...scc.modules],
          cyclePath,
        });
      }
    }

    // 4. 生成 Mermaid 图
    const mermaidDiagram = buildCrossPackageMermaid(graph, sccNodeSet, sccEdgeSet);

    // 5. 计算统计信息
    const rootPackages: string[] = [];
    const leafPackages: string[] = [];
    for (const node of graph.modules) {
      if (node.inDegree === 0) rootPackages.push(node.source);
      if (node.outDegree === 0) leafPackages.push(node.source);
    }

    const stats: DependencyStats = {
      totalPackages: graph.modules.length,
      totalEdges: graph.edges.length,
      rootPackages: rootPackages.sort(),
      leafPackages: leafPackages.sort(),
    };

    // 6. 按 level 分组
    const levelMap = new Map<number, string[]>();
    for (const [mod, level] of topoResult.levels) {
      if (!levelMap.has(level)) {
        levelMap.set(level, []);
      }
      levelMap.get(level)!.push(mod);
    }

    // 如果拓扑排序没有覆盖所有节点（如全是孤立节点），补充缺失的
    for (const node of graph.modules) {
      if (!topoResult.levels.has(node.source)) {
        if (!levelMap.has(0)) {
          levelMap.set(0, []);
        }
        levelMap.get(0)!.push(node.source);
      }
    }

    const levels: TopologyLevel[] = [];
    const sortedLevelKeys = [...levelMap.keys()].sort((a, b) => a - b);
    for (const level of sortedLevelKeys) {
      levels.push({
        level,
        packages: levelMap.get(level)!.sort(),
      });
    }

    return {
      title: `跨包依赖分析: ${input.projectName}`,
      generatedAt: new Date().toISOString().split('T')[0]!,
      projectName: input.projectName,
      workspaceType: input.workspaceType,
      mermaidDiagram,
      levels,
      topologicalOrder: topoResult.order,
      hasCycles: topoResult.hasCycles,
      cycleGroups,
      stats,
    };
  }

  /**
   * 使用 Handlebars 模板渲染为 Markdown（T018）
   */
  render(output: CrossPackageOutput): string {
    const template = this.getCompiledTemplate();
    return template(output);
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 获取编译后的 Handlebars 模板（带缓存）
   */
  private getCompiledTemplate(): ReturnType<typeof Handlebars.compile> {
    if (this.compiledTemplate) return this.compiledTemplate;

    const templatePath = this.findTemplatePath();
    const templateSource = fs.readFileSync(templatePath, 'utf-8');
    this.compiledTemplate = Handlebars.compile(templateSource);
    return this.compiledTemplate;
  }

  /**
   * 查找 cross-package-analysis.hbs 模板文件路径
   */
  private findTemplatePath(): string {
    // 从当前文件位置向上查找 templates/ 目录
    let dir = path.dirname(new URL(import.meta.url).pathname);
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, 'templates', 'cross-package-analysis.hbs');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      dir = path.dirname(dir);
    }

    // 降级：尝试相对于 cwd 的路径
    const fallback = path.join(process.cwd(), 'templates', 'cross-package-analysis.hbs');
    if (fs.existsSync(fallback)) {
      return fallback;
    }

    throw new Error('无法找到 cross-package-analysis.hbs 模板文件');
  }
}
