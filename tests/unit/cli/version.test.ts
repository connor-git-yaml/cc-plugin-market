/**
 * F186 T3 — `spectra --version` build 元数据后缀
 *
 * 验证 resolveVersionString：
 *   - 存在 build-meta 含 commit → 输出 `spectra v<ver> (<commit7>)`（7 位 hash 括号后缀）
 *   - 缺 build-meta 文件 → 优雅降级输出纯版本号 `spectra v<ver>`
 *   - build-meta 损坏（非法 JSON / 缺 commit / commit 过短）→ 同样降级
 *
 * 用临时文件验证，不污染 dist/。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveVersionString } from '../../../src/cli/version-meta.js';

describe('F186 T3 — resolveVersionString build 元数据后缀', () => {
  let tmpDir: string;
  let metaPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'spectra-version-'));
    metaPath = join(tmpDir, '.spectra-build-meta.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('有 commit → 含 7 位 hash 括号后缀', () => {
    writeFileSync(metaPath, JSON.stringify({ commit: 'abc1234deadbeef', dirty: false }), 'utf-8');
    expect(resolveVersionString(metaPath, '4.3.0')).toBe('spectra v4.3.0 (abc1234)');
  });

  it('缺 build-meta 文件 → 优雅降级为纯版本号', () => {
    // metaPath 未写入 → readFileSync 抛 ENOENT，被捕获后降级
    expect(resolveVersionString(metaPath, '4.3.0')).toBe('spectra v4.3.0');
  });

  it('非法 JSON → 降级为纯版本号', () => {
    writeFileSync(metaPath, '{ not json', 'utf-8');
    expect(resolveVersionString(metaPath, '4.3.0')).toBe('spectra v4.3.0');
  });

  it('缺 commit 字段 → 降级为纯版本号', () => {
    writeFileSync(metaPath, JSON.stringify({ dirty: false }), 'utf-8');
    expect(resolveVersionString(metaPath, '4.3.0')).toBe('spectra v4.3.0');
  });

  it('commit 过短（<7 位）→ 降级为纯版本号', () => {
    writeFileSync(metaPath, JSON.stringify({ commit: 'abc12' }), 'utf-8');
    expect(resolveVersionString(metaPath, '4.3.0')).toBe('spectra v4.3.0');
  });
});
