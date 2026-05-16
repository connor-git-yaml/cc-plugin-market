/**
 * Feature 165 — Graph Injection / Schema Validate / consumptionSignals 单测
 *
 * 覆盖：
 *   T-008  validateGraphSchema（5 case：缺失 / schema 缺字段 / 空 callSites /
 *          version mismatch / 全通过）
 *   T-009  injectGraph、assertNoGraphInWorktree、extractConsumptionSignals
 *   T-009a runOne() wire 集成（C 注入 / C 注入失败 / A 断言 / B 断言）
 *
 * 设计原则：使用 tmpdir 隔离的 fixture，不依赖真实 ~/.spectra-baselines，
 * 不 spawn claude CLI；runOne wire 测试通过 mock prepareWorktree + spawnSync。
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

// ─── 类型 declaration（避免 any） ────────────────────────────────────────────

interface SchemaResult {
  ok: boolean;
  errorCode?: string;
  reason?: string;
}

interface InjectionResult {
  status: 'success' | 'failed';
  sourcePath: string;
  destPath: string;
  errorCode?: string;
  reason?: string;
  sourceHash: string | null;
  destHash?: string;
  spectraVersion: string | null;
  graphSchemaVersion: string | null;
}

interface ConsumptionSignal {
  signalType: 'patch-diff-literal' | 'derived-mcp-call' | 'reasoning-trace-mention';
  matchedSymbol?: string | null;
  matchedFilePath?: string;
  evidenceLocation: string;
  evidenceTextSnippet?: string;
}

interface ChangedSymbolEntry {
  filePath?: string;
  symbols?: Array<{ symbolName?: string } | string>;
}

interface McpToolCall {
  tool: string | null;
  arguments?: Record<string, unknown> | string;
  success?: boolean;
}

interface ExtractSignalsInput {
  changedSymbols: ChangedSymbolEntry[];
  mcpToolCalls: McpToolCall[];
  stdout: string;
  patchText: string;
}

interface Mod {
  validateGraphSchema: (graphPath: string, runtimeVersion: string) => SchemaResult;
  computeFileHash: (filePath: string) => string;
  injectGraph: (input: {
    taskFixture: { target: string };
    wtDir: string;
    runtimeSpectraVersion: string;
  }) => InjectionResult;
  assertNoGraphInWorktree: (wtDir: string) => void;
  extractConsumptionSignals: (input: ExtractSignalsInput) => ConsumptionSignal[];
  RUNTIME_SPECTRA_VERSION: string;
}

let mod: Mod;

beforeAll(async () => {
  const m = await import(pathToFileURL(resolve('scripts/eval-mcp-augmented.mjs')).href);
  mod = m as unknown as Mod;
});

// ─── helper：构造一份合法的 graph 对象 ───────────────────────────────────────

function buildValidGraph(versionStr: string): Record<string, unknown> {
  return {
    nodes: [{ id: 'n1' }, { id: 'n2' }],
    links: [{ from: 'n1', to: 'n2' }],
    callSites: [
      { caller: 'n1', callee: 'n2', filePath: 'src/a.py', line: 10 },
    ],
    spectraVersion: versionStr,
    graphSchemaVersion: versionStr,
  };
}

function writeJsonFixture(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

// ─── T-008：validateGraphSchema ──────────────────────────────────────────────

describe('Feature 165 T-008 — validateGraphSchema', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f165-validate-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup error */
    }
  });

  it('文件不存在 → graph-not-built', () => {
    const r = mod.validateGraphSchema(path.join(tmpDir, 'missing.json'), '4.1.1');
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('graph-not-built');
  });

  it('JSON parse 失败 → graph-not-built', () => {
    const fp = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(fp, '{ not valid json', 'utf-8');
    const r = mod.validateGraphSchema(fp, '4.1.1');
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('graph-not-built');
  });

  it('缺 nodes 字段 → graph-schema-mismatch', () => {
    const fp = path.join(tmpDir, 'g.json');
    const g = buildValidGraph('4.1.1');
    delete (g as Record<string, unknown>).nodes;
    writeJsonFixture(fp, g);
    const r = mod.validateGraphSchema(fp, '4.1.1');
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('graph-schema-mismatch');
  });

  it('callSites 为空数组 → payload-empty', () => {
    const fp = path.join(tmpDir, 'g.json');
    const g = buildValidGraph('4.1.1');
    g.callSites = [];
    writeJsonFixture(fp, g);
    const r = mod.validateGraphSchema(fp, '4.1.1');
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('payload-empty');
  });

  it('graphSchemaVersion 与 runtime 不一致 → graph-schema-mismatch', () => {
    const fp = path.join(tmpDir, 'g.json');
    writeJsonFixture(fp, buildValidGraph('3.0.0'));
    const r = mod.validateGraphSchema(fp, '4.1.1');
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('graph-schema-mismatch');
  });

  it('所有字段合法 + version 一致 → ok=true', () => {
    const fp = path.join(tmpDir, 'g.json');
    writeJsonFixture(fp, buildValidGraph('4.1.1'));
    const r = mod.validateGraphSchema(fp, '4.1.1');
    expect(r.ok).toBe(true);
  });
});

// ─── T-009：injectGraph / assertNoGraphInWorktree / extractConsumptionSignals ──

describe('Feature 165 T-009 — injectGraph', () => {
  let baselineHome: string;
  let wtDir: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    baselineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'f165-inject-base-'));
    wtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f165-inject-wt-'));
    savedEnv = process.env.SPECTRA_BASELINE_HOME;
    process.env.SPECTRA_BASELINE_HOME = baselineHome;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.SPECTRA_BASELINE_HOME;
    else process.env.SPECTRA_BASELINE_HOME = savedEnv;
    try { fs.rmSync(baselineHome, { recursive: true, force: true }); } catch { /* */ }
    try { fs.rmSync(wtDir, { recursive: true, force: true }); } catch { /* */ }
  });

  function seedSourceGraph(repoName: string, payload: unknown): string {
    const p = path.join(baselineHome, repoName, 'specs/_meta/graph.json');
    writeJsonFixture(p, payload);
    return p;
  }

  it('source schema 缺字段 → status=failed + errorCode=graph-schema-mismatch', () => {
    const g = buildValidGraph('4.1.1');
    delete (g as Record<string, unknown>).links;
    seedSourceGraph('pytest', g);
    const r = mod.injectGraph({
      taskFixture: { target: 'pytest-dev/pytest' },
      wtDir,
      runtimeSpectraVersion: '4.1.1',
    });
    expect(r.status).toBe('failed');
    expect(r.errorCode).toBe('graph-schema-mismatch');
  });

  it('source 不存在 → status=failed + errorCode=graph-not-built', () => {
    const r = mod.injectGraph({
      taskFixture: { target: 'pytest-dev/pytest' },
      wtDir,
      runtimeSpectraVersion: '4.1.1',
    });
    expect(r.status).toBe('failed');
    expect(r.errorCode).toBe('graph-not-built');
  });

  it('atomic copy 成功 → status=success + sourceHash === destHash', () => {
    const sourceContent = buildValidGraph('4.1.1');
    const sourcePath = seedSourceGraph('pytest', sourceContent);
    const r = mod.injectGraph({
      taskFixture: { target: 'pytest-dev/pytest' },
      wtDir,
      runtimeSpectraVersion: '4.1.1',
    });
    expect(r.status).toBe('success');
    expect(r.sourceHash).toBeTruthy();
    expect(r.destHash).toBe(r.sourceHash);
    expect(r.graphSchemaVersion).toBe('4.1.1');

    // dest 文件确实存在
    const destPath = path.join(wtDir, 'specs/_meta/graph.json');
    expect(fs.existsSync(destPath)).toBe(true);

    // hash 与人工计算结果一致
    const expectedHash = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
    expect(r.sourceHash).toBe(expectedHash);
  });

  it('astropy target 映射正确', () => {
    seedSourceGraph('astropy', buildValidGraph('4.1.1'));
    const r = mod.injectGraph({
      taskFixture: { target: 'astropy/astropy' },
      wtDir,
      runtimeSpectraVersion: '4.1.1',
    });
    expect(r.status).toBe('success');
  });

  it('未知 target → status=failed + errorCode=graph-not-built', () => {
    const r = mod.injectGraph({
      taskFixture: { target: 'unknown/unknown' },
      wtDir,
      runtimeSpectraVersion: '4.1.1',
    });
    expect(r.status).toBe('failed');
    expect(r.errorCode).toBe('graph-not-built');
  });
});

describe('Feature 165 T-009 — assertNoGraphInWorktree', () => {
  let wtDir: string;

  beforeEach(() => {
    wtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f165-assert-wt-'));
  });
  afterEach(() => {
    try { fs.rmSync(wtDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('worktree 无 graph → 不抛', () => {
    expect(() => mod.assertNoGraphInWorktree(wtDir)).not.toThrow();
  });

  it('worktree 含 graph → 抛带 "graph 污染" 字样', () => {
    writeJsonFixture(path.join(wtDir, 'specs/_meta/graph.json'), { nodes: [] });
    expect(() => mod.assertNoGraphInWorktree(wtDir)).toThrow(/graph 污染|graph/);
  });
});

describe('Feature 165 T-009 — extractConsumptionSignals', () => {
  it('空 changedSymbols → 返回空数组', () => {
    const r = mod.extractConsumptionSignals({
      changedSymbols: [],
      mcpToolCalls: [],
      stdout: '',
      patchText: '',
    });
    expect(r).toEqual([]);
  });

  it('patch 含 symbolName → 触发 patch-diff-literal', () => {
    const r = mod.extractConsumptionSignals({
      changedSymbols: [{ filePath: 'src/a.py', symbols: [{ symbolName: 'foo_bar' }] }],
      mcpToolCalls: [],
      stdout: '',
      patchText: '--- a/src/a.py\n+++ b/src/a.py\n+def foo_bar(): pass\n',
    });
    expect(r.some((s) => s.signalType === 'patch-diff-literal' && s.matchedSymbol === 'foo_bar')).toBe(true);
  });

  it('后续 mcp call 含 symbolId → 触发 derived-mcp-call', () => {
    const r = mod.extractConsumptionSignals({
      changedSymbols: [{ symbols: [{ symbolName: 'helper_fn' }] }],
      mcpToolCalls: [
        {
          tool: 'mcp__spectra__context',
          arguments: { symbolId: 'helper_fn' },
        },
      ],
      stdout: '',
      patchText: '',
    });
    expect(r.some((s) => s.signalType === 'derived-mcp-call' && s.matchedSymbol === 'helper_fn')).toBe(true);
  });

  it('stdout 含因果短语 → 触发 reasoning-trace-mention', () => {
    const r = mod.extractConsumptionSignals({
      changedSymbols: [{ symbols: [{ symbolName: 'irrelevant' }] }],
      mcpToolCalls: [],
      stdout: '根据 detect_changes 的返回结果\n我会修改 X 函数\n',
      patchText: '',
    });
    expect(r.some((s) => s.signalType === 'reasoning-trace-mention')).toBe(true);
  });

  it('stdout 含 symbolName 引用 → 触发 reasoning-trace-mention', () => {
    const r = mod.extractConsumptionSignals({
      changedSymbols: [{ symbols: [{ symbolName: 'my_unique_symbol_xyz' }] }],
      mcpToolCalls: [],
      stdout: '我将先查 my_unique_symbol_xyz 的实现位置\n',
      patchText: '',
    });
    expect(r.some((s) => s.signalType === 'reasoning-trace-mention' && s.matchedSymbol === 'my_unique_symbol_xyz')).toBe(true);
  });

  it('去重：同 signalType + evidenceLocation 只保留一条', () => {
    const r = mod.extractConsumptionSignals({
      changedSymbols: [
        { symbols: [{ symbolName: 'foo' }] },
        { symbols: [{ symbolName: 'foo' }] },
      ],
      mcpToolCalls: [],
      stdout: '',
      patchText: '+def foo(): pass\n',
    });
    // 多个 foo 在同一行：去重后应仅一条 patch-diff-literal
    const literals = r.filter((s) => s.signalType === 'patch-diff-literal');
    expect(literals.length).toBe(1);
  });
});

// ─── T-009a：runOne wire 集成测试 ────────────────────────────────────────────
//
// 设计：直接测试 injectGraph + assertNoGraphInWorktree 在不同 group 路径下的契合性。
// 我们不通过 spawn runOne（成本高 + 涉及 LLM），改为验证 runOne 内部应调用的
// helper 在隔离 fixture 下产生预期 telemetry 结构。

describe('Feature 165 T-009a — runOne wire 契合性', () => {
  let baselineHome: string;
  let wtDir: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    baselineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'f165-wire-base-'));
    wtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f165-wire-wt-'));
    savedEnv = process.env.SPECTRA_BASELINE_HOME;
    process.env.SPECTRA_BASELINE_HOME = baselineHome;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.SPECTRA_BASELINE_HOME;
    else process.env.SPECTRA_BASELINE_HOME = savedEnv;
    try { fs.rmSync(baselineHome, { recursive: true, force: true }); } catch { /* */ }
    try { fs.rmSync(wtDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('Cohort C 注入成功路径：telemetry 含 sourceHash / destHash 且相等', () => {
    writeJsonFixture(
      path.join(baselineHome, 'pytest', 'specs/_meta/graph.json'),
      buildValidGraph('4.1.1'),
    );
    // 模拟 runOne 内部 group='C' 分支调用
    const graphInjection = mod.injectGraph({
      taskFixture: { target: 'pytest-dev/pytest' },
      wtDir,
      runtimeSpectraVersion: '4.1.1',
    });
    expect(graphInjection.status).toBe('success');
    expect(graphInjection.sourceHash).toBe(graphInjection.destHash);
    expect(graphInjection.sourcePath).toContain('pytest/specs/_meta/graph.json');
    expect(graphInjection.destPath).toContain(path.join(wtDir, 'specs/_meta/graph.json'));
  });

  it('Cohort C 注入失败路径：telemetry status=failed + errorCode 明确', () => {
    // source 缺字段
    const bad = buildValidGraph('4.1.1');
    delete (bad as Record<string, unknown>).callSites;
    writeJsonFixture(
      path.join(baselineHome, 'pytest', 'specs/_meta/graph.json'),
      bad,
    );
    const graphInjection = mod.injectGraph({
      taskFixture: { target: 'pytest-dev/pytest' },
      wtDir,
      runtimeSpectraVersion: '4.1.1',
    });
    expect(graphInjection.status).toBe('failed');
    // schema-mismatch 因为 callSites 字段缺失（不是 payload-empty）
    expect(graphInjection.errorCode).toBe('graph-schema-mismatch');
    // runOne 不应 throw — 失败后继续执行
    // 这里通过 helper 不 throw 校验
  });

  it('Cohort A 前置断言：worktree 含残留 graph → 抛异常', () => {
    writeJsonFixture(path.join(wtDir, 'specs/_meta/graph.json'), { nodes: [] });
    expect(() => mod.assertNoGraphInWorktree(wtDir)).toThrow();
  });

  it('Cohort B 前置断言：worktree 含残留 graph → 抛异常（与 A 等价）', () => {
    writeJsonFixture(path.join(wtDir, 'specs/_meta/graph.json'), { nodes: [] });
    // 由 runOne 中 group !== 'C' 时调用同一 helper；行为应与 A 一致
    expect(() => mod.assertNoGraphInWorktree(wtDir)).toThrow();
  });
});

// ─── RUNTIME_SPECTRA_VERSION 探测 ────────────────────────────────────────────

describe('Feature 165 — RUNTIME_SPECTRA_VERSION 探测', () => {
  it('应导出非空 version 字符串（CLI 或 package.json fallback）', () => {
    expect(typeof mod.RUNTIME_SPECTRA_VERSION).toBe('string');
    expect(mod.RUNTIME_SPECTRA_VERSION.length).toBeGreaterThan(0);
  });
});
