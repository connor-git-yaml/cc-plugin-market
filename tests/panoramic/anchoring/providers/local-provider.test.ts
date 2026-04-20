/**
 * LocalEmbeddingProvider 单元测试
 * 验证：加载失败清晰报错、tokenUsage 格式、durationMs、outputTokens
 *
 * 策略：通过 _setTransformersImporter 注入 mock，替换动态 import
 * 每次测试前通过 _resetPipelineForTest() 重置 singleton
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LocalEmbeddingProvider,
  _resetPipelineForTest,
  _setTransformersImporter,
  LOAD_ERROR_MSG,
} from '../../../../src/panoramic/anchoring/providers/local-provider.js';

// ============================================================
// 常量
// ============================================================

const MOCK_DIMS = 384;

// ============================================================
// 每次测试前重置
// ============================================================

beforeEach(() => {
  // 重置 singleton pipeline 缓存和 importer
  _resetPipelineForTest();
  vi.clearAllMocks();
});

// ============================================================
// 测试用例
// ============================================================

describe('LocalEmbeddingProvider', () => {
  it('测试用例 1：依赖加载失败时，embed() 抛出包含安装指引的 Error（FR-011）', async () => {
    // 注入：模拟 @huggingface/transformers 不可用
    _setTransformersImporter(async () => {
      throw new Error(LOAD_ERROR_MSG);
    });

    const provider = new LocalEmbeddingProvider();
    await expect(provider.embed(['test'])).rejects.toThrow(
      /npm install @huggingface\/transformers|SPECTRA_EMBEDDING_PROVIDER/,
    );
  });

  it('测试用例 2：模块可用时，embed() 返回 EmbedResult，tokenUsage.llmModel === local-embedding（AC-011）', async () => {
    const mockVector = new Float32Array(MOCK_DIMS).fill(0.1);
    const mockPipelineFn = vi.fn().mockResolvedValue({ data: mockVector });

    // 注入：模拟成功的 transformers 模块
    _setTransformersImporter(async () => ({
      pipeline: vi.fn().mockResolvedValue(mockPipelineFn),
    }));

    const provider = new LocalEmbeddingProvider();
    const result = await provider.embed(['hello world']);

    expect(result.tokenUsage.llmModel).toBe('local-embedding');
    expect(result.vectors.length).toBe(1);
    expect(result.vectors[0]).toBeInstanceOf(Float32Array);
  });

  it('测试用例 3：tokenUsage.durationMs 为正数（performance.now 精确计时）', async () => {
    const mockVector = new Float32Array(MOCK_DIMS).fill(0.2);
    const mockPipelineFn = vi.fn().mockResolvedValue({ data: mockVector });

    _setTransformersImporter(async () => ({
      pipeline: vi.fn().mockResolvedValue(mockPipelineFn),
    }));

    const provider = new LocalEmbeddingProvider();
    const result = await provider.embed(['timing test']);

    // durationMs 应为有效非负数（允许为 0 在极快 mock 环境）
    expect(result.tokenUsage.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.tokenUsage.durationMs)).toBe(true);
  });

  it('测试用例 4：tokenUsage.outputTokens === 0（embedding 无输出）', async () => {
    const mockVector = new Float32Array(MOCK_DIMS).fill(0.3);
    const mockPipelineFn = vi.fn().mockResolvedValue({ data: mockVector });

    _setTransformersImporter(async () => ({
      pipeline: vi.fn().mockResolvedValue(mockPipelineFn),
    }));

    const provider = new LocalEmbeddingProvider();
    const result = await provider.embed(['output tokens test']);

    expect(result.tokenUsage.outputTokens).toBe(0);
  });

  it('providerName、llmModelLabel、dimensions 符合规范', () => {
    const provider = new LocalEmbeddingProvider();
    expect(provider.providerName).toBe('local');
    expect(provider.llmModelLabel).toBe('local-embedding');
    expect(provider.dimensions).toBe(384);
  });

  it('inputTokens 粗估为字符数/4 的整数（Math.ceil）', async () => {
    const mockVector = new Float32Array(MOCK_DIMS).fill(0.1);
    const mockPipelineFn = vi.fn().mockResolvedValue({ data: mockVector });

    _setTransformersImporter(async () => ({
      pipeline: vi.fn().mockResolvedValue(mockPipelineFn),
    }));

    const text = 'hello world test'; // 16 字符，ceil(16/4) = 4
    const provider = new LocalEmbeddingProvider();
    const result = await provider.embed([text]);

    const expectedInputTokens = Math.ceil(text.length / 4);
    expect(result.tokenUsage.inputTokens).toBe(expectedInputTokens);
  });

  it('LOAD_ERROR_MSG 包含 npm install 和 SPECTRA_EMBEDDING_PROVIDER 信息', () => {
    // 验证错误消息格式符合要求（FR-011）
    expect(LOAD_ERROR_MSG).toContain('npm install @huggingface/transformers');
    expect(LOAD_ERROR_MSG).toContain('SPECTRA_EMBEDDING_PROVIDER');
  });
});
