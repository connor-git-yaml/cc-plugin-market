/**
 * Spec Driver Codex skills 安装脚本集成测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const SCRIPT_PATH = resolve('plugins/spec-driver/scripts/codex-skills.sh');

function runScript(
  args: string[],
  options?: { cwd?: string; home?: string },
): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('bash', [SCRIPT_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 10_000,
      cwd: options?.cwd ?? process.cwd(),
      env: {
        ...process.env,
        HOME: options?.home ?? process.env['HOME'],
      },
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (error.stdout ?? '') + (error.stderr ?? ''),
      exitCode: error.status ?? 1,
    };
  }
}

describe('Spec Driver Codex skills script', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'spec-driver-codex-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('project 安装并移除 codex 包装技能', () => {
    const install = runScript(['install'], { cwd: tempDir });
    expect(install.exitCode).toBe(0);
    expect(install.stdout).toContain('安装完成');

    expect(
      existsSync(
        join(tempDir, '.codex', 'skills', 'spec-driver-feature', 'SKILL.md'),
      ),
    ).toBe(true);
    expect(
      existsSync(join(tempDir, '.codex', 'skills', 'spec-driver-doc', 'SKILL.md')),
    ).toBe(true);

    const storyWrapper = readFileSync(
      join(tempDir, '.codex', 'skills', 'spec-driver-story', 'SKILL.md'),
      'utf-8',
    );
    expect(storyWrapper).toContain('model_compat.defaults.codex');
    expect(storyWrapper).toContain('opus/sonnet');

    const remove = runScript(['remove'], { cwd: tempDir });
    expect(remove.exitCode).toBe(0);
    expect(remove.stdout).toContain('已移除');
    expect(
      existsSync(join(tempDir, '.codex', 'skills', 'spec-driver-feature')),
    ).toBe(false);
  });

  it('global 模式写入 HOME/.codex/skills（隔离 HOME）', () => {
    const fakeHome = join(tempDir, 'fake-home');
    const result = runScript(['install', '--global'], {
      cwd: tempDir,
      home: fakeHome,
    });

    expect(result.exitCode).toBe(0);
    expect(
      existsSync(join(fakeHome, '.codex', 'skills', 'spec-driver-sync', 'SKILL.md')),
    ).toBe(true);

    const wrapperContent = readFileSync(
      join(fakeHome, '.codex', 'skills', 'spec-driver-feature', 'SKILL.md'),
      'utf-8',
    );
    expect(wrapperContent).toContain(
      resolve('plugins/spec-driver/skills/speckit-feature/SKILL.md'),
    );
  });

  it('project 模式在 git 子目录执行时安装到 git 根目录', () => {
    const repoRoot = join(tempDir, 'repo');
    mkdirSync(repoRoot, { recursive: true });
    execFileSync('git', ['init'], { cwd: repoRoot, encoding: 'utf-8' });
    const nestedCwd = join(repoRoot, 'apps', 'web');
    mkdirSync(nestedCwd, { recursive: true });

    const result = runScript(['install'], { cwd: nestedCwd });
    expect(result.exitCode).toBe(0);
    expect(
      existsSync(join(repoRoot, '.codex', 'skills', 'spec-driver-feature', 'SKILL.md')),
    ).toBe(true);
  });
});
