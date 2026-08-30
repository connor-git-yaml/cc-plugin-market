/**
 * Feature 140 T30 — hyperedge 首次 batch 集成测试
 *
 * 覆盖 spec FR-007：新项目首次 batch 后 hyperedge 不再 silently 跳过。
 *
 * **本文件实现策略**：mock Anthropic SDK + 临时目录构造 docChunks。
 *
 * 验证目标：
 * 1. 单批 docChunks（< 50k token）→ 单次 Map call → hyperedges 输出非空
 * 2. 多批 docChunks（> 50k token）→ FFD 装箱拆分 → 多次 Map → Reduce 去重
 * 3. 重复 hyperedge（同一 node-set）→ Reduce 后保留 rationale 最长的
 * 4. docChunks 为空 → 提前返回，不创建 Anthropic client
 *
 * **deferred（永久不做，Feature 272 裁决）**：曾以 `it.todo()` 占位的 4 条端到端用例中，
 * **3 条**——「fixture micrograd/nanoGPT/ky → graph.json.hyperedges.length」——永久删除，
 * 断言的是 **hyperedge 由 LLM 提取的语义产出**（`src/panoramic/hyperedges/extractor.ts`
 * 直接 `import Anthropic`）。本仓所有 e2e 测试统一 `vi.mock('@anthropic-ai/sdk')`（见
 * `tests/e2e/batch-pipeline.e2e.test.ts`），mock 出的"LLM 语义"是测试自己写进去的，
 * 填充这类用例只会得到断言恒真的表面工作，不是真实覆盖。这不是等待 fixture 落地后
 * 就能填的临时阻塞（4 个 fixture 均已存在），而是本仓测试基础设施（无真实 LLM 通道）
 * 下的结构性设计选择。非 LLM 部分的覆盖见本文件 case 1-7（FFD 装箱拆分 / Reduce 去重 /
 * fail-closed 等 pipeline 编排逻辑，用 mock LLM 响应驱动真实调用）。
 *
 * **第 4 条保留（Feature 272 复核更正）**：「fixture empty-project →
 * graph.json.hyperedges = []」断言的是**空输入下的缺席**（空项目没有 docChunks 可喂给
 * LLM，输出空数组与 LLM 说了什么无关，本文件 case 4「docChunks 为空 → 提前返回」已在
 * 单元层面覆盖同一不变量，这条只是其 fixture-based 端到端版本），不依赖 LLM 语义输出，
 * 技术上可填充。保留为 `it.todo`，待有人写 mock-LLM 集成用例填充；填充属新增测试覆盖
 * 而非清淤，已移交后续卡。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GraphNode, Hyperedge } from '../../src/panoramic/graph/graph-types.js';
import type { DocChunk } from '../../src/panoramic/anchoring/chunker.js';

// Mock Anthropic SDK — 避免真实 API 调用
const mockMessagesCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

import { runHyperedgeIntegration } from '../../src/panoramic/builders/doc-graph-builder.js';

beforeEach(() => {
  // mockReset 同时清除 calls 和 implementation（vi.clearAllMocks 只清 calls）
  // 防止前一 case 的 mockImplementation/mockResolvedValue 漂移到下一 case
  mockMessagesCreate.mockReset();
});

function makeCodeNode(id: string, label = id): GraphNode {
  return { id, kind: 'module', label, metadata: { source_file: id } };
}

function makeDocChunk(filePath: string, headingPath: string, text: string, tokenCount = 100): DocChunk {
  return {
    filePath,
    startLine: 1,
    endLine: text.split('\n').length,
    headingPath,
    text,
    tokenCount,
  };
}

function makeAnthropicResponse(hyperedges: Hyperedge[]) {
  // extractHyperedges 解析 LLM 返回的 JSON 数组
  return {
    content: [{ type: 'text', text: JSON.stringify(hyperedges) }],
    usage: { input_tokens: 1000, output_tokens: 500 },
  };
}

describe('Feature 140 FR-007 — hyperedge 首次 batch + MapReduce 接入', () => {
  it('case 1: 单批 docChunks 不超 token 预算 → 单次 Map → 输出非空', async () => {
    const codeNodes = [makeCodeNode('src/auth.ts'), makeCodeNode('src/db.ts'), makeCodeNode('src/api.ts')];
    const docChunks = [
      makeDocChunk('README.md', 'README', 'Project README', 200),
      makeDocChunk('docs/auth.md', '## Auth', 'Auth flow', 200),
    ];
    const fakeHyperedges: Hyperedge[] = [
      {
        id: 'h1',
        label: '认证流',
        nodes: ['src/auth.ts', 'src/db.ts', 'README.md'],
        rationale: 'Auth uses db for session storage',
        confidence: 'INFERRED',
      },
    ];
    mockMessagesCreate.mockResolvedValue(makeAnthropicResponse(fakeHyperedges));

    const result = await runHyperedgeIntegration({
      hyperedgesEnabled: true,
      graphNodes: codeNodes,
      docChunks,
    });

    expect(result.hyperedges.length).toBe(1);
    expect(result.hyperedges[0]!.label).toBe('认证流');
    // 仅触发 1 次 LLM call（单批，无需 FFD 拆分）
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it('case 2: docChunks 超 token 预算 → FFD 装箱拆多批 → 多次 Map call', async () => {
    const codeNodes = [makeCodeNode('src/a.ts'), makeCodeNode('src/b.ts'), makeCodeNode('src/c.ts')];
    // 6 个超大 chunk，每个 20k token，total 120k > 50k budget → 必触发拆分
    const docChunks = Array.from({ length: 6 }, (_, i) =>
      makeDocChunk(`docs/chunk${i}.md`, `## C${i}`, 'A'.repeat(60_000), 20_000),
    );
    const fakeHyperedges: Hyperedge[] = [
      {
        id: 'h-batch',
        label: '批次流',
        nodes: ['src/a.ts', 'src/b.ts', 'docs/chunk0.md'],
        rationale: 'batch hyperedge',
        confidence: 'INFERRED',
      },
    ];
    mockMessagesCreate.mockResolvedValue(makeAnthropicResponse(fakeHyperedges));

    const result = await runHyperedgeIntegration({
      hyperedgesEnabled: true,
      graphNodes: codeNodes,
      docChunks,
    });

    // 至少触发 2 次 LLM call（120k token / 50k budget = 3 bins）
    expect(mockMessagesCreate.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Reduce 后所有 batch 的同 node-set hyperedge 被去重为 1 条
    expect(result.hyperedges.length).toBe(1);
    expect(result.hyperedges[0]!.label).toBe('批次流');
  });

  it('case 3: 多批返回不同 hyperedge → Reduce 保留全部', async () => {
    const codeNodes = [makeCodeNode('src/x.ts'), makeCodeNode('src/y.ts'), makeCodeNode('src/z.ts')];
    const docChunks = Array.from({ length: 3 }, (_, i) =>
      makeDocChunk(`docs/d${i}.md`, `## D${i}`, 'B'.repeat(60_000), 20_000),
    );
    let callIdx = 0;
    mockMessagesCreate.mockImplementation(async () => {
      const idx = callIdx++;
      // 每批返回不同 node-set 的 hyperedge
      const hyperedges: Hyperedge[] = [
        {
          id: `h-batch-${idx}`,
          label: `流${idx}`,
          nodes: [`src/${['x', 'y', 'z'][idx]}.ts`, 'src/y.ts', `docs/d${idx}.md`],
          rationale: `batch ${idx}`,
          confidence: 'INFERRED',
        },
      ];
      return makeAnthropicResponse(hyperedges);
    });

    const result = await runHyperedgeIntegration({
      hyperedgesEnabled: true,
      graphNodes: codeNodes,
      docChunks,
    });
    // 不同 node-set → 都保留
    expect(result.hyperedges.length).toBeGreaterThanOrEqual(2);
  });

  it('case 4: 同 node-set 的多个 hyperedge → Reduce 保留 rationale 最长的', async () => {
    const codeNodes = [makeCodeNode('src/m.ts'), makeCodeNode('src/n.ts'), makeCodeNode('src/o.ts')];
    // 必须 tokenCount 总和 > 50k budget（默认）才会触发 FFD 拆分；这里 2 * 30k = 60k > 50k
    const docChunks = Array.from({ length: 2 }, (_, i) =>
      makeDocChunk(`docs/d${i}.md`, `## D${i}`, 'C'.repeat(60_000), 30_000),
    );
    let callIdx = 0;
    mockMessagesCreate.mockImplementation(async () => {
      const idx = callIdx++;
      // 两批返回相同 node-set 的 hyperedge（仅 rationale 长度不同）
      const hyperedges: Hyperedge[] = [
        {
          id: `h-${idx}`,
          label: '同流',
          nodes: ['src/m.ts', 'src/n.ts', 'src/o.ts'],
          rationale: idx === 0 ? 'short' : 'this is a much longer rationale with more semantic depth',
          confidence: 'INFERRED',
        },
      ];
      return makeAnthropicResponse(hyperedges);
    });

    const result = await runHyperedgeIntegration({
      hyperedgesEnabled: true,
      graphNodes: codeNodes,
      docChunks,
    });
    expect(result.hyperedges.length).toBe(1);
    // 保留长 rationale
    expect(result.hyperedges[0]!.rationale).toContain('much longer rationale');
  });

  it('case 5: hyperedgesEnabled=false → 提前返回，不调用 LLM', async () => {
    const result = await runHyperedgeIntegration({
      hyperedgesEnabled: false,
      graphNodes: [makeCodeNode('src/a.ts')],
      docChunks: [makeDocChunk('README.md', 'R', 'r')],
    });
    expect(result.hyperedges).toEqual([]);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('case 6: docChunks=[] → 提前返回，不调用 LLM（FR-015 降级）', async () => {
    const result = await runHyperedgeIntegration({
      hyperedgesEnabled: true,
      graphNodes: [makeCodeNode('src/a.ts')],
      docChunks: [],
    });
    expect(result.hyperedges).toEqual([]);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('case 7: Map 全部失败 → fail-closed 返回空 hyperedges（修复 Codex W-4 覆盖盲区）', async () => {
    const codeNodes = [makeCodeNode('src/a.ts'), makeCodeNode('src/b.ts'), makeCodeNode('src/c.ts')];
    // 3 个超大 chunk → FFD 拆出 3 个 bin → 3 次 Map call；全部抛错 → fail-closed
    const docChunks = Array.from({ length: 3 }, (_, i) =>
      makeDocChunk(`docs/big${i}.md`, `## B${i}`, 'D'.repeat(60_000), 30_000),
    );
    mockMessagesCreate.mockRejectedValue(new Error('mock LLM unavailable'));
    const result = await runHyperedgeIntegration({
      hyperedgesEnabled: true,
      graphNodes: codeNodes,
      docChunks,
    });
    // dispatchResult.finalOutput === null（< 50% Map 成功）→ runHyperedgeIntegration
    // 返回 hyperedges=[]（与 disabled / 空 chunks 行为一致，caller 看到空数组就跳过写入）
    expect(result.hyperedges).toEqual([]);
    // tokenUsage 也为空（fail-closed 不向 caller 报告失败的 LLM 用量）
    expect(result.tokenUsage).toEqual([]);
    // 至少触发了 3 次 LLM 调用尝试（每个 oversized bin 一次）
    expect(mockMessagesCreate.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  // ============================================================================
  // 技术上可填充（断言空输入下的缺席，不依赖 LLM 语义输出），待有人写 mock-LLM
  // 集成用例填充；填充属新增测试覆盖而非清淤，已移交后续卡（Feature 272 裁决⑥复核更正）。
  // ============================================================================
  it.todo('fixture empty-project → graph.json.hyperedges = []');
});
