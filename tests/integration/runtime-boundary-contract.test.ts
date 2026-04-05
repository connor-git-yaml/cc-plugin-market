import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve('.');

function runNode(scriptPath: string, projectRoot: string) {
  try {
    const stdout = execFileSync('node', [scriptPath, '--project-root', projectRoot, '--json'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 20_000,
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

function copyFile(projectRoot: string, relativePath: string) {
  const targetPath = join(projectRoot, relativePath);
  mkdirSync(join(targetPath, '..'), { recursive: true });
  cpSync(join(REPO_ROOT, relativePath), targetPath);
}

describe('runtime boundary contract', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'runtime-boundary-'));

    copyFile(projectRoot, 'contracts/runtime-boundary-contract.yaml');
    copyFile(projectRoot, 'scripts/validate-runtime-boundaries.mjs');
    copyFile(projectRoot, 'scripts/lib/runtime-boundary-core.mjs');
    copyFile(projectRoot, 'plugins/spec-driver/scripts/lib/simple-yaml.mjs');
    copyFile(projectRoot, 'plugins/spec-driver/scripts/lib/script-cli-args.mjs');
    copyFile(projectRoot, '.gitignore');

    mkdirSync(join(projectRoot, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: {} }, null, 2), 'utf-8');
    writeFileSync(join(projectRoot, '.claude', 'commands', 'spec-driver.implement.md'), '# override\n', 'utf-8');

    mkdirSync(join(projectRoot, '.specify', 'memory'), { recursive: true });
    mkdirSync(join(projectRoot, '.specify', 'templates'), { recursive: true });
    writeFileSync(join(projectRoot, '.specify', 'project-context.yaml'), 'product:\n  name: "demo"\n', 'utf-8');
    writeFileSync(join(projectRoot, '.specify', 'project-context.suggestions.yaml'), 'status: pass\n', 'utf-8');
    writeFileSync(join(projectRoot, '.specify', 'project-context.suggestions.md'), '# Suggestions\n', 'utf-8');
    writeFileSync(join(projectRoot, '.specify', 'memory', 'constitution.md'), '# Constitution\n', 'utf-8');
    writeFileSync(join(projectRoot, '.specify', 'templates', 'plan-template.md'), '# Plan\n', 'utf-8');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('在必需文件和忽略规则齐备时返回 pass', () => {
    const result = runNode(join(projectRoot, 'scripts', 'validate-runtime-boundaries.mjs'), projectRoot);
    expect(result.exitCode).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      status: string;
      errors: string[];
      warnings: string[];
      checks: Array<{ id: string; status: string }>;
    };

    expect(payload.status).toBe('pass');
    expect(payload.errors).toEqual([]);
    expect(payload.warnings).toEqual([]);
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'ignored-runtime-paths', status: 'pass' }),
        expect.objectContaining({ id: 'required-controlled-files', status: 'pass' }),
      ]),
    );
  });

  it('缺少运行态忽略规则时返回 fail', () => {
    writeFileSync(
      join(projectRoot, '.gitignore'),
      ['.specify/.spec-driver-path', '.ag*'].join('\n'),
      'utf-8',
    );

    const result = runNode(join(projectRoot, 'scripts', 'validate-runtime-boundaries.mjs'), projectRoot);
    expect(result.exitCode).toBe(1);

    const payload = JSON.parse(result.stdout) as {
      status: string;
      errors: string[];
    };

    expect(payload.status).toBe('fail');
    expect(payload.errors.join('\n')).toContain('.specify/runs/');
  });
});
