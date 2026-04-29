/**
 * Feature 146 FR-002 — 并发数边界规范化单元测试
 *
 * 仅测试 normalizeConcurrency 纯函数，不启动完整 pipeline，
 * 覆盖 0/-1/3.7/超出模块数 等典型边界（spec.md US5 验证场景）。
 */

import { describe, it, expect, vi } from 'vitest';
import { normalizeConcurrency } from '../../src/batch/batch-orchestrator.js';

describe('normalizeConcurrency（FR-002 边界规范化）', () => {
  it('concurrency=0 → 修正为 1，触发 onWarn', () => {
    const onWarn = vi.fn();
    const result = normalizeConcurrency(0, onWarn);
    expect(result).toBe(1);
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('concurrency=0'));
  });

  it('concurrency=-1 → 修正为 1，触发 onWarn', () => {
    const onWarn = vi.fn();
    const result = normalizeConcurrency(-1, onWarn);
    expect(result).toBe(1);
    expect(onWarn).toHaveBeenCalledTimes(1);
  });

  it('concurrency=3.7 → Math.floor 后为 3，不触发 onWarn', () => {
    const onWarn = vi.fn();
    const result = normalizeConcurrency(3.7, onWarn);
    expect(result).toBe(3);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('concurrency=50（超出模块数）→ 保留 50，不触发 onWarn（p-limit 内部处理）', () => {
    const onWarn = vi.fn();
    const result = normalizeConcurrency(50, onWarn);
    expect(result).toBe(50);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('concurrency=NaN → 修正为 1，触发 onWarn', () => {
    const onWarn = vi.fn();
    const result = normalizeConcurrency(Number.NaN, onWarn);
    expect(result).toBe(1);
    expect(onWarn).toHaveBeenCalledTimes(1);
  });

  it('concurrency=Infinity → 修正为 1，触发 onWarn', () => {
    const onWarn = vi.fn();
    const result = normalizeConcurrency(Number.POSITIVE_INFINITY, onWarn);
    expect(result).toBe(1);
    expect(onWarn).toHaveBeenCalledTimes(1);
  });

  it('concurrency=3 默认值 → 直接返回 3', () => {
    const onWarn = vi.fn();
    const result = normalizeConcurrency(3, onWarn);
    expect(result).toBe(3);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('未提供 onWarn 时也能安全规范化', () => {
    expect(() => normalizeConcurrency(0)).not.toThrow();
    expect(normalizeConcurrency(0)).toBe(1);
    expect(normalizeConcurrency(2)).toBe(2);
  });
});
