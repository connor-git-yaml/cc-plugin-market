/**
 * Feature 180 — graph 6 工具 + listTools exact names（Story #1/#8）
 *
 * 验证 6 个 graph 工具各经 stdio 子进程 callTool 后：
 *   - JSON 可解析、isError 不为 true
 *   - schema 关键字段通过 SDK 序列化后与 Zod 源码定义一致（schema 不漂移）
 * 同时验证 listTools 返回的工具名集合与实测真值精确匹配。
 *
 * 实测复核（T-011 节点）：
 *   工具注册真值 = 17 个（2026-06-08 实测确认）
 *   sorted names：["batch","context","detect_changes","diff","generate","graph_community",
 *     "graph_god_nodes","graph_hyperedges","graph_node","graph_path","graph_query",
 *     "impact","list_directory","panoramic-query","prepare","search_in_file","view_file"]
 *   scope 文档写 18 是错的；源码 server.ts 注释也写 17，与实测一致。
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawnMcpClient,
  buildSkipCondition,
  buildSkipReason,
  installRelativizedBaseline,
  type McpClientHandle,
} from './helpers/stdio-client.js';

// 纯图套件：只读 in-repo fixture（installRelativizedBaseline），不拷贝 clone 源文件
const SHOULD_SKIP = buildSkipCondition(false);
const SKIP_REASON = buildSkipReason(false);

// 实测确认的 17 个工具名（排序后）
// 实测时间：2026-06-08；若工具集合有变更，此处断言会立即失败并暴露漂移
const EXPECTED_TOOL_NAMES = [
  'batch',
  'context',
  'detect_changes',
  'diff',
  'generate',
  'graph_community',
  'graph_god_nodes',
  'graph_hyperedges',
  'graph_node',
  'graph_path',
  'graph_query',
  'impact',
  'list_directory',
  'panoramic-query',
  'prepare',
  'search_in_file',
  'view_file',
];

describe.skipIf(SHOULD_SKIP)(
  `用户故事: 图谱查询工具经 stdio 子进程序列化后 schema 不漂移${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;

    beforeAll(async () => {
      // 准备 tempRoot：拷贝 baseline graph
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-180-graph-tools-'));
      mkdirSync(join(tempRoot, 'specs', '_meta'), { recursive: true });
      installRelativizedBaseline(join(tempRoot, 'specs', '_meta', 'graph.json'));

      handle = await spawnMcpClient({ cwd: tempRoot });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    // T-003-1: listTools 工具名集合精确匹配
    it('T-003-1: listTools 返回工具名集合（排序后）与实测真值精确匹配', async () => {
      const result = await handle.client.listTools();
      const sortedNames = result.tools.map((t) => t.name).sort();
      // exact sorted names 断言：不只断数量，断每个工具名
      expect(sortedNames).toEqual(EXPECTED_TOOL_NAMES);
    }, 15_000);

    // T-003-2: impact inputSchema 关键字段
    it('T-003-2: impact 工具 inputSchema 含 target(required) + direction enum', async () => {
      const result = await handle.client.listTools();
      const impactTool = result.tools.find((t) => t.name === 'impact');
      expect(impactTool).toBeDefined();

      const schema = impactTool!.inputSchema as {
        required?: string[];
        properties?: Record<string, { enum?: string[] }>;
      };
      // target 字段标注为 required
      expect(schema.required).toContain('target');
      // direction 含合法 enum 值
      const dirEnum = schema.properties?.['direction']?.enum ?? [];
      expect(dirEnum).toContain('upstream');
      expect(dirEnum).toContain('downstream');
      expect(dirEnum).toContain('both');
    }, 15_000);

    // T-003-3: graph_query inputSchema schema 不漂移
    it('T-003-3: graph_query inputSchema 经 SDK 序列化后关键字段仍存在', async () => {
      const result = await handle.client.listTools();
      const tool = result.tools.find((t) => t.name === 'graph_query');
      expect(tool).toBeDefined();

      const schema = tool!.inputSchema as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      // question 是必填字段（实测确认入参名是 question 不是 query）
      expect(schema.required).toContain('question');
      expect(schema.properties?.['question']).toBeDefined();
    }, 15_000);

    // T-003-4: graph_query 合法调用（question 必填）
    it('T-003-4: graph_query 合法调用（传 question）→ isError 不为 true，JSON 可解析', async () => {
      const result = await handle.client.callTool({
        name: 'graph_query',
        arguments: {
          question: 'what are the main components?',
          projectRoot: tempRoot,
        },
      });
      // isError 不应为 true
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      // JSON 可解析
      const data = JSON.parse(text) as {
        nodes?: unknown[];
        edges?: unknown[];
        summary?: string;
      };
      // graph_query 响应应含 nodes 数组（实测确认响应 keys: nodes/edges/summary/truncated/totalMatches）
      expect(Array.isArray(data.nodes)).toBe(true);
    }, 20_000);

    // T-003-5: graph_node 合法调用（传 id）
    it('T-003-5: graph_node 合法调用（传 id）→ JSON 可解析，schema 关键字段存在', async () => {
      // 用 # 形式的真实 node id
      const result = await handle.client.callTool({
        name: 'graph_node',
        arguments: {
          id: 'micrograd/nn.py::MLP',
          projectRoot: tempRoot,
        },
      });
      // isError 不应为 true（buildErrorResponse 也是合法 JSON，仅断可解析会假绿，Codex Impl-C1）
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      // 实测响应 keys：[node, neighbors, community, semanticEdges]
      const data = JSON.parse(text) as { node?: { id?: string }; semanticEdges?: unknown[] };
      expect(data.node?.id).toBe('micrograd/nn.py::MLP');
      expect(Array.isArray(data.semanticEdges)).toBe(true);
    }, 20_000);

    // T-003-6: graph_path 合法调用（source + target 必填）
    it('T-003-6: graph_path 合法调用（传 source + target）→ isError 不为 true + edges 数组 + message', async () => {
      const result = await handle.client.callTool({
        name: 'graph_path',
        arguments: {
          source: 'micrograd/nn.py::MLP',
          target: 'micrograd/engine.py::Value',
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      // 实测响应 keys：[path, edges, message]（无路径时 path=null/edges=[]，仍是成功响应）
      const data = JSON.parse(text) as { edges?: unknown[]; message?: string };
      expect(Array.isArray(data.edges)).toBe(true);
      expect(typeof data.message).toBe('string');
    }, 20_000);

    // T-003-7: graph_community 合法调用（communityId 必填）
    it('T-003-7: graph_community 合法调用（传 communityId）→ isError 不为 true + communityId 回传 + nodes 数组', async () => {
      const result = await handle.client.callTool({
        name: 'graph_community',
        arguments: {
          communityId: '0',
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      // 实测响应 keys：[communityId, nodes, cohesion, message]（社区不存在时 nodes=[]，仍成功）
      const data = JSON.parse(text) as { communityId?: string; nodes?: unknown[] };
      expect(data.communityId).toBe('0');
      expect(Array.isArray(data.nodes)).toBe(true);
    }, 20_000);

    // T-003-8: graph_god_nodes 合法调用（limit 可选）
    it('T-003-8: graph_god_nodes 合法调用（limit 可选）→ isError 不为 true + nodes 非空数组', async () => {
      const result = await handle.client.callTool({
        name: 'graph_god_nodes',
        arguments: {
          limit: 5,
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as { nodes?: unknown[] };
      expect(Array.isArray(data.nodes)).toBe(true);
      // micrograd graph 有节点，god_nodes 按度数降序应返回非空
      expect(data.nodes!.length).toBeGreaterThan(0);
    }, 20_000);

    // T-003-9: graph_hyperedges 合法调用（所有参数可选）
    it('T-003-9: graph_hyperedges 合法调用（label?/node_id?/limit? 均可选）→ isError 不为 true + hyperedges 数组 + total 数字', async () => {
      const result = await handle.client.callTool({
        name: 'graph_hyperedges',
        arguments: {
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      // 实测响应 keys：[hyperedges, total, filtered]
      const data = JSON.parse(text) as { hyperedges?: unknown[]; total?: number };
      expect(Array.isArray(data.hyperedges)).toBe(true);
      expect(typeof data.total).toBe('number');
    }, 20_000);
  },
);
