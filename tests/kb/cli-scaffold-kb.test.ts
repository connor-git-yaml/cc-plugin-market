/**
 * F190 T017/T018 — scaffold-kb CLI 解析 + handler（build 路径）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

  // ── F241 批 3（T057 / P-W5）：version / status 两 op 的 CLI 可达性 ──
  // 不扩 union 则两个 dispatch 分支永远走不到，模块单测全绿而 CLI 永远返回 invalid_subcommand。

  it('version 子操作被解析出来，不落 invalid_subcommand（SC-012）', () => {
    const r = parseArgs(['scaffold-kb', 'version', '--package', 'echarts']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.scaffoldKbOperation).toBe('version');
      expect(r.command.scaffoldKbPackage).toBe('echarts');
    }
  });

  it('version 全 flag 解析：--package / --project-root / --sdk-version / --format', () => {
    const r = parseArgs([
      'scaffold-kb', 'version',
      '--package', '@scope/ui',
      '--project-root', '/p',
      '--sdk-version', '4.0.0',
      '--format', 'json',
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.scaffoldKbPackage).toBe('@scope/ui');
      expect(r.command.scaffoldKbProjectRoot).toBe('/p');
      expect(r.command.scaffoldKbSdkVersion).toBe('4.0.0');
      expect(r.command.scaffoldKbFormat).toBe('json');
    }
  });

  it('status 子操作被解析出来，不落 invalid_subcommand（SC-013）', () => {
    const r = parseArgs(['scaffold-kb', 'status', '--vendor-kb', '/p/kb']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.scaffoldKbOperation).toBe('status');
      expect(r.command.scaffoldKbVendorKb).toBe('/p/kb');
    }
  });

  it('version / status 纳入严格校验：未知 flag / 位置参数 / 缺值 → invalid_option', () => {
    for (const argv of [
      ['scaffold-kb', 'version', '--package', 'x', '--unknown'],
      ['scaffold-kb', 'version', '--package'],
      ['scaffold-kb', 'version', '--package', 'x', 'stray'],
      ['scaffold-kb', 'version', '--package', 'x', '--vendor-kb', '/p/kb'],
      ['scaffold-kb', 'status', '--vendor-kb', '/p/kb', '--unknown'],
      ['scaffold-kb', 'status', '--vendor-kb'],
      ['scaffold-kb', 'status', '--format'],
      ['scaffold-kb', 'status', 'stray'],
      ['scaffold-kb', 'status', '--package', 'x'],
    ]) {
      const r = parseArgs(argv);
      expect(r.ok, `应拒绝: ${argv.join(' ')}`).toBe(false);
      if (!r.ok) expect(r.error.type).toBe('invalid_option');
    }
  });

  it('新增两 op 的收严不外溢：既有 op 仍不被 --package/--project-root 之外的收严波及（RG-005）', () => {
    for (const argv of [
      ['scaffold-kb', 'build', '--dir', 'docs', '--package', 'x'],
      ['scaffold-kb', 'query', '--requirement', 'x', '--vendor-kb', '/p/kb', '--project-root', '/p'],
    ]) {
      expect(parseArgs(argv).ok, `不应拒绝: ${argv.join(' ')}`).toBe(true);
    }
  });

  it('相近但错误的 op 名仍被拒（version/status 不放开前缀匹配）', () => {
    for (const op of ['versions', 'ver', 'statuses', 'stat']) {
      const r = parseArgs(['scaffold-kb', op]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.type).toBe('invalid_subcommand');
    }
  });
});

/**
 * F241 批 3 Codex 整改 B3-C3（B2-4 回归）——严格校验被**重复 flag** 绕过。
 *
 * 根因：`readFlagEntry` 用全局 `indexOf` 取首次出现，校验循环走到第二次出现时
 * 仍按「首次出现有值」判定合法，于是盲跳下一个 token，把它后面的未知 flag 直接吞掉。
 * 判据改成按当前索引推进 + 显式拒绝重复 flag。
 */
describe('parseArgs — 严格 op 的重复 flag 走私（B3-C3）', () => {
  it('Codex 实测复现串：`--package typescript --package --evil --format json` 必须被拒', () => {
    const r = parseArgs([
      'scaffold-kb', 'version', '--package', 'typescript', '--package', '--evil', '--format', 'json',
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('invalid_option');
  });

  it('重复 flag 本身即被拒（即便两次都带合法值）', () => {
    for (const argv of [
      ['scaffold-kb', 'version', '--package', 'a', '--package', 'b'],
      ['scaffold-kb', 'status', '--vendor-kb', '/a', '--vendor-kb', '/b'],
      ['scaffold-kb', 'coverage-gap', '--format', 'json', '--format', 'markdown'],
    ]) {
      const r = parseArgs(argv);
      expect(r.ok, `应拒绝重复 flag: ${argv.join(' ')}`).toBe(false);
      if (!r.ok) {
        expect(r.error.type).toBe('invalid_option');
        expect(r.error.message).toMatch(/重复/);
      }
    }
  });

  it('第二次出现缺值也不得靠首次出现「借」到值', () => {
    const r = parseArgs(['scaffold-kb', 'version', '--package', 'typescript', '--package']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('invalid_option');
  });

  it('未知 flag 藏在重复 flag 之后仍被抓到（走私路径整体封死）', () => {
    const r = parseArgs(['scaffold-kb', 'status', '--vendor-kb', '/a', '--vendor-kb', '--evil-payload']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('invalid_option');
  });

  it('单次出现的合法组合不受影响（收严不误伤）', () => {
    const r = parseArgs(['scaffold-kb', 'version', '--package', 'typescript', '--format', 'json']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.scaffoldKbPackage).toBe('typescript');
      expect(r.command.scaffoldKbFormat).toBe('json');
    }
  });

  it('**RG-005 护栏**：既有四 op 的重复 flag 行为零变化（仍取首次出现，不报错）', () => {
    const cases: Array<[string[], keyof CLICommand, string]> = [
      [['scaffold-kb', 'build', '--dir', 'a', '--dir', 'b'], 'scaffoldKbDir', 'a'],
      [['scaffold-kb', 'serve', '--vendor-kb', '/a', '--vendor-kb', '/b'], 'scaffoldKbVendorKb', '/a'],
      [['scaffold-kb', 'query', '--requirement', 'x', '--requirement', 'y'], 'scaffoldKbRequirement', 'x'],
      [['scaffold-kb', 'ingest', '--url', 'u1', '--url', 'u2'], 'scaffoldKbUrl', 'u1'],
    ];
    for (const [argv, field, expected] of cases) {
      const r = parseArgs(argv);
      expect(r.ok, `既有 op 不得被收严波及: ${argv.join(' ')}`).toBe(true);
      if (r.ok) expect(r.command[field]).toBe(expected);
    }
  });

  it('**RG-005 护栏**：既有 op 的未知 flag 与缺值仍按旧行为放行', () => {
    expect(parseArgs(['scaffold-kb', 'build', '--dir', 'a', '--totally-unknown', 'v']).ok).toBe(true);
    const r = parseArgs(['scaffold-kb', 'query', '--requirement', 'x', '--format']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.scaffoldKbFormat).toBeUndefined();
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

/**
 * F241 T057（P-W5 / SC-012 / SC-013）：parse → runScaffoldKb **全链**集成。
 *
 * 只测 parseArgs 会漏掉「union 扩了但 dispatch 没接」，只测 dispatch 会漏掉「分支写了但
 * CLI 到不了」——两头都得从同一条 argv 走通才算可达。
 */
describe('parse → runScaffoldKb 全链 — version / status（F241 T057）', () => {
  let workdir: string;

  async function capture(argv: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
    const parsed = parseArgs(argv);
    expect(parsed.ok, `parseArgs 应通过: ${argv.join(' ')}`).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    const out: string[] = [];
    const err: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    const origLog = console.log;
    const origErrLog = console.error;
    const prevExit = process.exitCode;
    process.exitCode = undefined;
    (process.stdout.write as unknown) = (s: string): boolean => (out.push(String(s)), true);
    (process.stderr.write as unknown) = (s: string): boolean => (err.push(String(s)), true);
    console.log = (...a: unknown[]): void => void out.push(`${a.join(' ')}\n`);
    console.error = (...a: unknown[]): void => void err.push(`${a.join(' ')}\n`);
    try {
      await runScaffoldKb(parsed.command);
    } finally {
      (process.stdout.write as unknown) = origOut;
      (process.stderr.write as unknown) = origErr;
      console.log = origLog;
      console.error = origErrLog;
    }
    const exitCode = process.exitCode;
    process.exitCode = prevExit;
    return { stdout: out.join(''), stderr: err.join(''), exitCode };
  }

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'kb-cli-vs-'));
  });
  afterEach(() => rmSync(workdir, { recursive: true, force: true }));

  it('version：从 argv 一路走到 resolveVersion，输出 resolved/candidates/flags', async () => {
    writeFileSync(
      join(workdir, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/echarts': { version: '5.4.3' } } }),
    );
    const { stdout, exitCode } = await capture([
      'scaffold-kb', 'version', '--package', 'echarts', '--project-root', workdir, '--format', 'json',
    ]);
    const parsed = JSON.parse(stdout) as { resolved: { status: string; version: string | null }; candidates: unknown[]; flags: unknown[] };
    expect(parsed.resolved).toEqual({ status: 'lockfile', version: '5.4.3' });
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.flags).toEqual([]);
    expect(exitCode).toBeUndefined();
    expect(stdout).not.toContain('用法:');
  });

  it('version：显式版本冲突时 markdown 也把推断值一起打出来（不静默吞掉）', async () => {
    writeFileSync(
      join(workdir, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/echarts': { version: '5.4.3' } } }),
    );
    const { stdout } = await capture([
      'scaffold-kb', 'version', '--package', 'echarts', '--project-root', workdir, '--sdk-version', '4.0.0',
    ]);
    expect(stdout).toContain('explicit');
    expect(stdout).toContain('4.0.0');
    expect(stdout).toContain('5.4.3');
    expect(stdout).toContain('version-conflict');
  });

  it('version：缺 --package → 用法提示 + exit 1', async () => {
    const { exitCode, stderr } = await capture(['scaffold-kb', 'version']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('用法:');
  });

  it('status：从 argv 一路走到 buildKbStatusReport，输出全字段', async () => {
    mkdirSync(join(workdir, 'docs'), { recursive: true });
    writeFileSync(join(workdir, 'docs', 'a.md'), '# 文档A\n\n内容含 sdk.Init() 调用。\n');
    const kb = join(workdir, 'kb');
    await runScaffoldKb({
      subcommand: 'scaffold-kb',
      deep: false, force: false, version: false, help: false,
      global: false, remove: false, skillTarget: 'claude',
      scaffoldKbOperation: 'build', scaffoldKbDir: join(workdir, 'docs'), scaffoldKbOutput: kb, scaffoldKbNoLlm: true,
    });

    const { stdout, exitCode } = await capture(['scaffold-kb', 'status', '--vendor-kb', kb, '--format', 'json']);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed['dbExists']).toBe(true);
    expect(parsed['schemaCompat']).toBe('full');
    expect(parsed['freshness']).toBe('current');
    expect(parsed['noHitCollection']).toBe('disabled');
    expect(parsed['recentNoHitCount']).toBeNull();
    expect(parsed['dbPath']).toContain('chunks.sqlite');
    expect(exitCode).toBeUndefined();
  });

  it('status：库不存在 → dbExists false + unknown，退出码 0（只报告，不重建）', async () => {
    const { stdout, exitCode } = await capture([
      'scaffold-kb', 'status', '--vendor-kb', join(workdir, 'nope'), '--format', 'json',
    ]);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed['dbExists']).toBe(false);
    expect(parsed['freshness']).toBe('unknown');
    expect(exitCode).toBeUndefined();
  });

  it('status：既不给 --vendor-kb 也不给 --project-kb → 用法提示 + exit 1', async () => {
    const { exitCode, stderr } = await capture(['scaffold-kb', 'status']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('用法:');
  });

  it('status：两个库路径同时给 → 拒绝（不擅自挑一个报告）', async () => {
    const { exitCode, stderr } = await capture([
      'scaffold-kb', 'status', '--vendor-kb', join(workdir, 'a'), '--project-kb', join(workdir, 'b'),
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/只能|其一|exactly one/i);
  });

  // ── F241 批 3 Codex 整改 B3-C5 / B3-W2 ──

  /** 建一个真实可用的 vendor kb，返回 kb 目录 */
  async function buildFixtureKb(): Promise<string> {
    mkdirSync(join(workdir, 'docs'), { recursive: true });
    writeFileSync(join(workdir, 'docs', 'a.md'), '# 文档A\n\n内容含 sdk.Init() 调用。\n');
    const kb = join(workdir, 'kb');
    await runScaffoldKb({
      subcommand: 'scaffold-kb',
      deep: false, force: false, version: false, help: false,
      global: false, remove: false, skillTarget: 'claude',
      scaffoldKbOperation: 'build', scaffoldKbDir: join(workdir, 'docs'), scaffoldKbOutput: kb, scaffoldKbNoLlm: true,
    });
    return kb;
  }

  it('status：库文件在但打不开（损坏）→ dbExists **true** + schemaCompat unreadable（B3-C5）', async () => {
    const kb = join(workdir, 'broken-kb');
    mkdirSync(kb, { recursive: true });
    // 存在且非空，但不是合法 sqlite —— 「文件不存在」与「文件损坏」是两种处置
    writeFileSync(join(kb, 'chunks.sqlite'), 'this is definitely not a sqlite database');

    const { stdout, exitCode } = await capture(['scaffold-kb', 'status', '--vendor-kb', kb, '--format', 'json']);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed['dbExists']).toBe(true);
    expect(parsed['schemaCompat']).toBe('unreadable');
    expect(parsed['freshness']).toBe('unknown');
    // 状态查询不是健康断言：损坏也如实报告 + exit 0
    expect(exitCode).toBeUndefined();
  });

  it('status：目录里根本没有 chunks.sqlite → dbExists false（与损坏态可区分）', async () => {
    const kb = join(workdir, 'empty-kb');
    mkdirSync(kb, { recursive: true });
    const { stdout } = await capture(['scaffold-kb', 'status', '--vendor-kb', kb, '--format', 'json']);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed['dbExists']).toBe(false);
    expect(parsed['schemaCompat']).toBe('unreadable');
  });

  it('status：只读证明落在 CLI **实际读的那个文件路径**上（B3-W2 / RG-008）', async () => {
    const kb = await buildFixtureKb();
    const dbFile = join(kb, 'chunks.sqlite');
    const sha = (): string => createHash('sha256').update(readFileSync(dbFile)).digest('hex');
    const before = sha();

    const { stdout, exitCode } = await capture(['scaffold-kb', 'status', '--vendor-kb', kb, '--format', 'json']);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    // 断言命令确实读到了这个文件（否则「SHA 不变」只是因为没碰它）
    expect(parsed['dbPath']).toBe(dbFile);
    expect(parsed['dbExists']).toBe(true);
    expect(exitCode).toBeUndefined();

    expect(sha()).toBe(before);
    // hash 有分辨力：改一个字节就必须变
    appendFileSync(dbFile, '\0');
    expect(sha()).not.toBe(before);
  });

  it('version：只读证明——决议不改写 lockfile / package.json（B3-W2 / RG-008）', async () => {
    const lock = join(workdir, 'package-lock.json');
    const pkg = join(workdir, 'package.json');
    writeFileSync(lock, JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/echarts': { version: '5.4.3' } } }));
    writeFileSync(pkg, JSON.stringify({ name: 'demo', dependencies: { echarts: '^5.0.0' } }));
    const shaOf = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
    const before = [shaOf(lock), shaOf(pkg)];

    const { stdout } = await capture([
      'scaffold-kb', 'version', '--package', 'echarts', '--project-root', workdir, '--format', 'json',
    ]);
    // 断言命令确实用到了这两个文件所在的 root（否则 SHA 恒等毫无意义）
    expect((JSON.parse(stdout) as { resolved: { version: string | null } }).resolved.version).toBe('5.4.3');
    expect([shaOf(lock), shaOf(pkg)]).toEqual(before);
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
