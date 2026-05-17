/**
 * Feature 164 — buildGroupCPrompt + parseTelemetryJsonl 测试
 *
 * buildGroupCPrompt 验证：
 * 1. mcp__spectra__detect_changes 作为首个强制工具
 * 2. baseRef: "HEAD~1" 参数提示
 * 3. graph-not-built 错误处理指导
 * 4. 三步骤序列结构
 *
 * parseTelemetryJsonl 验证（W-3 修复）：
 * 5. 读取 errorCode 字段（TelemetryEntry 写 errorCode，不写 error）
 * 6. errorCode 存在时 success=false
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

let buildGroupCPrompt: (fixture: { prompt: string }) => string;
type ParsedMcpCall = {
  tool: string | null;
  success: boolean;
  error: string | null;
  responseBytes: number;
  timestamp: string | null;
  responseSummary: Record<string, number> | null;
};
let parseTelemetryJsonl: (telemetryPath: string) => { mcpToolCalls: ParsedMcpCall[] };
let buildClaudeArgsWithMcp: (opts: { prompt: string; mcpConfigPath?: string | null }) => string[];

describe('buildGroupCPrompt (Feature 164 fix)', () => {
  beforeAll(async () => {
    const mod = await import(pathToFileURL(resolve('scripts/eval-mcp-augmented.mjs')).href);
    buildGroupCPrompt = mod.buildGroupCPrompt;
    parseTelemetryJsonl = mod.parseTelemetryJsonl;
    buildClaudeArgsWithMcp = mod.buildClaudeArgsWithMcp;
  });

  const mockFixture = { prompt: '## Test task\n\nFix a bug.' };

  it('应以 detect_changes 作为步骤 1 工具（而非 context）', () => {
    const prompt = buildGroupCPrompt(mockFixture);
    expect(prompt).toContain('mcp__spectra__detect_changes');
    // 步骤 1 必须在 context 之前
    const detectIdx = prompt.indexOf('mcp__spectra__detect_changes');
    const contextIdx = prompt.indexOf('mcp__spectra__context');
    expect(detectIdx).toBeGreaterThanOrEqual(0);
    expect(contextIdx).toBeGreaterThanOrEqual(0);
    expect(detectIdx).toBeLessThan(contextIdx);
  });

  it('应包含 HEAD~1 baseRef 参数提示', () => {
    const prompt = buildGroupCPrompt(mockFixture);
    expect(prompt).toContain('HEAD~1');
  });

  it('应包含 graph-not-built 错误处理指导', () => {
    const prompt = buildGroupCPrompt(mockFixture);
    expect(prompt).toContain('graph-not-built');
  });

  it('应包含"不可跳过"或"必须"类强制调用指令', () => {
    const prompt = buildGroupCPrompt(mockFixture);
    const hasForce = prompt.includes('不可跳过') || prompt.includes('必须');
    expect(hasForce).toBe(true);
  });

  it('应包含 taskFixture.prompt 内容', () => {
    const prompt = buildGroupCPrompt(mockFixture);
    expect(prompt).toContain('## Test task');
    expect(prompt).toContain('Fix a bug.');
  });

  it('应包含三个步骤结构', () => {
    const prompt = buildGroupCPrompt(mockFixture);
    expect(prompt).toContain('步骤 1');
    expect(prompt).toContain('步骤 2');
    expect(prompt).toContain('步骤 3');
  });

  it('步骤 1 应包含 changedSymbols 为空时跳到步骤 3 的处理', () => {
    const prompt = buildGroupCPrompt(mockFixture);
    // W1 修复：空 changedSymbols 也应明确跳步骤 3，避免 Claude 尝试索引空数组
    expect(prompt).toMatch(/changedSymbols.*空|空.*changedSymbols/);
  });
});

describe('parseTelemetryJsonl (Feature 164 W-3 fix)', () => {
  // 由于 beforeAll 中模块已被缓存，parseTelemetryJsonl 在 buildGroupCPrompt suite 后即可用
  // 但为保证独立性，此 describe 内再次读取

  it('应正确读取 errorCode 字段并将 success 设为 false', () => {
    const tmpFile = path.join(os.tmpdir(), `telemetry-test-${Date.now()}.jsonl`);
    // 模拟 TelemetryEntry：errorCode 存在，无 error 字段
    const entry = {
      ts: '2026-05-15T00:00:00.000Z',
      toolName: 'detect_changes',
      requestSize: 10,
      responseSize: 0,
      durationMs: 5,
      runId: 'test-run-1',
      errorCode: 'graph-not-built',
    };
    fs.writeFileSync(tmpFile, JSON.stringify(entry) + '\n', 'utf-8');
    try {
      const result = parseTelemetryJsonl(tmpFile);
      expect(result.mcpToolCalls).toHaveLength(1);
      const call = result.mcpToolCalls[0];
      expect(call.tool).toBe('mcp__spectra__detect_changes');
      expect(call.success).toBe(false);
      expect(call.error).toBe('graph-not-built');
      expect(call.responseBytes).toBe(0);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('应将无 errorCode 的条目解析为 success=true', () => {
    const tmpFile = path.join(os.tmpdir(), `telemetry-test-${Date.now()}.jsonl`);
    const entry = {
      ts: '2026-05-15T00:00:00.000Z',
      toolName: 'detect_changes',
      requestSize: 10,
      responseSize: 256,
      durationMs: 42,
      runId: 'test-run-2',
    };
    fs.writeFileSync(tmpFile, JSON.stringify(entry) + '\n', 'utf-8');
    try {
      const result = parseTelemetryJsonl(tmpFile);
      expect(result.mcpToolCalls).toHaveLength(1);
      const call = result.mcpToolCalls[0];
      expect(call.success).toBe(true);
      expect(call.error).toBeNull();
      expect(call.responseBytes).toBe(256);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  // Feature 165 FR-012 round 2 — responseSummary 解析（detect_changes changedSymbolsCount）
  it('应解析 responseSummary 字段（detect_changes changedSymbolsCount）', () => {
    const tmpFile = path.join(os.tmpdir(), `telemetry-test-${Date.now()}.jsonl`);
    const entry = {
      ts: '2026-05-16T00:00:00.000Z',
      toolName: 'detect_changes',
      requestSize: 10,
      responseSize: 1024,
      durationMs: 80,
      runId: 'test-run-3',
      responseSummary: { changedSymbolsCount: 5 },
    };
    fs.writeFileSync(tmpFile, JSON.stringify(entry) + '\n', 'utf-8');
    try {
      const result = parseTelemetryJsonl(tmpFile);
      expect(result.mcpToolCalls).toHaveLength(1);
      const call = result.mcpToolCalls[0];
      expect(call.responseSummary).not.toBeNull();
      expect(call.responseSummary?.['changedSymbolsCount']).toBe(5);
      expect(call.success).toBe(true);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('无 responseSummary 字段时 → responseSummary=null', () => {
    const tmpFile = path.join(os.tmpdir(), `telemetry-test-${Date.now()}.jsonl`);
    const entry = {
      ts: '2026-05-16T00:00:00.000Z',
      toolName: 'detect_changes',
      requestSize: 10,
      responseSize: 256,
      durationMs: 42,
      runId: 'test-run-4',
    };
    fs.writeFileSync(tmpFile, JSON.stringify(entry) + '\n', 'utf-8');
    try {
      const result = parseTelemetryJsonl(tmpFile);
      expect(result.mcpToolCalls[0].responseSummary).toBeNull();
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  // Codex round 2 类型安全：responseSummary 为 array / 非数字 / 嵌套对象时被拒绝
  it('responseSummary 为数组时 → 拒绝（null）', () => {
    const tmpFile = path.join(os.tmpdir(), `telemetry-test-${Date.now()}.jsonl`);
    const entry = {
      ts: '2026-05-16T00:00:00.000Z',
      toolName: 'detect_changes',
      responseSize: 10,
      runId: 'r5',
      responseSummary: [1, 2, 3] as unknown as Record<string, number>,
    };
    fs.writeFileSync(tmpFile, JSON.stringify(entry) + '\n', 'utf-8');
    try {
      const result = parseTelemetryJsonl(tmpFile);
      expect(result.mcpToolCalls[0].responseSummary).toBeNull();
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('responseSummary 含非数字值时 → 过滤掉非数字键', () => {
    const tmpFile = path.join(os.tmpdir(), `telemetry-test-${Date.now()}.jsonl`);
    const entry = {
      ts: '2026-05-16T00:00:00.000Z',
      toolName: 'detect_changes',
      responseSize: 10,
      runId: 'r6',
      responseSummary: { changedSymbolsCount: 3, weird: 'string', nested: { x: 1 } } as unknown as Record<string, number>,
    };
    fs.writeFileSync(tmpFile, JSON.stringify(entry) + '\n', 'utf-8');
    try {
      const result = parseTelemetryJsonl(tmpFile);
      const summary = result.mcpToolCalls[0].responseSummary;
      expect(summary).not.toBeNull();
      expect(summary?.['changedSymbolsCount']).toBe(3);
      expect(summary?.['weird']).toBeUndefined();
      expect(summary?.['nested']).toBeUndefined();
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  // Feature 165 round 3 GATE_VERIFY CRITICAL — responseSamples 解析
  it('应解析 responseSamples.{symbols, files}（detect_changes bounded sample）', () => {
    const tmpFile = path.join(os.tmpdir(), `telemetry-test-${Date.now()}.jsonl`);
    const entry = {
      ts: '2026-05-17T00:00:00.000Z',
      toolName: 'detect_changes',
      responseSize: 100,
      runId: 'r7',
      responseSummary: { changedSymbolsCount: 3 },
      responseSamples: { symbols: ['Foo', 'bar'], files: ['src/a.py'] },
    };
    fs.writeFileSync(tmpFile, JSON.stringify(entry) + '\n', 'utf-8');
    try {
      const result = parseTelemetryJsonl(tmpFile);
      const samples = (result.mcpToolCalls[0] as unknown as { responseSamples: { symbols: string[]; files: string[] } }).responseSamples;
      expect(samples).not.toBeNull();
      expect(samples.symbols).toEqual(['Foo', 'bar']);
      expect(samples.files).toEqual(['src/a.py']);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('responseSamples 非数组 / 含非字符串值 → 过滤', () => {
    const tmpFile = path.join(os.tmpdir(), `telemetry-test-${Date.now()}.jsonl`);
    const entry = {
      ts: '2026-05-17T00:00:00.000Z',
      toolName: 'detect_changes',
      responseSize: 50,
      runId: 'r8',
      responseSummary: { changedSymbolsCount: 1 },
      responseSamples: { symbols: ['valid', 123, null], files: 'not-array' } as unknown as Record<string, unknown>,
    };
    fs.writeFileSync(tmpFile, JSON.stringify(entry) + '\n', 'utf-8');
    try {
      const result = parseTelemetryJsonl(tmpFile);
      const samples = (result.mcpToolCalls[0] as unknown as { responseSamples: { symbols?: string[]; files?: string[] } }).responseSamples;
      expect(samples).not.toBeNull();
      expect(samples?.symbols).toEqual(['valid']);
      expect(samples?.files).toBeUndefined();
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe('buildClaudeArgsWithMcp (Feature 166 FR-004 / FR-007 / FR-018)', () => {
  it('FR-004: args 包含 claude-opus-4-7 模型字符串（无 sonnet-4-6 残留）', () => {
    const args = buildClaudeArgsWithMcp({ prompt: 'test prompt' });
    const modelIdx = args.indexOf('--model');
    expect(modelIdx).toBeGreaterThanOrEqual(0);
    expect(args[modelIdx + 1]).toBe('claude-opus-4-7');
    expect(args.join(' ')).not.toContain('claude-sonnet-4-6');
  });

  it('FR-007: args 包含 --output-format stream-json（无 text 残留）', () => {
    const args = buildClaudeArgsWithMcp({ prompt: 'test prompt' });
    const fmtIdx = args.indexOf('--output-format');
    expect(fmtIdx).toBeGreaterThanOrEqual(0);
    expect(args[fmtIdx + 1]).toBe('stream-json');
    // 'text' 不应作为 --output-format 的值出现
    // (仅检查紧跟 --output-format 的下一个元素)
    expect(args.filter((a, i) => args[i - 1] === '--output-format' && a === 'text')).toHaveLength(0);
  });

  it('FR-018: args 包含 --verbose（stream-json 完整 dump tool_use 必需，沿用 eval-task-runner 决策）', () => {
    const args = buildClaudeArgsWithMcp({ prompt: 'test prompt' });
    expect(args).toContain('--verbose');
  });

  it('args 保留 --print / --permission-mode / --dangerously-skip-permissions', () => {
    const args = buildClaudeArgsWithMcp({ prompt: 'test prompt' });
    expect(args).toContain('--print');
    expect(args).toContain('--permission-mode');
    expect(args).toContain('bypassPermissions');
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('args 最后一项始终是 prompt（参数顺序契约）', () => {
    const args = buildClaudeArgsWithMcp({ prompt: 'final prompt content' });
    expect(args[args.length - 1]).toBe('final prompt content');
  });

  it('不传 mcpConfigPath 时不出现 --mcp-config / --strict-mcp-config', () => {
    const args = buildClaudeArgsWithMcp({ prompt: 'test' });
    expect(args).not.toContain('--mcp-config');
    expect(args).not.toContain('--strict-mcp-config');
  });

  it('传 mcpConfigPath 时附加 --mcp-config 和 --strict-mcp-config', () => {
    const args = buildClaudeArgsWithMcp({ prompt: 'test', mcpConfigPath: '/tmp/mcp.json' });
    const mcpIdx = args.indexOf('--mcp-config');
    expect(mcpIdx).toBeGreaterThanOrEqual(0);
    expect(args[mcpIdx + 1]).toBe('/tmp/mcp.json');
    expect(args).toContain('--strict-mcp-config');
    // 顺序：--mcp-config / 路径 / --strict-mcp-config / prompt
    expect(args[args.length - 1]).toBe('test');
  });

  it('dry-run 风格断言：args 整体结构稳定（snapshot 替代）', () => {
    // Codex W-004 修复：补 dry-run snapshot 类断言，捕获将来误改 args 顺序的回归
    const args = buildClaudeArgsWithMcp({ prompt: 'dryRun-test' });
    // 关键 args 必须存在且顺序符合预期
    expect(args.slice(0, 7)).toEqual([
      '--print',
      '--model',
      'claude-opus-4-7',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
    ]);
  });
});
