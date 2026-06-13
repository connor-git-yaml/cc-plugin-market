/**
 * Feature 193 T010 — relativizePosix / relativizeSymbolId 单元测试。
 *
 * 覆盖：
 *   - projectRoot 内绝对路径 → POSIX 相对路径
 *   - projectRoot 外路径（node_modules / 跨仓） → 保留绝对 + external（FR-004）
 *   - 不生成 `../` 越界链
 *   - Windows 反斜杠 → POSIX（FR-003）
 *   - symbol id 含 `::` / `.` 结构分隔符保留（FR-002）
 *   - 幂等（已相对的输入原样返回）
 */
import { describe, it, expect } from 'vitest';
import {
  relativizePosix,
  relativizeSymbolId,
  isAbsoluteForeignPath,
  isPathContainedUnder,
} from '../../../src/knowledge-graph/relativize.js';

describe('relativizePosix (Feature 193 T010)', () => {
  const root = '/Users/dev/worktree-a';

  it('projectRoot 内绝对路径 → 相对 POSIX', () => {
    const r = relativizePosix(`${root}/src/foo.ts`, root);
    expect(r.value).toBe('src/foo.ts');
    expect(r.external).toBe(false);
  });

  it('projectRoot 外路径（node_modules 同级）→ 保留绝对 + external，不生成 ../', () => {
    const r = relativizePosix('/Users/dev/node_modules/zod/index.ts', root);
    expect(r.external).toBe(true);
    expect(r.value).toBe('/Users/dev/node_modules/zod/index.ts');
    expect(r.value).not.toContain('..');
  });

  it('跨仓绝对引用 → external，保留绝对', () => {
    const r = relativizePosix('/Users/dev/other-repo/lib.ts', root);
    expect(r.external).toBe(true);
    expect(r.value.startsWith('/Users/dev/other-repo')).toBe(true);
    expect(r.value).not.toContain('..');
  });

  it('已相对路径 → 幂等（仅 POSIX 化）', () => {
    expect(relativizePosix('src/foo.ts', root)).toEqual({ value: 'src/foo.ts', external: false });
  });

  it('Windows 反斜杠绝对路径 → POSIX 相对（FR-003）', () => {
    const winRoot = 'C:\\Users\\dev\\wt';
    const r = relativizePosix('C:\\Users\\dev\\wt\\src\\bar.ts', winRoot);
    // 在 POSIX 测试环境下 path.isAbsolute('C:\\...') 为 false，故走幂等分支仅 POSIX 化；
    // 关键不变量：输出不含反斜杠。
    expect(r.value).not.toContain('\\');
  });

  it('absPath === projectRoot → "."', () => {
    expect(relativizePosix(root, root)).toEqual({ value: '.', external: false });
  });

  // Codex implement-C1.2 回归：`..foo` 是合法子目录，不应被误判为越界 external
  it('子目录名以 .. 起始（如 ..foo）→ 正确相对化，非 external', () => {
    const r = relativizePosix(`${root}/..foo/bar.ts`, root);
    expect(r.external).toBe(false);
    expect(r.value).toBe('..foo/bar.ts');
  });

  // 前缀歧义回归：兄弟目录 worktree-ab 不应被判为 worktree-a 的内部
  it('兄弟前缀目录（worktree-a vs worktree-ab）→ external，不误判包含', () => {
    const r = relativizePosix('/Users/dev/worktree-ab/src/x.ts', root);
    expect(r.external).toBe(true);
    expect(r.value).not.toContain('..');
  });
});

describe('isAbsoluteForeignPath / isPathContainedUnder (Codex implement-C1)', () => {
  it('识别 POSIX 绝对 + Windows 盘符（含 drive-relative C:foo）', () => {
    expect(isAbsoluteForeignPath('/abs/x.ts')).toBe(true);
    expect(isAbsoluteForeignPath('C:\\Users\\x.ts')).toBe(true);
    expect(isAbsoluteForeignPath('C:/Users/x.ts')).toBe(true);
    expect(isAbsoluteForeignPath('C:foo.ts')).toBe(true); // drive-relative，win32.isAbsolute 漏判
    expect(isAbsoluteForeignPath('src/foo.ts')).toBe(false);
    expect(isAbsoluteForeignPath('..foo/x.ts')).toBe(false);
  });

  it('段级包含：前缀歧义与 ..foo 同名目录均不误判', () => {
    const root = '/repo/app';
    expect(isPathContainedUnder(root, '/repo/app/src/x.ts')).toBe(true);
    expect(isPathContainedUnder(root, '/repo/app/..foo/x.ts')).toBe(true); // ..foo 合法子目录
    expect(isPathContainedUnder(root, '/repo/app-old/x.ts')).toBe(false); // 前缀歧义
    expect(isPathContainedUnder(root, '/repo/other/x.ts')).toBe(false);
    expect(isPathContainedUnder(root, root)).toBe(true); // 自身
  });
});

describe('relativizeSymbolId (Feature 193 T010)', () => {
  const root = '/Users/dev/worktree-a';

  it('module id（纯路径）相对化', () => {
    expect(relativizeSymbolId(`${root}/src/engine.ts`, root).value).toBe('src/engine.ts');
  });

  it('symbol id `<path>::<name>` 仅相对化路径部分，保留 :: 分隔符（FR-002）', () => {
    const r = relativizeSymbolId(`${root}/src/engine.ts::Value`, root);
    expect(r.value).toBe('src/engine.ts::Value');
    expect(r.external).toBe(false);
  });

  it('member id `<path>::<name>.<member>` 保留 :: 与 . 结构分隔符（FR-002）', () => {
    const r = relativizeSymbolId(`${root}/src/engine.ts::Value.__add__`, root);
    expect(r.value).toBe('src/engine.ts::Value.__add__');
  });

  it('未解析 target（如 `?::name`）非绝对 → 原样保留', () => {
    expect(relativizeSymbolId('?::foo', root).value).toBe('?::foo');
  });

  it('external symbol id（projectRoot 外）→ 保留绝对路径前缀 + external 标记', () => {
    const r = relativizeSymbolId('/Users/dev/node_modules/zod/index.ts::z', root);
    expect(r.external).toBe(true);
    expect(r.value).toBe('/Users/dev/node_modules/zod/index.ts::z');
  });

  it('幂等：已相对的 symbol id 原样保留', () => {
    expect(relativizeSymbolId('src/engine.ts::Value', root).value).toBe('src/engine.ts::Value');
  });
});
