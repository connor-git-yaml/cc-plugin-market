/**
 * Feature 197 W1 — datasetTagToHfId 映射 + 数据集错配诊断单测。
 *
 * 核心：fixture.swebenchMeta.dataset 标签必须透传为正确的 HF dataset id（Lite/Verified），
 * 否则 Verified 实例从 Lite 取行 → missing → 静默剔分母（违反 FR-A-002b）。
 * buildLocalDataset 注入 fetchRows（W-4）免跑真 venv/Python。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { datasetTagToHfId, buildLocalDataset } from '../../scripts/lib/swebench-dataset-build.mjs';

const BUILDER_CLI = fileURLToPath(new URL('../../scripts/lib/swebench-dataset-build.mjs', import.meta.url));

function writeFixture(dir: string, name: string, dataset: string | null): string {
  const p = path.join(dir, name);
  const meta: Record<string, unknown> = {
    instanceId: `org__repo-${name}`,
    failToPass: '[]', passToPass: '[]', testPatch: '', goldPatch: '',
  };
  if (dataset !== null) meta.dataset = dataset;
  fs.writeFileSync(p, JSON.stringify({ swebenchMeta: meta }));
  return p;
}

describe('datasetTagToHfId — dataset 标签 → HF id 单一来源（W1）', () => {
  it("'lite' → SWE-bench/SWE-bench_Lite", () => {
    expect(datasetTagToHfId('lite')).toBe('SWE-bench/SWE-bench_Lite');
  });
  it("'verified' → SWE-bench/SWE-bench_Verified", () => {
    expect(datasetTagToHfId('verified')).toBe('SWE-bench/SWE-bench_Verified');
  });
  it('null → 默认 Lite（向后兼容）', () => {
    expect(datasetTagToHfId(null)).toBe('SWE-bench/SWE-bench_Lite');
  });
  it("'unknown' → throw（不静默回退）", () => {
    expect(() => datasetTagToHfId('unknown')).toThrow();
  });
});

describe('buildLocalDataset — 数据集错配诊断（W1，注入 fetchRows）', () => {
  const meta = {
    instanceId: 'astropy__astropy-12345',
    failToPass: '["test_a"]',
    passToPass: '["test_b"]',
    testPatch: 'diff',
    goldPatch: 'patch',
  };
  const fixtureObj = { swebenchMeta: meta };

  it('fetchRows 返回缺失实例 → mismatches 标 fixture 级"数据集错配"（区别真 infra）', () => {
    const r = buildLocalDataset({
      fixtures: [fixtureObj],
      outPath: null,
      datasetName: 'SWE-bench/SWE-bench_Lite',
      fetchRows: () => [], // 实例不在 Lite → 返回空（缺失）
    });
    expect(r.mismatches.length).toBe(1);
    expect(r.mismatches[0].failureSource).toBe('fixture');
    expect(r.mismatches[0].reason).toMatch(/数据集错配/);
    expect(r.mismatches[0].reason).toContain('SWE-bench/SWE-bench_Lite');
    expect(r.mismatches[0].reason).toContain(meta.instanceId);
  });

  it('fetchRows 返回匹配行 → 无 mismatch', () => {
    const officialRow = {
      instance_id: meta.instanceId,
      FAIL_TO_PASS: ['test_a'],
      PASS_TO_PASS: ['test_b'],
      test_patch: 'diff',
      patch: 'patch',
    };
    const r = buildLocalDataset({
      fixtures: [fixtureObj],
      outPath: null,
      datasetName: 'SWE-bench/SWE-bench_Verified',
      fetchRows: () => [officialRow],
    });
    expect(r.mismatches.length).toBe(0);
    expect(r.rows.length).toBe(1);
  });
});

describe('CLI dataset 标签推导（W-1）— 默认按 fixture.dataset 取数，禁止混 dataset', () => {
  it('混合 dataset 标签的 fixture → exit 2 + 标签不一致报错', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-w1-cli-'));
    const a = writeFixture(dir, 'verified.json', 'verified');
    const b = writeFixture(dir, 'lite.json', 'lite');
    const res = spawnSync('node', [BUILDER_CLI, '--fixture', a, '--fixture', b, '--out', path.join(dir, 'out.json')], { encoding: 'utf-8' });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/dataset 标签不一致/);
  });

  it('未知 dataset 标签 → exit 2（不静默回退 Lite）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-w1-cli-'));
    const c = writeFixture(dir, 'bogus.json', 'bogus');
    const res = spawnSync('node', [BUILDER_CLI, '--fixture', c, '--out', path.join(dir, 'out.json')], { encoding: 'utf-8' });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/未知 dataset tag/);
  });

  it('单一一致标签 → 通过标签推导守卫（不报标签错），继续走 fetch（datasetName 已透传，非默认 Lite 由 datasetTagToHfId 保证）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-w1-cli-'));
    const v = writeFixture(dir, 'v.json', 'verified');
    // 显式注入不存在的 --venv 路径（挂在本用例专属 mkdtemp 临时目录下，避免依赖本机是否存在
    // scripts/.swebench-venv 这一环境状态，见 F209 fix-report）→ fetch 阶段快速失败（非 0），
    // 但绝不应命中 W-1 守卫的"标签不一致"/"未知 dataset tag"分支
    const venvPath = path.join(dir, 'nonexistent-venv');
    const res = spawnSync(
      'node',
      [BUILDER_CLI, '--fixture', v, '--out', path.join(dir, 'out.json'), '--venv', venvPath],
      { encoding: 'utf-8' },
    );
    expect(res.status).not.toBe(0); // fetch 失败（venv 不存在）
    // 正向锚定失败来源于 fetch 阶段（swebench_fetch_rows.py 报错）＝ W-1 守卫已放行；
    // 否则 stderr 为空的意外早退（如 argv 解析错位）也能让下面两条反向断言恒真（codex W-2）
    expect(res.stderr).toMatch(/swebench_fetch_rows\.py 失败/);
    expect(res.stderr).not.toMatch(/dataset 标签不一致/);
    expect(res.stderr).not.toMatch(/未知 dataset tag/);
  });
});
