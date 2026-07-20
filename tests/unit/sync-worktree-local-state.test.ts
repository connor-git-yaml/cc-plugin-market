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

    it('.agents/skills 子目录应软链到父仓库（.agents/plugins 保留为 tracked 真实目录，Feature 213 收窄）', () => {
      // Feature 213：SYMLINK_TARGETS 由整目录 `.agents` 收窄为子目录 `.agents/skills`，
      // 让 tracked 的 `.agents/plugins/marketplace.json` 在 worktree 内为真实目录而非 symlink 穿透。
      const sourceDir = path.join(repo.primaryDir, '.agents', 'skills');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'config.json'), '{}');

      const r = runSync(repo.worktreeDir);
      expect(r.status).toBe(0);

      const targetDir = path.join(repo.worktreeDir, '.agents', 'skills');
      const stat = fs.lstatSync(targetDir);
      expect(stat.isSymbolicLink()).toBe(true);
    });

    // Feature 213 CRITICAL：旧 worktree 整目录 .agents 软链迁移守护
    it('(a) 旧整目录 .agents 软链 + 主仓 .agents/skills 非空 → 迁移为真实 .agents + skills 子链，主仓逐字节不变', () => {
      const primaryAgents = path.join(repo.primaryDir, '.agents');
      const primarySkills = path.join(primaryAgents, 'skills');
      fs.mkdirSync(primarySkills, { recursive: true });
      fs.writeFileSync(path.join(primarySkills, 'gen.md'), 'PRIMARY-CONTENT');
      // 模拟旧 worktree：.agents 为指向主仓的整目录软链
      const wtAgents = path.join(repo.worktreeDir, '.agents');
      fs.symlinkSync(primaryAgents, wtAgents);
      expect(fs.lstatSync(wtAgents).isSymbolicLink()).toBe(true);

      const r = runSyncVerbose(repo.worktreeDir);
      expect(r.status).toBe(0);

      // worktree .agents 迁移为真实目录，skills 为子链
      expect(fs.lstatSync(wtAgents).isSymbolicLink()).toBe(false);
      expect(fs.statSync(wtAgents).isDirectory()).toBe(true);
      expect(fs.lstatSync(path.join(wtAgents, 'skills')).isSymbolicLink()).toBe(true);
      // 主仓内容逐字节不变，主仓 .agents 仍是真实目录（未被链接/删除）
      expect(fs.readFileSync(path.join(primarySkills, 'gen.md'), 'utf-8')).toBe('PRIMARY-CONTENT');
      expect(fs.lstatSync(primaryAgents).isSymbolicLink()).toBe(false);
    });

    it('(b) 旧整目录 .agents 软链 + 主仓 .agents 仅隐藏内容 → 主仓 .agents/skills 未被沿链删除', () => {
      const primaryAgents = path.join(repo.primaryDir, '.agents');
      const primarySkills = path.join(primaryAgents, 'skills');
      fs.mkdirSync(primarySkills, { recursive: true });
      // 仅隐藏文件（触发旧脚本 entry_count==0 的 rm -rf 危险分支）
      fs.writeFileSync(path.join(primarySkills, '.keep'), '');
      const wtAgents = path.join(repo.worktreeDir, '.agents');
      fs.symlinkSync(primaryAgents, wtAgents);

      const r = runSyncVerbose(repo.worktreeDir);
      expect(r.status).toBe(0);

      // 主仓 .agents/skills 与其隐藏文件仍存在（未被 rm -rf 沿链删除）
      expect(fs.existsSync(primarySkills)).toBe(true);
      expect(fs.existsSync(path.join(primarySkills, '.keep'))).toBe(true);
      expect(fs.lstatSync(path.join(repo.worktreeDir, '.agents')).isSymbolicLink()).toBe(false);
    });

    it('(c) worktree 已有真实 .agents/plugins/marketplace.json → 重跑脚本原样保留', () => {
      // 模拟已迁移 worktree：真实 .agents/plugins/marketplace.json（tracked 内容）
      const wtMarketplace = path.join(
        repo.worktreeDir,
        '.agents',
        'plugins',
        'marketplace.json',
      );
      fs.mkdirSync(path.dirname(wtMarketplace), { recursive: true });
      fs.writeFileSync(wtMarketplace, '{"name":"cc-plugin-market"}');
      // 主仓有 .agents/skills 供子链
      fs.mkdirSync(path.join(repo.primaryDir, '.agents', 'skills'), { recursive: true });

      const r = runSync(repo.worktreeDir);
      expect(r.status).toBe(0);

      // marketplace.json 原样保留（真实文件，内容不变）
      expect(fs.lstatSync(wtMarketplace).isFile()).toBe(true);
      expect(fs.readFileSync(wtMarketplace, 'utf-8')).toBe('{"name":"cc-plugin-market"}');
      // skills 建为子链，plugins 保持真实目录
      expect(
        fs.lstatSync(path.join(repo.worktreeDir, '.agents', 'skills')).isSymbolicLink(),
      ).toBe(true);
      expect(
        fs.lstatSync(path.join(repo.worktreeDir, '.agents', 'plugins')).isSymbolicLink(),
      ).toBe(false);
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

  describe('graph bootstrap (Feature 193 🅑)', () => {
    const GRAPH_REL = 'specs/_meta/graph.json';
    const SNAPSHOT_REL = '.spectra/unified-graph.json';
    const SIDECAR_REL = 'specs/_meta/.graph-source-commit';

    function seedPrimaryGraph(graphContent: string, snapshotContent?: string): void {
      const g = path.join(repo.primaryDir, GRAPH_REL);
      fs.mkdirSync(path.dirname(g), { recursive: true });
      fs.writeFileSync(g, graphContent);
      if (snapshotContent !== undefined) {
        const s = path.join(repo.primaryDir, SNAPSHOT_REL);
        fs.mkdirSync(path.dirname(s), { recursive: true });
        fs.writeFileSync(s, snapshotContent);
      }
    }

    it('worktree 缺图时从主仓 copy graph.json + 快照（非软链）+ 写 source-commit sidecar', () => {
      seedPrimaryGraph('{"nodes":[],"links":[]}', '{"schemaVersion":"2.0"}');

      const r = runSync(repo.worktreeDir);
      expect(r.status).toBe(0);

      const g = path.join(repo.worktreeDir, GRAPH_REL);
      const s = path.join(repo.worktreeDir, SNAPSHOT_REL);
      expect(fs.existsSync(g)).toBe(true);
      expect(fs.lstatSync(g).isSymbolicLink()).toBe(false); // copy 非软链（避免写穿）
      expect(fs.readFileSync(g, 'utf-8')).toBe('{"nodes":[],"links":[]}');
      // 快照也须是真实 copy（非软链）+ 内容一致
      expect(fs.existsSync(s)).toBe(true);
      expect(fs.lstatSync(s).isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(s, 'utf-8')).toBe('{"schemaVersion":"2.0"}');

      // sidecar 记录主仓 HEAD
      const sidecar = path.join(repo.worktreeDir, SIDECAR_REL);
      expect(fs.existsSync(sidecar)).toBe(true);
      const head = execSync('git rev-parse HEAD', { cwd: repo.primaryDir, encoding: 'utf-8' }).trim();
      expect(fs.readFileSync(sidecar, 'utf-8').trim()).toBe(head);
    });

    it('worktree 已有本地增量图时 rerun 不覆盖（copy-if-absent 幂等，Codex W4）', () => {
      seedPrimaryGraph('{"from":"primary"}');
      runSync(repo.worktreeDir); // 首次 bootstrap

      // 模拟 worktree 本地增量改图
      const g = path.join(repo.worktreeDir, GRAPH_REL);
      fs.writeFileSync(g, '{"from":"worktree-incremental"}');

      runSync(repo.worktreeDir); // rerun sync

      // 不被主仓版本覆盖
      expect(fs.readFileSync(g, 'utf-8')).toBe('{"from":"worktree-incremental"}');
    });

    it('主仓快照缺失时不阻断（仅 copy graph，首次 commit 退化 full reindex）', () => {
      seedPrimaryGraph('{"nodes":[]}'); // 不写快照

      const r = runSync(repo.worktreeDir);
      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(repo.worktreeDir, GRAPH_REL))).toBe(true);
      expect(fs.existsSync(path.join(repo.worktreeDir, SNAPSHOT_REL))).toBe(false);
    });

    it('主仓无图时不报错 + 给出构建提示', () => {
      // 主仓不 seed 图
      const r = runSyncVerbose(repo.worktreeDir);
      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(repo.worktreeDir, GRAPH_REL))).toBe(false);
      expect(r.stderr).toMatch(/spectra batch|spectra index|构建图/);
    });

    it('source-commit ≠ worktree HEAD 时 rerun 给出 stale 提示（不阻断）', () => {
      seedPrimaryGraph('{"nodes":[]}');
      runSync(repo.worktreeDir); // bootstrap 写 sidecar = 主仓 HEAD

      // worktree 推进一个 commit，使 HEAD ≠ 记录的 source commit
      execSync('git commit -q --allow-empty -m advance', { cwd: repo.worktreeDir });

      const r = runSyncVerbose(repo.worktreeDir);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/stale/);
    });

    it('首次 bootstrap 时 worktree HEAD 已 ≠ 主仓 HEAD → 立即 stale 提示（Codex CRITICAL）', () => {
      // worktree 先 diverge（领先主仓一个 commit），再 seed 主仓图并首次 bootstrap
      execSync('git commit -q --allow-empty -m worktree-ahead', { cwd: repo.worktreeDir });
      seedPrimaryGraph('{"nodes":[]}');

      const r = runSyncVerbose(repo.worktreeDir);
      expect(r.status).toBe(0);
      // 首次 copy 后即应比较 sidecar(=主仓 HEAD) vs worktree HEAD → stale
      expect(r.stderr).toMatch(/stale/);
      expect(fs.existsSync(path.join(repo.worktreeDir, GRAPH_REL))).toBe(true); // 仍 copy（stale 不阻断）
    });

    it('已有 graph 但缺 snapshot 时 rerun 补齐 snapshot（Codex WARNING：两者独立 copy-if-absent）', () => {
      seedPrimaryGraph('{"nodes":[]}'); // 主仓先只有 graph，无快照
      runSync(repo.worktreeDir);
      expect(fs.existsSync(path.join(repo.worktreeDir, GRAPH_REL))).toBe(true);
      expect(fs.existsSync(path.join(repo.worktreeDir, SNAPSHOT_REL))).toBe(false);

      // 主仓后来有了快照；rerun（graph 已存在）应补齐 snapshot 而非整体 early-return
      const sSrc = path.join(repo.primaryDir, SNAPSHOT_REL);
      fs.mkdirSync(path.dirname(sSrc), { recursive: true });
      fs.writeFileSync(sSrc, '{"schemaVersion":"2.0"}');

      runSync(repo.worktreeDir);
      const sTarget = path.join(repo.worktreeDir, SNAPSHOT_REL);
      expect(fs.existsSync(sTarget)).toBe(true);
      expect(fs.readFileSync(sTarget, 'utf-8')).toBe('{"schemaVersion":"2.0"}');
    });

    it('graph 目标是 symlink 时不静默当作"已有真实图"，warn 且不 copy（Codex WARNING）', () => {
      seedPrimaryGraph('{"from":"primary"}');
      // worktree 放一个 graph.json symlink（模拟旧 sync 遗留）
      const gTarget = path.join(repo.worktreeDir, GRAPH_REL);
      fs.mkdirSync(path.dirname(gTarget), { recursive: true });
      const decoy = path.join(repo.worktreeDir, 'decoy.json');
      fs.writeFileSync(decoy, '{"from":"symlink-target"}');
      fs.symlinkSync(decoy, gTarget);

      const r = runSyncVerbose(repo.worktreeDir);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/symlink|目录/);
      // 仍是 symlink（未被 bootstrap copy 覆盖，交人工处置）
      expect(fs.lstatSync(gTarget).isSymbolicLink()).toBe(true);
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
