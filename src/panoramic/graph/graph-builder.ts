/**
 * 统一知识图谱构建器（graph-builder）
 * 将 architecture-ir、doc-graph、cross-reference-index 三个数据源合并为
 * 单一 NetworkX 兼容的 GraphJSON 对象，并支持原子写入磁盘。
 *
 * 节点去重策略（last-write-wins）：
 *   先插入 DocGraph 节点（优先级低），后插入 ArchitectureIR 节点（覆盖同 ID）
 *
 * 悬空边处理：边的 source/target 不在已知节点集合时静默跳过
 */
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { writeAtomicJson } from '../../utils/atomic-write.js';
import type { ArchitectureIR, ArchitectureIRElement, ArchitectureIRRelationship } from '../models/architecture-ir-model.js';
import type { DocGraph, DocGraphSpecNode, DocGraphReference } from '../builders/doc-graph-builder.js';
import type { CrossReferenceLink } from '../../models/module-spec.js';
import { CONFIDENCE_SCORES, mapDocConfidence, mapEvidenceConfidence } from './confidence-mapper.js';
import type { BuildGraphOptions, ConfidenceLevel, GraphEdge, GraphJSON, GraphNode } from './graph-types.js';

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

        if (existing) {
          // 已有节点：仅扩展 metadata.callSitesCount（不覆盖 kind / label / 其他 sourceTag）
          if (callSitesCount !== undefined) {
            existing.metadata = { ...existing.metadata, callSitesCount };
          }
          continue;
        }

        // 新节点：UnifiedGraph 'symbol' kind 映射到 GraphNode 'component'（function/class 是组件级符号）
        // module / package / spec 等其他 kind 直接保留（与 GraphNode kind 范围对齐）
        const ugKind = ugNode.kind ?? 'module';
        const mappedKind: GraphNode['kind'] = ugKind === 'symbol' ? 'component' : (ugKind as GraphNode['kind']);
        nodeMap.set(ugNode.id, {
          id: ugNode.id,
          kind: mappedKind,
          label: ugNode.label ?? path.basename(ugNode.id),
          metadata: {
            sourceTag: 'unified-graph',
            unifiedKind: ugKind,
            ...(ugNode.filePath ? { sourcePath: ugNode.filePath } : {}),
            ...(callSitesCount !== undefined ? { callSitesCount } : {}),
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
  for (const edge of edgeMap.values()) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      // 悬空边静默跳过（参考 Graphify build.py L46-47）
      continue;
    }
    filteredEdges.push(edge);
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
 * 将 GraphJSON 原子写入目标路径
 * 内部调用 writeAtomicJson，同步执行
 *
 * @param graphJson - buildKnowledgeGraph() 的返回值
 * @param outputDir - 项目输出根目录（graph.json 写入 {outputDir}/_meta/graph.json）
 * @returns 实际写入的绝对路径
 */
export function writeKnowledgeGraph(graphJson: GraphJSON, outputDir: string): string {
  const graphJsonPath = path.join(outputDir, '_meta', 'graph.json');
  // 同步调用，无需 await
  writeAtomicJson(graphJsonPath, graphJson);
  return path.resolve(graphJsonPath);
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
