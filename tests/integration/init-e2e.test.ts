/**
 * init 子命令端到端集成测试
 * 通过 node dist/cli/index.js init 调用编译后的 CLI
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CLI_PATH = resolve('dist/cli/index.js');

function runCLI(
  args: string[],
  options?: { cwd?: string },
): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 10_000,
      cwd: options?.cwd ?? process.cwd(),
      env: { ...process.env, ANTHROPIC_API_KEY: undefined },
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

describe('init 端到端测试', () => {
  let tempDir: string;

  beforeAll(() => {
    // 确保编译产物存在
    execFileSync('npm', ['run', 'build'], {
      encoding: 'utf-8',
      timeout: 60_000,
    });
  });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'init-e2e-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('init 默认安装到当前目录的 .claude/skills/', () => {
    const result = runCLI(['init'], { cwd: tempDir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('安装完成');

    // 验证文件存在
    expect(
      existsSync(join(tempDir, '.claude', 'skills', 'reverse-spec', 'SKILL.md')),
    ).toBe(true);
    expect(
      existsSync(
        join(tempDir, '.claude', 'skills', 'reverse-spec-batch', 'SKILL.md'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(tempDir, '.claude', 'skills', 'reverse-spec-diff', 'SKILL.md'),
      ),
    ).toBe(true);
  });

  it('init 安装的 SKILL.md 包含降级逻辑', () => {
    runCLI(['init'], { cwd: tempDir });

    const content = readFileSync(
      join(tempDir, '.claude', 'skills', 'reverse-spec', 'SKILL.md'),
      'utf-8',
    );

    // 验证内联降级逻辑
    expect(content).toContain('command -v reverse-spec');
    expect(content).toContain('npm_config_yes=true npx reverse-spec');
    expect(content).toContain('npm install -g reverse-spec');
  });

  it('init --remove 清理已安装 skill', () => {
    // 先安装
    runCLI(['init'], { cwd: tempDir });
    expect(
      existsSync(join(tempDir, '.claude', 'skills', 'reverse-spec')),
    ).toBe(true);

    // 再移除
    const result = runCLI(['init', '--remove'], { cwd: tempDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('已移除');

    // 验证目录已删除
    expect(
      existsSync(join(tempDir, '.claude', 'skills', 'reverse-spec')),
    ).toBe(false);
  });

  it('init --remove 无 skill 时退出码 0', () => {
    const result = runCLI(['init', '--remove'], { cwd: tempDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('无需清理');
  });

  it('--help 包含 init 信息', () => {
    const result = runCLI(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('init');
    expect(result.stdout).toContain('--global');
    expect(result.stdout).toContain('--remove');
  });

  it('--version 正常工作', () => {
    const result = runCLI(['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/reverse-spec v\d+\.\d+\.\d+/);
  });

  it('init 重复执行显示 已更新', () => {
    // 首次安装
    runCLI(['init'], { cwd: tempDir });

    // 二次安装
    const result = runCLI(['init'], { cwd: tempDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('已更新');
  });
});
