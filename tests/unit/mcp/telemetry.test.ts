/**
 * Feature 158 T-012 — MCP telemetry hook 4 状态矩阵单测
 *
 * 覆盖：
 *   - 状态 1：env 未设置 → writeTelemetry 无副作用
 *   - 状态 2：env 设置 + 写成功 → JSONL 含正确 entry
 *   - 状态 3：env 设置 + 写失败（路径不可写）→ 静默吞，不抛
 *   - 状态 4：error path（buildErrorResponse 早 return）→ 也记录 telemetry 含 errorCode
 *
 * 验证 Feature 155 input/output schema 不破坏（FR-G 合同保护）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GraphJSON } from '../../../src/panoramic/graph/graph-types.js';

// ─── Mock：与 agent-context-tools.test.ts 同 pattern，hoist 到 import 之前 ───
const mocks = vi.hoisted(() => ({
  getCachedGraphData: vi.fn(),
}));

vi.mock('../../../src/mcp/graph-tools.js', () => ({
  getCachedGraphData: mocks.getCachedGraphData,
  reloadGraph: vi.fn(),
}));

import {
  writeTelemetry,
  handleImpact,
  type TelemetryEntry,
} from '../../../src/mcp/agent-context-tools.js';

// ─── 工具 ───────────────────────────────────────────────────

function makeMinimalGraph(): GraphJSON {
  return {
    directed: true,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-05-09T00:00:00.000Z',
      nodeCount: 1,
      edgeCount: 0,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
    },
    nodes: [
      {
        id: 'micrograd/engine.py::Value',
        kind: 'class',
        label: 'Value',
        metadata: { sourceFile: 'micrograd/engine.py', lineRange: { start: 1, end: 10 } },
      },
    ],
    links: [],
  };
}

let tmpDir: string;
let tmpJsonlPath: string;
const ENV_KEYS = ['SPECTRA_MCP_TELEMETRY_PATH', 'SPECTRA_MCP_RUN_ID'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  // 准备临时目录
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-tel-test-'));
  tmpJsonlPath = path.join(tmpDir, 'tel.jsonl');
  // 备份并清空相关 env
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  // 恢复 env
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  // 清理临时目录
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks();
});

// ─── 状态 1：env 未设置 → 无副作用 ────────────────────────────

describe('writeTelemetry — 状态 1：env 未设置', () => {
  it('未设置 SPECTRA_MCP_TELEMETRY_PATH 时不写文件', () => {
    expect(process.env['SPECTRA_MCP_TELEMETRY_PATH']).toBeUndefined();
    const entry: TelemetryEntry = {
      ts: '2026-05-09T00:00:00.000Z',
      toolName: 'impact',
      requestSize: 10,
      responseSize: 20,
      durationMs: 5,
      runId: 'unknown',
    };
    // 不应抛异常
    expect(() => writeTelemetry(entry)).not.toThrow();
    // tmp 目录下无文件被写入
    expect(fs.existsSync(tmpJsonlPath)).toBe(false);
  });

  it('设置为空字符串时也不写', () => {
    process.env['SPECTRA_MCP_TELEMETRY_PATH'] = '';
    const entry: TelemetryEntry = {
      ts: '2026-05-09T00:00:00.000Z',
      toolName: 'context',
      requestSize: 5,
      responseSize: 10,
      durationMs: 1,
      runId: 'unknown',
    };
    expect(() => writeTelemetry(entry)).not.toThrow();
    expect(fs.existsSync(tmpJsonlPath)).toBe(false);
  });
});

// ─── 状态 2：env 设置 + 写成功 → JSONL 含正确 entry ───────────

describe('writeTelemetry — 状态 2：env 设置 + 写成功', () => {
  it('appendFileSync 写入 JSONL，包含全部字段', () => {
    process.env['SPECTRA_MCP_TELEMETRY_PATH'] = tmpJsonlPath;
    const entry: TelemetryEntry = {
      ts: '2026-05-09T01:02:03.000Z',
      toolName: 'impact',
      requestSize: 42,
      responseSize: 100,
      durationMs: 12,
      runId: 'run-abc',
    };
    writeTelemetry(entry);
    expect(fs.existsSync(tmpJsonlPath)).toBe(true);
    const content = fs.readFileSync(tmpJsonlPath, 'utf-8');
    expect(content.endsWith('\n')).toBe(true);
    const parsed: TelemetryEntry = JSON.parse(content.trim());
    expect(parsed.ts).toBe('2026-05-09T01:02:03.000Z');
    expect(parsed.toolName).toBe('impact');
    expect(parsed.requestSize).toBe(42);
    expect(parsed.responseSize).toBe(100);
    expect(parsed.durationMs).toBe(12);
    expect(parsed.runId).toBe('run-abc');
  });

  it('多次调用产生多行 JSONL（append 语义）', () => {
    process.env['SPECTRA_MCP_TELEMETRY_PATH'] = tmpJsonlPath;
    writeTelemetry({
      ts: 't1',
      toolName: 'impact',
      requestSize: 1,
      responseSize: 1,
      durationMs: 1,
      runId: 'r',
    });
    writeTelemetry({
      ts: 't2',
      toolName: 'context',
      requestSize: 2,
      responseSize: 2,
      durationMs: 2,
      runId: 'r',
    });
    const lines = fs.readFileSync(tmpJsonlPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).toolName).toBe('impact');
    expect(JSON.parse(lines[1]!).toolName).toBe('context');
  });
});

// ─── 状态 3：env 设置 + 写失败 → 静默吞，handler 仍返回 ───────

describe('writeTelemetry — 状态 3：写失败静默降级', () => {
  it('路径不可写（指向不存在的目录）时不抛异常', () => {
    process.env['SPECTRA_MCP_TELEMETRY_PATH'] = '/nonexistent-readonly-dir-xyz/tel.jsonl';
    const entry: TelemetryEntry = {
      ts: 'ts',
      toolName: 'impact',
      requestSize: 1,
      responseSize: 1,
      durationMs: 1,
      runId: 'r',
    };
    expect(() => writeTelemetry(entry)).not.toThrow();
  });

  it('handler 在写失败场景下仍返回原 result（不阻塞 MCP response）', async () => {
    process.env['SPECTRA_MCP_TELEMETRY_PATH'] = '/nonexistent-readonly-dir-xyz/tel.jsonl';
    process.env['SPECTRA_MCP_RUN_ID'] = 'run-fail';
    mocks.getCachedGraphData.mockReturnValue({
      graphData: makeMinimalGraph(),
      graphPath: '/tmp/fake-graph.json',
      mtimeMs: 1,
      sizeBytes: 100,
    });
    const result = await handleImpact({ target: 'micrograd/engine.py::Value' });
    // handler 必须返回 ToolResult，content 数组非空
    expect(result).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
    expect(typeof result.content[0]!.text).toBe('string');
  });
});

// ─── 状态 4：error path 也记录 telemetry 含 errorCode ─────────

describe('handler error path — 记录 telemetry 含 errorCode', () => {
  it('buildErrorResponse 早 return（target 缺失）→ JSONL 含 errorCode=invalid-input', async () => {
    process.env['SPECTRA_MCP_TELEMETRY_PATH'] = tmpJsonlPath;
    process.env['SPECTRA_MCP_RUN_ID'] = 'run-err';
    // target 为空 → handleImpact 早 return invalid-input
    const result = await handleImpact({ target: '' });
    expect(result.isError).toBe(true);

    // JSONL 应被写入一条
    expect(fs.existsSync(tmpJsonlPath)).toBe(true);
    const content = fs.readFileSync(tmpJsonlPath, 'utf-8').trim();
    const lines = content.split('\n');
    expect(lines.length).toBe(1);
    const entry: TelemetryEntry = JSON.parse(lines[0]!);
    expect(entry.toolName).toBe('impact');
    expect(entry.runId).toBe('run-err');
    expect(entry.errorCode).toBe('invalid-input');
    expect(entry.requestSize).toBeGreaterThan(0);
    expect(entry.responseSize).toBeGreaterThan(0);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof entry.ts).toBe('string');
  });

  it('graph-not-built 错误也记录 errorCode', async () => {
    process.env['SPECTRA_MCP_TELEMETRY_PATH'] = tmpJsonlPath;
    process.env['SPECTRA_MCP_RUN_ID'] = 'run-err2';
    mocks.getCachedGraphData.mockReturnValue(null); // 触发 graph-not-built
    const result = await handleImpact({ target: 'foo' });
    expect(result.isError).toBe(true);

    const content = fs.readFileSync(tmpJsonlPath, 'utf-8').trim();
    const entry: TelemetryEntry = JSON.parse(content.split('\n')[0]!);
    expect(entry.errorCode).toBe('graph-not-built');
    expect(entry.toolName).toBe('impact');
  });

  it('成功 path 不含 errorCode 字段', async () => {
    process.env['SPECTRA_MCP_TELEMETRY_PATH'] = tmpJsonlPath;
    process.env['SPECTRA_MCP_RUN_ID'] = 'run-ok';
    mocks.getCachedGraphData.mockReturnValue({
      graphData: makeMinimalGraph(),
      graphPath: '/tmp/fake-graph.json',
      mtimeMs: 1,
      sizeBytes: 100,
    });
    const result = await handleImpact({ target: 'micrograd/engine.py::Value' });
    expect(result.isError).toBeUndefined();

    const content = fs.readFileSync(tmpJsonlPath, 'utf-8').trim();
    const entry: TelemetryEntry = JSON.parse(content.split('\n')[0]!);
    expect(entry.errorCode).toBeUndefined();
    expect(entry.toolName).toBe('impact');
    expect(entry.runId).toBe('run-ok');
  });

  it('runId 默认为 unknown（env 未设置时）', async () => {
    process.env['SPECTRA_MCP_TELEMETRY_PATH'] = tmpJsonlPath;
    delete process.env['SPECTRA_MCP_RUN_ID'];
    await handleImpact({ target: '' });
    const content = fs.readFileSync(tmpJsonlPath, 'utf-8').trim();
    const entry: TelemetryEntry = JSON.parse(content.split('\n')[0]!);
    expect(entry.runId).toBe('unknown');
  });
});
