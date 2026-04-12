/**
 * community 子命令 handler
 * 基于已有 graph.json 执行社区检测并生成 GRAPH_REPORT.md
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CLICommand } from '../utils/parse-args.js';
import type { GraphJSON } from '../../panoramic/graph/graph-types.js';
import { runCommunityAnalysis } from '../../panoramic/community/index.js';
import { loadGraph, detectCommunities } from '../../panoramic/community/community-detector.js';
import { writeKnowledgeGraph } from '../../panoramic/graph/index.js';

const COMMUNITY_HELP = `spectra community — 社区检测与架构洞察分析

用法:
  spectra community [--min-size <N>] [--output-dir <dir>]

说明:
  读取 _meta/graph.json，执行 Louvain 社区检测、God Node 识别和
  跨社区异常边发现，生成 _meta/GRAPH_REPORT.md 架构洞察报告。

  需要先运行 \`spectra graph\` 生成知识图谱。

选项:
  --min-size <N>      最小社区节点数过滤（默认不过滤）
  --output-dir <dir>  指定输出根目录（默认：{cwd}/specs）
  --help              显示帮助信息

输出:
  {output-dir}/_meta/GRAPH_REPORT.md

退出码:
  0  成功
  1  分析失败`;

/**
 * 执行 community 子命令
 */
export async function runCommunityCommand(command: CLICommand): Promise<void> {
  if (command.help) {
    console.log(COMMUNITY_HELP);
    return;
  }

  const outputDir = command.outputDir ?? path.join(process.cwd(), 'specs');
  const graphPath = path.join(outputDir, '_meta', 'graph.json');

  // 检查 graph.json 是否存在
  if (!fs.existsSync(graphPath)) {
    console.error(
      '[community] graph.json 不存在，请先运行 `spectra graph` 生成知识图谱',
    );
    process.exitCode = 1;
    return;
  }

  // 读取并验证 graph.json
  let graphJson: GraphJSON;
  try {
    const content = fs.readFileSync(graphPath, 'utf-8');
    graphJson = JSON.parse(content) as GraphJSON;

    if (!Array.isArray(graphJson.nodes) || !Array.isArray(graphJson.links)) {
      console.error('[community] graph.json 格式异常：缺少 nodes 或 links 数组');
      process.exitCode = 1;
      return;
    }
  } catch (err) {
    console.error(
      `[community] graph.json 解析失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
    return;
  }

  // 空图处理
  if (graphJson.nodes.length === 0) {
    console.log('[community] graph.json 中无节点，跳过分析');
    return;
  }

  try {
    const reportPath = runCommunityAnalysis(graphJson, outputDir, {
      minSize: command.communityMinSize,
    });
    console.log(`✓ GRAPH_REPORT.md 已生成: ${reportPath}`);

    // 将社区 ID 持久化回 graph.json 节点 metadata
    // detectCommunities 是确定性算法（Louvain 固定 seed），两次调用结果一致
    const g = loadGraph(graphJson);
    const { nodeCommunityMap } = detectCommunities(g, { minSize: command.communityMinSize });
    for (const node of graphJson.nodes) {
      const communityId = nodeCommunityMap.get(node.id);
      if (communityId !== undefined) {
        node.metadata['community'] = String(communityId);
      }
    }
    writeKnowledgeGraph(graphJson, outputDir);
    console.log(`✓ graph.json 社区 ID 已更新`);
  } catch (err) {
    console.error(
      `[community] 社区分析失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}
