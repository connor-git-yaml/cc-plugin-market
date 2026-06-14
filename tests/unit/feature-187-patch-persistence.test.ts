/**
 * Feature 187 — patch 持久化单测（spec FR-003 / SC-012）。
 *
 * persistRunArtifacts：原子写 patch.diff + stdout.log + stderr.log；写盘失败返回 false
 * （调用方据此保留 worktree 现场，不 cleanup）。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { persistRunArtifacts } from '../../scripts/eval-task-runner.mjs';
import { extractDiff } from '../../scripts/eval-judge-jury.mjs';

describe('persistRunArtifacts（FR-003 / SC-012）', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f187-persist-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('原子写 patch.diff + stdout.log + stderr.log，内容字节级一致', () => {
    const patch = 'diff --git a/x b/x\n+fix\n';
    const ok = persistRunArtifacts({ artifactsDir: dir, runId: 'T1__control__r0', patchDiff: patch, stdout: 'OUT', stderr: 'ERR' });
    expect(ok).toBe(true);
    const runDir = path.join(dir, 'T1__control__r0');
    expect(fs.readFileSync(path.join(runDir, 'patch.diff'), 'utf-8')).toBe(patch);
    expect(fs.readFileSync(path.join(runDir, 'stdout.log'), 'utf-8')).toBe('OUT');
    expect(fs.readFileSync(path.join(runDir, 'stderr.log'), 'utf-8')).toBe('ERR');
    // 无残留 .tmp 文件（rename 原子完成）
    expect(fs.readdirSync(runDir).some((f) => f.includes('.tmp.'))).toBe(false);
  });

  it('runId 含非法字符被 sanitize（不越目录）', () => {
    const ok = persistRunArtifacts({ artifactsDir: dir, runId: 'a/../b x', patchDiff: 'd', stdout: '', stderr: '' });
    expect(ok).toBe(true);
    expect(fs.existsSync(path.join(dir, 'a_.._b_x', 'patch.diff'))).toBe(true);
  });

  it('patchDiff=null（FAIL/ERROR run）只写日志，不写 patch.diff', () => {
    const ok = persistRunArtifacts({ artifactsDir: dir, runId: 'r', patchDiff: null, stdout: 'o', stderr: 'e' });
    expect(ok).toBe(true);
    expect(fs.existsSync(path.join(dir, 'r', 'patch.diff'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'r', 'stdout.log'))).toBe(true);
  });

  it('写盘失败（artifactsDir 指向一个文件）→ 返回 false（调用方保留现场）', () => {
    const filePath = path.join(dir, 'not-a-dir');
    fs.writeFileSync(filePath, 'x');
    const ok = persistRunArtifacts({ artifactsDir: filePath, runId: 'r', patchDiff: 'd', stdout: '', stderr: '' });
    expect(ok).toBe(false);
  });
});

describe('jury extractDiff 优先读持久化 patch.diff（FR-003-a / SC-006）', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f187-diff-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('persistedPatchPath 存在 → 读它，不回退 diffStat（PASS run cleanup 后 wtDir 已删）', () => {
    const patchPath = path.join(dir, 'patch.diff');
    fs.writeFileSync(patchPath, 'diff --git a/real b/real\n+candidate fix\n');
    const diff = extractDiff({ wtDir: undefined, fallbackDiffStat: 'STALE diffStat', maxBytes: 30000, persistedPatchPath: patchPath });
    expect(diff).toContain('candidate fix');
    expect(diff).not.toContain('STALE');
  });

  it('persistedPatchPath 不存在 → 回退 diffStat', () => {
    const diff = extractDiff({ wtDir: undefined, fallbackDiffStat: 'FALLBACK', maxBytes: 30000, persistedPatchPath: path.join(dir, 'nope.diff') });
    expect(diff).toContain('FALLBACK');
  });
});
