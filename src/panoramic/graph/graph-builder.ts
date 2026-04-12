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
  // 使用的数据源列表
  const sources: ('architecture-ir' | 'doc-graph' | 'cross-reference')[] = [];

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
      schemaVersion: '1.0',
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
