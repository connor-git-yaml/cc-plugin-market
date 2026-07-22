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

// ============================================================
// Feature 148: AST 渲染规模上限测试
// ============================================================

describe('generateAstInterfaceDefinition — 规模上限', () => {
  it('文件数 ≤ 阈值时全部详细展开（不出现折叠表）', () => {
    // 4 个文件，低于 FILE_DETAIL_LIMIT=6
    const skeletons = Array.from({ length: 4 }, (_, i) =>
      createSkeleton(`/project/src/file-${i}.ts`, {
        exports: [
          {
            name: `fn${i}`,
            kind: 'function' as const,
            signature: `function fn${i}(): void`,
            startLine: 1,
            endLine: 5,
            isDefault: false,
          },
          {
            name: `fnB${i}`,
            kind: 'function' as const,
            signature: `function fnB${i}(): number`,
            startLine: 6,
            endLine: 10,
            isDefault: false,
          },
        ],
      }),
    );
    const result = generateAstInterfaceDefinition(skeletons);
    // 所有 4 个文件都应详细展开
    for (let i = 0; i < 4; i++) {
      expect(result).toContain(`### file-${i}.ts`);
    }
    // 不应出现折叠提示
    expect(result).not.toContain('其他');
    expect(result).not.toContain('共');
  });

  it('文件数 > 阈值时仅详细展开 Top 6 + 折叠剩余文件汇总表', () => {
    // 9 个文件：file-00..file-08，每个不同导出数以验证排序
    const skeletons = Array.from({ length: 9 }, (_, i) =>
      createSkeleton(`/project/src/file-${String(i).padStart(2, '0')}.ts`, {
        exports: Array.from({ length: 8 - i }, (_, j) => ({
          name: `fn${i}_${j}`,
          kind: 'function' as const,
          signature: `function fn${i}_${j}(): void`,
          startLine: j * 2 + 1,
          endLine: j * 2 + 3,
          isDefault: false,
        })),
      }),
    );
    const result = generateAstInterfaceDefinition(skeletons);
    // Top 6（导出数 8, 7, 6, 5, 4, 3）应详细展开
    expect(result).toContain('### file-00.ts'); // 8 exports（最多）
    expect(result).toContain('### file-05.ts'); // 3 exports（Top 6 边界）
    // 后 2 个（导出数 2, 1）会被折叠
    // 注意：file-08.ts 仅有 0 个导出，会被 withExports 过滤掉
    expect(result).toContain('### 其他 2 个文件（共 3 导出）');
    expect(result).toContain('| file-06.ts | 2 |');
    expect(result).toContain('| file-07.ts | 1 |');
    // 引导用户用 spectra prepare 重新提取完整 AST
    expect(result).toContain('spectra prepare');
  });

  it('单个 class 成员数 > 阈值时截断 + 显示省略提示', () => {
    // 15 个成员，超过 MEMBER_DETAIL_LIMIT=10
    const members = Array.from({ length: 15 }, (_, i) => ({
      name: `member${i}`,
      kind: 'method' as const,
      signature: `method${i}(): void`,
      isStatic: false,
      visibility: 'public' as const,
    }));
    const skeletons = [createSkeleton('/project/src/big.ts', {
      exports: [
        {
          name: 'GodClass',
          kind: 'class' as const,
          signature: 'class GodClass',
          startLine: 1,
          endLine: 100,
          isDefault: false,
          members,
        },
      ],
    })];
    const result = generateAstInterfaceDefinition(skeletons);
    // 前 10 个成员存在
    expect(result).toContain('`member0`');
    expect(result).toContain('`member9`');
    // 第 10+ 个不应直接列出
    expect(result).not.toContain('| `member10` |');
    expect(result).not.toContain('| `member14` |');
    // 应有截断提示
    expect(result).toContain('另 5 个成员省略');
  });

  it('单个文件导出数 > 阈值时截断 + 显示省略提示', () => {
    // 15 个 export，超过 EXPORTS_PER_FILE_LIMIT=12
    const exports = Array.from({ length: 15 }, (_, i) => ({
      name: `fn${i}`,
      kind: 'function' as const,
      signature: `function fn${i}(): void`,
      startLine: i * 2 + 1,
      endLine: i * 2 + 3,
      isDefault: false,
    }));
    const skeletons = [createSkeleton('/project/src/big-aggregate.ts', { exports })];
    const result = generateAstInterfaceDefinition(skeletons);
    // 前 12 个 export 存在
    expect(result).toContain('`fn0`');
    expect(result).toContain('`fn11`');
    // 第 12+ 个不应直接列在表格里
    expect(result).not.toContain('| `fn12` |');
    expect(result).toContain('另 3 个导出省略');
  });

  it('排序稳定性：相同导出数的文件按文件名升序排序', () => {
    const skeletons = [
      createSkeleton('/project/src/zebra.ts', {
        exports: [
          { name: 'z', kind: 'function' as const, signature: 'function z(): void', startLine: 1, endLine: 1, isDefault: false },
        ],
      }),
      createSkeleton('/project/src/alpha.ts', {
        exports: [
          { name: 'a', kind: 'function' as const, signature: 'function a(): void', startLine: 1, endLine: 1, isDefault: false },
        ],
      }),
      createSkeleton('/project/src/middle.ts', {
        exports: [
          { name: 'm', kind: 'function' as const, signature: 'function m(): void', startLine: 1, endLine: 1, isDefault: false },
        ],
      }),
    ];
    const result = generateAstInterfaceDefinition(skeletons);
    const idxAlpha = result.indexOf('### alpha.ts');
    const idxMiddle = result.indexOf('### middle.ts');
    const idxZebra = result.indexOf('### zebra.ts');
    expect(idxAlpha).toBeGreaterThan(-1);
    expect(idxMiddle).toBeGreaterThan(idxAlpha);
    expect(idxZebra).toBeGreaterThan(idxMiddle);
  });

  it('文件数恰好等于阈值时全部详细展开（边界用例 N=FILE_DETAIL_LIMIT=6）', () => {
    const skeletons = Array.from({ length: 6 }, (_, i) =>
      createSkeleton(`/project/src/file-${i}.ts`, {
        exports: [
          {
            name: `fn${i}`,
            kind: 'function' as const,
            signature: `function fn${i}(): void`,
            startLine: 1,
            endLine: 5,
            isDefault: false,
          },
        ],
      }),
    );
    const result = generateAstInterfaceDefinition(skeletons);
    for (let i = 0; i < 6; i++) {
      expect(result).toContain(`### file-${i}.ts`);
    }
    expect(result).not.toContain('其他');
  });

  it('文件数恰好阈值+1 时触发折叠，验证 off-by-one', () => {
    const skeletons = Array.from({ length: 7 }, (_, i) =>
      createSkeleton(`/project/src/file-${String(i).padStart(2, '0')}.ts`, {
        exports: [
          {
            name: `fn${i}`,
            kind: 'function' as const,
            signature: `function fn${i}(): void`,
            startLine: 1,
            endLine: 5,
            isDefault: false,
          },
        ],
      }),
    );
    const result = generateAstInterfaceDefinition(skeletons);
    // Top 6 详细展开，第 7 个折叠
    expect(result).toContain('### 其他 1 个文件（共 1 导出）');
  });

  it('被 EXPORTS_PER_FILE_LIMIT 截断的 class 不会在子表展开', () => {
    // 文件 13 个 export：前 12 个是 function，第 13 个是 class with members
    // EXPORTS_PER_FILE_LIMIT=12，class 应该被截断在表外
    const exports: Array<{
      name: string;
      kind: 'function' | 'class';
      signature: string;
      startLine: number;
      endLine: number;
      isDefault: boolean;
      members?: Array<{ name: string; kind: 'method'; signature: string; isStatic: boolean; visibility: 'public' }>;
    }> = Array.from({ length: 12 }, (_, i) => ({
      name: `fn${i}`,
      kind: 'function' as const,
      signature: `function fn${i}(): void`,
      startLine: i * 2 + 1,
      endLine: i * 2 + 3,
      isDefault: false,
    }));
    exports.push({
      name: 'TruncatedClass',
      kind: 'class' as const,
      signature: 'class TruncatedClass',
      startLine: 100,
      endLine: 150,
      isDefault: false,
      members: [
        { name: 'truncatedMember', kind: 'method' as const, signature: 'truncatedMember(): void', isStatic: false, visibility: 'public' as const },
      ],
    });
    const skeletons = [createSkeleton('/project/src/aggregate.ts', { exports })];
    const result = generateAstInterfaceDefinition(skeletons);
    // 第 13 个 export（TruncatedClass）应该不在主表格里
    expect(result).not.toContain('| `TruncatedClass` |');
    // 也不应被作为 classLike 展开为子表
    expect(result).not.toContain('**TruncatedClass 成员**');
    expect(result).not.toContain('`truncatedMember`');
    // 应有截断提示
    expect(result).toContain('另 1 个导出省略');
  });
});

describe('generateAstDataStructures — 规模上限', () => {
  it('数据结构数 ≤ 阈值时全部详细展开（不出现折叠表）', () => {
    const skeletons = Array.from({ length: 5 }, (_, i) =>
      createSkeleton(`/project/src/types-${i}.ts`, {
        exports: [
          {
            name: `Type${i}`,
            kind: 'interface' as const,
            signature: `interface Type${i}`,
            startLine: 1,
            endLine: 5,
            isDefault: false,
            members: [
              { name: `field${i}`, kind: 'property' as const, signature: `field${i}: string`, isStatic: false, visibility: 'public' as const },
            ],
          },
        ],
      }),
    );
    const result = generateAstDataStructures(skeletons);
    for (let i = 0; i < 5; i++) {
      expect(result).toContain(`\`Type${i}\` (interface)`);
    }
    expect(result).not.toContain('其他数据结构');
  });

  it('数据结构数 > 阈值时仅详细展开 Top 10 + 折叠剩余汇总表', () => {
    // 15 个 interface，每个不同字段数以验证排序（成员数 15..1）
    const skeletons = Array.from({ length: 15 }, (_, i) =>
      createSkeleton(`/project/src/iface-${String(i).padStart(2, '0')}.ts`, {
        exports: [
          {
            name: `Iface${String(i).padStart(2, '0')}`,
            kind: 'interface' as const,
            signature: `interface Iface${String(i).padStart(2, '0')}`,
            startLine: 1,
            endLine: 10,
            isDefault: false,
            members: Array.from({ length: 15 - i }, (_, j) => ({
              name: `f${j}`,
              kind: 'property' as const,
              signature: `f${j}: string`,
              isStatic: false,
              visibility: 'public' as const,
            })),
          },
        ],
      }),
    );
    const result = generateAstDataStructures(skeletons);
    // Top 10（成员数 15..6）应详细展开
    expect(result).toContain('`Iface00` (interface)'); // 最多成员
    expect(result).toContain('`Iface09` (interface)'); // Top 10 边界
    // 后 5 个折叠
    expect(result).toContain('#### 其他数据结构（共 5 个）');
    expect(result).toContain('`Iface10`');
    expect(result).toContain('`Iface14`');
    // 折叠条目不应出现 ` (interface)` 这种详细标题（第 11 个起被折叠）
    expect(result).not.toContain('`Iface10` (interface)');
    expect(result).toContain('spectra prepare');
  });

  it('折叠表行数 > 阈值时按 FOLDED_TABLE_ROW_LIMIT 截断', () => {
    // 50 个简单 interface，触发折叠 + 折叠表 row limit
    const skeletons = Array.from({ length: 50 }, (_, i) =>
      createSkeleton(`/project/src/iface-${String(i).padStart(3, '0')}.ts`, {
        exports: [
          {
            name: `Iface${String(i).padStart(3, '0')}`,
            kind: 'interface' as const,
            signature: `interface Iface${String(i).padStart(3, '0')}`,
            startLine: 1,
            endLine: 5,
            isDefault: false,
            members: [
              {
                name: 'f',
                kind: 'property' as const,
                signature: 'f: string',
                isStatic: false,
                visibility: 'public' as const,
              },
            ],
          },
        ],
      }),
    );
    const result = generateAstDataStructures(skeletons);
    // Top 10 详细展开 + 40 折叠
    expect(result).toContain('#### 其他数据结构（共 40 个）');
    // 折叠表只显示前 30 行（FOLDED_TABLE_ROW_LIMIT）
    expect(result).toContain('另 10 个数据结构未在汇总表中列出');
  });

  it('单 interface 字段数 > 阈值时字段表截断 + 省略提示', () => {
    const properties = Array.from({ length: 15 }, (_, i) => ({
      name: `field${i}`,
      kind: 'property' as const,
      signature: `field${i}: string`,
      isStatic: false,
      visibility: 'public' as const,
    }));
    const skeletons = [createSkeleton('/project/src/big.ts', {
      exports: [
        {
          name: 'BigInterface',
          kind: 'interface' as const,
          signature: 'interface BigInterface',
          startLine: 1,
          endLine: 50,
          isDefault: false,
          members: properties,
        },
      ],
    })];
    const result = generateAstDataStructures(skeletons);
    expect(result).toContain('`field0`');
    expect(result).toContain('`field9`');
    expect(result).not.toContain('| `field10` |');
    expect(result).toContain('另 5 个字段省略');
  });

  it('单 enum 值数 > 阈值时枚举值表截断 + 省略提示', () => {
    const values = Array.from({ length: 15 }, (_, i) => ({
      name: `Val${i}`,
      kind: 'property' as const,
      signature: `Val${i} = "${i}"`,
      isStatic: false,
    }));
    const skeletons = [createSkeleton('/project/src/big-enum.ts', {
      exports: [
        {
          name: 'BigEnum',
          kind: 'enum' as const,
          signature: 'enum BigEnum',
          startLine: 1,
          endLine: 50,
          isDefault: false,
          members: values,
        },
      ],
    })];
    const result = generateAstDataStructures(skeletons);
    expect(result).toContain('`Val0`');
    expect(result).toContain('`Val9`');
    expect(result).not.toContain('| `Val10` |');
    expect(result).toContain('另 5 个枚举值省略');
  });
});

describe('Feature 148: 大模块行数预算 sanity check', () => {
  it('生成 130 文件 / 多类成员 mock 时 AST 章节合计受控（< 1000 行）', () => {
    // 模拟 panoramic 规模：130 个 .ts 文件，大部分 1-3 个导出，少量大类
    const skeletons: ReturnType<typeof createSkeleton>[] = [];
    for (let i = 0; i < 130; i++) {
      const exports = [];
      const exportCount = Math.max(1, 5 - Math.floor(i / 30));
      for (let j = 0; j < exportCount; j++) {
        if (i < 10 && j === 0) {
          // 前 10 个文件，每个含一个 class 5-15 成员（god class 类型）
          exports.push({
            name: `Cls_${i}_${j}`,
            kind: 'class' as const,
            signature: `class Cls_${i}_${j}`,
            startLine: 1,
            endLine: 30,
            isDefault: false,
            members: Array.from({ length: 5 + (i % 10) }, (_, k) => ({
              name: `m${k}`,
              kind: 'method' as const,
              signature: `m${k}(): void`,
              isStatic: false,
              visibility: 'public' as const,
            })),
          });
        } else {
          exports.push({
            name: `fn_${i}_${j}`,
            kind: 'function' as const,
            signature: `function fn_${i}_${j}(): void`,
            startLine: j * 2 + 1,
            endLine: j * 2 + 3,
            isDefault: false,
          });
        }
      }
      skeletons.push(createSkeleton(`/project/src/file-${String(i).padStart(3, '0')}.ts`, { exports }));
    }
    const interfaceOut = generateAstInterfaceDefinition(skeletons);
    const dataOut = generateAstDataStructures(skeletons);
    const totalAstLines = interfaceOut.split('\n').length + dataOut.split('\n').length;
    // 两个 AST 章节合计应 < 1000 行（实际 panoramic 修复前 11714 行）
    // 加上其他章节预算（~500-700 行）后总 spec ≤ 1500
    expect(totalAstLines).toBeLessThan(1000);
  });
});

// F221：re-export 条目进入接口表后，`类型` 列（re-export）+ `签名` 列（含来源
// specifier）即分层标注——接口表不再漏列 facade 导出面，也无需独立小节。
describe('generateAstInterfaceDefinition — re-export 渲染（F221）', () => {
  it('⑫ re-export 条目渲染 kind 列与来源签名', () => {
    const skeletons = [createSkeleton('/project/src/facade.ts', {
      exports: [
        {
          name: 'runBatch',
          kind: 'function' as const,
          signature: 'function runBatch(): void',
          startLine: 1,
          endLine: 3,
          isDefault: false,
        },
        {
          name: 'normalizeConcurrency',
          kind: 're-export' as const,
          signature: "export { normalizeConcurrency } from './stages/generation-scheduling.js'",
          startLine: 5,
          endLine: 5,
          isDefault: false,
          reExportFrom: './stages/generation-scheduling.js',
        },
      ],
    })];
    const result = generateAstInterfaceDefinition(skeletons);
    expect(result).toContain('`normalizeConcurrency`');
    expect(result).toContain('| re-export |');
    expect(result).toContain('./stages/generation-scheduling.js');
  });
});
