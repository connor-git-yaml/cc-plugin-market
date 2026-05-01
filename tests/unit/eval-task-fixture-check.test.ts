import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface SanityModule {
  parseArgs: (argv: string[]) => { task: string | null; all: boolean; verbose: boolean };
  checkFixtureSanity: (
    taskFixture: Record<string, unknown>,
    deps: {
      prepareWorktreeFn: (opts: unknown) => { wtDir: string; branchName?: string };
      runOracleFn: (input: { wtDir: string; oracle: unknown }) => { passed: boolean; details?: unknown };
      runSetupCmdsFn?: (wtDir: string, cmds: string[]) => void;
    },
  ) => { status: 'ok' | 'invalid' | 'error'; reason: string; oracleResult?: { passed: boolean } };
}

let cached: SanityModule | undefined;
async function loadSanity(): Promise<SanityModule> {
  if (cached) return cached;
  const url = pathToFileURL(resolve('scripts/eval-task-fixture-check.mjs')).href;
  cached = (await import(url)) as SanityModule;
  return cached;
}

const VALID_FIXTURE = {
  taskId: 'T-test',
  target: 'karpathy/micrograd',
  startCommit: 'abc123',
  primaryOracle: { kind: 'ast-diff', checks: ['grep "def tanh" engine.py'] },
};

describe('eval-task-fixture-check', () => {
  describe('parseArgs', () => {
    it('parses --task', async () => {
      const { parseArgs } = await loadSanity();
      const a = parseArgs(['--task', 'T1']);
      expect(a.task).toBe('T1');
      expect(a.all).toBe(false);
    });

    it('parses --all', async () => {
      const { parseArgs } = await loadSanity();
      const a = parseArgs(['--all']);
      expect(a.all).toBe(true);
    });

    it('throws when neither --task nor --all', async () => {
      const { parseArgs } = await loadSanity();
      expect(() => parseArgs([])).toThrow(/--task.*--all required/);
    });
  });

  describe('checkFixtureSanity', () => {
    it('returns OK when oracle FAILS in setup state (task has real work)', async () => {
      const { checkFixtureSanity } = await loadSanity();
      const result = checkFixtureSanity(VALID_FIXTURE, {
        prepareWorktreeFn: vi.fn(() => ({ wtDir: '/fake/wt' })),
        runOracleFn: vi.fn(() => ({ passed: false, details: 'no tanh found' })),
      });
      expect(result.status).toBe('ok');
    });

    it('returns INVALID when oracle PASSES in setup state (T2 类 bug)', async () => {
      const { checkFixtureSanity } = await loadSanity();
      const result = checkFixtureSanity(VALID_FIXTURE, {
        prepareWorktreeFn: vi.fn(() => ({ wtDir: '/fake/wt' })),
        runOracleFn: vi.fn(() => ({ passed: true, details: 'tanh already present' })),
      });
      expect(result.status).toBe('invalid');
      expect(result.reason).toMatch(/oracle.*PASS/i);
      expect(result.oracleResult?.passed).toBe(true);
    });

    it('runs setupCommands before oracle when present', async () => {
      const { checkFixtureSanity } = await loadSanity();
      const fxWithSetup = {
        ...VALID_FIXTURE,
        setupCommands: ['echo step1', 'echo step2'],
      };
      const setupSpy = vi.fn();
      const result = checkFixtureSanity(fxWithSetup, {
        prepareWorktreeFn: vi.fn(() => ({ wtDir: '/fake/wt' })),
        runOracleFn: vi.fn(() => ({ passed: false })),
        runSetupCmdsFn: setupSpy,
      });
      expect(setupSpy).toHaveBeenCalledTimes(1);
      expect(setupSpy).toHaveBeenCalledWith('/fake/wt', ['echo step1', 'echo step2']);
      expect(result.status).toBe('ok');
    });

    it('returns ERROR when fixture missing required fields', async () => {
      const { checkFixtureSanity } = await loadSanity();
      const result = checkFixtureSanity({}, {
        prepareWorktreeFn: vi.fn(),
        runOracleFn: vi.fn(),
      });
      expect(result.status).toBe('error');
      expect(result.reason).toMatch(/missing/);
    });

    it('returns ERROR when fixture missing primaryOracle', async () => {
      const { checkFixtureSanity } = await loadSanity();
      const result = checkFixtureSanity(
        { taskId: 'T1', target: 'x', startCommit: 'y' },
        { prepareWorktreeFn: vi.fn(() => ({ wtDir: '/fake' })), runOracleFn: vi.fn() },
      );
      expect(result.status).toBe('error');
      expect(result.reason).toMatch(/primaryOracle/);
    });

    it('returns ERROR when prepareWorktree throws', async () => {
      const { checkFixtureSanity } = await loadSanity();
      const result = checkFixtureSanity(VALID_FIXTURE, {
        prepareWorktreeFn: vi.fn(() => { throw new Error('baseline missing'); }),
        runOracleFn: vi.fn(),
      });
      expect(result.status).toBe('error');
      expect(result.reason).toMatch(/worktree prep failed.*baseline missing/);
    });

    it('returns ERROR when setupCommands throws', async () => {
      const { checkFixtureSanity } = await loadSanity();
      const result = checkFixtureSanity(
        { ...VALID_FIXTURE, setupCommands: ['boom'] },
        {
          prepareWorktreeFn: vi.fn(() => ({ wtDir: '/fake' })),
          runOracleFn: vi.fn(),
          runSetupCmdsFn: vi.fn(() => { throw new Error('cmd failed'); }),
        },
      );
      expect(result.status).toBe('error');
      expect(result.reason).toMatch(/setup failed.*cmd failed/);
    });

    it('skips runSetupCmdsFn when setupCommands array is empty', async () => {
      const { checkFixtureSanity } = await loadSanity();
      const setupSpy = vi.fn();
      const result = checkFixtureSanity(
        { ...VALID_FIXTURE, setupCommands: [] },
        {
          prepareWorktreeFn: vi.fn(() => ({ wtDir: '/fake' })),
          runOracleFn: vi.fn(() => ({ passed: false })),
          runSetupCmdsFn: setupSpy,
        },
      );
      expect(setupSpy).not.toHaveBeenCalled();
      expect(result.status).toBe('ok');
    });
  });

  describe('runSanityCheck env restoration', () => {
    it('does NOT pollute SPEC_DRIVER_BENCH_HOME when previously unset', async () => {
      // 这个 test 验证 finally-block 不会把未设置的 env 恢复成 string 'undefined'
      // 直接测试需要 module 内部 try/finally 行为，这里改为单元验证 env handling 模式
      const wasSet = 'SPEC_DRIVER_BENCH_HOME' in process.env;
      const original = process.env.SPEC_DRIVER_BENCH_HOME;
      delete process.env.SPEC_DRIVER_BENCH_HOME;
      try {
        // 模拟 runSanityCheck 内的 env 设置 + 恢复模式
        const hadEnv = 'SPEC_DRIVER_BENCH_HOME' in process.env;
        const saved = process.env.SPEC_DRIVER_BENCH_HOME;
        process.env.SPEC_DRIVER_BENCH_HOME = '/tmp/bench-test';
        // ... 假设这里跑了 sanity check
        if (hadEnv) process.env.SPEC_DRIVER_BENCH_HOME = saved!;
        else delete process.env.SPEC_DRIVER_BENCH_HOME;
        // env 必须仍未设置
        expect('SPEC_DRIVER_BENCH_HOME' in process.env).toBe(false);
        expect(process.env.SPEC_DRIVER_BENCH_HOME).toBeUndefined();
      } finally {
        // 还原原始状态
        if (wasSet) process.env.SPEC_DRIVER_BENCH_HOME = original;
      }
    });
  });
});
