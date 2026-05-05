/**
 * sync-worktree-local-state.sh 单元测试
 *
 * 测试 worktree 本地态同步脚本的关键行为（2026-05-05 扩展 + Codex 修订）：
 * - SYMLINK_TARGETS：CLAUDE.local.md / .agents / _reference / settings.local.json 等
 *   应通过软链同步（修改实时反映到所有 worktree）
 * - COPY_TARGETS：.env.local 应通过 copy 同步（含 secret，避免写穿污染父仓库）
 * - 跳过路径：source 不存在时不抛错（如 .claude/scheduled_tasks.lock 在父仓库可能不存在）
 * - 主工作区跳过：在父仓库根目录跑脚本应 no-op
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/sync-worktree-local-state.sh');

interface TestRepo {
  primaryDir: string;
  worktreeDir: string;
  cleanup: () => void;
}

function setupRepo(): TestRepo {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-worktree-test-'));
  const primaryDir = path.join(tempDir, 'primary');
  const worktreeDir = path.join(tempDir, 'worktrees', 'feature-x');

  // 在 primaryDir 初始化 git repo + 一个空 commit（满足 git rev-parse 要求）
  fs.mkdirSync(primaryDir, { recursive: true });
  execSync('git init -q', { cwd: primaryDir });
  execSync('git config user.email test@example.com', { cwd: primaryDir });
  execSync('git config user.name Test', { cwd: primaryDir });
  execSync('git commit -q --allow-empty -m init', { cwd: primaryDir });

  // 添加 worktree
  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
  execSync(`git worktree add -q -b feature-x "${worktreeDir}"`, { cwd: primaryDir });

  return {
    primaryDir,
    worktreeDir,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
}

function runSync(cwd: string): { stdout: string; stderr: string; status: number } {
  const r = spawnSync('bash', [SCRIPT_PATH, '--quiet'], { cwd, encoding: 'utf-8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 0 };
}

function runSyncVerbose(cwd: string): { stdout: string; stderr: string; status: number } {
  const r = spawnSync('bash', [SCRIPT_PATH], { cwd, encoding: 'utf-8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 0 };
}

describe('sync-worktree-local-state.sh', () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = setupRepo();
  });

  afterEach(() => {
    repo.cleanup();
  });

  describe('SYMLINK_TARGETS', () => {
    it('CLAUDE.local.md 应软链到父仓库', () => {
      const sourceFile = path.join(repo.primaryDir, 'CLAUDE.local.md');
      fs.writeFileSync(sourceFile, '# 本地开发约定\ntest content');

      const r = runSync(repo.worktreeDir);
      expect(r.status).toBe(0);

      const targetFile = path.join(repo.worktreeDir, 'CLAUDE.local.md');
      const stat = fs.lstatSync(targetFile);
      expect(stat.isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(targetFile, 'utf-8')).toBe('# 本地开发约定\ntest content');
    });

    it('.agents 目录应软链到父仓库', () => {
      const sourceDir = path.join(repo.primaryDir, '.agents');
      fs.mkdirSync(sourceDir);
      fs.writeFileSync(path.join(sourceDir, 'config.json'), '{}');

      const r = runSync(repo.worktreeDir);
      expect(r.status).toBe(0);

      const targetDir = path.join(repo.worktreeDir, '.agents');
      const stat = fs.lstatSync(targetDir);
      expect(stat.isSymbolicLink()).toBe(true);
    });

    it('已存在的相同软链 idempotent 不重复创建', () => {
      const sourceFile = path.join(repo.primaryDir, 'CLAUDE.local.md');
      fs.writeFileSync(sourceFile, 'first');

      runSync(repo.worktreeDir); // 第 1 次
      const r2 = runSync(repo.worktreeDir); // 第 2 次（应 idempotent）
      expect(r2.status).toBe(0);

      const targetFile = path.join(repo.worktreeDir, 'CLAUDE.local.md');
      expect(fs.lstatSync(targetFile).isSymbolicLink()).toBe(true);
    });
  });

  describe('COPY_TARGETS (Codex CRITICAL 修订: .env.local 用 copy 不用软链)', () => {
    it('.env.local 应从父仓库 copy 到 worktree (非软链)', () => {
      const sourceFile = path.join(repo.primaryDir, '.env.local');
      fs.writeFileSync(sourceFile, 'export SILICONFLOW_API_KEY=sk-test\n');

      const r = runSync(repo.worktreeDir);
      expect(r.status).toBe(0);

      const targetFile = path.join(repo.worktreeDir, '.env.local');
      const stat = fs.lstatSync(targetFile);
      expect(stat.isSymbolicLink()).toBe(false); // 不是软链
      expect(stat.isFile()).toBe(true); // 是真实文件
      expect(fs.readFileSync(targetFile, 'utf-8')).toBe('export SILICONFLOW_API_KEY=sk-test\n');
    });

    it('worktree 修改 .env.local 应不影响父仓库（避免写穿污染）', () => {
      const sourceFile = path.join(repo.primaryDir, '.env.local');
      fs.writeFileSync(sourceFile, 'KEY=parent\n');

      runSync(repo.worktreeDir);

      const targetFile = path.join(repo.worktreeDir, '.env.local');
      // worktree 里写新内容
      fs.writeFileSync(targetFile, 'KEY=worktree-modified\n');

      // 父仓库不应被影响
      expect(fs.readFileSync(sourceFile, 'utf-8')).toBe('KEY=parent\n');
      expect(fs.readFileSync(targetFile, 'utf-8')).toBe('KEY=worktree-modified\n');
    });

    it('遗留的 .env.local 软链应被替换为 copy (迁移路径)', () => {
      const sourceFile = path.join(repo.primaryDir, '.env.local');
      fs.writeFileSync(sourceFile, 'KEY=value\n');

      const targetFile = path.join(repo.worktreeDir, '.env.local');
      // 模拟旧脚本留下的软链
      fs.symlinkSync(sourceFile, targetFile);
      expect(fs.lstatSync(targetFile).isSymbolicLink()).toBe(true);

      runSync(repo.worktreeDir);

      // 新脚本应把软链转为 copy
      expect(fs.lstatSync(targetFile).isSymbolicLink()).toBe(false);
      expect(fs.lstatSync(targetFile).isFile()).toBe(true);
    });
  });

  describe('source 不存在时跳过', () => {
    it('父仓库无 CLAUDE.local.md 时不抛错', () => {
      // 父仓库不写 CLAUDE.local.md
      const r = runSync(repo.worktreeDir);
      expect(r.status).toBe(0);
      const targetFile = path.join(repo.worktreeDir, 'CLAUDE.local.md');
      expect(fs.existsSync(targetFile)).toBe(false);
    });

    it('父仓库无 .env.local 时不抛错', () => {
      const r = runSync(repo.worktreeDir);
      expect(r.status).toBe(0);
      const targetFile = path.join(repo.worktreeDir, '.env.local');
      expect(fs.existsSync(targetFile)).toBe(false);
    });
  });

  describe('在主工作区跑脚本应 no-op', () => {
    it('在父仓库根目录跑应直接退出不创建任何软链', () => {
      const sourceFile = path.join(repo.primaryDir, 'CLAUDE.local.md');
      fs.writeFileSync(sourceFile, 'test');

      const r = runSyncVerbose(repo.primaryDir);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/主工作区|primary/);
    });
  });

  describe('Codex WARNING #1: scheduled_tasks.lock 不在同步列表', () => {
    it('父仓库有 scheduled_tasks.lock 时 worktree 不创建软链/copy', () => {
      const sourceLock = path.join(repo.primaryDir, '.claude', 'scheduled_tasks.lock');
      fs.mkdirSync(path.dirname(sourceLock), { recursive: true });
      fs.writeFileSync(sourceLock, 'lock-content');

      const r = runSync(repo.worktreeDir);
      expect(r.status).toBe(0);

      const targetLock = path.join(repo.worktreeDir, '.claude', 'scheduled_tasks.lock');
      // scheduled_tasks.lock 不应被同步（per-worktree 独立）
      expect(fs.existsSync(targetLock)).toBe(false);
    });
  });
});
