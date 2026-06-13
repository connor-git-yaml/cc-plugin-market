/**
 * Feature 180 — 跨工具 symbolId 链式透传 + fuzzy resolve（Story #2/#11）
 *
 * 验证 detect_changes → context → view_file 在 stdio 链路下 symbolId 透传完整：
 *   1. detect_changes 传 diff → changedSymbols 非空
 *   2. 显式选 component symbol micrograd/nn.py#MLP（不取 symbols[0]，可能是模块节点）
 *   3. context(symbolId) → definition.lineStart/lineEnd 与 patch 值一致
 *   4. view_file(path, symbolId) → startLine/endLine 等于 context.definition 行号（round-trip）
 *   5. fuzzy：裸名 'MLP' → symbol-not-found + fuzzyMatches（confidence=0.85 < 0.9 不 auto-resolve）
 *
 * tempRoot 布局（Codex Plan C-1/C-2/C-3）：
 *   micrograd/nn.py         （从 MICROGRAD_SOURCE 拷入）
 *   micrograd/engine.py
 *   specs/_meta/graph.json  （baseline 拷贝 + patch micrograd/nn.py#MLP lineRange）
 *
 * 实测复核（T-011）：
 *   - detect_changes 响应结构：{changedSymbols:[{file,changeKind,symbols:string[]}]}
 *     symbols[0] 是模块节点 'micrograd/nn.py'（无 lineRange），须显式选 component
 *   - context 响应字段：definition.lineStart/lineEnd（非 startLine）
 *   - view_file 响应字段：startLine/endLine（实测确认字段名）
 *   - fuzzy 实测：裸名 'MLP' → code='symbol-not-found' + context.fuzzyMatches[0].confidence<0.9
 *     fuzzyMatches 嵌套在 data.context.fuzzyMatches（不在顶层），实测确认
 *     confidence<0.9 auto-resolve 阈值，不自动 resolve（需更精确输入才触发 warnings.fuzzy-resolved）
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  copyFileSync,
  existsSync,
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
  installRelativizedBaseline,
  MICROGRAD_SOURCE,
  type McpClientHandle,
} from './helpers/stdio-client.js';

const SHOULD_SKIP = buildSkipCondition(true);
const SKIP_REASON = buildSkipReason(true);

// micrograd/nn.py 中 MLP 类的真实行号（cat -n 实测：class MLP 在第 45 行，最后行 60）
// patch 这些值到 graph.json，使 view_file symbolId 路径有行号可用（Codex Plan C-1）
const MLP_LINE_START = 45;
const MLP_LINE_END = 60;

// nn.py diff fixture（header 必须 a/micrograd/nn.py，diff parser 剥 a/b 前缀后按 micrograd/nn.py 匹配）
const NN_PY_DIFF = `diff --git a/micrograd/nn.py b/micrograd/nn.py
index a1b2c3..d4e5f6 100644
--- a/micrograd/nn.py
+++ b/micrograd/nn.py
@@ -45,6 +45,6 @@
 class MLP(Module):

     def __init__(self, nin, nouts):
-        sz = [nin] + nouts
+        sz = [nin] + list(nouts)
         self.layers = [Layer(sz[i], sz[i+1], nonlin=i!=len(nouts)-1) for i in range(len(nouts))]

`;

describe.skipIf(SHOULD_SKIP)(
  `用户故事: detect_changes→context→view_file 链路 symbolId 在 stdio 子进程边界完整透传${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;

    beforeAll(async () => {
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-180-symbol-chain-'));
      // 布局：micrograd/*.py + specs/_meta/graph.json（patch lineRange）
      mkdirSync(join(tempRoot, 'micrograd'), { recursive: true });
      mkdirSync(join(tempRoot, 'specs', '_meta'), { recursive: true });

      // 拷入 micrograd 源文件（repo-relative 路径，view_file 用相对路径）
      copyFileSync(
        join(MICROGRAD_SOURCE, 'micrograd', 'nn.py'),
        join(tempRoot, 'micrograd', 'nn.py'),
      );
      copyFileSync(
        join(MICROGRAD_SOURCE, 'micrograd', 'engine.py'),
        join(tempRoot, 'micrograd', 'engine.py'),
      );

      // 拷贝 baseline graph.json 并对 micrograd/nn.py#MLP patch lineRange
      const graphPath = join(tempRoot, 'specs', '_meta', 'graph.json');
      installRelativizedBaseline(graphPath);

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

    // T-004-1: detect_changes 返回非空 changedSymbols
    it('T-004-1: detect_changes 传 nn.py diff → changedSymbols 为数组（非空则继续链路）', async () => {
      const result = await handle.client.callTool({
        name: 'detect_changes',
        arguments: {
          diff: NN_PY_DIFF,
          projectRoot: tempRoot,
        },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as {
        changedSymbols?: Array<{ file: string; changeKind: string; symbols: string[] }>;
      };
      expect(Array.isArray(data.changedSymbols)).toBe(true);
      // 若全为空则 fail 并打印原始响应（不静默跳过，Codex Plan C-3）
      const hasAnySymbol = (data.changedSymbols ?? []).some((e) => e.symbols.length > 0);
      if (!hasAnySymbol) {
        console.log('[T-004-1 原始响应]', text);
      }
      expect(hasAnySymbol).toBe(true);
    }, 20_000);

    // T-004-2: 显式选 component symbol micrograd/nn.py#MLP（不取 symbols[0]）
    it('T-004-2: 从 changedSymbols 显式选 micrograd/nn.py#MLP（非 symbols[0] 的模块节点）', async () => {
      const result = await handle.client.callTool({
        name: 'detect_changes',
        arguments: {
          diff: NN_PY_DIFF,
          projectRoot: tempRoot,
        },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as {
        changedSymbols?: Array<{ file: string; changeKind: string; symbols: string[] }>;
      };
      const allSymbols = (data.changedSymbols ?? []).flatMap((e) => e.symbols);
      // 显式选 component 级 symbol（不取 symbols[0]，可能是无 lineRange 的模块节点）
      const mlpSymbol = allSymbols.find((id) => id === 'micrograd/nn.py#MLP');
      expect(mlpSymbol).toBe('micrograd/nn.py#MLP');
    }, 20_000);

    // T-004-3: context 返回 definition.lineStart/lineEnd（数字）
    it('T-004-3: context(micrograd/nn.py#MLP) → definition.lineStart/lineEnd 等于 patch 值', async () => {
      const result = await handle.client.callTool({
        name: 'context',
        arguments: {
          symbolId: 'micrograd/nn.py#MLP',
          projectRoot: tempRoot,
        },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as {
        definition?: { lineStart?: number; lineEnd?: number };
      };
      expect(typeof data.definition?.lineStart).toBe('number');
      expect(typeof data.definition?.lineEnd).toBe('number');
      // round-trip：context 返回的行号应等于 patch 值
      expect(data.definition?.lineStart).toBe(MLP_LINE_START);
      expect(data.definition?.lineEnd).toBe(MLP_LINE_END);
    }, 20_000);

    // T-004-4: view_file(path=micrograd/nn.py, symbolId=micrograd/nn.py#MLP) → startLine/endLine 与 context 一致
    it('T-004-4: view_file symbolId 路径返回 startLine/endLine 与 context.definition 行号一致', async () => {
      const result = await handle.client.callTool({
        name: 'view_file',
        arguments: {
          // 传 tempRoot 相对路径，绝不传 definition.file 绝对路径（Codex Plan C-2）
          path: 'micrograd/nn.py',
          // 完整相对形式 symbolId（不传裸 MLP，Codex Plan C-1）
          symbolId: 'micrograd/nn.py#MLP',
          projectRoot: tempRoot,
        },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as {
        startLine?: number;
        endLine?: number;
        lines?: string;
      };
      // startLine/endLine 是实测确认的响应字段名（Codex Plan C-1 注释）
      expect(data.startLine).toBe(MLP_LINE_START);
      expect(data.endLine).toBe(MLP_LINE_END);
    }, 20_000);

    // T-004-5: fuzzy：裸名 'MLP' → symbol-not-found + context.fuzzyMatches
    it('T-004-5: context(symbolId="MLP") → symbol-not-found + context.fuzzyMatches（confidence<0.9 不 auto-resolve）', async () => {
      const result = await handle.client.callTool({
        name: 'context',
        arguments: {
          symbolId: 'MLP',
          projectRoot: tempRoot,
        },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      // 实测响应结构：{"code":"symbol-not-found","message":"...","context":{"fuzzyMatches":[...]}}
      // fuzzyMatches 在 data.context.fuzzyMatches（不在顶层），须从嵌套字段读取
      const data = JSON.parse(text) as {
        code?: string;
        context?: {
          fuzzyMatches?: Array<{ id: string; confidence: number; matchKind: string }>;
        };
      };
      // 实测：裸名 'MLP' confidence<0.9 阈值，返回 symbol-not-found + fuzzyMatches
      // （不自动 resolve，需更精确的输入才能触发 warnings.fuzzy-resolved）
      expect(data.code).toBe('symbol-not-found');
      const fuzzyMatches = data.context?.fuzzyMatches ?? [];
      expect(Array.isArray(fuzzyMatches)).toBe(true);
      expect(fuzzyMatches.length).toBeGreaterThan(0);
      // 每个 fuzzyMatch 含 id/confidence/matchKind（证明 fuzzy 机制经 stdio 完整透传）
      const firstMatch = fuzzyMatches[0];
      expect(typeof firstMatch.id).toBe('string');
      expect(typeof firstMatch.confidence).toBe('number');
      expect(typeof firstMatch.matchKind).toBe('string');
    }, 20_000);

    // T-004-6: impact typo 变体 → symbol-not-found+context.fuzzyMatches 或 fuzzy-resolved（两种均合法）
    it('T-004-6: impact(target="micrograd/nn.py#MLPxxx") → symbol-not-found+context.fuzzyMatches 或 fuzzy-resolved（二选一）', async () => {
      const result = await handle.client.callTool({
        name: 'impact',
        arguments: {
          target: 'micrograd/nn.py#MLPxxx',
          projectRoot: tempRoot,
        },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      // 实测：impact typo 响应结构与 context 一致：{"code":"symbol-not-found","context":{"fuzzyMatches":[...]}}
      const data = JSON.parse(text) as {
        code?: string;
        context?: { fuzzyMatches?: unknown[] };
        warnings?: Array<{ kind: string }>;
        effectiveDirection?: string;
      };
      // 允许两种合法结局（Codex W-6：typo 置信度 ≤0.75 < 0.9，不强制单一结局）
      const isFuzzyNotFound =
        data.code === 'symbol-not-found' &&
        Array.isArray(data.context?.fuzzyMatches);
      const isFuzzyResolved =
        Array.isArray(data.warnings) &&
        data.warnings.some((w) => w.kind === 'fuzzy-resolved');
      const isValidResult = isFuzzyNotFound || isFuzzyResolved;
      if (!isValidResult) {
        console.log('[T-004-6 响应]', text);
      }
      expect(isValidResult).toBe(true);
    }, 20_000);
  },
);

// ── Story #11 的 fuzzy resolve describe 块（共享 baseline client）──
describe.skipIf(SHOULD_SKIP)(
  `用户故事: F174 fuzzy symbol 解析经 stdio 子进程边界完整透传${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;

    beforeAll(async () => {
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-180-fuzzy-'));
      mkdirSync(join(tempRoot, 'micrograd'), { recursive: true });
      mkdirSync(join(tempRoot, 'specs', '_meta'), { recursive: true });

      const nnSrc = join(MICROGRAD_SOURCE, 'micrograd', 'nn.py');
      const engSrc = join(MICROGRAD_SOURCE, 'micrograd', 'engine.py');
      if (existsSync(nnSrc)) copyFileSync(nnSrc, join(tempRoot, 'micrograd', 'nn.py'));
      if (existsSync(engSrc)) copyFileSync(engSrc, join(tempRoot, 'micrograd', 'engine.py'));
      installRelativizedBaseline(join(tempRoot, 'specs', '_meta', 'graph.json'));

      handle = await spawnMcpClient({ cwd: tempRoot });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    it('T-011-1: context 传裸名 MLP → symbol-not-found + context.fuzzyMatches 非空（fuzzy 机制经 stdio 透传完整）', async () => {
      const result = await handle.client.callTool({
        name: 'context',
        arguments: { symbolId: 'MLP', projectRoot: tempRoot },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      // 实测响应结构：{"code":"symbol-not-found","context":{"fuzzyMatches":[{id,confidence,matchKind}]}}
      // fuzzyMatches 嵌套在 data.context.fuzzyMatches，不在顶层（实测确认）
      const data = JSON.parse(content[0]?.text ?? '{}') as {
        code?: string;
        context?: {
          fuzzyMatches?: Array<{ id: string; confidence: number; matchKind: string }>;
        };
      };
      // 裸名 'MLP' confidence<0.9，不 auto-resolve，返回 symbol-not-found + fuzzyMatches
      expect(data.code).toBe('symbol-not-found');
      const fuzzyMatches = data.context?.fuzzyMatches ?? [];
      expect(Array.isArray(fuzzyMatches)).toBe(true);
      expect(fuzzyMatches.length).toBeGreaterThan(0);
      // 检查每个 fuzzyMatch 含 id/confidence/matchKind（证明 fuzzy 机制经 stdio 完整透传）
      for (const match of fuzzyMatches) {
        expect(typeof match.id).toBe('string');
        expect(typeof match.confidence).toBe('number');
        expect(typeof match.matchKind).toBe('string');
      }
    }, 20_000);

    // T-011-2: fuzzy auto-resolve 成功路径（confidence≥0.9）→ warnings.fuzzy-resolved + resolvedFrom/To 透传
    // 实测（2026-06-08）：path-suffix 形式 'nn.py::MLP' 唯一命中，置信度过阈值自动 resolve
    // （Codex Impl-W9：补 auto-resolve 成功路径，与 symbol-not-found 分支互补）
    it('T-011-2: context(symbolId="nn.py::MLP") → 自动 resolve，warnings 含 fuzzy-resolved + resolvedFrom/resolvedTo 透传', async () => {
      const result = await handle.client.callTool({
        name: 'context',
        arguments: { symbolId: 'nn.py::MLP', projectRoot: tempRoot },
      });
      // 自动 resolve 成功 → 非 error
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const data = JSON.parse(content[0]?.text ?? '{}') as {
        code?: string;
        warnings?: string[];
        resolvedFrom?: string;
        resolvedTo?: string;
        definition?: unknown;
      };
      // 成功解析到 definition，无 symbol-not-found
      expect(data.code).toBeUndefined();
      // warnings 含 fuzzy-resolved（auto-resolve 元信息经 stdio 透传）
      expect(Array.isArray(data.warnings)).toBe(true);
      expect(data.warnings).toContain('fuzzy-resolved');
      // resolvedFrom/resolvedTo 透传完整
      expect(data.resolvedFrom).toBe('nn.py::MLP');
      expect(typeof data.resolvedTo).toBe('string');
      expect(data.resolvedTo!.length).toBeGreaterThan(0);
    }, 20_000);
  },
);
