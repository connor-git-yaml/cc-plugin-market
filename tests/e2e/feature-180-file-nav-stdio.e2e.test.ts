/**
 * Feature 180 — file-nav 3 工具在 stdio JSON-RPC 链路下（Story #7）
 *
 * 验证 view_file / search_in_file / list_directory 在真实 stdio 链路下：
 *   T-009-1: view_file 行段切片（startLine=1, endLine=10）→ 恰前 10 行
 *   T-009-2: view_file symbolId（micrograd/nn.py#MLP，patch 过 lineRange）→ startLine/endLine=patch 值
 *   T-009-3: view_file endLine 超过总行数 → clamp（优雅截断，非 error），行数 ≤ 文件总行数
 *   T-009-4: view_file 越界路径 → path-outside-root 或 file-not-found
 *   T-009-5: search_in_file 有效 path + pattern → 含匹配结果（行号 + 片段）
 *   T-009-6: list_directory 传 tempRoot → 包含目录内文件名列表
 *
 * tempRoot 布局（同 symbol-chain T-004，Codex Plan C-1/C-2）：
 *   micrograd/nn.py         （从 MICROGRAD_SOURCE 拷入）
 *   micrograd/engine.py
 *   specs/_meta/graph.json  （baseline 拷贝 + patch micrograd/nn.py#MLP lineRange）
 *
 * MLP 行号：class MLP 在 nn.py 第 45 行，最后行 60（实测 wc -l = 60）
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawnMcpClient,
  buildSkipCondition,
  buildSkipReason,
  BASELINE_GRAPH,
  MICROGRAD_SOURCE,
  type McpClientHandle,
} from './helpers/stdio-client.js';

const SHOULD_SKIP = buildSkipCondition(true);
const SKIP_REASON = buildSkipReason(true);

// nn.py MLP 真实行号（class MLP 在 45 行，文件共 60 行）
const MLP_LINE_START = 45;
const MLP_LINE_END = 60;
// nn.py 总行数（wc -l 实测）
const NN_PY_TOTAL_LINES = 60;

describe.skipIf(SHOULD_SKIP)(
  `用户故事: file-nav 3 工具（view_file/search_in_file/list_directory）经 stdio JSON-RPC 链路行为成立${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;

    beforeAll(async () => {
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-180-file-nav-'));
      mkdirSync(join(tempRoot, 'micrograd'), { recursive: true });
      mkdirSync(join(tempRoot, 'specs', '_meta'), { recursive: true });

      // 拷贝 micrograd 源文件
      copyFileSync(
        join(MICROGRAD_SOURCE, 'micrograd', 'nn.py'),
        join(tempRoot, 'micrograd', 'nn.py'),
      );
      copyFileSync(
        join(MICROGRAD_SOURCE, 'micrograd', 'engine.py'),
        join(tempRoot, 'micrograd', 'engine.py'),
      );

      // 拷贝 baseline graph + patch MLP lineRange（Codex Plan C-1）
      const graphPath = join(tempRoot, 'specs', '_meta', 'graph.json');
      copyFileSync(BASELINE_GRAPH, graphPath);
      const graphData = JSON.parse(readFileSync(graphPath, 'utf-8')) as {
        nodes: Array<{
          id: string;
          metadata?: { lineRange?: { start: number; end: number } };
        }>;
      };
      const mlpNode = graphData.nodes.find((n) => n.id === 'micrograd/nn.py#MLP');
      if (mlpNode) {
        if (!mlpNode.metadata) mlpNode.metadata = {};
        mlpNode.metadata.lineRange = { start: MLP_LINE_START, end: MLP_LINE_END };
      }
      writeFileSync(graphPath, JSON.stringify(graphData));

      handle = await spawnMcpClient({ cwd: tempRoot });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    // T-009-1: view_file 行段切片（startLine=1, endLine=10）→ 恰前 10 行
    it('T-009-1: view_file startLine=1,endLine=10 → 响应内容恰前 10 行，不多不少', async () => {
      const result = await handle.client.callTool({
        name: 'view_file',
        arguments: {
          path: 'micrograd/nn.py',
          startLine: 1,
          endLine: 10,
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      // view_file 响应结构：{path, lines: string[], startLine, endLine, totalLines, truncated, ...}
      // lines 是 string[]（每行带行号前缀 "${lineNo}\t${text}"），不是单个字符串
      const data = JSON.parse(text) as {
        lines?: string[];
        startLine?: number;
        endLine?: number;
      };
      // 返回行数 = endLine - startLine + 1 = 10
      expect(data.startLine).toBe(1);
      expect(data.endLine).toBe(10);
      // lines 数组恰好 10 项（每行一项）
      expect(Array.isArray(data.lines)).toBe(true);
      expect(data.lines!.length).toBe(10);
      // 内容精确比对前 10 行（防静默降级/错切片假绿，Codex Impl-C4）：
      // 响应行格式为 "${lineNo}\t${原文行}"，与源文件前 10 行逐行对齐
      const srcLines = readFileSync(
        join(tempRoot, 'micrograd', 'nn.py'),
        'utf-8',
      ).split('\n');
      for (let i = 0; i < 10; i++) {
        expect(data.lines![i]).toBe(`${i + 1}\t${srcLines[i]}`);
      }
    }, 20_000);

    // T-009-2: view_file symbolId（patch 过 lineRange 的 node）→ startLine/endLine = patch 值
    it('T-009-2: view_file symbolId=micrograd/nn.py#MLP（patch lineRange）→ startLine/endLine = patch 值', async () => {
      // 完整相对形式 symbolId（不传裸 MLP，避免静默降级，Codex Plan C-1）
      // path 传 tempRoot 相对路径，绝不传绝对路径（Codex Plan C-2）
      const result = await handle.client.callTool({
        name: 'view_file',
        arguments: {
          path: 'micrograd/nn.py',
          symbolId: 'micrograd/nn.py#MLP',
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as {
        startLine?: number;
        endLine?: number;
      };
      // startLine/endLine 等于 patch 的 lineRange（round-trip 验证）
      expect(data.startLine).toBe(MLP_LINE_START);
      expect(data.endLine).toBe(MLP_LINE_END);
    }, 20_000);

    // T-009-3: view_file endLine 超过总行数 → clamp 优雅截断（非 error）
    it('T-009-3: view_file endLine 超过总行数（9999）→ clamp 截断，返回行数 ≤ 文件总行数', async () => {
      const result = await handle.client.callTool({
        name: 'view_file',
        arguments: {
          path: 'micrograd/nn.py',
          startLine: 1,
          endLine: 9999,  // 超过文件总行数 60
          projectRoot: tempRoot,
        },
      });
      // 当前实现是 clamp（Info-2 核对 sliceLines），非 error
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as {
        startLine?: number;
        endLine?: number;
        totalLines?: number;
        lines?: string[];
      };
      // clamp 到文件末尾：用响应自身的 totalLines 自洽断言（避免硬编码 60 因 trailing
      // newline 产生 off-by-one 假红，Codex Impl-C4）
      expect(typeof data.totalLines).toBe('number');
      // 9999 被 clamp 到 totalLines（证明真的截断到文件末，不是返回 1 行也过）
      expect(data.endLine).toBe(data.totalLines);
      // totalLines 与源文件实际行数一致（独立锚定，≈60）
      expect(data.totalLines).toBeGreaterThanOrEqual(NN_PY_TOTAL_LINES);
      // startLine=1 → 行数 = endLine - startLine + 1
      expect(Array.isArray(data.lines)).toBe(true);
      expect(data.lines!.length).toBe((data.endLine ?? 0) - (data.startLine ?? 1) + 1);
    }, 20_000);

    // T-009-4: view_file 完全越界路径 → path-outside-root 或 file-not-found
    it('T-009-4: view_file 越界路径 ../../../etc/passwd → path-outside-root 或 file-not-found', async () => {
      const result = await handle.client.callTool({
        name: 'view_file',
        arguments: {
          path: '../../../etc/passwd',
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as { code?: string };
      // 词法越界在触 fs 前即返回 path-outside-root（与 symlink-security 一致）；
      // 接受 file-not-found 会放过"先触 fs 再分类"的回归，故强断 path-outside-root（Codex Impl-W10）
      expect(data.code).toBe('path-outside-root');
    }, 20_000);

    // T-009-5: search_in_file 有效 path + pattern → 含匹配结果
    it('T-009-5: search_in_file 传 nn.py + pattern="class" → 含匹配结果（行号+片段）', async () => {
      // search_in_file 无 symbolId 入参（Codex W-3），只验 pattern happy path
      const result = await handle.client.callTool({
        name: 'search_in_file',
        arguments: {
          path: 'micrograd/nn.py',
          pattern: 'class',
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      // search_in_file 响应结构：{path, matches: SearchMatch[], totalMatches, returnedMatches, ...}
      // SearchMatch = {line: number, text: string, before: string[], after: string[]}
      const data = JSON.parse(text) as {
        matches?: Array<{ line: number; text: string; before: string[]; after: string[] }>;
      };
      expect(Array.isArray(data.matches)).toBe(true);
      // nn.py 有 4 个 class（Module/Neuron/Layer/MLP），至少 1 个匹配
      expect((data.matches ?? []).length).toBeGreaterThan(0);
      // 每个匹配含 line（行号）和 text（匹配行内容）
      const firstMatch = data.matches![0];
      expect(typeof firstMatch.line).toBe('number');
      expect(typeof firstMatch.text).toBe('string');
    }, 20_000);

    // T-009-6: list_directory 传 tempRoot → 包含目录内文件名列表
    it('T-009-6: list_directory 传 tempRoot → 响应含目录内文件名列表', async () => {
      const result = await handle.client.callTool({
        name: 'list_directory',
        arguments: {
          path: '.',
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as {
        entries?: Array<{ name: string; type: string }>;
      };
      expect(Array.isArray(data.entries)).toBe(true);
      // tempRoot 内有 micrograd/ 和 specs/ 目录
      const names = (data.entries ?? []).map((e) => e.name);
      expect(names).toContain('micrograd');
    }, 20_000);
  },
);
