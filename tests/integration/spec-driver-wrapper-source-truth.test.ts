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
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });

  cpSync(join(REPO_ROOT, 'plugins', 'spec-driver'), join(projectRoot, 'plugins', 'spec-driver'), {
    recursive: true,
  });
  cpSync(join(REPO_ROOT, '.claude-plugin'), join(projectRoot, '.claude-plugin'), { recursive: true });
  cpSync(join(REPO_ROOT, '.claude', 'commands'), join(projectRoot, '.claude', 'commands'), {
    recursive: true,
  });
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
