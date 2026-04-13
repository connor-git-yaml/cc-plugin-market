/**
 * Graph Query MCP Tool 注册模块
 * 注册 5 个图谱查询工具：graph_query、graph_node、graph_path、graph_community、graph_god_nodes
 * 采用 lazy load 策略：首次调用时加载 _meta/graph.json，后续复用内存缓存
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GraphQueryEngine } from '../panoramic/graph/graph-query.js';
import { resolveGraphJsonPath } from '../panoramic/graph/graph-paths.js';

// ──────────────────────────────────────────────────────────
// 模块级缓存（按 projectRoot 多实例）
// ──────────────────────────────────────────────────────────

/** 按 projectRoot 缓存 GraphQueryEngine 实例 */
const engineCache = new Map<string, GraphQueryEngine>();

/**
 * 获取 GraphQueryEngine 实例（按 projectRoot 缓存，首次调用时从磁盘加载）
 * @param projectRoot - 目标项目根目录；未传入时使用 process.cwd()
 * @returns GraphQueryEngine 实例
 * @throws 文件不存在或格式错误时抛出 Error
 */
function getEngine(projectRoot?: string): GraphQueryEngine {
  const root = projectRoot ?? process.cwd();
  let engine = engineCache.get(root);
  if (!engine) {
    const graphPath = resolveGraphJsonPath(root);
    engine = GraphQueryEngine.loadFromFile(graphPath);
    engineCache.set(root, engine);
  }
  return engine;
}

/**
 * 清除缓存，下次调用时重新从磁盘加载
 * 供外部调用（如图谱更新后刷新缓存）
 */
export function reloadGraph(): void {
  engineCache.clear();
}

// ──────────────────────────────────────────────────────────
// 统一错误响应构建器
// ──────────────────────────────────────────────────────────

/**
 * 构建 MCP 错误响应
 * @param err - 错误对象或消息字符串
 * @param hint - 附加提示（可选）
 */
function buildErrorResponse(err: unknown, hint?: string) {
  const errorMessage = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: errorMessage,
          hint: hint ?? '运行 `spectra graph` 先生成图谱',
        }),
      },
    ],
    isError: true as const,
  };
}

// ──────────────────────────────────────────────────────────
// 工具注册主函数
// ──────────────────────────────────────────────────────────

/**
 * 向 MCP Server 注册所有图谱查询工具
 * @param server - McpServer 实例
 */
export function registerGraphTools(server: McpServer): void {

  // ─── 工具 1: graph_query — 关键词子图查询 ───
  server.tool(
    'graph_query',
    '查询知识图谱中与问题相关的模块和依赖关系子图。适用于探索代码库结构、查找相关模块时调用。',
    {
      question: z.string().describe('自然语言查询词，例如"认证模块"、"数据库连接"'),
      budget: z
        .number()
        .optional()
        .describe('返回节点数量上限（默认 50，≤ 0 时使用默认值）'),
      mode: z
        .enum(['bfs', 'dfs'])
        .optional()
        .describe('图遍历模式：bfs（广度优先，默认）或 dfs（深度优先，当前与 bfs 等效）'),
      depth: z
        .number()
        .optional()
        .describe('BFS 遍历深度（默认 2，即从匹配节点出发扩展 2 跳的邻居）'),
      projectRoot: z
        .string()
        .optional()
        .describe('目标项目根目录绝对路径（默认使用当前工作目录）'),
    },
    async ({ question, budget, mode, depth, projectRoot }) => {
      try {
        const engine = getEngine(projectRoot);
        const result = engine.query(question, { budget, mode, depth });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return buildErrorResponse(err);
      }
    },
  );

  // ─── 工具 2: graph_node — 单节点详情查询 ───
  server.tool(
    'graph_node',
    '精确查找节点详情和邻居，适用于已知节点 ID 或名称关键词的场景。id 参数优先于 keyword。',
    {
      id: z
        .string()
        .optional()
        .describe('节点 ID（精确匹配，优先级高于 keyword）'),
      keyword: z
        .string()
        .optional()
        .describe('节点名称关键词（模糊匹配 label，id 未传时使用）'),
      budget: z
        .number()
        .optional()
        .describe('邻居节点数量上限（默认返回全部邻居）'),
      projectRoot: z
        .string()
        .optional()
        .describe('目标项目根目录绝对路径（默认使用当前工作目录）'),
    },
    async ({ id, keyword, budget, projectRoot }) => {
      try {
        const engine = getEngine(projectRoot);
        const result = engine.getNode({ id, keyword, budget });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return buildErrorResponse(err);
      }
    },
  );

  // ─── 工具 3: graph_path — 最短路径查询 ───
  server.tool(
    'graph_path',
    '查找两个节点间的最短调用路径，适用于理解模块依赖链、追踪调用关系。',
    {
      source: z.string().describe('源节点 ID（路径起点）'),
      target: z.string().describe('目标节点 ID（路径终点）'),
      projectRoot: z
        .string()
        .optional()
        .describe('目标项目根目录绝对路径（默认使用当前工作目录）'),
    },
    async ({ source, target, projectRoot }) => {
      try {
        const engine = getEngine(projectRoot);
        const result = engine.findPath(source, target);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return buildErrorResponse(err);
      }
    },
  );

  // ─── 工具 4: graph_community — 社区节点查询 ───
  server.tool(
    'graph_community',
    '获取指定社区的节点列表，用于识别代码聚类和模块边界。需要先运行 spectra graph 生成含社区信息的图谱。',
    {
      communityId: z.string().describe('社区 ID（来自 graph.json 中节点的 metadata.community 字段）'),
      budget: z
        .number()
        .optional()
        .describe('返回节点数量上限（默认返回全部社区节点）'),
      projectRoot: z
        .string()
        .optional()
        .describe('目标项目根目录绝对路径（默认使用当前工作目录）'),
    },
    async ({ communityId, budget, projectRoot }) => {
      try {
        const engine = getEngine(projectRoot);
        const result = engine.getCommunity(communityId, budget);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return buildErrorResponse(err);
      }
    },
  );

  // ─── 工具 5: graph_god_nodes — 枢纽节点识别 ───
  server.tool(
    'graph_god_nodes',
    '识别知识图谱中度数最高的枢纽节点，用于定位过度耦合的核心模块、分析架构瓶颈。',
    {
      limit: z
        .number()
        .optional()
        .describe('返回节点数量（默认 10，按度数降序排列）'),
      projectRoot: z
        .string()
        .optional()
        .describe('目标项目根目录绝对路径（默认使用当前工作目录）'),
    },
    async ({ limit, projectRoot }) => {
      try {
        const engine = getEngine(projectRoot);
        const result = engine.getGodNodes(limit);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return buildErrorResponse(err);
      }
    },
  );
}
