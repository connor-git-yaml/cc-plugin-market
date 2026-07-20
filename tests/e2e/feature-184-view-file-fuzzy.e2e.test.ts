/**
 * F184 T009 — view_file fuzzy symbol resolve 经 stdio JSON-RPC 链路（FR-003/FR-004 / SC-001/SC-002）
 *
 * 验证 view_file fuzzy 在真实 stdio 子进程 + 真实 micrograd graph.json 下端到端成立：
 *   SC-001 auto-resolve 成功：唯一 path-suffix 候选（confidence 0.9）→ 成功 + warnings 含 fuzzy-resolved
 *   SC-002 失败带候选：裸名 'MLP'（confidence 0.85 < 0.9，多候选）→ symbol-not-found + context.fuzzyMatches
 *
 * fixture 策略（Codex Plan/Tasks C-001 三级兜底，取 level 2 patch fixture）：
 *   - SC-002 用裸名 'MLP'：真实 graph 天然多候选 0.85（feature-180-symbol-chain.e2e:205 已证）
 *   - SC-001 注入一个干净唯一节点 micrograd/engine.py::f184FuzzTarget（relative sourceFile + lineRange）——
 *     与 e2e 既有"patch MLP lineRange"同性质（改的是真实 symbol 图数据，非臆造串），probe 实测 0.9 唯一 auto-resolve。
 *   auto-resolve 分支的权威覆盖在单测 view-file-fuzzy.test.ts；本 E2E 验证协议层传播。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawnMcpClient,
  buildSkipCondition,
  buildSkipReason,
  installRelativizedBaseline,
  MICROGRAD_SOURCE,
  type McpClientHandle,
} from './helpers/stdio-client.js';

const SHOULD_SKIP = buildSkipCondition(true);
const SKIP_REASON = buildSkipReason(true);

interface ToolJson {
  code?: string;
  warnings?: string[];
  startLine?: number;
  endLine?: number;
  context?: { fuzzyMatches?: Array<{ id: string; confidence: number; matchKind: string }> };
}

async function callViewFile(
  handle: McpClientHandle,
  args: Record<string, unknown>,
): Promise<ToolJson> {
  const result = await handle.client.callTool({ name: 'view_file', arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]?.text ?? '{}') as ToolJson;
}

describe.skipIf(SHOULD_SKIP)(
  `用户故事: view_file 传模糊 symbol 经 stdio 成功 fuzzy resolve${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;

    beforeAll(async () => {
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-184-view-fuzzy-'));
      mkdirSync(join(tempRoot, 'micrograd'), { recursive: true });
      mkdirSync(join(tempRoot, 'specs', '_meta'), { recursive: true });
      copyFileSync(join(MICROGRAD_SOURCE, 'micrograd', 'nn.py'), join(tempRoot, 'micrograd', 'nn.py'));
      copyFileSync(join(MICROGRAD_SOURCE, 'micrograd', 'engine.py'), join(tempRoot, 'micrograd', 'engine.py'));

      const graphPath = join(tempRoot, 'specs', '_meta', 'graph.json');
      // F193：baseline 是旧绝对路径格式，加载期 stale 检测会 reject——用 relativize helper 安装
      // （与 feature-180 系列同款），写入相对化 id 的图后再注入测试节点。
      installRelativizedBaseline(graphPath);
      const graphData = JSON.parse(readFileSync(graphPath, 'utf-8')) as {
        nodes: Array<{ id: string; kind?: string; label?: string; metadata?: { sourceFile?: string; lineRange?: { start: number; end: number } } }>;
      };
      // 注入唯一干净节点（SC-001 auto-resolve 目标，relative sourceFile 落在 tempRoot 内）
      graphData.nodes.push({
        id: 'micrograd/engine.py::f184FuzzTarget',
        kind: 'component',
        label: 'f184FuzzTarget',
        metadata: { sourceFile: 'micrograd/engine.py', lineRange: { start: 3, end: 7 } },
      });
      writeFileSync(graphPath, JSON.stringify(graphData));

      handle = await spawnMcpClient({ cwd: tempRoot });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    it('SC-001: view_file(symbolId="engine.py::f184FuzzTarget") → auto-resolve 成功 + warnings 含 fuzzy-resolved', async () => {
      const data = await callViewFile(handle, {
        path: 'micrograd/engine.py',
        symbolId: 'engine.py::f184FuzzTarget',
        projectRoot: tempRoot,
      });
      expect(data.code, `应成功，实际 code=${data.code}`).toBeUndefined();
      expect(data.warnings ?? []).toEqual(expect.arrayContaining(['fuzzy-resolved']));
      expect(data.startLine).toBe(3);
      expect(data.endLine).toBe(7);
    });

    // Feature 214 行为漂移：ID 收敛消除 nn.py#MLP/nn.py::MLP 成对重复 → bare-name 'MLP' 唯一命中 auto-resolve
    // （旧图 bare-name 多候选 0.85 → symbol-not-found；ID 统一后唯一 canonical 节点 → auto-resolve，US2 场景 2）
    it('SC-002: view_file(symbolId="MLP") → 唯一 canonical 节点 auto-resolve（ID 收敛消除重复后）', async () => {
      const data = await callViewFile(handle, {
        path: 'micrograd/nn.py',
        symbolId: 'MLP',
        projectRoot: tempRoot,
      });
      // 唯一命中 auto-resolve：无 symbol-not-found，warnings 含 fuzzy-resolved
      expect(data.code, `应 auto-resolve，实际 code=${data.code}`).toBeUndefined();
      expect(data.warnings ?? []).toEqual(expect.arrayContaining(['fuzzy-resolved']));
      // 成功返回文件片段（行区间为正整数）
      expect(typeof data.startLine).toBe('number');
      expect(data.startLine!).toBeGreaterThanOrEqual(1);
      expect(data.endLine!).toBeGreaterThanOrEqual(data.startLine!);
    });
  },
);
