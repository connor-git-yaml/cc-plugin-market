/**
 * GRAPH_REPORT.md 渲染器
 * 将社区分析结果渲染为人类可读的 Markdown 架构洞察报告
 * 内容使用中文，节点名/路径保持英文
 */

import type { CommunityInfo } from './community-detector.js';
import type { GodNode } from './god-node-analyzer.js';
import type { SurprisingEdge } from './surprising-edges.js';

// ============================================================
// 类型定义
// ============================================================

/** 图统计信息 */
export interface GraphStats {
  /** 节点总数 */
  nodeCount: number;
  /** 边总数 */
  edgeCount: number;
  /** 社区数 */
  communityCount: number;
  /** 孤立节点列表（度数 0-1） */
  isolatedNodes: string[];
}

/** 报告生成输入 */
export interface ReportInput {
  stats: GraphStats;
  communities: CommunityInfo[];
  godNodes: GodNode[];
  surprisingEdges: SurprisingEdge[];
}

// ============================================================
// 公共函数
// ============================================================

/**
 * 生成 GRAPH_REPORT.md 内容
 */
export function generateReport(input: ReportInput): string {
  const { stats, communities, godNodes, surprisingEdges } = input;
  const sections: string[] = [];

  // 标题
  sections.push(`# 架构图谱分析报告`);
  sections.push('');
  sections.push(`> 自动生成于 ${new Date().toISOString().split('T')[0]}`);
  sections.push('');

  // 概述
  sections.push('## 概述');
  sections.push('');
  sections.push(`| 指标 | 数值 |`);
  sections.push(`|------|------|`);
  sections.push(`| 节点 | ${stats.nodeCount} |`);
  sections.push(`| 边 | ${stats.edgeCount} |`);
  sections.push(`| 社区 | ${stats.communityCount} |`);
  sections.push(`| 孤立节点 | ${stats.isolatedNodes.length} |`);
  sections.push('');

  // God Nodes
  sections.push('## God Nodes');
  sections.push('');
  if (godNodes.length === 0) {
    sections.push('未检测到度数异常高的节点。');
  } else {
    sections.push('度数显著高于平均值（> 均值 + 2σ）的核心枢纽节点：');
    sections.push('');
    sections.push('| 节点 | 度数 | 主要关系类型 | 社区 |');
    sections.push('|------|------|-------------|------|');
    for (const node of godNodes) {
      sections.push(`| \`${node.label}\` | ${node.degree} | ${node.primaryRelation} | ${node.communityId} |`);
    }
  }
  sections.push('');

  // 社区列表
  sections.push('## 社区列表');
  sections.push('');
  if (communities.length === 0) {
    sections.push('未检测到有效社区。');
  } else {
    sections.push('| 社区 ID | 节点数 | 内聚度 | 核心节点 Top 3 |');
    sections.push('|---------|--------|--------|---------------|');
    for (const comm of communities) {
      const coreStr = comm.coreNodes.map(n => `\`${n}\``).join(', ');
      sections.push(`| ${comm.id} | ${comm.nodes.length} | ${comm.cohesion.toFixed(3)} | ${coreStr} |`);
    }
  }
  sections.push('');

  // Surprising Connections
  sections.push('## Surprising Connections');
  sections.push('');
  if (surprisingEdges.length === 0) {
    sections.push('未检测到跨社区异常连接。');
  } else {
    sections.push('跨社区或低置信度的意外关系：');
    sections.push('');
    sections.push('| Source | Target | 关系类型 | 跨社区 | 置信度 | 评分 |');
    sections.push('|--------|--------|---------|--------|--------|------|');
    for (const edge of surprisingEdges) {
      const cross = edge.crossCommunity ? '是' : '否';
      sections.push(`| \`${edge.source}\` | \`${edge.target}\` | ${edge.relation} | ${cross} | ${edge.confidence} | ${edge.score} |`);
    }
  }
  sections.push('');

  // Knowledge Gaps
  sections.push('## Knowledge Gaps');
  sections.push('');
  if (stats.isolatedNodes.length === 0) {
    sections.push('无孤立节点，知识图谱覆盖良好。');
  } else {
    sections.push(`检测到 ${stats.isolatedNodes.length} 个孤立节点（度数 0-1），可能存在文档覆盖不足：`);
    sections.push('');
    const displayed = stats.isolatedNodes.slice(0, 20);
    for (const node of displayed) {
      sections.push(`- \`${node}\``);
    }
    if (stats.isolatedNodes.length > 20) {
      sections.push(`- ...及其他 ${stats.isolatedNodes.length - 20} 个节点`);
    }
  }
  sections.push('');

  return sections.join('\n');
}
