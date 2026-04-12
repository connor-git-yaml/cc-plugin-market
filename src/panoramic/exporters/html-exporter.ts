/**
 * HTML 交互式可视化导出器
 * 纯函数管道：GraphJSON + CommunityResult + GodNode[] → 单文件 HTML
 *
 * 遵循 Graphify 纯函数管道设计模式：无类封装，无实例状态
 * FR 追踪: FR-006 ~ FR-012、FR-016 ~ FR-018
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GraphJSON } from '../graph/graph-types.js';
import type { CommunityResult } from '../community/community-detector.js';
import type { GodNode } from '../community/god-node-analyzer.js';
import type { ExportResult } from './export-types.js';
import { buildHtmlTemplate } from './html-template.js';

// ============================================================
// 常量定义
// ============================================================

/** 大图阈值：节点数超过此值时启用预计算网格布局，跳过 d3-force 仿真 */
const LARGE_GRAPH_THRESHOLD = 5_000;

/** 网格布局节点间距（px） */
const GRID_SPACING = 60;

// ============================================================
// 视觉映射函数 — FR-007
// ============================================================

/**
 * 按社区 ID 均匀分布色相，返回 HSL 颜色字符串
 *
 * @param communityId - 社区 ID（从 0 开始）
 * @param totalCommunities - 社区总数
 * @returns HSL 格式颜色字符串，如 "hsl(120, 65%, 55%)"
 */
export function communityColor(communityId: number, totalCommunities: number): string {
  // 避免除以 0；单个社区时固定色相
  const hue = totalCommunities > 0
    ? Math.round((communityId / totalCommunities) * 360) % 360
    : 0;
  return `hsl(${hue}, 65%, 55%)`;
}

/**
 * 按度数对数缩放计算节点半径
 * 范围：[4, 20] px；度数为 0 时取最小值 4
 *
 * @param degree - 节点度数（非负整数）
 * @returns 节点半径（px）
 */
export function nodeRadius(degree: number): number {
  const MIN = 4;
  const MAX = 20;
  if (degree <= 0) return MIN;
  // Math.log1p(degree) 对数缩放：degree=1→ln(2)≈0.69，degree=100→ln(101)≈4.62
  // 用常用图谱的 degree 上限（约 degree=1000）来标准化到 [MIN, MAX]
  const normalized = Math.log1p(degree) / Math.log1p(1000);
  return Math.min(MAX, Math.round(MIN + normalized * (MAX - MIN)));
}

/**
 * 按置信度分数线性映射边透明度
 * 范围：[0.1, 0.8]
 *
 * @param confidenceScore - 置信度分数 [0.0, 1.0]
 * @returns 透明度值 [0.1, 0.8]
 */
export function edgeOpacity(confidenceScore: number): number {
  const MIN = 0.1;
  const MAX = 0.8;
  const clamped = Math.max(0, Math.min(1, confidenceScore));
  return MIN + clamped * (MAX - MIN);
}

// ============================================================
// 大图网格布局 — FR-012
// ============================================================

/**
 * 计算预计算网格布局坐标（节点数 > 5000 时使用）
 *
 * 公式：列数 = Math.ceil(Math.sqrt(n))，节点间距 GRID_SPACING px
 *
 * @param nodeIds - 节点 ID 数组
 * @returns 节点 ID → {x, y} 坐标映射
 */
export function computeGridLayout(nodeIds: string[]): Map<string, { x: number; y: number }> {
  const n = nodeIds.length;
  const layout = new Map<string, { x: number; y: number }>();
  if (n === 0) return layout;

  const cols = Math.ceil(Math.sqrt(n));

  for (let i = 0; i < n; i++) {
    const id = nodeIds[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    layout.set(id, { x: col * GRID_SPACING, y: row * GRID_SPACING });
  }

  return layout;
}

// ============================================================
// 图谱数据序列化 — FR-007、FR-012、FR-016、FR-017
// ============================================================

/**
 * 嵌入 HTML 的节点数据结构（内部类型）
 */
interface HtmlNode {
  id: string;
  label: string;
  kind: string;
  color: string;
  radius: number;
  communityId: number;
  degree: number;
  isGodNode: boolean;
  fx?: number;
  fy?: number;
}

/**
 * 嵌入 HTML 的边数据结构（内部类型）
 */
interface HtmlLink {
  source: string;
  target: string;
  relation: string;
  opacity: number;
}

/**
 * 嵌入 HTML 的社区数据结构（内部类型，用于图例）
 */
interface HtmlCommunity {
  id: number;
  color: string;
  nodeCount: number;
}

/**
 * 将图谱数据序列化为嵌入 HTML 的 JSON 字符串（纯函数）
 *
 * 处理逻辑：
 * - 节点附加 color、radius、communityId、isGodNode
 * - 悬空边（source 或 target 不在节点集）静默跳过（FR-017）
 * - 节点数 > 5000 时调用 computeGridLayout 注入 fx/fy（FR-012）
 *
 * @param graphJson - GraphJSON 图谱数据
 * @param communityResult - 社区检测结果
 * @param godNodes - God Node 列表
 * @returns JSON.stringify 后的字符串
 */
export function buildGraphData(
  graphJson: GraphJSON,
  communityResult: CommunityResult,
  godNodes: GodNode[],
): string {
  const { nodes, links } = graphJson;
  const { nodeCommunityMap, communities } = communityResult;
  const totalCommunities = communities.length;

  // 构建节点 ID 集合（用于悬空边过滤）
  const nodeIdSet = new Set(nodes.map((n) => n.id));

  // 构建 God Node ID 集合
  const godNodeIdSet = new Set(godNodes.map((g) => g.id));

  // 计算每个节点的度数（从边列表统计，仅计算非悬空边）
  const degreeMap = new Map<string, number>();
  for (const edge of links) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) continue;
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  }

  // 大图降级：预计算网格布局（FR-012）
  const isLargeGraph = nodes.length > LARGE_GRAPH_THRESHOLD;
  const gridLayout = isLargeGraph
    ? computeGridLayout(nodes.map((n) => n.id))
    : undefined;

  // 构建 HTML 节点数组
  const htmlNodes: HtmlNode[] = nodes.map((node) => {
    const communityId = nodeCommunityMap.get(node.id) ?? -1;
    const degree = degreeMap.get(node.id) ?? 0;
    const color = communityId >= 0
      ? communityColor(communityId, totalCommunities)
      : 'hsl(0, 0%, 50%)';  // 未分类节点：灰色

    const htmlNode: HtmlNode = {
      id: node.id,
      label: node.label,
      kind: node.kind,
      color,
      radius: nodeRadius(degree),
      communityId,
      degree,
      isGodNode: godNodeIdSet.has(node.id),
    };

    // 注入预计算坐标（仅大图）
    if (gridLayout) {
      const pos = gridLayout.get(node.id);
      if (pos) {
        htmlNode.fx = pos.x;
        htmlNode.fy = pos.y;
      }
    }

    return htmlNode;
  });

  // 构建 HTML 边数组（跳过悬空边 FR-017）
  const htmlLinks: HtmlLink[] = [];
  for (const edge of links) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) {
      // 悬空边静默跳过
      continue;
    }
    htmlLinks.push({
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      opacity: edgeOpacity(edge.confidenceScore),
    });
  }

  // 构建社区图例数据
  const htmlCommunities: HtmlCommunity[] = communities.map((c) => ({
    id: c.id,
    color: communityColor(c.id, totalCommunities),
    nodeCount: c.nodes.length,
  }));

  return JSON.stringify({
    nodes: htmlNodes,
    links: htmlLinks,
    communities: htmlCommunities,
  });
}

// ============================================================
// HTML 生成 — FR-006、FR-007 ~ FR-012、FR-018
// ============================================================

/**
 * 生成单文件 HTML（纯函数，不写盘）
 * 返回完整 HTML 字符串，内嵌 d3-force bundle + 图谱数据 + CSS + JS
 *
 * @param graphJson - GraphJSON 图谱数据
 * @param communityResult - 社区检测结果
 * @param godNodes - God Node 列表
 * @returns 完整 HTML 字符串
 */
export function generateHtml(
  graphJson: GraphJSON,
  communityResult: CommunityResult,
  godNodes: GodNode[],
): string {
  const graphDataJson = buildGraphData(graphJson, communityResult, godNodes);
  return buildHtmlTemplate(graphDataJson);
}

// ============================================================
// 写盘入口 — FR-006、FR-016
// ============================================================

/**
 * HTML 导出写盘入口
 * 纯函数管道：graphJson + communityResult + godNodes → 单文件 HTML
 *
 * @param graphJson - GraphJSON 图谱数据
 * @param communityResult - 社区检测结果
 * @param godNodes - God Node 列表
 * @param outputDir - 输出目录（绝对路径或相对路径）
 * @returns ExportResult（文件路径列表、数量、耗时）
 */
export function generateHtmlExport(
  graphJson: GraphJSON,
  communityResult: CommunityResult,
  godNodes: GodNode[],
  outputDir: string,
): ExportResult {
  const startTime = Date.now();

  const html = generateHtml(graphJson, communityResult, godNodes);

  // 确保输出目录存在
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.resolve(outputDir, 'graph.html');
  fs.writeFileSync(outputPath, html, 'utf-8');

  return {
    files: [outputPath],
    fileCount: 1,
    durationMs: Date.now() - startTime,
  };
}
