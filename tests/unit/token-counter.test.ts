/**
 * token-counter 单元测试
 * 验证快速估算、精确计数、CJK 处理、预算检查、缓存
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  estimateFast,
  countAccurate,
  fitsInBudget,
  clearCache,
} from '../../src/core/token-counter.js';

describe('token-counter', () => {
  beforeEach(() => {
    clearCache();
  });

  describe('estimateFast', () => {
    it('空文本应返回 0', () => {
      expect(estimateFast('')).toBe(0);
    });

    it('应对纯英文代码使用 3.8 chars/token', () => {
      const text = 'export function hello(): string { return "world"; }';
      const estimate = estimateFast(text);
      // 51 chars / 3.8 ≈ 14
      expect(estimate).toBeGreaterThan(10);
      expect(estimate).toBeLessThan(20);
    });

    it('应对含 CJK 字符的文本使用 2.5 chars/token', () => {
      const text = '这是一段中文注释';
      const estimate = estimateFast(text);
      // 8 chars / 2.5 ≈ 4
      expect(estimate).toBeGreaterThan(2);
      expect(estimate).toBeLessThan(8);
    });

    it('应处理大文本', () => {
      const text = 'a'.repeat(100_000);
      const estimate = estimateFast(text);
      expect(estimate).toBeGreaterThan(20_000);
    });
  });

  describe('countAccurate', () => {
    it('空文本应返回 0', async () => {
      expect(await countAccurate('')).toBe(0);
    });

    it('应返回正整数', async () => {
      const count = await countAccurate('export function test(): void {}');
      expect(count).toBeGreaterThan(0);
      expect(Number.isInteger(count)).toBe(true);
    });

    it('应对 CJK 文本给出合理估计', async () => {
      const count = await countAccurate('这是中文文本测试');
      expect(count).toBeGreaterThan(0);
    });

    it('缓存命中应返回相同结果', async () => {
      const text = 'const x = 42;';
      const first = await countAccurate(text);
      const second = await countAccurate(text);
      expect(first).toBe(second);
    });
  });

  describe('fitsInBudget', () => {
    it('小文本应在大预算内', () => {
      expect(fitsInBudget('hello', 1000)).toBe(true);
    });

    it('大文本应超出小预算', () => {
      const text = 'a'.repeat(100_000);
      expect(fitsInBudget(text, 100)).toBe(false);
    });

    it('应包含 15% 安全余量', () => {
      // 100 chars / 3.8 ≈ 27 tokens
      // 带 15% 余量 ≈ 31
      const text = 'a'.repeat(100);
      const estimate = estimateFast(text);
      // 在 estimate 和 estimate * 1.15 之间的预算应返回 false
      expect(fitsInBudget(text, Math.floor(estimate * 1.14))).toBe(false);
      expect(fitsInBudget(text, Math.ceil(estimate * 1.16))).toBe(true);
    });
  });
});
