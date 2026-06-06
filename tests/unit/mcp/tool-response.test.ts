/**
 * Feature 171 — tool-response 共享原语单测
 *
 * 重点（修 Codex COVERAGE-BLINDSPOT）：buildSuccessResponse 截断循环既有测试仅注释未断言，
 * 本文件直测多轮收缩 / progressed=false break / payload-truncated warning / exceedsPayloadCap。
 */

import { describe, it, expect } from 'vitest';
import {
  buildErrorResponse,
  buildSuccessResponse,
  exceedsPayloadCap,
  PAYLOAD_CAP_BYTES,
  type ToolResult,
} from '../../../src/mcp/lib/tool-response.js';

function parse(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe('F171 buildErrorResponse', () => {
  it('生成 isError envelope，含 code/message', () => {
    const r = buildErrorResponse('path-outside-root', 'msg');
    expect(r.isError).toBe(true);
    expect(parse(r)).toEqual({ code: 'path-outside-root', message: 'msg' });
  });

  it('可选 hint/context 仅在提供时出现', () => {
    const r = buildErrorResponse('invalid-input', 'm', 'try this', { k: 1 });
    const p = parse(r);
    expect(p['hint']).toBe('try this');
    expect(p['context']).toEqual({ k: 1 });
  });

  it('新增的 3 个 Feature 171 错误码可用', () => {
    for (const code of ['path-outside-root', 'binary-file', 'file-not-found'] as const) {
      expect(parse(buildErrorResponse(code, 'x'))['code']).toBe(code);
    }
  });
});

describe('F171 buildSuccessResponse', () => {
  it('小 payload 原样返回，无 warnings', () => {
    const r = buildSuccessResponse({ a: 1, items: [1, 2, 3] }, ['items']);
    expect(r.isError).toBeUndefined();
    expect(parse(r)).toEqual({ a: 1, items: [1, 2, 3] });
  });

  it('超 cap 时截断可截断数组并加 payload-truncated warning', () => {
    // 每个元素 ~1KB，2000 个 ≈ 2MB > 1MB cap
    const big = Array.from({ length: 2000 }, (_, i) => 'x'.repeat(1000) + i);
    const r = buildSuccessResponse({ items: big }, ['items']);
    const p = parse(r);
    expect((p['items'] as unknown[]).length).toBeLessThan(2000);
    expect(p['warnings']).toContain('payload-truncated');
    expect(exceedsPayloadCap(r)).toBe(false);
  });

  it('无可截断 key 时不截断（即使超 cap）', () => {
    const huge = 'y'.repeat(PAYLOAD_CAP_BYTES + 100);
    const r = buildSuccessResponse({ blob: huge }, []);
    expect(exceedsPayloadCap(r)).toBe(true); // 未提供 truncatableKeys → 不收缩
  });

  it('progressed=false break：不可截断巨字段 + 已空数组 → 循环退出', () => {
    // blob 不可截断且 > cap，items 可截断但收缩到 0 后仍超 → progressed=false break
    const huge = 'z'.repeat(PAYLOAD_CAP_BYTES + 5000);
    const r = buildSuccessResponse({ blob: huge, items: ['a', 'b'] }, ['items']);
    const p = parse(r);
    expect((p['items'] as unknown[]).length).toBe(0); // 被收缩到 0
    expect(exceedsPayloadCap(r)).toBe(true); // blob 撑着，仍超 → handler 会改 payload-too-large
  });

  it('warnings 已含 payload-truncated 时不重复追加', () => {
    const big = Array.from({ length: 2000 }, () => 'x'.repeat(1000));
    const r = buildSuccessResponse({ items: big, warnings: ['payload-truncated'] }, ['items']);
    const warnings = parse(r)['warnings'] as string[];
    expect(warnings.filter((w) => w === 'payload-truncated').length).toBe(1);
  });
});

describe('F171 exceedsPayloadCap', () => {
  it('小响应 false', () => {
    expect(exceedsPayloadCap({ content: [{ type: 'text', text: 'small' }] })).toBe(false);
  });
  it('超 cap true', () => {
    expect(exceedsPayloadCap({ content: [{ type: 'text', text: 'q'.repeat(PAYLOAD_CAP_BYTES + 1) }] })).toBe(true);
  });
  it('空 content 容错 false', () => {
    expect(exceedsPayloadCap({ content: [] } as unknown as ToolResult)).toBe(false);
  });
});
