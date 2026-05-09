/**
 * Feature 154 — verify 脚本纯函数单测（T-4.2）
 *
 * 覆盖 4 个 export pure function：
 *  - extractCallerLabel：5 种 callerLabel 形态拆分
 *  - median：奇数 / 偶数 / 单元素 / 空数组
 *  - evaluateMatch：命中 / 未命中
 *  - normalizeRelPath：POSIX 归一
 */
import { describe, it, expect } from 'vitest';
// .mjs 模块 TS 类型未声明，运行时由 ESM loader 解析
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - mjs 静态 ESM import
import {
  extractCallerLabel,
  median,
  evaluateMatch,
  normalizeRelPath,
} from '../../scripts/verify-feature-154.mjs';

// ════════════════════════ extractCallerLabel ════════════════════════

describe('extractCallerLabel — 5 种 caller 形态拆分', () => {
  const file = 'src/main/HikariPool.java';

  it('method scope: "file:Class.method" → "Class.method"', () => {
    expect(extractCallerLabel(`${file}:HikariPool.getConnection`, file)).toBe(
      'HikariPool.getConnection',
    );
  });

  it('constructor scope: "file:Class.<init>" → "Class.<init>"', () => {
    expect(extractCallerLabel(`${file}:HikariPool.<init>`, file)).toBe(
      'HikariPool.<init>',
    );
  });

  it('lambda scope（含冒号）: "file:<lambda:42:18>" → "<lambda:42:18>"', () => {
    expect(extractCallerLabel(`${file}:<lambda:42:18>`, file)).toBe(
      '<lambda:42:18>',
    );
  });

  it('top-level scope: "file:<top-level>" → "<top-level>"', () => {
    expect(extractCallerLabel(`${file}:<top-level>`, file)).toBe('<top-level>');
  });

  it('anon-class scope: "file:<anon-class>.run" → "<anon-class>.run"', () => {
    expect(extractCallerLabel(`${file}:<anon-class>.run`, file)).toBe(
      '<anon-class>.run',
    );
  });

  it('文件前缀不匹配时兜底取首个冒号之后', () => {
    expect(extractCallerLabel('other/file.java:Foo.bar', file)).toBe('Foo.bar');
  });

  it('无冒号字符串原样返回', () => {
    expect(extractCallerLabel('NoColon', file)).toBe('NoColon');
  });
});

// ════════════════════════ median ════════════════════════

describe('median — 奇数/偶数/单元素/空数组', () => {
  it('奇数取中位 [1, 3, 5] → 3', () => {
    expect(median([1, 3, 5])).toBe(3);
  });

  it('偶数取两中位平均 [1, 2, 3, 4] → 2.5', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('单元素 [7] → 7', () => {
    expect(median([7])).toBe(7);
  });

  it('空数组 [] → 0（防 NaN）', () => {
    expect(median([])).toBe(0);
  });

  it('乱序输入正确排序后取中位 [5, 1, 3] → 3', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('小数数组 [0.1, 0.2, 0.3] → 0.2', () => {
    expect(median([0.1, 0.2, 0.3])).toBeCloseTo(0.2, 5);
  });
});

// ════════════════════════ evaluateMatch ════════════════════════

describe('evaluateMatch — Set 命中判定', () => {
  const truthSet = new Set([
    'A.java|A.run|foo',
    'B.java|<lambda:5:12>|bar',
  ]);

  it('命中元素返回 true', () => {
    expect(evaluateMatch('A.java|A.run|foo', truthSet)).toBe(true);
  });

  it('未命中元素返回 false', () => {
    expect(evaluateMatch('A.java|A.run|baz', truthSet)).toBe(false);
  });
});

// ════════════════════════ normalizeRelPath ════════════════════════

describe('normalizeRelPath — POSIX 归一', () => {
  it('已是 POSIX 风格的路径保持不变', () => {
    const result = normalizeRelPath('/root/src/main/HikariPool.java', '/root');
    expect(result).toBe('src/main/HikariPool.java');
  });

  it('target 与 absPath 同目录返回 ""', () => {
    const result = normalizeRelPath('/root', '/root');
    expect(result).toBe('');
  });

  it('返回值不含 "\\\\"（POSIX 分隔符）', () => {
    const result = normalizeRelPath('/root/a/b/c.java', '/root');
    expect(result).not.toContain('\\');
  });
});
