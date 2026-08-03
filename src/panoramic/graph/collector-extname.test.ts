/**
 * collector-extname 单测（F248 T002）
 *
 * 锚定 `extractExtension` 的全部语义边界，防止未来"顺手优化"为 `path.extname`
 * 静默改变行为。用例 2/3/4/9/10 直接对应 fix-report 的「手写实现与 path.extname
 * 的语义差异」表，其中 dotfile / 目录段含点两条同时断言 `path.extname` 的不同
 * 结果，形成对照——若有人把实现换成 `path.extname`，这两条会立刻变红。
 * 用例 11 锚定唯一会改变调用方分支的分歧点（纯 dotfile `'.ts'`，Codex W2）。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { extractExtension } from './collector-extname.js';

describe('extractExtension', () => {
  it('用例 1：普通扩展名返回含点后缀', () => {
    expect(extractExtension('foo.ts')).toBe('.ts');
  });

  it('用例 2：保留原始大小写，不做归一化', () => {
    expect(extractExtension('a.TS')).toBe('.TS');
  });

  it('用例 3：dotfile 整串命中（不做 dotfile 特判，与 path.extname 对照）', () => {
    expect(extractExtension('.gitignore')).toBe('.gitignore');
    // 对照：path.extname 的 dotfile 特判返回空串，语义不等价
    expect(path.extname('.gitignore')).toBe('');
  });

  it('用例 4：目录段含点也命中（全字符串搜索，与仅看 basename 的 path.extname 对照）', () => {
    expect(extractExtension('src.v2/Makefile')).toBe('.v2/Makefile');
    // 对照：path.extname 只看 basename('Makefile')，返回空串
    expect(path.extname('src.v2/Makefile')).toBe('');
  });

  it('用例 5：多个点时取最后一个', () => {
    expect(extractExtension('archive.tar.gz')).toBe('.gz');
  });

  it('用例 6：尾点返回单个点', () => {
    expect(extractExtension('file.')).toBe('.');
  });

  it('用例 7：无点返回空字符串', () => {
    expect(extractExtension('Makefile')).toBe('');
  });

  it('用例 8：空字符串输入返回空字符串', () => {
    expect(extractExtension('')).toBe('');
  });

  it('用例 9：真实相对路径场景取末段扩展名', () => {
    expect(extractExtension('src/panoramic/graph/source-commit.ts')).toBe('.ts');
  });

  it('用例 10：白名单 Set.has() 严格区分大小写（FIX-4 合同：怪值不命中即走兜底）', () => {
    const whitelist = new Set(['.ts']);
    expect(whitelist.has(extractExtension('a.TS'))).toBe(false);
    expect(whitelist.has(extractExtension('a.ts'))).toBe(true);
    // dotfile / 目录段含点同样不命中白名单 → 调用方走安全兜底分支
    expect(whitelist.has(extractExtension('.gitignore'))).toBe(false);
    expect(whitelist.has(extractExtension('src.v2/Makefile'))).toBe(false);
  });

  it('用例 11：纯 dotfile 文件名 ".ts" 是与 path.extname 唯一的分支分歧点（Codex W2）', () => {
    // 生产者 walkTsJsFiles 对文件不做 dotfile 跳过，'.ts'.endsWith('.ts') 为 true 会正常采集；
    // 本函数返回 '.ts' 命中 TSJS 白名单与之对齐，而 path.extname 的 dotfile 特判返回 ''
    // 走兜底——换用 path.extname 会静默丢失这类文件的 dirty 判定 / ignore 分派
    const whitelist = new Set(['.ts']);
    expect(extractExtension('.ts')).toBe('.ts');
    expect(whitelist.has(extractExtension('.ts'))).toBe(true);
    expect(path.extname('.ts')).toBe('');
    expect(whitelist.has(path.extname('.ts'))).toBe(false);
  });
});
