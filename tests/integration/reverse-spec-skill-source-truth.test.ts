import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve('.');

function runCommand(command: string, args: string[], cwd: string) {
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
  mkdirSync(join(projectRoot, 'src'), { recursive: true });

  cpSync(
    join(REPO_ROOT, 'plugins', 'reverse-spec'),
    join(projectRoot, 'plugins', 'reverse-spec'),
    { recursive: true },
  );
  mkdirSync(join(projectRoot, 'plugins', 'spec-driver', 'scripts', 'lib'), {
    recursive: true,
  });
  cpSync(
    join(REPO_ROOT, 'plugins', 'spec-driver', 'scripts', 'lib', 'simple-yaml.mjs'),
    join(projectRoot, 'plugins', 'spec-driver', 'scripts', 'lib', 'simple-yaml.mjs'),
  );
  cpSync(join(REPO_ROOT, '.claude-plugin'), join(projectRoot, '.claude-plugin'), {
    recursive: true,
  });
  cpSync(join(REPO_ROOT, 'src', 'skills-global'), join(projectRoot, 'src', 'skills-global'), {
    recursive: true,
  });
  cpSync(join(REPO_ROOT, 'skills'), join(projectRoot, 'skills'), { recursive: true });
}

describe('reverse-spec skill source-of-truth', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'reverse-spec-skill-source-'));
    copyRequiredTree(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('sync + validate 在 mirrors 一致时返回 pass', () => {
    const sync = runCommand(
      'node',
      [
        join(projectRoot, 'plugins', 'reverse-spec', 'scripts', 'sync-skill-mirrors.mjs'),
        '--project-root',
        projectRoot,
        '--json',
      ],
      projectRoot,
    );
    expect(sync.exitCode).toBe(0);

    const validate = runCommand(
      'node',
      [
        join(
          projectRoot,
          'plugins',
          'reverse-spec',
          'scripts',
          'validate-skill-sources.mjs',
        ),
        '--project-root',
        projectRoot,
        '--json',
      ],
      projectRoot,
    );
    expect(validate.exitCode).toBe(0);

    const payload = JSON.parse(validate.stdout) as {
      status: string;
      contractPath: string;
      checks: Array<{ id: string; status: string }>;
      errors: string[];
    };

    expect(payload.status).toBe('pass');
    expect(payload.contractPath).toBe(
      'plugins/reverse-spec/contracts/skill-source-of-truth.yaml',
    );
    expect(payload.errors).toEqual([]);
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'canonical-source-skills', status: 'pass' }),
        expect.objectContaining({ id: 'compatibility-mirrors', status: 'pass' }),
        expect.objectContaining({ id: 'plugin-metadata-sync', status: 'pass' }),
      ]),
    );
  });

  it('mirror 与 canonical source 不一致时返回 fail', () => {
    runCommand(
      'node',
      [
        join(projectRoot, 'plugins', 'reverse-spec', 'scripts', 'sync-skill-mirrors.mjs'),
        '--project-root',
        projectRoot,
        '--json',
      ],
      projectRoot,
    );

    const mirrorPath = join(projectRoot, 'skills', 'reverse-spec', 'SKILL.md');
    writeFileSync(
      mirrorPath,
      `${readFileSync(mirrorPath, 'utf-8')}\n<!-- drift -->\n`,
      'utf-8',
    );

    const validate = runCommand(
      'node',
      [
        join(
          projectRoot,
          'plugins',
          'reverse-spec',
          'scripts',
          'validate-skill-sources.mjs',
        ),
        '--project-root',
        projectRoot,
        '--json',
      ],
      projectRoot,
    );

    expect(validate.exitCode).toBe(1);
    const payload = JSON.parse(validate.stdout) as {
      status: string;
      errors: string[];
      checks: Array<{ id: string; status: string }>;
    };

    expect(payload.status).toBe('fail');
    expect(payload.errors.join('\n')).toContain('mirror 与 canonical source 不一致');
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'compatibility-mirrors', status: 'fail' }),
      ]),
    );
  });
});
