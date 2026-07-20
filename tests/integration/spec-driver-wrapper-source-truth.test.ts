import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve('.');

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: 'utf-8',
      timeout: 20_000,
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: `${execError.stdout ?? ''}${execError.stderr ?? ''}`,
      exitCode: execError.status ?? 1,
    };
  }
}

function copyRequiredTree(projectRoot: string) {
  mkdirSync(join(projectRoot, 'plugins'), { recursive: true });
  mkdirSync(join(projectRoot, '.claude', 'commands'), { recursive: true });

  cpSync(join(REPO_ROOT, 'plugins', 'spec-driver'), join(projectRoot, 'plugins', 'spec-driver'), {
    recursive: true,
  });
  cpSync(join(REPO_ROOT, '.claude-plugin'), join(projectRoot, '.claude-plugin'), { recursive: true });
}

describe('validate-wrapper-sources.mjs', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'spec-driver-wrapper-contract-'));
    copyRequiredTree(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('在 source、wrapper 与 override 同步时返回 pass', () => {
    const install = runCommand(
      'bash',
      [join(projectRoot, 'plugins', 'spec-driver', 'scripts', 'codex-skills.sh'), 'install'],
      projectRoot,
    );
    expect(install.exitCode).toBe(0);

    const result = runCommand(
      'node',
      [
        join(projectRoot, 'plugins', 'spec-driver', 'scripts', 'validate-wrapper-sources.mjs'),
        '--project-root',
        projectRoot,
        '--json',
      ],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      status: string;
      contractPath: string;
      checks: Array<{ id: string; status: string; evidence: Record<string, unknown> }>;
      errors: string[];
    };

    expect(payload.status).toBe('pass');
    expect(payload.contractPath).toBe('plugins/spec-driver/contracts/wrapper-source-of-truth.yaml');
    expect(payload.errors).toEqual([]);
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'source-skills', status: 'pass' }),
        expect.objectContaining({ id: 'codex-wrapper-markers', status: 'pass' }),
        expect.objectContaining({ id: 'claude-project-overrides', status: 'pass' }),
        expect.objectContaining({ id: 'plugin-metadata-sync', status: 'pass' }),
      ]),
    );
  });

  it('[Feature 213] codex-wrapper-markers 与 codex-plugin-distribution-markers 同过', () => {
    // 带 flag 安装：同时生成 .codex/skills 与 tracked 的 plugins/spec-driver/skills-codex/
    const install = runCommand(
      'bash',
      [
        join(projectRoot, 'plugins', 'spec-driver', 'scripts', 'codex-skills.sh'),
        'install',
        '--sync-plugin-distribution',
      ],
      projectRoot,
    );
    expect(install.exitCode).toBe(0);

    const result = runCommand(
      'node',
      [
        join(projectRoot, 'plugins', 'spec-driver', 'scripts', 'validate-wrapper-sources.mjs'),
        '--project-root',
        projectRoot,
        '--json',
      ],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      status: string;
      checks: Array<{ id: string; status: string }>;
      errors: string[];
    };

    expect(payload.status).toBe('pass');
    expect(payload.errors).toEqual([]);
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'codex-wrapper-markers', status: 'pass' }),
        expect.objectContaining({ id: 'codex-plugin-distribution-markers', status: 'pass' }),
      ]),
    );
  });

  it('[Feature 213] 仅篡改 skills-codex wrapper → distribution check fail 而 .codex check pass（证明两 check 看不同目录）', () => {
    const install = runCommand(
      'bash',
      [
        join(projectRoot, 'plugins', 'spec-driver', 'scripts', 'codex-skills.sh'),
        'install',
        '--sync-plugin-distribution',
      ],
      projectRoot,
    );
    expect(install.exitCode).toBe(0);

    // 仅篡改 skills-codex 中某个 wrapper（删除该文件；.codex/skills 保持原样）
    const distWrapper = join(
      projectRoot,
      'plugins',
      'spec-driver',
      'skills-codex',
      'spec-driver-feature',
      'SKILL.md',
    );
    rmSync(distWrapper, { force: true });

    const result = runCommand(
      'node',
      [
        join(projectRoot, 'plugins', 'spec-driver', 'scripts', 'validate-wrapper-sources.mjs'),
        '--project-root',
        projectRoot,
        '--json',
      ],
      projectRoot,
    );

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout) as {
      status: string;
      checks: Array<{ id: string; status: string }>;
      errors: string[];
    };
    expect(payload.status).toBe('fail');
    // .codex/skills 未动 → codex-wrapper-markers 仍 pass；仅分发目录被篡改 → distribution check fail
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'codex-wrapper-markers', status: 'pass' }),
        expect.objectContaining({ id: 'codex-plugin-distribution-markers', status: 'fail' }),
      ]),
    );
    // 修复提示应为 repo:sync（普通 install 无法修分发目录）
    expect(payload.errors.join('\n')).toContain('repo:sync');
  });

  it('在 wrapper 缺少 source contract 标记时返回 fail', () => {
    runCommand(
      'bash',
      [join(projectRoot, 'plugins', 'spec-driver', 'scripts', 'codex-skills.sh'), 'install'],
      projectRoot,
    );

    const wrapperPath = join(
      projectRoot,
      '.codex',
      'skills',
      'spec-driver-feature',
      'SKILL.md',
    );
    const content = readFileSync(wrapperPath, 'utf-8').replace(
      '## Wrapper Source Contract',
      '## Wrapper Contract Removed',
    );
    writeFileSync(wrapperPath, content, 'utf-8');

    const result = runCommand(
      'node',
      [
        join(projectRoot, 'plugins', 'spec-driver', 'scripts', 'validate-wrapper-sources.mjs'),
        '--project-root',
        projectRoot,
        '--json',
      ],
      projectRoot,
    );

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout) as {
      status: string;
      errors: string[];
      checks: Array<{ id: string; status: string }>;
    };
    expect(payload.status).toBe('fail');
    expect(payload.errors.join('\n')).toContain('wrapper source contract 标记');
    expect(payload.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'codex-wrapper-markers', status: 'fail' })]),
    );
  });
});
