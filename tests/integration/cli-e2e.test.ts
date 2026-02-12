/**
 * CLI 端到端集成测试
 * 测试 generate/batch/diff 子命令通过 node dist/cli/index.js 运行
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI_PATH = resolve('dist/cli/index.js');

function runCLI(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 10_000,
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

describe('CLI 端到端测试', () => {
  beforeAll(() => {
    // 确保编译产物存在
    execFileSync('npm', ['run', 'build'], { encoding: 'utf-8' });
  });

  describe('--version', () => {
    it('输出版本号并退出码为 0', () => {
      const result = runCLI(['--version']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/reverse-spec v\d+\.\d+\.\d+/);
    });
  });

  describe('--help', () => {
    it('输出帮助信息并退出码为 0', () => {
      const result = runCLI(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('generate');
      expect(result.stdout).toContain('batch');
      expect(result.stdout).toContain('diff');
    });
  });

  describe('无效子命令', () => {
    it('输出错误信息并退出码为 1', () => {
      const result = runCLI(['invalid']);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('未知子命令');
    });
  });

  describe('generate 缺少 target', () => {
    it('输出错误并退出码为 1', () => {
      const result = runCLI(['generate']);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('需要指定目标路径');
    });
  });

  describe('generate 目标不存在', () => {
    it('输出目标路径不存在并退出码为 1', () => {
      const result = runCLI(['generate', 'nonexistent/path/']);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('不存在');
    });
  });

  describe('generate 无 API Key', () => {
    it('输出 API Key 错误并退出码为 2', () => {
      const result = runCLI(['generate', 'src/']);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain('ANTHROPIC_API_KEY');
    });
  });

  describe('无参数', () => {
    it('输出帮助信息', () => {
      const result = runCLI([]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('reverse-spec');
      expect(result.stdout).toContain('用法');
    });
  });

  describe('-v 短选项', () => {
    it('输出版本号', () => {
      const result = runCLI(['-v']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/v\d+\.\d+\.\d+/);
    });
  });
});
