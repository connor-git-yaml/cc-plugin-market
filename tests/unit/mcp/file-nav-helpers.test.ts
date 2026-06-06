/**
 * Feature 171 — file-nav-helpers 纯函数单测（目标 per-file ≥ 95%）
 *
 * 含 SC-009 路径安全矩阵：../ 逃逸 / 绝对越界 / 根内 symlink 逃逸 / projectRoot 自身 symlink /
 * 前缀碰撞 /repo vs /repo2 / NUL / %2e%2e 字面 / 根内合法 symlink 放行 / 越界且不存在→path-outside-root。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  resolveSafePath,
  splitLines,
  sliceLines,
  estimateUtf8ByteTokens,
  isBinary,
  clampInt,
  isRiskyRegex,
  matchInFile,
  buildDirListing,
  buildFileNavHint,
  DEFAULT_VIEW_WINDOW,
  MAX_PATTERN_LENGTH,
  MAX_REGEX_CONTENT_BYTES,
} from '../../../src/mcp/lib/file-nav-helpers.js';

let root: string;
let outside: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'f171-root-')));
  outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'f171-out-')));
  writeFileSync(path.join(root, 'a.ts'), 'line1\nline2\nline3\n');
  mkdirSync(path.join(root, 'sub'));
  writeFileSync(path.join(root, 'sub', 'b.ts'), 'x\ny\n');
  writeFileSync(path.join(outside, 'secret.txt'), 'TOPSECRET');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('F171 resolveSafePath — 安全矩阵（SC-009）', () => {
  it('根内合法文件 → ok', () => {
    const r = resolveSafePath(root, 'a.ts');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.realPath).toBe(path.join(root, 'a.ts'));
  });

  it('根本身（rel===""）→ ok（contained）', () => {
    const r = resolveSafePath(root, '.');
    expect(r.ok).toBe(true);
  });

  it("../ 逃逸 → path-outside-root", () => {
    const r = resolveSafePath(root, '../../../etc/passwd');
    expect(r).toEqual({ ok: false, code: 'path-outside-root' });
  });

  it('绝对路径越界 → path-outside-root', () => {
    const r = resolveSafePath(root, path.join(outside, 'secret.txt'));
    expect(r).toEqual({ ok: false, code: 'path-outside-root' });
  });

  it('NUL 字节 → invalid-input', () => {
    expect(resolveSafePath(root, 'a\0.ts')).toEqual({ ok: false, code: 'invalid-input' });
  });

  it('空路径 → invalid-input', () => {
    expect(resolveSafePath(root, '')).toEqual({ ok: false, code: 'invalid-input' });
  });

  it('越界且不存在 → path-outside-root（非 file-not-found，FR-013 顺序）', () => {
    const r = resolveSafePath(root, '../nope-does-not-exist');
    expect(r).toEqual({ ok: false, code: 'path-outside-root' });
  });

  it('根内不存在 → file-not-found', () => {
    expect(resolveSafePath(root, 'missing.ts')).toEqual({ ok: false, code: 'file-not-found' });
  });

  it('根内 symlink 指向根外 → path-outside-root（realpath 穿透）', () => {
    symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'evil'));
    const r = resolveSafePath(root, 'evil');
    expect(r).toEqual({ ok: false, code: 'path-outside-root' });
  });

  it('根内合法 symlink（指向根内）→ ok', () => {
    symlinkSync(path.join(root, 'a.ts'), path.join(root, 'good-link'));
    const r = resolveSafePath(root, 'good-link');
    expect(r.ok).toBe(true);
  });

  it('前缀碰撞 /repo vs /repo2 → path-outside-root', () => {
    // root = .../f171-root-XXXX；构造一个 sibling 以 root 名为前缀的目录
    const sibling = `${root}2`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(path.join(sibling, 'x.ts'), 'data');
    try {
      const r = resolveSafePath(root, path.join(sibling, 'x.ts'));
      expect(r).toEqual({ ok: false, code: 'path-outside-root' });
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it('projectRoot 自身是 symlink → 仍正确解析根内文件', () => {
    const linkRoot = path.join(tmpdir(), `f171-linkroot-${path.basename(root)}`);
    symlinkSync(root, linkRoot);
    try {
      const r = resolveSafePath(linkRoot, 'a.ts');
      expect(r.ok).toBe(true);
    } finally {
      rmSync(linkRoot, { force: true });
    }
  });

  it('%2e%2e 字面不解码 → file-not-found（根内不存在该名）', () => {
    const r = resolveSafePath(root, '%2e%2e/secret.txt');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('file-not-found');
  });

  it('projectRoot 不存在 → file-not-found', () => {
    expect(resolveSafePath(path.join(tmpdir(), 'no-such-root-xyz'), 'a.ts')).toEqual({ ok: false, code: 'file-not-found' });
  });

  it('超长 path（> MAX_PATH_LENGTH）→ invalid-input', () => {
    expect(resolveSafePath(root, 'a'.repeat(5000))).toEqual({ ok: false, code: 'invalid-input' });
  });
});

describe('F171 splitLines', () => {
  it('空字符串 → []', () => expect(splitLines('')).toEqual([]));
  it('LF 多行', () => expect(splitLines('a\nb\nc')).toEqual(['a', 'b', 'c']));
  it('末尾换行不计额外空行', () => expect(splitLines('a\nb\n')).toEqual(['a', 'b']));
  it('CRLF 与 LF 一致', () => expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']));
  it('中间空行保留', () => expect(splitLines('a\n\nb')).toEqual(['a', '', 'b']));
});

describe('F171 sliceLines', () => {
  const content = Array.from({ length: 300 }, (_, i) => `L${i + 1}`).join('\n');

  it('指定区间带行号前缀', () => {
    const s = sliceLines(content, { startLine: 10, endLine: 12 });
    expect(s.lines).toEqual(['10\tL10', '11\tL11', '12\tL12']);
    expect(s.totalLines).toBe(300);
    expect(s.truncated).toBe(false);
  });

  it('无定位 → 前 DEFAULT_VIEW_WINDOW 行 + truncated', () => {
    const s = sliceLines(content);
    expect(s.startLine).toBe(1);
    expect(s.endLine).toBe(DEFAULT_VIEW_WINDOW);
    expect(s.truncated).toBe(true);
  });

  it('短文件无定位 → 不 truncated', () => {
    const s = sliceLines('a\nb');
    expect(s.endLine).toBe(2);
    expect(s.truncated).toBe(false);
  });

  it('startLine 超 totalLines → clamp 到末行', () => {
    const s = sliceLines('a\nb\nc', { startLine: 999, endLine: 1000 });
    expect(s.startLine).toBe(3);
    expect(s.endLine).toBe(3);
  });

  it('end<start → end clamp 到 start', () => {
    const s = sliceLines('a\nb\nc', { startLine: 2, endLine: 1 });
    expect(s.startLine).toBe(2);
    expect(s.endLine).toBe(2);
  });

  it('空文件 → totalLines 0', () => {
    expect(sliceLines('')).toEqual({ lines: [], startLine: 0, endLine: 0, totalLines: 0, truncated: false });
  });

  it('仅 startLine 给定 → endLine 默认到末行', () => {
    const s = sliceLines('a\nb\nc', { startLine: 2 });
    expect(s.endLine).toBe(3);
  });

  it('仅 endLine 给定 → startLine 默认 1', () => {
    const s = sliceLines('a\nb\nc', { endLine: 2 });
    expect(s.startLine).toBe(1);
    expect(s.endLine).toBe(2);
  });
});

describe('F171 estimateUtf8ByteTokens / isBinary', () => {
  it('ASCII byte/4', () => expect(estimateUtf8ByteTokens('abcd')).toBe(1));
  it('多字节按 utf-8 字节', () => expect(estimateUtf8ByteTokens('中')).toBe(1)); // 3 bytes → ceil(3/4)=1
  it('isBinary：含 NUL', () => expect(isBinary(Buffer.from([65, 0, 66]))).toBe(true));
  it('isBinary：纯文本 false', () => expect(isBinary(Buffer.from('hello world'))).toBe(false));
});

describe('F171 clampInt', () => {
  it('区间内不变', () => expect(clampInt(5, 1, 10, 3)).toEqual({ value: 5, clamped: false }));
  it('低于 min → min', () => expect(clampInt(-2, 1, 10, 3)).toEqual({ value: 1, clamped: true }));
  it('高于 max → max', () => expect(clampInt(99, 1, 10, 3)).toEqual({ value: 10, clamped: true }));
  it('NaN → fallback', () => expect(clampInt(NaN, 1, 10, 3)).toEqual({ value: 3, clamped: true }));
  it('undefined → fallback', () => expect(clampInt(undefined, 1, 10, 3)).toEqual({ value: 3, clamped: true }));
  it('浮点截断 → clamped', () => expect(clampInt(5.7, 1, 10, 3)).toEqual({ value: 5, clamped: true }));
});

describe('F171 isRiskyRegex', () => {
  it('嵌套量词 (a+)+ → true', () => expect(isRiskyRegex('(a+)+')).toBe(true));
  it('(.*)* → true', () => expect(isRiskyRegex('(.*)*')).toBe(true));
  it('量化交替组 (a|a)+ → true', () => expect(isRiskyRegex('(a|a)+')).toBe(true));
  it('有界重复嵌套 (a{1,99}){1,99} → true', () => expect(isRiskyRegex('(a{1,99}){1,99}')).toBe(true));
  it('普通正则 → false', () => expect(isRiskyRegex('foo\\d+')).toBe(false));
  it('普通分组无量词 → false', () => expect(isRiskyRegex('(foo)bar')).toBe(false));
});

describe('F171 matchInFile', () => {
  const content = 'alpha\nbeta foo\ngamma\nfoo bar\nfoo baz';

  it('literal 命中带上下文行', () => {
    const r = matchInFile(content, 'foo', { contextLines: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totalMatches).toBe(3);
      expect(r.matches[0]).toEqual({ line: 2, text: 'beta foo', before: ['alpha'], after: ['gamma'] });
    }
  });

  it('regex 匹配', () => {
    const r = matchInFile(content, '^foo', { isRegex: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.totalMatches).toBe(2); // 'foo bar' / 'foo baz'
  });

  it('空 pattern → fail', () => expect(matchInFile(content, '').ok).toBe(false));
  it('超长 pattern → fail', () => expect(matchInFile(content, 'a'.repeat(MAX_PATTERN_LENGTH + 1)).ok).toBe(false));
  it('非法正则 → fail', () => expect(matchInFile(content, '(', { isRegex: true }).ok).toBe(false));
  it('高危正则 → fail（ReDoS 启发式）', () => expect(matchInFile(content, '(a+)+', { isRegex: true }).ok).toBe(false));
  it('正则作用内容超字节上界 → fail', () => {
    const huge = 'a\n'.repeat(MAX_REGEX_CONTENT_BYTES); // 约 2×cap 字节
    expect(matchInFile(huge, 'a', { isRegex: true }).ok).toBe(false);
  });
  it('literal 搜索不受内容字节上界限制（无回溯风险）', () => {
    const huge = 'a\n'.repeat(MAX_REGEX_CONTENT_BYTES);
    expect(matchInFile(huge, 'a', { isRegex: false }).ok).toBe(true);
  });

  it('maxMatches clamp + matches-truncated warning', () => {
    const r = matchInFile(content, 'foo', { maxMatches: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.returnedMatches).toBe(1);
      expect(r.totalMatches).toBe(3);
      expect(r.warnings).toContain('matches-truncated');
    }
  });

  it('maxMatches 越界 → clamp + maxMatches-clamped', () => {
    const r = matchInFile(content, 'foo', { maxMatches: 99999 });
    if (r.ok) expect(r.warnings).toContain('maxMatches-clamped');
  });

  it('contextLines 越界 → clamp', () => {
    const r = matchInFile(content, 'foo', { contextLines: 999 });
    if (r.ok) expect(r.warnings).toContain('contextLines-clamped');
  });

  it('literal 含元字符按字面匹配（escape）', () => {
    const r = matchInFile('a.b\naxb', 'a.b');
    if (r.ok) expect(r.totalMatches).toBe(1); // 仅字面 'a.b'，不匹配 'axb'
  });
});

describe('F171 buildDirListing', () => {
  it('列出条目含 type/size，默认过滤 .git', () => {
    mkdirSync(path.join(root, '.git'));
    const { entries } = buildDirListing(root, { depth: 1 });
    const names = entries.map((e) => e.name);
    expect(names).toContain('a.ts');
    expect(names).toContain('sub');
    expect(names).not.toContain('.git');
    const file = entries.find((e) => e.name === 'a.ts')!;
    expect(file.type).toBe('file');
    expect(typeof file.size).toBe('number');
    const dir = entries.find((e) => e.name === 'sub')!;
    expect(dir.type).toBe('dir');
    expect(dir.size).toBeNull();
  });

  it('includeIgnored=true → 含 .git', () => {
    mkdirSync(path.join(root, '.git'));
    const { entries } = buildDirListing(root, { includeIgnored: true });
    expect(entries.map((e) => e.name)).toContain('.git');
  });

  it('depth 递归', () => {
    const { entries } = buildDirListing(root, { depth: 2 });
    expect(entries.map((e) => e.name)).toContain('sub/b.ts');
  });

  it('depth=1 不递归子目录内容', () => {
    const { entries } = buildDirListing(root, { depth: 1 });
    expect(entries.map((e) => e.name)).not.toContain('sub/b.ts');
  });

  it('depth 越界 → clamp + depth-clamped warning', () => {
    const { warnings } = buildDirListing(root, { depth: 999 });
    expect(warnings).toContain('depth-clamped');
  });

  it('symlink 条目 type=symlink', () => {
    symlinkSync(path.join(root, 'a.ts'), path.join(root, 'lnk'));
    const { entries } = buildDirListing(root);
    expect(entries.find((e) => e.name === 'lnk')!.type).toBe('symlink');
  });

  it('maxEntries 截断 → listing-truncated', () => {
    const { entries, warnings } = buildDirListing(root, { maxEntries: 1 });
    expect(entries.length).toBe(1);
    expect(warnings).toContain('listing-truncated');
  });

  it('不可读/不存在目录 → 空 entries（静默）', () => {
    expect(buildDirListing(path.join(root, 'no-such')).entries).toEqual([]);
  });
});

describe('F171 buildFileNavHint', () => {
  it('view_file 非截断 → 引导 context', () => {
    const h = buildFileNavHint('view_file', { startLine: 1, endLine: 10, totalLines: 10, truncated: false });
    expect(h).toContain('context');
  });
  it('view_file 截断 → 提示翻页', () => {
    const h = buildFileNavHint('view_file', { endLine: 200, totalLines: 999, truncated: true });
    expect(h).toContain('截断');
  });
  it('search_in_file 有命中 → 引导 view_file', () => {
    expect(buildFileNavHint('search_in_file', { totalMatches: 3 })).toContain('view_file');
  });
  it('search_in_file 无命中 → 提示放宽', () => {
    expect(buildFileNavHint('search_in_file', { totalMatches: 0 })).toContain('未找到');
  });
  it('list_directory → 引导 view_file', () => {
    expect(buildFileNavHint('list_directory', { entryCount: 5 })).toContain('view_file');
  });
  it('缺字段时各 hint 用默认值不崩溃（?? 0 分支）', () => {
    expect(buildFileNavHint('view_file', {})).toContain('行');
    expect(buildFileNavHint('search_in_file', {})).toContain('未找到');
    expect(buildFileNavHint('list_directory', {})).toContain('0 项');
  });
});
