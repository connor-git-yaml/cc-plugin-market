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

function copyTree(projectRoot: string, relativePath: string) {
  const targetPath = join(projectRoot, relativePath);
  mkdirSync(join(targetPath, '..'), { recursive: true });
  cpSync(join(REPO_ROOT, relativePath), targetPath, { recursive: true });
}

describe('release contract sync', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'release-contract-'));

    copyTree(projectRoot, 'contracts');
    copyTree(projectRoot, 'scripts/lib');
    copyTree(projectRoot, 'plugins/spec-driver/scripts/lib');
    copyFile(projectRoot, 'scripts/sync-release-contracts.mjs');
    copyFile(projectRoot, 'scripts/validate-release-contracts.mjs');
    copyFile(projectRoot, 'README.md');
    copyFile(projectRoot, 'package.json');
    copyFile(projectRoot, 'package-lock.json');
    copyFile(projectRoot, '.claude-plugin/marketplace.json');
    copyFile(projectRoot, 'plugins/reverse-spec/.claude-plugin/plugin.json');
    copyFile(projectRoot, 'plugins/reverse-spec/README.md');
    copyFile(projectRoot, 'plugins/spec-driver/.claude-plugin/plugin.json');
    copyFile(projectRoot, 'plugins/spec-driver/README.md');
    copyFile(projectRoot, 'plugins/spec-driver/scripts/postinstall.sh');
    copyFile(projectRoot, 'specs/products/product-mapping.yaml');
    copyFile(projectRoot, 'specs/products/reverse-spec/current-spec.md');
    copyFile(projectRoot, 'specs/products/spec-driver/current-spec.md');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('sync 会把 release 相关版本与文案拉回合同值', () => {
    writeFileSync(
      join(projectRoot, 'plugins', 'spec-driver', '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'spec-driver',
        version: '0.0.1',
        description: 'stale',
      }, null, 2),
      'utf-8',
    );

    const sync = runNode(join(projectRoot, 'scripts', 'sync-release-contracts.mjs'), projectRoot);
    expect(sync.exitCode).toBe(0);

    const validate = runNode(join(projectRoot, 'scripts', 'validate-release-contracts.mjs'), projectRoot);
    expect(validate.exitCode).toBe(0);

    const payload = JSON.parse(validate.stdout) as {
      status: string;
      errors: string[];
    };
    expect(payload.status).toBe('pass');
    expect(payload.errors).toEqual([]);

    expect(readFileSync(join(projectRoot, 'package.json'), 'utf-8')).toContain('"version": "2.5.0"');
    expect(readFileSync(join(projectRoot, 'plugins', 'spec-driver', '.claude-plugin', 'plugin.json'), 'utf-8'))
      .toContain('"version": "3.11.0"');
    expect(readFileSync(join(projectRoot, 'plugins', 'spec-driver', 'README.md'), 'utf-8'))
      .toContain('> 当前发布版本: v3.11.0');
    expect(readFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', 'current-spec.md'), 'utf-8'))
      .toContain('> **发布版本**: v3.11.0');
  });

  it('validator 会显式报告 release drift', () => {
    const packageJsonPath = join(projectRoot, 'package.json');
    writeFileSync(
      packageJsonPath,
      readFileSync(packageJsonPath, 'utf-8').replace(
        /"version": "[^"]+"/,
        '"version": "0.9.0"',
      ),
      'utf-8',
    );

    const validate = runNode(join(projectRoot, 'scripts', 'validate-release-contracts.mjs'), projectRoot);
    expect(validate.exitCode).toBe(1);

    const payload = JSON.parse(validate.stdout) as {
      status: string;
      errors: string[];
    };
    expect(payload.status).toBe('fail');
    expect(payload.errors.join('\n')).toContain('reverse-spec package version');
  });
});
