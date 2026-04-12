/**
 * git-hook-installer.ts 单元测试
 * 使用 mkdtempSync 构建含 .git 结构的临时目录，beforeEach/afterEach 清理，不 mock 模块
 * 覆盖：post-commit 追加/幂等/卸载/权限/错误处理
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  installGitHook,
  removeGitHook,
  generatePostCommitSegment,
} from '../../src/hooks/git-hook-installer.js';

/** 创建含真实 .git/hooks/ 结构的临时目录 */
function makeTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-git-test-'));
  fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
  return dir;
}

/** 创建不含 .git/ 的普通临时目录 */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-nongit-test-'));
}

/** 读取 post-commit 文件内容 */
function readPostCommit(dir: string): string {
  return fs.readFileSync(path.join(dir, '.git', 'hooks', 'post-commit'), 'utf-8');
}

describe('git-hook-installer', () => {
  let tmpDir: string;

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── generatePostCommitSegment 测试 ───────────────────────────────────────

  describe('generatePostCommitSegment()', () => {
    beforeEach(() => {
      tmpDir = makeTempGitRepo();
    });

    it('输出包含 # --- spectra begin ---', () => {
      const segment = generatePostCommitSegment();
      expect(segment).toContain('# --- spectra begin ---');
    });

    it('输出包含 # --- spectra end ---', () => {
      const segment = generatePostCommitSegment();
      expect(segment).toContain('# --- spectra end ---');
    });

    it('包含 spectra graph 后台运行 + 超时保护（FR-010）', () => {
      const segment = generatePostCommitSegment();
      expect(segment).toContain('spectra graph');
      expect(segment).toContain('> /dev/null 2>&1 &');
      // 超时保护：kill 防止僵尸进程
      expect(segment).toContain('kill');
    });

    it('包含文档提示 echo（FR-010）', () => {
      const segment = generatePostCommitSegment();
      expect(segment).toContain("[spectra] Docs changed");
    });
  });

  // ─── installGitHook 测试 ──────────────────────────────────────────────────

  describe('installGitHook()', () => {
    it('.git/ 目录不存在时抛出含 .git directory not found 的错误（FR-013）', () => {
      tmpDir = makeTempDir();
      expect(() => installGitHook(tmpDir)).toThrow('.git directory not found');
    });

    it('post-commit 不存在时创建带 #!/bin/sh 头部的可执行文件（FR-009）', () => {
      tmpDir = makeTempGitRepo();
      const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-commit');
      expect(fs.existsSync(hookPath)).toBe(false);

      installGitHook(tmpDir);

      expect(fs.existsSync(hookPath)).toBe(true);
      const content = readPostCommit(tmpDir);
      expect(content).toContain('#!/bin/sh');
    });

    it('已存在非 spectra 内容时追加，原内容完整保留（FR-009）', () => {
      tmpDir = makeTempGitRepo();
      const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-commit');
      const existingContent = '#!/bin/sh\necho "other hook"\n';
      fs.writeFileSync(hookPath, existingContent, 'utf-8');
      fs.chmodSync(hookPath, 0o755);

      installGitHook(tmpDir);

      const content = readPostCommit(tmpDir);
      // 原内容保留
      expect(content).toContain('echo "other hook"');
      // spectra 段落追加
      expect(content).toContain('# --- spectra begin ---');
    });

    it('幂等：标记已存在时跳过，不重复追加（FR-009）', () => {
      tmpDir = makeTempGitRepo();
      installGitHook(tmpDir);
      installGitHook(tmpDir);

      const content = readPostCommit(tmpDir);
      // 只有一个 spectra begin 标记
      const count = (content.match(/# --- spectra begin ---/g) ?? []).length;
      expect(count).toBe(1);
    });

    it('安装后文件具有可执行权限', () => {
      tmpDir = makeTempGitRepo();
      installGitHook(tmpDir);

      const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-commit');
      const stat = fs.statSync(hookPath);
      expect(stat.mode & 0o111).toBeGreaterThan(0);
    });
  });

  // ─── removeGitHook 测试 ───────────────────────────────────────────────────

  describe('removeGitHook()', () => {
    it('精确删除标记段落，非 spectra 内容完整保留（FR-012）', () => {
      tmpDir = makeTempGitRepo();
      const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-commit');
      const otherContent = '#!/bin/sh\necho "other"\n';
      fs.writeFileSync(hookPath, otherContent, 'utf-8');
      fs.chmodSync(hookPath, 0o755);

      installGitHook(tmpDir);
      removeGitHook(tmpDir);

      const content = readPostCommit(tmpDir);
      // spectra 段落已删除
      expect(content).not.toContain('# --- spectra begin ---');
      expect(content).not.toContain('# --- spectra end ---');
      expect(content).not.toContain('nohup spectra graph');
      // 其他内容保留
      expect(content).toContain('echo "other"');
    });

    it('removeGitHook 后文件保持可执行权限（FR-012）', () => {
      tmpDir = makeTempGitRepo();
      installGitHook(tmpDir);
      removeGitHook(tmpDir);

      const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-commit');
      const stat = fs.statSync(hookPath);
      expect(stat.mode & 0o111).toBeGreaterThan(0);
    });

    it('post-commit 不存在时静默退出（FR-012）', () => {
      tmpDir = makeTempGitRepo();
      // 不安装直接卸载
      expect(() => removeGitHook(tmpDir)).not.toThrow();
    });

    it('post-commit 存在但无 spectra 标记时静默退出（FR-012）', () => {
      tmpDir = makeTempGitRepo();
      const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-commit');
      fs.writeFileSync(hookPath, '#!/bin/sh\necho "no spectra"\n', 'utf-8');

      expect(() => removeGitHook(tmpDir)).not.toThrow();
      // 原内容未改变
      const content = readPostCommit(tmpDir);
      expect(content).toContain('echo "no spectra"');
    });
  });
});
