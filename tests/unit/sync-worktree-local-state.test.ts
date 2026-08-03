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
  /** 假 `spectra` 所在目录，被注入 PATH 前缀；用例可覆写其中的 stub 改变行为 */
  stubBinDir: string;
  cleanup: () => void;
}

/**
 * 假 `spectra` CLI 行为规格。
 *
 * Feature 239 起 sync 脚本会 spawn `spectra graph-quality --json` 做 freshness 判定；测试一律
 * 注入沙盒内的 stub，既保证判定结果可控，也避免测试触发真实全局 CLI（真实 CLI 冒烟由
 * graph-bootstrap-status.test.ts 单独覆盖）。
 */
type SpectraStubSpec =
  | { mode: 'auto' }
  /** `staleReasons`：F249 W-001 —— 让 stub 能产出指纹型 stale，用于验证 shell 侧文案不再硬编码 commit 型原因。 */
  | { mode: 'fixed'; state: string; staleReasons?: string[] }
  | { mode: 'build'; sourceCommit: string };

function writeSpectraStub(binDir: string, spec: SpectraStubSpec): void {
  fs.mkdirSync(binDir, { recursive: true });

  // auto：按图内嵌 sourceCommit 与当前 HEAD 的一致性给出 fresh/stale，充当 canonical 判定的
  // 测试替身；fixed：固定返回指定状态，用于四态映射测试。
  const stateResolution =
    spec.mode === 'fixed'
      ? [
          `state=${JSON.stringify(spec.state)}`,
          'recorded="stub-recorded"',
          'current="stub-current"',
        ].join('\n')
      : [
          `recorded="$(sed -n 's/.*"sourceCommit":"\\([^"]*\\)".*/\\1/p' "$graph" 2>/dev/null | head -1)"`,
          'current="$(git rev-parse HEAD 2>/dev/null || true)"',
          'if [[ -z "$recorded" ]]; then state="unknown-provenance"',
          'elif [[ "$recorded" == "$current" ]]; then state="fresh"',
          'else state="stale"; fi',
        ].join('\n');

  const batchBody =
    spec.mode === 'build'
      ? [
          'mkdir -p specs/_meta',
          `printf '{"graph":{"sourceCommit":"%s"},"nodes":[],"links":[]}' ${JSON.stringify(spec.sourceCommit)} > specs/_meta/graph.json`,
        ].join('\n')
      : ':';

  const staleReasonsFragment =
    spec.mode === 'fixed' && spec.staleReasons !== undefined
      ? `,"staleReasons":${JSON.stringify(spec.staleReasons)}`
      : '';

  fs.writeFileSync(
    path.join(binDir, 'spectra'),
    [
      '#!/usr/bin/env bash',
      'set -u',
      'cmd="${1:-}"',
      'shift || true',
      'if [[ "$cmd" == "graph-quality" ]]; then',
      '  graph=""',
      '  while [[ $# -gt 0 ]]; do',
      '    if [[ "$1" == "--graph" ]]; then graph="${2:-}"; shift 2; else shift; fi',
      '  done',
      stateResolution,
      // staleReasons 片段：仅 fixed 模式显式给定时才输出（auto 模式沿用旧形态，即"旧版本 CLI 不产出该字段"）
      `  printf '{"overallVerdict":"pass","freshness":{"state":"%s","recordedSourceCommit":"%s","currentHead":"%s"${staleReasonsFragment}}}\\n' "$state" "$recorded" "$current"`,
      '  exit 0',
      'fi',
      'if [[ "$cmd" == "batch" ]]; then',
      batchBody,
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

/** 当前活跃 fixture 的 stub 目录，由 setupRepo 设置，供 runSync* 注入 PATH 前缀。 */
let activeStubBinDir: string | null = null;
/** 当前活跃 fixture 的隔离 HOME（W6(b)），由 setupRepo 设置，默认注入所有 runSync*。 */
let activeHomeSandbox: string | null = null;

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

  const stubBinDir = path.join(tempDir, 'stub-bin');
  writeSpectraStub(stubBinDir, { mode: 'auto' });
  activeStubBinDir = stubBinDir;

  // W6(b)：每个 fixture 自带隔离 HOME，避免脚本的 memory-symlink 步骤触碰真实 ~
  const homeSandbox = path.join(tempDir, 'home-default');
  fs.mkdirSync(homeSandbox, { recursive: true });
  activeHomeSandbox = homeSandbox;

  return {
    tempDir,
    primaryDir,
    worktreeDir,
    stubBinDir,
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

/**
 * 统一 env：
 * - 把 fixture 的 stub 目录放到 PATH 最前，确保脚本解析到假 `spectra`
 * - W6(b)：默认注入**临时 HOME**。脚本末尾的 claude-project-memory 步骤会读写
 *   `$HOME/.claude/projects`，继承真实 HOME 会让测试对开发者主目录产生非密封副作用
 *   （fixture slug 若与真实目录碰撞，甚至会在真实 HOME 下建链）。
 */
function stubbedEnv(extraEnv: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = { ...process.env, ...extraEnv };
  if (activeStubBinDir !== null) {
    base.PATH = `${activeStubBinDir}${path.delimiter}${process.env.PATH ?? ''}`;
  }
  if (base.HOME === process.env.HOME && activeHomeSandbox !== null) {
    base.HOME = activeHomeSandbox;
  }
  return base;
}

function runSyncArgs(cwd: string, args: string[], extraEnv: Record<string, string> = {}): SyncResult {
  const r = spawnSync('bash', [SCRIPT_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    env: stubbedEnv(extraEnv),
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 0 };
}

function runSync(cwd: string): SyncResult {
  return runSyncArgs(cwd, ['--quiet']);
}

function runSyncVerbose(cwd: string): SyncResult {
  return runSyncArgs(cwd, []);
}

/** 注入额外环境变量（隔离 HOME / PROBE_LOG）的运行入口，供 FR-011 逃逸矩阵使用。 */
function runSyncWithEnv(cwd: string, extraEnv: Record<string, string>): SyncResult {
  return runSyncArgs(cwd, [], extraEnv);
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
    const STATUS_REL = 'specs/_meta/graph-bootstrap-status.json';

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

    // Feature 239 T020(b)：sidecar 写入被彻底移除，改由结构化状态文件承载 provenance。
    it('worktree 缺图时从主仓 copy graph.json + 快照（非软链）+ 写结构化状态文件（不再写 sidecar）', () => {
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

      // 状态文件记录本次 provenance；旧 sidecar 不得再被生成
      const status = JSON.parse(fs.readFileSync(path.join(repo.worktreeDir, STATUS_REL), 'utf-8'));
      expect(status.schemaVersion).toBe(1);
      expect(status.bootstrapSource).toBe('primary-copy');
      expect(fs.existsSync(path.join(repo.worktreeDir, SIDECAR_REL))).toBe(false);
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

    // Feature 239 T020(c)：两个 stale 用例的 fixture 迁移为含 `graph.sourceCommit` 的新格式。
    // freshness 不再由脚本自行比对 sidecar，而是经 checkFreshness adapter 读图内嵌字段判定。
    it('source-commit ≠ worktree HEAD 时 rerun 给出 stale 提示（不阻断）', () => {
      const primaryHead = execSync('git rev-parse HEAD', {
        cwd: repo.primaryDir,
        encoding: 'utf-8',
      }).trim();
      seedPrimaryGraph(JSON.stringify({ graph: { sourceCommit: primaryHead }, nodes: [] }));
      runSync(repo.worktreeDir); // 首次 bootstrap copy 图（内嵌 sourceCommit = 当时的 HEAD）

      // worktree 推进一个 commit，使 HEAD ≠ 图内嵌的 sourceCommit
      execSync('git commit -q --allow-empty -m advance', { cwd: repo.worktreeDir });

      const r = runSyncVerbose(repo.worktreeDir);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/stale/);
    });

    it('首次 bootstrap 时 worktree HEAD 已 ≠ 主仓 HEAD → 立即 stale 提示（Codex CRITICAL）', () => {
      const primaryHead = execSync('git rev-parse HEAD', {
        cwd: repo.primaryDir,
        encoding: 'utf-8',
      }).trim();
      // worktree 先 diverge（领先主仓一个 commit），再 seed 主仓图并首次 bootstrap
      execSync('git commit -q --allow-empty -m worktree-ahead', { cwd: repo.worktreeDir });
      seedPrimaryGraph(JSON.stringify({ graph: { sourceCommit: primaryHead }, nodes: [] }));

      const r = runSyncVerbose(repo.worktreeDir);
      expect(r.status).toBe(0);
      // 首次 copy 后即应比较图内嵌 sourceCommit vs worktree HEAD → stale
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

  // ─────────────────────────────────────────────────────────────
  // Feature 239 批 3：graph provenance 接线（FR-006/FR-010/SC-007）
  // ─────────────────────────────────────────────────────────────

  describe('Feature 239 — graph provenance 接线（FR-006/SC-007）', () => {
    const GRAPH_REL = 'specs/_meta/graph.json';
    const SIDECAR_REL = 'specs/_meta/.graph-source-commit';
    const STATUS_REL = 'specs/_meta/graph-bootstrap-status.json';
    const FOREIGN_COMMIT = '0'.repeat(40);

    function seedPrimaryGraphWithCommit(sourceCommit: string): void {
      const graphPath = path.join(repo.primaryDir, GRAPH_REL);
      fs.mkdirSync(path.dirname(graphPath), { recursive: true });
      fs.writeFileSync(
        graphPath,
        JSON.stringify({ graph: { sourceCommit }, nodes: [], links: [] }),
      );
    }

    function seedWorktreeSidecar(content: string): void {
      const sidecarPath = path.join(repo.worktreeDir, SIDECAR_REL);
      fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
      fs.writeFileSync(sidecarPath, `${content}\n`);
    }

    function worktreeHead(): string {
      return execSync('git rev-parse HEAD', { cwd: repo.worktreeDir, encoding: 'utf-8' }).trim();
    }

    function readStatus(): Record<string, unknown> {
      return JSON.parse(fs.readFileSync(path.join(repo.worktreeDir, STATUS_REL), 'utf-8')) as Record<
        string,
        unknown
      >;
    }

    // C9-2 正向：内嵌 sourceCommit 已 stale，但遗留 sidecar 被人为写成 current。
    // 若判定仍读 sidecar（或两者都读且优先级不对），会静默放过一张 stale 图。
    it('poison-sidecar 正向：内嵌 stale + sidecar 写成 current → 仍必须 warn stale', () => {
      seedPrimaryGraphWithCommit(FOREIGN_COMMIT);
      seedWorktreeSidecar(worktreeHead());

      const r = runSyncVerbose(repo.worktreeDir);

      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/stale/);
    });

    // C9-2 反向：内嵌 sourceCommit 与 HEAD 一致（fresh），但遗留 sidecar 被写成 stale。
    it('poison-sidecar 反向：内嵌 fresh + sidecar 写成 stale → 不得误报 stale', () => {
      seedPrimaryGraphWithCommit(worktreeHead());
      seedWorktreeSidecar(FOREIGN_COMMIT);

      const r = runSyncVerbose(repo.worktreeDir);

      expect(r.status).toBe(0);
      expect(r.stderr).not.toMatch(/stale/);
    });

    // C9-3：预先 seed 一个遗留 sidecar，bootstrap 后必须被迁移性删除
    it('遗留 sidecar 在 bootstrap 后被清理，且不会被重新生成', () => {
      seedPrimaryGraphWithCommit(worktreeHead());
      seedWorktreeSidecar(FOREIGN_COMMIT);
      expect(fs.existsSync(path.join(repo.worktreeDir, SIDECAR_REL))).toBe(true);

      expect(runSync(repo.worktreeDir).status).toBe(0);

      expect(fs.existsSync(path.join(repo.worktreeDir, SIDECAR_REL))).toBe(false);
      expect(fs.existsSync(path.join(repo.worktreeDir, STATUS_REL))).toBe(true);
    });

    it('rerun 未改变已有图时继承先前 bootstrapSource（不被覆盖为 local-build/unknown）', () => {
      seedPrimaryGraphWithCommit(worktreeHead());
      expect(runSync(repo.worktreeDir).status).toBe(0);
      expect(readStatus().bootstrapSource).toBe('primary-copy');

      // 第二次 sync：图已存在，本次既未 copy 也未构建 → 必须继承
      expect(runSync(repo.worktreeDir).status).toBe(0);
      expect(readStatus().bootstrapSource).toBe('primary-copy');
    });

    it('主仓与 worktree 均无图 → bootstrapSource=none 且 assessable=false（状态文件仍落盘）', () => {
      expect(runSync(repo.worktreeDir).status).toBe(0);

      const status = readStatus();
      expect(status.bootstrapSource).toBe('none');
      expect(status.assessable).toBe(false);
    });

    it('--dry-run 不落盘状态文件、不删除遗留 sidecar', () => {
      seedPrimaryGraphWithCommit(worktreeHead());
      seedWorktreeSidecar(FOREIGN_COMMIT);

      const r = runSyncArgs(repo.worktreeDir, ['--dry-run', '--quiet']);

      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(repo.worktreeDir, STATUS_REL))).toBe(false);
      expect(fs.existsSync(path.join(repo.worktreeDir, SIDECAR_REL))).toBe(true);
    });

    // T026：四态 → warning 映射（stale/unknown-provenance 才 warn）
    it.each([
      { state: 'fresh', shouldWarn: false },
      { state: 'dirty', shouldWarn: false },
      { state: 'stale', shouldWarn: true },
      { state: 'unknown-provenance', shouldWarn: true },
    ])('freshness 四态映射：$state → warn=$shouldWarn', ({ state, shouldWarn }) => {
      seedPrimaryGraphWithCommit(worktreeHead());
      writeSpectraStub(repo.stubBinDir, { mode: 'fixed', state });

      const r = runSyncVerbose(repo.worktreeDir);

      expect(r.status).toBe(0);
      if (shouldWarn) {
        expect(r.stderr).toContain(state);
      } else {
        // dirty 刻意不告警：提交前工作树几乎必然 dirty，否则每次正常流程都产生噪音
        expect(r.stderr).not.toMatch(/stale|unknown-provenance/);
      }
    });

    // ── F249 W-001：stale 文案 reason-aware（shell 原样打印 helper 现算的诊断串）──

    it('W-001：仅指纹型 stale → 文案说指纹不一致，MUST NOT 出现 sourceCommit 型说法', () => {
      seedPrimaryGraphWithCommit(worktreeHead());
      writeSpectraStub(repo.stubBinDir, {
        mode: 'fixed',
        state: 'stale',
        staleReasons: ['collector-fingerprint'],
      });

      const r = runSyncVerbose(repo.worktreeDir);

      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/stale/);
      expect(r.stderr).toContain('collector fingerprint 与当前采集器实现不一致');
      // 修复前这里必然出现"图内嵌的 sourceCommit 与当前 worktree HEAD 不一致"——
      // 一句与本次 stale 成因毫无关系的话，会把人引去查 commit
      expect(r.stderr).not.toContain('sourceCommit');
    });

    it.each([
      { reason: 'collector-fingerprint-unrecorded', phrase: '未记录 collector fingerprint' },
      { reason: 'collector-fingerprint-invalid', phrase: '结构畸形' },
    ])('W-001：$reason 型 stale → 文案精确对应该原因（不退化为 commit 型）', ({ reason, phrase }) => {
      seedPrimaryGraphWithCommit(worktreeHead());
      writeSpectraStub(repo.stubBinDir, { mode: 'fixed', state: 'stale', staleReasons: [reason] });

      const r = runSyncVerbose(repo.worktreeDir);

      expect(r.status).toBe(0);
      expect(r.stderr).toContain(phrase);
      expect(r.stderr).not.toContain('sourceCommit');
    });

    it('W-001：commit + 指纹多原因并存 → 两条原因都出现在同一条 warning 里', () => {
      seedPrimaryGraphWithCommit(worktreeHead());
      writeSpectraStub(repo.stubBinDir, {
        mode: 'fixed',
        state: 'stale',
        staleReasons: ['source-commit', 'collector-fingerprint-invalid'],
      });

      const r = runSyncVerbose(repo.worktreeDir);

      expect(r.status).toBe(0);
      expect(r.stderr).toContain('sourceCommit');
      expect(r.stderr).toContain('结构畸形');
    });

    it('W-001：stale 但 CLI 未产出 staleReasons（旧版本）→ 仍告警，且不谎报具体原因', () => {
      seedPrimaryGraphWithCommit(worktreeHead());
      // 不传 staleReasons → stub 输出的 JSON 里没有该字段（旧版本 CLI 形态）
      writeSpectraStub(repo.stubBinDir, { mode: 'fixed', state: 'stale' });

      const r = runSyncVerbose(repo.worktreeDir);

      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/stale/);
      expect(r.stderr).toContain('未提供具体原因');
      expect(r.stderr).not.toContain('sourceCommit');
    });

    // T025：--attempt-build 完整 shell 接线证据
    it('--attempt-build：本地构建成功 → 状态文件记 local-build 且字段取自图内嵌 sourceCommit', () => {
      const builtCommit = 'a'.repeat(40);
      writeSpectraStub(repo.stubBinDir, { mode: 'build', sourceCommit: builtCommit });
      // 主仓无图 → 走本地构建兜底
      expect(fs.existsSync(path.join(repo.primaryDir, GRAPH_REL))).toBe(false);

      const r = runSyncArgs(repo.worktreeDir, ['--attempt-build']);

      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(repo.worktreeDir, GRAPH_REL))).toBe(true);
      const status = readStatus();
      expect(status.bootstrapSource).toBe('local-build');
      expect(status.embeddedSourceCommitAtBootstrap).toBe(builtCommit);
      expect(status.worktreeHeadAtBootstrap).toBe(worktreeHead());
    });

    it('不带 --attempt-build 时不触发本地构建（默认路径行为不变）', () => {
      writeSpectraStub(repo.stubBinDir, { mode: 'build', sourceCommit: 'b'.repeat(40) });

      expect(runSync(repo.worktreeDir).status).toBe(0);

      expect(fs.existsSync(path.join(repo.worktreeDir, GRAPH_REL))).toBe(false);
      expect(readStatus().bootstrapSource).toBe('none');
    });

    it('PATH 剥离 node 时：warning 可见 + copy/软链步骤仍完成 + exit 0', () => {
      seedPrimaryGraphWithCommit(worktreeHead());
      fs.writeFileSync(path.join(repo.primaryDir, '.env.local'), 'KEY=1');
      fs.writeFileSync(path.join(repo.primaryDir, 'CLAUDE.local.md'), '# 约定');

      // 只保留 git/bash 等基础工具目录，剔除 node 所在目录（用一个不含 node 的最小 PATH）
      const minimalPath = `${repo.stubBinDir}${path.delimiter}/usr/bin${path.delimiter}/bin`;
      const r = spawnSync('bash', [SCRIPT_PATH], {
        cwd: repo.worktreeDir,
        encoding: 'utf-8',
        env: { ...process.env, PATH: minimalPath },
      });

      expect(r.status ?? 0).toBe(0);
      expect(r.stderr).toContain('node 不可用');
      expect(fs.readFileSync(path.join(repo.worktreeDir, '.env.local'), 'utf-8')).toBe('KEY=1');
      expect(
        fs.lstatSync(path.join(repo.worktreeDir, 'CLAUDE.local.md')).isSymbolicLink(),
      ).toBe(true);
      expect(fs.existsSync(path.join(repo.worktreeDir, GRAPH_REL))).toBe(true);
    });
  });

  describe('Feature 239 — publish_exclusive 发布原语（C11 排他发布）', () => {
    /** 直调原语，绕开 copy_if_absent_atomic 的 `-e` 二次预检查。 */
    function runPublishProbe(tmp: string, target: string): SyncResult {
      return runSyncArgs(repo.worktreeDir, [], { PUBLISH_EXCLUSIVE_PROBE: `${tmp}|${target}` });
    }

    it('直调原语：target 已存在时不覆盖对方版本，且 tmp 被清理', () => {
      const tmp = path.join(repo.worktreeDir, 'publish.tmp');
      const target = path.join(repo.worktreeDir, 'publish-target.json');
      fs.writeFileSync(tmp, 'MINE');
      fs.writeFileSync(target, 'THEIRS');

      const r = runPublishProbe(tmp, target);

      expect(r.status).toBe(0);
      // (a) 对方版本不被覆盖
      expect(fs.readFileSync(target, 'utf-8')).toBe('THEIRS');
      // (b) 本次 tmp 被清理
      expect(fs.existsSync(tmp)).toBe(false);
    });

    it('直调原语：target 不存在时本进程赢得发布，内容为本次 tmp', () => {
      const tmp = path.join(repo.worktreeDir, 'publish.tmp');
      const target = path.join(repo.worktreeDir, 'publish-target.json');
      fs.writeFileSync(tmp, 'MINE');

      const r = runPublishProbe(tmp, target);

      expect(r.status).toBe(0);
      expect(fs.readFileSync(target, 'utf-8')).toBe('MINE');
      expect(fs.existsSync(tmp)).toBe(false);
    });

    // ── W1：ln 失败必须区分"对方已发布"与"真实错误" ──
    it('W1：ln 因真实错误失败（target 仍不存在）→ 明确 warn，不伪装成"对方已发布"', () => {
      const tmp = path.join(repo.worktreeDir, 'missing-source.tmp');
      const target = path.join(repo.worktreeDir, 'publish-target.json');
      // tmp 不存在 → ln 必失败，且失败后 target 依然不存在，属真实错误而非并发竞争
      expect(fs.existsSync(tmp)).toBe(false);

      const r = runPublishProbe(tmp, target);

      expect(r.stderr).toContain('发布失败');
      expect(r.stderr).not.toContain('已被其他进程发布');
      expect(fs.existsSync(target)).toBe(false);
    });

    it('W1：target 是 symlink 时不覆盖、不跟随（防 BSD ln 跟随目录 symlink 写到外部）', () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-outside-'));
      try {
        const tmp = path.join(repo.worktreeDir, 'publish.tmp');
        const target = path.join(repo.worktreeDir, 'publish-target.json');
        fs.writeFileSync(tmp, 'MINE');
        fs.symlinkSync(path.join(outside, 'decoy'), target);

        const r = runPublishProbe(tmp, target);

        expect(r.status).toBe(0);
        // target 仍是原 symlink，未被替换；symlink 指向的外部路径也没被创建
        expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
        expect(fs.existsSync(path.join(outside, 'decoy'))).toBe(false);
        expect(fs.existsSync(tmp)).toBe(false);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Codex implement review 修复轮：C2 / C3 / C5 / W2
  // ─────────────────────────────────────────────────────────────
  describe('Feature 239 修复轮 — containment 物理校验（C2）', () => {
    const PROBE_LOG_NAME = 'copy-path-probe.log';

    function runWithManifest(entries: string[]): SyncResult {
      writeWorktreeInclude(repo, entries);
      return runSyncArgs(repo.worktreeDir, [], {
        PROBE_LOG: path.join(repo.tempDir, PROBE_LOG_NAME),
      });
    }

    function probeLog(): string {
      const logPath = path.join(repo.tempDir, PROBE_LOG_NAME);
      return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
    }

    it('形态 1 final symlink：条目自身是 symlink → symlink-component 拒绝（消除 bash 接受 / node 拒绝的漂移）', () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-outside-'));
      try {
        const realFile = path.join(outside, 'real.env');
        fs.writeFileSync(realFile, 'OUTSIDE-SECRET');
        fs.symlinkSync(realFile, path.join(repo.primaryDir, '.env.local'));

        const r = runWithManifest(['.env.local']);

        expect(r.status).toBe(0);
        expect(r.stderr).toContain('[containment] symlink-component: .env.local');
        expect(probeLog()).not.toContain('.env.local');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('形态 2 intermediate symlink：`_reference` 型目录软链下的条目被拒绝', () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-outside-'));
      try {
        fs.mkdirSync(path.join(outside, 'graphify'), { recursive: true });
        fs.writeFileSync(path.join(outside, 'graphify', 'SECURITY.env'), 'OUTSIDE');
        fs.symlinkSync(outside, path.join(repo.primaryDir, '_reference'));
        // gitignore 让它满足 ignored 前提，把拒绝原因逼到 symlink 组件这一层
        fs.appendFileSync(path.join(repo.worktreeDir, '.gitignore'), '_reference\n');

        const r = runWithManifest(['_reference/graphify/SECURITY.env']);

        expect(r.status).toBe(0);
        expect(r.stderr).toMatch(/\[containment\] (symlink-component|check-ignore-error): _reference\/graphify\/SECURITY\.env/);
        expect(probeLog()).not.toContain('SECURITY.env');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('形态 3 target-parent symlink：source 侧干净但 target 侧父目录是软链 → 拒绝（否则写出 worktree）', () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-outside-'));
      try {
        fs.mkdirSync(path.join(repo.primaryDir, 'nested'), { recursive: true });
        fs.writeFileSync(path.join(repo.primaryDir, 'nested', 'local.env'), 'FROM-PRIMARY');
        fs.symlinkSync(outside, path.join(repo.worktreeDir, 'nested'));
        fs.appendFileSync(path.join(repo.worktreeDir, '.gitignore'), 'nested/\n');

        const r = runWithManifest(['nested/local.env']);

        expect(r.status).toBe(0);
        expect(r.stderr).toMatch(/\[containment\] (symlink-component|check-ignore-error): nested\/local\.env/);
        // 关键：外部目录内不得出现被写出的文件
        expect(fs.existsSync(path.join(outside, 'local.env'))).toBe(false);
        expect(probeLog()).not.toContain('nested/local.env');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('形态 4 git 128：check-ignore 返回 128 → check-ignore-error 拒绝（不再当作"未拒绝"放行）', () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-outside-'));
      try {
        fs.mkdirSync(path.join(outside, 'inner'), { recursive: true });
        fs.writeFileSync(path.join(outside, 'inner', 'x.env'), 'OUTSIDE');
        fs.symlinkSync(outside, path.join(repo.worktreeDir, 'linked'));
        fs.symlinkSync(outside, path.join(repo.primaryDir, 'linked'));

        const probe = spawnSync('git', ['check-ignore', '--quiet', '--', 'linked/inner/x.env'], {
          cwd: repo.worktreeDir,
        });
        expect(probe.status).toBe(128); // 先证实 git 确实返回 128

        const r = runWithManifest(['linked/inner/x.env']);

        expect(r.status).toBe(0);
        expect(r.stderr).toContain('[containment] check-ignore-error: linked/inner/x.env');
        expect(probeLog()).not.toContain('linked/inner/x.env');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('形态 5 manifest 引用穿 symlink 路径：合法条目照常 copy，非法条目被拒且不中断', () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-outside-'));
      try {
        // 刻意不用 `_reference` 这个名字——它本身是 SYMLINK_TARGETS 的一项，
        // 会被软链步骤正常建链，与本用例要观察的 copy 通道无关。
        fs.mkdirSync(path.join(outside, 'graphify'), { recursive: true });
        fs.writeFileSync(path.join(outside, 'graphify', 'leak.env'), 'OUTSIDE');
        fs.symlinkSync(outside, path.join(repo.primaryDir, 'linked-vendor'));
        fs.appendFileSync(path.join(repo.worktreeDir, '.gitignore'), 'linked-vendor\n');
        fs.writeFileSync(path.join(repo.primaryDir, '.env.local'), 'KEY=legal');

        const r = runWithManifest(['linked-vendor/graphify/leak.env', '.env.local']);

        expect(r.status).toBe(0);
        expect(r.stderr).toContain('[containment]');
        // 非法条目未落地，合法条目照常完成
        expect(fs.existsSync(path.join(repo.worktreeDir, 'linked-vendor'))).toBe(false);
        expect(fs.readFileSync(path.join(repo.worktreeDir, '.env.local'), 'utf-8')).toBe('KEY=legal');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('零误伤：现行清单唯一条目 .env.local（无 symlink 组件）照常 copy', () => {
      fs.writeFileSync(path.join(repo.primaryDir, '.env.local'), 'KEY=1');
      const r = runWithManifest(['.env.local']);
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain('[containment]');
      expect(fs.readFileSync(path.join(repo.worktreeDir, '.env.local'), 'utf-8')).toBe('KEY=1');
    });
  });

  describe('Feature 239 修复轮 — dry-run 绝不真实构建（C3）', () => {
    it('--dry-run --attempt-build：只打印拟执行计划，不 spawn 构建，图/状态/sidecar 零变化', () => {
      const marker = path.join(repo.tempDir, 'build-invoked.marker');
      // stub 一旦被真的调用就会留下 marker
      fs.writeFileSync(
        path.join(repo.stubBinDir, 'spectra'),
        [
          '#!/usr/bin/env bash',
          'set -u',
          'if [[ "${1:-}" == "batch" ]]; then',
          `  printf 'invoked\\n' > ${JSON.stringify(marker)}`,
          '  mkdir -p specs/_meta',
          `  printf '{"graph":{"sourceCommit":"deadbeef"}}' > specs/_meta/graph.json`,
          '  exit 0',
          'fi',
          `printf '{"freshness":{"state":"fresh"}}\\n'`,
          'exit 0',
          '',
        ].join('\n'),
        { mode: 0o755 },
      );
      const sidecar = path.join(repo.worktreeDir, 'specs/_meta/.graph-source-commit');
      fs.mkdirSync(path.dirname(sidecar), { recursive: true });
      fs.writeFileSync(sidecar, 'legacy\n');

      const r = runSyncArgs(repo.worktreeDir, ['--dry-run', '--attempt-build']);

      expect(r.status).toBe(0);
      expect(r.stderr).toContain('[dry-run] 拟执行本地构建');
      // 构建绝不能真的发生
      expect(fs.existsSync(marker)).toBe(false);
      expect(fs.existsSync(path.join(repo.worktreeDir, 'specs/_meta/graph.json'))).toBe(false);
      expect(
        fs.existsSync(path.join(repo.worktreeDir, 'specs/_meta/graph-bootstrap-status.json')),
      ).toBe(false);
      expect(fs.existsSync(sidecar)).toBe(true);
    });
  });

  describe('Feature 239 修复轮 — freshness 有界执行与未知态告警（C5/W2）', () => {
    it('C5：freshness CLI 卡死时 sync 仍在秒级返回并给出 warning（不无限阻塞）', () => {
      seedPrimaryGraphForFreshness();
      fs.writeFileSync(
        path.join(repo.stubBinDir, 'spectra'),
        `#!/usr/bin/env bash\ntrap '' TERM\nwhile true; do sleep 1; done\n`,
        { mode: 0o755 },
      );

      const started = Date.now();
      const r = runSyncVerbose(repo.worktreeDir);
      const elapsed = Date.now() - started;

      expect(r.status).toBe(0);
      expect(elapsed).toBeLessThan(40000);
      expect(r.stderr).toMatch(/unknown-provenance|freshness/);
    }, 60000);

    it('W2：未知 state（含 exit 3）→ shell 默认分支必须输出可见 warning 且回显原始值', () => {
      seedPrimaryGraphForFreshness();
      fs.writeFileSync(
        path.join(repo.stubBinDir, 'spectra'),
        [
          '#!/usr/bin/env bash',
          'set -u',
          'if [[ "${1:-}" == "graph-quality" ]]; then',
          `  printf '{"freshness":{"state":"definitely-ready"}}\\n'`,
          '  exit 3',
          'fi',
          'exit 0',
          '',
        ].join('\n'),
        { mode: 0o755 },
      );

      const r = runSyncVerbose(repo.worktreeDir);

      expect(r.status).toBe(0);
      expect(r.stderr).toContain('unknown-provenance');
    });

    /** 让 worktree 侧有一张图可供 freshness 检查。 */
    function seedPrimaryGraphForFreshness(): void {
      const graphPath = path.join(repo.primaryDir, 'specs/_meta/graph.json');
      fs.mkdirSync(path.dirname(graphPath), { recursive: true });
      fs.writeFileSync(graphPath, JSON.stringify({ graph: { sourceCommit: 'e'.repeat(40) } }));
    }
  });
});
