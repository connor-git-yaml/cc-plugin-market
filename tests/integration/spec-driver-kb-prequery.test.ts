/**
 * F191 SC-003 / SC-006 / EC-001 — kb-prequery 端到端（spawn 真实进程）
 * 用 SPECTRA_BIN shim（tsx 直跑 src CLI，免 build 依赖）保证确定性，不依赖 PATH 上的 spectra 版本。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const PREQUERY = join(ROOT, 'plugins/spec-driver/scripts/kb-prequery.mjs');
const VENDOR_KB = join(ROOT, 'plugins/demo-kb-zh/kb');

let work: string;
let goodShim: string;
let oldShim: string;
let miniBin: string; // 仅含 node 的 PATH 目录（让 spectra ENOENT 但 node 仍可用）

function writeProject(dir: string, withKb: boolean): void {
  mkdirSync(join(dir, '.specify'), { recursive: true });
  const ks = withKb
    ? `\nknowledge_sources:\n  enabled: true\n  vendor_kb: ${VENDOR_KB}\n  top_k: 2\n`
    : '';
  writeFileSync(join(dir, '.specify/project-context.yaml'), `product:\n  name: demo${ks}`);
}

function runPrequery(
  projectRoot: string,
  requirement: string,
  spectraBin: string,
  pathOverride?: string,
) {
  const env: Record<string, string> = { ...process.env, SPECTRA_BIN: spectraBin };
  if (pathOverride !== undefined) env['PATH'] = pathOverride;
  return spawnSync('node', [PREQUERY, '--requirement', requirement, '--project-root', projectRoot], {
    encoding: 'utf-8',
    env,
    timeout: 60_000,
  });
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'kb-prequery-'));
  // good shim：tsx 直跑 src CLI（支持 query --probe）
  goodShim = join(work, 'spectra-good');
  writeFileSync(goodShim, `#!/bin/sh\nexec "${join(ROOT, 'node_modules/.bin/tsx')}" "${join(ROOT, 'src/cli/index.ts')}" "$@"\n`);
  chmodSync(goodShim, 0o755);
  // old shim：不支持 --probe（模拟旧版无 query）
  oldShim = join(work, 'spectra-old');
  writeFileSync(oldShim, `#!/bin/sh\necho "spectra 4.2 (no query)"\nexit 0\n`);
  chmodSync(oldShim, 0o755);
  // minibin：仅 node 符号链接，作受控 PATH（spectra 在此 ENOENT，但 node/resolver spawn 仍工作）
  miniBin = join(work, 'minibin');
  mkdirSync(miniBin, { recursive: true });
  symlinkSync(process.execPath, join(miniBin, 'node'));
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('kb-prequery 端到端', () => {
  it('SC-003：配 knowledge_sources + good bin → 输出注入块（非指令前导 + envelope + 来源）', () => {
    const proj = join(work, 'p-good');
    writeProject(proj, true);
    const r = runPrequery(proj, '怎么配置坐标轴和提示框', goodShim);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('参考资料'); // 非指令前导
    expect(r.stdout).toContain('[KB-EVIDENCE');
    expect(r.stdout).toMatch(/option-xaxis\.md|option-tooltip\.md/);
  });

  it('SC-006a：旧版 bin（能跑但无 --probe sentinel）→ 降级 spectra-too-old，exit 0 空 stdout', () => {
    const proj = join(work, 'p-old');
    writeProject(proj, true);
    const r = runPrequery(proj, '坐标轴', oldShim);
    expect(r.status).toBe(0); // 不阻断
    expect(r.stdout.trim()).toBe('');
    expect(r.stderr).toContain('spectra-too-old'); // 修 Codex W2：区分旧版 vs 缺失
  });

  it('SC-006b：bin 不存在（ENOENT）→ 降级 spectra-unavailable，exit 0 空 stdout', () => {
    const proj = join(work, 'p-missing');
    writeProject(proj, true);
    // PATH=miniBin（仅 node，无 spectra）+ SPECTRA_BIN 不存在 → 'spectra' ENOENT → unavailable
    const r = runPrequery(proj, '坐标轴', join(work, 'nonexistent-spectra-bin'), miniBin);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
    expect(r.stderr).toContain('spectra-unavailable');
  });

  it('EC-001：未配 knowledge_sources → 不预查，exit 0 空 stdout', () => {
    const proj = join(work, 'p-none');
    writeProject(proj, false);
    const r = runPrequery(proj, '坐标轴', goodShim);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
    expect(r.stderr).toContain('disabled-or-unconfigured');
  });
});
