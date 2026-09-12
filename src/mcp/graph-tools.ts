/**
 * Graph Query MCP Tool 注册模块
 * 注册 6 个图谱查询工具：graph_query、graph_node、graph_path、graph_community、graph_god_nodes、graph_hyperedges
 * 采用 lazy load 策略：首次调用时加载 _meta/graph.json，后续复用内存缓存
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GraphQueryEngine } from '../panoramic/graph/graph-query.js';
import {
  loadEngineCached,
  clearEngineCache,
  toGraphEvidence,
  type LoadedGraphEvidence,
} from '../panoramic/graph/engine-cache.js';
import { resolveGraphJsonPath } from '../panoramic/graph/graph-paths.js';
import { buildErrorResponse, type ToolResult } from './lib/tool-response.js';
import { withTelemetry } from './lib/telemetry.js';

// ──────────────────────────────────────────────────────────
// engine 获取：共享 `panoramic/graph/engine-cache`（F280 收敛前本文件自持一份 entry-based Map；
// F155 T-002 引入的 mtime+size 复合失效判据原样迁入共享模块）
// ──────────────────────────────────────────────────────────

/**
 * 获取 GraphQueryEngine 实例（F280：改走共享 `panoramic/graph/engine-cache`）。
 * 失效判据（每次 stat graph.json，mtime + size 复合）与此前一致；此前本文件自持一份 Map，
 * 与 panoramic/qa 的零失效 Map 并存——现在两侧共用一份。
 *
 * @param projectRoot - 目标项目根目录；未传入时使用 process.cwd()
 * @throws 文件不存在或格式错误时抛出 Error
 */
function getEngine(projectRoot?: string): GraphQueryEngine {
  // 规范化为绝对路径：避免相对路径（如 "."）作为 cache key 时随进程 cwd 漂移（F170e）。
  const root = resolve(projectRoot ?? process.cwd());
  const graphPath = resolveGraphJsonPath(root);
  // F170e：透传 root 作为 projectRoot，让 getCommunity 从目标项目的 GRAPH_REPORT.md 读 cohesion。
  return loadEngineCached(graphPath, root).engine;
}

/**
 * 清除缓存，下次调用时重新从磁盘加载
 * 供外部调用（如图谱更新后刷新缓存）
 */
export function reloadGraph(): void {
  clearEngineCache();
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
export function getCachedGraphData(projectRoot?: string): LoadedGraphEvidence | null {
  try {
    const root = resolve(projectRoot ?? process.cwd());
    const graphPath = resolveGraphJsonPath(root);
    if (!existsSync(graphPath)) {
      return null;
    }
    // F280：元数据取自验证这份 engine 的那次 stat（与 graphData 同源）。此前先 stat 再取 engine 两步，
    // 两步之间文件被重写会让元数据描述另一份文件。
    return toGraphEvidence(loadEngineCached(graphPath, root));
  } catch (err) {
    // Feature 193 FR-006：graph-format-stale 必须显式上抛，不得静默退化为 null
    // （否则 impact/context/detect_changes 把"旧绝对格式图"误报成"缺图 graph-not-built"，
    // agent 无法区分应重建 vs 应首次构建）。其余加载失败仍按既有契约返回 null。
    if (err instanceof Error && err.message.includes('graph-format-stale')) {
      throw err;
    }
    return null;
  }
}

/** 判定一个 caught error 是否为加载期 graph-format-stale 信号（Feature 193 FR-006） */
export function isGraphFormatStaleError(err: unknown): err is Error {
  return err instanceof Error && err.message.includes('graph-format-stale');
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
  } catch (err) {
    // Feature 193 FR-006：旧绝对格式图（copy 自其他 worktree）必须给明确 stale 信号，
    // 不得静默退化为通用 graph-not-built（否则 agent 不知道是格式问题还是缺图）。
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('graph-format-stale')) {
      return buildErrorResponse(
        'graph-format-stale',
        msg,
        '当前 worktree 的图为旧绝对路径格式（可能 copy 自主仓/其他 worktree）。优先运行 `spectra batch --mode graph-only`（纯 AST · 零 LLM · <2min）在当前 worktree 重建图；或 `spectra batch` 重建完整图。',
      );
    }
    return buildErrorResponse(
      'graph-not-built',
      '图谱未构建或加载失败',
      '优先运行 `spectra batch --mode graph-only` 快速建图（纯 AST · 零 LLM · 无需认证 · <2min）；需要完整 spec 关系图再跑 `spectra batch`',
    );
  }
  try {
    return query(engine);
  } catch (err) {
    return buildErrorResponse('graph-query-failed', err instanceof Error ? err.message : String(err));
  }
}

/**
 * F271 FR-011 — graph_hyperedges 空结果的诚实说明。
 *
 * 空数组的两种成因需要区分：过滤条件太窄 vs 本图压根没有超边数据。后者是常态。
 *
 * 【文案口径】只说「启用条件」，不说「满足即有」——启用条件是必要非充分：
 * 即使 full mode + opt-in + 有设计文档来源，batch 触发 budget gate 降级
 * （batch-orchestrator 的 `!budgetSkipEnrichmentAll` 闸）或 LLM 没提取到协作面时，
 * 超边依然为空。设计文档来源也不限于 `docs/project/`：source-discovery 把根 README、
 * 已产出的 module spec、project-context 都算作来源，新项目首次 batch 即可满足。
 *
 * 导出为纯函数，便于直接单测而不必驱动完整 MCP handler。
 *
 * @param filtered - 本次调用是否带了 label / node_id 过滤条件
 */
export function describeEmptyHyperedges(filtered: boolean): string {
  return filtered
    ? '过滤条件（label / node_id）未匹配到任何超边；若怀疑本图完全没有超边数据，请去掉过滤参数重试。'
    : '本图不包含超边数据。hyperedges 的启用条件是：(1) full mode（`spectra batch --mode full`）；(2) 显式 opt-in（`--hyperedges` 或环境变量 `SPECTRA_HYPEREDGES_ENABLED=true`）；(3) 存在任一设计文档来源（根 README 即可，也含 docs/project、已产出的 module spec、project-context）。注意这些条件是必要非充分——即使全部满足，batch 触发预算降级或 LLM 未提取到跨模块协作面时，超边仍为空。空结果不代表本项目无跨模块协作。';
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
    `查询知识图谱中与问题相关的模块和依赖关系子图，探索代码库结构、查找相关模块。

Use when:
- 不清楚结构、想按关键词找相关模块子图
- 需要某主题（如"认证"）的依赖关系概览

Typical chained usage:
- batch → graph_query → graph_node（子图定位后看单节点详情）`,
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
    `精确查找节点详情和邻居，适用于已知节点 ID 或名称关键词的场景。id 优先于 keyword，返回含语义边（references / conceptually_related_to / rationale_for）列表。

Use when:
- 已知 symbol id 或 label 关键词，要看其邻居与语义边
- graph_query 命中后深入单节点

Typical chained usage:
- graph_query → graph_node → graph_path（节点详情后查调用路径）`,
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
    `查找两个节点间的最短调用路径，适用于理解模块依赖链、追踪调用关系。

Use when:
- 想知道 A 如何调用到 B
- 追踪跨模块依赖链路

Typical chained usage:
- graph_node → graph_path（确定两端节点后查路径）`,
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
    `获取指定社区的节点列表，用于识别代码聚类和模块边界。社区数据的唯一生产者是 \`spectra community\` CLI —— \`spectra batch\` / \`spectra graph\` / \`spectra index\` 均不写入 metadata.community，未跑过 \`spectra community\` 的图查询本工具必然 0 命中。

Use when:
- 想识别代码的自然聚类 / 模块边界
- 分析高内聚低耦合结构

Typical chained usage:
- spectra community（CLI，先生成社区数据）→ graph_community → graph_node（聚类后看具体节点）`,
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
    `查询知识图谱中的超边（Hyperedges），每条连接 3+ 节点，表达命名流程或跨模块协作。支持按 label 模糊过滤和节点 ID 精确过滤。
超边的启用条件：full mode + 显式 opt-in（\`--hyperedges\` 或 \`SPECTRA_HYPEREDGES_ENABLED=true\`）+ 存在设计文档来源（根 README 即可）；这些条件必要非充分——预算降级或 LLM 未提取到协作面时结果仍为空。

Use when:
- 想看跨多模块的协作流程
- 按 label 找某命名流程

Typical chained usage:
- graph_query → graph_hyperedges（子图后看多节点协作）`,
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
              text: JSON.stringify(
                {
                  hyperedges,
                  total: hyperedges.length,
                  filtered,
                  // F271 FR-011：空结果附诚实说明。空数组极易被误读为"本项目无跨模块协作"，
                  // 但真实成因通常是三重前置条件未满足（返回结构不变，只多一个 message 字段）。
                  ...(hyperedges.length === 0 ? { message: describeEmptyHyperedges(filtered) } : {}),
                },
                null,
                2,
              ),
            },
          ],
        };
      });
    }),
  );

  // ─── 工具 5: graph_god_nodes — 枢纽节点识别 ───
  server.tool(
    'graph_god_nodes',
    `识别知识图谱中度数最高的枢纽节点，用于定位过度耦合的核心模块、分析架构瓶颈。

Use when:
- 找过度耦合的"上帝模块"
- 架构瓶颈 / 重构优先级分析

Typical chained usage:
- graph_god_nodes → impact（枢纽节点再做影响面评估）`,
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
