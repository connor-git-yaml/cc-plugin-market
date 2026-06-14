import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 从测试文件位置推导仓库根（tests/integration/ → 上两级），避免 worktree 下 cwd 不确定
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CLI_PATH = resolve(REPO_ROOT, 'plugins/spec-driver/scripts/orchestrator-cli.mjs');

// effective-orchestration --format json 输出 { config, fieldSources, diagnostics }
interface EffectiveOrchestrationJson {
  config: {
    modes?: Record<string, { name?: string; description?: string; phases?: unknown[] } | undefined>;
  };
  fieldSources: Record<string, string>;
  diagnostics: Array<{ level: string; code: string; message: string }>;
}

// 缺 zod 子进程注入 env；CLI 内部经 load-zod.mjs 的 SPEC_DRIVER_FORCE_ZOD_MISSING seam 走缺失分支
const forceMissingEnv = { ...process.env, SPEC_DRIVER_FORCE_ZOD_MISSING: '1' };

/**
 * 在缺 zod 子进程内执行 CLI，单次调用同时捕获 status / stdout / stderr。
 * 用 spawnSync（不抛错）一次拿全三者，避免重复跑子进程。
 */
function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    env: forceMissingEnv,
    encoding: 'utf-8',
    cwd: REPO_ROOT,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('orchestration zod 缺失子进程降级 — effective-orchestration fix', () => {
  it('AC-1：effective-orchestration fix --format json 退出码 0 且 stdout 为有效 JSON', () => {
    const { status, stdout } = runCli(['effective-orchestration', 'fix', '--format', 'json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as EffectiveOrchestrationJson;
    expect(parsed).toBeDefined();
    expect(parsed.config).toBeDefined();
  });

  it('AC-1：diagnostics 含且仅含一条 orchestration.zod-unavailable warning', () => {
    const { stdout } = runCli(['effective-orchestration', 'fix', '--format', 'json']);
    const parsed = JSON.parse(stdout) as EffectiveOrchestrationJson;
    const zodWarnings = parsed.diagnostics.filter(
      (d) => d.code === 'orchestration.zod-unavailable',
    );
    expect(zodWarnings).toHaveLength(1);
    expect(zodWarnings[0].level).toBe('warning');
  });

  it('AC-1：config.modes.fix 存在且非 null（真实 base 编排被保留，非最小桩）', () => {
    const { stdout } = runCli(['effective-orchestration', 'fix', '--format', 'json']);
    const parsed = JSON.parse(stdout) as EffectiveOrchestrationJson;
    expect(parsed.config.modes).toBeDefined();
    expect(parsed.config.modes?.fix).toBeDefined();
    expect(parsed.config.modes?.fix).not.toBeNull();
    expect(Array.isArray(parsed.config.modes?.fix?.phases)).toBe(true);
  });

  it('AC-1：降级路径经 stderr 透出 orchestration.zod-unavailable 诊断（isFallback 语义佐证）', () => {
    const { stderr } = runCli(['effective-orchestration', 'fix', '--format', 'json']);
    expect(stderr).toContain('orchestration.zod-unavailable');
  });
});

describe('orchestration zod 缺失子进程降级 — generate-template & 多 mode', () => {
  it('AC-2：generate-template fix 退出码 0（isBaseInvalid: false 保证 CLI 不误拒）', () => {
    const { status, stdout } = runCli(['generate-template', 'fix']);
    expect(status).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('AC-6：effective-orchestration feature --format json 同样不崩、退出码 0', () => {
    const { status, stdout } = runCli(['effective-orchestration', 'feature', '--format', 'json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as EffectiveOrchestrationJson;
    expect(parsed.config.modes?.feature).toBeDefined();
    const zodWarnings = parsed.diagnostics.filter(
      (d) => d.code === 'orchestration.zod-unavailable',
    );
    expect(zodWarnings).toHaveLength(1);
  });
});
