import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

interface RunnerModule {
  runPrimaryOracle: (input: { wtDir: string; oracle: Record<string, unknown> }) => {
    kind: string;
    passed: boolean;
    details: unknown;
  };
  parseArgs: (argv: string[]) => {
    task: string | null;
    tool: string | null;
    cleanup: string;
    timeoutMs: number;
    skipRun: boolean;
    skipSanity: boolean;
    bypassPermissions: boolean;
    fixtureSuffix: string;
  };
  buildClaudeArgs: (input: { tool: string; prompt: string; bypassPermissions?: boolean }) => string[];
}

let cachedModule: RunnerModule | undefined;
async function loadRunner(): Promise<RunnerModule> {
  if (cachedModule) return cachedModule;
  const url = pathToFileURL(resolve('scripts/eval-task-runner.mjs')).href;
  cachedModule = (await import(url)) as RunnerModule;
  return cachedModule;
}

describe('eval-task-runner.runPrimaryOracle', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'eval-runner-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('ast-diff kind (legacy: string checks)', () => {
    it('passes when all grep checks succeed', async () => {
      const { runPrimaryOracle } = await loadRunner();
      writeFileSync(join(tempDir, 'engine.py'), 'def tanh(self):\n    pass\n');
      const r = runPrimaryOracle({
        wtDir: tempDir,
        oracle: { kind: 'ast-diff', checks: ['grep -E "def tanh" engine.py'] },
      });
      expect(r.passed).toBe(true);
      expect(r.kind).toBe('ast-diff');
    });

    it('fails when any check fails', async () => {
      const { runPrimaryOracle } = await loadRunner();
      writeFileSync(join(tempDir, 'engine.py'), 'def relu(self):\n    pass\n');
      const r = runPrimaryOracle({
        wtDir: tempDir,
        oracle: { kind: 'ast-diff', checks: ['grep -E "def tanh" engine.py'] },
      });
      expect(r.passed).toBe(false);
    });
  });

  describe('functional kind (new: object checks with mustPass + timeout)', () => {
    it('passes when all checks exit 0 (default mustPass=true)', async () => {
      const { runPrimaryOracle } = await loadRunner();
      writeFileSync(join(tempDir, 'a.txt'), 'hello\n');
      const r = runPrimaryOracle({
        wtDir: tempDir,
        oracle: {
          kind: 'functional',
          checks: [
            { cmd: 'test -f a.txt', description: 'file exists' },
            { cmd: 'grep hello a.txt', description: 'content matches' },
          ],
        },
      });
      expect(r.passed).toBe(true);
      const details = r.details as Array<{ passed: boolean; description: string }>;
      expect(details).toHaveLength(2);
      expect(details[0].passed).toBe(true);
      expect(details[0].description).toBe('file exists');
    });

    it('detects functional bug that grep oracle misses (the "stub PASS" case)', async () => {
      const { runPrimaryOracle } = await loadRunner();
      // 模拟 T1 tanh 假 stub —— grep 'def tanh' 会通过，但 functional 跑代码会发现返回值错
      writeFileSync(
        join(tempDir, 'engine.py'),
        'def tanh(x):\n    return x  # WRONG stub\n',
      );
      // grep oracle 假阳性 PASS
      const grepResult = runPrimaryOracle({
        wtDir: tempDir,
        oracle: { kind: 'ast-diff', checks: ['grep -E "def tanh" engine.py'] },
      });
      expect(grepResult.passed).toBe(true); // grep 被骗了
      // functional oracle 真跑代码，发现 stub
      const funcResult = runPrimaryOracle({
        wtDir: tempDir,
        oracle: {
          kind: 'functional',
          checks: [
            {
              cmd: 'python3 -c "import sys; sys.path.insert(0, \\".\\"); from engine import tanh; import math; assert abs(tanh(0.5) - math.tanh(0.5)) < 1e-9, \\"stub returns wrong value\\""',
              description: 'tanh value matches math.tanh',
            },
          ],
        },
      });
      expect(funcResult.passed).toBe(false); // functional catch the stub
    });

    it('supports mustPass=false (check must FAIL to pass)', async () => {
      const { runPrimaryOracle } = await loadRunner();
      const r = runPrimaryOracle({
        wtDir: tempDir,
        oracle: {
          kind: 'functional',
          checks: [
            { cmd: 'test -f nonexistent.txt', mustPass: false, description: 'file must NOT exist' },
          ],
        },
      });
      expect(r.passed).toBe(true); // command fails (status != 0), mustPass=false → passed
    });

    it('honors timeoutMs and reports timedOut', async () => {
      const { runPrimaryOracle } = await loadRunner();
      const r = runPrimaryOracle({
        wtDir: tempDir,
        oracle: {
          kind: 'functional',
          checks: [{ cmd: 'sleep 5', timeoutMs: 100, description: 'must timeout' }],
        },
      });
      expect(r.passed).toBe(false);
      const details = r.details as Array<{ timedOut: boolean }>;
      expect(details[0].timedOut).toBe(true);
    });

    it('accepts plain string check (back-compat with ast-diff style)', async () => {
      const { runPrimaryOracle } = await loadRunner();
      writeFileSync(join(tempDir, 'a.txt'), 'ok');
      const r = runPrimaryOracle({
        wtDir: tempDir,
        oracle: { kind: 'functional', checks: ['test -f a.txt'] },
      });
      expect(r.passed).toBe(true);
    });
  });

  describe('stop-condition kind', () => {
    it('passes when all stop-conditions hold', async () => {
      const { runPrimaryOracle } = await loadRunner();
      mkdirSync(join(tempDir, 'test'));
      writeFileSync(join(tempDir, 'test/test_engine.py'), 'def test_x(): pass\n');
      const r = runPrimaryOracle({
        wtDir: tempDir,
        oracle: {
          kind: 'stop-condition',
          checks: ['test -s test/test_engine.py', 'grep -E "def test_" test/test_engine.py'],
        },
      });
      expect(r.passed).toBe(true);
    });
  });

  describe('unknown kind', () => {
    it('returns passed=false with details', async () => {
      const { runPrimaryOracle } = await loadRunner();
      const r = runPrimaryOracle({
        wtDir: tempDir,
        oracle: { kind: 'mystery', checks: [] },
      });
      expect(r.passed).toBe(false);
      expect(r.details).toBe('unknown oracle kind');
    });
  });
});

describe('eval-task-runner.parseArgs (Sprint 3 Phase D flags)', () => {
  it('defaults bypassPermissions to false and fixtureSuffix to empty', async () => {
    const { parseArgs } = await loadRunner();
    const r = parseArgs(['--task', 'T2-nanogpt-cosine-lr', '--tool', 'spec-driver']);
    expect(r.bypassPermissions).toBe(false);
    expect(r.fixtureSuffix).toBe('');
  });

  it('parses --bypass-permissions', async () => {
    const { parseArgs } = await loadRunner();
    const r = parseArgs(['--task', 'T2-nanogpt-cosine-lr', '--tool', 'spec-driver', '--bypass-permissions']);
    expect(r.bypassPermissions).toBe(true);
  });

  it('parses --fixture-suffix', async () => {
    const { parseArgs } = await loadRunner();
    const r = parseArgs(['--task', 'T2-nanogpt-cosine-lr', '--tool', 'spec-driver', '--fixture-suffix', 'multiturn']);
    expect(r.fixtureSuffix).toBe('multiturn');
  });
});

describe('eval-task-runner.buildClaudeArgs (Sprint 3 Phase D bypass-permissions)', () => {
  it('uses acceptEdits permission mode by default (no bypass)', async () => {
    const { buildClaudeArgs } = await loadRunner();
    const args = buildClaudeArgs({ tool: 'control', prompt: 'do thing' });
    const i = args.indexOf('--permission-mode');
    expect(args[i + 1]).toBe('acceptEdits');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('uses bypassPermissions + --dangerously-skip-permissions when bypassPermissions=true', async () => {
    const { buildClaudeArgs } = await loadRunner();
    const args = buildClaudeArgs({ tool: 'control', prompt: 'do thing', bypassPermissions: true });
    const i = args.indexOf('--permission-mode');
    expect(args[i + 1]).toBe('bypassPermissions');
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('puts prompt as the LAST arg (avoid variadic flag swallow)', async () => {
    const { buildClaudeArgs } = await loadRunner();
    const args = buildClaudeArgs({ tool: 'control', prompt: 'PROMPT_TOKEN', bypassPermissions: true });
    expect(args[args.length - 1]).toBe('PROMPT_TOKEN');
  });
});
