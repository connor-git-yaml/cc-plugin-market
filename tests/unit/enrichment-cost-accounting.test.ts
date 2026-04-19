/**
 * Feature 127 (Codex review 修复 — Finding 3)：enrichment LLM 调用只要发生就必须
 * 记入 costMetadata，无论最终是否采纳生成内容。
 *
 * 场景：mock 出一个"enrichment 被拒绝"的场景，断言 costMetadata 仍然包含第二次
 * LLM 调用的 token。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mocks = vi.hoisted(() => ({
  scanFiles: vi.fn(),
  analyzeFiles: vi.fn(),
  redact: vi.fn(),
  assembleContext: vi.fn(),
  callLLM: vi.fn(),
  parseLLMResponse: vi.fn(),
  generateFrontmatter: vi.fn(),
  renderSpec: vi.fn(),
  initRenderer: vi.fn(),
  generateClassDiagram: vi.fn(),
  generateDependencyDiagram: vi.fn(),
  splitIntoChunks: vi.fn(),
}));

const hoistedTypes = vi.hoisted(() => ({
  MockLLMUnavailableError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'LLMUnavailableError';
    }
  },
}));

vi.mock('../../src/utils/file-scanner.js', () => ({ scanFiles: mocks.scanFiles }));
vi.mock('../../src/core/ast-analyzer.js', () => ({
  analyzeFiles: mocks.analyzeFiles,
  analyzeFile: vi.fn(),
}));
vi.mock('../../src/core/secret-redactor.js', () => ({ redact: mocks.redact }));
vi.mock('../../src/core/context-assembler.js', () => ({
  assembleContext: mocks.assembleContext,
}));
vi.mock('../../src/core/llm-client.js', () => ({
  callLLM: mocks.callLLM,
  parseLLMResponse: mocks.parseLLMResponse,
  LLMUnavailableError: hoistedTypes.MockLLMUnavailableError,
}));
vi.mock('../../src/generator/frontmatter.js', () => ({
  generateFrontmatter: mocks.generateFrontmatter,
}));
vi.mock('../../src/generator/spec-renderer.js', () => ({
  renderSpec: mocks.renderSpec,
  initRenderer: mocks.initRenderer,
}));
vi.mock('../../src/generator/mermaid-class-diagram.js', () => ({
  generateClassDiagram: mocks.generateClassDiagram,
}));
vi.mock('../../src/generator/mermaid-dependency-graph.js', () => ({
  generateDependencyDiagram: mocks.generateDependencyDiagram,
}));
vi.mock('../../src/utils/chunk-splitter.js', () => ({
  CHUNK_THRESHOLD: 9999,
  splitIntoChunks: mocks.splitIntoChunks,
}));

import { generateSpec } from '../../src/core/single-spec-orchestrator.js';

function createSkeletonWithManyExports(filePath: string) {
  // 足够多的 export 让 AST 渲染 + otherSectionsContext 超过 500 字符门槛
  const exports = [] as unknown[];
  for (let i = 0; i < 30; i++) {
    exports.push({
      name: `func${i}`,
      kind: 'function' as const,
      signature: `function func${i}(a: string, b: number): Promise<string>`,
      startLine: i * 5,
      endLine: i * 5 + 3,
      isDefault: false,
    });
  }
  return {
    filePath,
    language: 'typescript' as const,
    loc: 150,
    exports,
    imports: [],
    hash: 'a'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'ts-morph' as const,
  };
}

describe('single-spec-orchestrator: enrichment cost accounting (Feature 127)', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-cost-test-'));

    mocks.redact.mockReturnValue({ redactedContent: '[redacted]' });
    mocks.splitIntoChunks.mockReturnValue([]);
    mocks.assembleContext.mockResolvedValue({
      prompt: 'x'.repeat(9000), // 足够长以确保 enrichment 阶段的 prompt 非空
      tokenCount: 1000,
      truncated: false,
      truncatedParts: [],
      breakdown: { skeleton: 100, dependencies: 100, snippets: 100, instructions: 100 },
    });
    // parseLLMResponse 返回 businessLogic 一段较长文本（超过 enrichment 拒绝阈值 × 1.2 倍判定的参照）
    mocks.parseLLMResponse.mockReturnValue({
      sections: {
        intent: 'intent-text',
        // 足够长，让 AST 合并后的 otherSectionsContext 超过 500 触发 enrichment
        interfaceDefinition: 'interface-' + 'x'.repeat(400),
        businessLogic: 'logic-' + 'y'.repeat(1000), // 1005 chars
        dataStructures: 'data-' + 'z'.repeat(300),
        constraints: 'constraints-' + 'q'.repeat(300),
        edgeCases: 'edge',
        technicalDebt: 'debt',
        testCoverage: 'test',
        dependencies: 'deps',
      },
      uncertaintyMarkers: [],
      parseWarnings: [],
    });
    mocks.generateFrontmatter.mockImplementation((input: unknown) => {
      // 透传 tokenUsage / durationMs / llmModel / fallbackReason 以便断言
      return {
        type: 'module-spec',
        version: 'v1',
        generatedBy: 'test',
        sourceTarget: 'src/file.ts',
        relatedFiles: ['src/file.ts'],
        lastUpdated: new Date().toISOString(),
        confidence: 'high',
        skeletonHash: 'a'.repeat(64),
        ...(input as Record<string, unknown>),
      };
    });
    mocks.generateClassDiagram.mockReturnValue('');
    mocks.generateDependencyDiagram.mockReturnValue('');
    mocks.renderSpec.mockReturnValue('# spec');
  });

  it('enrichment 被拒绝时，其 tokens 仍必须计入 costMetadata 和 tokenUsage', async () => {
    const targetFile = path.join(tempDir, 'big.ts');
    fs.writeFileSync(targetFile, 'export const x = 1;');
    mocks.analyzeFiles.mockResolvedValue([createSkeletonWithManyExports(targetFile)]);

    // 第一次调用（LLM#1）：返回 200 tokens 的 content
    // 第二次调用（enrichment）：返回 shorter content（会被 1.2x 判据拒绝）+ 100 tokens
    mocks.callLLM
      .mockResolvedValueOnce({
        content: 'llm-main-content',
        model: 'claude-opus-4-7',
        inputTokens: 120,
        outputTokens: 80,
        duration: 1000,
      })
      .mockResolvedValueOnce({
        // 拒绝：enrichedContent (10 chars) < businessLogic (1005 chars) * 1.2
        content: 'short-rej',
        model: 'claude-opus-4-7',
        inputTokens: 70,
        outputTokens: 30,
        duration: 500,
      });

    const result = await generateSpec(targetFile, {
      outputDir: path.join(tempDir, 'specs'),
      projectRoot: tempDir,
    });

    // 若 enrichment 被调用 2 次：
    expect(mocks.callLLM).toHaveBeenCalledTimes(2);

    // 关键断言：即使 enrichment 被拒绝，costMetadata 仍含两次调用的 token
    expect(result.costMetadata).toBeDefined();
    expect(result.costMetadata!.tokenUsage.input).toBe(120 + 70);
    expect(result.costMetadata!.tokenUsage.output).toBe(80 + 30);
    expect(result.costMetadata!.durationMs).toBe(1000 + 500);

    // 同步检查：旧 tokenUsage 字段也正确累加，避免双口径漂移
    expect(result.tokenUsage).toBe(120 + 80 + 70 + 30);

    // sections.businessLogic 未被替换（拒绝）
    // renderSpec 拿到的 moduleSpec.sections.businessLogic 应保持原第一版
    const lastRenderCall = mocks.renderSpec.mock.calls[mocks.renderSpec.mock.calls.length - 1];
    const moduleSpec = lastRenderCall![0] as { sections: { businessLogic: string } };
    expect(moduleSpec.sections.businessLogic.startsWith('logic-')).toBe(true);
  });

  it('enrichment 被采纳时，cost 同样记录（对照组）', async () => {
    const targetFile = path.join(tempDir, 'big.ts');
    fs.writeFileSync(targetFile, 'export const x = 1;');
    mocks.analyzeFiles.mockResolvedValue([createSkeletonWithManyExports(targetFile)]);

    mocks.callLLM
      .mockResolvedValueOnce({
        content: 'main',
        model: 'claude-opus-4-7',
        inputTokens: 120,
        outputTokens: 80,
        duration: 1000,
      })
      .mockResolvedValueOnce({
        // 接受：enrichedContent 比 businessLogic 长 ≥ 1.2 倍
        content: 'enriched-' + 'A'.repeat(2000),
        model: 'claude-opus-4-7',
        inputTokens: 70,
        outputTokens: 30,
        duration: 500,
      });

    const result = await generateSpec(targetFile, {
      outputDir: path.join(tempDir, 'specs'),
      projectRoot: tempDir,
    });

    expect(mocks.callLLM).toHaveBeenCalledTimes(2);
    expect(result.costMetadata!.tokenUsage.input).toBe(190);
    expect(result.costMetadata!.tokenUsage.output).toBe(110);
    expect(result.tokenUsage).toBe(300);
  });
});
