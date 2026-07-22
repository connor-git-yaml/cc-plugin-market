/**
 * CLI 端到端集成测试
 * 测试 generate/batch/diff 子命令通过 node dist/cli/index.js 运行
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';

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
    // 确保编译产物存在。`npm run build` 在 CI 冷缓存环境常超 10s（vitest hook 默认上限），
    // 显式给 60s hook timeout 匹配 execFileSync 的 60_000ms 子进程超时。
    execFileSync('npm', ['run', 'build'], {
      encoding: 'utf-8',
      timeout: 60_000,
    });
  }, 60_000);

  describe('--version', () => {
    it('输出版本号并退出码为 0', () => {
      const result = runCLI(['--version']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/spectra v\d+\.\d+\.\d+/);
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
    it('根据环境认证状态输出相应结果', () => {
      // --output-dir 指向临时目录：Feature 222 起零认证不再入口硬退，而是降级跑完并写盘，
      // 不隔离输出会把 AST-only 降档产物写进 git 跟踪的 specs/src.spec.md 污染工作树。
      const outDir = mkdtempSync(join(tmpdir(), 'spectra-e2e-out-'));
      try {
        const result = runCLI(['generate', 'src/', '--output-dir', outDir]);
        // 行为取决于环境：
        // 1. Claude CLI 已安装 + Keychain 有凭证：认证门控通过，命令尝试通过 CLI 代理执行
        //    （可能成功 / 失败 / 超时）
        // 2. 无任何认证方式（Feature 222 起）：默认降级为 AST-only 继续执行，
        //    exitCode 通常为 0；exitCode 2 仅在显式传 --require-llm 时出现
        // 两种情况都是合理的，取决于开发环境；真正的零认证强断言见下方隔离套件
        expect(typeof result.exitCode).toBe('number');
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    });
  });

  describe('无参数', () => {
    it('输出帮助信息', () => {
      const result = runCLI([]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('spectra');
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

/**
 * Feature 222 — 真零认证隔离 E2E
 *
 * why 需要真隔离：上面那条「generate 无 API Key」用例只清了 API key，仍继承开发机的
 * HOME 与 PATH（即 Claude / Codex CLI 登录态），断言也只检查 exitCode 是数字——任何行为
 * 都能通过。这正是"零认证被硬门吞掉降级"能长期潜伏未被发现的根因。
 *
 * 隔离手段（不依赖开发机是否登录）：
 * - HOME 指向空临时目录 → `~/.codex/auth.json` 落空
 * - PATH 只含「仅有 node 软链的目录 + /usr/bin:/bin」→ `which claude` / `which codex` 落空
 * - 不注入 ANTHROPIC_API_KEY
 */
describe.skipIf(process.platform === 'win32')('CLI 零认证隔离端到端测试 (Feature 222)', () => {
  let fixtureDir: string;
  let fakeHome: string;
  let fakeBin: string;
  let zeroAuthEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { encoding: 'utf-8', timeout: 60_000 });

    fixtureDir = mkdtempSync(join(tmpdir(), 'spectra-zero-auth-fixture-'));
    writeFileSync(
      join(fixtureDir, 'alpha.ts'),
      'export function alpha(name: string): string {\n  return `hello ${name}`;\n}\n',
      'utf-8',
    );

    fakeHome = mkdtempSync(join(tmpdir(), 'spectra-zero-auth-home-'));
    fakeBin = mkdtempSync(join(tmpdir(), 'spectra-zero-auth-bin-'));
    symlinkSync(process.execPath, join(fakeBin, 'node'));

    zeroAuthEnv = { HOME: fakeHome, PATH: `${fakeBin}:/usr/bin:/bin` };
  }, 60_000);

  afterAll(() => {
    for (const dir of [fixtureDir, fakeHome, fakeBin]) {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function runIsolated(args: string[]): { output: string; exitCode: number } {
    const r = spawnSync(process.execPath, [CLI_PATH, ...args], {
      cwd: fixtureDir,
      env: zeroAuthEnv,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    return { output: `${r.stdout ?? ''}${r.stderr ?? ''}`, exitCode: r.status ?? 1 };
  }

  it('前置条件：隔离环境里 claude / codex 均不可见（否则本套件断言无意义）', () => {
    const probe = spawnSync('/bin/sh', ['-c', 'which claude; which codex'], {
      env: zeroAuthEnv,
      encoding: 'utf-8',
    });
    expect(probe.stdout.trim()).toBe('');
  });

  it('默认路径：零认证时提示降级并继续执行，产出 spec 且退出码为 0', () => {
    const outDir = join(fixtureDir, 'specs-default');
    const result = runIsolated(['generate', 'alpha.ts', '--output-dir', outDir]);

    expect(result.output).toContain('未检测到可用的 LLM 认证方式');
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(outDir, 'alpha.spec.md'))).toBe(true);
  }, 90_000);

  it('--require-llm：零认证时入口阻断，退出码为 2 且不产出 spec', () => {
    const outDir = join(fixtureDir, 'specs-strict');
    const result = runIsolated([
      'generate',
      'alpha.ts',
      '--require-llm',
      '--output-dir',
      outDir,
    ]);

    expect(result.exitCode).toBe(2);
    expect(existsSync(join(outDir, 'alpha.spec.md'))).toBe(false);
  }, 90_000);
});
