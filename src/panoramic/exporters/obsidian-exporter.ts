/**
 * Obsidian Vault 导出器
 * 纯函数管道：GraphJSON + CommunityResult + GodNode[] → Markdown 文件集
 *
 * 遵循 Graphify 纯函数管道设计模式：无类封装，无实例状态
 * FR 追踪: FR-001 ~ FR-005、FR-016、FR-019
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GraphJSON } from '../graph/graph-types.js';
import type { CommunityResult, CommunityInfo } from '../community/community-detector.js';
import type { GodNode } from '../community/god-node-analyzer.js';
import type { ExportResult, ObsidianPage } from './export-types.js';

// ============================================================
// sanitizeFilename — FR-005
// ============================================================

/**
 * FNV-1a 32-bit 哈希（纯 JS 实现，无 crypto 依赖）
 * 用于长文件名截断时生成唯一后缀，降低碰撞概率
 */
function fnv1a32(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // 模拟 32-bit 无符号整数乘法
    hash = (hash * 16777619) >>> 0;
  }
  return hash;
}

/**
 * 对文件名执行 Obsidian 安全 sanitize
 *
 * 规则：
 * 1. 替换 / \ : * ? " < > | 和空格为 -
 * 2. 合并连续 - 为单个 -
 * 3. 去除首尾 -
 * 4. 长度 > 200 时截取前 195 字符 + FNV-1a 4 字符哈希
 *
 * @param name - 原始文件名（通常是节点 ID 或 label）
 * @returns 安全的文件名字符串（不含扩展名）
 */
export function sanitizeFilename(name: string): string {
  if (!name) return '';

  // 替换特殊字符和空格为 -
  let result = name.replace(/[/\\:*?"<>|\s]/g, '-');

  // 合并连续 - 为单个 -
  result = result.replace(/-+/g, '-');

  // 去除首尾 -
  result = result.replace(/^-+|-+$/g, '');

  // 超过 200 字符：截取前 195 + FNV-1a 4 字符哈希
  if (result.length > 200) {
    const hash = fnv1a32(name).toString(16).padStart(8, '0').slice(0, 4);
    result = result.slice(0, 195) + hash;
  }

  return result;
}

// ============================================================
// buildIndexPage — FR-001、FR-004
// ============================================================

/**
 * 生成 index.md 总览页内容（纯函数）
 * 包含图谱统计、社区列表、God Node 列表
 *
 * @param graphJson - 图谱数据
 * @param communityResult - 社区检测结果
 * @param godNodes - God Node 列表
 * @returns ObsidianPage（relativePath 固定为 index.md）
 */
export function buildIndexPage(
  graphJson: GraphJSON,
  communityResult: CommunityResult,
  godNodes: GodNode[],
): ObsidianPage {
  const { nodeCount, edgeCount } = graphJson.graph;
  const communityCount = communityResult.communities.length;

  const lines: string[] = [
    '# 知识图谱总览',
    '',
    '## 统计',
    '',
    `- **节点总数**: ${nodeCount}`,
    `- **边总数**: ${edgeCount}`,
    `- **社区数量**: ${communityCount}`,
    '',
  ];

  // 社区列表
  if (communityResult.communities.length > 0) {
    lines.push('## 社区列表', '');
    for (const community of communityResult.communities) {
      lines.push(`- [[community-${community.id}]] — ${community.nodes.length} 个节点，内聚度 ${community.cohesion}`);
    }
    lines.push('');
  }

  // God Node 列表
  if (godNodes.length > 0) {
    lines.push('## God Nodes（高影响力节点）', '');
    for (const godNode of godNodes) {
      const sanitized = sanitizeFilename(godNode.label);
      lines.push(`- [[${sanitized}]] — 度数 ${godNode.degree}，主要关系 ${godNode.primaryRelation}`);
    }
    lines.push('');
  }

  return {
    relativePath: 'index.md',
    content: lines.join('\n'),
  };
}

// ============================================================
// buildCommunityPage — FR-002、FR-004
// ============================================================

/**
 * 生成单个社区页内容（纯函数）
 *
 * @param communityId - 社区 ID
 * @param communityInfo - 社区元数据
 * @param nodeIdToLabel - 节点 ID → label 映射（用于生成双向链接）
 * @param communityResult - 社区检测结果（用于跨社区链接）
 * @param graphJson - 图谱数据（用于查找跨社区边）
 * @returns ObsidianPage（relativePath 为 communities/community-{id}.md）
 */
export function buildCommunityPage(
  communityId: number,
  communityInfo: CommunityInfo,
  nodeIdToLabel: Map<string, string>,
  communityResult: CommunityResult,
  graphJson: GraphJSON,
): ObsidianPage {
  // 节点 ID 查 label，不存在时回退到 ID 本身
  const nodeLabel = (id: string): string => nodeIdToLabel.get(id) ?? id;
  const memberSet = new Set(communityInfo.nodes);

  const lines: string[] = [
    `# 社区 ${communityId}`,
    '',
    '## 基本信息',
    '',
    `- **社区 ID**: ${communityId}`,
    `- **节点数量**: ${communityInfo.nodes.length}`,
    `- **内聚度评分**: ${communityInfo.cohesion}`,
    '',
  ];

  // 核心节点 Top 3
  if (communityInfo.coreNodes.length > 0) {
    lines.push('## 核心节点（Top 3）', '');
    for (const nodeId of communityInfo.coreNodes.slice(0, 3)) {
      const label = nodeLabel(nodeId);
      lines.push(`- [[${sanitizeFilename(label)}]]`);
    }
    lines.push('');
  }

  // 社区内所有节点
  lines.push('## 所有节点', '');
  for (const nodeId of communityInfo.nodes) {
    const label = nodeLabel(nodeId);
    lines.push(`- [[${sanitizeFilename(label)}]]`);
  }
  lines.push('');

  // 跨社区链接（FR-002）
  const crossCommunityIds = new Set<number>();
  for (const edge of graphJson.links) {
    const srcInComm = memberSet.has(edge.source);
    const tgtInComm = memberSet.has(edge.target);
    if (srcInComm && !tgtInComm) {
      const otherId = communityResult.nodeCommunityMap.get(edge.target);
      if (otherId !== undefined && otherId !== communityId) crossCommunityIds.add(otherId);
    } else if (!srcInComm && tgtInComm) {
      const otherId = communityResult.nodeCommunityMap.get(edge.source);
      if (otherId !== undefined && otherId !== communityId) crossCommunityIds.add(otherId);
    }
  }
  if (crossCommunityIds.size > 0) {
    lines.push('## 跨社区链接', '');
    for (const otherId of [...crossCommunityIds].sort((a, b) => a - b)) {
      lines.push(`- [[community-${otherId}]]`);
    }
    lines.push('');
  }

  return {
    relativePath: `communities/community-${communityId}.md`,
    content: lines.join('\n'),
  };
}

// ============================================================
// buildGodNodePage — FR-003、FR-004、FR-019
// ============================================================

/**
 * 生成单个 God Node 页内容（纯函数）
 *
 * @param godNode - God Node 描述
 * @param communityResult - 社区检测结果（用于查社区归属）
 * @param graphJson - 图谱数据（用于查邻居）
 * @param nodeIdToLabel - 节点 ID → label 映射
 * @returns ObsidianPage（relativePath 为 god-nodes/{sanitized-name}.md）
 */
export function buildGodNodePage(
  godNode: GodNode,
  communityResult: CommunityResult,
  graphJson: GraphJSON,
  nodeIdToLabel: Map<string, string>,
): ObsidianPage {
  const sanitizedName = sanitizeFilename(godNode.label);

  // 查找社区归属
  const communityId = communityResult.nodeCommunityMap.get(godNode.id) ?? godNode.communityId;
  const communityLink = communityId >= 0 ? `[[community-${communityId}]]` : '未分类';

  // 查找直接邻居（在 graphJson 中遍历边）
  const neighbors: string[] = [];
  for (const edge of graphJson.links) {
    if (edge.source === godNode.id && edge.target !== godNode.id) {
      neighbors.push(edge.target);
    } else if (edge.target === godNode.id && edge.source !== godNode.id) {
      neighbors.push(edge.source);
    }
  }
  // 去重
  const uniqueNeighbors = [...new Set(neighbors)];

  const lines: string[] = [
    `# ${godNode.label}`,
    '',
    '## 基本信息',
    '',
    `- **节点 ID**: ${godNode.id}`,
    `- **度数**: ${godNode.degree}`,
    `- **主要关系类型**: ${godNode.primaryRelation}`,
    `- **所属社区**: ${communityLink}`,
    '',
  ];

  // 直接邻居列表
  lines.push('## 直接依赖关系', '');
  if (uniqueNeighbors.length === 0) {
    lines.push('无直接依赖关系');
  } else {
    for (const neighborId of uniqueNeighbors) {
      const label = nodeIdToLabel.get(neighborId) ?? neighborId;
      lines.push(`- [[${sanitizeFilename(label)}]]`);
    }
  }
  lines.push('');

  // 条件：metadata.sourceTarget 存在时生成额外链接（FR-019）
  const nodeInfo = graphJson.nodes.find((n) => n.id === godNode.id);
  if (nodeInfo?.metadata.sourceTarget && typeof nodeInfo.metadata.sourceTarget === 'string') {
    lines.push('## 源文件', '');
    lines.push(`- \`${nodeInfo.metadata.sourceTarget}\``);
    lines.push('');
  }

  // 条件：metadata.relatedFiles 存在时生成额外链接（FR-019）
  if (nodeInfo?.metadata.relatedFiles && Array.isArray(nodeInfo.metadata.relatedFiles)) {
    lines.push('## 相关文件', '');
    for (const file of nodeInfo.metadata.relatedFiles as string[]) {
      lines.push(`- \`${file}\``);
    }
    lines.push('');
  }

  return {
    relativePath: `god-nodes/${sanitizedName}.md`,
    content: lines.join('\n'),
  };
}

// ============================================================
// generateObsidianVault — FR-001 ~ FR-005、FR-016
// ============================================================

/**
 * 生成完整 Obsidian Vault（写盘入口）
 * 纯函数管道：graphJson + communityResult + godNodes → 文件产物
 *
 * @param graphJson - 图谱数据
 * @param communityResult - 社区检测结果（含 nodeCommunityMap）
 * @param godNodes - God Node 列表
 * @param outputDir - 输出目录（绝对路径或相对路径）
 * @returns ExportResult（文件列表、数量、耗时）
 */
export function generateObsidianVault(
  graphJson: GraphJSON,
  communityResult: CommunityResult,
  godNodes: GodNode[],
  outputDir: string,
): ExportResult {
  const startTime = Date.now();

  // 空图短路返回
  if (graphJson.nodes.length === 0) {
    return { files: [], fileCount: 0, durationMs: Date.now() - startTime };
  }

  // 构建 nodeIdToLabel Map（O(n) 一次性构建）
  const nodeIdToLabel = new Map<string, string>();
  for (const node of graphJson.nodes) {
    nodeIdToLabel.set(node.id, node.label);
  }

  // 收集所有页面
  const pages: ObsidianPage[] = [];

  // index.md
  pages.push(buildIndexPage(graphJson, communityResult, godNodes));

  // communities/*.md
  for (const community of communityResult.communities) {
    pages.push(buildCommunityPage(community.id, community, nodeIdToLabel, communityResult, graphJson));
  }

  // god-nodes/*.md
  for (const godNode of godNodes) {
    pages.push(buildGodNodePage(godNode, communityResult, graphJson, nodeIdToLabel));
  }

  // 写盘：创建目录并写文件
  const writtenFiles: string[] = [];
  for (const page of pages) {
    const absolutePath = path.resolve(outputDir, page.relativePath);
    const dir = path.dirname(absolutePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(absolutePath, page.content, 'utf-8');
    writtenFiles.push(absolutePath);
  }

  return {
    files: writtenFiles,
    fileCount: writtenFiles.length,
    durationMs: Date.now() - startTime,
  };
}
