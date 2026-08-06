import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
// 动态从 release-contract.yaml 读期望版本，避免 release 升版后测试再次 stale
import { loadReleaseContract } from '../../scripts/lib/release-contract-core.mjs';

const REPO_ROOT = resolve('.');
const { contract: RELEASE_CONTRACT } = loadReleaseContract(REPO_ROOT);
const SPEC_DRIVER_VERSION: string = RELEASE_CONTRACT.products['spec-driver'].version;

function runNode(scriptPath: string, projectRoot: string) {
  try {
    const stdout = execFileSync('node', [scriptPath, '--project-root', projectRoot, '--json'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    return { exitCode: 0, stdout };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    return {
      exitCode: execError.status ?? 1,
      stdout: `${execError.stdout ?? ''}${execError.stderr ?? ''}`,
    };
  }
}

interface CopyTreeOptions {
  /** 相对于被拷贝子树根的排除路径（分段级精确匹配，含其整棵子树） */
  exclude?: string[];
  /** 拷贝来源根目录，默认真实仓库根；测试自身校验 filter 行为时可指向合成 fixture */
  sourceRoot?: string;
}

function copyTree(projectRoot: string, relativePath: string, options: CopyTreeOptions = {}) {
  const sourcePath = join(options.sourceRoot ?? REPO_ROOT, relativePath);
  const targetPath = join(projectRoot, relativePath);
  const excludedPaths = (options.exclude ?? []).map((entry) => join(sourcePath, entry));
  mkdirSync(join(targetPath, '..'), { recursive: true });
  cpSync(sourcePath, targetPath, {
    recursive: true,
    // `excluded + sep` 的 sep 是承重的，不能退化成裸 `startsWith(excluded)`：后者会连**兄弟目录**
    // 一起剪掉——`.claude/worktrees-archive` 以 `.claude/worktrees` 为字符串前缀却是另一棵树。
    // 误剪的后果是沙箱缺文件，打红与本主题无关的断言。守护用例见下方「copyTree 子树排除」。
    filter: (src) => !excludedPaths.some((excluded) => src === excluded || src.startsWith(excluded + sep)),
  });
}

function copyFile(projectRoot: string, relativePath: string) {
  const targetPath = join(projectRoot, relativePath);
  mkdirSync(join(targetPath, '..'), { recursive: true });
  cpSync(join(REPO_ROOT, relativePath), targetPath);
}

describe('copyTree 子树排除', () => {
  it('剪掉 worktrees 子树，且不误伤兄弟前缀目录 worktrees-archive', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'repo-maintenance-src-'));
    const sandbox = mkdtempSync(join(tmpdir(), 'repo-maintenance-dst-'));
    try {
      mkdirSync(join(sourceRoot, '.claude', 'rules'), { recursive: true });
      writeFileSync(join(sourceRoot, '.claude', 'rules', 'tests.md'), '# rules', 'utf-8');
      writeFileSync(join(sourceRoot, '.claude', 'settings.local.json'), '{}', 'utf-8');
      // 🔴 判别力反例：**兄弟前缀**目录——绝对路径以 `<src>/.claude/worktrees` 为字符串前缀，
      // 却是另一棵树。裸 `startsWith(excluded)`（去掉 `+ sep`）会把它一起剪掉，本用例即转红。
      // 注意：`.claude/skills/worktrees-helper` 这类**另一棵子树下**的同名目录抓不到该变异
      // （它根本不以 excluded 为前缀），故必须用兄弟前缀形态，不能只放同名子目录。
      mkdirSync(join(sourceRoot, '.claude', 'worktrees-archive'), { recursive: true });
      writeFileSync(join(sourceRoot, '.claude', 'worktrees-archive', 'a.md'), '# archived', 'utf-8');
      // 附带反例：另一棵子树下含 "worktrees" 的路径（守 includes() 式子串匹配的退化）
      mkdirSync(join(sourceRoot, '.claude', 'skills', 'worktrees-helper'), { recursive: true });
      writeFileSync(join(sourceRoot, '.claude', 'skills', 'worktrees-helper', 'SKILL.md'), '# skill', 'utf-8');
      mkdirSync(join(sourceRoot, '.claude', 'worktrees', 'dummy'), { recursive: true });
      writeFileSync(join(sourceRoot, '.claude', 'worktrees', 'dummy', 'big-file'), 'x'.repeat(4096), 'utf-8');

      copyTree(sandbox, '.claude', { exclude: ['worktrees'], sourceRoot });

      expect(existsSync(join(sandbox, '.claude', 'worktrees'))).toBe(false);
      expect(existsSync(join(sandbox, '.claude', 'rules', 'tests.md'))).toBe(true);
      expect(existsSync(join(sandbox, '.claude', 'settings.local.json'))).toBe(true);
      // 兄弟前缀目录必须原样拷进沙箱——这一条是本用例对裸 startsWith 变异的唯一判别点
      expect(existsSync(join(sandbox, '.claude', 'worktrees-archive', 'a.md'))).toBe(true);
      expect(existsSync(join(sandbox, '.claude', 'skills', 'worktrees-helper', 'SKILL.md'))).toBe(true);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('repo maintenance sync/check', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'repo-maintenance-'));

    copyTree(projectRoot, 'contracts');
    copyTree(projectRoot, 'scripts');
    copyTree(projectRoot, 'plugins/spec-driver');
    copyTree(projectRoot, 'plugins/spectra');
    copyTree(projectRoot, '.claude-plugin');
    // `.claude/worktrees` 存放的是各 git worktree 的完整工作副本（主仓实测 2.6G，占 `.claude` 的
    // 全部体量），本用例只依赖 `.claude` 下的 rules / settings*.json / skills。整目录拷贝会把沙箱
    // 构造耗时绑死在 worktree 数量上，在全量并行下直接把本用例推到超时（同根因已第二次复发），
    // 且在 worktree 内跑时因 REPO_ROOT 取 cwd 而不可复现。排除后耗时与 worktree 数量解耦。
    copyTree(projectRoot, '.claude', { exclude: ['worktrees'] });
    copyTree(projectRoot, '.specify');
    copyTree(projectRoot, 'docs/shared');
    copyTree(projectRoot, 'specs/products');
    copyTree(projectRoot, 'skills');
    copyTree(projectRoot, 'src/skills-global');
    copyFile(projectRoot, 'README.md');
    copyFile(projectRoot, 'AGENTS.md');
    copyFile(projectRoot, 'CLAUDE.md');
    copyFile(projectRoot, 'package.json');
    copyFile(projectRoot, 'package-lock.json');
    copyFile(projectRoot, '.gitignore');
    // Codex implement 审查修复轮 W2（model-literal-gate fail-open 修复后的必需扫描面）：
    // `docs/configuration.md` 是 model-literal-gate 的 5 个 required 目标之一，
    // 未拷贝到隔离 fixture 会被新的 required-missing 判定为 fail，污染本测试主题
    // （repo:sync 重建受控产物）之外的断言。
    copyFile(projectRoot, 'docs/configuration.md');
    // Feature 239（C7）：第 15 族 worktree-local-state 对"清单文件缺失"判 fail 且不因非 git
    // 沙箱豁免（FR-001 硬性要求），必须随沙箱一起复制，否则新族接入即打红既有 pass 断言。
    copyFile(projectRoot, '.worktreeinclude');
    // Feature 213（T016）：codex-plugin-consistency 矩阵接入 validateRepository() 后，
    // marketplace-entries check 需要 tracked 的 Codex marketplace catalog 存在，否则隔离
    // fixture 会因缺文件报 error，使既有 status==='pass' 断言假失败。
    copyFile(projectRoot, '.agents/plugins/marketplace.json');

    rmSync(join(projectRoot, '.codex'), { recursive: true, force: true });

    // F219 C3：`.specify` 整目录拷贝会把仓内真实的 spec drift lock 一起带进隔离 fixture，
    // 但本 fixture **不拷贝 `dist/`**，于是 drift check 必然报 graph-unavailable（dist-missing）
    // → `spec-drift:analysis-environment` 判 warn → 整份 repo:check status 退化为 'warn'。
    // 本测试的主题是「repo:sync 重建受控产物后 repo:check 通过」，与 drift 锚点无关；
    // drift 在 dist 缺失下的降级行为由 spec-drift-repo-check-fallback / -modes 专门覆盖。
    // 故此处显式移除 lock，让 fixture 回到「无锚点」的中性状态（真实仓库 dist 存在时为 pass）。
    rmSync(join(projectRoot, '.specify', 'spec-drift.lock.json'), { force: true });

    // 链接 node_modules 使外部依赖（如 zod）在临时目录下可解析（orchestration-schema.mjs 等模块依赖 zod）
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(projectRoot, 'node_modules'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('repo:sync 会重建受控产物，repo:check 随后通过', () => {
    const agentPath = join(projectRoot, 'AGENTS.md');
    writeFileSync(agentPath, readFileSync(agentPath, 'utf-8').replace('## 发布合同约定', '## 漂移后的合同约定'), 'utf-8');

    const specDriverReadmePath = join(projectRoot, 'plugins', 'spec-driver', 'README.md');
    // 用正则匹配任意版本号，避免硬编码失效（Codex Finding 4：原代码 replace v3.11.2 是 no-op，导致 drift 注入失败）
    const originalReadme = readFileSync(specDriverReadmePath, 'utf-8');
    const driftedReadme = originalReadme.replace(/^> 当前发布版本: v[\d.]+/m, '> 当前发布版本: v0.0.1');
    expect(driftedReadme).toContain('> 当前发布版本: v0.0.1');
    expect(driftedReadme).not.toBe(originalReadme); // 确保 drift 实际注入
    writeFileSync(specDriverReadmePath, driftedReadme, 'utf-8');

    rmSync(join(projectRoot, 'skills', 'spectra'), { recursive: true, force: true });

    // Feature 213（WARNING 3）：删除 tracked skills-codex/，真守护 repo:sync 的
    // --sync-plugin-distribution flag 接线（防未来有人删 flag 而测试仍绿）。
    const distDir = join(projectRoot, 'plugins', 'spec-driver', 'skills-codex');
    rmSync(distDir, { recursive: true, force: true });
    expect(existsSync(distDir)).toBe(false);

    const sync = runNode(join(projectRoot, 'scripts', 'repo-sync.mjs'), projectRoot);
    expect(sync.exitCode).toBe(0);

    const syncPayload = JSON.parse(sync.stdout) as {
      status: string;
      steps: Array<{ id: string; status: string }>;
    };
    expect(syncPayload.status).toBe('pass');
    expect(syncPayload.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'agent-docs', status: 'pass' }),
        expect.objectContaining({ id: 'spectra-skills', status: 'pass' }),
        expect.objectContaining({ id: 'project-context-suggestions', status: 'pass' }),
      ]),
    );

    expect(existsSync(join(projectRoot, '.codex', 'skills', 'spec-driver-implement', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'skills', 'spectra', 'SKILL.md'))).toBe(true);

    // Feature 213（WARNING 3）/238（T1.8）：skills-codex/ 被 repo:sync 重新生成 9 项，
    // 且与 .codex/skills 逐字节一致
    const SPEC_DRIVER_SKILLS = [
      'spec-driver-constitution',
      'spec-driver-feature',
      'spec-driver-implement',
      'spec-driver-story',
      'spec-driver-fix',
      'spec-driver-resume',
      'spec-driver-sync',
      'spec-driver-doc',
      'spec-driver-refactor',
    ];
    const codexDir = join(projectRoot, '.codex', 'skills');
    for (const skill of SPEC_DRIVER_SKILLS) {
      const distFile = join(distDir, skill, 'SKILL.md');
      const codexFile = join(codexDir, skill, 'SKILL.md');
      expect(existsSync(distFile)).toBe(true);
      expect(readFileSync(distFile)).toEqual(readFileSync(codexFile));
    }

    const check = runNode(join(projectRoot, 'scripts', 'repo-check.mjs'), projectRoot);
    expect(check.exitCode).toBe(0);

    const checkPayload = JSON.parse(check.stdout) as {
      status: string;
      errors: string[];
      checks: Array<{ id: string; status: string }>;
    };

    expect(checkPayload.status).toBe('pass');
    expect(checkPayload.errors).toEqual([]);
    expect(checkPayload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'agent-docs:shared-section:repo-maintenance', status: 'pass' }),
        expect.objectContaining({ id: 'marketplace:marketplace-plugin-entries', status: 'pass' }),
        expect.objectContaining({ id: 'runtime-boundaries:ignored-runtime-paths', status: 'pass' }),
        expect.objectContaining({ id: 'release-contract:plugin-version:spec-driver', status: 'pass' }),
        // Feature 213（T016）：codex-plugin-consistency 矩阵经 aggregateValidation 进入聚合 checks[]
        expect.objectContaining({ id: 'codex-plugin-consistency:manifest-exists:spectra', status: 'pass' }),
        expect.objectContaining({ id: 'codex-plugin-consistency:skills-reference:spec-driver', status: 'pass' }),
        expect.objectContaining({ id: 'codex-plugin-consistency:marketplace-entries', status: 'pass' }),
      ]),
    );

    expect(readFileSync(specDriverReadmePath, 'utf-8')).toContain(`> 当前发布版本: v${SPEC_DRIVER_VERSION}`);
    expect(readFileSync(agentPath, 'utf-8')).toContain('## 仓库级同步约定');
  });

  // Feature 239（W4）：第 15 族接线证据。只断言"整体 pass"无法证明新族真的被注册——
  // 一个从未被调用的 validator 同样不会产生 error。必须显式断言该前缀的 check 出现在结果集里。
  it('repo:check 输出含 worktree-local-state 第 15 族且为 pass', () => {
    // 沙箱在 beforeEach 里被刻意移除了 `.codex`（由 repo:sync 重建），因此与既有用例一样
    // 先 sync 再 check，否则整体 exitCode 会因与本族无关的 codex 产物缺失而非零。
    expect(runNode(join(projectRoot, 'scripts', 'repo-sync.mjs'), projectRoot).exitCode).toBe(0);

    const check = runNode(join(projectRoot, 'scripts', 'repo-check.mjs'), projectRoot);
    const payload = JSON.parse(check.stdout) as {
      status: string;
      checks: Array<{ id: string; status: string }>;
    };

    const familyChecks = payload.checks.filter((item) => item.id.startsWith('worktree-local-state:'));
    expect(familyChecks.length).toBeGreaterThan(0);
    // 沙箱不是 git 仓库：ignored 子检查降级为 skip，其余子检查必须 pass，整体不得出现 fail
    expect(familyChecks.every((item) => item.status === 'pass' || item.status === 'skip')).toBe(true);
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'worktree-local-state:worktreeinclude-exists', status: 'pass' }),
        expect.objectContaining({ id: 'worktree-local-state:worktreeinclude-entries', status: 'pass' }),
      ]),
    );
    expect(check.exitCode).toBe(0);
  });
});
