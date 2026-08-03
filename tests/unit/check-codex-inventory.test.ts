/**
 * Feature 240 / T050 — Codex inventory 机械确认（FR-013 / SC-022）。
 *
 * 判据：`codex mcp list --json` 里必须存在 Spectra MCP server 条目且已启用。
 * 两种失败**可区分**：条目缺失 → 退出码 3；条目存在但未启用 → 退出码 4。
 * 找不到 codex CLI 时**不得静默装通过**，落显式的 skip 语义 + 非零退出码 5。
 *
 * 运行：npx vitest run tests/unit/check-codex-inventory.test.ts
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(repoRoot, 'plugins/spec-driver/scripts/check-codex-inventory.mjs');
const mod = await import(new URL('../../plugins/spec-driver/scripts/check-codex-inventory.mjs', import.meta.url).href);

/** 注入型 exec：按子命令分派 */
function makeExec(table: Record<string, string | Error>) {
  return (file: string, args: string[]) => {
    const key = `${file} ${args.join(' ')}`;
    const hit = table[key];
    if (hit === undefined) {
      const err: NodeJS.ErrnoException = new Error('spawn ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    if (hit instanceof Error) throw hit;
    return hit;
  };
}

const MCP_LIST = 'codex mcp list --json';
const PLUGIN_LIST = 'codex plugin list --json';

describe('F240 T050 — checkCodexInventory 判定', () => {
  it('Spectra MCP 条目存在且启用 → ok / 退出码 0', () => {
    const result = mod.checkCodexInventory({
      exec: makeExec({
        [MCP_LIST]: JSON.stringify([
          { name: 'context7', enabled: true },
          { name: 'spectra', enabled: true },
        ]),
        [PLUGIN_LIST]: JSON.stringify({ installed: [{ name: 'spectra', enabled: true, version: '4.4.0' }] }),
      }),
    });
    expect(result.status).toBe('ok');
    expect(mod.resolveExitCode(result)).toBe(0);
    expect(result.mcpServer).toEqual({ name: 'spectra', enabled: true });
  });

  it('条目缺失 → entry-missing / 退出码 3', () => {
    const result = mod.checkCodexInventory({
      exec: makeExec({
        [MCP_LIST]: JSON.stringify([{ name: 'context7', enabled: true }]),
        [PLUGIN_LIST]: JSON.stringify({ installed: [] }),
      }),
    });
    expect(result.status).toBe('entry-missing');
    expect(mod.resolveExitCode(result)).toBe(3);
  });

  it('条目存在但未启用 → entry-disabled / 退出码 4（与缺失可区分）', () => {
    const result = mod.checkCodexInventory({
      exec: makeExec({
        [MCP_LIST]: JSON.stringify([{ name: 'spectra', enabled: false, disabled_reason: null }]),
        [PLUGIN_LIST]: JSON.stringify({ installed: [] }),
      }),
    });
    expect(result.status).toBe('entry-disabled');
    expect(mod.resolveExitCode(result)).toBe(4);
    expect(mod.resolveExitCode({ status: 'entry-missing' })).not.toBe(mod.resolveExitCode(result));
  });

  it('codex CLI 不存在 → skip 语义显式暴露 + 非零退出码（不得静默装通过）', () => {
    const result = mod.checkCodexInventory({ exec: makeExec({}) });
    expect(result.status).toBe('codex-cli-unavailable');
    expect(result.errorClass).toBe('ENOENT');
    expect(mod.resolveExitCode(result)).toBe(5);
    expect(mod.resolveExitCode(result)).not.toBe(0);
  });

  it('codex mcp list 输出不是合法 JSON → probe-failed + 非零退出码', () => {
    const result = mod.checkCodexInventory({
      exec: makeExec({ [MCP_LIST]: 'not json at all', [PLUGIN_LIST]: '{}' }),
    });
    expect(result.status).toBe('probe-failed');
    expect(result.errorClass).toBe('parse-failed');
    expect(mod.resolveExitCode(result)).not.toBe(0);
  });

  it('输出只承载受限字段：transport / env / 绝对路径一律不进结果', () => {
    const result = mod.checkCodexInventory({
      exec: makeExec({
        [MCP_LIST]: JSON.stringify([
          {
            name: 'spectra',
            enabled: true,
            transport: { type: 'stdio', command: '/Users/someone/secret/bin/x', env: { API_KEY: 'F240CANARY' } },
          },
        ]),
        [PLUGIN_LIST]: JSON.stringify({
          installed: [
            { name: 'spectra', enabled: true, version: '4.4.0', source: { path: '/Users/someone/secret' } },
          ],
        }),
      }),
    });
    const serialized = JSON.stringify(result);
    expect(serialized.includes('F240CANARY')).toBe(false);
    expect(serialized.includes('/Users/someone/secret')).toBe(false);
    expect(result.mcpServer).toEqual({ name: 'spectra', enabled: true });
    expect(result.pluginEntry).toEqual({ name: 'spectra', enabled: true, semver: '4.4.0' });
  });

  it('plugin inventory 不可读不影响 MCP 判定（后者才是 SC-022 的判据）', () => {
    const result = mod.checkCodexInventory({
      exec: makeExec({ [MCP_LIST]: JSON.stringify([{ name: 'spectra', enabled: true }]) }),
    });
    expect(result.status).toBe('ok');
    expect(result.pluginEntry).toBeNull();
    expect(result.pluginProbe.outcome).toBe('not-executable');
  });
});

describe('F240 T050 — CLI 行为', () => {
  it('--format json 输出结构化结果；本机实跑退出码属已定义集合', () => {
    let stdout = '';
    let status = 0;
    try {
      stdout = execFileSync(process.execPath, [SCRIPT, '--format', 'json'], { encoding: 'utf-8' });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      status = e.status ?? -1;
      stdout = e.stdout ?? '';
    }
    expect([0, 3, 4, 5]).toContain(status);
    const parsed = JSON.parse(stdout);
    expect(typeof parsed.status).toBe('string');
    expect(mod.INVENTORY_STATUSES).toContain(parsed.status);
  });

  it('未知参数 → 退出码 2', () => {
    let status = 0;
    try {
      execFileSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf-8' });
    } catch (err) {
      status = (err as { status?: number }).status ?? -1;
    }
    expect(status).toBe(2);
  });
});
