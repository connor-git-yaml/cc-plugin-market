/**
 * Mermaid 依赖图渲染器
 * 参见 contracts/graph-module.md
 */
import type { DependencyGraph } from '../models/dependency-graph.js';

export interface RenderOptions {
  /** 按目录分组（默认：模块数 > 20 时） */
  collapseDirectories?: boolean;
  /** 高亮循环依赖（默认 true） */
  highlightCycles?: boolean;
  /** 最大节点数（默认 50） */
  maxNodes?: number;
}

/**
 * 简化模块路径用于 Mermaid 显示
 */
function simplifyPath(filePath: string): string {
  // 移除扩展名和 src/ 前缀
  return filePath
    .replace(/^src\//, '')
    .replace(/\.(ts|tsx|js|jsx)$/, '')
    .replace(/\/index$/, '');
}

/**
 * 创建 Mermaid 安全的节点 ID
 */
function toNodeId(filePath: string): string {
  return simplifyPath(filePath).replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * 按目录分组模块
 */
function groupByDirectory(
  modules: string[],
): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const mod of modules) {
    const simplified = simplifyPath(mod);
    const dir = simplified.includes('/') ? simplified.split('/')[0]! : '.';
    if (!groups.has(dir)) {
      groups.set(dir, []);
    }
    groups.get(dir)!.push(mod);
  }

  return groups;
}

/**
 * 为依赖关系图生成 Mermaid graph TD 源码
 *
 * @param graph - 依赖关系图
 * @param options - 渲染选项
 * @returns Mermaid graph TD 源码
 */
export function renderDependencyGraph(
  graph: DependencyGraph,
  options: RenderOptions = {},
): string {
  const {
    highlightCycles = true,
    maxNodes = 50,
  } = options;
  const collapseDirectories = options.collapseDirectories ??
    graph.modules.length > 20;

  const lines: string[] = ['graph TD'];

  // 收集循环依赖的模块
  const circularModules = new Set<string>();
  if (highlightCycles) {
    for (const scc of graph.sccs) {
      if (scc.modules.length > 1) {
        for (const mod of scc.modules) {
          circularModules.add(mod);
        }
      }
    }
  }

  if (collapseDirectories) {
    // 目录折叠模式
    const groups = groupByDirectory(graph.modules.map((m) => m.source));
    const dirNodes = new Map<string, string>();

    for (const [dir, modules] of groups) {
      const nodeId = `dir_${dir.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      dirNodes.set(dir, nodeId);
      const hasCircular = modules.some((m) => circularModules.has(m));
      const label = `${dir}/ (${modules.length})`;

      if (hasCircular && highlightCycles) {
        lines.push(`  ${nodeId}["${label}"]:::cycle`);
      } else {
        lines.push(`  ${nodeId}["${label}"]`);
      }
    }

    // 目录间的边
    const dirEdges = new Set<string>();
    for (const edge of graph.edges) {
      const fromDir = simplifyPath(edge.from).includes('/')
        ? simplifyPath(edge.from).split('/')[0]!
        : '.';
      const toDir = simplifyPath(edge.to).includes('/')
        ? simplifyPath(edge.to).split('/')[0]!
        : '.';

      if (fromDir !== toDir) {
        const key = `${fromDir}->${toDir}`;
        if (!dirEdges.has(key)) {
          dirEdges.add(key);
          const fromId = dirNodes.get(fromDir)!;
          const toId = dirNodes.get(toDir)!;
          if (fromId && toId) {
            lines.push(`  ${fromId} --> ${toId}`);
          }
        }
      }
    }
  } else {
    // 逐模块模式（限制 maxNodes）
    const visibleModules = graph.modules.slice(0, maxNodes);

    for (const mod of visibleModules) {
      const nodeId = toNodeId(mod.source);
      const label = simplifyPath(mod.source);

      if (circularModules.has(mod.source) && highlightCycles) {
        lines.push(`  ${nodeId}["${label}"]:::cycle`);
      } else {
        lines.push(`  ${nodeId}["${label}"]`);
      }
    }

    // 可见模块的集合
    const visibleSet = new Set(visibleModules.map((m) => m.source));

    // 边
    for (const edge of graph.edges) {
      if (!visibleSet.has(edge.from) || !visibleSet.has(edge.to)) continue;

      const fromId = toNodeId(edge.from);
      const toId = toNodeId(edge.to);

      if (edge.isCircular && highlightCycles) {
        lines.push(`  ${fromId} -.->|circular| ${toId}`);
      } else {
        lines.push(`  ${fromId} --> ${toId}`);
      }
    }

    // 超出 maxNodes 的提示
    if (graph.modules.length > maxNodes) {
      lines.push(
        `  more["... 还有 ${graph.modules.length - maxNodes} 个模块"]`,
      );
    }
  }

  // 循环依赖样式
  if (highlightCycles && circularModules.size > 0) {
    lines.push('');
    lines.push('  classDef cycle fill:#f96,stroke:#f00,color:#fff');
  }

  return lines.join('\n');
}
