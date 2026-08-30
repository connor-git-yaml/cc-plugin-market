/**
 * 统一知识图谱构建器（graph-builder）
 * 将 architecture-ir、doc-graph、cross-reference-index 三个数据源合并为
 * 单一 NetworkX 兼容的 GraphJSON 对象，并支持原子写入磁盘。
 *
 * 节点去重策略（last-write-wins）：
 *   先插入 DocGraph 节点（优先级低），后插入 ArchitectureIR 节点（覆盖同 ID）
 *
 * 悬空边处理：边的 source/target 不在已知节点集合时跳过，并计数 + 记 debug 日志
 *   （丢弃属常态而非异常，默认 warn 级别下不输出；`REVERSE_SPEC_LOG_LEVEL=debug` 可见）
 */
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { writeAtomicJson } from '../../utils/atomic-write.js';
import { createLogger } from '../utils/logger.js';
import type { ArchitectureIR, ArchitectureIRElement, ArchitectureIRRelationship } from '../models/architecture-ir-model.js';
import type { DocGraph, DocGraphSpecNode, DocGraphReference } from '../builders/doc-graph-builder.js';
import type { CrossReferenceLink } from '../../models/module-spec.js';
import { CONFIDENCE_SCORES, mapDocConfidence, mapEvidenceConfidence } from './confidence-mapper.js';
import type { BuildGraphOptions, ConfidenceLevel, GraphEdge, GraphJSON, GraphNode } from './graph-types.js';
import { isAbsoluteForeignPath, parseCanonicalSymbolId } from '../../knowledge-graph/relativize.js';
import { mergeLineRanges, normalizeLineRange, type LineRange } from '../../knowledge-graph/line-range.js';
import {
  getBuilderStamp,
  isStampProjectionLossless,
  parseGraphBuilderStamp,
} from './builder-stamp.js';

const logger = createLogger('graph-builder');

// ============================================================
// ArchitectureIRElementKind → GraphNode.kind 映射表
// ============================================================

/** ArchitectureIRElementKind 到 GraphNode.kind 的映射规则（FR-101-02） */
const KIND_MAP: Record<string, GraphNode['kind']> = {
  'software-system': 'component',
  'container': 'module',
  'component': 'component',
  'deployment-node': 'module',
  'infrastructure-node': 'module',
  'external-system': 'component',
  'image': 'module',
};

// ============================================================
// 内部辅助：无向图边的去重 key 生成
// ============================================================

/**
 * 生成无向图边去重 key
 * key = "${min(source,target)}|${max(source,target)}|${relation}"
 * 保证 A→B 和 B→A 被视为同一条边
 */
function undirectedEdgeKey(source: string, target: string, relation: string): string {
  const [s, t] = source <= target ? [source, target] : [target, source];
  return `${s}|${t}|${relation}`;
}

/**
 * F271 — 五路合流时 lineRange 的合并规则：两侧都有合法 span 取并集，否则取有值的一侧。
 *
 * existing 侧的值来自 extraction 路径（python-adapter），incoming 来自 unified 路径；
 * 两者同源于 ExportSymbol span，但同名符号在两条路径上可能折叠到不同条目，故不假设等值。
 */
function mergeExistingLineRange(existingRaw: unknown, incoming: LineRange | undefined): LineRange | undefined {
  const existing = normalizeLineRange(existingRaw);
  if (existing === undefined) return incoming;
  if (incoming === undefined) return existing;
  return mergeLineRanges(existing, incoming);
}

/** 完整 SHA-256 hex（供 inputHash 的内容子哈希使用，最终 inputHash 再统一截 16 位） */
function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * 生成有向图边 key（保留方向性）
 */
function directedEdgeKey(source: string, target: string, relation: string): string {
  return `${source}|${target}|${relation}`;
}

// ============================================================
// 内部辅助：边 / 节点 upsert（Feature 178 — 五路数据源去重）
// ============================================================

/**
 * 按 directed 选择有向 / 无向 key 派生。
 *
 * Feature 178：五路数据源统一经此派生 edge key（含 unifiedGraph 路，其 directed 实参为
 * 该边自身的 isDirectional）。收敛原先逐字复制 5 次的 `directed?directedEdgeKey:undirectedEdgeKey` 三元。
 */
function edgeKey(source: string, target: string, relation: string, directed: boolean): string {
  return directed
    ? directedEdgeKey(source, target, relation)
    : undirectedEdgeKey(source, target, relation);
}

/**
 * 边 upsert（confidence-max-wins）。
 *
 * 同 key 仅当新边 confidenceScore 严格更高时覆盖。供 DocGraph / ArchitectureIR /
 * CrossReference / Extraction 四路同质边写入统一调用（Feature 178）。
 * unifiedGraph 第五路 directional 合并语义不同，不走此 helper。
 */
export function upsertEdge(edgeMap: Map<string, GraphEdge>, edge: GraphEdge, directed: boolean): void {
  const key = edgeKey(edge.source, edge.target, edge.relation, directed);
  const existing = edgeMap.get(key);
  if (!existing || edge.confidenceScore > existing.confidenceScore) {
    edgeMap.set(key, edge);
  }
}

/**
 * 节点 upsert（last-write-wins + metadata 合并）。
 *
 * 同 id 时后写覆盖先写，但保留先写 metadata 中后写没有的键（`{...existing, ...new}`）。
 * 供 DocGraph specs / ArchitectureIR elements / Extraction nodes 三路统一调用（Feature 178）。
 * DocGraph 为首路 existing 恒 undefined（buildDocGraph 已按 specPath 去重），合并退化为裸 set。
 * unifiedGraph 第五路 first-write-wins + callSitesCount 扩展语义不同，不走此 helper。
 */
export function upsertNode(nodeMap: Map<string, GraphNode>, node: GraphNode): void {
  const existing = nodeMap.get(node.id);
  if (existing) {
    node.metadata = { ...existing.metadata, ...node.metadata };
  }
  nodeMap.set(node.id, node);
}

// ============================================================
// 核心构建函数
// ============================================================

/**
 * 从三个数据源构建统一知识图谱
 *
 * 处理顺序：DocGraph（先插入，优先级低）→ ArchitectureIR（后插入，覆盖同 ID）→ CrossReferenceLinks
 * 悬空边（source/target 不存在于节点集合）静默跳过
 *
 * @param options - 数据源输入，所有字段均可选；缺失数据源 graceful skip
 * @returns NetworkX node-link 兼容的 GraphJSON 对象
 */
export function buildKnowledgeGraph(options: BuildGraphOptions): GraphJSON {
  const { directed = false } = options;
  // 节点去重 Map（id → GraphNode）
  const nodeMap = new Map<string, GraphNode>();
  // 边去重 Map（key → GraphEdge）
  const edgeMap = new Map<string, GraphEdge>();
  // 被跳过的数据源记录
  const skippedSources: Array<{ source: string; reason: string }> = [];
  // 使用的数据源列表（Feature 107 扩展：支持 'extraction' 数据源）
  const sources: ('architecture-ir' | 'doc-graph' | 'cross-reference' | 'extraction' | 'unified-graph')[] = [];

  // --------------------------------------------------------
  // 步骤 1：处理 DocGraph（先插入，优先级低）
  // --------------------------------------------------------
  if (options.docGraph) {
    try {
      const docGraph = options.docGraph as DocGraph;
      sources.push('doc-graph');

      // 遍历 spec 节点
      for (const spec of docGraph.specs) {
        const specNode = spec as DocGraphSpecNode;
        const id = specNode.specPath;
        const node: GraphNode = {
          id,
          kind: 'spec',
          label: path.basename(specNode.specPath, '.spec.md'),
          metadata: {
            sourceTarget: specNode.sourceTarget,
            relatedFiles: specNode.relatedFiles,
            confidence: specNode.confidence,
            currentRun: specNode.currentRun,
            sourceTag: 'doc-graph',
          },
        };
        upsertNode(nodeMap, node);
      }

      // 遍历引用边
      for (const ref of docGraph.references) {
        const docRef = ref as DocGraphReference;
        const confidence = mapEvidenceConfidence(docRef.evidenceCount);
        const confidenceScore = CONFIDENCE_SCORES[confidence];
        const edge: GraphEdge = {
          source: docRef.fromSpecPath,
          target: docRef.toSpecPath,
          relation: docRef.kind,
          confidence,
          confidenceScore,
        };
        upsertEdge(edgeMap, edge, directed);
      }
    } catch (err) {
      skippedSources.push({
        source: 'doc-graph',
        reason: `处理 DocGraph 时发生错误: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    skippedSources.push({ source: 'doc-graph', reason: '未提供 DocGraph 数据源' });
  }

  // --------------------------------------------------------
  // 步骤 2：处理 ArchitectureIR（后插入，覆盖同 ID 节点 — last-write-wins）
  // --------------------------------------------------------
  if (options.architectureIR) {
    try {
      const ir = options.architectureIR as ArchitectureIR;
      sources.push('architecture-ir');

      // 遍历元素节点（ArchitectureIR 节点覆盖 DocGraph 节点）
      for (const elem of ir.elements) {
        const element = elem as ArchitectureIRElement;
        const kindMapped: GraphNode['kind'] = KIND_MAP[element.kind] ?? 'component';
        const node: GraphNode = {
          id: element.id,
          kind: kindMapped,
          label: element.name,
          metadata: {
            description: element.description,
            technology: element.technology,
            tags: element.tags,
            sourceTags: element.sourceTags,
            sourceTag: 'architecture-ir',
            ...element.metadata,
          },
        };
        // last-write-wins + metadata 合并：后写覆盖先写，但保留先写的 metadata 字段
        upsertNode(nodeMap, node);
      }

      // 遍历关系边
      for (const rel of ir.relationships) {
        const relationship = rel as ArchitectureIRRelationship;
        // 优先使用字段值，缺失时默认 EXTRACTED（AST 提取的结构关系）
        const confidence: ConfidenceLevel = relationship.confidence ?? 'EXTRACTED';
        const confidenceScore = relationship.confidenceScore ?? CONFIDENCE_SCORES[confidence];
        const edge: GraphEdge = {
          source: relationship.sourceId,
          target: relationship.destinationId,
          relation: relationship.kind,
          confidence,
          confidenceScore,
        };

        // 无向图模式：强方向性关系保存 originalDirection
        const isStrongDirectional = ['contains', 'groups', 'deploys'].includes(relationship.kind);
        if (!directed && isStrongDirectional) {
          Object.assign(edge, {
            metadata: { originalDirection: `${relationship.sourceId}→${relationship.destinationId}` },
          });
        }

        upsertEdge(edgeMap, edge, directed);
      }
    } catch (err) {
      skippedSources.push({
        source: 'architecture-ir',
        reason: `处理 ArchitectureIR 时发生错误: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    skippedSources.push({ source: 'architecture-ir', reason: '未提供 ArchitectureIR 数据源' });
  }

  // --------------------------------------------------------
  // 步骤 3：处理 CrossReferenceLinks
  // --------------------------------------------------------
  if (options.crossReferenceLinks && options.crossReferenceLinks.length > 0) {
    try {
      sources.push('cross-reference');
      for (const link of options.crossReferenceLinks) {
        const crossRef = link as CrossReferenceLink;
        const confidence = mapEvidenceConfidence(crossRef.evidenceCount);
        const confidenceScore = CONFIDENCE_SCORES[confidence];
        // CrossReferenceLink 的 source 是 href（到 targetSpecPath）
        const edge: GraphEdge = {
          source: crossRef.targetSpecPath,
          target: crossRef.targetSourceTarget,
          relation: crossRef.kind,
          confidence,
          confidenceScore,
        };
        upsertEdge(edgeMap, edge, directed);
      }
    } catch (err) {
      skippedSources.push({
        source: 'cross-reference',
        reason: `处理 CrossReferenceLinks 时发生错误: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    skippedSources.push({ source: 'cross-reference', reason: '未提供 CrossReferenceLinks 数据源或为空数组' });
  }

  // --------------------------------------------------------
  // 步骤 3.5：处理 ExtractionResults（Feature 107 第四路数据源）
  // last-write-wins：提取节点可覆盖前序数据源同 ID 节点
  // 悬空边（source/target 不存在）在步骤 4 统一过滤
  // --------------------------------------------------------
  if (options.extractionResults && options.extractionResults.length > 0) {
    try {
      sources.push('extraction');
      for (const result of options.extractionResults) {
        for (const node of result.nodes) {
          const graphNode: GraphNode = {
            id: node.id,
            kind: node.kind as GraphNode['kind'],
            label: node.label,
            metadata: {
              ...node.metadata,
              sourceTag: 'extraction',
              sourceFile: node.source_file,
              confidence: node.confidence,
            },
          };
          // last-write-wins：提取节点覆盖同 ID 的前序节点，但合并 metadata
          upsertNode(nodeMap, graphNode);
        }

        for (const edge of result.edges) {
          const confidenceScore = CONFIDENCE_SCORES[edge.confidence] ?? 0.5;
          const graphEdge: GraphEdge = {
            source: edge.source,
            target: edge.target,
            relation: edge.relation,
            confidence: edge.confidence,
            confidenceScore,
          };
          upsertEdge(edgeMap, graphEdge, directed);
        }
      }
    } catch (err) {
      skippedSources.push({
        source: 'extraction',
        reason: `处理 ExtractionResults 时发生错误: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    skippedSources.push({ source: 'extraction', reason: '未提供 extractionResults 或为空数组' });
  }

  // --------------------------------------------------------
  // Feature 151 步骤 3.5：处理 UnifiedGraph（calls / depends-on 边 + per-file callSitesCount）
  // 仅当 options.unifiedGraph 提供时才执行
  //
  // Codex P2 C-1 修订：必须注入全部 UnifiedGraph 节点（含 symbol 节点），否则 calls 边
  //   `file::symbol → file::symbol` 会被悬空边过滤丢弃，SC-001/SC-002 完全失效
  // Codex P2 W-1 修订：directional 缺省按 relation 决定（calls/depends-on 等强制 true）
  // Codex P2 W-2 修订：edge key 冲突时合并 directional（保留 strictest=true）
  // --------------------------------------------------------
  if (options.unifiedGraph) {
    try {
      sources.push('unified-graph');
      const unified = options.unifiedGraph as {
        nodes: Array<{ id: string; kind?: string; label?: string; filePath?: string; metadata?: Record<string, unknown> }>;
        edges: Array<{
          source: string;
          target: string;
          relation: string;
          confidence: 'high' | 'medium' | 'low';
          directional?: boolean;
          evidence?: string;
        }>;
      };

      // Codex P2 C-1 修订：全部注入 UnifiedGraph 节点，包括 symbol 节点
      for (const ugNode of unified.nodes) {
        const existing = nodeMap.get(ugNode.id);
        const callSitesCount = typeof ugNode.metadata?.['callSitesCount'] === 'number'
          ? (ugNode.metadata['callSitesCount'] as number)
          : undefined;
        // UnifiedGraph 'symbol' kind 映射到 GraphNode 'component'（function/class 是组件级符号）
        const ugKind = ugNode.kind ?? 'module';
        // F217 决策 2 增补 4：exportKind/memberKind 透传（orphan-check pure-type 例外分类、
        // deriveNodesFromSkeletons 已在 metadata 写入的字段，此处沿路透传到 GraphNode）
        const exportKind = typeof ugNode.metadata?.['exportKind'] === 'string'
          ? (ugNode.metadata['exportKind'] as string)
          : undefined;
        const memberKind = typeof ugNode.metadata?.['memberKind'] === 'string'
          ? (ugNode.metadata['memberKind'] as string)
          : undefined;
        // F271 FR-004：lineRange 透传。上游（knowledge-graph/index.ts、python-adapter.ts）
        // 写入的是 { start, end } 数字对；此处走共享 normalizeLineRange 做同一套结构校验
        // （整数 / 1-indexed / start <= end），形状不符一律按缺席处理，
        // 避免把畸形值带进图污染消费端（file-nav-tools 会据此切片源文件）。
        const lineRange = normalizeLineRange(ugNode.metadata?.['lineRange']);

        if (existing) {
          // F217 决策 2 增补 4：已有节点（典型场景：Python extractSymbolNodes 第四路先写入
          // 的顶层 symbol，sourceTag='extraction'）补齐 unifiedKind/sourcePath/exportKind/
          // memberKind——contains-coverage-check.ts / orphan-check.ts 均依赖
          // metadata.unifiedKind==='symbol' 判定分母，若不补齐会导致这些顶层符号在 FR-003/
          // FR-005 判定中分母缩水（假绿）。
          // 不覆盖 extraction provenance 字段（sourceTag/sourceFile/symbolKind 等）——
          // 以下五个 key 是 existing.metadata 里原本不存在的新增 key，spread existing.metadata
          // 在前、新 key 在后，不会触碰已存在的 provenance 字段。
          // F271 FR-004：lineRange 与上述四个 key 不同——extraction 侧（python-adapter）
          // 也会写 lineRange，故 existing 可能已有值。两侧虽同源于 ExportSymbol span，但
          // **不保证等值**：同名符号（条件定义 / 遮蔽 / 重载）在两条路径上可能折叠到不同条目，
          // 静默覆盖会丢掉另一侧的行区间。故两侧都有合法值且不等时取并集（min start / max end），
          // 只有一侧有值时取那一侧。
          const mergedLineRange = mergeExistingLineRange(existing.metadata?.['lineRange'], lineRange);
          existing.metadata = {
            ...existing.metadata,
            unifiedKind: ugKind,
            ...(ugNode.filePath ? { sourcePath: ugNode.filePath } : {}),
            ...(callSitesCount !== undefined ? { callSitesCount } : {}),
            ...(exportKind !== undefined ? { exportKind } : {}),
            ...(memberKind !== undefined ? { memberKind } : {}),
            ...(mergedLineRange !== undefined ? { lineRange: mergedLineRange } : {}),
          };
          // Delta 再审 W1：merged 为 undefined 时，spread 会把 extraction 侧的畸形原值原样保留
          //（"不写新 key"≠"剥旧 key"）。本处是全链声明的结构校验收口点，畸形值必须在此剔除，
          // 否则 start:0 一类值会穿过消费端 typeof number 闸、被 clamp 后伪装成"图陈旧"误诊。
          if (mergedLineRange === undefined && 'lineRange' in existing.metadata) {
            delete (existing.metadata as Record<string, unknown>)['lineRange'];
          }
          continue;
        }

        // 新节点：module / package / spec 等其他 kind 直接保留（与 GraphNode kind 范围对齐）
        const mappedKind: GraphNode['kind'] = ugKind === 'symbol' ? 'component' : (ugKind as GraphNode['kind']);
        // Feature 193 决策 1d：透传 producer 侧 external 标记，使 portable 守卫与
        // 加载期 stale 检测能豁免 projectRoot 外的节点（node_modules / 跨仓引用，FR-004）。
        const isExternal = ugNode.metadata?.['external'] === true;
        nodeMap.set(ugNode.id, {
          id: ugNode.id,
          kind: mappedKind,
          label: ugNode.label ?? path.basename(ugNode.id),
          metadata: {
            sourceTag: 'unified-graph',
            unifiedKind: ugKind,
            ...(ugNode.filePath ? { sourcePath: ugNode.filePath } : {}),
            ...(callSitesCount !== undefined ? { callSitesCount } : {}),
            ...(isExternal ? { external: true } : {}),
            ...(exportKind !== undefined ? { exportKind } : {}),
            ...(memberKind !== undefined ? { memberKind } : {}),
            ...(lineRange !== undefined ? { lineRange } : {}),
          },
        });
      }

      // 把 UnifiedGraph.edges 转换为 GraphEdge 注入第五路
      // Codex P2 W-1 修订：directional 缺省按 relation 决定，不再统一 false
      const DIRECTIONAL_RELATIONS = new Set(['calls', 'depends-on', 'cross-module', 'contains']);
      for (const ugEdge of unified.edges) {
        const tier = ugEdge.confidence;
        const confidence: ConfidenceLevel =
          tier === 'high' ? 'EXTRACTED' : tier === 'medium' ? 'INFERRED' : 'AMBIGUOUS';
        const confidenceScore = CONFIDENCE_SCORES[confidence];
        const isDirectional =
          ugEdge.directional !== undefined ? ugEdge.directional : DIRECTIONAL_RELATIONS.has(ugEdge.relation);
        // Feature 178：key 派生统一走共享 edgeKey()（第五路 directed 实参为本边 isDirectional）；
        // 下方 directional 升级合并语义与前四路 confidence-max-wins 不同，保留内联不走 upsertEdge。
        const key = edgeKey(ugEdge.source, ugEdge.target, ugEdge.relation, isDirectional);
        const existingEdge = edgeMap.get(key);
        if (!existingEdge) {
          edgeMap.set(key, {
            source: ugEdge.source,
            target: ugEdge.target,
            relation: ugEdge.relation,
            confidence,
            confidenceScore,
            directional: isDirectional,
            ...(ugEdge.evidence ? { evidenceText: ugEdge.evidence.slice(0, 200) } : {}),
          });
        } else if (isDirectional && existingEdge.directional !== true) {
          // Codex P2 W-2 修订：旧边没设 directional，本次升级为 true
          existingEdge.directional = true;
        }
      }
    } catch (err) {
      skippedSources.push({
        source: 'unified-graph',
        reason: `处理 UnifiedGraph 失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // --------------------------------------------------------
  // 步骤 4：悬空边过滤（source/target 不在节点集合时跳过）
  // --------------------------------------------------------
  const filteredEdges: GraphEdge[] = [];
  // F242 可观测性：此过滤此前完全静默（零计数、零日志），F242 诊断的 4,517 条边丢失
  // 因此长期不可见。只计总数、不做分类打点——分类统计是一次性诊断脚本的职责，
  // 不固化进生产路径（分类信号高度依赖具体代码库形态，不适合做长期指标）。
  //
  // 用 debug 级而非 warn：call-resolver 按设计就会产出 `?::name` 这类占位 target，
  // 悬空丢弃是每次建图的常态而非异常，warn 级会变成恒响噪声（且绕过 batch 的静默控制）。
  let droppedCount = 0;
  for (const edge of edgeMap.values()) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      droppedCount++;
      continue;
    }
    filteredEdges.push(edge);
  }
  if (droppedCount > 0) {
    logger.debug(`dropped ${droppedCount} dangling edge(s) (source/target not in node set)`);
  }

  // --------------------------------------------------------
  // 步骤 5：计算 inputHash
  // --------------------------------------------------------
  // F175 FR-006/C-1：对"剥时间戳后的内容"做稳定 SHA-256（保留内容敏感性，禁退化为 count）。
  // 仅 generatedAt 变 → hash 不变（byte-stable）；语义内容变 → hash 变（cache 正确失效）。
  const hashParts: string[] = [];
  if (options.docGraph) {
    const dg = options.docGraph as DocGraph;
    hashParts.push(`docGraph:${sha256Hex(stableStringify(stripVolatileFields(dg)))}`);
  }
  if (options.architectureIR) {
    const ir = options.architectureIR as ArchitectureIR;
    hashParts.push(`architectureIR:${sha256Hex(stableStringify(stripVolatileFields(ir)))}`);
  }
  let inputHash: string | undefined;
  if (hashParts.length > 0) {
    const hashInput = hashParts.join('|');
    inputHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
  }

  // --------------------------------------------------------
  // 步骤 6：组装 GraphJSON
  // --------------------------------------------------------
  const nodes = Array.from(nodeMap.values());
  const links = filteredEdges;

  const graphJson: GraphJSON = {
    directed,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: links.length,
      sources,
      skippedSources: skippedSources.length > 0 ? skippedSources : undefined,
      inputHash,
      // schema v2.0：本版本默认输出均为 2.0，消费方按 schemaVersion 分支读取（向后兼容 v1.0 fixture）
      schemaVersion: '2.0',
    },
    nodes,
    links,
  };

  return graphJson;
}

// ============================================================
// 写盘函数
// ============================================================

/**
 * 将 God Node 的 degree 写入对应节点的 metadata（in-place 修改）
 *
 * 在社区检测后、写盘前调用，使 hook 脚本可以从 graph.json 中读取 degree。
 *
 * @param graphJson - 待修改的 GraphJSON（直接修改 nodes 数组）
 * @param godNodes - findGodNodes 返回的 God Node 列表
 */
export function enrichNodeDegrees(graphJson: GraphJSON, godNodes: Array<{ id: string; degree: number }>): void {
  if (godNodes.length === 0) return;
  const degreeMap = new Map<string, number>();
  for (const g of godNodes) {
    degreeMap.set(g.id, g.degree);
  }
  for (const node of graphJson.nodes) {
    const d = degreeMap.get(node.id);
    if (d !== undefined) {
      node.metadata = { ...node.metadata, degree: d };
    }
  }
}

/**
 * F261：本次写盘对 `graph.graph.builder` 的处置口径，**必须由调用方显式声明**。
 *
 * - `stamp-this-build`：本次写盘的图内容是**本进程刚建出来的**（走过 `buildKnowledgeGraph`），
 *   因此由本进程的 dist 盖章。三条建图链路（batch 主链 / graph-only / cli graph）用它。
 * - `preserve-recorded`：本次写盘只是把一张**别人建的图**改了点 metadata 再写回
 *   （`spectra community` 是当前唯一这类链路），MUST NOT 声称是自己建的——保留磁盘上记录的值：
 *   缺席就继续缺席，可解析则写回字段投影，**读不懂就原样不动**（D6 前向兼容规则）。
 */
export type BuilderProvenanceMode = 'stamp-this-build' | 'preserve-recorded';

/** `writeKnowledgeGraph` 的选项：归一化选项 + builder provenance 口径。 */
export interface WriteKnowledgeGraphOptions extends NormalizeGraphOptions {
  /**
   * 省略时取 **fail-safe 默认 `preserve-recorded`**。
   *
   * why 默认取"不盖章"而非"盖章"：两个方向的失效后果不对称——建图链路忘了声明，图变成
   * `unstamped`（消费侧措辞，少一维信息，诚实降级）；回写链路忘了声明，
   * 图会被盖上一个**它没建过**的章（自信的假陈述，且正是本机制要抓的失效模式）。
   *
   * **护栏口径（第四轮订正）**：本段前一版声称"有 E2E 用例把三条生产链路钉住"——**是假的**，
   * 对抗复审用变异实测证伪：把 `cli graph` 的声明改成 `preserve-recorded`、把 `cli community` 的
   * 改成 `stamp-this-build`（= 本特性立项要抓的伪造 provenance 形态），全量 7000+ 用例**无一变红**。
   * 把控制信号从"数据形态反推"改成"caller 传参"消除了绕过面，但也把正确性完全押在四个调用点的
   * **字面量**上，而那时四个字面量一个护栏都没有。现状（已补齐后）：
   *
   * | 调用点 | 声明 | 钉住它的用例 |
   * |---|---|---|
   * | `batch/stages/graph-assembly.ts`（graph-only） | stamp-this-build | `tests/integration/builder-stamp-e2e.test.ts`（真 dist，2 条） |
   * | `cli/commands/graph.ts` | stamp-this-build | `tests/integration/graph-command-sourcecommit.test.ts`（真 `runGraphCommand`） |
   * | `cli/commands/community.ts` | preserve-recorded | 同上文件（真 `runCommunityCommand`，反洗白） |
   * | `batch/batch-orchestrator.ts`（主链） | stamp-this-build | 仅被 f220 charter 快照的 `"builder": null` **间接**约束键存在性——如实登记为**较弱**的一环 |
   *
   * 注意 `tests/panoramic/community-persist.test.ts` 那几条**不**算 community 调用点的护栏：
   * 它们手写 `{ builderProvenance: 'preserve-recorded' }` 复刻 community 的步骤，把被测开关当成了
   * 输入常量，守的是 `writeKnowledgeGraph` 的内部分支。
   */
  builderProvenance?: BuilderProvenanceMode;
}

/**
 * 将 GraphJSON 原子写入目标路径
 * 内部调用 writeAtomicJson，同步执行
 *
 * @param graphJson - buildKnowledgeGraph() 的返回值
 * @param outputDir - 项目输出根目录（graph.json 写入 {outputDir}/_meta/graph.json）
 * @param options - 归一化选项（默认 undefined，等价 stripTimestamps:false）+ builder provenance 口径
 * @returns 实际写入的绝对路径
 */
export function writeKnowledgeGraph(
  graphJson: GraphJSON,
  outputDir: string,
  options?: WriteKnowledgeGraphOptions,
): string {
  // F183 修复 1：将 normalizeGraphForWrite 内聚进写盘出口，使 graph / community / batch
  // 三路写盘自动经过同一归一化，消除「CLI graph/community 未归一化 → 跨写盘点形态不一致」。
  //
  // 执行顺序严格为：① portable 守卫扫描 → ② normalizeGraphForWrite → ③ writeAtomicJson。
  // why 此序：portable 守卫只读、不改 graphJson，置于归一化前后均不影响其扫描结果；
  // 当前 normalizeGraphForWrite 仅做排序/字段剥除、不做路径转换，故先扫后归一化无副作用。
  // I-1 备注：若未来 normalizeGraphForWrite 增加「绝对路径 → 相对路径」转换，则守卫必须移到
  // 归一化「之后」（否则守卫会对未转换的绝对路径误报），届时需重排此处顺序。
  const violations = scanGraphPortabilityViolations(graphJson);
  if (violations.count > 0) {
    // warn 级而非 debug：绝对路径泄漏意味着 producer 侧相对化失效，图将不可跨机复用，
    // 属真异常信号，需要默认可见（logger 默认级别就是 warn）；与 dangling 边计数那种
    // 「预期内、仅供诊断」的 debug 级信息区分开。
    logger.warn(
      `[portable-guard] graph.json 含 ${violations.count} 个绝对路径泄漏（producer 侧应已相对化）：` +
        `${violations.samples.join(', ')}${violations.count > violations.samples.length ? ' …' : ''}`,
    );
  }
  // ①.5 F261：按调用方声明的口径处置 builder stamp——"这张图的内容由哪一版 dist 建出来"。
  //
  // why 由调用方显式声明，而不是从对象形态反推（复审 C-2，两路独立对抗审查各自实证复现）：
  // 本出口同时服务两类语义完全相反的写盘——
  // (a) 建图链路（batch 主链 / graph-only / cli graph）：内容是本进程 buildKnowledgeGraph 现做的，
  //     该盖自己的章；
  // (b) 纯 metadata 回写链路（cli community：JSON.parse 已有 graph.json → 只往节点 metadata 塞
  //     community id → 整份写回）：内容是**别人建的**，盖自己的章就是伪造 provenance。
  // 中间试过两版"从形态反推"的判据，都被实证击穿：
  //   · 裸赋值（第一轮）→ 把磁盘上 `commit=deaddead…` 的陈旧章洗成当前 commit；
  //   · `!('builder' in graph)`（第二轮）→ 挡住了有值那支，却把**上线前的存量图**（100% 没有
  //     该键）在一次 community 后从诚实的 `unrecorded`（键缺失态的消费侧措辞）变成一句自信的假陈述。
  // 教训与 F238 同类：**控制信号一旦由数据形态承担，就一定能被某种形态绕过**；终态是 caller 传参。
  // 默认值取 fail-safe 的 `preserve-recorded`（理由见 WriteKnowledgeGraphOptions）。
  //
  // why 不沿用 sourceCommit / fingerprint 的「非 AST 路径写 null」惯例：那条惯例的立论是
  // 「不解析源码就不许凭空推导源码属性」。但 builder 不是被分析对象的属性，是执行者自己的属性
  // ——`spectra graph` 这条链路同样由某一版 dist 建图，它完全知道自己是谁；让它写 null 不是
  // 诚实降级，而是主动丢弃一条它确实掌握的事实。
  //
  // why 放在归一化「之前」：确立「所有落盘前的字段变更都发生在归一化之前，归一化永远是最后
  // 一道确定性收口」。若未来 normalizeGraphForWrite 增加 meta 字段级处理（排序 / 剥除），
  // builder 会自动被纳入其确定性处理面。对 I-1 备注无影响：本处置插在守卫与归一化「之间」，
  // 两者相对次序未变；且 builder MUST NOT 携带任何文件系统路径，即便未来守卫被移到归一化
  // 之后，也不会因它产生新的误报或漏报。
  //
  // 入口收口（对抗复审 A-W2，第四轮）：`graph.graph` 在类型上是对象，但 `cli community` 的入口
  // 校验只查 `nodes` / `links` 是数组、**不查 `graph`**，外来 / 手工构造的 graph.json 完全可能
  // 带一个 `null` 的 meta。本处置之前的 `writeKnowledgeGraph` 对该形态不抛（守卫与归一化都不碰
  // `graph.graph`，除非 stripTimestamps），F261 加的 `in` / 属性赋值把它变成了 `TypeError`。
  // 实证后果是**半成功**：`community` 已经重写了 GRAPH_REPORT.md，随后写盘抛出 ⇒ 两个产物不一致。
  // 一个 advisory 字段 MUST NOT 具备让写盘失败的能力，故非对象形态一律**跳过 builder 处置**
  // （诚实降级：少一维信息，不中断写盘、不造假），与 `resolveBuilderStamp` 的同款口径一致。
  const meta: Record<string, unknown> | null =
    graphJson.graph !== null && typeof graphJson.graph === 'object'
      ? (graphJson.graph as unknown as Record<string, unknown>)
      : null;
  if (meta === null) {
    // 不做任何 builder 处置
  } else if (options?.builderProvenance === 'stamp-this-build') {
    graphJson.graph.builder = getBuilderStamp();
    // 用 hasOwnProperty 而非 `in`（对抗复审 I-3）：`in` 走原型链，一旦进程内有人污染
    // `Object.prototype.builder`，一张**本无该键的存量图**会被判成"有记录"、走进下方分支并被
    // 写成自有属性——恰好是 C-2 用例要防的"补写"。这里零成本消除该向量。
  } else if (Object.prototype.hasOwnProperty.call(meta, 'builder')) {
    // 保留通道的判据是「**覆盖会不会丢信息**」，不是「能不能解析」（裁决 D6 + 对抗复审 A-W1）：
    //
    // (i) 原值可解析**且不含任何未知键** → 用 5 字段投影覆盖（唯一效果是把键序规范化）。
    // (ii) 其余一切情形（不可解析 / 非对象 / 可解析但带未知键）→ **原样不动该键**
    //      （不解析、不投影、不覆盖、不置 null）。
    //
    // why (ii) 不再 collapse 成 null（第二轮就是这么做的，被实证是更严重的失真）：
    // 一张由**更新版本 spectra** 盖章的图，被**旧版** `spectra community` 跑一次纯 metadata
    // 回写，原始 stamp 就**永久丢失**——消费侧的 `unrecognized`（"更新版本写出 / 已被篡改"）
    // 被抹成 `unstamped`（"根本没盖章"），两者对应的排查动作完全不同。版本偏斜在本仓库是常态
    // （全局 MCP 装旧 dist、repo 跑新 dist），可达性不低。**旧版本无权抹掉更新版本写入的内容**
    // 是标准前向兼容规则；把"不可识别"抹成"未盖章"是把未知伪装成已知，与本字段的全部设计意图
    // （provenance 可见）方向相反。
    //
    // why 判据是"无损"而不是"可解析"（A-W1）：本模块的演进口径是"加字段**不必** bump
    // `formatVersion`"（见 `builder-stamp.ts` 文件头）。于是"更新版本写的 `formatVersion: 1`
    // ＋ 新字段"是**可解析**的，只按可解析性分流会让它走进投影分支、新字段被静默抹掉——
    // 与上一段要根除的是同一件事，只是换了个入口。见 {@link isStampProjectionLossless}。
    //
    // 由此让渡的那条防线（第二轮 A-W1：外来 `builtAtIso` / 绝对路径不落盘）由**消费侧**承担：
    // `describeBuilderStamp` 的 `unrecognized` 输出是与记录内容无关的常量串；
    // `scripts/graph-semantic-diff.mjs` 只渲染过十六进制闸口的值，外来内容里**只有经字符集消毒
    // 且限量的键名**会出现（`[A-Za-z0-9_.-]{1,40}`、最多 5 个），**值一律不进输出**——
    // 这条如实表述见 `builder-stamp.ts` 文件头，两侧各有用例钉住。
    // 这里 MUST NOT 顺手去扩 `scanGraphPortabilityViolations` 扫 `graph.graph`：写入侧的值域校验
    // 管的是"我们自己写什么"，保留通道管的是"别人写的我们看不懂的东西别动"，两者职责不同，
    // 混起来只会新增一片误报面（保留态的外来值本就预期不合我们的值域）。
    const recorded: unknown = meta['builder'];
    const projected = parseGraphBuilderStamp(recorded);
    if (projected !== null && isStampProjectionLossless(recorded)) {
      graphJson.graph.builder = projected;
    }
  }
  // ② 内聚归一化（in-place）：默认 options=undefined → stripTimestamps:false，保留各路时间戳
  // 注意：builder MUST NOT 被加进 stripTimestamps 的剥除面——那会在恰恰最需要 provenance 的
  // batch / graph-only 两条链路上把它抹掉。
  normalizeGraphForWrite(graphJson, options);
  const graphJsonPath = path.join(outputDir, '_meta', 'graph.json');
  // ③ 同步原子写盘，无需 await
  writeAtomicJson(graphJsonPath, graphJson);
  return path.resolve(graphJsonPath);
}

/** scanGraphPortabilityViolations 结果 */
export interface PortabilityScanResult {
  /** 绝对路径泄漏总数 */
  count: number;
  /** 前若干个泄漏样本（诊断用，最多 5 个） */
  samples: string[];
}

/**
 * Feature 193 决策 1d — 扫描 GraphJSON 中残留的绝对路径（portable 守卫 tripwire）。
 *
 * 扫描面（isAbsoluteForeignPath 跨平台判定，无需 projectRoot；Codex implement-new2：
 * 与 graph-query 加载期检测共用同一 helper，POSIX 运行时也能识别 Windows 盘符泄漏）：
 *   - node.id（symbol id 的 file part）
 *   - link.source / link.target（symbol id 的 file part）
 *   - node.metadata.sourcePath / sourceFile / sourceTarget
 *   - hyperedge.nodes 引用
 *
 * external 节点（metadata.external=true）的绝对路径是 FR-004 合法保留，**不计入违例**。
 * 守卫不做转换，仅计数 + 取样，供 writeKnowledgeGraph 告警与测试态断言（应为 0）。
 */
export function scanGraphPortabilityViolations(graphJson: GraphJSON): PortabilityScanResult {
  let count = 0;
  const samples: string[] = [];
  const record = (value: string): void => {
    count += 1;
    if (samples.length < 5) samples.push(value);
  };

  // id 的 file part = 第一个 `::` 之前（symbol id）或整个 id（module id）
  // Feature 214 FR-006：复用 parseCanonicalSymbolId 单点解析，不再各自切分。
  const filePartOf = (id: string): string => parseCanonicalSymbolId(id).filePart;

  // 标了 external 的节点集合（其绝对 id / 绝对 source-target 为 FR-004 合法保留）
  const externalIds = new Set<string>();
  for (const node of graphJson.nodes) {
    if (node.metadata && node.metadata['external'] === true) {
      externalIds.add(node.id);
    }
  }

  for (const node of graphJson.nodes) {
    const isExternal = externalIds.has(node.id);
    // Codex implement-W2：external 豁免只覆盖 id 与 sourcePath（节点自身在 node_modules/跨仓的
    // 合法绝对身份与文件路径，FR-004）；sourceFile / sourceTarget 代表不同关系映射，仍须 portable，
    // 不随整节点跳过——否则 external 标记可掩盖真实路径泄漏。
    if (!isExternal && isAbsoluteForeignPath(filePartOf(node.id))) record(node.id);
    const meta = node.metadata ?? {};
    for (const key of ['sourcePath', 'sourceFile', 'sourceTarget'] as const) {
      if (isExternal && key === 'sourcePath') continue;
      const v = meta[key];
      if (typeof v === 'string' && isAbsoluteForeignPath(v)) record(`${node.id}.metadata.${key}=${v}`);
    }
  }

  for (const link of graphJson.links) {
    // external 端点豁免（端点 id 在 externalIds 中）
    if (!externalIds.has(link.source) && isAbsoluteForeignPath(filePartOf(link.source))) {
      record(`edge.source=${link.source}`);
    }
    if (!externalIds.has(link.target) && isAbsoluteForeignPath(filePartOf(link.target))) {
      record(`edge.target=${link.target}`);
    }
  }

  if (graphJson.hyperedges) {
    for (const he of graphJson.hyperedges) {
      for (const nid of he.nodes) {
        if (!externalIds.has(nid) && isAbsoluteForeignPath(filePartOf(nid))) {
          record(`hyperedge[${he.id}].node=${nid}`);
        }
      }
    }
  }

  return { count, samples };
}

// ============================================================
// 写盘前归一化（normalizeGraphForWrite）— byte-stable 支撑
// ============================================================

/**
 * 节点 metadata 中属于"本轮运行态"的字段名——这些字段由生成流程内部使用（如
 * buildDocGraph 的 relevance/unlinked 计算），不代表持久化语义，写盘前一律剥除（C-1）。
 */
const RUNTIME_NODE_METADATA_FIELDS = ['currentRun'] as const;

/** normalizeGraphForWrite 选项 */
export interface NormalizeGraphOptions {
  /** 为 true 时剥除 graph.generatedAt 等易变时间戳字段（byte-stable 比较场景使用） */
  stripTimestamps?: boolean;
}

/**
 * 写盘前原地归一化 GraphJSON，使同一语义输入产出逐字节稳定的磁盘文件（FR-006/FR-007）。
 *
 * 归一化面（in-place，调用前后对象/数组引用保持相同——仅 sort 改变元素顺序）：
 *   (a) options.stripTimestamps 时把 graph.generatedAt 剥为固定 epoch
 *   (b) nodes 按 id 字典序排序
 *   (c) links 按 source + target + relation 三元组字典序排序
 *   (d) hyperedges（若有）按 id 字典序排序
 *   (e) 剥除节点 metadata 中的本轮运行态字段（currentRun 等）——该字段仅供
 *       buildDocGraph 内部 relevance/unlinked 计算使用，不应进入持久化 graph.json，
 *       否则 full 路径（currentRun:true）与无改动增量路径（cache-hit 的 currentRun:false）
 *       会在结构上不可能 deepEqual，破坏 SC-003 byte-stable（C-1）。
 */
export function normalizeGraphForWrite(
  graphJson: GraphJSON,
  options?: NormalizeGraphOptions,
): void {
  if (options?.stripTimestamps) {
    // 固定 epoch，使 byte-stable 比较不受真实生成时间影响
    graphJson.graph.generatedAt = '1970-01-01T00:00:00.000Z';
  }

  // 剥除节点 metadata 的运行态字段（无论是否 stripTimestamps 都剥——运行态字段
  // 不属于持久化语义，且在 full vs incremental 两路取值不同会破坏 byte-stable）
  for (const node of graphJson.nodes) {
    if (node.metadata && typeof node.metadata === 'object') {
      for (const field of RUNTIME_NODE_METADATA_FIELDS) {
        if (field in node.metadata) {
          delete (node.metadata as Record<string, unknown>)[field];
        }
      }
    }
  }

  // in-place 排序（不替换数组引用，保持调用方持有的引用稳定）
  graphJson.nodes.sort((a, b) => a.id.localeCompare(b.id));
  graphJson.links.sort((a, b) => {
    const ka = `${a.source}\x1f${a.target}\x1f${a.relation}`;
    const kb = `${b.source}\x1f${b.target}\x1f${b.relation}`;
    return ka.localeCompare(kb);
  });
  if (graphJson.hyperedges) {
    graphJson.hyperedges.sort((a, b) => a.id.localeCompare(b.id));
  }
}

/**
 * 每次运行必变的非确定性字段名（深拷贝时递归剥除），保留全部语义内容。
 *
 * 含两类：
 *   - 时间戳类（generatedAt/lastUpdated/timestamp）：每次运行墙钟必变。
 *   - 运行态类（currentRun）：full 路径下为 true、cache-hit 增量路径下为 false（C-1）。
 *     若不剥除，full vs 无改动增量的 docGraph 序列化串不同 → inputHash 不同 →
 *     graph.json 在结构上不可能 deepEqual（破坏 SC-003 byte-stable）。
 */
const VOLATILE_FIELD_NAMES = new Set(['generatedAt', 'lastUpdated', 'timestamp', 'currentRun']);

/**
 * 深拷贝并递归剥除非确定性字段（如 generatedAt），保留全部语义内容，供稳定 hash 计算使用。
 *
 * C-1：仅移除时间戳类易变字段，**不**退化为 count 摘要——必须保留内容敏感性，
 * 否则两个内容不同但 node/edge 数相同的 docGraph 会撞 hash → 静默返回 stale cache。
 */
export function stripVolatileFields<T>(value: T): T {
  return stripVolatileRec(value) as T;
}

function stripVolatileRec(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripVolatileRec(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_FIELD_NAMES.has(key)) continue;
      out[key] = stripVolatileRec(val);
    }
    return out;
  }
  return value;
}

/**
 * key 有序的稳定 JSON 序列化，使内容相同的对象产出相同字符串（不受 key 插入顺序影响）。
 * 递归对所有对象 key 排序；数组保留原顺序（语义有序）。
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysRec(value));
}

function sortKeysRec(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysRec(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort((a, b) => a.localeCompare(b))) {
      out[key] = sortKeysRec((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
