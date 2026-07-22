/**
 * Feature 151 — Knowledge Graph 模块顶层 API（FR-3 + Codex C-3 修订）
 *
 * 入口：buildUnifiedGraph(input)
 *   - 收集所有 CallSite + callerFile
 *   - call-resolver 派生 calls 边
 *   - deriveImportEdges 派生 depends-on 边（Codex C-3：ModuleGraph 数据源）
 *   - 装配 nodes / edges / metadata 输出 UnifiedGraph
 *
 * 单例 cache：
 *   - setCurrentUnifiedGraph / getCurrentUnifiedGraph
 *   - 让 panoramic 阶段（component-view-builder DI）能在不改 generate 签名的前提下消费
 *   - batch-orchestrator 在生成 graph.json 之前 setCurrentUnifiedGraph(graph)
 */
import type { CodeSkeleton } from '../models/code-skeleton.js';
import type { CallSite } from '../models/call-site.js';
import {
  resolveCalls,
  type CallSiteWithFile,
} from './call-resolver.js';
import {
  UNIFIED_GRAPH_SCHEMA_VERSION,
  defaultDirectionalForRelation,
  type UnifiedEdge,
  type UnifiedGraph,
  type UnifiedNode,
} from './unified-graph.js';
import { relativizePosix, relativizeSymbolId } from './relativize.js';

// ───────────────────────────────────────────────────────────
// Public types & API
// ───────────────────────────────────────────────────────────

export interface BuildUnifiedGraphInput {
  projectRoot: string;
  /** absoluteFilePath → CodeSkeleton */
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>;
  /** 可选：复用已构建的节点（panoramic GraphNode → UnifiedNode 转换路径），避免重复枚举 */
  preBuiltNodes?: ReadonlyArray<UnifiedNode>;
}

/**
 * 顶层 API — 把 CodeSkeleton Map 转换为 UnifiedGraph。
 *
 * 输出 edges 同时含 calls + depends-on：
 * - calls 边：来自 resolveCalls(callSites, skeletons)
 * - depends-on 边：来自 deriveImportEdges(skeletons)
 *
 * 其他 relation（contains / cross-module / documents 等）由 graph-builder.ts
 * 在 4 路合并阶段从 docGraph / architectureIR / crossReferenceLinks 注入。
 */
export function buildUnifiedGraph(input: BuildUnifiedGraphInput): UnifiedGraph {
  const callSites = collectCallSites(input.codeSkeletons);
  const callEdges = resolveCalls(callSites, input.codeSkeletons);
  const importEdges = deriveImportEdges(input.codeSkeletons);
  const nodes = input.preBuiltNodes ?? deriveNodesFromSkeletons(input.codeSkeletons);
  // Feature 214 FR-001/002：语言无关派生 module→symbol / class→member 两级 contains 边。
  // W-6：过滤到「两端点都存在于最终节点集合」，防 preBuiltNodes 路径下 symbol/member 节点
  // 未被注入时产生悬空 contains 边（默认 deriveNodesFromSkeletons 路径下全部端点必然存在）。
  const nodeIds = new Set(nodes.map((n) => n.id));
  const containsEdges = deriveContainsEdges(input.codeSkeletons).filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );
  // Feature 193 决策 1：出口统一相对化 pass。
  // 覆盖全部四条值来源（deriveNodesFromSkeletons 节点、resolveCalls calls 边、
  // deriveImportEdges 边、preBuiltNodes 注入），把绝对路径前缀相对化为 POSIX 相对路径，
  // 使 graph + 快照跨 worktree byte 可移植。call-resolver.ts 零改动（其输出在此被覆盖）。
  // projectRoot 持久化为 '.'（相对标记）。pass 幂等：已相对的输入原样保留。
  return relativizeGraph(
    {
      nodes: [...nodes],
      edges: [...callEdges, ...importEdges, ...containsEdges],
      metadata: {
        generatedAt: new Date().toISOString(),
        projectRoot: input.projectRoot,
        schemaVersion: UNIFIED_GRAPH_SCHEMA_VERSION,
      },
    },
    input.projectRoot,
  );
}

/**
 * Feature 193 决策 1 — 对装配完的 UnifiedGraph 做统一相对化（in-place 返回新对象）。
 *
 * - node.id / node.filePath：relativizeSymbolId / relativizePosix 相对化；projectRoot 外的
 *   节点保留绝对路径并标 metadata.external=true（FR-004）。
 * - edge.source / edge.target：relativizeSymbolId 相对化（含 calls 边与 import 边）。
 * - metadata.projectRoot：持久化为 '.'（schema 要求 min(1)，'.' 满足）。
 *
 * 幂等：已相对的 id / 路径原样返回（relativizePosix 对非绝对输入直接 POSIX 化返回）。
 */
export function relativizeGraph(graph: UnifiedGraph, projectRoot: string): UnifiedGraph {
  const nodes: UnifiedNode[] = graph.nodes.map((n) => {
    const idR = relativizeSymbolId(n.id, projectRoot);
    const next: UnifiedNode = { ...n, id: idR.value };
    if (n.filePath !== undefined) {
      next.filePath = relativizePosix(n.filePath, projectRoot).value;
    }
    if (idR.external) {
      next.metadata = { ...next.metadata, external: true };
    }
    return next;
  });

  const edges: UnifiedEdge[] = graph.edges.map((e) => ({
    ...e,
    source: relativizeSymbolId(e.source, projectRoot).value,
    target: relativizeSymbolId(e.target, projectRoot).value,
  }));

  return {
    nodes,
    edges,
    metadata: {
      ...graph.metadata,
      projectRoot: '.',
    },
  };
}

/**
 * 从 CodeSkeleton.imports 派生 depends-on 边（Codex C-3 修订 + Feature 156 W1.0 importType 编码）。
 *
 * 设计动机：
 * - ModuleGraph 派生（W1.4）需要 import 边数据源；如果 UnifiedGraph 只产 calls 边，
 *   就无法派生 SCC / topologicalOrder / mermaidSource
 * - batch-orchestrator / doc-graph-builder / delta-regenerator 等 8+ consumer 消费 import 边
 *
 * 实现：每个 CodeSkeleton.imports[].resolvedPath 派生一条
 *   `${callerFile} -[depends-on]-> ${target}` 边，confidence='high'，directional=true
 *
 * Feature 156 W1.0 v2 / WARN-3 修订：
 *   - evidence 字段保持纯 specifier（如 "./foo"），不再编码 importType 前缀
 *     —— 避免污染 panoramic 消费方（graph-builder / component-view-builder 直接展示 evidenceText / note）
 *   - importType 改写入 edge.metadata.importType 结构化字段（UnifiedEdge.metadata 已 schema 支持）
 *   - module-derivation.deriveModuleGraph 从 metadata.importType 读，不再 split evidence
 *
 * 注：本函数不做 cross-module name resolution（那是 call-resolver 的工作）；
 *     仅产 module-to-module 的 import 边。
 */
export function deriveImportEdges(
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
): UnifiedEdge[] {
  const edges: UnifiedEdge[] = [];
  for (const [callerFile, sk] of codeSkeletons) {
    for (const imp of sk.imports) {
      if (!imp.resolvedPath) continue;
      // 自引用过滤（一些 mapper 把同模块作 import 输出）
      if (imp.resolvedPath === callerFile) continue;
      // W1.0 v2 / WARN-3：evidence 保持纯 specifier；importType 写 metadata
      const edge: UnifiedEdge = {
        source: callerFile,
        target: imp.resolvedPath,
        relation: 'depends-on',
        confidence: 'high',
        directional: defaultDirectionalForRelation('depends-on'),
        evidence: imp.moduleSpecifier,
        ...(imp.importType ? { metadata: { importType: imp.importType } } : {}),
      };
      edges.push(edge);
    }
  }
  return edges;
}

/**
 * 收集所有 callSite + 附加 callerFile 上下文。
 * 仅当 CodeSkeleton.callSites 字段存在时收集；空 / 缺失字段视为该文件未抽取 callSites。
 */
function collectCallSites(
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
): CallSiteWithFile[] {
  const out: CallSiteWithFile[] = [];
  for (const [filePath, sk] of codeSkeletons) {
    if (!sk.callSites || sk.callSites.length === 0) continue;
    for (const cs of sk.callSites) {
      out.push({ ...cs, callerFile: filePath });
    }
  }
  return out;
}

/**
 * Feature 214 FR-006/C1 — canonical symbol / member 节点 ID 单点计算。
 *
 * deriveNodesFromSkeletons 与 deriveContainsEdges 共享同一 id 规则，
 * 二者不各自拼串——同名 member 天然共享 canonical id，是 C1 去重的语义基础。
 */
function symbolNodeId(filePath: string, symbolName: string): string {
  return `${filePath}::${symbolName}`;
}
function memberNodeId(symbolId: string, memberName: string): string {
  return `${symbolId}.${memberName}`;
}

/**
 * 从 CodeSkeleton 派生 module + symbol 节点（默认行为）。
 *
 * 仅当 input.preBuiltNodes 未提供时使用。
 * 输出节点结构：
 * - 每个 CodeSkeleton 派生 1 个 module 节点（id = filePath）
 * - 每个 ExportSymbol 派生 1 个 symbol 节点（id = `${filePath}::${exp.name}`）
 * - class 的 members 进一步派生 symbol 节点（id = `${filePath}::${exp.name}.${m.name}`）
 *
 * 【C1 生产端去重】按 node id 去重。code-skeleton 允许同名 member（getter/setter、
 * 重载），逐 member 写入会产生重复 UnifiedNode；UnifiedGraph snapshot 直接持久化此输出、
 * 不过 GraphJSON nodeMap，故第五路合并去重救不了快照层重复，必须在生产端折叠（FR-011）。
 */
function deriveNodesFromSkeletons(
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
): UnifiedNode[] {
  const nodes: UnifiedNode[] = [];
  const seen = new Set<string>();
  const push = (node: UnifiedNode): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    nodes.push(node);
  };
  for (const [filePath, sk] of codeSkeletons) {
    push({
      id: filePath,
      label: filePath.split(/[/\\]/).pop() ?? filePath,
      kind: 'module',
      language: sk.language,
      filePath,
      metadata: {
        callSitesCount: sk.callSites?.length ?? 0,
      },
    });
    for (const exp of sk.exports) {
      // re-export 是别名门面而非真身，真身节点由目标文件自身贡献；
      // 造 `orchestrator::X` 别名节点会与 stages 真身重复，触碰 F217 duplicate/orphan 门与 F214 canonical ID 拓扑。
      if (exp.kind === 're-export') continue;
      const symbolId = symbolNodeId(filePath, exp.name);
      push({
        id: symbolId,
        label: exp.name,
        kind: 'symbol',
        language: sk.language,
        filePath,
        // F217 决策 2 增补：透传 exp.kind，供 orphan-check.ts pure-type 例外分类
        // （metadata.exportKind === 'interface' | 'type'）判定依据。
        metadata: { exportKind: exp.kind },
      });
      if (exp.members) {
        for (const m of exp.members) {
          push({
            id: memberNodeId(symbolId, m.name),
            label: `${exp.name}.${m.name}`,
            kind: 'symbol',
            language: sk.language,
            filePath,
            // F217 决策 2 增补：透传 m.kind（member 级 kind，如 method/property）。
            metadata: { memberKind: m.kind },
          });
        }
      }
    }
  }
  return nodes;
}

/**
 * Feature 214 FR-001/002 — 语言无关派生 contains 边（W2：无任何语言 gate）。
 *
 * 层级规则：
 * - module → symbol/class 一级边（每个 export）
 * - class → member 两级边（每个 member），不产生 module → member 扁平直连边
 * - 无 class 包裹的顶层 symbol（含 Python 顶层函数）只产 module → symbol 一级边
 *
 * 【C1 生产端去重】边按 `(source,target,relation)` 去重；member id 复用 memberNodeId，
 * 与 deriveNodesFromSkeletons 共享同一 id 计算 → 同名 member（getter/setter、重载）
 * 天然折叠为单一 class → member 边。
 */
export function deriveContainsEdges(
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
): UnifiedEdge[] {
  const edges: UnifiedEdge[] = [];
  const seen = new Set<string>();
  const push = (source: string, target: string): void => {
    const key = `${source}|${target}|contains`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      source,
      target,
      relation: 'contains',
      confidence: 'high',
      directional: defaultDirectionalForRelation('contains'),
    });
  };
  for (const [filePath, sk] of codeSkeletons) {
    for (const exp of sk.exports) {
      // re-export 无对应真身节点（见 deriveNodesFromSkeletons 过滤），contains 边会悬空
      if (exp.kind === 're-export') continue;
      const symbolId = symbolNodeId(filePath, exp.name);
      // module → symbol/class 一级
      push(filePath, symbolId);
      // class → member 两级（member 唯一入边来自其 class，无 module → member 扁平边）
      for (const m of exp.members ?? []) {
        push(symbolId, memberNodeId(symbolId, m.name));
      }
    }
  }
  return edges;
}

// ───────────────────────────────────────────────────────────
// 单例 cache（FR-7 DI provider + Codex W-1 batch 直接路径）
// ───────────────────────────────────────────────────────────

let _cachedGraph: UnifiedGraph | null = null;

/**
 * 设置当前 batch / pipeline 构建好的 UnifiedGraph。
 * 由 batch-orchestrator 在生成 graph.json 之前调用，让下游 component-view-builder
 * 等通过 getCurrentUnifiedGraph() 拿到同一份图。
 */
export function setCurrentUnifiedGraph(g: UnifiedGraph | null): void {
  _cachedGraph = g;
}

/**
 * 获取当前 batch / pipeline 已构建的 UnifiedGraph。
 * 未设置时返回 null（生产 / 测试 / DI fallback）。
 */
export function getCurrentUnifiedGraph(): UnifiedGraph | null {
  return _cachedGraph;
}

// ───────────────────────────────────────────────────────────
// Re-exports（FR-3：统一对外 export）
// ───────────────────────────────────────────────────────────

export type {
  CallSite,
  UnifiedEdge,
  UnifiedGraph,
  UnifiedNode,
  CallSiteWithFile,
};
export {
  resolveCalls,
  UNIFIED_GRAPH_SCHEMA_VERSION,
  defaultDirectionalForRelation,
};
export {
  buildModuleSymbolIndex,
  buildClassMemberIndex,
  buildImportIndex,
  buildClassMroIndex,
  extractClassName,
} from './call-resolver.js';
export {
  CallSiteSchema,
  CalleeKindSchema,
  type CalleeKind,
} from '../models/call-site.js';
export {
  UnifiedGraphSchema,
  UnifiedNodeSchema,
  UnifiedNodeKindSchema,
  UnifiedEdgeSchema,
  UnifiedEdgeRelationSchema,
  ConfidenceTierSchema,
  type ConfidenceTier,
  type UnifiedNodeKind,
  type UnifiedEdgeRelation,
} from './unified-graph.js';
