/**
 * Feature 135 Bug 3：getSpectraVersionString 版本字段动态读取断言
 *
 * 验证：
 * - getSpectraVersionString() 返回格式为 "spectra vX.Y.Z"
 * - 版本号与 package.json.version 字段一致
 * - 不包含硬编码的 "v3.0" 或 "unknown"（正常环境下）
 */
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { getSpectraVersionString } from '../../src/generator/frontmatter.js';

const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json') as { version: string };

describe('getSpectraVersionString（Feature 135 Bug 3）', () => {
  it('返回值格式为 "spectra vX.Y.Z"', () => {
    const result = getSpectraVersionString();
    expect(result).toMatch(/^spectra v\d+\.\d+\.\d+/);
  });

  it('版本号与 package.json.version 一致', () => {
    const result = getSpectraVersionString();
    expect(result).toBe(`spectra v${pkg.version}`);
  });

  it('不包含硬编码字符串 "spectra v3.0"', () => {
    const result = getSpectraVersionString();
    expect(result).not.toBe('spectra v3.0');
    expect(result).not.toContain('v3.0');
  });

  it('不包含 "unknown"（package.json 可正常读取时）', () => {
    const result = getSpectraVersionString();
    expect(result).not.toContain('unknown');
  });

  it('多次调用返回同一值（缓存一致性）', () => {
    const first = getSpectraVersionString();
    const second = getSpectraVersionString();
    expect(first).toBe(second);
  });
});
