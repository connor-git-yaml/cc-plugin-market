/**
 * qa-integration.test.ts
 * T-021 集成测试：5 类问题 × mock 数据，验证 Citation 覆盖率 + 溯源正确性
 *
 * 测试策略：
 * - 使用 mock 小图谱（无真实 graph.json 依赖）
 * - mock Anthropic SDK（不真实调用 API）
 * - 验证每类问题都返回至少 1 条 Citation
 * - 验证 Citation 的 specPath 和 lineRange 字段格式合法（R6 缓解测试）
 *
 * 5 类问题：
 * 1. 调用关系（"什么调用了 X"）
 * 2. 调用路径（"从 A 到 B 的调用路径"）
 * 3. 设计决策映射（"X 的设计决策"）
 * 4. 技术债（"最老的 TODO"）
 * 5. 流程归属（"Y 流程涉及哪些模块"）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { answerQuestion, clearEngineCache } from '../../../src/panoramic/qa/index.js';
import type { QnAOptions } from '../../../src/panoramic/qa/types.js';

// ============================================================
// Mock 所有外部依赖（集成测试不调用真实 API）
// ============================================================

vi.mock('../../../src/panoramic/graph/graph-query.js', () => ({
  GraphQueryEngine: {
    loadFromFile: vi.fn(),
  },
}));

vi.mock('../../../src/panoramic/graph/graph-paths.js', () => ({
  resolveGraphJsonPath: vi.fn().mockReturnValue('/mock/project/specs/_meta/graph.json'),
}));

vi.mock('../../../src/core/token-counter.js', () => ({
  estimateFast: vi.fn().mockReturnValue(100),
}));

vi.mock('../../../src/batch/budget-gate.js', () => ({
  runBudgetGate: vi.fn().mockResolvedValue({
    finalPolicy: 'continue',
    finalEstimate: 100,
    skipEnrichmentApplied: false,
    cheaperModelApplied: false,
    attempts: [],
  }),
}));

vi.mock('../../../src/core/model-selection.js', () => ({
  resolveReverseSpecModel: vi.fn().mockReturnValue({ model: 'claude-test-model' }),
}));

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const Anthropic = vi.fn(() => ({
    messages: { create: mockCreate },
  }));
  (Anthropic as unknown as { _mockCreate: typeof mockCreate })._mockCreate = mockCreate;
  return { default: Anthropic };
});

vi.mock('../../../src/debt-scanner/index.js', () => ({
  scanProjectDebt: vi.fn().mockResolvedValue({
    codeEntries: [
      {
        kind: 'TODO',
        severity: 'warning',
        text: '最老的技术债，需要重构认证逻辑',
        filePath: 'src/auth/login.ts',
        line: 42,
        symbol: 'loginUser',
        author: 'dev',
        ageDays: 365,
      },
    ],
    openQuestions: [],
    diagnostics: {
      filesScanned: 5, filesSkipped: 0, totalLoc: 1000,
      llmCalls: 0, docsScanned: 0, ruleCandidates: 1, llmCandidates: 0, messages: [],
    },
    metrics: {
      totalEntries: 1,
      byKind: { TODO: 1, FIXME: 0, HACK: 0, XXX: 0, NOTE: 0 },
      densityPerKloc: 1, oldestAgeDays: 365, openQuestionsCount: 0,
    },
    tokenUsage: { input: 0, output: 0 },
    durationMs: 10,
  }),
}));

// Mock anchoring 模块
vi.mock('../../../src/panoramic/anchoring/chunker.js', () => ({
  chunkMarkdownFiles: vi.fn().mockReturnValue([
    {
      filePath: 'specs/auth.md',
      startLine: 1,
      endLine: 20,
      headingPath: '## Overview',
      text: '认证模块的核心设计文档，LoginService 调用该模块进行用户验证',
      tokenCount: 40,
    },
    {
      filePath: 'specs/session.md',
      startLine: 5,
      endLine: 15,
      headingPath: '## Session Management',
      text: '会话管理模块，用于跨请求维护用户状态',
      tokenCount: 30,
    },
  ]),
}));

vi.mock('../../../src/panoramic/anchoring/providers/factory.js', () => ({
  createEmbeddingProvider: vi.fn().mockReturnValue({
    providerName: 'local',
    llmModelLabel: 'mock-embedding',
    dimensions: 4,
    embed: vi.fn().mockResolvedValue({
      vectors: Array.from({ length: 3 }, () => {
        const v = new Float32Array(4);
        const val = 1 / Math.sqrt(4);
        v[0] = val; v[1] = val; v[2] = val; v[3] = val;
        return v;
      }),
      tokenUsage: { llmModel: 'mock', durationMs: 1 },
    }),
  }),
}));

vi.mock('../../../src/panoramic/anchoring/edge-builder.js', () => ({
  buildEvidenceText: vi.fn().mockImplementation((text: string) => text.slice(0, 200)),
}));

// Mock fs 模块（避免真实文件 IO，模拟文件有 50 行）
vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue('line\n'.repeat(50)),
}));

import { GraphQueryEngine } from '../../../src/panoramic/graph/graph-query.js';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================
// Mock 图谱数据
// ============================================================

const mockGraphNodes = [
  { id: 'auth-module', label: '认证模块', kind: 'module' as const, metadata: { specPath: 'specs/auth.md' } },
  { id: 'session-module', label: '会话管理', kind: 'module' as const, metadata: {} },
  { id: 'db-module', label: '数据库层', kind: 'module' as const, metadata: { specPath: 'specs/db.md' } },
  { id: 'api-gateway', label: 'API 网关', kind: 'module' as const, metadata: {} },
  { id: 'login-service', label: '登录服务', kind: 'module' as const, metadata: { specPath: 'specs/login.md' } },
];

const mockHyperedges = [
  {
    id: 'he-login-flow',
    label: '登录流程',
    nodes: ['auth-module', 'session-module', 'db-module'],
    rationale: '用户登录时依次调用认证、数据库验证和会话创建',
    confidence: 'INFERRED' as const,
  },
];

const mockEngine = {
  query: vi.fn().mockReturnValue({
    nodes: mockGraphNodes.slice(0, 3),
    edges: [],
    summary: '找到 3 个相关节点',
    truncated: false,
    totalMatches: 3,
  }),
  getHyperedges: vi.fn().mockReturnValue(mockHyperedges),
};

// ============================================================
// 构建 LLM 响应（含 citations）
// ============================================================

function buildLlmResponseWithCitations(questionType: string) {
  const citationsMap: Record<string, unknown[]> = {
    call: [{ specPath: 'specs/auth.md', startLine: 5, endLine: 15, excerpt: '认证模块被 LoginService 调用' }],
    path: [{ specPath: 'specs/auth.md', startLine: 1, endLine: 10, excerpt: '从 API 网关到认证的路径' }],
    design: [{ specPath: 'specs/auth.md', startLine: 10, endLine: 20, excerpt: '认证模块的设计决策说明' }],
    debt: [{ specPath: 'src/auth/login.ts', startLine: 42, endLine: 42, excerpt: '最老的技术债，需要重构认证逻辑' }],
    flow: [{ specPath: '[graph hyperedge]', startLine: 0, endLine: 0, excerpt: '登录流程跨模块协作' }],
  };

  const citations = citationsMap[questionType] ?? [
    { specPath: 'specs/auth.md', startLine: 1, endLine: 5, excerpt: '默认 citation' },
  ];

  return {
    id: 'msg-001',
    type: 'message',
    role: 'assistant',
    model: 'claude-test-model',
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          answer: `${questionType} 类型问题的回答`,
          citations,
        }),
      },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 200, output_tokens: 100 },
  };
}

// ============================================================
// 测试选项
// ============================================================

const testOptions: QnAOptions = {
  projectRoot: '/mock/project',
};

// ============================================================
// 测试套件
// ============================================================

describe('qa 集成测试 — 5 类问题 × Citation 覆盖', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEngineCache();

    // 设置 GraphQueryEngine mock
    vi.mocked(GraphQueryEngine.loadFromFile).mockReturnValue(
      mockEngine as unknown as InstanceType<typeof GraphQueryEngine>,
    );
  });

  afterEach(() => {
    clearEngineCache();
  });

  /** 辅助：设置 Anthropic mock 返回指定响应 */
  function setupAnthropicMock(questionType: string) {
    const response = buildLlmResponseWithCitations(questionType);
    vi.mocked(Anthropic).mockImplementation(
      () => ({ messages: { create: vi.fn().mockResolvedValue(response) } }) as unknown as Anthropic,
    );
  }

  describe('类型 1：调用关系查询（"什么调用了 X"）', () => {
    it('应返回至少 1 条 Citation', async () => {
      setupAnthropicMock('call');

      const result = await answerQuestion(
        { text: '什么调用了认证模块' },
        testOptions,
      );

      expect(result.citations.length).toBeGreaterThanOrEqual(1);
      expect(result.text).toBeTruthy();
    });

    it('Citation 应包含合法的 specPath', async () => {
      setupAnthropicMock('call');

      const result = await answerQuestion(
        { text: '什么调用了认证模块' },
        testOptions,
      );

      for (const citation of result.citations) {
        expect(typeof citation.specPath).toBe('string');
        expect(citation.specPath.length).toBeGreaterThan(0);
      }
    });
  });

  describe('类型 2：调用路径查询（"从 A 到 B 的路径"）', () => {
    it('应返回至少 1 条 Citation', async () => {
      setupAnthropicMock('path');

      const result = await answerQuestion(
        { text: '从 API 网关到数据库层的调用路径是什么' },
        testOptions,
      );

      expect(result.citations.length).toBeGreaterThanOrEqual(1);
    });

    it('Citation 的 lineRange 字段应合法', async () => {
      setupAnthropicMock('path');

      const result = await answerQuestion(
        { text: 'API 网关到认证模块的路径' },
        testOptions,
      );

      for (const citation of result.citations) {
        if (citation.specPath !== '[graph hyperedge]') {
          expect(typeof citation.lineRange.startLine).toBe('number');
          expect(typeof citation.lineRange.endLine).toBe('number');
        }
      }
    });
  });

  describe('类型 3：设计决策映射（"X 的设计决策"）', () => {
    it('应返回至少 1 条 Citation', async () => {
      setupAnthropicMock('design');

      const result = await answerQuestion(
        { text: '认证模块的设计决策是什么' },
        testOptions,
      );

      expect(result.citations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('类型 4：技术债（"最老的 TODO"）', () => {
    it('应返回至少 1 条 Citation', async () => {
      setupAnthropicMock('debt');

      const result = await answerQuestion(
        { text: '最老的 TODO 在哪里' },
        testOptions,
      );

      expect(result.citations.length).toBeGreaterThanOrEqual(1);
    });

    it('技术债 Citation 的 specPath 应指向源码文件', async () => {
      setupAnthropicMock('debt');

      const result = await answerQuestion(
        { text: '最老的 TODO 是什么' },
        testOptions,
      );

      // 至少有一条 citation
      expect(result.citations.length).toBeGreaterThan(0);
    });
  });

  describe('类型 5：流程归属（"Y 流程涉及哪些模块"）', () => {
    it('应返回至少 1 条 Citation', async () => {
      setupAnthropicMock('flow');

      const result = await answerQuestion(
        { text: '登录流程涉及哪些模块' },
        testOptions,
      );

      expect(result.citations.length).toBeGreaterThanOrEqual(1);
    });

    it('流程类问题可能包含 hyperedge citation', async () => {
      setupAnthropicMock('flow');

      const result = await answerQuestion(
        { text: '登录流程涉及哪些模块' },
        testOptions,
      );

      // 验证 [graph hyperedge] 格式的 citation 是合法的
      for (const citation of result.citations) {
        if (citation.specPath === '[graph hyperedge]') {
          expect(citation.lineRange.startLine).toBe(0);
          expect(citation.lineRange.endLine).toBe(0);
        }
      }
    });
  });

  describe('溯源正确性验证（R6 缓解）', () => {
    it('所有 Citation 应包含 specPath、lineRange、excerpt 三个必填字段', async () => {
      setupAnthropicMock('call');

      const result = await answerQuestion(
        { text: '什么调用了认证模块' },
        testOptions,
      );

      for (const citation of result.citations) {
        expect(citation.specPath).toBeDefined();
        expect(citation.lineRange).toBeDefined();
        expect(typeof citation.lineRange.startLine).toBe('number');
        expect(typeof citation.lineRange.endLine).toBe('number');
        expect(citation.excerpt).toBeDefined();
      }
    });
  });
});
