/**
 * 社区分析模块统一导出入口
 * 提供社区检测、God Node 识别、异常边发现和报告生成能力
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GraphJSON } from '../graph/graph-types.js';
import { enrichNodeDegrees } from '../graph/graph-builder.js';
import { loadGraph, detectCommunities } from './community-detector.js';
import { findGodNodes } from './god-node-analyzer.js';
import { findSurprisingEdges } from './surprising-edges.js';
import { generateReport } from './graph-report-generator.js';
import type { GraphStats } from './graph-report-generator.js';

// 类型导出
export type { CommunityInfo, CommunityResult, DetectOptions } from './community-detector.js';
export type { GodNode } from './god-node-analyzer.js';
export type { SurprisingEdge, SurprisingEdgesOptions } from './surprising-edges.js';
export type { GraphStats, ReportInput } from './graph-report-generator.js';

// 函数导出
export { loadGraph, detectCommunities } from './community-detector.js';
export { findGodNodes } from './god-node-analyzer.js';
export { findSurprisingEdges } from './surprising-edges.js';
export { generateReport } from './graph-report-generator.js';

// ============================================================
// 入口函数：完整分析管道
// ============================================================

/** 分析管道选项 */
export interface CommunityAnalysisOptions {
  /** 最小社区节点数过滤 */
  minSize?: number;
  /** betweenness 采样的源节点数（默认 1000） */
  sampleSize?: number;
}

/**
 * 执行完整社区分析管道并写入报告
 * 供 batch-orchestrator 和 CLI 命令调用
 *
 * @param graphJson - GraphJSON 数据
 * @param outputDir - 输出目录（报告写入 {outputDir}/_meta/GRAPH_REPORT.md）
 * @param options - 分析选项
 * @returns 报告文件路径
 */
export function runCommunityAnalysis(
  graphJson: GraphJSON,
  outputDir: string,
  options?: CommunityAnalysisOptions,
): string {
  // 加载图
  const graph = loadGraph(graphJson);

  // 社区检测
  const { communities, nodeCommunityMap } = detectCommunities(graph, {
    minSize: options?.minSize,
  });

  // God Node 识别
  const godNodes = findGodNodes(graph, nodeCommunityMap);

  // 将 degree 写入 graphJson 节点 metadata（供 hook 脚本读取）
  enrichNodeDegrees(graphJson, godNodes);

  // 异常边发现
  const surprisingEdges = findSurprisingEdges(graph, nodeCommunityMap, {
    sampleSize: options?.sampleSize,
  });

  // 统计孤立节点
  const isolatedNodes: string[] = [];
  graph.forEachNode((node) => {
    if (graph.degree(node) <= 1) {
      isolatedNodes.push(node);
    }
  });

  // 生成报告
  const stats: GraphStats = {
    nodeCount: graph.order,
    edgeCount: graph.size,
    communityCount: communities.length,
    isolatedNodes,
  };

  const report = generateReport({ stats, communities, godNodes, surprisingEdges });

  // 写入文件
  const metaDir = path.join(outputDir, '_meta');
  fs.mkdirSync(metaDir, { recursive: true });
  const reportPath = path.join(metaDir, 'GRAPH_REPORT.md');
  fs.writeFileSync(reportPath, report, 'utf-8');

  return reportPath;
}
