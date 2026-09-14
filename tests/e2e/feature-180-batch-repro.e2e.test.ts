/**
 * Feature 180 — batch MCP 路径 + reproducibility（Story #9/#12）
 *
 * 验证 batch 工具在 stdio 链路下：
 *   T-010-3: batch { mode: 'incremental' }（非法 enum）→ SDK 拒绝（无需 LLM，必跑）
 *
 * 需要 LLM 可用时（HAS_LLM_E2E=1）额外验证：
 *   T-010-1: batch { incremental: true, languages: ['python'] } → 响应可解析，isError 合理
 *   T-010-2: batch { full: true, languages: ['python'] }（regen 逃生口）→ 响应 isError 不为 true
 *   T-010-4: 两次 batch { full: true, mode: 'full', languages: ['python'] } → 代码派生子图（节点集 + 非 specs 来源、非 INFERRED 的边）deepEqual
 *   T-010-5: 两次 full batch 的差异只限于 inputHash 与 specs 来源的 INFERRED 边（钉住非确定性边界）
 *
 * 实测复核（T-011 节点）：
 *   batch LLM timeout 实测：runBatch 始终调 generateSpec → callLLM，mode='code-only' 只跳 enrichment
 *   micrograd python-only 全量跑约 3-5 分钟（不稳定，取决于 LLM 响应速度）
 *   因此 T-010-1/2/4/5 gate 在 HAS_LLM_E2E=1，缺省 skip（keyless CI 友好）
 *
 * 2026-09-14 首次真跑（SDK 请求超时补齐后）：T-010-2 128s 通过；T-010-1 在 170s 超时（同形调用需与 full 同预算 300s）；
 *   T-010-4/5 原断言「两次 LLM full batch 的 graph.json 逐字节 / 归一化后相同」**前提不成立**：同一 tempRoot 上第二次
 *   运行的输入包含第一次写出的 specs（`graph.inputHash` 必变），且 LLM 重生的 spec 文本让 `specs/*.spec.md → 代码` 的
 *   INFERRED `references` 边不同——这两条自立项起从未跑通过，前提从未被检验。graph 写盘侧的 byte-stable 由
 *   `tests/unit/graph/graph-builder-bytestable.test.ts` 与 feature-175 场景10（同输入 full vs 无改动增量）守护；
 *   本文件改为断言 LLM 运行之间**确定的那部分**（代码派生子图）稳定，并钉住差异边界。
 *
 * Codex Plan-Warning-3：batch 两条正交轴
 *   (a) regen 轴：full/force/incremental 布尔（控制绕 cache）
 *   (b) 质量轴：mode='full'|'reading'|'code-only'（控制文档层级）
 *   mode='incremental' 不合法（不是 enum 成员），被 SDK/Zod 拒绝
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawnMcpClient,
  buildSkipCondition,
  buildSkipReason,
  MICROGRAD_SOURCE,
  type McpClientHandle,
} from './helpers/stdio-client.js';

// batch 测试需要 dist + micrograd 源 clone（copyDirShallow 从 MICROGRAD_SOURCE 拷贝到 tempRoot）
const SHOULD_SKIP = buildSkipCondition(true);
const SKIP_REASON = buildSkipReason(true);

// LLM E2E gate：HAS_LLM_E2E=1 时才跑真实 batch（依赖 LLM）
const HAS_LLM_E2E = process.env['HAS_LLM_E2E'] === '1';

/** 递归拷贝目录（浅拷贝，只拷一层子目录，够 micrograd 用） */
function copyDirShallow(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      for (const sub of readdirSync(srcPath, { withFileTypes: true })) {
        if (sub.isFile()) {
          copyFileSync(join(srcPath, sub.name), join(destPath, sub.name));
        }
      }
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}

// ── T-010-3: mode='incremental' 非法 enum（无需 LLM，必跑）──
describe.skipIf(SHOULD_SKIP)(
  `用户故事: batch { mode: 'incremental' } 非法 enum 被 SDK 拒绝（无需 LLM，验证入参契约边界）${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;

    beforeAll(async () => {
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-180-batch-enum-'));
      handle = await spawnMcpClient({ cwd: tempRoot });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    // T-010-3: mode='incremental' 不是合法 enum 值（合法值：full/reading/code-only）
    it('T-010-3: batch { mode: "incremental" } 非法 enum → 被拒绝（isError=true 或异常）', async () => {
      let errorMessage = '';
      let result: Awaited<ReturnType<typeof handle.client.callTool>> | null = null;
      try {
        result = await handle.client.callTool({
          name: 'batch',
          arguments: {
            mode: 'incremental',  // 非法 enum，SDK/Zod 应在 handler 前拒绝
          },
        });
      } catch (e) {
        errorMessage = e instanceof Error ? e.message : String(e);
      }
      // 强断这是 **SDK schema 校验拒绝**（-32602 Invalid params / invalid_enum_value），
      // 而非 handler 被错误执行后返回的业务 {code} envelope（Codex Impl-C5）。
      // 实测：返回 isError=true，text="MCP error -32602: Input validation error:
      //   Invalid arguments for tool batch: [...invalid_enum_value...options:full/reading/code-only]"
      const respText =
        result?.isError === true
          ? ((result.content as Array<{ text?: string }>)[0]?.text ?? '')
          : '';
      const combined = errorMessage + respText;
      if (!combined) {
        console.log('[T-010-3 未拒绝响应]', JSON.stringify(result).slice(0, 300));
      }
      // 必须是 SDK 参数校验错误形态，不是业务错误码（如 graph-not-built 之类）
      expect(combined).toMatch(/-32602|Invalid arguments|invalid_enum_value/);
      // 反向断言：不应是 handler 业务 envelope（不含我们的 ErrorCode 形态 {"code":"..."}）
      expect(combined).not.toMatch(/"code"\s*:\s*"(internal-error|graph-not-built|invalid-input)"/);
    }, 20_000);
  },
);

// ── batch smoke + reproducibility（需要 HAS_LLM_E2E=1）──
describe.skipIf(!HAS_LLM_E2E || SHOULD_SKIP)(
  `用户故事: batch MCP 路径 smoke + reproducibility（需 HAS_LLM_E2E=1）${!HAS_LLM_E2E ? ' [skip: HAS_LLM_E2E 未设]' : SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;
    // MCP SDK 请求超时默认 60s，而真实 LLM batch（micrograd python-only）实测 2–5 分钟：不显式传 timeout
    // 这四条用例结构性跑不通（2026-09-14 实跑 4/4 `MCP error -32001: Request timed out` @60016ms）。
    // 单次 batch 统一 300s 预算（09-14 实跑：full 128s 通过，incremental 170s 超时）；it 超时取 330s / 720s（两次）。
    // batch 不发 progress 通知，resetTimeoutOnProgress 不起作用，预算是绝对值。
    const LLM_BATCH_REQUEST_TIMEOUT_MS = 300_000;
    const callBatch = (args: Record<string, unknown>) =>
      handle.client.callTool({ name: 'batch', arguments: args }, undefined, { timeout: LLM_BATCH_REQUEST_TIMEOUT_MS });

    // 代码派生子图：节点 id 集合 + 来源 / 目标都不在 specs/ 下且非 INFERRED 的边；spec 派生的 INFERRED 边随 LLM 文本变
    type GraphLink = { source: string; target: string; relation?: string; confidence?: string };
    type GraphJson = { graph?: Record<string, unknown>; nodes: Array<{ id: string }>; links: GraphLink[] };
    const readGraph = (root: string): GraphJson => JSON.parse(readFileSync(join(root, 'specs', '_meta', 'graph.json'), 'utf-8')) as GraphJson;
    const isSpecDerived = (l: GraphLink) => l.confidence === 'INFERRED' || l.source.startsWith('specs/') || l.target.startsWith('specs/');
    const codeSubgraph = (g: GraphJson) => ({
      nodes: g.nodes.map((n) => n.id).sort(),
      links: g.links.filter((l) => !isSpecDerived(l)).map((l) => `${l.source}|${l.relation ?? ''}|${l.target}`).sort(),
    });

    beforeAll(async () => {
      // 拷贝 micrograd 源文件到可写 tempRoot（batch 会写 spec 产物）
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-180-batch-llm-'));
      copyDirShallow(MICROGRAD_SOURCE, tempRoot);

      handle = await spawnMcpClient({ cwd: tempRoot });
    }, 60_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    // T-010-1: incremental batch → 响应可解析
    it('T-010-1: batch { incremental: true, languages: ["python"] } → 响应可解析，isError 合理', async () => {
      const result = await callBatch({
          incremental: true,
          languages: ['python'],
          projectRoot: tempRoot,
        });
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      expect(() => JSON.parse(text)).not.toThrow();
      // 不深验 deltaReport 内容语义（LLM 随机性，只验格式）
    }, 330_000);

    // T-010-2: full batch（regen 逃生口）→ isError 不为 true
    it('T-010-2: batch { full: true, languages: ["python"] }（regen 逃生口）→ isError 不为 true', async () => {
      const result = await callBatch({
          full: true,
          languages: ['python'],
          projectRoot: tempRoot,
        });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      expect(() => JSON.parse(text)).not.toThrow();
    }, 330_000);

    // T-010-4: 两次 full batch → 代码派生子图 deepEqual（LLM 运行之间确定的那部分）
    it('T-010-4: 两次 batch { full:true, mode:"full" } → 代码派生子图（节点集 + 非 specs 来源、非 INFERRED 的边）deepEqual', async () => {
      await callBatch({ full: true, mode: 'full', languages: ['python'], projectRoot: tempRoot });
      const g1 = readGraph(tempRoot);
      await callBatch({ full: true, mode: 'full', languages: ['python'], projectRoot: tempRoot });
      const g2 = readGraph(tempRoot);
      expect(codeSubgraph(g1).nodes.length).toBeGreaterThan(0);
      expect(codeSubgraph(g2)).toEqual(codeSubgraph(g1));
    }, 720_000);

    // T-010-5: 钉住非确定性边界——两次运行的差异只允许落在 inputHash 与 spec 派生（INFERRED）边上
    it('T-010-5: 两次 full batch 的差异只限于 graph.inputHash 与 specs 来源的 INFERRED 边（非确定性边界）', async () => {
      await callBatch({ full: true, mode: 'full', languages: ['python'], projectRoot: tempRoot });
      const g1 = readGraph(tempRoot);
      await callBatch({ full: true, mode: 'full', languages: ['python'], projectRoot: tempRoot });
      const g2 = readGraph(tempRoot);
      const stripVolatile = (g: GraphJson) => {
        const graph = { ...(g.graph ?? {}) } as Record<string, unknown>;
        delete graph['inputHash'];
        delete graph['generatedAt'];
        return { graph, nodes: g.nodes.map((n) => n.id).sort(), links: g.links.filter((l) => !isSpecDerived(l)).map((l) => `${l.source}|${l.relation ?? ''}|${l.target}`).sort() };
      };
      expect(stripVolatile(g2)).toEqual(stripVolatile(g1));
      // 落盘侧 byte-stable（F179）：generatedAt 固定 epoch，两次一致
      expect(g1.graph?.['generatedAt']).toBe('1970-01-01T00:00:00.000Z');
      expect(g2.graph?.['generatedAt']).toBe('1970-01-01T00:00:00.000Z');
    }, 720_000);
  },
);
