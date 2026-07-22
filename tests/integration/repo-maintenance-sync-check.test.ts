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
import { join, resolve } from 'node:path';
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

function copyTree(projectRoot: string, relativePath: string) {
  const targetPath = join(projectRoot, relativePath);
  mkdirSync(join(targetPath, '..'), { recursive: true });
  cpSync(join(REPO_ROOT, relativePath), targetPath, { recursive: true });
}

function copyFile(projectRoot: string, relativePath: string) {
  const targetPath = join(projectRoot, relativePath);
  mkdirSync(join(targetPath, '..'), { recursive: true });
  cpSync(join(REPO_ROOT, relativePath), targetPath);
}

describe('repo maintenance sync/check', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'repo-maintenance-'));

    copyTree(projectRoot, 'contracts');
    copyTree(projectRoot, 'scripts');
    copyTree(projectRoot, 'plugins/spec-driver');
    copyTree(projectRoot, 'plugins/spectra');
    copyTree(projectRoot, '.claude-plugin');
    copyTree(projectRoot, '.claude');
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

    // Feature 213（WARNING 3）：skills-codex/ 被 repo:sync 重新生成 8 项，且与 .codex/skills 逐字节一致
    const SPEC_DRIVER_SKILLS = [
      'spec-driver-constitution',
      'spec-driver-feature',
      'spec-driver-implement',
      'spec-driver-story',
      'spec-driver-fix',
      'spec-driver-resume',
      'spec-driver-sync',
      'spec-driver-doc',
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
});
