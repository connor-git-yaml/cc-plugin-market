/**
 * F190 T032 — buildKbError：顶层 code 机械可断言（修 Codex C-5）
 */

import { describe, it, expect } from 'vitest';
import { buildKbError, buildKbSuccess, type KbErrorCode } from '../../src/kb-mcp/lib/kb-error.js';
import { extractErrorCode } from '../../src/mcp/lib/telemetry.js';

describe('buildKbError', () => {
  it('产出 isError + 顶层 code（JSON.parse(text).code 可断言）', () => {
    const r = buildKbError('INVALID_QUERY', '查询为空');
    expect(r.isError).toBe(true);
    const payload = JSON.parse(r.content[0]!.text) as { code: string; message: string };
    expect(payload.code).toBe('INVALID_QUERY');
    expect(payload.message).toBe('查询为空');
  });

  it('与现有 telemetry extractErrorCode 兼容（读顶层 code）', () => {
    const r = buildKbError('KB_CORRUPT', '库损坏');
    expect(extractErrorCode(r)).toBe('KB_CORRUPT');
  });

  it('可选 hint 出现在 payload', () => {
    const r = buildKbError('KB_NOT_FOUND', '未找到', '请确认已安装 KB plugin');
    const payload = JSON.parse(r.content[0]!.text) as { hint?: string };
    expect(payload.hint).toBe('请确认已安装 KB plugin');
  });

  it('覆盖全部 KbErrorCode 枚举', () => {
    const codes: KbErrorCode[] = [
      'INVALID_QUERY', 'INVALID_TOP_K', 'INVALID_SOURCE_FILTER',
      'INVALID_LOOKUP_ARG', 'KB_NOT_FOUND', 'KB_CORRUPT',
    ];
    for (const c of codes) {
      expect(extractErrorCode(buildKbError(c, 'm'))).toBe(c);
    }
  });

  it('buildKbSuccess 无 isError', () => {
    const r = buildKbSuccess({ results: [], total_found: 0 });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0]!.text).total_found).toBe(0);
  });
});
