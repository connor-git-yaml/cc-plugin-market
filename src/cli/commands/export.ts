/**
 * export 子命令 handler
 * 将知识图谱导出为 Obsidian Vault 或 HTML 交互式可视化
 * FR 追踪: FR-013、FR-014、FR-015、FR-016
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CLICommand } from '../utils/parse-args.js';
import type { GraphJSON } from '../../panoramic/graph/graph-types.js';
import { loadGraph, detectCommunities } from '../../panoramic/community/community-detector.js';
import { findGodNodes } from '../../panoramic/community/god-node-analyzer.js';
import { generateObsidianVault } from '../../panoramic/exporters/obsidian-exporter.js';
import { generateHtmlExport } from '../../panoramic/exporters/html-exporter.js';
import { resolveGraphJsonPath } from '../../panoramic/graph/graph-paths.js';

const EXPORT_HELP = `spectra export — 将知识图谱导出为可视化格式

用法:
  spectra export --format <obsidian|html> [--output-dir <dir>]

说明:
  读取 _meta/graph.json（需先运行 spectra graph），重建社区归属，
  导出为 Obsidian Vault（Markdown 文件集）或 HTML 交互式可视化。

选项:
  --format <obsidian|html>  导出格式（必填）
  --output-dir <dir>        输出目录（默认: {cwd}/_meta/export/）
  --help                    显示帮助信息

输出:
  obsidian: {output-dir}/index.md + communities/*.md + god-nodes/*.md
  html:     {output-dir}/graph.html

退出码:
  0  成功
  1  graph.json 缺失或图为空，或格式无效`;

/**
 * 执行 export 子命令
 *
 * 执行流程：
 * 1. 校验 exportFormat（obsidian 或 html）
 * 2. 读取 _meta/graph.json（缺失则 graceful exit）
 * 3. 校验图非空（空图则 graceful exit）
 * 4. 重建 communityResult（detectCommunities + loadGraph）
 * 5. 重建 godNodes（findGodNodes）
 * 6. 路由到 generateObsidianVault 或 generateHtmlExport
 * 7. 输出成功信息（文件数、耗时）
 *
 * @param command - 解析后的 CLI 命令对象
 */
export async function runExportCommand(command: CLICommand): Promise<void> {
  if (command.help) {
    console.log(EXPORT_HELP);
    return;
  }

  // 校验导出格式（FR-013）
  const { exportFormat } = command;
  if (exportFormat !== 'obsidian' && exportFormat !== 'html') {
    console.error(`[export] 无效的导出格式: ${exportFormat ?? '（未指定）'}`);
    console.error('[export] 可选格式: obsidian | html');
    console.error('[export] 用法: spectra export --format <obsidian|html>');
    process.exit(1);
    return;
  }

  // 确定输出目录（FR-014：默认 _meta/export/）
  const cwd = process.cwd();
  const outputDir = command.outputDir
    ? path.resolve(command.outputDir)
    : path.join(cwd, '_meta', 'export');

  // 读取 graph.json（FR-015：缺失则 graceful exit）
  const graphJsonPath = resolveGraphJsonPath(cwd);
  if (!fs.existsSync(graphJsonPath)) {
    console.error('[export] 找不到 _meta/graph.json');
    console.error('[export] 请先运行 spectra graph 构建知识图谱');
    process.exit(1);
    return;
  }

  let graphJson: GraphJSON;
  try {
    const raw = fs.readFileSync(graphJsonPath, 'utf-8');
    graphJson = JSON.parse(raw) as GraphJSON;
  } catch (err) {
    console.error(`[export] 读取 graph.json 失败: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  // 校验图非空（FR-015：空图 graceful exit，退出码非零）
  if (!graphJson.nodes || graphJson.nodes.length === 0) {
    console.error('[export] 图谱为空，无可导出内容');
    console.error('[export] 请先运行 spectra graph 并确保项目有源码可分析');
    process.exit(1);
    return;
  }

  // 重建社区归属（FR-016：detectCommunities 是确定性算法，结果等价）
  let communityResult;
  try {
    const graph = loadGraph(graphJson);
    communityResult = detectCommunities(graph);
    const godNodes = findGodNodes(graph, communityResult.nodeCommunityMap);

    // 路由到对应导出器
    let result;

    if (exportFormat === 'obsidian') {
      result = generateObsidianVault(graphJson, communityResult, godNodes, outputDir);
      console.log(`[export] Obsidian Vault 导出完成`);
    } else {
      result = generateHtmlExport(graphJson, communityResult, godNodes, outputDir);
      console.log(`[export] HTML 交互式可视化导出完成`);
    }

    console.log(`[export] 输出目录: ${outputDir}`);
    console.log(`[export] 生成文件数: ${result.fileCount}`);
    console.log(`[export] 耗时: ${result.durationMs} ms`);
  } catch (err) {
    console.error(`[export] 导出失败: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
