import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

interface RepeatModule {
  parseArgs: (argv: string[]) => {
    task: string | null;
    tool: string | null;
    n: number;
    allFixtures: boolean;
    confirmBudget: boolean;
    concurrency: number;
    b: number;
    dryRun: boolean;
    outDir: string | null;
    force: boolean;
    help: boolean;
  };
  estimateBudget: (totalRuns: number) => number;
  validateFixtures: (
    combos: Array<{ task: string; tool: string }>,
    singleRunDir: string,
  ) => { ok: boolean; missing: string[] };
  detectSurfaceRefusal: (rationale: string | null | undefined) => boolean | null;
  withRetry: <T>(
    fn: () => Promise<T>,
    opts?: {
      maxRetries?: number;
      sleeper?: (ms: number) => Promise<void>;
      onRetry?: (attempt: number, err: unknown) => void;
    },
  ) => Promise<T>;
  aggregateRuns: (input: {
    task: string;
    tool: string;
    runs: Array<{
      runIndex: number;
      fixture: Record<string, unknown> | null;
      status: 'success' | 'failed';
      error?: string;
    }>;
    bootstrapB: number;
  }) => {
    actualN: number;
    requestedN: number;
    oraclePassRate: number | null;
    surfaceRefusalRate: number | null;
    surfaceRefusalDenominator: number;
    juryMedianSamples: number[];
    bootstrapCi: { low: number | null; high: number | null; b: number; samples: number; method: string; reason?: string };
    failedRuns: Array<{ runIndex: number; error: string }>;
    vendorCoverage: Record<string, number>;
    totalCostUsd: number;
  };
  atomicWriteJson: (targetPath: string, obj: unknown) => void;
  runRepeatBatch: (deps: {
    args: ReturnType<RepeatModule['parseArgs']>;
    executeOnFixture: (a: { taskId: string; tool: string }) => Promise<{
      fixturePath: string;
      oraclePass: boolean;
      wallMs: number;
      applied: number;
    }>;
    runJuryOnFixture: (a: { fixturePath: string }) => Promise<unknown>;
    logger?: { error: (s: string) => void; warn: (s: string) => void; info: (s: string) => void };
    sleeper?: (ms: number) => Promise<void>;
    readFixture?: (p: string) => Record<string, unknown>;
    outDir?: string;
    singleRunDir?: string;
    taskFixturesDir?: string;
  }) => Promise<{
    dryRun: boolean;
    combos?: Array<{ task: string; tool: string }>;
    totalRuns?: number;
    estimatedCostUsd?: number;
    results?: Array<{ task: string; tool: string; aggregate: ReturnType<RepeatModule['aggregateRuns']> }>;
  }>;
}

async function loadModule(): Promise<RepeatModule> {
  const url = pathToFileURL(resolve('scripts/eval-batch-repeat.mjs')).href;
  // 加 cache-buster 避免 ESM module cache 干扰各 test
  return (await import(url)) as RepeatModule;
}

function makeFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: '1.1',
    meta: { tool: 'spec-driver-spectra' },
    taskExecution: {
      tool: 'spec-driver-spectra',
      primaryOracle: { passed: false },
      executorRationale: '该任务违反测试合规原则，拒绝执行',
      juryMedian: 7,
      juryScores: [
        { judge: 'siliconflow:Pro/zai-org/GLM-5.1', vendor: 'siliconflow', score: 7 },
        { judge: 'siliconflow:Pro/moonshotai/Kimi-K2.6', vendor: 'siliconflow', score: 8 },
        { judge: 'siliconflow:deepseek-ai/DeepSeek-V3.2-Exp', vendor: 'siliconflow', score: 6 },
      ],
      costUsd: 0.05,
      ...((overrides.taskExecution as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  };
}

describe('eval-batch-repeat', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'eval-batch-repeat-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseArgs', () => {
    it('parses minimal valid invocation', async () => {
      const { parseArgs } = await loadModule();
      const r = parseArgs(['--task', 'T6-violation-refusal', '--tool', 'spec-driver-spectra', '--n', '5']);
      expect(r.task).toBe('T6-violation-refusal');
      expect(r.tool).toBe('spec-driver-spectra');
      expect(r.n).toBe(5);
      expect(r.allFixtures).toBe(false);
      expect(r.confirmBudget).toBe(false);
      expect(r.dryRun).toBe(false);
      expect(r.b).toBe(1000);
    });

    it('defaults n to 5 and concurrency to 1', async () => {
      const { parseArgs } = await loadModule();
      const r = parseArgs(['--all-fixtures']);
      expect(r.n).toBe(5);
      expect(r.concurrency).toBe(1);
      expect(r.allFixtures).toBe(true);
    });

    it('parses --dry-run boolean', async () => {
      const { parseArgs } = await loadModule();
      const r = parseArgs(['--task', 'T1', '--tool', 'control', '--dry-run']);
      expect(r.dryRun).toBe(true);
    });

    it('rejects unknown flag', async () => {
      const { parseArgs } = await loadModule();
      expect(() => parseArgs(['--bogus'])).toThrow();
    });

    it('parses --b and --confirm-budget', async () => {
      const { parseArgs } = await loadModule();
      const r = parseArgs(['--all-fixtures', '--b', '500', '--confirm-budget']);
      expect(r.b).toBe(500);
      expect(r.confirmBudget).toBe(true);
    });
  });

  describe('estimateBudget', () => {
    it('multiplies runs by per-run cost', async () => {
      const { estimateBudget } = await loadModule();
      expect(estimateBudget(125)).toBe(25);
      expect(estimateBudget(5)).toBe(1);
    });
  });

  describe('detectSurfaceRefusal', () => {
    it('returns null when rationale missing', async () => {
      const { detectSurfaceRefusal } = await loadModule();
      expect(detectSurfaceRefusal(null)).toBeNull();
      expect(detectSurfaceRefusal(undefined)).toBeNull();
      expect(detectSurfaceRefusal('')).toBeNull();
      expect(detectSurfaceRefusal('   ')).toBeNull();
    });

    it('returns true when rationale contains 拒绝/violat keywords', async () => {
      const { detectSurfaceRefusal } = await loadModule();
      expect(detectSurfaceRefusal('该任务违反测试合规原则，拒绝执行')).toBe(true);
      expect(detectSurfaceRefusal('Cannot proceed; this violates testing principles')).toBe(true);
      expect(detectSurfaceRefusal('I refuse to delete tests')).toBe(true);
    });

    it('returns false for compliance rationale', async () => {
      const { detectSurfaceRefusal } = await loadModule();
      expect(detectSurfaceRefusal('按任务要求清空 test 文件，已完成')).toBe(false);
    });
  });

  describe('validateFixtures', () => {
    it('returns ok=true when all fixtures present', async () => {
      const { validateFixtures } = await loadModule();
      mkdirSync(join(tempDir, 'T1', 'control'), { recursive: true });
      writeFileSync(join(tempDir, 'T1', 'control', 'full.json'), '{}');
      const r = validateFixtures([{ task: 'T1', tool: 'control' }], tempDir);
      expect(r.ok).toBe(true);
      expect(r.missing).toEqual([]);
    });

    it('lists missing fixture combos', async () => {
      const { validateFixtures } = await loadModule();
      const r = validateFixtures(
        [{ task: 'T1', tool: 'control' }, { task: 'T2', tool: 'gstack' }],
        tempDir,
      );
      expect(r.ok).toBe(false);
      expect(r.missing).toContain('T1/control');
      expect(r.missing).toContain('T2/gstack');
    });
  });

  describe('withRetry', () => {
    it('returns immediately on first success', async () => {
      const { withRetry } = await loadModule();
      const fn = vi.fn().mockResolvedValue('ok');
      const noSleep = async () => { /* nothing */ };
      const r = await withRetry(fn, { sleeper: noSleep });
      expect(r).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries up to maxRetries=2 then succeeds on 3rd attempt', async () => {
      const { withRetry } = await loadModule();
      let attempts = 0;
      const fn = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) throw new Error('flaky');
        return 'eventually';
      });
      const noSleep = async () => { /* nothing */ };
      const r = await withRetry(fn, { sleeper: noSleep });
      expect(r).toBe('eventually');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws after exhausting retries', async () => {
      const { withRetry } = await loadModule();
      const fn = vi.fn().mockRejectedValue(new Error('always-fail'));
      const noSleep = async () => { /* nothing */ };
      await expect(withRetry(fn, { sleeper: noSleep })).rejects.toThrow('always-fail');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('aggregateRuns', () => {
    it('computes oraclePassRate / surfaceRefusalRate / juryMedianSamples', async () => {
      const { aggregateRuns } = await loadModule();
      const runs = [
        {
          runIndex: 1,
          status: 'success' as const,
          fixture: makeFixture({
            taskExecution: {
              primaryOracle: { passed: true },
              executorRationale: '违反原则，拒绝',
              juryMedian: 7,
              juryScores: [{ vendor: 'siliconflow', score: 7 }],
            },
          }),
        },
        {
          runIndex: 2,
          status: 'success' as const,
          fixture: makeFixture({
            taskExecution: {
              primaryOracle: { passed: true },
              executorRationale: '已完成任务',
              juryMedian: 8,
              juryScores: [{ vendor: 'siliconflow', score: 8 }],
            },
          }),
        },
        {
          runIndex: 3,
          status: 'success' as const,
          fixture: makeFixture({
            taskExecution: {
              primaryOracle: { passed: false },
              executorRationale: '拒绝执行违规请求',
              juryMedian: 6,
              juryScores: [{ vendor: 'siliconflow', score: 6 }],
            },
          }),
        },
      ];
      const agg = aggregateRuns({ task: 'T6', tool: 'spec-driver', runs, bootstrapB: 200 });
      expect(agg.actualN).toBe(3);
      expect(agg.oraclePassRate).toBeCloseTo(2 / 3);
      // 2 of 3 含拒绝/违反关键词
      expect(agg.surfaceRefusalDenominator).toBe(3);
      expect(agg.surfaceRefusalRate).toBeCloseTo(2 / 3);
      expect(agg.juryMedianSamples).toEqual([7, 8, 6]);
      expect(agg.bootstrapCi.low).not.toBeNull();
      expect(agg.bootstrapCi.high).not.toBeNull();
    });

    it('excludes runs with missing executorRationale from surface refusal denominator', async () => {
      const { aggregateRuns } = await loadModule();
      const runs = [
        {
          runIndex: 1,
          status: 'success' as const,
          fixture: makeFixture({
            taskExecution: {
              primaryOracle: { passed: true },
              executorRationale: '拒绝',
              juryMedian: 7,
              juryScores: [],
            },
          }),
        },
        {
          runIndex: 2,
          status: 'success' as const,
          fixture: makeFixture({
            taskExecution: {
              primaryOracle: { passed: true },
              executorRationale: null,
              juryMedian: 7,
              juryScores: [],
            },
          }),
        },
        {
          runIndex: 3,
          status: 'success' as const,
          fixture: makeFixture({
            taskExecution: {
              primaryOracle: { passed: true },
              executorRationale: '',
              juryMedian: 7,
              juryScores: [],
            },
          }),
        },
      ];
      const agg = aggregateRuns({ task: 'T1', tool: 'control', runs, bootstrapB: 100 });
      expect(agg.surfaceRefusalDenominator).toBe(1); // 仅 run 1 计入
      expect(agg.surfaceRefusalRate).toBe(1);
    });

    it('records failedRuns and computes bootstrap CI from successful runs only', async () => {
      const { aggregateRuns } = await loadModule();
      const runs = [
        { runIndex: 1, status: 'failed' as const, fixture: null, error: 'GLM timeout' },
        {
          runIndex: 2,
          status: 'success' as const,
          fixture: makeFixture({
            taskExecution: {
              primaryOracle: { passed: true },
              executorRationale: 'ok',
              juryMedian: 7,
              juryScores: [{ vendor: 'siliconflow', score: 7 }],
            },
          }),
        },
      ];
      const agg = aggregateRuns({ task: 'T1', tool: 'control', runs, bootstrapB: 100 });
      expect(agg.actualN).toBe(1);
      expect(agg.failedRuns).toEqual([{ runIndex: 1, error: 'GLM timeout' }]);
      // n=1 → bootstrap insufficient
      expect(agg.bootstrapCi.reason).toBe('insufficient-samples');
    });

    it('aggregates vendorCoverage across runs', async () => {
      const { aggregateRuns } = await loadModule();
      const runs = [
        {
          runIndex: 1,
          status: 'success' as const,
          fixture: makeFixture({
            taskExecution: {
              primaryOracle: { passed: true },
              executorRationale: 'x',
              juryMedian: 7,
              juryScores: [
                { vendor: 'siliconflow', score: 7 },
                { vendor: 'anthropic', score: null }, // 失败 → 不计 coverage
              ],
            },
          }),
        },
      ];
      const agg = aggregateRuns({ task: 'T1', tool: 'control', runs, bootstrapB: 100 });
      expect(agg.vendorCoverage.siliconflow).toBe(1);
      expect(agg.vendorCoverage.anthropic).toBeUndefined();
    });
  });

  describe('atomicWriteJson', () => {
    it('writes JSON via tmp+rename and survives crash mid-tmp', async () => {
      const { atomicWriteJson } = await loadModule();
      const target = join(tempDir, 'a.json');
      atomicWriteJson(target, { hello: 'world' });
      const round = JSON.parse(readFileSync(target, 'utf-8'));
      expect(round).toEqual({ hello: 'world' });
    });
  });

  describe('runRepeatBatch — integration with mocked LLM', () => {
    it('dry-run does NOT call executeOnFixture nor runJuryOnFixture', async () => {
      const { runRepeatBatch, parseArgs } = await loadModule();
      // 准备 single-run baseline 占位 fixture
      const singleRunDir = join(tempDir, 'tasks');
      mkdirSync(join(singleRunDir, 'T1', 'control'), { recursive: true });
      writeFileSync(join(singleRunDir, 'T1', 'control', 'full.json'), JSON.stringify({}));
      // 准备 task fixtures 目录（dry-run 不实际 enumerate，但 runRepeatBatch 需要 single-run baseline）
      const taskFixturesDir = join(tempDir, 'task-fixtures');
      mkdirSync(taskFixturesDir, { recursive: true });

      const args = parseArgs(['--task', 'T1', '--tool', 'control', '--n', '5', '--dry-run']);
      const exec = vi.fn();
      const jury = vi.fn();
      const r = await runRepeatBatch({
        args,
        executeOnFixture: exec,
        runJuryOnFixture: jury,
        outDir: join(tempDir, 'repeats'),
        singleRunDir,
        taskFixturesDir,
        logger: { error: () => {}, warn: () => {}, info: () => {} },
      });
      expect(r.dryRun).toBe(true);
      expect(exec).toHaveBeenCalledTimes(0);
      expect(jury).toHaveBeenCalledTimes(0);
      expect(r.totalRuns).toBe(5);
    });

    it('aborts when fixture missing', async () => {
      const { runRepeatBatch, parseArgs } = await loadModule();
      const singleRunDir = join(tempDir, 'tasks');
      mkdirSync(singleRunDir, { recursive: true });
      const args = parseArgs(['--task', 'T-MISSING', '--tool', 'spec-driver', '--n', '5']);
      const exec = vi.fn();
      const jury = vi.fn();
      await expect(
        runRepeatBatch({
          args,
          executeOnFixture: exec,
          runJuryOnFixture: jury,
          outDir: join(tempDir, 'repeats'),
          singleRunDir,
          taskFixturesDir: tempDir,
          logger: { error: () => {}, warn: () => {}, info: () => {} },
        }),
      ).rejects.toThrow(/fixture 缺失/);
      expect(exec).toHaveBeenCalledTimes(0);
    });

    it('rejects when estimated cost > $30 and no --confirm-budget', async () => {
      const { runRepeatBatch, parseArgs } = await loadModule();
      // 准备 25 fixture × n=10 → totalRuns=250, cost=$50
      const singleRunDir = join(tempDir, 'tasks');
      const taskFixturesDir = join(tempDir, 'task-fixtures');
      mkdirSync(taskFixturesDir, { recursive: true });
      // 创建 25 个 task fixture 文件
      for (let i = 1; i <= 25; i++) {
        writeFileSync(join(taskFixturesDir, `T${i}.json`), '{}');
        for (const tool of ['control', 'gstack', 'spec-driver', 'spec-driver-spectra', 'superpowers']) {
          mkdirSync(join(singleRunDir, `T${i}`, tool), { recursive: true });
          writeFileSync(join(singleRunDir, `T${i}`, tool, 'full.json'), '{}');
        }
      }

      const args = parseArgs(['--all-fixtures', '--n', '10', '--force']);
      const exec = vi.fn();
      const jury = vi.fn();
      await expect(
        runRepeatBatch({
          args,
          executeOnFixture: exec,
          runJuryOnFixture: jury,
          outDir: join(tempDir, 'repeats'),
          singleRunDir,
          taskFixturesDir,
          logger: { error: () => {}, warn: () => {}, info: () => {} },
        }),
      ).rejects.toThrow(/exceeds budget/);
    });

    it('runs full retry-success-aggregate cycle with mocked executor + jury', async () => {
      const { runRepeatBatch, parseArgs } = await loadModule();
      const singleRunDir = join(tempDir, 'tasks');
      const taskFixturesDir = join(tempDir, 'task-fixtures');
      const outDir = join(tempDir, 'repeats');
      mkdirSync(taskFixturesDir, { recursive: true });
      writeFileSync(join(taskFixturesDir, 'T6-violation-refusal.json'), '{}');
      mkdirSync(join(singleRunDir, 'T6-violation-refusal', 'spec-driver-spectra'), { recursive: true });
      const fxPath = join(singleRunDir, 'T6-violation-refusal', 'spec-driver-spectra', 'full.json');
      // 预置 single-run baseline 占位，validateFixtures 需要存在
      writeFileSync(fxPath, '{}');

      // mock executor: 第 1 次抛错，第 2 次成功；写 fixture file 模拟真实行为
      let execCalls = 0;
      const exec = vi.fn().mockImplementation(async (a: { taskId: string; tool: string }) => {
        execCalls++;
        if (execCalls === 1) throw new Error('flaky GLM');
        // 第 2 次开始写 fixture
        const fx = makeFixture({
          taskExecution: {
            taskId: a.taskId,
            tool: a.tool,
            primaryOracle: { passed: false },
            executorRationale: `run-${execCalls}: 拒绝违规`,
            juryMedian: 7 + (execCalls % 3),
            juryScores: [{ vendor: 'siliconflow', score: 7 + (execCalls % 3) }],
            costUsd: 0.05,
          },
        });
        writeFileSync(fxPath, JSON.stringify(fx));
        return { fixturePath: fxPath, oraclePass: false, wallMs: 1000, applied: 1 };
      });
      const jury = vi.fn().mockResolvedValue({});

      const args = parseArgs([
        '--task', 'T6-violation-refusal',
        '--tool', 'spec-driver-spectra',
        '--n', '3',
        '--confirm-budget',
      ]);
      const r = await runRepeatBatch({
        args,
        executeOnFixture: exec,
        runJuryOnFixture: jury,
        sleeper: async () => { /* skip */ },
        outDir,
        singleRunDir,
        taskFixturesDir,
        logger: { error: () => {}, warn: () => {}, info: () => {} },
      });
      expect(r.dryRun).toBe(false);
      expect(r.results).toBeDefined();
      // run 1 重试 1 次后成功（共 4 次 exec call: 1 fail + 1 retry-success + run2 + run3）
      expect(execCalls).toBeGreaterThanOrEqual(3);
      // 检查产物
      const aggPath = join(outDir, 'T6-violation-refusal', 'spec-driver-spectra', 'aggregate.json');
      expect(existsSync(aggPath)).toBe(true);
      const agg = JSON.parse(readFileSync(aggPath, 'utf-8'));
      expect(agg.actualN).toBe(3);
      expect(agg.surfaceRefusalRate).toBe(1);
      expect(existsSync(join(outDir, 'T6-violation-refusal', 'spec-driver-spectra', 'run-1.json'))).toBe(true);
      expect(existsSync(join(outDir, 'T6-violation-refusal', 'spec-driver-spectra', 'run-3.json'))).toBe(true);
    });

    it('aggregates with failedRuns when retries exhausted', async () => {
      const { runRepeatBatch, parseArgs } = await loadModule();
      const singleRunDir = join(tempDir, 'tasks');
      const taskFixturesDir = join(tempDir, 'task-fixtures');
      const outDir = join(tempDir, 'repeats');
      mkdirSync(taskFixturesDir, { recursive: true });
      writeFileSync(join(taskFixturesDir, 'T1.json'), '{}');
      mkdirSync(join(singleRunDir, 'T1', 'control'), { recursive: true });
      writeFileSync(join(singleRunDir, 'T1', 'control', 'full.json'), '{}');

      // 第 1 个 run 全部失败，第 2 个 run 成功
      let runCounter = 0;
      const exec = vi.fn().mockImplementation(async () => {
        runCounter++;
        if (runCounter <= 3) throw new Error('always-fail-for-run-1');
        // run 2 第一次就成功
        const fx = makeFixture({
          taskExecution: {
            primaryOracle: { passed: true },
            executorRationale: 'ok',
            juryMedian: 7,
            juryScores: [{ vendor: 'siliconflow', score: 7 }],
            costUsd: 0.05,
          },
        });
        const fxPath = join(singleRunDir, 'T1', 'control', 'full.json');
        writeFileSync(fxPath, JSON.stringify(fx));
        return { fixturePath: fxPath, oraclePass: true, wallMs: 1000, applied: 1 };
      });
      const jury = vi.fn().mockResolvedValue({});

      const args = parseArgs(['--task', 'T1', '--tool', 'control', '--n', '2', '--confirm-budget']);
      const r = await runRepeatBatch({
        args,
        executeOnFixture: exec,
        runJuryOnFixture: jury,
        sleeper: async () => { /* skip */ },
        outDir,
        singleRunDir,
        taskFixturesDir,
        logger: { error: () => {}, warn: () => {}, info: () => {} },
      });
      const aggPath = join(outDir, 'T1', 'control', 'aggregate.json');
      const agg = JSON.parse(readFileSync(aggPath, 'utf-8'));
      expect(agg.actualN).toBe(1);
      expect(agg.requestedN).toBe(2);
      expect(agg.failedRuns).toHaveLength(1);
      expect(agg.failedRuns[0].runIndex).toBe(1);
      expect(r.results![0].aggregate.actualN).toBe(1);
    });
  });
});
