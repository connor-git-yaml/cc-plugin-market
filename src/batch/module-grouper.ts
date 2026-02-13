/**
 * 文件→模块分组与模块级拓扑排序
 * 将 dependency-cruiser 的文件级 DependencyGraph 聚合为目录级模块
 */
import type { DependencyGraph } from '../models/dependency-graph.js';

// ============================================================
// 类型定义
// ============================================================

/** 模块分组 */
export interface ModuleGroup {
  /** 模块名称（如 'agents'、'config'、'root'） */
  name: string;
  /** 模块对应的目录路径（相对于项目根，如 'src/agents'） */
  dirPath: string;
  /** 模块内包含的文件路径 */
  files: string[];
}

/** 分组结果 */
export interface ModuleGroupResult {
  /** 按模块分组的结果 */
  groups: ModuleGroup[];
  /** 模块级拓扑排序（叶子模块优先） */
  moduleOrder: string[];
  /** 模块间的聚合依赖边 */
  moduleEdges: Array<{ from: string; to: string }>;
}

/** 分组选项 */
export interface GroupingOptions {
  /** 分组策略的基准目录前缀（默认自动检测） */
  basePrefix?: string;
  /** 分组深度（basePrefix 之后取几级目录，默认 1） */
  depth?: number;
  /** 根目录散文件的模块名（默认 'root'） */
  rootModuleName?: string;
}

// ============================================================
// 核心 API
// ============================================================

/**
 * 将文件级依赖图聚合为模块级分组
 *
 * 分组规则：
 * 1. 以 basePrefix（默认 'src/'）开头的文件，按其后第 depth 级目录分组
 * 2. basePrefix 根目录下的散文件归入 rootModuleName 模块
 * 3. 无 src/ 目录时按项目根目录下第一级目录分组
 */
export function groupFilesToModules(
  graph: DependencyGraph,
  options: GroupingOptions = {},
): ModuleGroupResult {
  const {
    depth = 1,
    rootModuleName = 'root',
  } = options;

  // 自动检测 basePrefix
  const basePrefix = options.basePrefix ?? detectBasePrefix(graph.modules.map((n) => n.source));

  // 步骤 1：将每个文件分配到模块
  const moduleMap = new Map<string, string[]>();

  for (const node of graph.modules) {
    const moduleName = resolveModuleName(node.source, basePrefix, depth, rootModuleName);
    if (!moduleMap.has(moduleName)) {
      moduleMap.set(moduleName, []);
    }
    moduleMap.get(moduleName)!.push(node.source);
  }

  // 步骤 2：构建 ModuleGroup 列表
  const groups: ModuleGroup[] = [];
  for (const [name, files] of moduleMap) {
    const dirPath = name === rootModuleName
      ? basePrefix.replace(/\/$/, '') || '.'
      : basePrefix ? `${basePrefix}${name}` : name;
    groups.push({ name, dirPath, files: files.sort() });
  }

  // 步骤 3：构建模块间依赖关系
  const fileToModule = new Map<string, string>();
  for (const group of groups) {
    for (const file of group.files) {
      fileToModule.set(file, group.name);
    }
  }

  // 聚合文件级边为模块级边（去重，忽略模块内部依赖）
  const moduleEdgeSet = new Set<string>();
  const moduleEdges: Array<{ from: string; to: string }> = [];
  for (const edge of graph.edges) {
    const fromModule = fileToModule.get(edge.from);
    const toModule = fileToModule.get(edge.to);
    if (fromModule && toModule && fromModule !== toModule) {
      const key = `${fromModule}->${toModule}`;
      if (!moduleEdgeSet.has(key)) {
        moduleEdgeSet.add(key);
        moduleEdges.push({ from: fromModule, to: toModule });
      }
    }
  }

  // 步骤 4：模块级拓扑排序
  const moduleOrder = topologicalSortModules(
    groups.map((g) => g.name),
    moduleEdges,
  );

  return { groups, moduleOrder, moduleEdges };
}

// ============================================================
// 内部函数
// ============================================================

/**
 * 自动检测基准目录前缀
 * 如果所有文件都在 src/ 下则返回 'src/'，否则返回 ''
 */
function detectBasePrefix(filePaths: string[]): string {
  if (filePaths.length === 0) return 'src/';

  const srcCount = filePaths.filter((f) => f.startsWith('src/')).length;

  // 超过 80% 的文件在 src/ 下
  if (srcCount / filePaths.length > 0.8) return 'src/';

  const libCount = filePaths.filter((f) => f.startsWith('lib/')).length;
  if (libCount / filePaths.length > 0.8) return 'lib/';

  return '';
}

/**
 * 根据文件路径解析其所属的模块名
 */
function resolveModuleName(
  filePath: string,
  basePrefix: string,
  depth: number,
  rootModuleName: string,
): string {
  // 如果文件不在 basePrefix 下
  if (basePrefix && !filePath.startsWith(basePrefix)) {
    return rootModuleName;
  }

  // 取 basePrefix 之后的路径
  const relativePath = basePrefix ? filePath.slice(basePrefix.length) : filePath;
  const segments = relativePath.split('/');

  // 直接在 basePrefix 根目录下的散文件（如 'src/entry.ts'）
  if (segments.length <= 1) {
    return rootModuleName;
  }

  // 按 depth 取目录层级
  return segments.slice(0, depth).join('/');
}

/**
 * 模块级 Kahn 拓扑排序
 * 返回叶子模块优先（无依赖的模块先处理）的顺序
 */
function topologicalSortModules(
  moduleNames: string[],
  edges: Array<{ from: string; to: string }>,
): string[] {
  // 注意：这里的"依赖方向"是 from 依赖 to
  // 拓扑排序中，被依赖的（to）应该先处理
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const name of moduleNames) {
    inDegree.set(name, 0);
    adjacency.set(name, []);
  }

  // from 依赖 to → to 先处理 → to 的"出边"指向 from
  // 即在拓扑排序中：to → from
  for (const edge of edges) {
    adjacency.get(edge.to)?.push(edge.from);
    inDegree.set(edge.from, (inDegree.get(edge.from) ?? 0) + 1);
  }

  // Kahn 算法
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) {
      queue.push(name);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    // 稳定排序：字母序出队
    queue.sort();
    const node = queue.shift()!;
    sorted.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // 处理循环依赖：未排序的模块追加到末尾
  if (sorted.length < moduleNames.length) {
    const sortedSet = new Set(sorted);
    for (const name of moduleNames) {
      if (!sortedSet.has(name)) {
        sorted.push(name);
      }
    }
  }

  return sorted;
}
