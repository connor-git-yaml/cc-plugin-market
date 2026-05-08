/**
 * Feature 151 — Knowledge Graph 模块顶层 API（FR-3 + Codex C-3 修订）
 *
 * 入口：buildUnifiedGraph(input)
 *   - 收集所有 CallSite + callerFile
 *   - call-resolver 派生 calls 边
 *   - deriveImportEdges 派生 depends-on 边（Codex C-3：DependencyGraph shim 数据源）
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
  return {
    nodes: [...nodes],
    edges: [...callEdges, ...importEdges],
    metadata: {
      generatedAt: new Date().toISOString(),
      projectRoot: input.projectRoot,
      schemaVersion: UNIFIED_GRAPH_SCHEMA_VERSION,
    },
  };
}

/**
 * 从 CodeSkeleton.imports 派生 depends-on 边（Codex C-3 修订）。
 *
 * 设计动机：
 * - DependencyGraph shim（T-014）需要 import 边数据源；如果 UnifiedGraph 只产 calls 边，
 *   shim 就无法派生 SCC / topologicalOrder / mermaidSource
 * - batch-orchestrator / doc-graph-builder / delta-regenerator 等 8+ consumer 消费 import 边
 *
 * 实现：每个 CodeSkeleton.imports[].resolvedPath 派生一条
 *   `${callerFile} -[depends-on]-> ${target}` 边，confidence='high'，directional=true
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
      edges.push({
        source: callerFile,
        target: imp.resolvedPath,
        relation: 'depends-on',
        confidence: 'high',
        directional: defaultDirectionalForRelation('depends-on'),
        evidence: imp.moduleSpecifier,
      });
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
 * 从 CodeSkeleton 派生 module + symbol 节点（默认行为）。
 *
 * 仅当 input.preBuiltNodes 未提供时使用。
 * 输出节点结构：
 * - 每个 CodeSkeleton 派生 1 个 module 节点（id = filePath）
 * - 每个 ExportSymbol 派生 1 个 symbol 节点（id = `${filePath}::${exp.name}`）
 * - class 的 members 进一步派生 symbol 节点（id = `${filePath}::${exp.name}.${m.name}`）
 */
function deriveNodesFromSkeletons(
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
): UnifiedNode[] {
  const nodes: UnifiedNode[] = [];
  for (const [filePath, sk] of codeSkeletons) {
    nodes.push({
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
      const symbolId = `${filePath}::${exp.name}`;
      nodes.push({
        id: symbolId,
        label: exp.name,
        kind: 'symbol',
        language: sk.language,
        filePath,
      });
      if (exp.members) {
        for (const m of exp.members) {
          nodes.push({
            id: `${symbolId}.${m.name}`,
            label: `${exp.name}.${m.name}`,
            kind: 'symbol',
            language: sk.language,
            filePath,
          });
        }
      }
    }
  }
  return nodes;
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
