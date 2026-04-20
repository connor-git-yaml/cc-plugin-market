/**
 * T038: 纯代码项目诚实降级集成测试
 *
 * 验证 AC-005：纯代码项目（零 markdown 文件）下
 * anchorDocToCode() 返回零边，extractHyperedges() 返回零 hyperedge，不抛异常
 *
 * 策略：
 * - EmbeddingProvider 完全 mock（vi.fn()），验证其不被调用
 * - Anthropic SDK 完全 mock，验证其不被调用
 * - 使用 tests/fixtures/pure-code-project/ 的 5 个 .ts 文件作为代码节点
 * - 不依赖网络（不加载 huggingface 模型，不调用 OpenAI）
 */
import { describe, it, expect, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorDocToCode } from '../../src/panoramic/anchoring/index.js';
import { extractHyperedges } from '../../src/panoramic/hyperedges/index.js';
import type { EmbeddingProvider, EmbedResult } from '../../src/panoramic/anchoring/embedding-provider.js';
import type { GraphNode } from '../../src/panoramic/graph/graph-types.js';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================
// 工具函数：定位 fixture 目录（使用 repo-relative 绝对路径）
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 从 tests/integration/ 回溯到仓库根目录
const REPO_ROOT = resolve(__dirname, '../..');
const PURE_CODE_FIXTURE = join(REPO_ROOT, 'tests/fixtures/pure-code-project');

// ============================================================
// 构造代码节点 fixture（基于 pure-code-project 的 5 个 .ts 文件）
// ============================================================

function buildCodeNodes(): GraphNode[] {
  const srcDir = join(PURE_CODE_FIXTURE, 'src');
  const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
  return files.map((f) => ({
    id: `src/${f}`,
    kind: 'module' as const,
    label: f.replace('.ts', ''),
    metadata: {},
  }));
}

// ============================================================
// Mock EmbeddingProvider（永远不应被调用）
// ============================================================

function createMockEmbeddingProvider(): EmbeddingProvider & { embed: ReturnType<typeof vi.fn> } {
  const embed = vi.fn<[string[]], Promise<EmbedResult>>();
  return {
    providerName: 'local' as const,
    llmModelLabel: 'mock-embedding',
    dimensions: 384,
    embed,
  };
}

// ============================================================
// Mock Anthropic 客户端（永远不应被调用）
// ============================================================

function createMockAnthropicClient(): Anthropic & {
  messages: { create: ReturnType<typeof vi.fn> };
} {
  const mockCreate = vi.fn();
  return {
    messages: { create: mockCreate },
  } as unknown as Anthropic & { messages: { create: ReturnType<typeof vi.fn> } };
}

// ============================================================
// 测试套件
// ============================================================

describe('纯代码项目诚实降级（AC-005）', () => {
  it('pure-code-project fixture 目录存在且含 ≥5 个 .ts 文件，零 .md 文件', () => {
    const srcDir = join(PURE_CODE_FIXTURE, 'src');
    const allFiles = readdirSync(srcDir);
    const tsFiles = allFiles.filter((f) => f.endsWith('.ts'));
    const mdFiles = allFiles.filter((f) => f.endsWith('.md'));

    expect(tsFiles.length).toBeGreaterThanOrEqual(5);
    expect(mdFiles).toHaveLength(0);
  });

  it('anchorDocToCode 在零 doc files 下返回零边、零 tokenUsage，且 EmbeddingProvider 不被调用', async () => {
    const codeNodes = buildCodeNodes();
    const mockProvider = createMockEmbeddingProvider();

    const result = await anchorDocToCode({
      projectRoot: PURE_CODE_FIXTURE,
      markdownFiles: [], // 零 markdown 文件（pure-code 降级场景）
      graphNodes: codeNodes,
      provider: mockProvider,
    });

    // 断言：零边
    expect(result.edges).toEqual([]);
    // 断言：零 tokenUsage（Provider 未被调用）
    expect(result.tokenUsage).toEqual([]);
    // 断言：stats 反映零处理
    expect(result.stats.chunksProcessed).toBe(0);
    expect(result.stats.edgesGenerated).toBe(0);
    // 断言：EmbeddingProvider.embed 不被调用（AC-005 诚实降级核心）
    expect(mockProvider.embed).not.toHaveBeenCalled();
  });

  it('anchorDocToCode 在 pure-code-project 目录（无 md 文件）下扫描时，应等同零 doc files', async () => {
    const codeNodes = buildCodeNodes();
    const mockProvider = createMockEmbeddingProvider();

    // 从 pure-code-project 目录收集 .md 文件（应为空）
    const srcDir = join(PURE_CODE_FIXTURE, 'src');
    const markdownFiles = readdirSync(srcDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => join(srcDir, f));

    const result = await anchorDocToCode({
      projectRoot: PURE_CODE_FIXTURE,
      markdownFiles, // 收集到的 .md 列表（期望为空）
      graphNodes: codeNodes,
      provider: mockProvider,
    });

    expect(markdownFiles).toHaveLength(0);
    expect(result.edges).toEqual([]);
    expect(mockProvider.embed).not.toHaveBeenCalled();
  });

  it('extractHyperedges 在零 docChunks 下返回空 hyperedge，不调用 LLM（即使 enabled=true）', async () => {
    const codeNodes = buildCodeNodes();
    const mockClient = createMockAnthropicClient();

    const result = await extractHyperedges({
      enabled: true, // 即使 flag 开启也应降级（零 docChunks）
      codeNodes,
      docChunks: [],
      anthropicClient: mockClient,
    });

    // 断言：零 hyperedge
    expect(result.hyperedges).toEqual([]);
    // 断言：LLM 不被调用
    expect(mockClient.messages.create).not.toHaveBeenCalled();
    // 断言：零 usage（LLM 未调用）
    expect(result.usage).toEqual([]);
    // 断言：零失败样本（未到 Zod 校验步骤）
    expect(result.failedSamples).toEqual([]);
  });

  it('extractHyperedges 在 feature flag 关闭时也不调用 LLM', async () => {
    const codeNodes = buildCodeNodes();
    const mockClient = createMockAnthropicClient();

    const result = await extractHyperedges({
      enabled: false, // flag 关闭
      codeNodes,
      docChunks: [],
      anthropicClient: mockClient,
    });

    expect(result.hyperedges).toEqual([]);
    expect(mockClient.messages.create).not.toHaveBeenCalled();
  });

  it('完整降级场景：anchorDocToCode + extractHyperedges 均诚实降级，不抛异常', async () => {
    const codeNodes = buildCodeNodes();
    const mockProvider = createMockEmbeddingProvider();
    const mockClient = createMockAnthropicClient();

    // 调用完整链路，期望两者都诚实降级
    let anchorError: unknown = null;
    let hyperedgeError: unknown = null;
    let anchorResult: Awaited<ReturnType<typeof anchorDocToCode>> | null = null;
    let hyperedgeResult: Awaited<ReturnType<typeof extractHyperedges>> | null = null;

    try {
      anchorResult = await anchorDocToCode({
        projectRoot: PURE_CODE_FIXTURE,
        markdownFiles: [],
        graphNodes: codeNodes,
        provider: mockProvider,
      });
    } catch (err) {
      anchorError = err;
    }

    try {
      hyperedgeResult = await extractHyperedges({
        enabled: true,
        codeNodes,
        docChunks: [],
        anthropicClient: mockClient,
      });
    } catch (err) {
      hyperedgeError = err;
    }

    // 断言：不抛异常
    expect(anchorError).toBeNull();
    expect(hyperedgeError).toBeNull();

    // 断言：零结果
    expect(anchorResult?.edges).toEqual([]);
    expect(hyperedgeResult?.hyperedges).toEqual([]);

    // 断言：process.exitCode 不为非零值（不影响全局退出状态）
    expect(process.exitCode).not.toBe(1);
  });
});
