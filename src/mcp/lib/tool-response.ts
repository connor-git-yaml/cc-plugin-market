/**
 * Feature 171 — MCP 共享响应原语（tool-response）
 *
 * 从 agent-context-tools.ts 抽出的共享层，解决 Feature 171 Codex C-4：
 *   ToolResult / ErrorCode / buildErrorResponse / buildSuccessResponse / PAYLOAD_CAP_BYTES
 *   原为 agent-context-tools.ts 私有符号，file-nav-tools.ts 无法复用。
 * 抽到本模块后 agent-context-tools 与 file-nav 双向导入（去重，非污染）。
 *
 * ErrorCode union 在既有 9 码基础上新增 Feature 171 的 3 码：
 *   path-outside-root / binary-file / file-not-found
 */

/** 统一错误码（Feature 155 既有 9 码 + Feature 171 新增 3 码） */
export type ErrorCode =
  // Feature 155 既有
  | 'graph-not-built'
  | 'symbol-not-found'
  | 'invalid-symbol-id'
  | 'invalid-input'
  | 'invalid-diff'
  | 'payload-too-large'
  | 'git-spawn-failed'
  | 'git-timeout'
  | 'internal-error'
  // Feature 171 新增
  | 'path-outside-root'
  | 'binary-file'
  | 'file-not-found'
  // Feature 177 新增：graph 工具查询期异常（engine 已加载成功后的业务异常；
  // 缺图/坏图走既有 'graph-not-built'，见 graph-tools.ts 拆 engine 加载边界）
  | 'graph-query-failed';

/** MCP tool 统一响应 envelope */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string; [key: string]: unknown }>;
  isError?: true;
}

/**
 * 构造错误响应 envelope。
 * 调用方负责脱敏：message/hint/context 不得包含绝对路径、stack、raw errno path
 * （Feature 171 FR-014）。
 */
export function buildErrorResponse(
  code: ErrorCode,
  message: string,
  hint?: string,
  context?: Record<string, unknown>,
): ToolResult {
  const payload: Record<string, unknown> = { code, message };
  if (hint !== undefined) payload['hint'] = hint;
  if (context !== undefined) payload['context'] = context;
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

/** payload 字节上限：超限时截断可截断数组并加 payload-truncated warning */
export const PAYLOAD_CAP_BYTES = 1_000_000;

/**
 * 构造成功响应 envelope。
 * 当序列化超 PAYLOAD_CAP_BYTES 且提供了 truncatableArrayKeys 时，
 * 按比例收缩这些数组并追加 warnings 含 'payload-truncated'。
 *
 * 注意：本函数始终返回 success（不返回 payload-too-large）。
 * 若收缩后仍超 cap，由调用方（handler）复核 byteLength 后决定是否改返 payload-too-large。
 */
export function buildSuccessResponse(
  data: Record<string, unknown>,
  truncatableArrayKeys: string[] = [],
  warningsKey: string = 'warnings',
): ToolResult {
  let text = JSON.stringify(data);
  let bytes = Buffer.byteLength(text, 'utf-8');
  if (bytes > PAYLOAD_CAP_BYTES && truncatableArrayKeys.length > 0) {
    let truncated = false;
    let safety = 0;
    while (bytes > PAYLOAD_CAP_BYTES && safety < 8) {
      safety++;
      let progressed = false;
      for (const key of truncatableArrayKeys) {
        const arr = data[key];
        if (!Array.isArray(arr) || arr.length === 0) continue;
        // 按比例 0.7 收缩，至少减 1
        const ratio = PAYLOAD_CAP_BYTES / bytes;
        const newLen = Math.max(0, Math.min(arr.length - 1, Math.floor(arr.length * ratio * 0.7)));
        if (newLen < arr.length) {
          data[key] = arr.slice(0, newLen);
          truncated = true;
          progressed = true;
        }
      }
      if (!progressed) break;
      text = JSON.stringify(data);
      bytes = Buffer.byteLength(text, 'utf-8');
    }
    if (truncated) {
      const warnings = (data[warningsKey] as string[] | undefined) ?? [];
      if (!warnings.includes('payload-truncated')) {
        data[warningsKey] = [...warnings, 'payload-truncated'];
        text = JSON.stringify(data);
      }
    }
  }
  return { content: [{ type: 'text', text }] };
}

/**
 * 复核 ToolResult 的序列化字节是否仍超 cap（Feature 171 FR-021）。
 * handler 在 buildSuccessResponse 收缩后调用本函数，仍超则改返 payload-too-large。
 */
export function exceedsPayloadCap(result: ToolResult): boolean {
  const text = result.content?.[0]?.text ?? '';
  return Buffer.byteLength(text, 'utf-8') > PAYLOAD_CAP_BYTES;
}
