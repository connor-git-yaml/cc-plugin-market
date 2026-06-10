/**
 * Feature 176 Phase C — cohort3（spec-driver-spectra-mcp）派发单测（tasks T-C1/C2/C3）。
 *
 * 覆盖：
 *   - buildClaudeArgs cohort3：opus-4-7 默认 + stream-json + --plugin-dir + plugin-namespace
 *     allowedTools + **无位置 prompt**（stdin，spike 实证 variadic 防吃）
 *   - buildDriverPrompt cohort3 与 spec-driver **逐字一致**（FR-A-003 confound 控制）
 *   - parseMcpToolCallTrace 计入 plugin namespace（T-C2）
 *   - model/outputFormat 参数化不破坏既有默认（T-C3/KD-7；回归由既有 6 个测试文件守护）
 *   - prepareWorktree repeatIndex 隔离（T-D1/FR-A-006b）
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  COHORT3_TOOL,
  COHORT3_ALLOWED_TOOLS,
  SUPPORTED_TOOLS,
  TASK_FIXTURE_DIRS,
  buildClaudeArgs,
  buildDriverPrompt,
  parseMcpToolCallTrace,
  parseArgs,
  prepareWorktree,
  loadTaskFixture,
  runPrimaryOracle,
} from '../../scripts/eval-task-runner.mjs';
import { fixturesDir } from '../../scripts/lib/swe-bench-verified-paths.mjs';

const TASK_PROMPT = '修复 src/foo.py 的 off-by-one bug';

describe('T-C1 buildClaudeArgs cohort3', () => {
  const args = buildClaudeArgs({
    tool: COHORT3_TOOL, prompt: TASK_PROMPT, bypassPermissions: true,
    spectraPluginDir: '/tmp/f176-spectra-plugin-x',
  });

  it('driver model 默认 opus-4-7（spec/milestone §3）', () => {
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-4-7');
  });

  it('强制 stream-json + partial + verbose（trace/token 解析依赖）', () => {
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args).toContain('--include-partial-messages');
    expect(args).toContain('--verbose');
  });

  it('--plugin-dir 指向本地 spectra plugin；allowedTools 含 plugin namespace + Task', () => {
    expect(args[args.indexOf('--plugin-dir') + 1]).toBe('/tmp/f176-spectra-plugin-x');
    const allowed = args[args.indexOf('--allowedTools') + 1];
    expect(allowed).toBe(COHORT3_ALLOWED_TOOLS);
    expect(allowed).toContain('mcp__plugin_spectra_spectra__context');
    expect(allowed).toContain('Task');
  });

  it('不含位置 prompt（stdin 喂，variadic --allowedTools 防吃）', () => {
    expect(args).not.toContain(TASK_PROMPT);
    expect(args[args.length - 1]).not.toBe(TASK_PROMPT);
  });

  it('缺 spectraPluginDir 抛错（版本门禁产物必传）', () => {
    expect(() => buildClaudeArgs({ tool: COHORT3_TOOL, prompt: TASK_PROMPT })).toThrow(/spectraPluginDir/);
  });

  it('model 可被覆盖（batch 统一控制）', () => {
    const a = buildClaudeArgs({ tool: COHORT3_TOOL, prompt: TASK_PROMPT, spectraPluginDir: '/p', model: 'claude-sonnet-4-6' });
    expect(a[a.indexOf('--model') + 1]).toBe('claude-sonnet-4-6');
  });

  it('cohort3 在 SUPPORTED_TOOLS 中', () => {
    expect(SUPPORTED_TOOLS).toContain(COHORT3_TOOL);
  });
});

describe('T-C1 buildDriverPrompt cohort3 confound 控制', () => {
  it('与 spec-driver 逐字一致（唯一差异=MCP 注册，FR-A-003）', () => {
    const c2 = buildDriverPrompt({ tool: 'spec-driver', taskPrompt: TASK_PROMPT });
    const c3 = buildDriverPrompt({ tool: COHORT3_TOOL, taskPrompt: TASK_PROMPT });
    expect(c3).toBe(c2);
    expect(c3).not.toContain('mcp'); // 不得注入任何 MCP 使用提示
    expect(c3).not.toContain('spectra');
  });
});

describe('T-C3 outputFormat/model 参数化（默认不变）', () => {
  it('默认仍 text + sonnet（F147/F158 向后兼容）', () => {
    const a = buildClaudeArgs({ tool: 'control', prompt: TASK_PROMPT });
    expect(a[a.indexOf('--output-format') + 1]).toBe('text');
    expect(a[a.indexOf('--model') + 1]).toBe('claude-sonnet-4-6');
    expect(a[a.length - 1]).toBe(TASK_PROMPT); // 默认仍位置 prompt
  });

  it('显式 stream-json 时附 verbose+partial 且可 stdin（F176 batch 模式）', () => {
    const a = buildClaudeArgs({ tool: 'control', prompt: TASK_PROMPT, outputFormat: 'stream-json', promptViaStdin: true, model: 'claude-opus-4-7' });
    expect(a[a.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(a).toContain('--verbose');
    expect(a).toContain('--include-partial-messages');
    expect(a[a.indexOf('--model') + 1]).toBe('claude-opus-4-7');
    expect(a).not.toContain(TASK_PROMPT);
  });
});

describe('T-C2 parseMcpToolCallTrace plugin namespace', () => {
  function evt(name: string, id: string) {
    return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name }] } });
  }

  it('计入 mcp__plugin_spectra_spectra__*（cohort3）与 mcp__spectra__*（mcp-pull）', () => {
    const stdout = [
      evt('mcp__plugin_spectra_spectra__context', 'a1'),
      evt('mcp__plugin_spectra_spectra__impact', 'a2'),
      evt('mcp__spectra__context', 'a3'),
      evt('Read', 'a4'),
    ].join('\n');
    const { trace, w3Flag } = parseMcpToolCallTrace(stdout, null);
    const total = trace.reduce((s: number, t: any) => s + t.callCount, 0);
    expect(total).toBe(3); // Read 不计
    expect(w3Flag).toBe(false);
  });

  it('expected 短名 endsWith 对 plugin namespace 同样生效（w3Flag 判定）', () => {
    const stdout = evt('mcp__plugin_spectra_spectra__context', 'b1');
    const { w3Flag } = parseMcpToolCallTrace(stdout, ['context']);
    expect(w3Flag).toBe(false);
  });

  it('0 调用 → w3Flag=true（W-3 trap）', () => {
    const { w3Flag } = parseMcpToolCallTrace(evt('Read', 'c1'), ['context']);
    expect(w3Flag).toBe(true);
  });
});

describe('Verified fixture 装载（host smoke 首跑暴露的接线缺口）', () => {
  it('TASK_FIXTURE_DIRS 含 Verified fixtures 目录（共享路径常量）', () => {
    expect(TASK_FIXTURE_DIRS).toContain(fixturesDir());
  });

  it('loadTaskFixture 能从 Verified 目录装载 SWE-V* fixture（写入唯一名临时 fixture 闭环）', () => {
    const dir = fixturesDir();
    fs.mkdirSync(dir, { recursive: true });
    const id = 'SWE-VTEST-loader-roundtrip';
    const p = path.join(dir, `${id}.json`);
    fs.writeFileSync(p, JSON.stringify({ taskId: id, target: 'sympy/sympy', prompt: 'x' }));
    try {
      expect(loadTaskFixture(id).target).toBe('sympy/sympy');
    } finally {
      fs.rmSync(p, { force: true });
    }
  });

  it('runPrimaryOracle 替换 <SPECTRA_REPO_ROOT> 占位符（Verified oracle 引用 fuzzy-match 脚本）', () => {
    // 占位符指向真实仓库根：test -d 应 PASS；若未替换，bash 会把 < 当重定向而失败
    const r = runPrimaryOracle({
      wtDir: os.tmpdir(),
      oracle: { kind: 'ast-diff', checks: ['test -d "<SPECTRA_REPO_ROOT>/scripts"'] },
    });
    expect(r.passed).toBe(true);
    // unit-test kind 的 command 同样替换
    const u = runPrimaryOracle({
      wtDir: os.tmpdir(),
      oracle: { kind: 'unit-test', command: 'test -f "<SPECTRA_REPO_ROOT>/package.json"', expectedExit: 0 },
    });
    expect(u.passed).toBe(true);
  });
});

describe('T-D1 repeatIndex 隔离', () => {
  it('parseArgs 解析 --repeat-index', () => {
    const a = parseArgs(['--task', 'T1', '--tool', 'control', '--repeat-index', '2']);
    expect(a.repeatIndex).toBe(2);
  });

  it('3 个 repeat 产生 3 个互不相同的独立 worktree（FR-A-006b）', () => {
    // 自包含微型 baseline：tmp home + 一个真实 git 仓作 target 源
    const benchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-bench-'));
    const baselineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-baseline-'));
    const src = path.join(baselineHome, 'fakerepo');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.txt'), 'hello\n');
    execFileSync('git', ['init', '-q'], { cwd: src });
    execFileSync('git', ['add', '-A'], { cwd: src });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: src });
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: src, encoding: 'utf-8' }).trim();

    const prevBench = process.env.SPEC_DRIVER_BENCH_HOME;
    const prevBase = process.env.SPECTRA_BASELINE_HOME;
    process.env.SPEC_DRIVER_BENCH_HOME = benchHome;
    process.env.SPECTRA_BASELINE_HOME = baselineHome;
    try {
      const dirs = [1, 2, 3].map((i) =>
        prepareWorktree({ taskId: 'SWE-VX', tool: COHORT3_TOOL, target: 'x/fakerepo', startCommit: sha, repeatIndex: i }).wtDir,
      );
      expect(new Set(dirs).size).toBe(3);
      for (const [idx, d] of dirs.entries()) {
        expect(d).toContain(`r${idx + 1}`);
        expect(fs.existsSync(path.join(d, 'a.txt'))).toBe(true);
        expect(fs.existsSync(path.join(d, '.git'))).toBe(true);
      }
      // 不传 repeatIndex 走旧路径（向后兼容）
      const legacy = prepareWorktree({ taskId: 'SWE-VX', tool: 'control', target: 'x/fakerepo', startCommit: sha }).wtDir;
      expect(legacy.endsWith(path.join('SWE-VX', 'control'))).toBe(true);
    } finally {
      if (prevBench === undefined) delete process.env.SPEC_DRIVER_BENCH_HOME; else process.env.SPEC_DRIVER_BENCH_HOME = prevBench;
      if (prevBase === undefined) delete process.env.SPECTRA_BASELINE_HOME; else process.env.SPECTRA_BASELINE_HOME = prevBase;
      fs.rmSync(benchHome, { recursive: true, force: true });
      fs.rmSync(baselineHome, { recursive: true, force: true });
    }
  });
});
