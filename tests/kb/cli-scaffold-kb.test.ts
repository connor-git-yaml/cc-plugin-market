/**
 * F190 T017/T018 — scaffold-kb CLI 解析 + handler（build 路径）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from '../../src/cli/utils/parse-args.js';
import { runScaffoldKb } from '../../src/cli/commands/scaffold-kb.js';
import type { CLICommand } from '../../src/cli/utils/parse-args.js';

describe('parseArgs — scaffold-kb', () => {
  it('build 子操作 + 各 flag 解析', () => {
    const r = parseArgs(['scaffold-kb', 'build', '--dir', 'docs', '--output', 'kb', '--sdk-version', '1.0']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.subcommand).toBe('scaffold-kb');
      expect(r.command.scaffoldKbOperation).toBe('build');
      expect(r.command.scaffoldKbDir).toBe('docs');
      expect(r.command.scaffoldKbOutput).toBe('kb');
      expect(r.command.scaffoldKbSdkVersion).toBe('1.0');
    }
  });

  it('serve 子操作 + --vendor-kb 解析', () => {
    const r = parseArgs(['scaffold-kb', 'serve', '--vendor-kb', '/p/kb']);
    expect(r.ok && r.command.scaffoldKbOperation).toBe('serve');
    expect(r.ok && r.command.scaffoldKbVendorKb).toBe('/p/kb');
  });

  it('未知子操作 → 报错', () => {
    const r = parseArgs(['scaffold-kb', 'frobnicate']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('invalid_subcommand');
  });

  // F241 T043（P-W5）：不扩 union 则 dispatch 分支永远不可达 —— CLI 可达性必须单独钉住
  it('coverage-gap 子操作被解析出来，不落 invalid_subcommand', () => {
    const r = parseArgs(['scaffold-kb', 'coverage-gap']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.scaffoldKbOperation).toBe('coverage-gap');
  });

  // F241 B2-4（M-3 A-W3 / B-I1）：缺值 flag 静默回落默认值、未知 flag 静默放行
  it('coverage-gap --format 缺值 → invalid_option（不静默回落 markdown）', () => {
    for (const argv of [
      ['scaffold-kb', 'coverage-gap', '--format'],
      ['scaffold-kb', 'coverage-gap', '--format', '--probe'],
    ]) {
      const r = parseArgs(argv);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.type).toBe('invalid_option');
    }
  });

  it('coverage-gap 未知 flag / 位置参数 → invalid_option', () => {
    for (const argv of [
      ['scaffold-kb', 'coverage-gap', '--unknown'],
      ['scaffold-kb', 'coverage-gap', '--dry-run'],
      ['scaffold-kb', 'coverage-gap', '--vendor-kb', '/p/kb'],
      ['scaffold-kb', 'coverage-gap', 'stray'],
    ]) {
      const r = parseArgs(argv);
      expect(r.ok, `应拒绝: ${argv.join(' ')}`).toBe(false);
      if (!r.ok) expect(r.error.type).toBe('invalid_option');
    }
  });

  // RG-005：收严只作用于新增 op，既有 op 的现有行为一字不改
  it('既有 op（build/serve/query/ingest）行为未被收严波及', () => {
    const cases: string[][] = [
      ['scaffold-kb', 'build', '--dir', 'docs', '--unknown-legacy-flag'],
      ['scaffold-kb', 'query', '--requirement', 'x', '--vendor-kb', '/p/kb', '--format'],
      ['scaffold-kb', 'serve', '--vendor-kb', '/p/kb', '--whatever'],
      ['scaffold-kb', 'ingest', '--url', 'https://x/y', '--bogus'],
    ];
    for (const argv of cases) {
      expect(parseArgs(argv).ok, `不应拒绝: ${argv.join(' ')}`).toBe(true);
    }
  });

  it('coverage-gap --format json|markdown 解析生效', () => {
    const j = parseArgs(['scaffold-kb', 'coverage-gap', '--format', 'json']);
    expect(j.ok && j.command.scaffoldKbFormat).toBe('json');
    const m = parseArgs(['scaffold-kb', 'coverage-gap', '--format', 'markdown']);
    expect(m.ok && m.command.scaffoldKbFormat).toBe('markdown');
    const bad = parseArgs(['scaffold-kb', 'coverage-gap', '--format', 'yaml']);
    expect(bad.ok).toBe(false);
  });

  it('扩 union 后未知 op 仍被拒（不是放开一切）', () => {
    for (const op of ['coverage-gaps', 'coveragegap', 'frobnicate']) {
      const r = parseArgs(['scaffold-kb', op]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.type).toBe('invalid_subcommand');
    }
  });
});

describe('runScaffoldKb — coverage-gap dispatch（F241 T043）', () => {
  const ENV_KEY = 'SPECTRA_KB_NOHIT_TELEMETRY';
  let saved: string | undefined;

  function cmd(over: Partial<CLICommand>): CLICommand {
    return {
      subcommand: 'scaffold-kb',
      deep: false, force: false, version: false, help: false,
      global: false, remove: false, skillTarget: 'claude',
      ...over,
    };
  }

  async function capture(command: CLICommand): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
    const out: string[] = [];
    const err: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    const prevExit = process.exitCode;
    process.exitCode = undefined;
    (process.stdout.write as unknown) = (s: string): boolean => (out.push(String(s)), true);
    (process.stderr.write as unknown) = (s: string): boolean => (err.push(String(s)), true);
    try {
      await runScaffoldKb(command);
    } finally {
      (process.stdout.write as unknown) = origOut;
      (process.stderr.write as unknown) = origErr;
    }
    const exitCode = process.exitCode;
    process.exitCode = prevExit;
    return { stdout: out.join(''), stderr: err.join(''), exitCode };
  }

  beforeEach(() => {
    saved = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  });

  it('dispatch 到 runCoverageGap：采集关闭时输出 collection-disabled 且退出码 0', async () => {
    const { stdout, exitCode } = await capture(cmd({ scaffoldKbOperation: 'coverage-gap', scaffoldKbFormat: 'json' }));
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed['status']).toBe('collection-disabled');
    expect(parsed['minOccurrenceThreshold']).toBe(2);
    expect(exitCode).toBeUndefined();
    // 反证：没有落到"未知子操作"的用法分支
    expect(stdout).not.toContain('用法:');
  });

  it('markdown 为默认格式', async () => {
    const { stdout } = await capture(cmd({ scaffoldKbOperation: 'coverage-gap' }));
    expect(stdout).toContain('coverage-gap');
    expect(stdout).toContain('collection-disabled');
  });
});

describe('runScaffoldKb — build handler', () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'kb-cli-'));
    mkdirSync(join(workdir, 'docs'), { recursive: true });
    writeFileSync(join(workdir, 'docs', 'a.md'), '# 文档A\n\n内容含 sdk.Init() 调用。\n');
  });
  afterEach(() => rmSync(workdir, { recursive: true, force: true }));

  function cmd(over: Partial<CLICommand>): CLICommand {
    return {
      subcommand: 'scaffold-kb',
      deep: false, force: false, version: false, help: false,
      global: false, remove: false, skillTarget: 'claude',
      ...over,
    };
  }

  it('build 产出 kb/ 产物', async () => {
    const out = join(workdir, 'kb');
    await runScaffoldKb(
      cmd({ scaffoldKbOperation: 'build', scaffoldKbDir: join(workdir, 'docs'), scaffoldKbOutput: out, scaffoldKbNoLlm: true }),
    );
    expect(existsSync(join(out, 'doc-graph.json'))).toBe(true);
    expect(existsSync(join(out, 'chunks.sqlite'))).toBe(true);
    expect(existsSync(join(out, 'api-entities.json'))).toBe(true);
  });

  it('build 缺输入 → 设 exitCode 1（不抛）', async () => {
    const prev = process.exitCode;
    process.exitCode = 0;
    await runScaffoldKb(cmd({ scaffoldKbOperation: 'build' }));
    expect(process.exitCode).toBe(1);
    process.exitCode = prev;
  });
});
