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
let parseTelemetryJsonl: (telemetryPath: string) => { mcpToolCalls: Array<{ tool: string | null; success: boolean; error: string | null; responseBytes: number; timestamp: string | null }> };

describe('buildGroupCPrompt (Feature 164 fix)', () => {
  beforeAll(async () => {
    const mod = await import(pathToFileURL(resolve('scripts/eval-mcp-augmented.mjs')).href);
    buildGroupCPrompt = mod.buildGroupCPrompt;
    parseTelemetryJsonl = mod.parseTelemetryJsonl;
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
});
