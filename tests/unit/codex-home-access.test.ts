/**
 * Feature 240 / Codex 对抗审查 W2：「无权限/不存在由消费点 fail-loud」的机械守护。
 *
 * W2 原始缺陷：所有消费点都用 `existsSync` / `[[ -d ]]` 表达「可访问」，
 * 而这两者对 `EACCES` 与 `ENOENT` 返回**同一个 false**，于是三处故障被静默压成正常态：
 *   - auth-detector：不可访问的凭据目录 → 报"未登录"（用户重新登录也修不好）
 *   - postinstall：显式设了尚不存在的 CODEX_HOME → 静默只注册 Claude，跳过 Codex
 *   - skill-installer.removeSkills：不可访问的安装目录 → 报"无需清理"（卸载假成功）
 *
 * 本文件守护探测原语本身；三个消费点的行为分别在
 * auth-detector.test.ts / skill-installer.test.ts / spec-driver-codex-skills.test.ts 里断言。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  probeCodexPath,
  isCodexHomeExplicit,
  describeCodexPathProblem,
} from '../../src/core/codex-home-access.js';

describe('probeCodexPath — 区分「不存在」与「不可访问」', () => {
  let tmpRoot: string;
  let realDir: string;
  let realFile: string;
  let noPermDir: string;
  let hiddenChild: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'f240-access-'));
    realDir = join(tmpRoot, 'a-dir');
    realFile = join(tmpRoot, 'a-file');
    mkdirSync(realDir);
    writeFileSync(realFile, 'x', 'utf-8');

    // 权限不足场景：父目录 mode 000 → 对其子路径 stat 得 EACCES
    noPermDir = join(tmpRoot, 'no-perm');
    mkdirSync(noPermDir);
    hiddenChild = join(noPermDir, 'child');
    mkdirSync(hiddenChild);
    chmodSync(noPermDir, 0o000);
  });

  afterAll(() => {
    try {
      chmodSync(noPermDir, 0o755);
    } catch {
      /* 已删除或平台不支持时忽略 */
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('存在的目录 → directory', () => {
    expect(probeCodexPath(realDir)).toEqual({ kind: 'directory' });
  });

  it('存在的普通文件 → file（不是 directory，也不是 missing）', () => {
    expect(probeCodexPath(realFile)).toEqual({ kind: 'file' });
  });

  it('确实不存在的路径 → missing(ENOENT)', () => {
    const probe = probeCodexPath(join(tmpRoot, 'definitely-not-there'));
    expect(probe.kind).toBe('missing');
    expect(probe.kind === 'missing' && probe.code).toBe('ENOENT');
  });

  it('把文件当目录穿透 → missing(ENOTDIR)（同属确定性"不存在"）', () => {
    const probe = probeCodexPath(join(realFile, 'nested'));
    expect(probe.kind).toBe('missing');
    expect(probe.kind === 'missing' && probe.code).toBe('ENOTDIR');
  });

  it('🔴 核心断言：权限不足 → denied 而非 missing（existsSync 在此二者不分）', () => {
    // 前置：root 跑测时 mode 000 拦不住，此时该场景无法构造，跳过而不是假装通过
    if (process.getuid?.() === 0) {
      return;
    }
    const probe = probeCodexPath(hiddenChild);
    expect(probe.kind, `实际: ${JSON.stringify(probe)}`).toBe('denied');
    expect(probe.kind === 'denied' && probe.code).toBe('EACCES');

    // 反向对照：existsSync 对这个"其实存在"的目录返回 false —— 正是 W2 的根因
    expect(existsSync(hiddenChild)).toBe(false);
    // 而 probe 明确区分了二者：denied ≠ missing
    expect(probe.kind).not.toBe('missing');
  });
});

describe('isCodexHomeExplicit — 显式声明 vs 走默认路径', () => {
  it('未设置 → false', () => {
    expect(isCodexHomeExplicit({})).toBe(false);
  });

  it('空串 → false（与 resolveCodexHome 的空串语义一致）', () => {
    expect(isCodexHomeExplicit({ CODEX_HOME: '' })).toBe(false);
  });

  it('非空 → true（此时"目录尚不存在"属正常，不得据此跳过 Codex 处理）', () => {
    expect(isCodexHomeExplicit({ CODEX_HOME: '/tmp/whatever' })).toBe(true);
  });

  it('默认读 process.env', () => {
    const saved = process.env['CODEX_HOME'];
    try {
      process.env['CODEX_HOME'] = '/tmp/f240-explicit';
      expect(isCodexHomeExplicit()).toBe(true);
      delete process.env['CODEX_HOME'];
      expect(isCodexHomeExplicit()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env['CODEX_HOME'];
      else process.env['CODEX_HOME'] = saved;
    }
  });
});

describe('describeCodexPathProblem — 诊断措辞单点收敛', () => {
  it('可访问的路径无诊断（返回 null）', () => {
    expect(describeCodexPathProblem('/x', { kind: 'directory' })).toBeNull();
    expect(describeCodexPathProblem('/x', { kind: 'file' })).toBeNull();
  });

  it('missing 与 denied 的措辞必须可区分，且 denied 明确否认"不存在"', () => {
    const missing = describeCodexPathProblem('/x', { kind: 'missing', code: 'ENOENT' })!;
    const denied = describeCodexPathProblem('/x', {
      kind: 'denied',
      code: 'EACCES',
      message: 'permission denied',
    })!;

    expect(missing).toContain('不存在');
    expect(missing).toContain('ENOENT');
    expect(denied).toContain('权限不足');
    expect(denied).toContain('EACCES');
    // 🔴 反向守卫：denied 的文案必须显式说明它**不等于**不存在，
    // 否则用户读到诊断仍会按"没装/没登录"去处理，W2 等于没修
    expect(denied).toContain('这不等于');
    expect(missing).not.toBe(denied);
  });

  it('其他 errno 归 error，同样给出可诊断信息而非静默', () => {
    const out = describeCodexPathProblem('/x', { kind: 'error', code: 'ELOOP', message: 'loop' })!;
    expect(out).toContain('ELOOP');
  });
});
