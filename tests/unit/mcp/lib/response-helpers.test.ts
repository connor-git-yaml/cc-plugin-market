/**
 * F170c T-RED-4 — response-helpers.ts 纯函数单测
 *
 * RED phase: 所有 helper 函数为 stub（throw 'not implemented'），全部用例 FAIL（assertion fail）。
 * GREEN phase（T-GREEN-1）: 实施真实逻辑后全部 PASS。
 *
 * 覆盖：
 *   - buildTopImpactedRanking
 *   - generateNextStepHint
 *   - buildTopRelevantCallers
 *   - safeStderrLog
 *   - SC-007 性能基准（≤ 100ms 额外延迟）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildTopImpactedRanking,
  generateNextStepHint,
  buildTopRelevantCallers,
  safeStderrLog,
  type TopImpacted,
  type TopRelevantCaller,
} from '../../../../src/mcp/lib/response-helpers.js';

// ─────────────────────────────────────────────────────────────
// buildTopImpactedRanking
// ─────────────────────────────────────────────────────────────

describe('F170c buildTopImpactedRanking', () => {
  it('空数组返回 []', () => {
    expect(buildTopImpactedRanking([], 5)).toEqual([]);
  });

  it('单节点返回 [{ id, score: 1/depth }]', () => {
    const r = buildTopImpactedRanking([{ id: 'a/b.ts::Foo', depth: 2 }], 5);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('a/b.ts::Foo');
    expect(r[0].score).toBeCloseTo(0.5, 5);
  });

  it('多节点按 score 降序：depth=1 在前，depth=2 在后', () => {
    const r = buildTopImpactedRanking(
      [
        { id: 'a/b.ts::Z', depth: 2 },
        { id: 'a/b.ts::A', depth: 1 },
      ],
      5,
    );
    expect(r[0].id).toBe('a/b.ts::A');
    expect(r[0].score).toBeCloseTo(1.0, 5);
    expect(r[1].id).toBe('a/b.ts::Z');
    expect(r[1].score).toBeCloseTo(0.5, 5);
  });

  it('同 depth 时按 confidence 降序（响应 codex W-1）', () => {
    const r = buildTopImpactedRanking(
      [
        { id: 'a/b.ts::Low', depth: 1, confidence: 0.5 },
        { id: 'a/b.ts::High', depth: 1, confidence: 0.9 },
      ],
      5,
    );
    expect(r[0].id).toBe('a/b.ts::High');
    expect(r[1].id).toBe('a/b.ts::Low');
  });

  it('同 score + 同 confidence 时按 id 字母升序（stable sort）', () => {
    const r = buildTopImpactedRanking(
      [
        { id: 'a/b.ts::Z', depth: 1, confidence: 0.8 },
        { id: 'a/b.ts::A', depth: 1, confidence: 0.8 },
      ],
      5,
    );
    expect(r[0].id).toBe('a/b.ts::A');
    expect(r[1].id).toBe('a/b.ts::Z');
  });

  it('maxItems 截断', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `a/b.ts::Sym${i}`,
      depth: 1,
      confidence: 0.5,
    }));
    expect(buildTopImpactedRanking(items, 5)).toHaveLength(5);
    expect(buildTopImpactedRanking(items, 3)).toHaveLength(3);
  });

  it('SC-007 性能基准：100+ 节点排名计算额外延迟 ≤ 100ms（median）', () => {
    const largeAffected = Array.from({ length: 100 }, (_, i) => ({
      id: `fixture/module.ts::Symbol${String(i).padStart(3, '0')}`,
      depth: (i % 5) + 1,
      confidence: 0.5 + (i % 10) * 0.05,
    }));

    const measure = (fn: () => void): number => {
      const t0 = performance.now();
      fn();
      return performance.now() - t0;
    };

    const baselineTimes: number[] = [];
    for (let i = 0; i < 13; i++) {
      baselineTimes.push(measure(() => {
        /* no-op */
      }));
    }

    const rankingTimes: number[] = [];
    for (let i = 0; i < 13; i++) {
      rankingTimes.push(measure(() => buildTopImpactedRanking(largeAffected, 5)));
    }

    const median = (times: number[]): number => {
      const sorted = [...times].slice(3).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };

    const extraLatencyMs = median(rankingTimes) - median(baselineTimes);
    expect(extraLatencyMs, `100 节点 ranking median 额外延迟 ${extraLatencyMs.toFixed(2)}ms，需 < 100ms`).toBeLessThan(100);
  });
});

// ─────────────────────────────────────────────────────────────
// generateNextStepHint
// ─────────────────────────────────────────────────────────────

describe('F170c generateNextStepHint', () => {
  describe('impact', () => {
    it('success 路径有节点：返回非空字符串（≥ 5 字符）含 topImpacted[0].id', () => {
      const hint = generateNextStepHint(
        'impact',
        { topImpacted: [{ id: 'a/b.ts::Foo', score: 1.0 }] as TopImpacted[], affected: [] },
        'success',
      );
      expect(hint.length).toBeGreaterThanOrEqual(5);
      expect(hint).toContain('a/b.ts::Foo');
    });

    it('success 路径 0 节点：返回非空引导文本', () => {
      const hint = generateNextStepHint(
        'impact',
        { topImpacted: [] as TopImpacted[], affected: [] },
        'success',
      );
      expect(hint.length).toBeGreaterThanOrEqual(5);
    });

    it('degraded 路径：返回 ""', () => {
      const hint = generateNextStepHint('impact', {}, 'degraded');
      expect(hint).toBe('');
    });
  });

  describe('detect_changes', () => {
    it('success 路径：返回非空引导文本', () => {
      const hint = generateNextStepHint(
        'detect_changes',
        {
          topImpacted: [{ id: 'a/b.ts::Foo', score: 1.0 }] as TopImpacted[],
          riskTier: 'medium',
          totalChanged: 3,
        },
        'success',
      );
      expect(hint.length).toBeGreaterThanOrEqual(5);
    });

    it('degraded 路径：返回 ""', () => {
      const hint = generateNextStepHint('detect_changes', {}, 'degraded');
      expect(hint).toBe('');
    });
  });

  describe('context', () => {
    it('success 路径：返回非空引导文本', () => {
      const hint = generateNextStepHint(
        'context',
        { definition: { id: 'a/b.ts::Foo' }, callers: [{ id: 'x/y.ts::Bar' }] },
        'success',
      );
      expect(hint.length).toBeGreaterThanOrEqual(5);
    });

    it('degraded 路径：返回 ""', () => {
      const hint = generateNextStepHint('context', {}, 'degraded');
      expect(hint).toBe('');
    });
  });
});

// ─────────────────────────────────────────────────────────────
// buildTopRelevantCallers
// ─────────────────────────────────────────────────────────────

describe('F170c buildTopRelevantCallers', () => {
  it('空数组返回 []', () => {
    expect(buildTopRelevantCallers([], 3)).toEqual([]);
  });

  it('按 confidence 降序', () => {
    const r = buildTopRelevantCallers(
      [
        { id: 'a/b.ts::Low', confidence: 0.3 },
        { id: 'a/b.ts::High', confidence: 0.9 },
        { id: 'a/b.ts::Mid', confidence: 0.6 },
      ],
      3,
    );
    expect(r.map((c) => c.id)).toEqual(['a/b.ts::High', 'a/b.ts::Mid', 'a/b.ts::Low']);
  });

  it('同 confidence 时按 id 字母升序', () => {
    const r = buildTopRelevantCallers(
      [
        { id: 'a/b.ts::Z', confidence: 0.8 },
        { id: 'a/b.ts::A', confidence: 0.8 },
      ],
      3,
    );
    expect(r[0].id).toBe('a/b.ts::A');
    expect(r[1].id).toBe('a/b.ts::Z');
  });

  it('maxItems 截断', () => {
    const callers = Array.from({ length: 5 }, (_, i) => ({
      id: `a/b.ts::Sym${i}`,
      confidence: 0.5,
    }));
    expect(buildTopRelevantCallers(callers, 3)).toHaveLength(3);
  });

  it('每个 entry 含 { id, confidence, score }', () => {
    const r = buildTopRelevantCallers([{ id: 'a/b.ts::Foo', confidence: 0.7 }], 3);
    expect(r[0]).toMatchObject({ id: 'a/b.ts::Foo', confidence: 0.7 });
    expect(typeof r[0].score).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────
// safeStderrLog
// ─────────────────────────────────────────────────────────────

describe('F170c safeStderrLog', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('正常调用不抛错且转发到 stderr.write', () => {
    expect(() => safeStderrLog('test message\n')).not.toThrow();
    expect(writeSpy).toHaveBeenCalledWith('test message\n');
  });

  it('process.stderr.write mock 抛错时仍不抛出（响应 codex C-6）', () => {
    writeSpy.mockImplementation(() => {
      throw new Error('stderr unavailable');
    });
    expect(() => safeStderrLog('test message\n')).not.toThrow();
  });
});
