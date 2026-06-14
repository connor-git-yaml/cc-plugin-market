/**
 * Feature 187 — swebench-oracle 真实执行 smoke（SC-001/005/011/014）。
 *
 * ⚠️ 默认 skip：需 docker + venv + 真拉镜像跑 ~40s/实例。仅 RUN_SWEBENCH_SMOKE=1 时跑，
 * 绝不进入默认 `npx vitest run`（plan Decision 9）。本地验证 oracle 执行通路一次即可。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runSwebenchInstance } from '../../scripts/lib/swebench-oracle.mjs';

const SMOKE = process.env.RUN_SWEBENCH_SMOKE === '1';
const FIXTURE = 'tests/baseline/swe-bench-lite/fixtures/SWE-L003-pytest-rewrite-fails-when-first.json';

describe('runSwebenchInstance — DATASET_MISMATCH 归因 fixture（W-3，注入 fetchRows，不跑 harness）', () => {
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f187-w3-'));
  // 最小 fixture 对象（buildLocalDataset 在 harness spawn 之前即抛 → 不碰 docker/venv）
  const fixture = {
    swebenchMeta: {
      instanceId: 'astropy__astropy-99999',
      dataset: 'verified',
      failToPass: '["test_a"]',
      passToPass: '["test_b"]',
      testPatch: 'diff',
      goldPatch: 'patch',
    },
  };

  it('注入 fetchRows 抛 DATASET_MISMATCH → classification=error / failureSource=fixture / reason 含数据集错配', () => {
    const r = runSwebenchInstance({
      fixture,
      candidatePatch: 'patch',
      artifactsDir,
      runId: 'w3-mismatch',
      // py exit1 + DATASET_MISMATCH stderr 的真实链路：fetchOfficialRows throw → buildLocalDataset throw
      fetchRows: () => {
        throw new Error('swebench_fetch_rows.py 失败 (status=1): DATASET_MISMATCH: 实例 astropy__astropy-99999 不在 SWE-bench/SWE-bench_Verified');
      },
    });
    expect(r.classification).toBe('error');
    expect(r.failureSource).toBe('fixture');
    expect(r.details.classifyReason).toMatch(/数据集错配|DATASET_MISMATCH/);
  });

  it('注入 fetchRows 抛非 DATASET_MISMATCH（真 infra）→ failureSource=infra', () => {
    const r = runSwebenchInstance({
      fixture,
      candidatePatch: 'patch',
      artifactsDir,
      runId: 'w3-infra',
      fetchRows: () => {
        throw new Error('swebench_fetch_rows.py 失败 (status=1): ModuleNotFoundError: No module named datasets');
      },
    });
    expect(r.classification).toBe('error');
    expect(r.failureSource).toBe('infra');
  });

  it('未知 dataset tag（datasetTagToHfId 在 fetch 前裸抛）→ 不逃出 / classification=error / failureSource=fixture', () => {
    // 坏 tag = fixture 配置错误：datasetTagToHfId 在 buildLocalDataset/fetchRows 之前即抛，
    // 必须被 try 捕获并归 fixture（W-3 fail-closed 边界），而非逃出 runSwebenchInstance 致 runner 崩。
    const badFixture = { swebenchMeta: { ...fixture.swebenchMeta, dataset: 'bogus' } };
    const r = runSwebenchInstance({
      fixture: badFixture,
      candidatePatch: 'patch',
      artifactsDir,
      runId: 'w3-unknown-tag',
      // fetchRows 不会被调用（datasetTagToHfId 先抛）；注入仅为防御真跑 docker/venv
      fetchRows: () => {
        throw new Error('不应到达 fetchRows');
      },
    });
    expect(r.classification).toBe('error');
    expect(r.failureSource).toBe('fixture');
    expect(r.details.classifyReason).toMatch(/数据集错配|未知 dataset/);
  });
});

describe.skipIf(!SMOKE)('swebench-oracle 真实执行 smoke（SWE-L003）', () => {
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f187-smoke-'));

  it('正控：candidatePatch=goldPatch → classification=pass + resolved + 执行集匹配（SC-001/005/011/014）', () => {
    const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
    const r = runSwebenchInstance({
      fixturePath: FIXTURE,
      candidatePatch: fx.swebenchMeta.goldPatch, // 显式正控（FR-001-e 允许）
      artifactsDir, runId: 'smoke-pos', timeoutMs: 600_000,
    });
    expect(r.kind).toBe('swebench-execution');
    expect(r.classification).toBe('pass');
    expect(r.passed).toBe(true);
    expect(r.details.resolved).toBe(true);
    // SC-011：提交的就是候选 patch（此处 = goldPatch 正控），candidatePatchSha 非空
    expect(r.details.candidatePatchSha).toMatch(/^[0-9a-f]{64}$/);
    // SC-014：实际执行的 failToPass 与 fixture 一致
    expect(r.details.executedMatchesFixture).toBe(true);
    expect(r.details.failToPassExecuted.length).toBeGreaterThan(0);
  }, 700_000);

  it('反控：candidatePatch=空 → classification=fail/candidate（未修复，harness completed）', () => {
    const r = runSwebenchInstance({
      fixturePath: FIXTURE,
      candidatePatch: '', // 空 patch = 未修复
      artifactsDir, runId: 'smoke-neg', timeoutMs: 600_000,
    });
    expect(r.classification).toBe('fail');
    expect(r.failureSource).toBe('candidate');
    expect(r.passed).toBe(false);
  }, 700_000);
});
