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
  generateAstInterfaceDefinition,
  generateAstDataStructures,
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
      // Feature 140 T15 — AssembledContext 新增三层聚合字段
      tokenBreakdown: {
        contextAssembly: 200, // dependencies + snippets
        promptTemplate: 100,  // instructions
        sourceFile: 100,      // skeleton
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
      // 超过 400_000（即 500_000 预算的 80%）以触发 "token 数较大" 警告
      tokenCount: 420_000,
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

    await expect(prepareContext(tempDir)).rejects.toThrow('未找到支持的源文件');
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

// ============================================================
// FR-001/FR-002: AST 接口定义生成测试
// ============================================================

describe('generateAstInterfaceDefinition', () => {
  it('无导出骨架返回友好提示', () => {
    const result = generateAstInterfaceDefinition([]);
    expect(result).toBe('本模块无公共导出。');
  });

  it('单文件骨架生成文件名标题和表格', () => {
    const skeletons = [createSkeleton('/project/src/utils.ts', {
      exports: [
        { name: 'foo', kind: 'function' as const, signature: 'function foo(): void', startLine: 1, endLine: 5, isDefault: false },
        { name: 'bar', kind: 'function' as const, signature: 'function bar(x: number): string', startLine: 7, endLine: 12, isDefault: false },
      ],
    })];
    const result = generateAstInterfaceDefinition(skeletons);
    // 文件名标题
    expect(result).toContain('### utils.ts');
    // 表格头
    expect(result).toContain('| 名称 | 类型 | 签名 | 成员数 |');
    // 导出符号行
    expect(result).toContain('`foo`');
    expect(result).toContain('`bar`');
    // 无 members 时显示 -
    expect(result).toContain('| - |');
  });

  it('含 members 的类展开为子表格', () => {
    const skeletons = [createSkeleton('/project/src/config.py', {
      exports: [
        {
          name: 'LanguageConfig',
          kind: 'class' as const,
          signature: 'class LanguageConfig',
          startLine: 1,
          endLine: 20,
          isDefault: false,
          members: [
            { name: 'name', kind: 'property' as const, signature: 'name: str', isStatic: false, visibility: 'public' as const },
            { name: 'get_name', kind: 'method' as const, signature: 'def get_name(self) -> str', isStatic: false, visibility: 'public' as const },
          ],
        },
      ],
    })];
    const result = generateAstInterfaceDefinition(skeletons);
    // 成员数应为 2
    expect(result).toContain('| 2 |');
    // 展开子表
    expect(result).toContain('**LanguageConfig 成员**');
    expect(result).toContain('| 成员 | 类型 | 签名 | 可见性 |');
    expect(result).toContain('`name`');
  });

  it('签名中含竖线字符时应转义', () => {
    const skeletons = [createSkeleton('/project/src/a.ts', {
      exports: [
        { name: 'fn', kind: 'function' as const, signature: 'function fn(x: A | B): void', startLine: 1, endLine: 3, isDefault: false },
      ],
    })];
    const result = generateAstInterfaceDefinition(skeletons);
    // 竖线应被转义为 \|
    expect(result).toContain('\\|');
  });
});

// ============================================================
// FR-003/FR-004: AST 数据结构生成测试
// ============================================================

describe('generateAstDataStructures', () => {
  it('无数据结构导出时返回空字符串', () => {
    const skeletons = [createSkeleton('/project/src/utils.ts')];
    // createSkeleton 默认 exports 只有 function，不含 class/interface/type/enum
    const result = generateAstDataStructures(skeletons);
    expect(result).toBe('');
  });

  it('class 含属性和方法时生成分区表格', () => {
    const skeletons = [createSkeleton('/project/src/config.ts', {
      exports: [
        {
          name: 'Config',
          kind: 'class' as const,
          signature: 'class Config',
          startLine: 1,
          endLine: 20,
          isDefault: false,
          members: [
            { name: 'host', kind: 'property' as const, signature: 'host: string', isStatic: false, visibility: 'public' as const },
            { name: 'getHost', kind: 'method' as const, signature: 'getHost(): string', isStatic: false, visibility: 'public' as const },
          ],
        },
      ],
    })];
    const result = generateAstDataStructures(skeletons);
    expect(result).toContain('`Config` (class)');
    // 属性分区
    expect(result).toContain('**字段**');
    expect(result).toContain('`host`');
    // 方法分区
    expect(result).toContain('**方法**');
    expect(result).toContain('`getHost`');
  });

  it('enum 生成枚举值表格', () => {
    const skeletons = [createSkeleton('/project/src/types.ts', {
      exports: [
        {
          name: 'FileType',
          kind: 'enum' as const,
          signature: 'enum FileType',
          startLine: 1,
          endLine: 8,
          isDefault: false,
          members: [
            { name: 'Python', kind: 'property' as const, signature: 'Python = "py"', isStatic: false },
            { name: 'TypeScript', kind: 'property' as const, signature: 'TypeScript = "ts"', isStatic: false },
          ],
        },
      ],
    })];
    const result = generateAstDataStructures(skeletons);
    expect(result).toContain('`FileType` (enum)');
    expect(result).toContain('| 枚举值 | 签名 |');
    expect(result).toContain('`Python`');
    expect(result).toContain('`TypeScript`');
  });

  it('type alias 展示签名', () => {
    const skeletons = [createSkeleton('/project/src/types.ts', {
      exports: [
        {
          name: 'UserId',
          kind: 'type' as const,
          signature: 'type UserId = string',
          startLine: 1,
          endLine: 1,
          isDefault: false,
        },
      ],
    })];
    const result = generateAstDataStructures(skeletons);
    expect(result).toContain('`UserId` (type)');
    expect(result).toContain('`type UserId = string`');
  });
});
