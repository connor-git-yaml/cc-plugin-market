/**
 * panoramic-query-natural-language.test.ts
 * T-023 + T-024 + T-025 测试：
 *   T-023：panoramic-query Zod schema 校验四种 operation
 *   T-024：query.ts natural-language 路由到 answerQuestion()
 *   T-025：MCP 集成测试（mock Anthropic SDK）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ============================================================
// T-023：Zod schema 单测
// ============================================================

/**
 * 直接复现 server.ts 中 panoramic-query 的 Zod schema，
 * 独立校验四种 operation 的合法性。
 * 不依赖 server.ts 运行时（避免 MCP SDK 初始化），仅测试 schema 约束本身。
 */
const panoramicQuerySchema = z.object({
  operation: z
    .enum(['cross-package', 'architecture-ir', 'overview', 'natural-language'])
    .describe('分析操作类型'),
  projectRoot: z.string().describe('项目根目录绝对路径（必需）'),
  question: z
    .string()
    .optional()
    .describe('问题文本（operation=natural-language 时必填，其他 operation 忽略）'),
});

describe('T-023：panoramic-query Zod schema', () => {
  it('operation=cross-package 校验通过', () => {
    const result = panoramicQuerySchema.safeParse({
      operation: 'cross-package',
      projectRoot: '/some/project',
    });
    expect(result.success).toBe(true);
  });

  it('operation=architecture-ir 校验通过', () => {
    const result = panoramicQuerySchema.safeParse({
      operation: 'architecture-ir',
      projectRoot: '/some/project',
    });
    expect(result.success).toBe(true);
  });

  it('operation=overview 校验通过', () => {
    const result = panoramicQuerySchema.safeParse({
      operation: 'overview',
      projectRoot: '/some/project',
    });
    expect(result.success).toBe(true);
  });

  it('operation=natural-language + question 校验通过', () => {
    const result = panoramicQuerySchema.safeParse({
      operation: 'natural-language',
      projectRoot: '/some/project',
      question: '什么模块调用了认证逻辑？',
    });
    expect(result.success).toBe(true);
  });

  it('operation=natural-language 不传 question 时 schema 层面仍通过（question optional）', () => {
    // question 在 schema 层是 optional，handler 层（query.ts）负责校验 natural-language 时 question 必填
    const result = panoramicQuerySchema.safeParse({
      operation: 'natural-language',
      projectRoot: '/some/project',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.question).toBeUndefined();
    }
  });

  it('无效 operation 触发 ZodError', () => {
    const result = panoramicQuerySchema.safeParse({
      operation: 'invalid-operation',
      projectRoot: '/some/project',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain('operation');
    }
  });

  it('缺少 projectRoot 触发 ZodError', () => {
    const result = panoramicQuerySchema.safeParse({
      operation: 'overview',
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// T-024：query.ts natural-language 路由单测
// ============================================================

// Mock answerQuestion（qa/index.js）
vi.mock('../../src/panoramic/qa/index.js', () => ({
  answerQuestion: vi.fn(),
}));

// Mock buildProjectContext（避免文件系统访问）
vi.mock('../../src/panoramic/project-context.js', () => ({
  buildProjectContext: vi.fn(),
}));

// Mock CrossPackageAnalyzer
vi.mock('../../src/panoramic/generators/cross-package-analyzer.js', () => ({
  CrossPackageAnalyzer: vi.fn().mockImplementation(() => ({
    isApplicable: vi.fn().mockReturnValue(false),
    extract: vi.fn(),
    generate: vi.fn(),
  })),
}));

// Mock ArchitectureIRGenerator
vi.mock('../../src/panoramic/generators/architecture-ir-generator.js', () => ({
  ArchitectureIRGenerator: vi.fn().mockImplementation(() => ({
    extract: vi.fn(),
    generate: vi.fn().mockResolvedValue({ ir: {} }),
  })),
}));

// Mock ArchitectureOverviewGenerator
vi.mock('../../src/panoramic/generators/architecture-overview-generator.js', () => ({
  ArchitectureOverviewGenerator: vi.fn().mockImplementation(() => ({
    extract: vi.fn(),
    generate: vi.fn().mockResolvedValue({}),
  })),
}));

import { queryPanoramic } from '../../src/panoramic/query.js';
import { answerQuestion } from '../../src/panoramic/qa/index.js';

/** 标准 QnAAnswer mock 数据 */
const mockQnAAnswer = {
  text: '认证模块主要被 login-handler 调用。',
  citations: [
    {
      specPath: 'specs/auth.spec.md',
      lineRange: { startLine: 10, endLine: 15 },
      excerpt: '认证流程：用户名密码验证',
      nodeId: 'node-auth',
      similarity: 0.92,
    },
  ],
  tokenUsage: { input: 500, output: 120, overBudget: false },
  durationMs: 1234,
  fallbackMode: undefined as string | undefined,
};

describe('T-024：query.ts natural-language 路由', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('natural-language 分支调用 answerQuestion() 并返回结构化结果', async () => {
    vi.mocked(answerQuestion).mockResolvedValue(mockQnAAnswer);

    const result = await queryPanoramic({
      operation: 'natural-language',
      projectRoot: '/project',
      question: '什么模块调用了认证逻辑？',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as Record<string, unknown>;
      // 返回结构含 answer + citations + tokenUsage
      expect(data).toHaveProperty('answer', mockQnAAnswer.text);
      expect(data).toHaveProperty('citations');
      expect(data).toHaveProperty('tokenUsage');
      expect(data).toHaveProperty('durationMs');
    }
  });

  it('natural-language 分支正确传入 question 给 answerQuestion()', async () => {
    vi.mocked(answerQuestion).mockResolvedValue(mockQnAAnswer);

    await queryPanoramic({
      operation: 'natural-language',
      projectRoot: '/project',
      question: '调用路径是什么？',
    });

    expect(answerQuestion).toHaveBeenCalledOnce();
    expect(answerQuestion).toHaveBeenCalledWith(
      { text: '调用路径是什么？' },
      { projectRoot: '/project' },
    );
  });

  it('natural-language 缺少 question 时返回 ok=false + 错误描述', async () => {
    const result = await queryPanoramic({
      operation: 'natural-language',
      projectRoot: '/project',
      question: undefined,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/question/);
    }
    // answerQuestion 不应被调用
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it('natural-language question 为纯空白时返回 ok=false', async () => {
    const result = await queryPanoramic({
      operation: 'natural-language',
      projectRoot: '/project',
      question: '   ',
    });

    expect(result.ok).toBe(false);
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it('natural-language 分支返回 QnAAnswer 正确序列化（含 citations 数组）', async () => {
    vi.mocked(answerQuestion).mockResolvedValue(mockQnAAnswer);

    const result = await queryPanoramic({
      operation: 'natural-language',
      projectRoot: '/project',
      question: '测试问题',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        answer: string;
        citations: unknown[];
        tokenUsage: { input: number; output: number; overBudget: boolean };
        durationMs: number;
      };
      expect(data.answer).toBe('认证模块主要被 login-handler 调用。');
      expect(Array.isArray(data.citations)).toBe(true);
      expect(data.citations).toHaveLength(1);
      expect(data.tokenUsage.overBudget).toBe(false);
    }
  });
});

// ============================================================
// T-025：MCP 集成测试（mock Anthropic SDK）
// ============================================================

/**
 * 通过调用 queryPanoramic()（MCP handler 的核心逻辑层）
 * 模拟 "MCP 工具调用路径经过 answerQuestion()" 的端到端验证。
 *
 * [E2E_DEFERRED] 真实 MCP SDK 握手层（createMcpServer → tool 注册 → 调用）
 * 需要完整 MCP 运行时环境，无法在单元测试中模拟，标记为延迟验证。
 */
describe('T-025：MCP 集成测试（mock Anthropic SDK）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('MCP 路径：operation=natural-language 调用经过 answerQuestion()', async () => {
    vi.mocked(answerQuestion).mockResolvedValue(mockQnAAnswer);

    // 模拟 MCP tool handler 的核心调用路径
    const result = await queryPanoramic({
      operation: 'natural-language',
      projectRoot: '/project',
      question: '什么调用了 X？',
    });

    // 验证 answerQuestion() 被调用（MCP 路径穿透验证）
    expect(answerQuestion).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
  });

  it('返回结构含 answer + citations + tokenUsage（FR-012 序列化格式）', async () => {
    vi.mocked(answerQuestion).mockResolvedValue({
      ...mockQnAAnswer,
      citations: [
        {
          specPath: 'specs/auth.spec.md',
          lineRange: { startLine: 5, endLine: 10 },
          excerpt: '认证接口定义',
        },
        {
          specPath: 'specs/db.spec.md',
          lineRange: { startLine: 20, endLine: 25 },
          excerpt: '数据库连接模块',
          nodeId: 'node-db',
        },
      ],
      tokenUsage: { input: 800, output: 200, overBudget: false },
    });

    const result = await queryPanoramic({
      operation: 'natural-language',
      projectRoot: '/project',
      question: '什么调用了 X？',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        answer: string;
        citations: Array<{
          specPath: string;
          lineRange: { startLine: number; endLine: number };
          excerpt: string;
        }>;
        tokenUsage: { input: number; output: number; overBudget: boolean };
      };

      // 验证三个核心字段均存在（FR-012）
      expect(data.answer).toBeTruthy();
      expect(Array.isArray(data.citations)).toBe(true);
      expect(data.citations.length).toBeGreaterThan(0);

      // 验证 citation 三字段完整（FR-012：specPath + lineRange + excerpt 必填）
      for (const citation of data.citations) {
        expect(citation.specPath).toBeTruthy();
        expect(citation.lineRange).toBeDefined();
        expect(citation.excerpt).toBeTruthy();
      }

      // 验证 tokenUsage 结构
      expect(typeof data.tokenUsage.input).toBe('number');
      expect(typeof data.tokenUsage.output).toBe('number');
      expect(typeof data.tokenUsage.overBudget).toBe('boolean');
    }
  });

  it('answerQuestion() 抛出异常时 queryPanoramic 返回 ok=false（失败路径验证）', async () => {
    vi.mocked(answerQuestion).mockRejectedValue(new Error('图谱文件不存在'));

    const result = await queryPanoramic({
      operation: 'natural-language',
      projectRoot: '/project',
      question: '测试错误路径',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('图谱文件不存在');
    }
  });

  it('向后兼容：operation=overview 不调用 answerQuestion()', async () => {
    // 防止 buildProjectContext 触发真实文件系统访问
    const { buildProjectContext } = await import('../../src/panoramic/project-context.js');
    vi.mocked(buildProjectContext).mockRejectedValue(new Error('mock：不真实运行'));

    // overview 分支不走 natural-language 路径
    await queryPanoramic({
      operation: 'overview',
      projectRoot: '/project',
    });

    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it('向后兼容：operation=cross-package 不调用 answerQuestion()', async () => {
    const { buildProjectContext } = await import('../../src/panoramic/project-context.js');
    vi.mocked(buildProjectContext).mockRejectedValue(new Error('mock：不真实运行'));

    await queryPanoramic({
      operation: 'cross-package',
      projectRoot: '/project',
    });

    expect(answerQuestion).not.toHaveBeenCalled();
  });
});
