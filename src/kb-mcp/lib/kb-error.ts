/**
 * F190 KB MCP — KB 业务错误构造（顶层 code，修 Codex CRITICAL-5）
 *
 * KB 业务码不属于 src/mcp/lib/tool-response.ts 的 ErrorCode union（那是 MCP 协议层错误）。
 * 为同时满足"顶层 code 可机械断言（EC-010/SC-009）"+"telemetry extractErrorCode 读顶层 code"
 * +"零回归不碰 src/mcp"，KB 用自有 builder 产出同 shape envelope 但 code 为 KB 自有码。
 *
 * 内部未预期异常仍由 withTelemetry 顶层兜底成 buildErrorResponse('internal-error')（脱敏）。
 */

import type { ToolResult } from '../../mcp/lib/tool-response.js';

/** KB 工具业务错误码 */
export type KbErrorCode =
  | 'INVALID_QUERY'
  | 'INVALID_TOP_K'
  | 'INVALID_SOURCE_FILTER'
  | 'INVALID_LOOKUP_ARG'
  | 'KB_NOT_FOUND'
  | 'KB_CORRUPT';

/**
 * 构造 KB 业务错误响应。
 * 形态与 ToolResult 一致：`{ isError: true, content: [{ type:'text', text: JSON({code,message,hint?}) }] }`，
 * `code` 是 KB 自有码（顶层 JSON 字段，机械断言 `JSON.parse(text).code`，不从 message 解析）。
 */
export function buildKbError(code: KbErrorCode, message: string, hint?: string): ToolResult {
  const payload: Record<string, unknown> = { code, message };
  if (hint !== undefined) payload['hint'] = hint;
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

/** 构造 KB 工具成功响应 envelope（不复用 buildSuccessResponse 的截断逻辑，KB 自管 token cap） */
export function buildKbSuccess(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}
