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
