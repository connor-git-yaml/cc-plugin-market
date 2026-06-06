/**
 * Feature 158 — MCP Telemetry（从 agent-context-tools.ts 抽出，Feature 171）
 *
 * 抽到独立模块的动机（Feature 171 Codex TELEMETRY-COUPLING）：
 *   file-nav-tools.ts 需复用 recordAndReturn，若从 agent-context-tools.ts import
 *   会把整个 graph 查询依赖图拉进来。抽到本轻量模块后 file-nav 只依赖 tool-response + telemetry。
 *
 * agent-context-tools.ts 保留向后兼容 re-export（既有 telemetry.test.ts 从该路径 import）。
 */

import { appendFileSync } from 'node:fs';
import type { ToolResult } from './tool-response.js';

/**
 * Telemetry entry — 单次 handler 调用的可观测数据，按行写入 JSONL。
 * 由评测脚本通过 SPECTRA_MCP_TELEMETRY_PATH 注入路径，SPECTRA_MCP_RUN_ID 标识 run。
 */
export interface TelemetryEntry {
  ts: string;
  toolName: string;
  requestSize: number;
  responseSize: number;
  durationMs: number;
  runId: string;
  errorCode?: string;
  // Feature 165 — 轻量响应摘要（不存完整 payload）
  responseSummary?: Record<string, number>;
  responseSamples?: {
    symbols?: string[];
    files?: string[];
  };
}

/**
 * 写入 telemetry JSONL —— 静默降级：
 *   - env 未设置 → no-op
 *   - 写入失败 → 静默吞，不影响 MCP response
 */
export function writeTelemetry(entry: TelemetryEntry): void {
  const telPath = process.env['SPECTRA_MCP_TELEMETRY_PATH'];
  if (telPath === undefined || telPath.length === 0) return;
  try {
    appendFileSync(telPath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // FR-G-002: silent degrade — 写入失败时不抛异常，不影响 handler 返回
  }
}

/**
 * 从 ToolResult 中提取 errorCode（仅 isError=true 时存在）。
 * 解析失败时返回 undefined（telemetry 字段缺省）。
 */
export function extractErrorCode(result: ToolResult): string | undefined {
  if (result.isError !== true) return undefined;
  const text = result.content?.[0]?.text;
  if (typeof text !== 'string') return undefined;
  try {
    const parsed = JSON.parse(text) as { code?: unknown };
    return typeof parsed.code === 'string' ? parsed.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Wrapper：记录 handler 调用 telemetry 后返回原 result。
 * 包裹所有 return 路径（含 buildErrorResponse 早 return）。
 */
export function recordAndReturn(
  toolName: string,
  startTimeMs: number,
  requestSize: number,
  result: ToolResult,
  responseSummary?: Record<string, number>,
  responseSamples?: { symbols?: string[]; files?: string[] },
): ToolResult {
  const responseText = result.content?.[0]?.text ?? '';
  const responseSize = typeof responseText === 'string' ? Buffer.byteLength(responseText, 'utf-8') : 0;
  const entry: TelemetryEntry = {
    ts: new Date().toISOString(),
    toolName,
    requestSize,
    responseSize,
    durationMs: Date.now() - startTimeMs,
    runId: process.env['SPECTRA_MCP_RUN_ID'] ?? 'unknown',
  };
  const errorCode = extractErrorCode(result);
  if (errorCode !== undefined) entry.errorCode = errorCode;
  if (responseSummary !== undefined && errorCode === undefined) {
    entry.responseSummary = responseSummary;
  }
  if (responseSamples !== undefined && errorCode === undefined) {
    entry.responseSamples = responseSamples;
  }
  writeTelemetry(entry);
  return result;
}
