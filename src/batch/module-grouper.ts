/**
 * 文件→模块分组与模块级拓扑排序
 * 将 dependency-cruiser 的文件级 DependencyGraph 聚合为目录级模块
 * 支持语言感知分组：同目录多语言文件拆分为带语言后缀的子模块（Feature 031）
 * 支持目录语义分类过滤（Feature 095）
 */
import * as path from 'node:path';
import type { DependencyGraph } from '../models/dependency-graph.js';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';
import { classifyDirectories } from './directory-classifier.js';
import type { DirectoryClassifierOptions } from './directory-classifier.js';

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
  /** 该模块的主要语言（仅语言感知分组模式下设置） */
  language?: string;
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
  /** 启用语言感知分组（同目录不同语言拆分为子模块） */
  languageAware?: boolean;
  /**
   * 启用目录语义分类，自动过滤非 source 类别目录（FR-005）
   * 开启后，example/vendor/test 等目录的模块不会进入 moduleOrder
   */
  classifyDirectories?: boolean;
  /**
   * 目录分类器选项（仅在 classifyDirectories: true 时生效）
   */
  directoryClassifierOptions?: DirectoryClassifierOptions;
  /**
   * 项目根目录绝对路径（用于目录分类器解析目录路径）
   */
  projectRoot?: string;
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
    languageAware = false,
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

  // 步骤 2：构建 ModuleGroup 列表（语言感知模式下可能拆分）
  const groups: ModuleGroup[] = [];

  if (languageAware) {
    const registry = LanguageAdapterRegistry.getInstance();

    for (const [name, files] of moduleMap) {
      const dirPath = name === rootModuleName
        ? basePrefix.replace(/\/$/, '') || '.'
        : basePrefix ? `${basePrefix}${name}` : name;

      // 按语言分组
      const langGroups = new Map<string, string[]>();
      for (const file of files) {
        const adapter = registry.getAdapter(file);
        const langId = adapter?.id ?? 'unknown';
        if (!langGroups.has(langId)) {
          langGroups.set(langId, []);
        }
        langGroups.get(langId)!.push(file);
      }

      if (langGroups.size <= 1) {
        // 单语言目录：保持原名（向后兼容）
        const langId = langGroups.keys().next().value as string | undefined;
        groups.push({
          name,
          dirPath,
          files: files.sort(),
          language: langId,
        });
      } else {
        // 多语言目录：拆分为带语言后缀的子模块
        for (const [langId, langFiles] of langGroups) {
          const subName = `${name}--${langId}`;
          groups.push({
            name: subName,
            dirPath,
            files: langFiles.sort(),
            language: langId,
          });
        }
      }
    }
  } else {
    for (const [name, files] of moduleMap) {
      const dirPath = name === rootModuleName
        ? basePrefix.replace(/\/$/, '') || '.'
        : basePrefix ? `${basePrefix}${name}` : name;
      groups.push({ name, dirPath, files: files.sort() });
    }
  }

  // 步骤 2.5：扁平包自动降级为文件级分组
  // 仅当无标准源码目录布局（basePrefix === ''）且目录级分组只产生 1 个包含多文件的非 root 模块时触发
  // 典型场景：Python 单包项目（graphify/pipeline.py, graphify/extract.py, ...）
  const nonRootGroups = groups.filter((g) => g.name !== rootModuleName);
  if (basePrefix === '' && nonRootGroups.length === 1 && nonRootGroups[0]!.files.length > 1) {
    const soleGroup = nonRootGroups[0]!;
    const rootGroup = groups.find((g) => g.name === rootModuleName);
    // 将唯一模块拆分为文件级子模块
    const fileGroups: ModuleGroup[] = soleGroup.files.map((file) => {
      const stem = path.basename(file).replace(/\.[^.]+$/, '');
      return {
        name: stem,
        dirPath: soleGroup.dirPath,
        files: [file],
        language: soleGroup.language,
      };
    });
    // 重建 groups：保留 root（若存在）+ 文件级模块
    groups.length = 0;
    if (rootGroup) groups.push(rootGroup);
    groups.push(...fileGroups);
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

  // 步骤 3.5（可选）：目录语义分类过滤（FR-005）
  // 将非 source 类别的模块标记，但仍保留在 groups 中（供 batch-orchestrator 决策是否跳过）
  let sourceGroups: ModuleGroup[];
  if (options.classifyDirectories) {
    const projectRoot = options.projectRoot ?? '';
    // 构建目录绝对路径和 import 边
    const dirPaths = groups.map((g) => {
      // dirPath 可能是相对路径，尝试结合 projectRoot 解析
      return projectRoot ? path.resolve(projectRoot, g.dirPath) : g.dirPath;
    });

    // 构建文件级 import 边（用于 import 反向引用信号）
    const importEdges = graph.edges.map((e) => ({ from: e.from, to: e.to }));

    const classifications = classifyDirectories(dirPaths, importEdges, options.directoryClassifierOptions);
    const classMap = new Map<string, typeof classifications[0]>();
    for (let i = 0; i < groups.length; i++) {
      classMap.set(groups[i]!.name, classifications[i]!);
    }

    // sourceGroups：只保留 source 类别的模块进入 moduleOrder
    sourceGroups = groups.filter((g) => {
      const cls = classMap.get(g.name);
      return !cls || cls.category === 'source';
    });

    // 安全回退：如果分类后 0 个模块，说明分类器过于激进，回退到不分类
    if (sourceGroups.length === 0 && groups.length > 0) {
      sourceGroups = groups;
    }
  } else {
    sourceGroups = groups;
  }

  // 步骤 4：模块级拓扑排序（仅对 source 模块排序）
  const moduleOrder = topologicalSortModules(
    sourceGroups.map((g) => g.name),
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
