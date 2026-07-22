/**
 * Feature 222 — root 分组的 LLM 降级统计回归测试
 *
 * 缺陷背景：root 模块（basePrefix 根目录下的散文件）在生成完 spec 后无条件 push 进
 * `successful`，从不检查降级状态。于是扁平项目即使全量 AST-only 降级，`result.degraded`
 * 仍为空数组 → batch 的降级占比提示低估甚至不打印，`--require-llm` 的事后校验完全失效。
 *
 * 本文件把「root 模块降级 → degraded 非空」钉成回归防线。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import type { ModuleSpec } from '../../src/models/module-spec.js';

const mocks = vi.hoisted(() => ({
  generateSpec: vi.fn(),
}));

vi.mock('../../src/core/single-spec-orchestrator.js', () => ({
  generateSpec: mocks.generateSpec,
}));

import { runBatch } from '../../src/batch/batch-orchestrator.js';

describe('runBatch — root 分组降级统计 (Feature 222)', { timeout: 30000 }, () => {
  let projectRoot: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();

    // 扁平项目：src/ 下只有散文件，全部归入 root 模块
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-root-degraded-'));
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'alpha.ts'),
      `export function alpha(): string { return 'a'; }\n`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'beta.ts'),
      `export function beta(): string { return 'b'; }\n`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext' } }, null, 2),
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    LanguageAdapterRegistry.resetInstance();
    vi.clearAllMocks();
  });

  it('root 模块全部文件 LLM 降级 → 记入 degraded 而非 successful', async () => {
    mockGenerateSpec({ llmDegraded: true });

    const result = await runBatch(projectRoot, { force: true });

    expect(result.degraded).toContain('root');
    expect(result.successful).not.toContain('root');
  });

  it('root 模块仅部分文件降级 → 整模块仍记为 degraded（任一降级即降档）', async () => {
    let call = 0;
    mockGenerateSpec(() => ({ llmDegraded: ++call === 1 }));

    const result = await runBatch(projectRoot, { force: true });

    expect(mocks.generateSpec).toHaveBeenCalledTimes(2);
    expect(result.degraded).toContain('root');
    expect(result.successful).not.toContain('root');
  });

  it('root 模块无降级 → 仍记为 successful（不误报）', async () => {
    mockGenerateSpec({ llmDegraded: false });

    const result = await runBatch(projectRoot, { force: true });

    expect(result.successful).toContain('root');
    expect(result.degraded).toEqual([]);
  });
});

type DegradeSpec = { llmDegraded: boolean } | (() => { llmDegraded: boolean });

function mockGenerateSpec(degrade: DegradeSpec): void {
  mocks.generateSpec.mockImplementation(
    async (
      targetPath: string,
      options: { outputDir?: string; projectRoot?: string },
    ) => {
      const { llmDegraded } = typeof degrade === 'function' ? degrade() : degrade;
      const root = options.projectRoot ?? '';
      const moduleSpec = buildModuleSpec(
        root,
        targetPath,
        options.outputDir ?? path.join(root, 'specs'),
        llmDegraded,
      );
      return {
        specPath: moduleSpec.outputPath,
        skeleton: moduleSpec.baselineSkeleton,
        tokenUsage: 100,
        confidence: llmDegraded ? ('low' as const) : ('high' as const),
        warnings: llmDegraded ? ['LLM 不可用，已降级为 AST-only Spec'] : [],
        moduleSpec,
        llmDegraded,
        costMetadata: {
          tokenUsage: { input: 100, output: 50 },
          durationMs: 10,
          llmModel: 'test-model',
          fallbackReason: llmDegraded ? 'LLM 不可用' : null,
        },
      };
    },
  );
}

function buildModuleSpec(
  projectRoot: string,
  targetPath: string,
  outputDir: string,
  llmDegraded: boolean,
): ModuleSpec {
  const resolvedTarget = path.resolve(targetPath);
  const sourceTarget = path.relative(projectRoot, resolvedTarget).split(path.sep).join('/');
  const specName = path.basename(resolvedTarget).replace(/\.[^.]+$/, '');

  return {
    frontmatter: {
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'spectra-test',
      sourceTarget,
      relatedFiles: [sourceTarget],
      lastUpdated: new Date().toISOString(),
      confidence: llmDegraded ? 'low' : 'high',
      skeletonHash: '0'.repeat(64),
    },
    sections: {
      intent: 'i', interfaceDefinition: 'i', businessLogic: 'b',
      dataStructures: 'd', constraints: 'c', edgeCases: 'e',
      technicalDebt: 't', testCoverage: 't', dependencies: 'd',
    },
    fileInventory: [{ path: sourceTarget, loc: 1, purpose: '-' }],
    baselineSkeleton: {
      filePath: sourceTarget,
      language: 'typescript',
      loc: 1,
      exports: [],
      imports: [],
      hash: '0'.repeat(64),
      analyzedAt: new Date().toISOString(),
      parserUsed: 'ts-morph',
    },
    outputPath: path.join(outputDir, 'modules', `${specName}.spec.md`),
  };
}
