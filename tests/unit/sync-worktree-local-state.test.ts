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
const REPO_ROOT = path.resolve(__dirname, '../..');

interface TestRepo {
  /** 临时根：`primary` 与 `worktrees/feature-x` 的共同父目录，逃逸 canary 布置需要它 */
  tempDir: string;
  primaryDir: string;
  worktreeDir: string;
  cleanup: () => void;
}

interface SetupRepoOptions {
  /** `.worktreeinclude` 清单内容；`null` 表示不创建该文件（Feature 239 T008 manifest 缺失场景） */
  worktreeInclude?: string[] | null;
  /** fixture `.gitignore` 内容——manifest 条目必须先满足 ignored 前提，否则会被 not-ignored 拒绝 */
  gitignore?: string[];
}

function setupRepo({
  worktreeInclude = ['.env.local'],
  gitignore = ['.env.local'],
}: SetupRepoOptions = {}): TestRepo {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-worktree-test-'));
  const primaryDir = path.join(tempDir, 'primary');
  const worktreeDir = path.join(tempDir, 'worktrees', 'feature-x');

  // 在 primaryDir 初始化 git repo + init commit
  fs.mkdirSync(primaryDir, { recursive: true });
  execSync('git init -q', { cwd: primaryDir });
  execSync('git config user.email test@example.com', { cwd: primaryDir });
  execSync('git config user.name Test', { cwd: primaryDir });

  // Feature 239 C3：`.gitignore` 必须进 init commit——`.worktreeinclude` 条目要通过
  // `not-ignored` 校验，缺了它默认 manifest 条目会被整体误判为不合规。
  fs.writeFileSync(path.join(primaryDir, '.gitignore'), `${gitignore.join('\n')}\n`);
  if (worktreeInclude !== null) {
    fs.writeFileSync(path.join(primaryDir, '.worktreeinclude'), `${worktreeInclude.join('\n')}\n`);
  }
  execSync('git add -A', { cwd: primaryDir });
  execSync('git commit -q -m init', { cwd: primaryDir });

  // 添加 worktree
  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
  execSync(`git worktree add -q -b feature-x "${worktreeDir}"`, { cwd: primaryDir });

  return {
    tempDir,
    primaryDir,
    worktreeDir,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
}

interface SyncResult {
  stdout: string;
  stderr: string;
  status: number;
}

/** 脚本消费的是**当前 worktree** 侧的清单（tracked 文件随分支 checkout 到各 worktree）。 */
function writeWorktreeInclude(repo: TestRepo, entries: string[]): void {
  fs.writeFileSync(path.join(repo.worktreeDir, '.worktreeinclude'), `${entries.join('\n')}\n`);
}

function runSync(cwd: string): SyncResult {
  const r = spawnSync('bash', [SCRIPT_PATH, '--quiet'], { cwd, encoding: 'utf-8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 0 };
}

function runSyncVerbose(cwd: string): SyncResult {
  const r = spawnSync('bash', [SCRIPT_PATH], { cwd, encoding: 'utf-8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 0 };
}

/** 注入额外环境变量（隔离 HOME / PROBE_LOG）的运行入口，供 FR-011 逃逸矩阵使用。 */
function runSyncWithEnv(cwd: string, extraEnv: Record<string, string>): SyncResult {
  const r = spawnSync('bash', [SCRIPT_PATH], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ...extraEnv },
  });
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

  // ─────────────────────────────────────────────────────────────
  // Feature 239 批 2：动态清单绑定 / containment / allowlist / 覆盖语义 guard
  // ─────────────────────────────────────────────────────────────

  describe('Feature 239 — .worktreeinclude 动态清单绑定（FR-002/SC-002(b)）', () => {
    it('动态清单：manifest 新增 ignored 路径后该路径被 copy（无需改脚本代码）', () => {
      const dynamic = setupRepo({
        worktreeInclude: ['.env.local', 'local-notes.md'],
        gitignore: ['.env.local', 'local-notes.md'],
      });
      try {
        // 前置断言：新增路径确实满足 ignored 前提。此断言若失败 = fixture 构造错误，
        // 必须先修 fixture，不能当作"动态绑定未实现"的红测试证据。
        const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', 'local-notes.md'], {
          cwd: dynamic.worktreeDir,
        });
        expect(ignored.status).toBe(0);

        fs.writeFileSync(path.join(dynamic.primaryDir, 'local-notes.md'), 'NOTES-V1');
        fs.writeFileSync(path.join(dynamic.primaryDir, '.env.local'), 'KEY=1');

        const r = runSync(dynamic.worktreeDir);
        expect(r.status).toBe(0);
        expect(fs.readFileSync(path.join(dynamic.worktreeDir, 'local-notes.md'), 'utf-8')).toBe(
          'NOTES-V1',
        );
        // 原有条目不受影响
        expect(fs.existsSync(path.join(dynamic.worktreeDir, '.env.local'))).toBe(true);
      } finally {
        dynamic.cleanup();
      }
    });

    it('动态清单：从 manifest 移除 .env.local 后不再被 copy（SC-002(b) 直接证据）', () => {
      const dynamic = setupRepo({
        worktreeInclude: ['local-notes.md'],
        gitignore: ['.env.local', 'local-notes.md'],
      });
      try {
        fs.writeFileSync(path.join(dynamic.primaryDir, '.env.local'), 'KEY=1');
        fs.writeFileSync(path.join(dynamic.primaryDir, 'local-notes.md'), 'NOTES-V1');

        const r = runSync(dynamic.worktreeDir);
        expect(r.status).toBe(0);
        // 清单里没有 .env.local → 不得被 copy（硬编码 COPY_TARGETS 实现下必然仍被 copy）
        expect(fs.existsSync(path.join(dynamic.worktreeDir, '.env.local'))).toBe(false);
        // 清单里有的条目照常 copy
        expect(fs.existsSync(path.join(dynamic.worktreeDir, 'local-notes.md'))).toBe(true);
      } finally {
        dynamic.cleanup();
      }
    });
  });

  describe('Feature 239 — .worktreeinclude 缺失降级（FR-002）', () => {
    it('manifest 文件缺失 → 可见提示 + 其余同步步骤继续 + exit 0', () => {
      const noManifest = setupRepo({ worktreeInclude: null });
      try {
        fs.writeFileSync(path.join(noManifest.primaryDir, 'CLAUDE.local.md'), '# 约定');
        fs.writeFileSync(path.join(noManifest.primaryDir, '.env.local'), 'KEY=1');

        const r = runSyncVerbose(noManifest.worktreeDir);

        expect(r.status).toBe(0);
        expect(r.stderr).toContain('未找到 .worktreeinclude');
        // 清单缺失降级为空清单：copy 类一个都不做，但 SYMLINK_TARGETS 步骤照常完成
        expect(fs.existsSync(path.join(noManifest.worktreeDir, '.env.local'))).toBe(false);
        expect(
          fs.lstatSync(path.join(noManifest.worktreeDir, 'CLAUDE.local.md')).isSymbolicLink(),
        ).toBe(true);
      } finally {
        noManifest.cleanup();
      }
    });
  });

  describe('Feature 239 — FR-012 覆盖语义 guard', () => {
    // guard: 现状已合规，非红测试。现有 copy_path 本就是"每次覆盖"语义，本用例首跑即绿；
    // 其作用是锁死该语义，防止 T012 动态绑定改造过程中被误改成 copy-if-absent。
    it('二次同步覆盖：主仓 .env.local 由 v1 改为 v2 后重跑 sync，worktree 侧被覆盖为 v2', () => {
      const source = path.join(repo.primaryDir, '.env.local');
      const target = path.join(repo.worktreeDir, '.env.local');

      fs.writeFileSync(source, 'VERSION=v1\n');
      expect(runSync(repo.worktreeDir).status).toBe(0);
      expect(fs.readFileSync(target, 'utf-8')).toBe('VERSION=v1\n');

      fs.writeFileSync(source, 'VERSION=v2\n');
      expect(runSync(repo.worktreeDir).status).toBe(0);
      expect(fs.readFileSync(target, 'utf-8')).toBe('VERSION=v2\n');
    });
  });

  describe('Feature 239 — FR-011 路径逃逸对抗矩阵（决策 6 / C8 重做）', () => {
    interface EscapeFixture {
      repo: TestRepo;
      /** 隔离 HOME 沙盒：脚本末尾会读 $HOME/.claude/projects，必须与真实 ~ 解耦 */
      homeDir: string;
      probeLog: string;
      /** 与 primary/worktree 无父子关系的独立沙盒，绝对路径类 canary 落在这里 */
      outsideSandbox: string;
      canaries: string[];
      cleanup: () => void;
    }

    interface FileSnapshot {
      filePath: string;
      content: string;
      mtimeMs: number;
    }

    function snapshotFiles(filePaths: string[]): FileSnapshot[] {
      return filePaths.map((filePath) => ({
        filePath,
        content: fs.readFileSync(filePath, 'utf-8'),
        mtimeMs: fs.statSync(filePath).mtimeMs,
      }));
    }

    function buildEscapeFixture(gitignore: string[] = ['.env.local']): EscapeFixture {
      const escapeRepo = setupRepo({ worktreeInclude: ['.env.local'], gitignore });
      const homeDir = path.join(escapeRepo.tempDir, 'home-sandbox');
      fs.mkdirSync(homeDir);
      const outsideSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-worktree-outside-'));

      // 两侧 canary 按脚本**真实解析**的路径布置，不按 dirname(worktreeDir) 想当然：
      //   source 侧 = $PRIMARY_ROOT/../shared-secret；target 侧 = $CURRENT_ROOT/../shared-secret
      const sourceCanary = path.resolve(escapeRepo.primaryDir, '..', 'shared-secret');
      const targetCanary = path.resolve(escapeRepo.worktreeDir, '..', 'shared-secret');
      const absoluteCanary = path.join(outsideSandbox, 'canary.env');
      const canaries = [sourceCanary, targetCanary, absoluteCanary];
      for (const canary of canaries) {
        fs.writeFileSync(canary, `CANARY:${path.basename(path.dirname(canary))}`);
      }

      // 合法步骤的 source（用于断言"非法条目被 skip 但其余步骤照常完成"）
      fs.writeFileSync(path.join(escapeRepo.primaryDir, 'CLAUDE.local.md'), '# 约定');
      fs.writeFileSync(path.join(escapeRepo.primaryDir, '.env.local'), 'KEY=legal');

      return {
        repo: escapeRepo,
        homeDir,
        probeLog: path.join(escapeRepo.tempDir, 'copy-path-probe.log'),
        outsideSandbox,
        canaries,
        cleanup: () => {
          escapeRepo.cleanup();
          fs.rmSync(outsideSandbox, { recursive: true, force: true });
        },
      };
    }

    /** 单个非法条目的四断言齐备验证。 */
    function assertRejected(fixture: EscapeFixture, entry: string, reason: string): void {
      writeWorktreeInclude(fixture.repo, [entry, '.env.local']);
      const before = snapshotFiles(fixture.canaries);

      const r = runSyncWithEnv(fixture.repo.worktreeDir, {
        HOME: fixture.homeDir,
        PROBE_LOG: fixture.probeLog,
      });

      // (a) stderr 出现精确 reason code（而非宽泛的"跳过/警告"日志——后者在完全没有
      //     containment 校验的实现下同样会出现，无法证伪）
      expect(r.stderr).toContain(`[containment] ${reason}: ${entry}`);

      // (b) 非法条目被 skip 但不中断整个 sync
      expect(r.status).toBe(0);

      // (c) 同一次 sync 中合法步骤仍完成
      expect(
        fs.lstatSync(path.join(fixture.repo.worktreeDir, 'CLAUDE.local.md')).isSymbolicLink(),
      ).toBe(true);
      expect(fs.readFileSync(path.join(fixture.repo.worktreeDir, '.env.local'), 'utf-8')).toBe(
        'KEY=legal',
      );

      // (d1) copy_path 未对非法条目被调用（可观察探针，证明拦截发生在 copy_path 之前）
      const probe = fs.existsSync(fixture.probeLog)
        ? fs.readFileSync(fixture.probeLog, 'utf-8')
        : '';
      expect(probe).not.toContain(entry);

      // (d2) 两侧 canary 内容与 mtime 逐一未被触碰
      expect(snapshotFiles(fixture.canaries)).toEqual(before);

      // (d3) 隔离 HOME 沙盒零变化
      expect(fs.readdirSync(fixture.homeDir)).toEqual([]);
    }

    it('absolute-path：独立沙盒内真实存在的绝对路径条目被拒绝', () => {
      const fixture = buildEscapeFixture();
      try {
        // canary 真实存在 → 若无 containment 校验，copy_path 的 -e 检查会通过并真的 cp
        assertRejected(fixture, path.join(fixture.outsideSandbox, 'canary.env'), 'absolute-path');
      } finally {
        fixture.cleanup();
      }
    });

    it('dot-dot-segment：`../shared-secret` 被拒绝，两侧 canary 均未被触碰', () => {
      const fixture = buildEscapeFixture();
      try {
        assertRejected(fixture, '../shared-secret', 'dot-dot-segment');
      } finally {
        fixture.cleanup();
      }
    });

    it('glob-char：`*.env` 被拒绝（字面 4 字符串不得被当作合法路径尝试 copy）', () => {
      const fixture = buildEscapeFixture();
      try {
        fs.writeFileSync(path.join(fixture.repo.primaryDir, 'decoy.env'), 'DECOY');
        assertRejected(fixture, '*.env', 'glob-char');
        // 诱饵未被 glob 展开 copy 到 worktree
        expect(fs.existsSync(path.join(fixture.repo.worktreeDir, 'decoy.env'))).toBe(false);
      } finally {
        fixture.cleanup();
      }
    });

    it('negation-prefix：`!keep.env` 被拒绝', () => {
      const fixture = buildEscapeFixture();
      try {
        fs.writeFileSync(path.join(fixture.repo.primaryDir, '!keep.env'), 'NEGATED');
        assertRejected(fixture, '!keep.env', 'negation-prefix');
      } finally {
        fixture.cleanup();
      }
    });

    it('escape-char：含反斜杠的条目被拒绝', () => {
      const fixture = buildEscapeFixture();
      try {
        assertRejected(fixture, 'esc\\ape.env', 'escape-char');
      } finally {
        fixture.cleanup();
      }
    });

    it('trailing-slash：`.env.local/` 被拒绝（尾斜杠会通过 check-ignore 且使存在性检查失真）', () => {
      const fixture = buildEscapeFixture();
      try {
        assertRejected(fixture, '.env.local/', 'trailing-slash');
      } finally {
        fixture.cleanup();
      }
    });

    it('not-ignored：未被 gitignore 收录的路径被拒绝', () => {
      const fixture = buildEscapeFixture();
      try {
        fs.writeFileSync(path.join(fixture.repo.primaryDir, 'plain-note.md'), 'PLAIN');
        assertRejected(fixture, 'plain-note.md', 'not-ignored');
      } finally {
        fixture.cleanup();
      }
    });

    it('not-regular-file：已 ignored 但实际是目录的条目被拒绝', () => {
      const fixture = buildEscapeFixture(['.env.local', '.env.d']);
      try {
        fs.mkdirSync(path.join(fixture.repo.primaryDir, '.env.d'));
        fs.writeFileSync(path.join(fixture.repo.primaryDir, '.env.d', 'inner'), 'INNER');
        assertRejected(fixture, '.env.d', 'not-regular-file');
      } finally {
        fixture.cleanup();
      }
    });
  });

  describe('Feature 239 — FR-004 allowlist 精确性 + FR-005 文件名 pattern 黑名单', () => {
    const EXPECTED_SYMLINK_TARGETS = [
      '.claude/settings.local.json',
      '.specify/.spec-driver-path',
      '.agents/skills',
      'node_modules',
      '_reference',
      'CLAUDE.local.md',
    ];
    /** source 需要以目录形态创建的项（其余按普通文件创建） */
    const DIRECTORY_TARGETS = new Set(['.agents/skills', 'node_modules', '_reference']);

    function readSymlinkTargets(): string[] {
      const source = fs.readFileSync(SCRIPT_PATH, 'utf-8');
      const block = /^SYMLINK_TARGETS=\(([\s\S]*?)\)$/m.exec(source);
      if (block === null || block[1] === undefined) {
        throw new Error('未能从 sync-worktree-local-state.sh 解析出 SYMLINK_TARGETS 数组');
      }
      return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1] as string);
    }

    // guard：数组现状本就精确等于 6 项，本组用例首跑即绿，作用是锁定现状防未来误改。
    it('guard：SYMLINK_TARGETS 精确等于既定 6 项（增删任一项都判失败）', () => {
      expect(readSymlinkTargets()).toEqual(EXPECTED_SYMLINK_TARGETS);
    });

    it.each(EXPECTED_SYMLINK_TARGETS)('guard：%s 的 source 存在时确实生成软链', (target) => {
      const source = path.join(repo.primaryDir, target);
      if (DIRECTORY_TARGETS.has(target)) {
        fs.mkdirSync(source, { recursive: true });
        fs.writeFileSync(path.join(source, 'placeholder'), 'x');
      } else {
        fs.mkdirSync(path.dirname(source), { recursive: true });
        fs.writeFileSync(source, 'x');
      }

      expect(runSync(repo.worktreeDir).status).toBe(0);

      const linked = path.join(repo.worktreeDir, target);
      expect(fs.lstatSync(linked).isSymbolicLink()).toBe(true);
      // 比较 realpath 而非 readlink 原文：脚本的 PRIMARY_ROOT 经 `cd ... && pwd` 归一化，
      // macOS 上 /var 会解析为 /private/var，原文比较会产生与产品行为无关的假失败。
      expect(fs.realpathSync(linked)).toBe(fs.realpathSync(source));
    });

    it.each(EXPECTED_SYMLINK_TARGETS)(
      '交叉断言：%s 不出现在仓库根 .worktreeinclude 内容中（软链项绝不走 copy 通道）',
      (target) => {
        const manifest = fs.readFileSync(path.join(REPO_ROOT, '.worktreeinclude'), 'utf-8');
        expect(manifest).not.toContain(target);
      },
    );

    // FR-005：文件名 pattern 黑名单（defense-in-depth 第二道防线，非绝对安全声明）。
    const SECRET_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
      { id: '\\.env', pattern: /\.env/ },
      { id: '\\bsecret\\b', pattern: /\bsecret\b/ },
      { id: '\\bkey\\b', pattern: /\bkey\b/ },
      { id: 'id_rsa', pattern: /id_rsa/ },
      { id: '\\.pem', pattern: /\.pem/ },
      { id: '\\.p12', pattern: /\.p12/ },
      { id: '\\.pfx', pattern: /\.pfx/ },
      { id: '\\btoken\\b', pattern: /\btoken\b/ },
      { id: '\\bcredential', pattern: /\bcredential/ },
      { id: '\\bpassword\\b', pattern: /\bpassword\b/ },
      { id: '\\bauth\\.json\\b', pattern: /\bauth\.json\b/ },
    ];

    function secretHits(value: string): string[] {
      return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(value)).map(({ id }) => id);
    }

    // 每个 pattern 一命中例 + 一不命中例（W7 机械化）
    const PATTERN_MATRIX: Array<{ patternId: string; hit: string; miss: string }> = [
      { patternId: '\\.env', hit: '.env.local', miss: 'environment-setup.md' },
      { patternId: '\\bsecret\\b', hit: 'config/db-secret.json', miss: 'secretary-notes.md' },
      { patternId: '\\bkey\\b', hit: 'key.txt', miss: 'monkey.json' },
      { patternId: 'id_rsa', hit: '.ssh/id_rsa', miss: 'identity-map.json' },
      { patternId: '\\.pem', hit: 'server.pem', miss: 'pemberton-notes.md' },
      { patternId: '\\.p12', hit: 'client.p12', miss: 'p12-migration.md' },
      { patternId: '\\.pfx', hit: 'client.pfx', miss: 'pfx-guide.md' },
      { patternId: '\\btoken\\b', hit: 'token.json', miss: 'tokenizer.ts' },
      { patternId: '\\bcredential', hit: 'credentials.json', miss: 'precredential-notes.md' },
      { patternId: '\\bpassword\\b', hit: 'password.txt', miss: 'passwordless-login.md' },
      { patternId: '\\bauth\\.json\\b', hit: 'auth.json', miss: 'oauth.json' },
    ];

    it.each(PATTERN_MATRIX)('pattern $patternId：命中例 $hit 被捕获', ({ patternId, hit }) => {
      expect(secretHits(hit)).toContain(patternId);
    });

    it.each(PATTERN_MATRIX)('pattern $patternId：不命中例 $miss 不被误伤', ({ patternId, miss }) => {
      expect(secretHits(miss)).not.toContain(patternId);
    });

    it.each(['monkey.json', 'keyboard-layout.json'])('不误伤反例 %s 不命中任何 pattern', (name) => {
      expect(secretHits(name)).toEqual([]);
    });

    it('guard：SYMLINK_TARGETS 六项全部不命中 pattern 黑名单', () => {
      for (const target of readSymlinkTargets()) {
        expect(secretHits(target)).toEqual([]);
      }
    });

    it('SC-003 反向插入验证：向 allowlist 人为插入命中项即判红，移除后恢复通过', () => {
      const polluted = [...EXPECTED_SYMLINK_TARGETS, 'config/db-secret.json'];
      expect(polluted.flatMap(secretHits)).not.toEqual([]);
      expect(EXPECTED_SYMLINK_TARGETS.flatMap(secretHits)).toEqual([]);
    });
  });
});
