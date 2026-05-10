import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

interface McpToolTraceEntry {
  toolName: string;
  callCount: number;
  firstCallTurn: number;
  totalDurationMs: number | null;
}
interface McpTraceParseResult {
  trace: McpToolTraceEntry[];
  w3Flag: boolean;
}

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
  buildClaudeArgs: (input: { tool: string; prompt: string; wtDir?: string | null; bypassPermissions?: boolean }) => string[];
  buildDriverPrompt: (input: { tool: string; taskPrompt: string; spectraContext?: string | null }) => string;
  parseMcpToolCallTrace: (stdout: string, expectedSpectraToolCalls?: string[] | null) => McpTraceParseResult;
  parseStreamJsonUsage: (stdout: string) => {
    costUsd: number | null;
    tokensInput: number | null;
    tokensOutput: number | null;
    tokensCacheRead: number | null;
  };
  loadTaskFixture: (taskId: string) => Record<string, unknown>;
  SUPPORTED_TOOLS: string[];
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

  describe('unit-test kind', () => {
    it('replaces single <workspace> placeholder', async () => {
      const { runPrimaryOracle } = await loadRunner();
      const r = runPrimaryOracle({
        wtDir: tempDir,
        oracle: { kind: 'unit-test', command: 'test -d <workspace>', expectedExit: 0 },
      });
      expect(r.kind).toBe('unit-test');
      expect(r.passed).toBe(true);
    });

    it('replaces ALL <workspace> placeholders when command contains multiple', async () => {
      const { runPrimaryOracle } = await loadRunner();
      writeFileSync(join(tempDir, 'a.txt'), '');
      writeFileSync(join(tempDir, 'b.txt'), '');
      // 命令含两个 <workspace> — 修复前第二个不会被替换，bash 会因路径不存在而失败
      const r = runPrimaryOracle({
        wtDir: tempDir,
        oracle: {
          kind: 'unit-test',
          command: 'test -f <workspace>/a.txt && test -f <workspace>/b.txt',
          expectedExit: 0,
        },
      });
      expect(r.passed).toBe(true);
    });

    it('returns passed=false when command exits with non-zero', async () => {
      const { runPrimaryOracle } = await loadRunner();
      const r = runPrimaryOracle({
        wtDir: tempDir,
        oracle: { kind: 'unit-test', command: 'test -f <workspace>/nonexistent.txt', expectedExit: 0 },
      });
      expect(r.passed).toBe(false);
    });

    // Codex review C1：wtDir 若含 $& / $$ / $` / $' 等 replaceAll 特殊模式，字符串
    // replacement 会被静默展开（$& → 匹配子串）导致路径损坏。函数式 replacement 不走
    // 特殊模式解析。直接断言 replaceAll 输出（不走 bash 是因为 bash 自身会再次解析 $&，
    // 端到端路径会被两层语义混淆，无法定位 replacement 阶段是否正确）。
    it('replaceAll function-form preserves $& / $$ in wtDir literally (Codex C1)', () => {
      const wtDirWithDollar = '/tmp/oracle-test-dollar$&_path';
      // 函数式 replacement（修复后）：$& 保持字面
      const fixed = 'test -f <workspace>/sentinel.txt'.replaceAll('<workspace>', () => wtDirWithDollar);
      expect(fixed).toBe(`test -f ${wtDirWithDollar}/sentinel.txt`);

      // 字符串 replacement（修复前）：$& 展开为匹配子串 '<workspace>'，路径被静默损坏
      const buggy = 'test -f <workspace>/sentinel.txt'.replaceAll('<workspace>', wtDirWithDollar);
      expect(buggy).toBe('test -f /tmp/oracle-test-dollar<workspace>_path/sentinel.txt');
      expect(buggy).not.toBe(fixed); // 显式声明两种形式语义不等价
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

describe('eval-task-runner.buildDriverPrompt (Sprint 3 后修订：spec-driver-spectra Constitution Check 修复)', () => {
  it('control returns taskPrompt unchanged', async () => {
    const { buildDriverPrompt } = await loadRunner();
    const r = buildDriverPrompt({ tool: 'control', taskPrompt: 'TASK_BODY' });
    expect(r).toBe('TASK_BODY');
  });

  it('spec-driver prefixes workflow keyword + 测试覆盖 red line', async () => {
    const { buildDriverPrompt } = await loadRunner();
    const r = buildDriverPrompt({ tool: 'spec-driver', taskPrompt: 'TASK_BODY' });
    // 测试覆盖 keyword 是触发 GLM 拒绝行为的关键 red line
    expect(r).toContain('严格的 spec-driven discipline');
    expect(r).toContain('测试覆盖');
    expect(r).toContain('TASK_BODY');
  });

  it('spec-driver-spectra contains 测试覆盖 keyword (Sprint 3 后根因 1 修复)', async () => {
    // 旧版模板把 "严格的 spec-driven discipline + 测试覆盖" 替换为 "spec.md context 指导决策"
    // 导致 T6 上 n=2 fully complied — 修复后应保留 keyword 与 spec-driver 工具对齐
    const { buildDriverPrompt } = await loadRunner();
    const r = buildDriverPrompt({
      tool: 'spec-driver-spectra',
      taskPrompt: 'TASK_BODY',
      spectraContext: 'SPEC_MD_CONTENT',
    });
    expect(r).toContain('严格的 spec-driven discipline');
    expect(r).toContain('测试覆盖');
    expect(r).toContain('SPEC_MD_CONTENT');
    expect(r).toContain('TASK_BODY');
  });

  it('spec-driver-spectra appends Constitution prescriptive guard rail (根因 2 修复)', async () => {
    // spec.md 是 descriptive 文档，需要末尾 prescriptive guard rail 防止 framing 压制
    const { buildDriverPrompt } = await loadRunner();
    const r = buildDriverPrompt({
      tool: 'spec-driver-spectra',
      taskPrompt: 'TASK_BODY',
      spectraContext: 'SPEC_MD',
    });
    expect(r).toContain('Constitution 提醒');
    expect(r).toContain('descriptive');
    expect(r).toContain('TASK_REFUSAL.md');
    // 顺序约束：guard rail 在 task 之后（末尾），而非中间
    const taskIdx = r.indexOf('TASK_BODY');
    const guardIdx = r.indexOf('Constitution 提醒');
    expect(guardIdx).toBeGreaterThan(taskIdx);
  });

  it('spec-driver-spectra falls back gracefully when spectraContext is null', async () => {
    const { buildDriverPrompt } = await loadRunner();
    const r = buildDriverPrompt({
      tool: 'spec-driver-spectra',
      taskPrompt: 'TASK_BODY',
      spectraContext: null,
    });
    expect(r).toContain('(spectra context unavailable)');
    expect(r).toContain('严格的 spec-driven discipline');
    expect(r).toContain('TASK_BODY');
  });

  it('spec-driver-spectra falls back when spectraContext is empty / whitespace string (Codex WARN 1)', async () => {
    // ?? 不覆盖空字符串 — Codex 对抗审查指出的 fallback 缺陷，必须用 ?.trim() ||
    const { buildDriverPrompt } = await loadRunner();
    const empty = buildDriverPrompt({
      tool: 'spec-driver-spectra',
      taskPrompt: 'T',
      spectraContext: '',
    });
    expect(empty).toContain('(spectra context unavailable)');

    const whitespaceOnly = buildDriverPrompt({
      tool: 'spec-driver-spectra',
      taskPrompt: 'T',
      spectraContext: '   \n  \t  ',
    });
    expect(whitespaceOnly).toContain('(spectra context unavailable)');
  });

  it('spec-driver-spectra Constitution 提醒位于末尾，不被 12KB context 截断 (Codex WARN 2)', async () => {
    // 模拟 loadSpectraContext 的 maxBytes=12000 上限场景，确保末尾 prescriptive guard rail 仍存在
    const { buildDriverPrompt } = await loadRunner();
    const longContext = 'X'.repeat(12000);
    const r = buildDriverPrompt({
      tool: 'spec-driver-spectra',
      taskPrompt: 'TASK_BODY',
      spectraContext: longContext,
    });
    // Constitution 提醒必须出现在 task body 之后（顺序约束）
    const taskIdx = r.indexOf('TASK_BODY');
    const guardIdx = r.indexOf('Constitution 提醒');
    expect(guardIdx).toBeGreaterThan(taskIdx);
    // 末尾 guard rail 关键 keyword 都齐全
    expect(r).toContain('descriptive');
    expect(r).toContain('TASK_REFUSAL.md');
    expect(r).toContain('应主动 surface 拒绝');
  });

  it('superpowers + gstack templates remain unchanged (regression guard)', async () => {
    const { buildDriverPrompt } = await loadRunner();
    const sp = buildDriverPrompt({ tool: 'superpowers', taskPrompt: 'X' });
    const gs = buildDriverPrompt({ tool: 'gstack', taskPrompt: 'X' });
    expect(sp).toContain('SuperPowers 框架');
    expect(sp).toContain('RED/GREEN TDD');
    expect(gs).toContain('GStack 风格');
    expect(gs).toContain('plan → build → review → test → ship');
  });
});

describe('eval-task-runner Feature 158 — mcp-pull cohort 接入', () => {
  it('SUPPORTED_TOOLS 包含 mcp-pull（FR-002 / SC-003）', async () => {
    const { SUPPORTED_TOOLS } = await loadRunner();
    expect(SUPPORTED_TOOLS).toContain('mcp-pull');
    // 现有 cohort 不被破坏
    expect(SUPPORTED_TOOLS).toContain('control');
    expect(SUPPORTED_TOOLS).toContain('spec-driver-spectra');
  });

  it('buildClaudeArgs mcp-pull 注入 --mcp-config 和 --allowedTools（FR-002 + Codex WARNING 6 精确断言）', async () => {
    const { buildClaudeArgs } = await loadRunner();
    const args = buildClaudeArgs({ tool: 'mcp-pull', prompt: 'TASK', wtDir: '/tmp/wt-x' });
    expect(args).toContain('--mcp-config');
    const cfgIdx = args.indexOf('--mcp-config');
    expect(args[cfgIdx + 1]).toBe('/tmp/wt-x/.mcp.json');
    expect(args).toContain('--allowedTools');
    const allowedIdx = args.indexOf('--allowedTools');
    // 精确 tool set 断言（spec FR-002 列出 3 spectra tool + 7 std tool）
    const allowedSet = new Set(args[allowedIdx + 1].split(','));
    expect(allowedSet).toEqual(new Set([
      'mcp__spectra__impact',
      'mcp__spectra__context',
      'mcp__spectra__detect_changes',
      'Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write',
    ]));
    // stream-json + verbose 用于 trace 解析
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args).toContain('--include-partial-messages');
    expect(args).toContain('--verbose');
    // prompt 仍是最后一个参数
    expect(args[args.length - 1]).toBe('TASK');
  });

  it('buildClaudeArgs mcp-pull 没有 wtDir 时抛错（防漏传）', async () => {
    const { buildClaudeArgs } = await loadRunner();
    expect(() => buildClaudeArgs({ tool: 'mcp-pull', prompt: 'X' })).toThrow(/wtDir/);
  });

  it('buildDriverPrompt mcp-pull cohort 与 control 完全一致（无 hint，对齐 spec AUTO-RESOLVED + Codex CRITICAL 5）', async () => {
    const { buildDriverPrompt } = await loadRunner();
    const taskBody = 'TASK_BODY_X';
    const ctrl = buildDriverPrompt({ tool: 'control', taskPrompt: taskBody });
    const mcp = buildDriverPrompt({ tool: 'mcp-pull', taskPrompt: taskBody });
    // cohort 间 prompt 主体必须完全一致（避免 confound）
    expect(mcp).toBe(ctrl);
    expect(mcp).toBe(taskBody);
    // 验证不含 hint 关键词
    expect(mcp).not.toContain('mcp__spectra__impact');
    expect(mcp).not.toContain('Hint');
  });

  it('loadTaskFixture 多目录优先序：specs/158 优先，specs/147 fallback（CR-2）', async () => {
    const { loadTaskFixture } = await loadRunner();
    // T1 在 specs/147 → 应通过 fallback 找到
    const t1 = loadTaskFixture('T1-micrograd-add-tanh') as { taskId: string };
    expect(t1.taskId).toBe('T1-micrograd-add-tanh');
    // 不存在的 fixture 抛包含两个目录路径的错误
    expect(() => loadTaskFixture('T999-nonexistent')).toThrow(/specs\/158|specs\/147/);
  });
});

describe('eval-task-runner.parseMcpToolCallTrace (Feature 158 FR-005 / W-3)', () => {
  it('callCount=0 → w3Flag=true（trap 命中）', async () => {
    const { parseMcpToolCallTrace } = await loadRunner();
    const r = parseMcpToolCallTrace('', ['impact']);
    expect(r.trace).toEqual([]);
    expect(r.w3Flag).toBe(true);
  });

  it('解析单次 mcp__spectra__impact 调用，提取 toolName/callCount/firstCallTurn', async () => {
    const { parseMcpToolCallTrace } = await loadRunner();
    const stream =
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-09T15:00:00.000Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'mcp__spectra__impact', input: { target: 'X' } }] },
      }) + '\n';
    const r = parseMcpToolCallTrace(stream, ['impact']);
    expect(r.trace).toHaveLength(1);
    expect(r.trace[0].toolName).toBe('mcp__spectra__impact');
    expect(r.trace[0].callCount).toBe(1);
    expect(r.trace[0].firstCallTurn).toBe(1);
    expect(r.w3Flag).toBe(false);
  });

  it('CL-001 短名 endsWith 匹配：toolName 不在 expected 列表 → w3Flag=true', async () => {
    const { parseMcpToolCallTrace } = await loadRunner();
    const stream =
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-09T15:00:00.000Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'mcp__spectra__context', input: {} }] },
      }) + '\n';
    // expected=['detect_changes']，调的是 context → mismatch → w3Flag=true
    const r = parseMcpToolCallTrace(stream, ['detect_changes']);
    expect(r.trace[0].toolName).toBe('mcp__spectra__context');
    expect(r.trace[0].callCount).toBe(1);
    expect(r.w3Flag).toBe(true);
  });

  it('expected=null 且有 calls → w3Flag=false（无 expectation 不算 trap）', async () => {
    const { parseMcpToolCallTrace } = await loadRunner();
    const stream =
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-09T15:00:00.000Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'mcp__spectra__impact', input: {} }] },
      }) + '\n';
    const r = parseMcpToolCallTrace(stream, null);
    expect(r.w3Flag).toBe(false);
  });

  it('多次 tool_use + 跨 turn 计数', async () => {
    const { parseMcpToolCallTrace } = await loadRunner();
    const lines = [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-09T15:00:00.000Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'mcp__spectra__impact', input: {} }] },
      }),
      // 一些 noise
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta' } }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-09T15:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_2', name: 'mcp__spectra__impact', input: {} }] },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-09T15:00:02.000Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_3', name: 'mcp__spectra__context', input: {} }] },
      }),
    ];
    const r = parseMcpToolCallTrace(lines.join('\n'), ['impact']);
    // grouped by toolName
    expect(r.trace).toHaveLength(2);
    const impact = r.trace.find((t) => t.toolName === 'mcp__spectra__impact');
    const context = r.trace.find((t) => t.toolName === 'mcp__spectra__context');
    expect(impact?.callCount).toBe(2);
    expect(context?.callCount).toBe(1);
    expect(impact?.firstCallTurn).toBe(1);
    // 至少一次匹配 expected=['impact'] → w3Flag=false
    expect(r.w3Flag).toBe(false);
  });

  it('忽略非 mcp__spectra__ 前缀的 tool_use（如 Read/Grep）', async () => {
    const { parseMcpToolCallTrace } = await loadRunner();
    const stream =
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-09T15:00:00.000Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_x', name: 'Read', input: { path: '/x' } }] },
      }) + '\n';
    const r = parseMcpToolCallTrace(stream, ['impact']);
    expect(r.trace).toEqual([]);
    expect(r.w3Flag).toBe(true); // 没调 spectra tool 视为 trap
  });

  it('忽略无效 JSON 行（容错）', async () => {
    const { parseMcpToolCallTrace } = await loadRunner();
    const stream = 'not json\n{}\n{"type":"noise"}\n';
    const r = parseMcpToolCallTrace(stream, ['impact']);
    expect(r.trace).toEqual([]);
    expect(r.w3Flag).toBe(true);
  });

  it('totalDurationMs 用 tool_use → tool_result 时间差估算', async () => {
    const { parseMcpToolCallTrace } = await loadRunner();
    const lines = [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-09T15:00:00.000Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'mcp__spectra__impact', input: {} }] },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-09T15:00:00.500Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }] },
      }),
    ];
    const r = parseMcpToolCallTrace(lines.join('\n'), null);
    expect(r.trace[0].totalDurationMs).toBe(500);
  });
});

describe('eval-task-runner.parseStreamJsonUsage (Feature 158 CR-6 修复)', () => {
  it('从 modelUsage 块提取 costUsd / tokens', async () => {
    const { parseStreamJsonUsage } = await loadRunner();
    const stream = JSON.stringify({
      type: 'result',
      modelUsage: {
        'claude-sonnet-4-6': {
          inputTokens: 100,
          outputTokens: 200,
          cacheReadInputTokens: 50,
          costUSD: 0.0123,
        },
      },
    }) + '\n';
    const u = parseStreamJsonUsage(stream);
    expect(u.costUsd).toBe(0.0123);
    expect(u.tokensInput).toBe(100);
    expect(u.tokensOutput).toBe(200);
    expect(u.tokensCacheRead).toBe(50);
  });

  it('多 model 累加 costUsd', async () => {
    const { parseStreamJsonUsage } = await loadRunner();
    const stream = JSON.stringify({
      type: 'result',
      modelUsage: {
        'claude-sonnet-4-6': { inputTokens: 50, outputTokens: 100, costUSD: 0.01 },
        'claude-opus-4-7': { inputTokens: 30, outputTokens: 80, costUSD: 0.05 },
      },
    }) + '\n';
    const u = parseStreamJsonUsage(stream);
    expect(u.costUsd).toBeCloseTo(0.06, 4);
    expect(u.tokensInput).toBe(80);
    expect(u.tokensOutput).toBe(180);
  });

  it('无 modelUsage 时返回全 null（text mode 兼容）', async () => {
    const { parseStreamJsonUsage } = await loadRunner();
    const stream = '{"type":"assistant","message":{"content":"text only"}}\n';
    const u = parseStreamJsonUsage(stream);
    expect(u.costUsd).toBeNull();
    expect(u.tokensInput).toBeNull();
  });

  it('忽略无效 JSON 行', async () => {
    const { parseStreamJsonUsage } = await loadRunner();
    const stream = 'noise\n{not json\n{}\n';
    const u = parseStreamJsonUsage(stream);
    expect(u.costUsd).toBeNull();
  });

  it('从末尾倒序找最近的 modelUsage（结果块在最后输出）', async () => {
    const { parseStreamJsonUsage } = await loadRunner();
    const lines = [
      JSON.stringify({ type: 'assistant', message: { content: 'mid' } }),
      JSON.stringify({ type: 'result', modelUsage: { 'sonnet': { inputTokens: 1, outputTokens: 2, costUSD: 0.001 } } }),
    ];
    const u = parseStreamJsonUsage(lines.join('\n'));
    expect(u.costUsd).toBe(0.001);
  });
});
