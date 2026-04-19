/**
 * spec-identity 单元测试
 * 覆盖 getDefaultSourceKind 的各种输入场景
 */
import { describe, it, expect } from 'vitest';
import { getDefaultSourceKind, type SpecSourceKind } from '../../src/spec-store/spec-identity.js';

describe('getDefaultSourceKind', () => {
  // ============================================================
  // 合法枚举值：原样返回
  // ============================================================
  it('输入 "canonical" 返回 "canonical"', () => {
    expect(getDefaultSourceKind('canonical')).toBe('canonical');
  });

  it('输入 "derived" 返回 "derived"', () => {
    expect(getDefaultSourceKind('derived')).toBe('derived');
  });

  it('输入 "bundle_copy" 返回 "bundle_copy"', () => {
    expect(getDefaultSourceKind('bundle_copy')).toBe('bundle_copy');
  });

  // ============================================================
  // 缺失/无效值：降级为 'canonical'
  // ============================================================
  it('输入 undefined 返回 "canonical"（向后兼容）', () => {
    expect(getDefaultSourceKind(undefined)).toBe('canonical');
  });

  it('输入 null 返回 "canonical"（向后兼容）', () => {
    expect(getDefaultSourceKind(null)).toBe('canonical');
  });

  it('输入空字符串 "" 返回 "canonical"', () => {
    expect(getDefaultSourceKind('')).toBe('canonical');
  });

  it('输入任意非法字符串（如 "unknown"）返回 "canonical"', () => {
    expect(getDefaultSourceKind('unknown')).toBe('canonical');
  });

  it('输入大写 "CANONICAL" 返回 "canonical"（大小写不匹配视为非法）', () => {
    expect(getDefaultSourceKind('CANONICAL')).toBe('canonical');
  });

  it('输入 "Bundle_Copy"（首字母大写）返回 "canonical"', () => {
    expect(getDefaultSourceKind('Bundle_Copy')).toBe('canonical');
  });

  it('输入数字字符串（如 "1"）返回 "canonical"', () => {
    expect(getDefaultSourceKind('1')).toBe('canonical');
  });

  // ============================================================
  // 类型验证：返回值必须是合法的 SpecSourceKind
  // ============================================================
  it('返回值始终是合法的 SpecSourceKind 枚举值之一', () => {
    const validKinds: SpecSourceKind[] = ['canonical', 'derived', 'bundle_copy'];

    const testInputs = [
      'canonical', 'derived', 'bundle_copy',
      undefined, null, '', 'unknown', 'CANONICAL',
    ];

    for (const input of testInputs) {
      const result = getDefaultSourceKind(input ?? undefined);
      expect(validKinds).toContain(result);
    }
  });
});
