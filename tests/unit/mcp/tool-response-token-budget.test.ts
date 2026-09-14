/**
 * M11 卡 A（P1-I）— 成功响应 envelope 附 tokenBudget：
 * { payloadBytes, capBytes, estimatedTokens, truncated, truncatedKeys? }。
 * 消费方（agent）此前只能在超 1MB 被截断时看到一个 'payload-truncated' warning，
 * 平时不知道自己拿到了多大的 payload、离上限多远。
 */
import { describe, expect, it } from 'vitest';
import { PAYLOAD_CAP_BYTES, buildSuccessResponse } from '../../../src/mcp/lib/tool-response.js';
import { estimateTokens } from '../../../src/core/token-counter.js';

function parse(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

describe('buildSuccessResponse — tokenBudget', () => {
  it('小 payload：truncated=false，payloadBytes / estimatedTokens 按附加 tokenBudget 之前的文本计算', () => {
    const data = { a: 1, items: [1, 2, 3] };
    const bare = JSON.stringify(data);
    const d = parse(buildSuccessResponse({ ...data }, ['items']));
    expect(d['tokenBudget']).toEqual({
      payloadBytes: Buffer.byteLength(bare, 'utf-8'),
      capBytes: PAYLOAD_CAP_BYTES,
      estimatedTokens: estimateTokens(bare),
      truncated: false,
    });
    expect(d['warnings']).toBeUndefined();
  });

  it('超 cap 收缩后：truncated=true + truncatedKeys，payloadBytes ≤ capBytes，warnings 含 payload-truncated', () => {
    const items = Array.from({ length: 20_000 }, (_, i) => 'x'.repeat(60) + i);
    const d = parse(buildSuccessResponse({ items, keep: 'k' }, ['items']));
    const tb = d['tokenBudget'] as Record<string, unknown>;
    expect(tb['truncated']).toBe(true);
    expect(tb['truncatedKeys']).toEqual(['items']);
    expect(tb['payloadBytes'] as number).toBeLessThanOrEqual(PAYLOAD_CAP_BYTES);
    expect(d['warnings']).toContain('payload-truncated');
  });

  it('无可截断 key 且超 cap：truncated=false 但 payloadBytes > capBytes（诚实报超限，不假装收缩）', () => {
    const d = parse(buildSuccessResponse({ blob: 'y'.repeat(PAYLOAD_CAP_BYTES + 10) }));
    const tb = d['tokenBudget'] as Record<string, unknown>;
    expect(tb['truncated']).toBe(false);
    expect(tb['payloadBytes'] as number).toBeGreaterThan(PAYLOAD_CAP_BYTES);
    expect('truncatedKeys' in tb).toBe(false);
  });

  it('多字节 payload：payloadBytes 按 UTF-8 字节而非字符数', () => {
    const data = { s: '中文字符' };
    const d = parse(buildSuccessResponse({ ...data }));
    expect((d['tokenBudget'] as Record<string, number>)['payloadBytes']).toBe(Buffer.byteLength(JSON.stringify(data), 'utf-8'));
  });
});
