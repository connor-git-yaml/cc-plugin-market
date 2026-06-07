/**
 * Graph Query MCP Tool 注册模块
 * 注册 6 个图谱查询工具：graph_query、graph_node、graph_path、graph_community、graph_god_nodes、graph_hyperedges
 * 采用 lazy load 策略：首次调用时加载 _meta/graph.json，后续复用内存缓存
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GraphQueryEngine } from '../panoramic/graph/graph-query.js';
import type { GraphJSON } from '../panoramic/graph/graph-types.js';
import { resolveGraphJsonPath } from '../panoramic/graph/graph-paths.js';
import { buildErrorResponse, type ToolResult } from './lib/tool-response.js';
import { withTelemetry } from './lib/telemetry.js';

// ──────────────────────────────────────────────────────────
// 模块级缓存（按 projectRoot 多实例）
//
// Feature 155 T-002 升级：从 Map<projectRoot, Engine> 升级为 entry-based，
// 携带 graphPath / mtimeMs / sizeBytes，让 getEngine 在每次调用时校验
// graph.json 是否被外部重生成（baseline:collect 后 mtime/size 必变）。
// ──────────────────────────────────────────────────────────

/**
 * 缓存条目：保留 engine + graph 文件元数据，用于 stale detection。
 * mtime + size 复合校验防止"修改但 mtime 同秒"和"size 不变但 mtime 变化"两种 race。
 */
interface CachedEngineEntry {
  engine: GraphQueryEngine;
  graphPath: string;
  mtimeMs: number;
  sizeBytes: number;
}

/** 按 projectRoot 缓存 GraphQueryEngine 实例 + graph.json stat 元数据 */
const engineCache = new Map<string, CachedEngineEntry>();

/**
 * 获取 GraphQueryEngine 实例（按 projectRoot 缓存，含 stale 检测）。
 *
 * 每次调用都 stat graph.json，与缓存条目的 mtimeMs + sizeBytes 比对：
 * - 命中 + 一致 → 复用 engine
 * - miss / stale → loadFromFile 重新构造，更新 entry
 *
 * 这样 baseline:collect 重生 graph 后无需手动 reloadGraph()，下一次 tool 调用
 * 自动加载新 graph；同时不破坏已有调用路径（getEngine signature 不变）。
 *
 * @param projectRoot - 目标项目根目录；未传入时使用 process.cwd()
 * @returns GraphQueryEngine 实例
 * @throws 文件不存在或格式错误时抛出 Error
 */
function getEngine(projectRoot?: string): GraphQueryEngine {
  // 规范化为绝对路径：避免相对路径（如 "."）作为 cache key 时随进程 cwd 漂移，
  // 重新引入 F170e 要消除的 cwd 耦合。
  const root = resolve(projectRoot ?? process.cwd());
  const graphPath = resolveGraphJsonPath(root);
  const stat = statSync(graphPath);
  const cached = engineCache.get(root);
  if (
    cached !== undefined &&
    cached.graphPath === graphPath &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.sizeBytes === stat.size
  ) {
    return cached.engine;
  }
  // F170e：透传 root 作为 projectRoot，让 getCommunity 从目标项目的
  // specs/_meta/GRAPH_REPORT.md 读 cohesion，而非 MCP server 进程的 cwd。
  const engine = GraphQueryEngine.loadFromFile(graphPath, root);
  engineCache.set(root, {
    engine,
    graphPath,
    mtimeMs: stat.mtimeMs,
    sizeBytes: stat.size,
  });
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
// Feature 155 T-002 — 公开 helper：getCachedGraphData
//
// agent-context-tools.ts 通过本 helper 拿到 raw GraphJSON + 文件元数据，
// 以便 query-helpers.ts 构建反向邻接表 cache key（含 mtime / size）。
// ──────────────────────────────────────────────────────────

/**
 * 获取项目 graph.json 的反序列化对象 + 文件元数据。
 *
 * 行为约定：
 * - graph.json 不存在 → 返回 null（不抛错），调用方按 graph-not-built 处理
 * - 加载或解析失败 → 返回 null（不抛错），调用方按 graph-not-built 处理
 * - 命中缓存（mtime + size 一致）→ 返回缓存 engine 的 rawGraph
 * - cache stale → 自动重 load 后返回
 *
 * 返回的 graphData 是 Readonly<GraphJSON>，调用方禁止修改。
 *
 * @param projectRoot - 目标项目根目录；未传入时使用 process.cwd()
 */
export function getCachedGraphData(projectRoot?: string): {
  graphData: Readonly<GraphJSON>;
  graphPath: string;
  mtimeMs: number;
  sizeBytes: number;
} | null {
  try {
    const root = resolve(projectRoot ?? process.cwd());
    const graphPath = resolveGraphJsonPath(root);
    if (!existsSync(graphPath)) {
      return null;
    }
    const stat = statSync(graphPath);
    const engine = getEngine(root);
    return {
      graphData: engine.rawGraph,
      graphPath,
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
    };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────
// Feature 177 — 统一错误契约骨架（拆 engine 加载边界）
//
// 删除原本地 buildErrorResponse（返回旧 {error,hint} 契约），改用
// lib/tool-response.ts 的统一 {code,message,hint?} 契约。
// ──────────────────────────────────────────────────────────

/**
 * 6 个 graph 工具共享的执行骨架，拆分两类错误边界（spec AD-3 / Codex CRITICAL-1）：
 *   - getEngine 失败（缺图 statSync ENOENT / 坏图 loadFromFile 解析失败）→ graph-not-built
 *   - 加载成功后的查询期异常 → graph-query-failed
 *
 * 不靠 error message 内容猜分类（不稳定且可能泄露路径）。查询方法（query/getNode/
 * findPath/getCommunity/getGodNodes/getHyperedges）操作纯内存 rawGraph：getCommunity
 * 唯一的文件 IO（读 GRAPH_REPORT.md）已在 engine 内部 try/catch graceful 降级，不外抛，
 * 故查询期 err.message 不含路径，保留以利诊断（与删除前的本地实现行为一致）。
 *
 * success 路径由 query 回调直接构造 envelope（保持原 JSON.stringify 形态，byte 兼容 AC-5）。
 */
function runGraphTool(
  projectRoot: string | undefined,
  query: (engine: GraphQueryEngine) => ToolResult,
): ToolResult {
  let engine: GraphQueryEngine;
  try {
    engine = getEngine(projectRoot);
  } catch {
    return buildErrorResponse(
      'graph-not-built',
      '图谱未构建或加载失败',
      '运行 `spectra graph` 先生成图谱',
    );
  }
  try {
    return query(engine);
  } catch (err) {
    return buildErrorResponse('graph-query-failed', err instanceof Error ? err.message : String(err));
  }
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
    withTelemetry('graph_query', (args) => {
      const { question, budget, mode, depth, projectRoot } = args as {
        question: string;
        budget?: number;
        mode?: 'bfs' | 'dfs';
        depth?: number;
        projectRoot?: string;
      };
      return runGraphTool(projectRoot, (engine) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(engine.query(question, { budget, mode, depth })) }],
      }));
    }),
  );

  // ─── 工具 2: graph_node — 单节点详情查询 ───
  server.tool(
    'graph_node',
    '精确查找节点详情和邻居，适用于已知节点 ID 或名称关键词的场景。id 参数优先于 keyword。返回结果包含关联的语义边（references / conceptually_related_to / rationale_for）列表。',
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
    withTelemetry('graph_node', (args) => {
      const { id, keyword, budget, projectRoot } = args as {
        id?: string;
        keyword?: string;
        budget?: number;
        projectRoot?: string;
      };
      return runGraphTool(projectRoot, (engine) => {
        const result = engine.getNode({ id, keyword, budget });
        // 追加语义边列表（schema v2.0 新字段，向后兼容现有字段）
        const semanticEdges = engine.getSemanticEdges(result.node?.id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ ...result, semanticEdges }) }],
        };
      });
    }),
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
    withTelemetry('graph_path', (args) => {
      const { source, target, projectRoot } = args as {
        source: string;
        target: string;
        projectRoot?: string;
      };
      return runGraphTool(projectRoot, (engine) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(engine.findPath(source, target)) }],
      }));
    }),
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
    withTelemetry('graph_community', (args) => {
      const { communityId, budget, projectRoot } = args as {
        communityId: string;
        budget?: number;
        projectRoot?: string;
      };
      return runGraphTool(projectRoot, (engine) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(engine.getCommunity(communityId, budget)) }],
      }));
    }),
  );

  // ─── 工具 6: graph_hyperedges — 超边查询 ───
  server.tool(
    'graph_hyperedges',
    '查询知识图谱中的超边（Hyperedges），每条超边连接 3 个以上节点，表达命名流程或跨模块协作关系。支持按 label 模糊过滤和按节点 ID 精确过滤。',
    {
      label: z
        .string()
        .optional()
        .describe('按 hyperedge label 模糊匹配（子串匹配，大小写不敏感）。不传则不过滤。'),
      node_id: z
        .string()
        .optional()
        .describe('按节点 ID 精确匹配（返回 nodes 数组中含此 ID 的 hyperedge）。不传则不过滤。'),
      limit: z
        .number()
        .optional()
        .describe('返回超边数量上限（默认返回全部匹配的超边）'),
      projectRoot: z
        .string()
        .optional()
        .describe('目标项目根目录绝对路径（默认使用当前工作目录）'),
    },
    withTelemetry('graph_hyperedges', (args) => {
      const { label, node_id, limit, projectRoot } = args as {
        label?: string;
        node_id?: string;
        limit?: number;
        projectRoot?: string;
      };
      // 额外校验：label 或 node_id 为空字符串时返回明确错误（统一 invalid-input）
      if (label !== undefined && label.trim().length === 0) {
        return buildErrorResponse('invalid-input', 'label 参数不能为空字符串，请传入有效的过滤词或省略此参数');
      }
      if (node_id !== undefined && node_id.trim().length === 0) {
        return buildErrorResponse('invalid-input', 'node_id 参数不能为空字符串，请传入有效的节点 ID 或省略此参数');
      }
      return runGraphTool(projectRoot, (engine) => {
        const hyperedges = engine.getHyperedges({ label, nodeId: node_id, limit });
        const filtered = (label !== undefined && label.length > 0) || (node_id !== undefined && node_id.length > 0);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ hyperedges, total: hyperedges.length, filtered }, null, 2),
            },
          ],
        };
      });
    }),
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
    withTelemetry('graph_god_nodes', (args) => {
      const { limit, projectRoot } = args as { limit?: number; projectRoot?: string };
      return runGraphTool(projectRoot, (engine) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(engine.getGodNodes(limit)) }],
      }));
    }),
  );
}
