/**
 * Feature 160 Smoke A — Spectra MCP server stdio 子进程 E2E
 *
 * 用 @modelcontextprotocol/sdk Client + StdioClientTransport spawn dist/cli/index.js mcp-server 子进程，
 * 验证 tools/list + 3 个 agent-context tool（impact / context / detect_changes）的 stdio/JSON-RPC 链路。
 *
 * skip 条件（CI 友好）：
 *   - dist/cli/index.js 不存在（需先 npm run build）
 * 本文件不拷贝 `.py` 源文件；`MICROGRAD_SOURCE` 仅作 `relativizeSymbolId` 的相对化基准字符串。
 * `graph.json` 读自 in-repo pinned fixture `tests/fixtures/micrograd-baseline-graph/graph.json`
 * （随 git 提交恒存在，F215 起 repoint），因此不参与 skip 判定；缺失会在读取处 fail-fast 抛错
 * （检出不完整/漏提交问题，非环境未就绪，不应被 skip 掩盖）。
 *
 * 现有 agent-context-real-graph.test.ts 是 in-process import，本测试补齐 stdio 协议链路。
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { relativizeSymbolId } from '../../src/knowledge-graph/relativize.js';

const PROJECT_ROOT = resolve('.');
const DIST_CLI = join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
const BASELINE_GRAPH = join(
  PROJECT_ROOT,
  'tests',
  'fixtures',
  'micrograd-baseline-graph',
  'graph.json',
);
const MICROGRAD_SOURCE = join(homedir(), '.spectra-baselines', 'micrograd');

const HAS_DIST = existsSync(DIST_CLI);
const SHOULD_SKIP = !HAS_DIST;

const SKIP_REASON = [
  !HAS_DIST ? `dist/cli/index.js 不存在（先 npm run build）` : '',
].filter(Boolean).join('; ');

// Feature 193：baseline graph 在 copy 时相对化为 repo-relative POSIX id（producer 侧新格式）。
// 旧绝对 baseline 经 relativizeGraphFixture 转换后，query 也用相对 id（与节点 id 同形，
// 验证 17 工具在新相对 id 格式下零回归 + graph exact 工具相对 id 匹配，W5 矩阵）。
const REL_VALUE_RELU = `micrograd/engine.py::Value.relu`;
const REL_MLP = `micrograd/nn.py::MLP`;

/**
 * Feature 193 — 把旧绝对 id baseline graph 相对化为 repo-relative POSIX，
 * 使其符合新格式（避免加载期 graph-format-stale），写入 tempRoot。
 * 模拟「主仓 copy 的图已是新相对格式」场景。
 *
 * @throws {Error} `srcGraphPath`（in-repo pinned fixture）缺失时立即抛错——该 fixture
 *   随 git 提交恒存在，缺失说明检出不完整或漏提交，不应被 skip 机制掩盖
 *   （F215 Codex 对抗审查 CRITICAL-1 修复，与 stdio-client.ts 的 installRelativizedBaseline 同款）
 */
function writeRelativizedBaseline(srcGraphPath: string, destGraphPath: string, base: string): void {
  if (!existsSync(srcGraphPath)) {
    throw new Error(
      `pinned fixture 缺失: ${srcGraphPath} —— 该文件应随 git 提交恒存在，` +
      `缺失说明检出不完整或漏提交，非"baseline 未采集"的可 skip 场景。` +
      `参见 tests/fixtures/micrograd-baseline-graph/README.md 的再生步骤重新生成。`,
    );
  }
  const raw = JSON.parse(readFileSync(srcGraphPath, 'utf-8')) as {
    nodes: Array<{ id: string; metadata?: Record<string, unknown> }>;
    links: Array<{ source: string; target: string }>;
    [k: string]: unknown;
  };
  for (const n of raw.nodes) {
    const r = relativizeSymbolId(n.id, base);
    n.id = r.value;
    if (r.external) n.metadata = { ...n.metadata, external: true };
  }
  for (const l of raw.links) {
    l.source = relativizeSymbolId(l.source, base).value;
    l.target = relativizeSymbolId(l.target, base).value;
  }
  writeFileSync(destGraphPath, JSON.stringify(raw, null, 2), 'utf-8');
}

describe.skipIf(SHOULD_SKIP)(
  `Feature 160 Smoke A — MCP server stdio 子进程 E2E${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let client: Client;
    let transport: StdioClientTransport;
    let tempRoot: string;

    beforeAll(async () => {
      // 准备 temp projectRoot：<temp>/specs/_meta/graph.json
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-160-smoke-a-'));
      mkdirSync(join(tempRoot, 'specs', '_meta'), { recursive: true });
      // Feature 193：相对化 baseline 后写入（新相对 id 格式），而非直接 copy 旧绝对图
      writeRelativizedBaseline(
        BASELINE_GRAPH,
        join(tempRoot, 'specs', '_meta', 'graph.json'),
        MICROGRAD_SOURCE,
      );

      transport = new StdioClientTransport({
        command: 'node',
        args: [DIST_CLI, 'mcp-server'],
        env: {
          ...process.env,
          SPECTRA_DEV_DISABLE: '1',
          CI: '1',
        },
        // cwd = tempRoot：graph-tools 以 process.cwd() 为默认 projectRoot；
        // 设置 cwd 确保无 projectRoot 参数时 server 也能找到 graph.json（W-4 修复）
        cwd: tempRoot,
        stderr: 'pipe',
      });

      client = new Client(
        { name: 'smoke-a-test-client', version: '1.0.0' },
        { capabilities: {} },
      );

      await client.connect(transport);
    }, 30_000);

    afterAll(async () => {
      await client.close();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    it('T-A1: tools/list 返回 ≥ 12 个 tool（含 agent-context + file-nav）', async () => {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);

      // agent-context tools（Feature 155）
      expect(names).toContain('impact');
      expect(names).toContain('context');
      expect(names).toContain('detect_changes');

      // file-navigation tools（Feature 171）
      expect(names).toContain('view_file');
      expect(names).toContain('search_in_file');
      expect(names).toContain('list_directory');

      // 基础工具
      expect(names).toContain('prepare');
      expect(names).toContain('generate');
      expect(names).toContain('batch');
      expect(names).toContain('diff');

      // 总数 ≥ 12
      expect(names.length).toBeGreaterThanOrEqual(12);
    }, 15_000);

    it('T-A2: impact tool — graph-not-built 错误（tempRoot 无 graph, 绝对 projectRoot 指向有 graph 的 tempRoot）', async () => {
      // 先验证 graph-not-built 错误路径（用不存在 graph 的 cwd）
      const emptyDir = mkdtempSync(join(tmpdir(), 'spectra-160-no-graph-'));
      try {
        const result = await client.callTool({
          name: 'impact',
          arguments: {
            target: REL_VALUE_RELU,
            depth: 2,
            projectRoot: emptyDir,
          },
        });
        // 应该返回 isError: true 或 graph-not-built 错误
        const content = result.content as Array<{ type: string; text: string }>;
        const text = content[0]?.text ?? '';
        const parsed = JSON.parse(text) as { code?: string };
        expect(parsed.code).toBe('graph-not-built');
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    }, 15_000);

    it('T-A3: impact tool — symbol 解析成功 + BFS 完成（targetId + effectiveDirection 均存在）', async () => {
      // Value.relu 在 micrograd upstream 方向没有调用者（relu 是叶子），但测试的目标是
      // 验证 stdio 链路：graph.json 被正确加载、symbol 被解析、BFS 运行完成（W-3：用 targetId 证明）
      const result = await client.callTool({
        name: 'impact',
        arguments: {
          target: REL_VALUE_RELU,
          depth: 2,
          direction: 'upstream',
          projectRoot: tempRoot,
        },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content.length).toBeGreaterThan(0);
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as {
        affected?: unknown[];
        effectiveDirection?: string;
        summary?: { directCallers?: number; transitive?: number; riskTier?: string };
        effectiveDepth?: number;
      };
      // isError=true 时 data 含 code 字段（graph-not-built / symbol-not-found 等），无 effectiveDirection
      // effectiveDirection 存在证明：graph 加载成功 + canonicalize 成功 + BFS 完整运行
      expect(data.effectiveDirection).toBe('upstream');
      // summary 字段证明 BFS 完整运行（impact 响应字段：summary.transitive，非 totalAffected）
      expect(typeof data.summary?.transitive).toBe('number');
      expect(typeof data.summary?.directCallers).toBe('number');
      // affected 可以为空（Value.relu 在 upstream 方向没有调用者，这是正确行为非错误）
      expect(Array.isArray(data.affected)).toBe(true);
    }, 20_000);

    it('T-A4: context tool — 返回 callers/callees/definition 字段', async () => {
      const result = await client.callTool({
        name: 'context',
        arguments: {
          symbolId: REL_MLP,
          projectRoot: tempRoot,
        },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as { definition?: unknown; callers?: unknown; callees?: unknown };
      // definition / callers / callees 三者至少有一个非 null（MLP 有 callers）
      const hasAny = data.definition !== undefined || Array.isArray(data.callers) || Array.isArray(data.callees);
      expect(hasAny).toBe(true);
    }, 20_000);

    it('T-A5: detect_changes tool — 小型 diff 返回 changedSymbols 数组（含文件信息）', async () => {
      const diff = `diff --git a/micrograd/engine.py b/micrograd/engine.py
index a1b2c3..d4e5f6 100644
--- a/micrograd/engine.py
+++ b/micrograd/engine.py
@@ -1,3 +1,3 @@
-old_line = 1
+new_line = 2
 context_line
`;
      const result = await client.callTool({
        name: 'detect_changes',
        arguments: {
          diff,
          projectRoot: tempRoot,
        },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as { changedSymbols?: Array<{ symbolId?: string; file?: string }> };
      // changedSymbols 是数组（可以是空的，因为 diff 对应的 symbol 在 graph 中可能不存在）
      expect(Array.isArray(data.changedSymbols)).toBe(true);
    }, 20_000);
  },
);
