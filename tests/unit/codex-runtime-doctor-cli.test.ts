/**
 * Feature 240 / T049 + T051 — 诊断 CLI 编排层与 `--strict` 漂移捕获（SC-012 / SC-015）。
 *
 * T051 的关键点：漂移必须能被**机械**捕获，所以这里不 mock 任何东西 —— 在临时目录里
 * 造一个真的可执行 `spectra`（输出与仓库声明不同的版本）并把 PATH 指向它，
 * 再真跑 CLI 子进程断言退出码。
 *
 * 运行：npx vitest run tests/unit/codex-runtime-doctor-cli.test.ts
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(repoRoot, 'plugins/spec-driver/scripts/codex-runtime-doctor.mjs');
const cli = await import(new URL('../../plugins/spec-driver/scripts/codex-runtime-doctor.mjs', import.meta.url).href);

/**
 * 造一个自洽的运行环境：
 * - 仓库 fixture 只含 `contracts/release-contract.yaml`
 * - 空的 Codex 家目录（经 `CODEX_HOME` 传入，让 CLI 走 Phase A 的 shell helper 解析）
 * - PATH 里只有 fixture bin + 系统 bin（`bash` 是 helper 必需；`codex` 刻意缺席 → 探针全非 found）
 */
function makeEnv(options: { repoVersion: string; cliVersion: string | null }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'f240-cli-'));
  const projectRoot = path.join(base, 'repo');
  const codexHome = path.join(base, 'codex-home');
  const binDir = path.join(base, 'bin');
  fs.mkdirSync(path.join(projectRoot, 'contracts'), { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  fs.writeFileSync(
    path.join(projectRoot, 'contracts', 'release-contract.yaml'),
    [
      'schemaVersion: 1',
      'marketplace:',
      '  metadata:',
      '    version: "1.0.0"',
      'products:',
      '  spectra:',
      `    version: "${options.repoVersion}"`,
      '  spec-driver:',
      `    version: "${options.repoVersion}"`,
      '',
    ].join('\n'),
  );

  if (options.cliVersion !== null) {
    const fake = path.join(binDir, 'spectra');
    fs.writeFileSync(fake, `#!/bin/sh\necho "spectra v${options.cliVersion} (0ae3eb7)"\n`);
    fs.chmodSync(fake, 0o755);
  }

  return {
    projectRoot,
    codexHome,
    env: {
      PATH: `${binDir}:/bin:/usr/bin`,
      HOME: base,
      CODEX_HOME: codexHome,
    },
  };
}

function runCli(fixture: ReturnType<typeof makeEnv>, args: string[]) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, '--project-root', fixture.projectRoot, ...args], {
      encoding: 'utf-8',
      env: fixture.env,
    });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('F240 T049 — 退出码真值表（纯函数层，覆盖 4 行）', () => {
  it('ok → 0', () => {
    expect(cli.resolveExitCode('ok', false)).toBe(0);
    expect(cli.resolveExitCode('ok', true)).toBe(0);
  });
  it('warning（含全部 indeterminate 情形）→ 0', () => {
    expect(cli.resolveExitCode('warning', false)).toBe(0);
    expect(cli.resolveExitCode('warning', true)).toBe(0);
  });
  it('fail 且未 --strict → 0（诊断不阻断）', () => {
    expect(cli.resolveExitCode('fail', false)).toBe(0);
  });
  it('fail 且 --strict → 1', () => {
    expect(cli.resolveExitCode('fail', true)).toBe(1);
  });
});

describe('F240 T049 — 参数解析', () => {
  it('默认 format 为 text、strict 关闭', () => {
    const parsed = cli.parseArgs([]);
    expect(parsed.ok).toBe(true);
    expect(parsed.format).toBe('text');
    expect(parsed.strict).toBe(false);
  });
  it('--format 只接受 json|text', () => {
    expect(cli.parseArgs(['--format', 'json']).format).toBe('json');
    expect(cli.parseArgs(['--format', 'yaml']).ok).toBe(false);
  });
  it('--project-root 缺值即失败', () => {
    expect(cli.parseArgs(['--project-root']).ok).toBe(false);
    expect(cli.parseArgs(['--project-root', '--strict']).ok).toBe(false);
  });
  it('未知参数即失败（且错误信息不回显 argv）', () => {
    const parsed = cli.parseArgs(['--nope']);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.includes('--nope')).toBe(false);
  });

  /**
   * I1：参数错误此前是三条就地写死的字面量。它们当时确实不含变量、也就没有泄漏，
   * 但「顶层错误同一漏斗」（FR-012）是**结构合同**，靠「这条字面量恰好安全」维持的
   * 安全性会在下一次有人顺手拼一个 argv 变量进去时无声失效。
   */
  it('参数错误走 cli-argument-error 模板漏斗，reason 取自固定枚举', async () => {
    const core = await import(
      new URL('../../plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs', import.meta.url).href
    );
    const cases: Array<[string[], string]> = [
      [['--project-root'], 'missing-project-root'],
      [['--format', 'yaml'], 'invalid-format'],
      [['--nope'], 'unknown-argument'],
    ];
    for (const [argv, reason] of cases) {
      const parsed = cli.parseArgs(argv);
      expect(parsed.ok).toBe(false);
      expect(core.CLI_ARG_ERRORS).toContain(parsed.reason);
      expect(parsed.reason).toBe(reason);
      // 文案与 check 的 summary 共用同一个构造器 —— 不是另写一条字面量
      expect(parsed.error).toBe(core.buildSummary('cli-argument-error', { reason }));
    }
    // 越界 reason 无法构造出文案（模板漏斗拒绝，而非静默降级）
    expect(() => core.buildSummary('cli-argument-error', { reason: '/etc/passwd' })).toThrow();
  });
});

describe('F240 T051 — --strict 下真实漂移可被机械捕获（SC-015）', () => {
  it('版本漂移：不带 --strict 退出 0，带 --strict 退出 1 且 overallStatus === fail', () => {
    const fx = makeEnv({ repoVersion: '4.4.0', cliVersion: '9.9.9' });

    const lenient = runCli(fx, ['--format', 'json']);
    expect(lenient.status).toBe(0);
    const report = JSON.parse(lenient.stdout);
    expect(report.overallStatus).toBe('fail');
    expect(report.checks['global-cli.spectra'].status).toBe('fail');
    expect(report.checks['global-cli.spectra'].details.semver).toBe('9.9.9');
    expect(report.checks['global-cli.spectra'].remediation.code).toBe('upgrade-global-cli');

    const strict = runCli(fx, ['--format', 'json', '--strict']);
    expect(strict.status).toBe(1);
    expect(JSON.parse(strict.stdout).overallStatus).toBe('fail');
  });

  it('无漂移、仅 indeterminate：退出码 0 且 overallStatus === warning（--strict 下同样 0）', () => {
    const fx = makeEnv({ repoVersion: '4.4.0', cliVersion: '4.4.0' });

    const lenient = runCli(fx, ['--format', 'json']);
    expect(lenient.status).toBe(0);
    const report = JSON.parse(lenient.stdout);
    expect(report.overallStatus).toBe('warning');
    expect(report.checks['global-cli.spectra'].status).toBe('ok');
    // 本机没有可用的 codex → plugin-build 全探针非 found → indeterminate
    expect(report.checks['plugin-build.spectra'].status).toBe('indeterminate');

    const strict = runCli(fx, ['--format', 'json', '--strict']);
    expect(strict.status).toBe(0);
  });

  it('JSON 输出通过 SC-012 的 schema 校验', () => {
    const fx = makeEnv({ repoVersion: '4.4.0', cliVersion: '4.4.0' });
    const report = JSON.parse(runCli(fx, ['--format', 'json']).stdout);
    expect(report.schemaVersion).toBe(1);
    expect(typeof report.generatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
    expect(['ok', 'warning', 'fail']).toContain(report.overallStatus);
    for (const [id, check] of Object.entries<any>(report.checks)) {
      expect(check.id).toBe(id);
      expect(typeof check.category).toBe('string');
      expect(typeof check.status).toBe('string');
      expect(typeof check.summary).toBe('string');
      expect(typeof check.details).toBe('object');
      expect(check.remediation === null || typeof check.remediation === 'object').toBe(true);
    }
  });

  it('默认 text 输出可读且不含绝对路径（脱敏在文本通道同样生效）', () => {
    const fx = makeEnv({ repoVersion: '4.4.0', cliVersion: '4.4.0' });
    const out = runCli(fx, []).stdout;
    expect(out).toContain('overallStatus:');
    expect(out).toContain('global-cli.spectra');
    expect(out.includes(fx.codexHome)).toBe(false);
    expect(out.includes(fx.projectRoot)).toBe(false);
  });

  it('参数非法 → 退出码 2', () => {
    const fx = makeEnv({ repoVersion: '4.4.0', cliVersion: '4.4.0' });
    expect(runCli(fx, ['--format', 'yaml']).status).toBe(2);
    expect(runCli(fx, ['--unknown-flag']).status).toBe(2);
  });
});
