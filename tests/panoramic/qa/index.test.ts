/**
 * index.test.ts
 * T-020 单元测试：answerQuestion() 7 步串联 + 边界条件
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { answerQuestion, clearEngineCache } from '../../../src/panoramic/qa/index.js';
import type { QnAQuery, QnAOptions } from '../../../src/panoramic/qa/types.js';

// ============================================================
// Mock 所有依赖模块
// ============================================================

vi.mock('../../../src/panoramic/graph/graph-query.js', () => ({
  GraphQueryEngine: {
    loadFromFile: vi.fn(),
  },
}));

vi.mock('../../../src/panoramic/graph/graph-paths.js', () => ({
  resolveGraphJsonPath: vi.fn().mockReturnValue('/project/specs/_meta/graph.json'),
}));

vi.mock('../../../src/panoramic/qa/graph-retriever.js', () => ({
  retrieveGraphContext: vi.fn(),
}));

vi.mock('../../../src/panoramic/qa/rag-reranker.js', () => ({
  rerankWithEmbedding: vi.fn(),
}));

vi.mock('../../../src/panoramic/qa/debt-context.js', () => ({
  injectDebtContext: vi.fn(),
}));

vi.mock('../../../src/panoramic/qa/citation.js', () => ({
  buildCitations: vi.fn(),
}));

vi.mock('../../../src/panoramic/qa/prompt-builder.js', () => ({
  buildQnAPrompt: vi.fn(),
}));

vi.mock('../../../src/panoramic/qa/llm-caller.js', () => ({
  callQnALlm: vi.fn(),
}));

import { GraphQueryEngine } from '../../../src/panoramic/graph/graph-query.js';
import { retrieveGraphContext } from '../../../src/panoramic/qa/graph-retriever.js';
import { rerankWithEmbedding } from '../../../src/panoramic/qa/rag-reranker.js';
import { injectDebtContext } from '../../../src/panoramic/qa/debt-context.js';
import { buildCitations } from '../../../src/panoramic/qa/citation.js';
import { buildQnAPrompt } from '../../../src/panoramic/qa/prompt-builder.js';
import { callQnALlm } from '../../../src/panoramic/qa/llm-caller.js';

// ============================================================
// Mock 数据设置工具
// ============================================================

/** 设置正常流程的 mock 数据 */
function setupNormalMocks() {
  const mockEngine = {
    query: vi.fn(),
    getHyperedges: vi.fn(),
    getNode: vi.fn(),
    findPath: vi.fn(),
    getCommunity: vi.fn(),
    getSemanticEdges: vi.fn(),
    graph: { nodes: [{ id: 'n1' }] },
  };

  vi.mocked(GraphQueryEngine.loadFromFile).mockReturnValue(
    mockEngine as unknown as InstanceType<typeof GraphQueryEngine>,
  );

  vi.mocked(retrieveGraphContext).mockReturnValue({
    bfsNodes: [
      { id: 'node-auth', label: '认证模块', kind: 'module' },
      { id: 'node-db', label: '数据库', kind: 'module' },
      { id: 'node-session', label: '会话', kind: 'module' },
    ],
    topChunks: [],
    hyperedges: [],
    fallbackMode: undefined,
  });

  vi.mocked(rerankWithEmbedding).mockResolvedValue({
    rankedChunks: [
      {
        chunk: {
          filePath: 'specs/auth.md',
          startLine: 5,
          endLine: 10,
          headingPath: '## Auth',
          text: '认证模块说明',
          tokenCount: 20,
        },
        similarity: 0.85,
        nodeId: 'node-auth',
      },
    ],
  });

  vi.mocked(injectDebtContext).mockResolvedValue({
    triggered: false,
    citations: [],
  });

  vi.mocked(buildCitations).mockReturnValue([
    {
      specPath: 'specs/auth.md',
      lineRange: { startLine: 5, endLine: 10 },
      excerpt: '认证模块说明',
      nodeId: 'node-auth',
    },
  ]);

  vi.mocked(buildQnAPrompt).mockReturnValue({
    systemPrompt: '你是助手',
    userPrompt: '什么调用了认证模块',
  });

  vi.mocked(callQnALlm).mockResolvedValue({
    answer: '认证模块被 LoginService 调用',
    parsedCitations: [
      {
        specPath: 'specs/auth.md',
        lineRange: { startLine: 5, endLine: 10 },
        excerpt: '认证模块说明',
      },
    ],
    tokenUsage: { input: 100, output: 50, overBudget: false },
  });

  return mockEngine;
}

// ============================================================
// 默认选项
// ============================================================

const defaultOptions: QnAOptions = {
  projectRoot: '/project',
};

// ============================================================
// 测试套件
// ============================================================

describe('answerQuestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEngineCache();
  });

  afterEach(() => {
    clearEngineCache();
  });

  describe('正常 7 步串联', () => {
    it('应返回包含 text、citations、tokenUsage 的 QnAAnswer', async () => {
      setupNormalMocks();

      const query: QnAQuery = { text: '什么调用了认证模块' };
      const result = await answerQuestion(query, defaultOptions);

      expect(result.text).toBeTruthy();
      expect(Array.isArray(result.citations)).toBe(true);
      expect(result.tokenUsage).toBeDefined();
      expect(typeof result.durationMs).toBe('number');
    });

    it('应依次调用 retrieveGraphContext、rerankWithEmbedding、injectDebtContext、buildCitations、buildQnAPrompt、callQnALlm', async () => {
      setupNormalMocks();

      await answerQuestion({ text: '测试问题' }, defaultOptions);

      expect(retrieveGraphContext).toHaveBeenCalledOnce();
      expect(rerankWithEmbedding).toHaveBeenCalledOnce();
      expect(injectDebtContext).toHaveBeenCalledOnce();
      expect(buildCitations).toHaveBeenCalledOnce();
      expect(buildQnAPrompt).toHaveBeenCalledOnce();
      expect(callQnALlm).toHaveBeenCalledOnce();
    });

    it('应包含 durationMs 字段（>= 0）', async () => {
      setupNormalMocks();

      const result = await answerQuestion({ text: '测试' }, defaultOptions);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('边界条件 — 空字符串查询', () => {
    it('空字符串应抛出 Error（不调用 LLM）', async () => {
      await expect(
        answerQuestion({ text: '' }, defaultOptions),
      ).rejects.toThrow(/不能为空/);

      expect(callQnALlm).not.toHaveBeenCalled();
    });

    it('全空格字符串应抛出 Error', async () => {
      await expect(
        answerQuestion({ text: '   ' }, defaultOptions),
      ).rejects.toThrow(/不能为空/);
    });
  });

  describe('边界条件 — 超长查询截断', () => {
    it('> 2000 字符的查询应截断到 2000 字符', async () => {
      setupNormalMocks();

      const longQuery = 'A'.repeat(2500);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await answerQuestion({ text: longQuery }, defaultOptions);

      // retrieveGraphContext 应被调用，且问题被截断
      expect(retrieveGraphContext).toHaveBeenCalledWith(
        'A'.repeat(2000),
        expect.anything(),
        expect.anything(),
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('截断'));

      warnSpy.mockRestore();
    });
  });

  describe('边界条件 — 空图谱', () => {
    it('BFS 命中 0 节点时应返回"图谱为空"提示', async () => {
      vi.mocked(GraphQueryEngine.loadFromFile).mockReturnValue(
        {} as unknown as InstanceType<typeof GraphQueryEngine>,
      );

      vi.mocked(retrieveGraphContext).mockReturnValue({
        bfsNodes: [],      // 0 个节点
        topChunks: [],
        hyperedges: [],
        fallbackMode: 'rag-only',
      });

      const result = await answerQuestion({ text: '测试' }, defaultOptions);

      expect(result.text).toContain('图谱为空');
      expect(result.citations).toEqual([]);
      expect(callQnALlm).not.toHaveBeenCalled();
    });

    it('图谱文件不存在时应返回友好提示', async () => {
      vi.mocked(GraphQueryEngine.loadFromFile).mockImplementation(() => {
        throw new Error('无法读取图谱文件');
      });

      const result = await answerQuestion({ text: '测试' }, defaultOptions);

      expect(result.text).toContain('图谱为空');
      expect(callQnALlm).not.toHaveBeenCalled();
    });
  });

  describe('边界条件 — LLM 调用失败', () => {
    it('LLM 调用失败时应抛出 Error', async () => {
      setupNormalMocks();
      vi.mocked(callQnALlm).mockRejectedValue(new Error('API 调用超时'));

      await expect(
        answerQuestion({ text: '测试' }, defaultOptions),
      ).rejects.toThrow(/LLM 调用失败/);
    });
  });

  describe('边界条件 — W-002：BFS<3 且 RAG 0 chunks 二级降级', () => {
    it('fallbackMode=rag-only 且 rankedChunks 为空时应返回"图谱数据不足"提示，不调用 LLM', async () => {
      vi.mocked(GraphQueryEngine.loadFromFile).mockReturnValue(
        {} as unknown as InstanceType<typeof GraphQueryEngine>,
      );

      // BFS 命中节点少于 3 个，graph-retriever 设置 fallbackMode='rag-only'
      vi.mocked(retrieveGraphContext).mockReturnValue({
        bfsNodes: [
          { id: 'node-a', label: '模块 A', kind: 'module' },
        ],
        topChunks: [],
        hyperedges: [],
        fallbackMode: 'rag-only',
      });

      // RAG 精排未命中任何 chunk
      vi.mocked(rerankWithEmbedding).mockResolvedValue({
        rankedChunks: [],
      });

      const result = await answerQuestion({ text: '测试问题' }, defaultOptions);

      expect(result.text).toContain('图谱数据不足');
      expect(result.text).toContain('BFS 命中候选节点不足 3 个');
      expect(result.citations).toEqual([]);
      expect(result.fallbackMode).toBe('rag-only');
      // 不应调用后续 LLM 步骤
      expect(callQnALlm).not.toHaveBeenCalled();
    });

    it('fallbackMode=bfs-only 时即使 rankedChunks 为空也继续正常流程', async () => {
      setupNormalMocks();
      // 覆盖为 bfs-only 降级
      vi.mocked(retrieveGraphContext).mockReturnValue({
        bfsNodes: [
          { id: 'node-a', label: '模块 A', kind: 'module' },
        ],
        topChunks: [],
        hyperedges: [],
        fallbackMode: 'bfs-only',
      });
      vi.mocked(rerankWithEmbedding).mockResolvedValue({
        rankedChunks: [],
        fallbackMode: 'bfs-only',
      });

      // bfs-only 应继续走 LLM（不触发 W-002 二级降级）
      const result = await answerQuestion({ text: '测试' }, defaultOptions);
      expect(callQnALlm).toHaveBeenCalledOnce();
      // bfs-only + 无引用时会触发 W-004 兜底提示
      expect(result).toBeDefined();
    });
  });

  describe('边界条件 — W-004：finalCitations 为空时加注无引用警告', () => {
    it('LLM parsedCitations 为空且 buildCitations 也为空时 answer 前应加注"[注意：本答案无引用"', async () => {
      setupNormalMocks();

      vi.mocked(buildCitations).mockReturnValue([]);
      vi.mocked(callQnALlm).mockResolvedValue({
        answer: '这是一个没有引用的回答',
        parsedCitations: [],
        tokenUsage: { input: 100, output: 50, overBudget: false },
      });

      const result = await answerQuestion({ text: '测试' }, defaultOptions);

      expect(result.citations).toEqual([]);
      expect(result.text).toContain('[注意：本答案无引用');
      expect(result.text).toContain('这是一个没有引用的回答');
    });

    it('finalCitations 非空时 answer 不加注无引用警告', async () => {
      setupNormalMocks();

      const result = await answerQuestion({ text: '测试' }, defaultOptions);

      // setupNormalMocks 中有 parsedCitations，不为空
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.text).not.toContain('[注意：本答案无引用');
    });
  });

  describe('citations 合并', () => {
    it('LLM 解析的 citations 非空时应优先使用', async () => {
      setupNormalMocks();

      const llmCitations = [
        {
          specPath: 'specs/login.md',
          lineRange: { startLine: 1, endLine: 5 },
          excerpt: 'LLM 提供的 citation',
        },
      ];

      vi.mocked(callQnALlm).mockResolvedValue({
        answer: '回答',
        parsedCitations: llmCitations,
        tokenUsage: { input: 100, output: 50, overBudget: false },
      });

      const result = await answerQuestion({ text: '测试' }, defaultOptions);

      expect(result.citations).toEqual(llmCitations);
    });

    it('LLM 返回空 citations 时应 fallback 到 buildCitations 的结果', async () => {
      setupNormalMocks();

      const builtCitations = [
        {
          specPath: 'specs/auth.md',
          lineRange: { startLine: 5, endLine: 10 },
          excerpt: 'built citation',
        },
      ];

      vi.mocked(buildCitations).mockReturnValue(builtCitations);
      vi.mocked(callQnALlm).mockResolvedValue({
        answer: '回答',
        parsedCitations: [],   // LLM 没有解析到 citations
        tokenUsage: { input: 100, output: 50, overBudget: false },
      });

      const result = await answerQuestion({ text: '测试' }, defaultOptions);

      expect(result.citations).toEqual(builtCitations);
    });
  });
});
