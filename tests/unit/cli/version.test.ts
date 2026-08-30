/**
 * F186 T3 — `spectra --version` build 元数据后缀
 *
 * 验证 resolveVersionString：
 *   - 存在 build-meta 含 commit → 输出 `spectra v<ver> (<commit7>)`（7 位 hash 括号后缀）
 *   - 缺 build-meta 文件 → 优雅降级输出纯版本号 `spectra v<ver>`
 *   - build-meta 损坏（非法 JSON / 缺 commit / commit 过短）→ 同样降级
 *
 * F265 追加 resolveBuildInfo（MCP `server_build_info` 的事实源）：
 *   - 有盖章 → { version, commit(全长), dirty }
 *   - 缺 / 损坏 / 字段类型不符 → commit、dirty 均为 `null`（**不是省略键**）
 *
 * 用临时文件验证，不污染 dist/。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBuildInfo, resolveVersionString } from '../../../src/cli/version-meta.js';

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

describe('F265 G0-3 — resolveBuildInfo 结构化自省（MCP server_build_info 的事实源）', () => {
  let tmpDir: string;
  let metaPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'spectra-buildinfo-'));
    metaPath = join(tmpDir, '.spectra-build-meta.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('有盖章 → commit 回传全长（不截断）、dirty 原样', () => {
    const commit = 'ee6e8314da4a591128d7bbfea1b28d4248ee8ab8';
    writeFileSync(metaPath, JSON.stringify({ commit, dirty: true }), 'utf-8');
    expect(resolveBuildInfo(metaPath, '4.5.0')).toEqual({ version: '4.5.0', commit, dirty: true });
  });

  /**
   * 🔴 缺 meta 是**正常场景**（clean checkout / tsx 直跑源码 / npm 包未盖章），
   * 不是异常：MCP server 必须照常起得来，自省字段诚实地回 null 即可。
   */
  it('缺 build-meta → commit/dirty 为 null，且键必须存在（消费方只判空值）', () => {
    const info = resolveBuildInfo(metaPath, '4.5.0');
    expect(info).toEqual({ version: '4.5.0', commit: null, dirty: null });
    expect(Object.keys(info).sort()).toEqual(['commit', 'dirty', 'version']);
  });

  it('非法 JSON / commit 过短 / 字段类型不符 → 各自降级为 null，不抛错', () => {
    writeFileSync(metaPath, '{ not json', 'utf-8');
    expect(resolveBuildInfo(metaPath, '4.5.0')).toEqual({ version: '4.5.0', commit: null, dirty: null });

    writeFileSync(metaPath, JSON.stringify({ commit: 'abc12', dirty: false }), 'utf-8');
    expect(resolveBuildInfo(metaPath, '4.5.0')).toEqual({ version: '4.5.0', commit: null, dirty: false });

    // dirty 不是布尔 ⇒ null（而非强转 truthy —— "不知道"和"false"是两回事）
    writeFileSync(metaPath, JSON.stringify({ commit: 'abc1234def', dirty: 'yes' }), 'utf-8');
    expect(resolveBuildInfo(metaPath, '4.5.0')).toEqual({
      version: '4.5.0',
      commit: 'abc1234def',
      dirty: null,
    });
  });

  it('目录而非文件（EISDIR）也走降级，不抛错', () => {
    expect(resolveBuildInfo(tmpDir, '4.5.0')).toEqual({ version: '4.5.0', commit: null, dirty: null });
  });
});
