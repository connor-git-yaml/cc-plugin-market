/**
 * single-spec-orchestrator 单元测试
 * 覆盖 prepareContext / generateSpec 的关键分支
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
  MockLLMUnavailableError: class MockLLMUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'LLMUnavailableError';
    }
  },
}));

vi.mock('../../src/utils/file-scanner.js', () => ({
  scanFiles: mocks.scanFiles,
}));

vi.mock('../../src/core/ast-analyzer.js', () => ({
  analyzeFiles: mocks.analyzeFiles,
  analyzeFile: vi.fn(),
}));

vi.mock('../../src/core/secret-redactor.js', () => ({
  redact: mocks.redact,
}));

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
  CHUNK_THRESHOLD: 2,
  splitIntoChunks: mocks.splitIntoChunks,
}));

import {
  prepareContext,
  generateSpec,
} from '../../src/core/single-spec-orchestrator.js';

function createSections() {
  return {
    intent: 'intent',
    interfaceDefinition: 'interface',
    businessLogic: 'logic',
    dataStructures: 'data',
    constraints: 'constraints',
    edgeCases: 'edge',
    technicalDebt: 'debt',
    testCoverage: 'test',
    dependencies: 'deps',
  };
}

function createSkeleton(filePath: string, overrides: Record<string, unknown> = {}) {
  return {
    filePath,
    language: 'typescript' as const,
    loc: 10,
    exports: [
      {
        name: 'foo',
        kind: 'function' as const,
        signature: 'function foo(): void',
        startLine: 1,
        endLine: 3,
        isDefault: false,
      },
    ],
    imports: [
      {
        moduleSpecifier: './dep',
        isRelative: true,
        isTypeOnly: false,
      },
    ],
    hash: 'a'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'ts-morph' as const,
    ...overrides,
  };
}

describe('single-spec-orchestrator', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'single-orch-test-'));

    mocks.redact.mockReturnValue({ redactedContent: '[redacted]' });
    mocks.splitIntoChunks.mockReturnValue([
      { content: 'chunk-1' },
      { content: 'chunk-2' },
    ]);
    mocks.assembleContext.mockResolvedValue({
      prompt: 'assembled',
      tokenCount: 1000,
      truncated: false,
      truncatedParts: [],
      breakdown: {
        skeleton: 100,
        dependencies: 100,
        snippets: 100,
        instructions: 100,
      },
    });
    mocks.callLLM.mockResolvedValue({
      content: 'llm content',
      model: 'claude-sonnet',
      inputTokens: 120,
      outputTokens: 80,
      duration: 100,
    });
    mocks.parseLLMResponse.mockReturnValue({
      sections: createSections(),
      uncertaintyMarkers: [],
      parseWarnings: [],
    });
    mocks.generateFrontmatter.mockReturnValue({
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'test',
      sourceTarget: 'src/file.ts',
      relatedFiles: ['src/file.ts'],
      lastUpdated: new Date().toISOString(),
      confidence: 'high',
      skeletonHash: 'a'.repeat(64),
    });
    mocks.generateClassDiagram.mockReturnValue('classDiagram\nA-->B');
    mocks.generateDependencyDiagram.mockReturnValue('graph LR\nA-->B');
    mocks.renderSpec.mockReturnValue('# spec');
  });

  it('prepareContext: 目录输入会扫描并返回合并骨架与上下文', async () => {
    const fileA = path.join(tempDir, 'a.ts');
    const fileB = path.join(tempDir, 'b.ts');
    fs.writeFileSync(fileA, 'export const a = 1;');
    fs.writeFileSync(fileB, 'export const b = 2;');

    mocks.scanFiles.mockReturnValue({
      files: ['a.ts', 'b.ts'],
      totalScanned: 2,
      ignored: 0,
    });
    mocks.analyzeFiles.mockResolvedValue([
      createSkeleton(fileA, { hash: '1'.repeat(64) }),
      createSkeleton(fileB, { hash: '2'.repeat(64) }),
    ]);
    mocks.assembleContext.mockResolvedValue({
      prompt: 'assembled',
      tokenCount: 81_000,
      truncated: false,
      truncatedParts: [],
      breakdown: {
        skeleton: 100,
        dependencies: 100,
        snippets: 100,
        instructions: 100,
      },
    });

    const stages: Array<{ stage: string; message: string; duration?: number }> = [];
    const result = await prepareContext(tempDir, {
      projectRoot: tempDir,
      onStageProgress: (p) => stages.push(p),
    });

    expect(mocks.scanFiles).toHaveBeenCalled();
    expect(result.filePaths).toEqual([fileA, fileB]);
    expect(result.skeletons).toHaveLength(2);
    expect(result.mergedSkeleton.exports.length).toBeGreaterThanOrEqual(2);
    expect(stages.some((s) => s.stage === 'scan')).toBe(true);
    expect(stages.some((s) => s.message.includes('token 数较大'))).toBe(true);
  });

  it('prepareContext: deep 模式在大文件下走分块脱敏分支', async () => {
    const fileA = path.join(tempDir, 'huge.ts');
    fs.writeFileSync(fileA, 'line1\nline2\nline3');

    mocks.analyzeFiles.mockResolvedValue([createSkeleton(fileA)]);

    const result = await prepareContext(fileA, { deep: true });
    expect(mocks.splitIntoChunks).toHaveBeenCalled();
    expect(mocks.redact).toHaveBeenCalledTimes(2);
    expect(result.codeSnippets).toEqual(['[redacted]', '[redacted]']);
  });

  it('prepareContext: 目录无可分析文件时报错', async () => {
    mocks.scanFiles.mockReturnValue({
      files: [],
      totalScanned: 0,
      ignored: 0,
    });

    await expect(prepareContext(tempDir)).rejects.toThrow('未找到 TS/JS 文件');
  });

  it('generateSpec: 正常路径返回 high 置信度并写入文件', async () => {
    const targetFile = path.join(tempDir, 'module.ts');
    const outputDir = path.join(tempDir, 'specs');
    fs.writeFileSync(targetFile, 'export const x = 1;');
    mocks.analyzeFiles.mockResolvedValue([createSkeleton(targetFile)]);

    const stages: Array<{ stage: string; message: string; duration?: number }> = [];
    const result = await generateSpec(targetFile, {
      outputDir,
      projectRoot: tempDir,
      onStageProgress: (p) => stages.push(p),
    });

    expect(result.confidence).toBe('high');
    expect(result.tokenUsage).toBe(200);
    expect(result.warnings).toHaveLength(0);
    expect(fs.existsSync(path.join(outputDir, 'module.spec.md'))).toBe(true);
    expect(stages.some((s) => s.stage === 'llm')).toBe(true);
    expect(stages.some((s) => s.stage === 'render')).toBe(true);
  });

  it('generateSpec: LLM 不可用时降级为 AST-only 且 confidence=low', async () => {
    const targetFile = path.join(tempDir, 'degrade.ts');
    fs.writeFileSync(targetFile, 'export const x = 1;');
    mocks.analyzeFiles.mockResolvedValue([createSkeleton(targetFile)]);
    mocks.callLLM.mockRejectedValue(new hoistedTypes.MockLLMUnavailableError('offline'));
    mocks.parseLLMResponse.mockReturnValue({
      sections: createSections(),
      uncertaintyMarkers: [],
      parseWarnings: [],
    });

    const result = await generateSpec(targetFile, {
      outputDir: path.join(tempDir, 'specs'),
      projectRoot: tempDir,
    });

    expect(result.confidence).toBe('low');
    expect(result.warnings.some((w) => w.includes('AST-only'))).toBe(true);
  });

  it('generateSpec: 非 LLMUnavailableError 应向上抛出', async () => {
    const targetFile = path.join(tempDir, 'error.ts');
    fs.writeFileSync(targetFile, 'export const x = 1;');
    mocks.analyzeFiles.mockResolvedValue([createSkeleton(targetFile)]);
    mocks.callLLM.mockRejectedValue(new Error('boom'));

    await expect(
      generateSpec(targetFile, {
        outputDir: path.join(tempDir, 'specs'),
      }),
    ).rejects.toThrow('boom');
  });
});
