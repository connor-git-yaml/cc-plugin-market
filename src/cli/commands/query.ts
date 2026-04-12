/**
 * query 子命令 handler
 * 执行知识图谱关键词查询，支持 text 和 json 两种输出格式
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { CLICommand } from '../utils/parse-args.js';
import { GraphQueryEngine } from '../../panoramic/graph/graph-query.js';
import type { QueryResult } from '../../panoramic/graph/graph-query.js';

const QUERY_HELP = `spectra query — 查询知识图谱

用法:
  spectra query "<问题>" [--budget <N>] [--format json|text]

说明:
  基于 _meta/graph.json 知识图谱执行关键词子图查询，
  返回与查询词相关的模块节点及其依赖关系。

选项:
  --budget <N>   返回节点数量上限（默认 50）
  --format       输出格式: text（人类可读，默认）或 json（机器可解析）
  --help         显示帮助信息

示例:
  spectra query "认证模块"
  spectra query "数据库连接" --budget 20 --format json
  spectra query "CLI 命令" --format text

退出码:
  0  成功
  1  查询失败（_meta/graph.json 不存在或解析失败）`;

/**
 * 执行 query 子命令
 * 加载图谱 → 执行查询 → 按格式输出结果
 *
 * @param command - 解析后的 CLI 命令对象
 */
export async function runQueryCommand(command: CLICommand): Promise<void> {
  if (command.help) {
    console.log(QUERY_HELP);
    return;
  }

  const question = command.queryQuestion;
  const budget = command.budget;
  const format = command.format ?? 'text';

  // 校验查询词
  if (!question || question.trim().length === 0) {
    console.error('[query] 错误：请提供查询词，例如: spectra query "认证模块"');
    console.error('运行 spectra query --help 查看帮助');
    process.exitCode = 1;
    return;
  }

  // 检查 _meta/graph.json 是否存在
  const graphPath = join(process.cwd(), '_meta', 'graph.json');
  if (!existsSync(graphPath)) {
    console.error(`[query] 错误：图谱文件不存在：${graphPath}`);
    console.error('提示：请先运行 `spectra graph` 命令生成知识图谱。');
    process.exitCode = 1;
    return;
  }

  // 加载图谱并执行查询
  let engine: GraphQueryEngine;
  try {
    engine = GraphQueryEngine.loadFromFile(graphPath);
  } catch (err) {
    console.error(
      `[query] 加载图谱失败：${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
    return;
  }

  const result = engine.query(question, { budget });

  // 按格式输出结果
  if (format === 'json') {
    // JSON 格式：保证可通过 JSON.parse 解析（满足 SC-008）
    console.log(JSON.stringify(result, null, 2));
  } else {
    // text 格式：生成人类可读摘要
    outputTextFormat(question, result);
  }
}

/**
 * 以人类可读文本格式输出查询结果
 * @param question - 原始查询词
 * @param result - 查询结果
 */
function outputTextFormat(
  question: string,
  result: QueryResult,
): void {
  console.log(`\n查询: "${question}"`);
  console.log(`${result.summary}\n`);

  if (result.nodes.length === 0) {
    console.log('（未找到匹配节点）');
    return;
  }

  // 输出节点列表
  console.log('匹配节点:');
  for (const node of result.nodes) {
    const sourcePath = (node.metadata['sourcePath'] as string | undefined) ?? '';
    const pathInfo = sourcePath ? ` (${sourcePath})` : '';
    console.log(`  [${node.kind}] ${node.label}${pathInfo}`);
  }

  // 输出关系摘要（若有边）
  if (result.edges.length > 0) {
    console.log(`\n关系 (共 ${result.edges.length} 条):`);
    // 最多展示前 10 条边，避免输出过长
    const displayEdges = result.edges.slice(0, 10);
    for (const edge of displayEdges) {
      console.log(`  ${edge.source} --[${edge.relation}]--> ${edge.target} (${edge.confidence})`);
    }
    if (result.edges.length > 10) {
      console.log(`  ... 还有 ${result.edges.length - 10} 条关系（使用 --format json 查看全部）`);
    }
  }

  if (result.truncated) {
    console.log(`\n注意：结果已截断，原始匹配节点数：${result.totalMatches}`);
    console.log('使用 --budget <N> 调整返回节点数量上限。');
  }
}
