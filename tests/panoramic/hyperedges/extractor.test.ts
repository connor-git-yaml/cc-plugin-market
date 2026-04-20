/**
 * hyperedges/extractor.ts 单元测试
 *
 * 覆盖：
 * - feature flag 关闭 → 返回空数组，LLM 不被调用
 * - feature flag 开启，合法 LLM 响应 → 返回 hyperedge 数组
 * - Zod 校验失败 → 返回空数组 + failedSamples，不抛出异常
 * - LLM 返回超过 10 个 hyperedge → Zod 拒绝，返回空数组
 * - 所有 nodes 为文档类节点 → 语义校验过滤，返回空数组
 * - LLM 网络错误 → 抛出异常
 * - tokenUsage 记录格式正确
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import type { GraphNode } from '../../../src/panoramic/graph/graph-types.js';
import type { DocChunk } from '../../../src/panoramic/anchoring/chunker.js';
import { extractHyperedges } from '../../../src/panoramic/hyperedges/extractor.js';

// ============================================================
// 辅助：构造 mock Anthropic 客户端
// ============================================================

/** 构造模拟 Anthropic message response 的辅助函数 */
function makeMockResponse(content: string, inputTokens = 100, outputTokens = 50): Anthropic.Message {
  return {
    id: 'msg-test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text: content }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  } as Anthropic.Message;
}

/** 创建 mock Anthropic 客户端 */
function createMockClient(response: Anthropic.Message | Error): Anthropic {
  const mockCreate =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response);

  return {
    messages: {
      create: mockCreate,
    },
  } as unknown as Anthropic;
}

// ============================================================
// 测试 fixture
// ============================================================

/** 代码节点（kind 非文档类） */
const codeNodes: GraphNode[] = [
  { id: 'src/a.ts', kind: 'module', label: 'ModuleA', metadata: {} },
  { id: 'src/b.ts', kind: 'module', label: 'ModuleB', metadata: {} },
  { id: 'src/c.ts', kind: 'component', label: 'ComponentC', metadata: {} },
];

/** 文档类节点 */
const docNodes: GraphNode[] = [
  { id: 'specs/design.md', kind: 'spec', label: 'DesignSpec', metadata: {} },
  { id: 'docs/overview.md', kind: 'document', label: 'Overview', metadata: {} },
  { id: 'specs/api.md', kind: 'spec', label: 'ApiSpec', metadata: {} },
];

/** 模拟文档 chunk */
const docChunks: DocChunk[] = [
  {
    filePath: 'specs/design.md',
    startLine: 1,
    endLine: 20,
    headingPath: '## 摄取流程',
    text: '摄取流程涉及 ModuleA、ModuleB 和 ComponentC 三个模块协同处理数据。',
    tokenCount: 30,
  },
];

/** 合法的 LLM 响应 JSON */
const validLLMResponse = JSON.stringify({
  hyperedges: [
    {
      id: 'he-001',
      label: '摄取流程',
      nodes: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      rationale: '设计文档明确描述了三个模块的协同摄取流程',
      confidence: 'INFERRED',
    },
  ],
});

// ============================================================
// 测试用例
// ============================================================

describe('extractHyperedges', () => {
  describe('feature flag 行为', () => {
    it('feature flag 关闭时返回空结果，LLM 不被调用', async () => {
      const mockCreate = vi.fn();
      const client = { messages: { create: mockCreate } } as unknown as Anthropic;

      const result = await extractHyperedges({
        enabled: false,
        codeNodes,
        docChunks,
        anthropicClient: client,
      });

      // flag 关闭，LLM 不应被调用
      expect(mockCreate).not.toHaveBeenCalled();
      expect(result.hyperedges).toEqual([]);
      expect(result.usage).toEqual([]);
      expect(result.failedSamples).toEqual([]);
    });

    it('docChunks 为空时返回空结果，LLM 不被调用', async () => {
      const mockCreate = vi.fn();
      const client = { messages: { create: mockCreate } } as unknown as Anthropic;

      const result = await extractHyperedges({
        enabled: true,
        codeNodes,
        docChunks: [], // 空 chunks
        anthropicClient: client,
      });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(result.hyperedges).toEqual([]);
    });
  });

  describe('正常提取', () => {
    it('feature flag 开启且 LLM 返回合法结构时，返回 hyperedge 数组', async () => {
      const client = createMockClient(makeMockResponse(validLLMResponse));

      const result = await extractHyperedges({
        enabled: true,
        codeNodes,
        docChunks,
        anthropicClient: client,
      });

      expect(result.hyperedges).toHaveLength(1);
      expect(result.hyperedges[0]).toMatchObject({
        id: 'he-001',
        label: '摄取流程',
        nodes: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        confidence: 'INFERRED',
      });
      expect(result.failedSamples).toEqual([]);
    });

    it('LLM 返回 markdown 代码块包裹的 JSON 时，能正确解析', async () => {
      const wrappedResponse = `\`\`\`json\n${validLLMResponse}\n\`\`\``;
      const client = createMockClient(makeMockResponse(wrappedResponse));

      const result = await extractHyperedges({
        enabled: true,
        codeNodes,
        docChunks,
        anthropicClient: client,
      });

      expect(result.hyperedges).toHaveLength(1);
    });
  });

  describe('tokenUsage 记录', () => {
    it('tokenUsage 记录格式正确（含 llmModel、inputTokens、outputTokens、durationMs）', async () => {
      const client = createMockClient(makeMockResponse(validLLMResponse, 120, 60));

      const result = await extractHyperedges({
        enabled: true,
        codeNodes,
        docChunks,
        anthropicClient: client,
      });

      expect(result.usage).toHaveLength(1);
      const usage = result.usage[0]!;
      expect(usage.llmModel).toBe('claude-haiku-4-5-20251001');
      expect(usage.inputTokens).toBe(120);
      expect(usage.outputTokens).toBe(60);
      expect(typeof usage.durationMs).toBe('number');
      expect(usage.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('自定义 model 时，tokenUsage.llmModel 使用传入的 model 值', async () => {
      const client = createMockClient(makeMockResponse(validLLMResponse));
      const customModel = 'claude-sonnet-4-5-20250929';

      const result = await extractHyperedges({
        enabled: true,
        codeNodes,
        docChunks,
        anthropicClient: client,
        model: customModel,
      });

      expect(result.usage[0]?.llmModel).toBe(customModel);
    });
  });

  describe('Zod 校验失败处理', () => {
    it('LLM 返回非法结构（Zod 校验失败）时，返回空数组 + failedSamples，不抛出异常', async () => {
      const invalidResponse = JSON.stringify({
        hyperedges: [
          {
            id: 'he-001',
            label: '超长标签超过八个字符真的很长', // 超过 8 个字符
            nodes: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
            rationale: '设计文档描述',
            confidence: 'INFERRED',
          },
        ],
      });

      const client = createMockClient(makeMockResponse(invalidResponse));

      // 不应抛出异常
      const result = await extractHyperedges({
        enabled: true,
        codeNodes,
        docChunks,
        anthropicClient: client,
      });

      expect(result.hyperedges).toEqual([]);
      expect(result.failedSamples).toHaveLength(1);
      expect(result.failedSamples[0]!.raw).toBeDefined();
      expect(result.failedSamples[0]!.errors).toBeDefined();
    });

    it('LLM 返回超过 10 个 hyperedge 时，Zod schema 拒绝，返回空数组', async () => {
      // 构造 11 个合法的 hyperedge
      const tooManyHyperedges = {
        hyperedges: Array.from({ length: 11 }, (_, i) => ({
          id: `he-${String(i + 1).padStart(3, '0')}`,
          label: `流程${i + 1}`,
          nodes: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
          rationale: '设计文档描述了该流程',
          confidence: 'INFERRED',
        })),
      };

      const client = createMockClient(makeMockResponse(JSON.stringify(tooManyHyperedges)));

      const result = await extractHyperedges({
        enabled: true,
        codeNodes,
        docChunks,
        anthropicClient: client,
      });

      // batch > 10 被 Zod 拒绝
      expect(result.hyperedges).toEqual([]);
      expect(result.failedSamples).toHaveLength(1);
    });
  });

  describe('语义校验（FR-020）', () => {
    it('所有 hyperedge.nodes 均为文档类节点时，语义校验过滤后返回空数组', async () => {
      // 所有 nodes 都指向文档类节点（kind 为 spec/document）
      const docOnlyResponse = JSON.stringify({
        hyperedges: [
          {
            id: 'he-001',
            label: '设计流程',
            nodes: ['specs/design.md', 'docs/overview.md', 'specs/api.md'],
            rationale: '设计文档章节相互关联',
            confidence: 'INFERRED',
          },
        ],
      });

      // codeNodes 传入文档类节点（kind === 'spec'/'document'），导致 codeNodeIdSet 为空
      const client = createMockClient(makeMockResponse(docOnlyResponse));

      const result = await extractHyperedges({
        enabled: true,
        codeNodes: docNodes, // 全是文档节点，codeNodeIdSet 将为空
        docChunks,
        anthropicClient: client,
      });

      // 无代码节点匹配，语义校验全部失败
      expect(result.hyperedges).toEqual([]);
    });

    it('混合节点中至少 1 个代码节点时，语义校验通过', async () => {
      const mixedResponse = JSON.stringify({
        hyperedges: [
          {
            id: 'he-001',
            label: '混合流程',
            nodes: ['src/a.ts', 'specs/design.md', 'src/b.ts'], // 含代码节点
            rationale: '文档与代码协同描述了该流程',
            confidence: 'INFERRED',
          },
        ],
      });

      const client = createMockClient(makeMockResponse(mixedResponse));

      const result = await extractHyperedges({
        enabled: true,
        codeNodes, // codeNodes 中包含 src/a.ts, src/b.ts
        docChunks,
        anthropicClient: client,
      });

      // src/a.ts 和 src/b.ts 在 codeNodeIdSet 中，语义校验通过
      expect(result.hyperedges).toHaveLength(1);
    });
  });

  describe('LLM 网络错误', () => {
    it('LLM SDK 抛出网络错误时，异常向上传播', async () => {
      const networkError = new Error('Network error: connection refused');
      const client = createMockClient(networkError);

      await expect(
        extractHyperedges({
          enabled: true,
          codeNodes,
          docChunks,
          anthropicClient: client,
        }),
      ).rejects.toThrow('Network error');
    });
  });
});
