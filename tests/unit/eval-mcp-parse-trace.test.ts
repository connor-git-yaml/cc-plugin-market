/**
 * Feature 160 Smoke E — parseMcpToolCallTrace / parseStreamJsonUsage 真实格式 unit tests
 *
 * 现有合成数据单测可能漏掉真实 stream-json 字段（tool_use_id / partial / error path / modelUsage 多 key）。
 * 本测试文件用"接近真实"的 NDJSON 样本验证解析鲁棒性。
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface TraceEntry {
  toolName: string;
  callCount: number;
  firstCallTurn: number;
  totalDurationMs: number | null;
}

interface TraceResult {
  trace: TraceEntry[];
  w3Flag: boolean;
}

interface UsageResult {
  costUsd: number | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  tokensCacheRead: number | null;
}

interface RunnerModule {
  parseMcpToolCallTrace: (stdout: string, expectedCalls?: string[] | null) => TraceResult;
  parseStreamJsonUsage: (stdout: string) => UsageResult;
}

let mod: RunnerModule;
beforeAll(async () => {
  mod = (await import(
    pathToFileURL(resolve('scripts/eval-task-runner.mjs')).href
  )) as RunnerModule;
});

// ─── 真实格式 stream-json 行构造器 ───────────────────────────────────────

function makeAssistantWithToolUse(toolName: string, toolId: string, turn = 1): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: `2025-01-01T00:00:${String(turn).padStart(2, '0')}.000Z`,
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: toolId,
          name: toolName,
          input: { target: 'micrograd/engine.py::Value.__add__', depth: 2 },
        },
      ],
    },
  });
}

function makeUserWithToolResult(toolId: string, resultText: string, ts: string): string {
  return JSON.stringify({
    type: 'user',
    timestamp: ts,
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolId,
          content: [{ type: 'text', text: resultText }],
        },
      ],
    },
  });
}

function makeResultEvent(modelKey: string, costUSD: number, inputTokens: number, outputTokens: number): string {
  return JSON.stringify({
    type: 'result',
    modelUsage: {
      [modelKey]: {
        costUSD,
        inputTokens,
        outputTokens,
        cacheReadInputTokens: 0,
      },
    },
  });
}

// ─── parseMcpToolCallTrace ──────────────────────────────────────────────────

describe('Smoke E — parseMcpToolCallTrace', () => {
  it('1. 空字符串 → trace=[], w3Flag=true', () => {
    const r = mod.parseMcpToolCallTrace('');
    expect(r.trace).toEqual([]);
    expect(r.w3Flag).toBe(true);
  });

  it('2. 无 mcp__spectra__ tool_use 的 stream-json → trace=[], w3Flag=true', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({ type: 'result', costUSD: 0.01 }),
    ].join('\n');
    const r = mod.parseMcpToolCallTrace(lines);
    expect(r.trace).toEqual([]);
    expect(r.w3Flag).toBe(true);
  });

  it('3. 单次 impact 调用（真实格式含 id/timestamp）→ 1 entry, callCount=1', () => {
    const stdout = makeAssistantWithToolUse('mcp__spectra__impact', 'tool-id-abc', 1);
    const r = mod.parseMcpToolCallTrace(stdout);
    expect(r.trace).toHaveLength(1);
    expect(r.trace[0]!.toolName).toBe('mcp__spectra__impact');
    expect(r.trace[0]!.callCount).toBe(1);
    expect(r.trace[0]!.firstCallTurn).toBe(1);
    expect(r.w3Flag).toBe(false);
  });

  it('4. 同一工具多次调用 → callCount 正确累加', () => {
    const lines = [
      makeAssistantWithToolUse('mcp__spectra__impact', 'id-1', 1),
      makeAssistantWithToolUse('mcp__spectra__impact', 'id-2', 2),
      makeAssistantWithToolUse('mcp__spectra__impact', 'id-3', 3),
    ].join('\n');
    const r = mod.parseMcpToolCallTrace(lines);
    expect(r.trace).toHaveLength(1);
    expect(r.trace[0]!.toolName).toBe('mcp__spectra__impact');
    expect(r.trace[0]!.callCount).toBe(3);
    expect(r.trace[0]!.firstCallTurn).toBe(1);
  });

  it('5. 多工具混合调用 → 各 toolName 独立 entry', () => {
    const lines = [
      makeAssistantWithToolUse('mcp__spectra__impact', 'id-a', 1),
      makeAssistantWithToolUse('mcp__spectra__context', 'id-b', 2),
      makeAssistantWithToolUse('mcp__spectra__detect_changes', 'id-c', 3),
    ].join('\n');
    const r = mod.parseMcpToolCallTrace(lines);
    expect(r.trace).toHaveLength(3);
    const names = r.trace.map((t) => t.toolName);
    expect(names).toContain('mcp__spectra__impact');
    expect(names).toContain('mcp__spectra__context');
    expect(names).toContain('mcp__spectra__detect_changes');
    expect(r.w3Flag).toBe(false);
  });

  it('6. tool_use + tool_result 配对（含 tool_use_id）→ totalDurationMs 非 null', () => {
    const toolId = 'tool-dur-test';
    const t1 = '2025-01-01T00:00:01.000Z';
    const t2 = '2025-01-01T00:00:03.500Z'; // 2500ms later
    const line1 = JSON.stringify({
      type: 'assistant',
      timestamp: t1,
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: toolId, name: 'mcp__spectra__impact', input: {} }],
      },
    });
    const line2 = makeUserWithToolResult(toolId, '{"affected":[]}', t2);
    const r = mod.parseMcpToolCallTrace([line1, line2].join('\n'));
    expect(r.trace).toHaveLength(1);
    // t2-t1 = 2500ms（时间戳精确差值，INFO-4 修复：用 toBe 而非宽泛 <=3000）
    expect(r.trace[0]!.totalDurationMs).toBe(2500);
  });

  it('7. expectedSpectraToolCalls=[] + 有调用 → w3Flag=false（无 expectation 不算 trap）', () => {
    const stdout = makeAssistantWithToolUse('mcp__spectra__impact', 'id-x', 1);
    const r = mod.parseMcpToolCallTrace(stdout, []);
    expect(r.w3Flag).toBe(false);
  });

  it('8. expectedSpectraToolCalls=["context"] 但只调了 impact → w3Flag=true', () => {
    const stdout = makeAssistantWithToolUse('mcp__spectra__impact', 'id-y', 1);
    const r = mod.parseMcpToolCallTrace(stdout, ['context']);
    expect(r.w3Flag).toBe(true);
  });
});

// ─── parseStreamJsonUsage ──────────────────────────────────────────────────

describe('Smoke E — parseStreamJsonUsage', () => {
  it('9. 空字符串 → 全字段 null', () => {
    const r = mod.parseStreamJsonUsage('');
    expect(r.costUsd).toBeNull();
    expect(r.tokensInput).toBeNull();
    expect(r.tokensOutput).toBeNull();
    expect(r.tokensCacheRead).toBeNull();
  });

  it('10. 末尾含 {"type":"result","modelUsage":{...}} → 正确提取', () => {
    const stdout = [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [] } }),
      makeResultEvent('claude-sonnet-4-6', 0.05, 1000, 200),
    ].join('\n');
    const r = mod.parseStreamJsonUsage(stdout);
    expect(r.costUsd).toBeCloseTo(0.05);
    expect(r.tokensInput).toBe(1000);
    expect(r.tokensOutput).toBe(200);
  });

  it('11. modelUsage 多 model key → 正确累加', () => {
    const line = JSON.stringify({
      type: 'result',
      modelUsage: {
        'claude-sonnet-4-6': { costUSD: 0.03, inputTokens: 500, outputTokens: 100, cacheReadInputTokens: 50 },
        'claude-haiku-4-5': { costUSD: 0.01, inputTokens: 200, outputTokens: 50, cacheReadInputTokens: 0 },
      },
    });
    const r = mod.parseStreamJsonUsage(line);
    expect(r.costUsd).toBeCloseTo(0.04);
    expect(r.tokensInput).toBe(700);
    expect(r.tokensOutput).toBe(150);
    expect(r.tokensCacheRead).toBe(50);
  });

  it('12. costUSD=0 (所有 model 全 0) → costUsd=null', () => {
    const line = makeResultEvent('claude-sonnet-4-6', 0, 0, 0);
    const r = mod.parseStreamJsonUsage(line);
    expect(r.costUsd).toBeNull();
    expect(r.tokensInput).toBeNull();
    expect(r.tokensOutput).toBeNull();
  });
});
