/**
 * dependency-cruiser 封装
 * 使用 cruise() 的 JSON 输出构建 DependencyGraph
 * 参见 contracts/graph-module.md, research R2
 */
import { cruise } from 'dependency-cruiser';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type {
  DependencyGraph,
  GraphNode,
  DependencyEdge,
} from '../models/dependency-graph.js';
import { detectSCCs, topologicalSort } from './topological-sort.js';
import { renderDependencyGraph } from './mermaid-renderer.js';

// ============================================================
// 选项与错误类型
// ============================================================

export interface GraphOptions {
  /** 用于过滤分析文件的 Glob 模式（默认 '^src/'） */
  includeOnly?: string;
  /** 排除模式 */
  excludePatterns?: string[];
  /** tsconfig.json 路径 */
  tsConfigPath?: string;
}

export class ProjectNotFoundError extends Error {
  constructor(projectRoot: string) {
    super(`项目目录不存在: ${projectRoot}`);
    this.name = 'ProjectNotFoundError';
  }
}

export class NoDependencyCruiserError extends Error {
  constructor() {
    super('dependency-cruiser 未安装或不可用');
    this.name = 'NoDependencyCruiserError';
  }
}

// ============================================================
// 核心 API
// ============================================================

/**
 * 使用 dependency-cruiser 构建项目级依赖关系图
 *
 * @param projectRoot - 项目根目录
 * @param options - 构建选项
 * @returns DependencyGraph
 */
export async function buildGraph(
  projectRoot: string,
  options: GraphOptions = {},
): Promise<DependencyGraph> {
  const resolvedRoot = path.resolve(projectRoot);

  if (!fs.existsSync(resolvedRoot)) {
    throw new ProjectNotFoundError(projectRoot);
  }

  const includeOnly = options.includeOnly ?? '^src/';
  const excludePatterns = options.excludePatterns ?? [
    '\\.(spec|test)\\.(js|ts|tsx|jsx)$',
    '__tests__',
    '__mocks__',
  ];

  // 查找 tsconfig.json
  const tsConfigPath = options.tsConfigPath
    ?? (fs.existsSync(path.join(resolvedRoot, 'tsconfig.json'))
      ? path.join(resolvedRoot, 'tsconfig.json')
      : undefined);

  // 调用 dependency-cruiser
  let cruiseResult: any;
  try {
    const srcDir = path.join(resolvedRoot, 'src');
    if (!fs.existsSync(srcDir)) {
      // 没有 src/ 目录，扫描项目根目录
      cruiseResult = cruise([resolvedRoot], {
        outputType: 'json',
        doNotFollow: {
          dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'core'],
        },
        exclude: { path: excludePatterns.join('|') },
        tsPreCompilationDeps: true,
        ...(tsConfigPath ? { tsConfig: { fileName: tsConfigPath } } : {}),
      });
    } else {
      cruiseResult = cruise(['src'], {
        outputType: 'json',
        doNotFollow: {
          dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'core'],
        },
        includeOnly,
        exclude: { path: excludePatterns.join('|') },
        tsPreCompilationDeps: true,
        ...(tsConfigPath ? { tsConfig: { fileName: tsConfigPath } } : {}),
      });
    }
  } catch (error: any) {
    if (error.message?.includes('dependency-cruiser')) {
      throw new NoDependencyCruiserError();
    }
    throw error;
  }

  const output = cruiseResult.output;
  const modules = typeof output === 'string' ? JSON.parse(output) : output;
  const moduleList: Array<{ source: string; dependencies: any[] }> =
    modules.modules ?? [];

  // 构建节点和边
  const nodeMap = new Map<string, GraphNode>();
  const edges: DependencyEdge[] = [];

  // 第一遍：创建所有节点
  for (const mod of moduleList) {
    nodeMap.set(mod.source, {
      source: mod.source,
      isOrphan: true,
      inDegree: 0,
      outDegree: 0,
      level: 0,
    });
  }

  // 第二遍：构建边
  for (const mod of moduleList) {
    for (const dep of mod.dependencies ?? []) {
      // 只保留内部依赖
      const isLocal = dep.dependencyTypes?.includes('local') ||
        dep.dependencyTypes?.includes('local-import');

      if (!isLocal) continue;

      const resolved = dep.resolved ?? dep.module;
      if (!nodeMap.has(resolved)) continue;

      const isCircular = dep.circular ?? false;
      const importType = dep.dependencyTypes?.includes('type-only')
        ? 'type-only' as const
        : dep.dependencyTypes?.includes('dynamic')
          ? 'dynamic' as const
          : 'static' as const;

      edges.push({
        from: mod.source,
        to: resolved,
        isCircular,
        importType,
      });

      // 更新度数
      const fromNode = nodeMap.get(mod.source)!;
      const toNode = nodeMap.get(resolved)!;
      fromNode.outDegree++;
      toNode.inDegree++;
      fromNode.isOrphan = false;
      toNode.isOrphan = false;
    }
  }

  const graphNodes = Array.from(nodeMap.values());

  // 构建临时 DependencyGraph 用于拓扑排序
  const tempGraph: DependencyGraph = {
    projectRoot: resolvedRoot,
    modules: graphNodes,
    edges,
    topologicalOrder: [],
    sccs: [],
    totalModules: graphNodes.length,
    totalEdges: edges.length,
    analyzedAt: new Date().toISOString(),
    mermaidSource: '',
  };

  // 拓扑排序 + SCC 检测
  const sortResult = topologicalSort(tempGraph);
  const sccs = detectSCCs(tempGraph);

  // 更新节点层级
  for (const [source, level] of sortResult.levels) {
    const node = nodeMap.get(source);
    if (node) {
      node.level = level;
    }
  }

  // 生成 Mermaid 源码
  const mermaidSource = renderDependencyGraph({
    ...tempGraph,
    topologicalOrder: sortResult.order,
    sccs,
    modules: Array.from(nodeMap.values()),
  });

  return {
    projectRoot: resolvedRoot,
    modules: Array.from(nodeMap.values()),
    edges,
    topologicalOrder: sortResult.order,
    sccs,
    totalModules: graphNodes.length,
    totalEdges: edges.length,
    analyzedAt: new Date().toISOString(),
    mermaidSource,
  };
}
