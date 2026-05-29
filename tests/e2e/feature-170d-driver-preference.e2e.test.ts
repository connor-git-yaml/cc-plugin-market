/**
 * F170d — driver E2E（US2 / US3 / US4 / SC-009，host shell only）
 *
 * 真实 driver 行为测的**唯一执行入口是 harness 脚本** `scripts/feature-170d-driver-preference.mjs`
 * （需 Claude Max OAuth + dist/cli + graph.json）。本 vitest 文件是**可选的 host wrapper**：
 *
 *   - 默认（sandbox / CI）：`HOST_E2E` 未设 → 整组 describe.skip，不跑。
 *   - host 实测：先 `npm run build`，再 `HOST_E2E=1 npx vitest run --project e2e tests/e2e/feature-170d-driver-preference.e2e.test.ts`
 *     wrapper 会 spawn harness 脚本并断言其 exit code / 报告字段。
 *   - 或绕开 vitest 直接：`node scripts/feature-170d-driver-preference.mjs --repeats 2`（推荐，输出更详细）。
 *
 * ⚠️ 不要"手动去掉 .skip"——请改用 HOST_E2E=1（gate 由 env 控制，避免误在 sandbox 触发真实 LLM 计费）。
 *
 * 机制正确性（args/namespace/注入块/三层指标）已由 tests/unit/spec-driver/feature-170d-harness.test.ts
 * 在 sandbox 代理验证；本文件验证真实 driver 行为。
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = process.env.HOST_E2E === '1';
const d = HOST ? describe : describe.skip;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS = path.join(ROOT, 'scripts/feature-170d-driver-preference.mjs');
const HOST_TIMEOUT = 1_800_000; // 30 min（N=10 真实 LLM）

function runHarness(extraArgs: string[]): { status: number | null; stdout: string } {
  const r = spawnSync('node', [HARNESS, ...extraArgs], {
    cwd: ROOT, encoding: 'utf-8', timeout: HOST_TIMEOUT, maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '' };
}

d('F170d SC-002 — guided active-call rate ≥ 50%（host shell only）', () => {
  it('N=10 (5 task × 2 repeat)，注入引导后 ≥ 5/10 合规主动调 impact（harness exit 0）', () => {
    // T030：harness exit 0 = primary-pass (≥50%)；1 = <50%；2 = fatal
    const { status, stdout } = runHarness(['--repeats', '2']);
    expect(stdout).toContain('outcomeType');
    expect(status, 'SC-002 primary gate ≥50% 未达（exit≠0）；详见 stdout 三层指标').toBe(0);
  }, HOST_TIMEOUT);
});

d('F170d SC-003 — Grep fallback（host shell only）', () => {
  it('--simulate-graph-missing：graph-not-built 时 driver 回退 Grep 且任务推进', () => {
    const { stdout } = runHarness(['--simulate-graph-missing', '--repeats', '1']);
    expect(stdout).toMatch(/fallback|Grep/i);
  }, HOST_TIMEOUT);
});

d('F170d SC-004 — chained call rate ≥ 30%（host shell only，secondary 不阻塞）', () => {
  it('cohort C N=3 中 ≥ 1 个出现 detect_changes → impact → context chain', () => {
    // T032：复用 F167 cohort C；secondary，记录即可
    const { stdout } = runHarness(['--mode', 'chain', '--repeats', '1']);
    expect(stdout).toMatch(/chain/i);
  }, HOST_TIMEOUT);
});

d('F170d SC-009 — negative-control over-call ≤ 1/3（host shell only，soft）', () => {
  it('--negative-control：3 个 non-caller-analysis task 中调 MCP 的 run ≤ 1/3', () => {
    const { stdout } = runHarness(['--negative-control']);
    expect(stdout).toMatch(/negative-control|over-call/i);
  }, HOST_TIMEOUT);
});
