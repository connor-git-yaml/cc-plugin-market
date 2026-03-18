/**
 * 轻量级目录依赖图构建器
 * 为无 dependency-cruiser 支持的语言（Python/Go/Java）提供
 * 基于目录结构 + import 推断的依赖图（TD-004）
 */
import * as path from 'node:path';
import type { CodeSkeleton } from '../models/code-skeleton.js';
import type {
  DependencyGraph,
  GraphNode,
  DependencyEdge,
} from '../models/dependency-graph.js';
import { detectSCCs, topologicalSort } from './topological-sort.js';
import { renderDependencyGraph } from './mermaid-renderer.js';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';

/**
 * 基于 CodeSkeleton 的 imports 信息构建轻量级依赖图
 *
 * 对 `isRelative: true` 的 import 使用路径解析构建依赖边；
 * `isRelative: false` 的 import（第三方包）被忽略。
 * 无法解析的 import 路径不产生边（宽容策略），不抛出异常。
 *
 * @param files - 同一语言的文件路径列表（相对于项目根目录）
 * @param projectRoot - 项目根目录
 * @param skeletons - 与 files 对应的 CodeSkeleton 列表
 * @returns DependencyGraph
 */
export async function buildDirectoryGraph(
  files: string[],
  projectRoot: string,
  skeletons: CodeSkeleton[],
): Promise<DependencyGraph> {
  if (files.length === 0) {
    return createEmptyGraph(projectRoot);
  }

  const fileSet = new Set(files);
  const registry = LanguageAdapterRegistry.getInstance();

  // 构建文件路径到骨架的映射
  const skeletonMap = new Map<string, CodeSkeleton>();
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const skeleton = skeletons[i];
    if (skeleton) {
      skeletonMap.set(file, skeleton);
    }
  }

  // 步骤 1：创建所有节点
  const nodeMap = new Map<string, GraphNode>();
  for (const file of files) {
    const adapter = registry.getAdapter(file);
    nodeMap.set(file, {
      source: file,
      isOrphan: true,
      inDegree: 0,
      outDegree: 0,
      level: 0,
      language: adapter?.id,
    });
  }

  // 步骤 2：基于 import 推断构建边
  const edges: DependencyEdge[] = [];

  for (const file of files) {
    const skeleton = skeletonMap.get(file);
    if (!skeleton) continue;

    for (const imp of skeleton.imports) {
      // 仅处理相对 import
      if (!imp.isRelative) continue;

      const resolved = resolveImportPath(
        file,
        imp.moduleSpecifier,
        fileSet,
      );

      if (resolved && resolved !== file) {
        edges.push({
          from: file,
          to: resolved,
          isCircular: false,
          importType: 'static',
        });

        // 更新度数
        const fromNode = nodeMap.get(file);
        const toNode = nodeMap.get(resolved);
        if (fromNode && toNode) {
          fromNode.outDegree++;
          toNode.inDegree++;
          fromNode.isOrphan = false;
          toNode.isOrphan = false;
        }
      }
    }
  }

  // 步骤 3：构建临时图用于拓扑排序和 SCC 检测
  const graphNodes = Array.from(nodeMap.values());
  const tempGraph: DependencyGraph = {
    projectRoot,
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
    projectRoot,
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

/**
 * 解析 import 路径到文件集合中的实际文件
 *
 * 支持：
 * - Python 相对 import：`from .utils import x` → `./utils`
 * - Go 本地 package：`"./internal/utils"` → `./internal/utils/`
 * - 通用相对路径：`./foo`, `../bar`
 *
 * @param fromFile - 发起 import 的文件路径
 * @param specifier - import 模块标识符
 * @param fileSet - 可用文件集合
 * @returns 解析后的文件路径，或 undefined（无法解析）
 */
function resolveImportPath(
  fromFile: string,
  specifier: string,
  fileSet: Set<string>,
): string | undefined {
  const fromDir = path.dirname(fromFile);

  // 处理 Python 点号相对导入：将 `.module` 和 `..module` 转换为路径
  let normalizedSpecifier = specifier;
  if (/^\.{1,3}[a-zA-Z_]/.test(specifier)) {
    // Python 风格：`.utils` → `./utils`，`..models` → `../models`
    const dotMatch = /^(\.{1,3})(.*)$/.exec(specifier);
    if (dotMatch) {
      const dots = dotMatch[1]!;
      const rest = dotMatch[2]!;
      if (dots === '.') {
        normalizedSpecifier = `./${rest}`;
      } else if (dots === '..') {
        normalizedSpecifier = `../${rest}`;
      } else if (dots === '...') {
        normalizedSpecifier = `../../${rest}`;
      }
    }
  }

  // 只处理以 ./ 或 ../ 开头的路径
  if (!normalizedSpecifier.startsWith('./') && !normalizedSpecifier.startsWith('../')) {
    return undefined;
  }

  // 解析为相对于项目根的路径
  const resolved = path.normalize(path.join(fromDir, normalizedSpecifier));

  // 尝试精确匹配
  if (fileSet.has(resolved)) {
    return resolved;
  }

  // 尝试补全常见扩展名
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java'];
  for (const ext of extensions) {
    const withExt = resolved + ext;
    if (fileSet.has(withExt)) {
      return withExt;
    }
  }

  // 尝试 index 文件
  const indexFiles = ['index.ts', 'index.js', '__init__.py'];
  for (const indexFile of indexFiles) {
    const withIndex = path.join(resolved, indexFile);
    if (fileSet.has(withIndex)) {
      return withIndex;
    }
  }

  // 尝试匹配目录下的文件（Go package 导入场景：import "./internal/utils" 匹配 internal/utils/ 下任意 .go 文件）
  const dirPrefix = resolved + '/';
  for (const file of fileSet) {
    if (file.startsWith(dirPrefix)) {
      return file;
    }
  }

  return undefined;
}

/**
 * 创建空的依赖图
 */
function createEmptyGraph(projectRoot: string): DependencyGraph {
  return {
    projectRoot,
    modules: [],
    edges: [],
    topologicalOrder: [],
    sccs: [],
    totalModules: 0,
    totalEdges: 0,
    analyzedAt: new Date().toISOString(),
    mermaidSource: '',
  };
}
