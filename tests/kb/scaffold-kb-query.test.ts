/**
 * F191 SC-001/SC-006 — scaffold-kb query CLI：probe / markdown / json / 降级 / 参数校验
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from '../../src/cli/utils/parse-args.js';
import { runScaffoldKb } from '../../src/cli/commands/scaffold-kb.js';
import { loadKbContext, type KbContext, type LoadKbResult } from '../../src/kb-mcp/lib/kb-locator.js';

// F241 T039：no-hit 挂点 spy（FR-012 挂点 3）
const { recordNoHitSpy } = vi.hoisted(() => ({ recordNoHitSpy: vi.fn() }));
vi.mock('../../src/scaffold-kb/nohit-recorder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/scaffold-kb/nohit-recorder.js')>();
  return { ...actual, recordNoHit: recordNoHitSpy };
});

// F241 B2-9：为了在 CLI 真实路径上注入"读 dbPath 就抛错"的 handle，需要能替换 loader。
// 默认透传真实实现，只有显式设置 override 的用例才走桩。
const { locatorOverride } = vi.hoisted(() => ({
  locatorOverride: { impl: null as null | (() => Promise<unknown>) },
}));
vi.mock('../../src/kb-mcp/lib/kb-locator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/kb-mcp/lib/kb-locator.js')>();
  return {
    ...actual,
    loadKbContext: async (opts: Parameters<typeof actual.loadKbContext>[0]) =>
      locatorOverride.impl === null ? actual.loadKbContext(opts) : locatorOverride.impl(),
  };
});

const ROOT = process.cwd();
const ZH_KB = join(ROOT, 'plugins/demo-kb-zh/kb');

async function runCli(args: string[]): Promise<{ stdout: string; exitCode: number | undefined }> {
  const r = parseArgs(args);
  if (!r.ok) throw new Error(`parse failed: ${r.error.message}`);
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  const prevExit = process.exitCode;
  process.exitCode = undefined;
  (process.stdout.write as unknown) = (s: string): boolean => {
    chunks.push(String(s));
    return true;
  };
  try {
    await runScaffoldKb(r.command);
  } finally {
    (process.stdout.write as unknown) = orig;
  }
  const exitCode = process.exitCode;
  process.exitCode = prevExit;
  return { stdout: chunks.join(''), exitCode };
}

describe('scaffold-kb query CLI', () => {
  it('--probe 打印能力 sentinel', async () => {
    const { stdout } = await runCli(['scaffold-kb', 'query', '--probe']);
    expect(stdout.trim()).toBe('scaffold-kb-query:1');
  });

  it('markdown 查询命中：含非指令前导 + envelope + 来源', async () => {
    const { stdout, exitCode } = await runCli([
      'scaffold-kb', 'query', '--requirement', '怎么配置坐标轴和提示框', '--vendor-kb', ZH_KB, '--top-k', '3',
    ]);
    expect(exitCode).not.toBe(1);
    expect(stdout).toContain('参考资料');
    expect(stdout).toContain('[KB-EVIDENCE');
    expect(stdout).toMatch(/option-xaxis\.md|option-tooltip\.md/);
  });

  it('json 格式输出结构化结果', async () => {
    const { stdout } = await runCli([
      'scaffold-kb', 'query', '--requirement', '坐标轴', '--vendor-kb', ZH_KB, '--format', 'json',
    ]);
    const parsed = JSON.parse(stdout);
    expect(parsed.query).toBeTruthy();
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.length).toBeGreaterThan(0);
  });

  it('KB 不可用 → 降级（不设 exitCode=1，stdout 空）', async () => {
    const { stdout, exitCode } = await runCli([
      'scaffold-kb', 'query', '--requirement', '坐标轴', '--vendor-kb', '/nonexistent/kb',
    ]);
    expect(exitCode).not.toBe(1); // 降级非错误
    expect(stdout.trim()).toBe('');
  });

  it('缺 --requirement → exitCode 1', async () => {
    const { exitCode } = await runCli(['scaffold-kb', 'query', '--vendor-kb', ZH_KB]);
    expect(exitCode).toBe(1);
  });
});

describe('scaffold-kb query — no-hit 治理挂点（F241 FR-012 挂点 3）', () => {
  beforeEach(() => recordNoHitSpy.mockClear());

  it('零结果（merged.length===0）→ recordNoHit 被调用一次，tool=scaffold_kb_query', async () => {
    const requirement = 'zzzqqqnonexistentterm';
    const { stdout, exitCode } = await runCli([
      'scaffold-kb', 'query', '--requirement', requirement, '--vendor-kb', ZH_KB,
    ]);
    expect(stdout.trim()).toBe('');
    expect(exitCode).not.toBe(1);
    expect(recordNoHitSpy).toHaveBeenCalledTimes(1);
    const arg = recordNoHitSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg['tool']).toBe('scaffold_kb_query');
    expect(arg['rawQuery']).toBe(requirement);
    // B2-9：dbPath 以 thunk 传入，由 recordNoHit 在其 try 内求值
    expect(typeof arg['dbPath']).toBe('function');
    expect((arg['dbPath'] as () => string)()).toContain(ZH_KB);
  });

  it('有结果（merged.length>0）→ recordNoHit 不被调用', async () => {
    const { stdout } = await runCli([
      'scaffold-kb', 'query', '--requirement', '坐标轴', '--vendor-kb', ZH_KB, '--format', 'json',
    ]);
    expect(JSON.parse(stdout).results.length).toBeGreaterThan(0);
    expect(recordNoHitSpy).not.toHaveBeenCalled();
  });

  it('KB 不可用 / 关键词为空 → 未真正检索，recordNoHit 不被调用', async () => {
    await runCli(['scaffold-kb', 'query', '--requirement', '坐标轴', '--vendor-kb', '/nonexistent/kb']);
    await runCli(['scaffold-kb', 'query', '--requirement', '   ', '--vendor-kb', ZH_KB]);
    expect(recordNoHitSpy).not.toHaveBeenCalled();
  });

  // B2-7 负例：一个库都没查过（无可用源）→ availability 问题，不进 backlog。
  // 本挂点的「零源」只能来自 KB 加载失败（loadKbContext 成功即保证 ≥1 个 handle），
  // 所以负例形态是"给定的两个库路径都不含 chunks.sqlite"。
  it('两侧库路径均无 chunks.sqlite（零可用源）→ 不记录', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'kb-empty-'));
    try {
      const { exitCode } = await runCli([
        'scaffold-kb', 'query', '--requirement', 'zzzqqqnonexistentterm',
        '--vendor-kb', empty, '--project-kb', empty,
      ]);
      expect(exitCode).not.toBe(1); // 降级非错误
      expect(recordNoHitSpy).not.toHaveBeenCalled();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  // B2-9：关闭态 + 抛错的 dbPath getter 不得穿透主链（走真实 CLI 路径，不是桩自证）
  it('dbPath getter 抛错 + 采集关闭 → 查询正常返回，不抛', async () => {
    const savedEnv = process.env['SPECTRA_KB_NOHIT_TELEMETRY'];
    delete process.env['SPECTRA_KB_NOHIT_TELEMETRY'];
    const real = await loadKbContext({ vendorKbPath: ZH_KB });
    if (!real.ok) throw new Error(`load failed: ${real.code}`);
    const poisoned: KbContext = {
      vendor: {
        ...real.context.vendor!,
        get dbPath(): string {
          throw new Error('governance-path-boom');
        },
      },
      project: null,
      sourcesAvailable: ['vendor'],
    };
    locatorOverride.impl = (): Promise<LoadKbResult> =>
      Promise.resolve({ ok: true, context: poisoned } satisfies LoadKbResult);
    try {
      const { stdout, exitCode } = await runCli([
        'scaffold-kb', 'query', '--requirement', 'zzzqqqnonexistentterm', '--vendor-kb', ZH_KB,
      ]);
      expect(stdout.trim()).toBe(''); // 零结果的正常降级形态
      expect(exitCode).not.toBe(1);
      // 挂点确实触发了，但传的是尚未求值的 thunk
      expect(recordNoHitSpy).toHaveBeenCalledTimes(1);
      expect(typeof (recordNoHitSpy.mock.calls[0]![0] as Record<string, unknown>)['dbPath']).toBe('function');
    } finally {
      locatorOverride.impl = null;
      if (savedEnv === undefined) delete process.env['SPECTRA_KB_NOHIT_TELEMETRY'];
      else process.env['SPECTRA_KB_NOHIT_TELEMETRY'] = savedEnv;
    }
  });
});
