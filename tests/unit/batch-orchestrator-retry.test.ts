/**
 * Bug 142 — batch-orchestrator retry token budget 短路行为测试
 *
 * v4.0.2 hotfix：budget 检查从 retrospective 改为 forecast。
 * 新逻辑：catch 内 `cumulativeInputTokens + ESTIMATED_FAILED_CALL_INPUT > RETRY_TOKEN_BUDGET`
 * → 不再重试，标 reason 退出。按 default 配置（maxRetries=3, ESTIMATED=15k, BUDGET=40k）：
 *   - 1st fail: cum=15k, 15+15=30 not >40, 重试
 *   - 2nd fail: cum=30k, 30+15=45 >40, BREAK，retryCount=2
 * 实际省 1 次 LLM 调用（~15k tokens）。
 *
 * 关键覆盖：
 * 1. 持续失败 + maxRetries=5 → 第 2 次失败时 forecast 触发 break，retryCount=2，
 *    reason=retry-budget-exceeded
 * 2. maxRetries=1 + budget 不触发 → 走原有 maxRetries 路径，reason 为 undefined
 * 3. mock 第 1 次 reject → 第 2 次成功（generateSpec 成功路径累积 input token）→ 模块标 success
 * 4. writeSummaryLog 在含 retry-budget-exceeded 失败时输出 reason 到 markdown
 * 5. **regression**：default config（不传 maxRetries）下 budget 必须真的省 LLM 调用，
 *    实际调用次数 < default maxRetries=3
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

describe('runBatch — retry token budget 短路 (Bug 142)', () => {
  let projectRoot: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();

    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-retry-budget-'));
    fs.mkdirSync(path.join(projectRoot, 'src', 'mod'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'mod', 'index.ts'),
      `export function fn(): string { return 'ok'; }\n`,
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

  it('场景 1：generateSpec 持续抛错 → 第 2 次失败时 forecast 触发 break，reason=retry-budget-exceeded', async () => {
    // v4.0.2 hotfix：forecast 逻辑 `cum + ESTIMATED > BUDGET` 判断下一次重试是否会超预算。
    // ESTIMATED_FAILED_CALL_INPUT=15_000 / RETRY_TOKEN_BUDGET=40_000；
    // 1st fail cum=15k, 15+15=30 not >40, 重试；
    // 2nd fail cum=30k, 30+15=45 >40, BREAK，retryCount=2。
    // maxRetries=5 给足空间，确保 break 是因 budget 而非 maxRetries。
    mocks.generateSpec.mockImplementation(async () => {
      throw new Error('mock LLM 持续失败');
    });

    const result = await runBatch(projectRoot, {
      maxRetries: 5,
      force: true,
    });

    expect(result.failed).toHaveLength(1);
    const fm = result.failed[0]!;
    expect(fm.reason).toBe('retry-budget-exceeded');
    // 关键断言：retryCount=2（forecast 触发提前 break），而非 maxRetries=5
    expect(fm.retryCount).toBe(2);
    // 实际 LLM 调用次数也只有 2 次（不是 5）
    expect(mocks.generateSpec).toHaveBeenCalledTimes(2);
    expect(fm.error).toContain('累计 input token');
    expect(fm.error).toContain('已达预算上限');
  });

  it('场景 2：maxRetries=1 → 1 次失败 forecast 不触发（cum=15k, 15+15=30 not >40）→ maxRetries 路径，reason=undefined', async () => {
    mocks.generateSpec.mockImplementation(async () => {
      throw new Error('mock 偶发失败');
    });

    const result = await runBatch(projectRoot, {
      maxRetries: 1,
      force: true,
    });

    expect(result.failed).toHaveLength(1);
    const fm = result.failed[0]!;
    // 1st fail: cum=15k, forecast=30k 不超 40k → budget 不触发，走原有 maxRetries 路径
    expect(fm.reason).toBeUndefined();
    expect(fm.retryCount).toBe(1);
  });

  it('场景 3：第 1 次 reject 第 2 次成功 → 模块标 success（成功路径累积 token 不影响）', async () => {
    let callCount = 0;
    mocks.generateSpec.mockImplementation(async (targetPath: string, options: { outputDir?: string; projectRoot?: string; existingVersion?: string }) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('first attempt fails');
      }
      const moduleSpec = buildSuccessModuleSpec(
        options.projectRoot ?? projectRoot,
        targetPath,
        options.outputDir ?? path.join(projectRoot, 'specs'),
      );
      return {
        specPath: moduleSpec.outputPath,
        skeleton: moduleSpec.baselineSkeleton,
        tokenUsage: 100,
        confidence: 'high' as const,
        warnings: [],
        moduleSpec,
        // 成功路径返回 5k input token；累积仍远低于 40k
        costMetadata: {
          tokenUsage: { input: 5_000, output: 1_000 },
          durationMs: 100,
          llmModel: 'test-model',
          fallbackReason: null,
        },
      };
    });

    const result = await runBatch(projectRoot, {
      maxRetries: 5,
      force: true,
    });

    expect(result.failed).toHaveLength(0);
    expect(result.successful).toContain('mod');
  });

  it('场景 4：失败 spec 含 retry-budget-exceeded → batch-summary markdown 含 reason 字段', async () => {
    mocks.generateSpec.mockImplementation(async () => {
      throw new Error('mock 持续失败');
    });

    const result = await runBatch(projectRoot, {
      maxRetries: 5,
      force: true,
    });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.reason).toBe('retry-budget-exceeded');

    // summaryLogPath 是项目相对路径
    const summaryAbs = path.join(projectRoot, result.summaryLogPath);
    expect(fs.existsSync(summaryAbs)).toBe(true);

    const summaryContent = fs.readFileSync(summaryAbs, 'utf-8');
    expect(summaryContent).toContain('## 失败详情');
    expect(summaryContent).toContain('retry-budget-exceeded');
  });

  /**
   * v4.0.2 hotfix regression test：
   * 必须用 default config（不传 maxRetries，走 default=3）验证 budget 真的省了 LLM 调用。
   * 之前的测试用 maxRetries=5 才让 budget 比 maxRetries 早触发，那是伪装成生效。
   * default config 下：1st fail cum=15k 重试 → 2nd fail cum=30k forecast=45k>40k → break，
   * 实际只调用 2 次（< default maxRetries=3），省 1 次 LLM 调用。
   */
  it('场景 5（regression）：default config 下 budget 必须真的省 LLM 调用，调用次数 < default maxRetries', async () => {
    mocks.generateSpec.mockImplementation(async () => {
      throw new Error('mock LLM 持续失败');
    });

    const result = await runBatch(projectRoot, {
      // 不传 maxRetries，走 default=3
      force: true,
    });

    expect(result.failed).toHaveLength(1);
    const fm = result.failed[0]!;

    // 关键断言 1：default config 下 budget 必须触发，reason 为 retry-budget-exceeded
    expect(fm.reason).toBe('retry-budget-exceeded');

    // 关键断言 2：实际 LLM 调用次数 = 2，严格小于 default maxRetries=3
    // 这是修复前彻底失效的核心：旧逻辑下会跑满 3 次，省 0 次
    expect(mocks.generateSpec).toHaveBeenCalledTimes(2);
    expect(mocks.generateSpec.mock.calls.length).toBeLessThan(3);

    // 关键断言 3：retryCount=2 反映 budget 在第 2 次失败后触发 break
    expect(fm.retryCount).toBe(2);
  });
});

function buildSuccessModuleSpec(
  projectRoot: string,
  targetPath: string,
  outputDir: string,
): ModuleSpec {
  const resolvedTarget = path.resolve(targetPath);
  const stat = fs.statSync(resolvedTarget);
  const relatedFiles = stat.isDirectory()
    ? collectFiles(projectRoot, resolvedTarget)
    : [path.relative(projectRoot, resolvedTarget).split(path.sep).join('/')];
  const sourceTarget = path.relative(projectRoot, resolvedTarget).split(path.sep).join('/');
  const specName = path.basename(resolvedTarget).replace(/\.[^.]+$/, '');
  const outputPath = path.join(outputDir, 'modules', `${specName}.spec.md`);

  return {
    frontmatter: {
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'spectra v4.0.2-test',
      sourceTarget,
      relatedFiles,
      lastUpdated: new Date().toISOString(),
      confidence: 'high',
      skeletonHash: '0'.repeat(64),
    },
    sections: {
      intent: 'i', interfaceDefinition: 'i', businessLogic: 'b',
      dataStructures: 'd', constraints: 'c', edgeCases: 'e',
      technicalDebt: 't', testCoverage: 't', dependencies: 'd',
    },
    fileInventory: relatedFiles.map((f) => ({ path: f, loc: 1, purpose: '-' })),
    baselineSkeleton: {
      filePath: relatedFiles[0]!,
      language: 'typescript',
      loc: 1,
      exports: [],
      imports: [],
      hash: '0'.repeat(64),
      analyzedAt: new Date().toISOString(),
      parserUsed: 'ts-morph',
    },
    outputPath,
  };
}

function collectFiles(projectRoot: string, dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(projectRoot, fullPath));
    } else if (entry.isFile()) {
      results.push(path.relative(projectRoot, fullPath).split(path.sep).join('/'));
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}
