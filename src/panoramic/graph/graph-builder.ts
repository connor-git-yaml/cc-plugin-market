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

/**
 * 生成有向图边 key（保留方向性）
 */
function directedEdgeKey(source: string, target: string, relation: string): string {
  return `${source}|${target}|${relation}`;
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
        nodeMap.set(id, node);
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
        const key = directed
          ? directedEdgeKey(edge.source, edge.target, edge.relation)
          : undirectedEdgeKey(edge.source, edge.target, edge.relation);
        // 取高 confidenceScore 的边
        const existing = edgeMap.get(key);
        if (!existing || confidenceScore > existing.confidenceScore) {
          edgeMap.set(key, edge);
        }
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
        const existingNode = nodeMap.get(element.id);
        if (existingNode) {
          node.metadata = { ...existingNode.metadata, ...node.metadata };
        }
        nodeMap.set(element.id, node);
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

        const key = directed
          ? directedEdgeKey(edge.source, edge.target, edge.relation)
          : undirectedEdgeKey(edge.source, edge.target, edge.relation);
        const existing = edgeMap.get(key);
        if (!existing || confidenceScore > existing.confidenceScore) {
          edgeMap.set(key, edge);
        }
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
        const key = directed
          ? directedEdgeKey(edge.source, edge.target, edge.relation)
          : undirectedEdgeKey(edge.source, edge.target, edge.relation);
        const existing = edgeMap.get(key);
        if (!existing || confidenceScore > existing.confidenceScore) {
          edgeMap.set(key, edge);
        }
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
          const existingNode = nodeMap.get(node.id);
          if (existingNode) {
            graphNode.metadata = { ...existingNode.metadata, ...graphNode.metadata };
          }
          nodeMap.set(node.id, graphNode);
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
          const key = directed
            ? directedEdgeKey(graphEdge.source, graphEdge.target, graphEdge.relation)
            : undirectedEdgeKey(graphEdge.source, graphEdge.target, graphEdge.relation);
          const existing = edgeMap.get(key);
          if (!existing || confidenceScore > existing.confidenceScore) {
            edgeMap.set(key, graphEdge);
          }
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
        const edgeKey = isDirectional
          ? directedEdgeKey(ugEdge.source, ugEdge.target, ugEdge.relation)
          : undirectedEdgeKey(ugEdge.source, ugEdge.target, ugEdge.relation);
        const existingEdge = edgeMap.get(edgeKey);
        if (!existingEdge) {
          edgeMap.set(edgeKey, {
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
  const hashParts: string[] = [];
  if (options.docGraph) {
    const dg = options.docGraph as DocGraph;
    if (dg.generatedAt) hashParts.push(dg.generatedAt);
  }
  if (options.architectureIR) {
    const ir = options.architectureIR as ArchitectureIR;
    if (ir.generatedAt) hashParts.push(ir.generatedAt);
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

/** normalizeGraphForWrite 选项 */
export interface NormalizeGraphOptions {
  /** 为 true 时剥除 graph.generatedAt 等易变时间戳字段（byte-stable 比较场景使用） */
  stripTimestamps?: boolean;
}

/**
 * 写盘前原地归一化 GraphJSON，使同一语义输入产出逐字节稳定的磁盘文件。
 *
 * Phase 0 占位实现：纯 no-op（不做任何排序/剥除），保持现状行为不变。
 * GREEN 阶段（T022）才补全 nodes/links/hyperedges 排序与时间戳剥除逻辑。
 *
 * 注意：本函数原地修改传入对象（返回 void），调用前后对象引用保持相同。
 */
export function normalizeGraphForWrite(
  _graphJson: GraphJSON,
  _options?: NormalizeGraphOptions,
): void {
  // Phase 0 占位：no-op，不在任何写盘序列中调用。
}

/**
 * 深拷贝并剥除非确定性字段（如 generatedAt），保留全部语义内容，供稳定 hash 计算使用。
 *
 * Phase 0 占位实现：原样深拷贝返回（不剥除任何字段）。
 * GREEN 阶段（T023）补全剥除逻辑。
 */
export function stripVolatileFields<T>(value: T): T {
  // Phase 0 占位：原样返回深拷贝。
  return structuredClone(value);
}

/**
 * key 有序的稳定 JSON 序列化，使内容相同的对象产出相同字符串（不受 key 插入顺序影响）。
 *
 * Phase 0 占位实现：退化为标准 JSON.stringify（key 顺序未稳定化）。
 * GREEN 阶段（T023）补全 key 有序序列化。
 */
export function stableStringify(value: unknown): string {
  // Phase 0 占位：标准序列化。
  return JSON.stringify(value);
}
