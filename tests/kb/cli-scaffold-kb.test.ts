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
