/**
 * 拓扑排序与 Tarjan SCC 检测
 * 参见 contracts/graph-module.md
 */
import type { DependencyGraph, SCC } from '../models/dependency-graph.js';

// ============================================================
// 类型定义
// ============================================================

export interface TopologicalResult {
  /** 按依赖顺序排列的文件路径（叶子节点优先） */
  order: string[];
  /** 模块 → 拓扑层级 */
  levels: Map<string, number>;
  /** 是否存在循环依赖 */
  hasCycles: boolean;
  /** 大小 > 1 的 SCC */
  cycleGroups: string[][];
}

// ============================================================
// Tarjan SCC 检测
// ============================================================

/**
 * 基于 Tarjan 算法的强连通分量检测
 *
 * @param graph - 依赖关系图
 * @returns 所有 SCC（单模块 SCC 的 modules.length === 1）
 */
export function detectSCCs(graph: DependencyGraph): SCC[] {
  const nodes = graph.modules.map((m) => m.source);
  const nodeSet = new Set(nodes);

  // 构建邻接表
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node, []);
  }
  for (const edge of graph.edges) {
    if (nodeSet.has(edge.from) && nodeSet.has(edge.to)) {
      adjacency.get(edge.from)!.push(edge.to);
    }
  }

  // Tarjan 算法状态
  let index = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: SCC[] = [];
  let sccId = 0;

  function strongConnect(v: string): void {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        // w 未访问
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        // w 在栈上 → 属于当前 SCC
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    // v 是 SCC 的根节点
    if (lowlinks.get(v) === indices.get(v)) {
      const sccModules: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        sccModules.push(w);
      } while (w !== v);

      sccs.push({ id: sccId++, modules: sccModules });
    }
  }

  for (const node of nodes) {
    if (!indices.has(node)) {
      strongConnect(node);
    }
  }

  return sccs;
}

// ============================================================
// 拓扑排序（Kahn 算法）
// ============================================================

/**
 * 使用 Kahn 算法计算处理顺序
 * 循环依赖被折叠为 SCC 后作为整体处理
 *
 * @param graph - 依赖关系图
 * @returns 拓扑排序结果
 */
export function topologicalSort(graph: DependencyGraph): TopologicalResult {
  const nodes = graph.modules.map((m) => m.source);
  const nodeSet = new Set(nodes);

  if (nodes.length === 0) {
    return { order: [], levels: new Map(), hasCycles: false, cycleGroups: [] };
  }

  // 检测 SCC
  const sccs = detectSCCs(graph);
  const cycleGroups = sccs
    .filter((scc) => scc.modules.length > 1)
    .map((scc) => scc.modules);
  const hasCycles = cycleGroups.length > 0;

  // 将 SCC 折叠为单个节点
  // 每个模块映射到其 SCC 的代表节点
  const sccRepresentative = new Map<string, string>();
  for (const scc of sccs) {
    const rep = scc.modules[0]!;
    for (const mod of scc.modules) {
      sccRepresentative.set(mod, rep);
    }
  }

  // 构建折叠后的 DAG
  const collapsedNodes = new Set<string>();
  for (const scc of sccs) {
    collapsedNodes.add(scc.modules[0]!);
  }

  const collapsedAdj = new Map<string, Set<string>>();
  const collapsedInDegree = new Map<string, number>();
  for (const node of collapsedNodes) {
    collapsedAdj.set(node, new Set());
    collapsedInDegree.set(node, 0);
  }

  for (const edge of graph.edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) continue;
    const fromRep = sccRepresentative.get(edge.from)!;
    const toRep = sccRepresentative.get(edge.to)!;
    if (fromRep !== toRep && !collapsedAdj.get(fromRep)!.has(toRep)) {
      collapsedAdj.get(fromRep)!.add(toRep);
      collapsedInDegree.set(toRep, (collapsedInDegree.get(toRep) ?? 0) + 1);
    }
  }

  // Kahn 算法
  const queue: string[] = [];
  for (const [node, degree] of collapsedInDegree) {
    if (degree === 0) {
      queue.push(node);
    }
  }

  const sortedCollapsed: string[] = [];
  const levels = new Map<string, number>();

  while (queue.length > 0) {
    const node = queue.shift()!;
    sortedCollapsed.push(node);

    // 计算层级：max(依赖的层级) + 1，无依赖则为 0
    let maxDepLevel = -1;
    for (const edge of graph.edges) {
      const toRep = sccRepresentative.get(edge.to);
      const fromRep = sccRepresentative.get(edge.from);
      if (toRep === node && fromRep !== node) {
        const depLevel = levels.get(fromRep!) ?? 0;
        maxDepLevel = Math.max(maxDepLevel, depLevel);
      }
    }
    const level = maxDepLevel + 1;

    // 展开 SCC 中的所有模块
    const scc = sccs.find((s) => s.modules[0] === node);
    if (scc) {
      for (const mod of scc.modules) {
        levels.set(mod, level);
      }
    }

    for (const neighbor of collapsedAdj.get(node) ?? []) {
      const newDegree = (collapsedInDegree.get(neighbor) ?? 1) - 1;
      collapsedInDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // 展开排序结果：叶子节点优先（反转依赖方向）
  const order: string[] = [];
  for (const rep of sortedCollapsed) {
    const scc = sccs.find((s) => s.modules[0] === rep);
    if (scc) {
      order.push(...scc.modules);
    }
  }

  return { order, levels, hasCycles, cycleGroups };
}
