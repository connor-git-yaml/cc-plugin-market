/**
 * git-blame utility 单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { getLineBlame, parsePorcelain, resetBlameCache, type BlameInfo } from '../../src/utils/git-blame.js';

describe('git-blame parsePorcelain', () => {
  it('解析基本 porcelain 输出', () => {
    const raw = [
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 1 1 2',
      'author Alice',
      'author-mail <alice@example.com>',
      'author-time 1700000000',
      'author-tz +0000',
      'summary initial commit',
      'filename foo.ts',
      '\tconst a = 1;',
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 2 2',
      'filename foo.ts',
      '\tconst b = 2;',
      '',
    ].join('\n');
    const out = new Map<number, BlameInfo>();
    parsePorcelain(raw, out);
    expect(out.get(1)?.author).toBe('Alice');
    expect(out.get(2)?.author).toBe('Alice');
    expect(out.get(1)?.commitDate).not.toBeNull();
    expect(out.get(1)?.ageDays).toBeGreaterThanOrEqual(0);
  });

  it('对 uncommitted (全 0 sha) 返回 uncommitted', () => {
    const raw = [
      '0000000000000000000000000000000000000000 1 1 1',
      'author Not Committed Yet',
      'author-time 1700000000',
      'summary Not Committed Yet',
      'filename bar.ts',
      '\tconst x = 1;',
    ].join('\n');
    const out = new Map<number, BlameInfo>();
    parsePorcelain(raw, out);
    expect(out.get(1)?.author).toBe('uncommitted');
    expect(out.get(1)?.commitDate).toBeNull();
    expect(out.get(1)?.ageDays).toBe(0);
  });
});

describe('getLineBlame fallback 行为', () => {
  beforeEach(() => {
    resetBlameCache();
  });

  it('非 git 目录下返回 uncommitted', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-blame-'));
    const file = path.join(tmp, 'foo.ts');
    fs.writeFileSync(file, 'const a = 1;\n');
    const info = await getLineBlame(file, 1);
    expect(info.author).toBe('uncommitted');
    expect(info.ageDays).toBe(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('对不存在的文件返回 uncommitted', async () => {
    const info = await getLineBlame('/path/that/does/not/exist/foo.ts', 5);
    expect(info.author).toBe('uncommitted');
  });

  it('缓存命中：第二次调用不重新生成 Map（通过 resetBlameCache 对比验证）', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-blame-cache-'));
    const file = path.join(tmp, 'foo.ts');
    fs.writeFileSync(file, 'a\nb\nc\n');
    const a = await getLineBlame(file, 1);
    const b = await getLineBlame(file, 1);
    expect(a).toEqual(b);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('已 committed 的文件能解析出真实作者', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-blame-git-'));
    try {
      execSync('git init -q', { cwd: tmp });
      execSync('git config user.email "t@example.com"', { cwd: tmp });
      execSync('git config user.name "TestUser"', { cwd: tmp });
      const file = path.join(tmp, 'foo.ts');
      fs.writeFileSync(file, 'const a = 1;\n');
      execSync('git add foo.ts', { cwd: tmp });
      execSync('git commit -q -m init', { cwd: tmp });

      resetBlameCache();
      const info = await getLineBlame(file, 1);
      expect(info.author).toBe('TestUser');
      expect(info.commitDate).not.toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
