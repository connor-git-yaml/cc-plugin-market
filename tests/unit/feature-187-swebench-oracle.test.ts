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
