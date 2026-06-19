/**
 * goal-loop-core.test.mjs
 * Feature 201 — goal_loop 确定性 core 纯函数测试 + 文件锁 I/O 集成测试
 *
 * 测试边界（plan §7 诚实分层）：
 *   - 纯函数单测（T-GL-05~17/19/20/21）：直接 import core 纯函数喂 fixture 断言
 *   - I/O 集成测试（T-GL-18）：temp-dir 文件锁，非纯函数，单列 describe 块
 *
 * 运行方式: node --test plugins/spec-driver/tests/goal-loop-core.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  classifyCommand,
  evaluateMetric,
  detectRegression,
  computeDelta,
  decideStop,
  decideDispatch,
  selectVerifyMode,
  planSnapshotCommands,
  planRollbackCommands,
  parseReport,
  interpretImpactResult,
  formatIterationLogEntry,
} from '../scripts/lib/goal-loop-core.mjs';
import { acquireLock, releaseLock } from '../scripts/goal-loop-cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'goal-loop');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8'));
}

function readFixtureText(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

// 默认 goal_loop 配置（与 plan §2 / config-schema default 对齐）
const DEFAULT_CONFIG = {
  max_iterations: 5,
  no_progress_max_rounds: 2,
  max_verify_seconds: 300,
  max_tool_invocations: 50,
};

// ──────────────────────────────────────────────────────────────────────────
// T-GL-10：classifyCommand（FR-009）
// ──────────────────────────────────────────────────────────────────────────
describe('classifyCommand (FR-009)', () => {
  it('T-GL-10: 缺 exit_code → UNKNOWN', () => {
    assert.equal(classifyCommand({ skipped_reason: null }), 'UNKNOWN');
  });

  it('exit_code 非数字 → UNKNOWN', () => {
    assert.equal(classifyCommand({ exit_code: 'oops', skipped_reason: null }), 'UNKNOWN');
    assert.equal(classifyCommand({ exit_code: null, skipped_reason: null }), 'UNKNOWN');
  });

  it('skipped_reason 非 null → SKIPPED（优先于 exit_code 判定）', () => {
    assert.equal(classifyCommand({ exit_code: 0, skipped_reason: 'tool_not_installed' }), 'SKIPPED');
    assert.equal(classifyCommand({ exit_code: null, skipped_reason: 'tool_not_installed' }), 'SKIPPED');
  });

  it('exit_code === 0 → PASS', () => {
    assert.equal(classifyCommand({ exit_code: 0, skipped_reason: null }), 'PASS');
  });

  it('exit_code !== 0（含超时非零）→ FAIL', () => {
    assert.equal(classifyCommand({ exit_code: 1, skipped_reason: null }), 'FAIL');
    assert.equal(classifyCommand({ exit_code: 124, skipped_reason: null }), 'FAIL');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T-GL-09：evaluateMetric（FR-008）
// ──────────────────────────────────────────────────────────────────────────
describe('evaluateMetric (FR-008)', () => {
  it('full 全 PASS + p1 100% + COMPLIANT → 达标 true', () => {
    assert.equal(evaluateMetric(loadFixture('report-full-pass.json')), true);
  });

  it('T-GL-09: layer2 含 SKIPPED → 不达标 false', () => {
    assert.equal(evaluateMetric(loadFixture('report-skipped-command.json')), false);
  });

  it('p1_coverage_pct !== 100 → 不达标', () => {
    assert.equal(evaluateMetric(loadFixture('report-fail-regression.json')), false);
  });

  it('缺 exit_code 条目（UNKNOWN）→ 不达标', () => {
    assert.equal(evaluateMetric(loadFixture('report-missing-exit-code.json')), false);
  });

  it('layer1_5 非 COMPLIANT → 不达标', () => {
    const r = loadFixture('report-full-pass.json');
    r.layer1_5_evidence.status = 'PARTIAL';
    assert.equal(evaluateMetric(r), false);
  });

  it('layer2 含 FAIL → 不达标', () => {
    const r = loadFixture('report-full-pass.json');
    r.layer2_commands[1].exit_code = 1;
    r.layer2_commands[1].status = 'FAIL';
    assert.equal(evaluateMetric(r), false);
  });

  // ── Codex C3：空命令集 vacuous-truth 防线 ──
  it('C3: layer2_commands=[] → 不达标（防 every() vacuous-truth 自动达标）', () => {
    const r = loadFixture('report-full-pass.json');
    r.layer2_commands = []; // 空命令集 + 覆盖 100 + COMPLIANT，若无防线会被误判达标
    assert.equal(evaluateMetric(r), false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T-GL-11：parseReport（FR-010）
// ──────────────────────────────────────────────────────────────────────────
describe('parseReport (FR-010)', () => {
  it('合法 full report → { report }', () => {
    const result = parseReport(readFixtureText('report-full-pass.json'));
    assert.ok(result.report);
    assert.equal(result.report.verify_mode, 'full');
    assert.equal(result.degraded, undefined);
  });

  it('T-GL-11: 非法 JSON → infra-failure 降级', () => {
    const result = parseReport(readFixtureText('report-invalid-json.txt'));
    assert.equal(result.degraded, 'infra-failure');
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
    assert.equal(result.report, undefined);
  });

  it('缺 exit_code 字段的命令 → infra-failure 降级', () => {
    const result = parseReport(readFixtureText('report-missing-exit-code.json'));
    assert.equal(result.degraded, 'infra-failure');
    assert.ok(/exit_code/i.test(result.reason));
  });

  it('缺 schema 必填字段（layer2_commands）→ infra-failure 降级', () => {
    const result = parseReport(JSON.stringify({ round: 1, verify_mode: 'full' }));
    assert.equal(result.degraded, 'infra-failure');
  });

  it('C3: layer2_commands=[] 空数组 → infra-failure 降级（verify 未产出任何命令）', () => {
    const result = parseReport(
      JSON.stringify({
        round: 1,
        verify_mode: 'full',
        layer2_commands: [],
        layer1_fr_coverage: { p1_coverage_pct: 100 },
        layer1_5_evidence: { status: 'COMPLIANT' },
      }),
    );
    assert.equal(result.degraded, 'infra-failure');
    assert.ok(/layer2_commands 为空|verify 未产出/.test(result.reason));
    assert.equal(result.report, undefined);
  });

  it('纯函数：不写日志、不产生副作用（多次调用结果一致）', () => {
    const text = readFixtureText('report-full-pass.json');
    const a = parseReport(text);
    const b = parseReport(text);
    assert.deepEqual(a, b);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T-GL-07 / T-GL-08：computeDelta（FR-006）
// ──────────────────────────────────────────────────────────────────────────
describe('computeDelta (FR-006)', () => {
  it('prevReport=null（第一轮）→ 以零基线比较，有非零维则 hasProgress', () => {
    const cur = loadFixture('report-smoke-pass.json');
    const { delta, hasProgress } = computeDelta(null, cur);
    assert.equal(delta.length, 5);
    // 第一轮相对零基线，layer2_pass_count=2 等非零 → 有进展
    assert.equal(hasProgress, true);
  });

  it('T-GL-08: 一维 layer2_pass +1 → hasProgress=true（不早停）', () => {
    const prev = loadFixture('report-skipped-command.json'); // layer2_pass_count=1
    const cur = loadFixture('report-smoke-pass.json'); // layer2_pass_count=2
    const { delta, hasProgress } = computeDelta(prev, cur);
    assert.equal(delta[0], 1); // d1 = 2 - 1
    assert.equal(hasProgress, true);
  });

  it('T-GL-07: 两轮 delta_inputs 完全相同 → metric 四维全 0 → hasProgress=false（W4：显式断言 false）', () => {
    const prev = loadFixture('report-full-pass.json');
    const cur = loadFixture('report-full-pass.json');
    const { delta, hasProgress } = computeDelta(prev, cur);
    // delta 向量仍保留 d5=net_loc_delta（本轮绝对净变更，仅作日志）
    assert.deepEqual(delta, [0, 0, 0, 0, cur.delta_inputs.net_loc_delta]);
    // 关键（Codex C1）：即便 d5≠0（本轮改了代码），metric 四维全 0 → hasProgress 必须为 false
    assert.notEqual(cur.delta_inputs.net_loc_delta, 0, '前置：fixture net_loc 非 0 才能验证 C1');
    assert.equal(hasProgress, false);
  });

  it('C1: metric 四维全平但 net_loc_delta≠0 → hasProgress=false（LOC churn 不计入进展）', () => {
    const prev = loadFixture('report-full-pass.json');
    const cur = loadFixture('report-full-pass.json');
    // 显式构造：每轮都改代码（net_loc 大幅变化）但 metric 四维不变
    cur.delta_inputs = { ...cur.delta_inputs, net_loc_delta: 999 };
    const { delta, hasProgress } = computeDelta(prev, cur);
    assert.equal(delta[4], 999);
    assert.equal(hasProgress, false);
  });

  it('五维全 0（含 net_loc_delta=0）→ hasProgress=false', () => {
    const prev = loadFixture('report-full-pass.json');
    const cur = loadFixture('report-full-pass.json');
    // 强制本轮 net_loc_delta 为 0（无新增代码）
    cur.delta_inputs = { ...cur.delta_inputs, net_loc_delta: 0 };
    const { delta, hasProgress } = computeDelta(prev, cur);
    assert.deepEqual(delta, [0, 0, 0, 0, 0]);
    assert.equal(hasProgress, false);
  });

  it('C1: 仅 metric 改善方向计入——d1>0/d2>0/d3>0/d4<0 各自单独触发 hasProgress', () => {
    const base = { delta_inputs: { layer2_pass_count: 1, p1_fr_coverage_pct: 50, layer1_5_status_score: 1, regression_count: 1, net_loc_delta: 0 }, verify_mode: 'full' };
    const bump = (k, v) => ({ delta_inputs: { ...base.delta_inputs, [k]: v }, verify_mode: 'full' });
    assert.equal(computeDelta(base, bump('layer2_pass_count', 2)).hasProgress, true); // d1>0
    assert.equal(computeDelta(base, bump('p1_fr_coverage_pct', 60)).hasProgress, true); // d2>0
    assert.equal(computeDelta(base, bump('layer1_5_status_score', 2)).hasProgress, true); // d3>0
    assert.equal(computeDelta(base, bump('regression_count', 0)).hasProgress, true); // d4<0
    // 反向恶化（metric 变差）不算进展
    assert.equal(computeDelta(base, bump('layer2_pass_count', 0)).hasProgress, false); // d1<0
    assert.equal(computeDelta(base, bump('regression_count', 2)).hasProgress, false); // d4>0
  });

  it('d4 regression_count 改善（负）→ hasProgress=true', () => {
    const prev = loadFixture('report-fail-regression.json'); // regression_count=1
    const cur = loadFixture('report-full-pass.json'); // regression_count=0
    const { delta, hasProgress } = computeDelta(prev, cur);
    assert.equal(delta[3], -1); // 0 - 1
    assert.equal(hasProgress, true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T-GL-12：detectRegression（FR-013）—— smoke↔full 分桶不误判
// ──────────────────────────────────────────────────────────────────────────
describe('detectRegression (FR-013)', () => {
  it('prevReport=null（第一轮）→ 无回归', () => {
    const cur = loadFixture('report-fail-regression.json');
    assert.deepEqual(detectRegression(null, cur), { regression: false, commands: [] });
  });

  it('同 full 模式：上轮 PASS 本轮 FAIL → regression=true', () => {
    const prev = loadFixture('report-full-pass.json'); // vitest PASS
    const cur = loadFixture('report-fail-regression.json'); // vitest FAIL
    const result = detectRegression(prev, cur);
    assert.equal(result.regression, true);
    assert.deepEqual(result.commands, ['npx vitest run']);
  });

  it('T-GL-12: smoke↔full 跨模式不比较（smoke 上轮 vs full 本轮）→ 不误判', () => {
    // 上轮 smoke（tsc + vitest，无 lint/repo:check）；本轮 full 新增 repo:check
    // 即使 full 引入了 smoke 未跑的命令，跨模式不应判 regression
    const prevSmoke = loadFixture('report-smoke-pass.json');
    const curFull = loadFixture('report-fail-regression.json');
    const result = detectRegression(prevSmoke, curFull);
    // 不同 verify_mode → 跨桶不比较 → 不误判
    assert.equal(result.regression, false);
    assert.deepEqual(result.commands, []);
  });

  it('同 smoke 模式：上轮 PASS 本轮某命令 FAIL → regression（同桶才比）', () => {
    const prev = loadFixture('report-smoke-pass.json');
    const cur = loadFixture('report-smoke-pass.json');
    // 本轮 smoke 的 vitest 转 FAIL
    cur.layer2_commands = cur.layer2_commands.map((c) =>
      c.name === 'npx vitest run' ? { ...c, exit_code: 1, status: 'FAIL' } : c,
    );
    const result = detectRegression(prev, cur);
    assert.equal(result.regression, true);
    assert.deepEqual(result.commands, ['npx vitest run']);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T-GL-19：planSnapshotCommands（FR-013）
// ──────────────────────────────────────────────────────────────────────────
describe('planSnapshotCommands (FR-013)', () => {
  it('T-GL-19: isClean=true → 空命令序列（仅 HEAD 锚点，无 stash）', () => {
    assert.deepEqual(planSnapshotCommands(true), []);
  });

  it('T-GL-19: isClean=false → stash push -u + rev-parse + apply --index 完整序列（W4 完整 deepEqual）', () => {
    // W4：从弱断言（逐条 regex/includes）强化为完整命令序列 deepEqual，锁定字面值与顺序
    assert.deepEqual(planSnapshotCommands(false), [
      'git stash push --include-untracked -m "goal_loop-S{i}"',
      'git rev-parse stash@{0}',
      'git stash apply --index {stash_ref}',
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T-GL-12b：planRollbackCommands（FR-013）—— 双分支完整命令序列
// ──────────────────────────────────────────────────────────────────────────
describe('planRollbackCommands (FR-013)', () => {
  // 合法 40 位 hex SHA-1（Codex W2 校验通过）
  const VALID_SHA = 'a'.repeat(40);
  const VALID_SHA_2 = '0123456789abcdef0123456789abcdef01234567';

  it('T-GL-12b: clean 分支 → [reset --hard HEAD, clean -fd]（无 stash apply，clean 不校验 ref）', () => {
    // clean 分支不拼 ref，故即使 ref 非法也不应抛错
    const cmds = planRollbackCommands({ clean: true, ref: 'abc123' });
    assert.deepEqual(cmds, ['git reset --hard HEAD', 'git clean -fd']);
  });

  it('T-GL-12b: 非 clean 分支 → [reset --hard HEAD, clean -fd, stash apply --index <ref>] 完整有序', () => {
    const cmds = planRollbackCommands({ clean: false, ref: VALID_SHA_2 });
    assert.deepEqual(cmds, [
      'git reset --hard HEAD',
      'git clean -fd',
      `git stash apply --index ${VALID_SHA_2}`,
    ]);
  });

  it('clean -fd 不带 -x（保留 .gitignore 文件），不带 -ff（不删嵌套仓库）', () => {
    const cmds = planRollbackCommands({ clean: false, ref: VALID_SHA });
    const cleanCmd = cmds.find((c) => c.startsWith('git clean'));
    assert.equal(cleanCmd, 'git clean -fd');
    assert.ok(!/-x/.test(cleanCmd));
    assert.ok(!/-ff/.test(cleanCmd));
  });

  // ── Codex W2：非法 ref 注入面防护 ──
  it('W2: 非 40 位 hex ref（短 SHA）→ 抛错，拒绝拼入命令', () => {
    assert.throws(() => planRollbackCommands({ clean: false, ref: 'deadbeef' }), /非法 snapshot ref/);
  });

  it('W2: shell 注入型 ref → 抛错，绝不拼入命令字符串', () => {
    assert.throws(
      () => planRollbackCommands({ clean: false, ref: 'abc; rm -rf /' }),
      /非法 snapshot ref/,
    );
  });

  it('W2: ref 含非 hex 字符（如大写/g-z）→ 抛错', () => {
    assert.throws(
      () => planRollbackCommands({ clean: false, ref: 'G'.repeat(40) }),
      /非法 snapshot ref/,
    );
    assert.throws(
      () => planRollbackCommands({ clean: false, ref: 'A'.repeat(40) }),
      /非法 snapshot ref/,
    );
  });

  it('W2: ref 非字符串（null/数字）→ 抛错', () => {
    assert.throws(() => planRollbackCommands({ clean: false, ref: null }), /非法 snapshot ref/);
    assert.throws(() => planRollbackCommands({ clean: false, ref: 123 }), /非法 snapshot ref/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T-GL-16：selectVerifyMode（FR-007）
// ──────────────────────────────────────────────────────────────────────────
describe('selectVerifyMode (FR-007)', () => {
  it('T-GL-16: round < max && !aboutToExit → smoke', () => {
    assert.equal(selectVerifyMode(1, 5, false), 'smoke');
    assert.equal(selectVerifyMode(4, 5, false), 'smoke');
  });

  it('T-GL-16: round === max → full', () => {
    assert.equal(selectVerifyMode(5, 5, false), 'full');
  });

  it('T-GL-16: aboutToExit=true（达标前强制 full）→ full', () => {
    assert.equal(selectVerifyMode(2, 5, true), 'full');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T-GL-14：decideDispatch（FR-017）
// ──────────────────────────────────────────────────────────────────────────
describe('decideDispatch (FR-017)', () => {
  it('goal_loop + implement phase → dispatch=goal_loop', () => {
    assert.deepEqual(decideDispatch('implement', 'goal_loop'), { dispatch: 'goal_loop' });
  });

  it('T-GL-14: goal_loop 配在非 implement phase → 降级 single + warning', () => {
    const result = decideDispatch('plan', 'goal_loop');
    assert.equal(result.dispatch, 'single');
    assert.ok(typeof result.warning === 'string' && result.warning.length > 0);
  });

  it('single 透传', () => {
    assert.deepEqual(decideDispatch('implement', 'single'), { dispatch: 'single' });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T-GL-17：interpretImpactResult（FR-011/012）—— 纯函数
// ──────────────────────────────────────────────────────────────────────────
describe('interpretImpactResult (FR-012)', () => {
  it('有效 impact 数据 → injected=true + summary', () => {
    const result = interpretImpactResult({
      affected: [{ id: 'a.ts::foo' }, { id: 'b.ts::bar' }],
      summary: { riskLevel: 'low' },
    });
    assert.equal(result.injected, true);
    assert.ok(typeof result.summary === 'string' && result.summary.length > 0);
  });

  it('T-GL-17: graph-not-built 错误 → skipped + warning，不中止', () => {
    const result = interpretImpactResult({ error: 'graph-not-built' });
    assert.equal(result.injected, false);
    assert.equal(result.skipped, true);
    assert.ok(/graph-not-built/.test(result.warning));
  });

  it('空结果 → skipped + warning', () => {
    const result = interpretImpactResult(null);
    assert.equal(result.injected, false);
    assert.equal(result.skipped, true);
    assert.ok(typeof result.warning === 'string');
  });

  it('error 字段非空 → skipped + warning 含 reason', () => {
    const result = interpretImpactResult({ error: 'connection refused' });
    assert.equal(result.skipped, true);
    assert.ok(/connection refused/.test(result.warning));
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T-GL-21：formatIterationLogEntry（FR-019）—— 内嵌 JSON 可解析
// ──────────────────────────────────────────────────────────────────────────
describe('formatIterationLogEntry (FR-019)', () => {
  it('T-GL-21: 返回含内嵌 ```json 围栏的 markdown 块，且 JSON 可解析', () => {
    const entry = {
      round: 2,
      metric: false,
      delta: [1, 0, 0, 0, 30],
      exit_reason: null,
      snapshot: { clean: false, ref: 'abc123' },
      timestamp: '2026-06-20T10:05:00Z',
    };
    const md = formatIterationLogEntry(entry);
    assert.ok(typeof md === 'string');
    // 含 markdown 标题（轮次可见）
    assert.ok(/round|轮/i.test(md));
    // 含 ```json 围栏
    assert.ok(md.includes('```json'));
    // 提取围栏内 JSON 并断言可解析且字段一致
    const match = md.match(/```json\s*([\s\S]*?)```/);
    assert.ok(match, '必须含 ```json 围栏');
    const parsed = JSON.parse(match[1]);
    assert.equal(parsed.round, 2);
    assert.equal(parsed.exit_reason, null);
    assert.deepEqual(parsed.snapshot, { clean: false, ref: 'abc123' });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// decideStop（FR-004 优先级）—— T-GL-05/06/07/13/20
// ──────────────────────────────────────────────────────────────────────────
describe('decideStop (FR-004 优先级)', () => {
  it('T-GL-13: rollbackResult 失败 → ROLLBACK_FAILED（最高优先）', () => {
    const result = decideStop({
      report: loadFixture('report-full-pass.json'), // 即使达标也让位回滚失败
      round: 2,
      config: DEFAULT_CONFIG,
      prevReports: [],
      rollbackResult: { success: false },
    });
    assert.equal(result.stop, true);
    assert.equal(result.exit_reason, 'ROLLBACK_FAILED');
    assert.equal(result.action, 'goto_gate_verify');
  });

  // ── Codex W1：regression 分桶必须取"上一个同模式轮次"，非固定最后一轮 ──
  it('W1: full→smoke→full FAIL 序列 → 当前 full 与上一个 full 比，检出 regression（不被中间 smoke 干扰）', () => {
    const fullPass = loadFixture('report-full-pass.json'); // full，vitest PASS
    const smokePass = loadFixture('report-smoke-pass.json'); // 中间 smoke 轮
    const curFullFail = loadFixture('report-fail-regression.json'); // full，vitest FAIL
    const result = decideStop({
      report: curFullFail,
      round: 4,
      config: { ...DEFAULT_CONFIG, max_iterations: 5 },
      // history 旧→新：full(PASS) → smoke → 本轮 full(FAIL)
      // 若错误地取最后一轮(smoke)比较，跨桶 → 漏判；正确应跳过 smoke 取上一个 full
      prevReports: [fullPass, smokePass],
      rollbackResult: null,
    });
    assert.equal(result.exit_reason, 'REGRESSION_ROLLBACK');
    assert.equal(result.action, 'rollback');
  });

  it('W1: 上一个同模式轮次 PASS、最后一轮（异模式）存在 → 仍按同模式比较', () => {
    // 反向确认：当前 smoke，上一个 smoke PASS，中间 full → 跨桶不取 full
    const smokePass = loadFixture('report-smoke-pass.json');
    const fullPass = loadFixture('report-full-pass.json');
    // 本轮 smoke 的 vitest 转 FAIL（相对上一个 smoke 是 regression）
    const curSmokeFail = {
      ...smokePass,
      layer2_commands: smokePass.layer2_commands.map((c) =>
        c.name === 'npx vitest run' ? { ...c, exit_code: 1, status: 'FAIL' } : c,
      ),
    };
    const result = decideStop({
      report: curSmokeFail,
      round: 4,
      config: { ...DEFAULT_CONFIG, max_iterations: 5 },
      prevReports: [smokePass, fullPass], // 上一个 smoke 在更早位置，最后一轮是 full
      rollbackResult: null,
    });
    assert.equal(result.exit_reason, 'REGRESSION_ROLLBACK');
  });

  it('regression（优先级 2）高于 max_iterations（优先级 4）', () => {
    // 上轮 full PASS，本轮 full 同模式 vitest FAIL → regression
    const result = decideStop({
      report: loadFixture('report-fail-regression.json'),
      round: 5,
      config: { ...DEFAULT_CONFIG, max_iterations: 5 },
      prevReports: [loadFixture('report-full-pass.json')],
      rollbackResult: null,
    });
    assert.equal(result.exit_reason, 'REGRESSION_ROLLBACK');
    assert.equal(result.action, 'rollback');
  });

  it('T-GL-05: 末轮达标（i===max）→ REACHED_GOAL（达标优先于 max_iterations）', () => {
    const result = decideStop({
      report: loadFixture('report-full-pass.json'),
      round: 5,
      config: { ...DEFAULT_CONFIG, max_iterations: 5 },
      prevReports: [loadFixture('report-smoke-pass.json')], // 上轮 smoke，跨桶无 regression
      rollbackResult: null,
    });
    assert.equal(result.stop, true);
    assert.equal(result.exit_reason, 'REACHED_GOAL');
    assert.equal(result.action, 'goto_gate_verify');
  });

  it('达标（非末轮，full 模式）→ REACHED_GOAL', () => {
    const result = decideStop({
      report: loadFixture('report-full-pass.json'),
      round: 2,
      config: DEFAULT_CONFIG,
      prevReports: [loadFixture('report-smoke-pass.json')],
      rollbackResult: null,
    });
    assert.equal(result.exit_reason, 'REACHED_GOAL');
  });

  // ── Codex C2：smoke 全绿不得直接 REACHED_GOAL，必须 escalate_full ──
  it('C2: smoke 轮 metric 满足 → 不得 REACHED_GOAL，返回 escalate_full（不退出）', () => {
    const smokePass = loadFixture('report-smoke-pass.json'); // verify_mode=smoke 且全 PASS+p1 100+COMPLIANT
    // 前置：evaluateMetric 本身满足（与 verify_mode 无关）
    assert.equal(evaluateMetric(smokePass), true);
    const result = decideStop({
      report: smokePass,
      round: 2,
      config: DEFAULT_CONFIG,
      prevReports: [],
      rollbackResult: null,
    });
    assert.equal(result.stop, false);
    assert.equal(result.action, 'escalate_full');
    assert.equal(result.exit_reason, null);
    assert.notEqual(result.exit_reason, 'REACHED_GOAL');
  });

  it('C2: full 轮 metric 满足 → REACHED_GOAL（经 full verify 才算达标）', () => {
    const fullPass = loadFixture('report-full-pass.json'); // verify_mode=full
    const result = decideStop({
      report: fullPass,
      round: 2,
      config: DEFAULT_CONFIG,
      prevReports: [],
      rollbackResult: null,
    });
    assert.equal(result.stop, true);
    assert.equal(result.exit_reason, 'REACHED_GOAL');
    assert.equal(result.action, 'goto_gate_verify');
  });

  it('C2: smoke escalate_full 优先于 max_iterations（末轮 smoke 满足也先升级 full）', () => {
    // 防御性：即使 round===max，smoke 满足也不能直接 REACHED_GOAL；escalate_full 让编排器升 full
    const smokePass = loadFixture('report-smoke-pass.json');
    const result = decideStop({
      report: smokePass,
      round: 5,
      config: { ...DEFAULT_CONFIG, max_iterations: 5 },
      prevReports: [],
      rollbackResult: null,
    });
    assert.equal(result.action, 'escalate_full');
    assert.notEqual(result.exit_reason, 'REACHED_GOAL');
    assert.notEqual(result.exit_reason, 'MAX_ITERATIONS');
  });

  it('T-GL-06: 未达标 + round >= max_iterations → MAX_ITERATIONS', () => {
    const notMet = loadFixture('report-skipped-command.json'); // 含 SKIPPED 不达标
    const result = decideStop({
      report: notMet,
      round: 3,
      config: { ...DEFAULT_CONFIG, max_iterations: 3 },
      prevReports: [
        { ...notMet, delta_inputs: { ...notMet.delta_inputs, net_loc_delta: 10 } },
      ],
      rollbackResult: null,
    });
    assert.equal(result.stop, true);
    assert.equal(result.exit_reason, 'MAX_ITERATIONS');
  });

  it('T-GL-07: 连续 no_progress_max_rounds 轮五维全 0 → NO_PROGRESS', () => {
    // 构造连续无进展：本轮与前 N-1 轮 delta_inputs 完全相同且 net_loc=0
    const base = loadFixture('report-skipped-command.json');
    const flat = { ...base, delta_inputs: { ...base.delta_inputs, net_loc_delta: 0 } };
    const result = decideStop({
      report: flat,
      round: 2,
      config: { ...DEFAULT_CONFIG, max_iterations: 5, no_progress_max_rounds: 2 },
      prevReports: [flat], // 上轮与本轮完全相同 → delta 全 0
      rollbackResult: null,
    });
    assert.equal(result.stop, true);
    assert.equal(result.exit_reason, 'NO_PROGRESS');
  });

  it('C1: 连续 N 轮 metric 四维全平但每轮 net_loc≠0（持续改代码）→ 仍触发 NO_PROGRESS', () => {
    // 核心回归（C1 死逻辑）：真实运行每轮都改代码 → net_loc_delta≠0。
    // 若 hasProgress 把 net_loc 计入，则 NO_PROGRESS fallback 永不触发（卡死烧预算）。
    // 修复后：metric 四维不变即视为无进展，net_loc churn 不能掩盖。
    const di = (loc) => ({
      layer2_pass_count: 1,
      p1_fr_coverage_pct: 80,
      layer1_5_status_score: 1,
      regression_count: 0,
      net_loc_delta: loc, // 每轮都不同的 LOC 变更（持续改代码）
    });
    const mkRound = (loc) => ({
      verify_mode: 'full',
      // 含 SKIPPED 使其不达标，避免走达标分支
      layer2_commands: [
        { name: 'npm run build', exit_code: 0, skipped_reason: null },
        { name: 'npm run lint', exit_code: null, skipped_reason: 'tool_not_installed' },
      ],
      layer1_fr_coverage: { p1_coverage_pct: 80 },
      layer1_5_evidence: { status: 'PARTIAL' },
      delta_inputs: di(loc),
    });
    const result = decideStop({
      report: mkRound(70), // 本轮 net_loc=70
      round: 3,
      config: { ...DEFAULT_CONFIG, max_iterations: 5, no_progress_max_rounds: 2 },
      prevReports: [mkRound(40), mkRound(55)], // 上两轮 net_loc 各不同，但 metric 四维全平
      rollbackResult: null,
    });
    assert.equal(result.stop, true);
    assert.equal(result.exit_reason, 'NO_PROGRESS');
  });

  it('T-GL-08: 有进展时不早停 → continue', () => {
    const prev = loadFixture('report-skipped-command.json'); // layer2_pass_count=1
    const cur = loadFixture('report-smoke-pass.json'); // layer2_pass_count=2，但 smoke 含 SKIPPED? 否——smoke 全 PASS 但跨桶
    // 用 smoke 未达标构造：把 p1 降到非 100 使其不达标，但仍有进展
    const curNotMet = { ...cur, layer1_fr_coverage: { ...cur.layer1_fr_coverage, p1_coverage_pct: 80 } };
    const result = decideStop({
      report: curNotMet,
      round: 2,
      config: { ...DEFAULT_CONFIG, max_iterations: 5, no_progress_max_rounds: 2 },
      prevReports: [prev],
      rollbackResult: null,
    });
    assert.equal(result.stop, false);
    assert.equal(result.action, 'continue');
    assert.equal(result.exit_reason, null);
  });

  it('T-GL-20: 连续 N 轮 infra-failure（report.degraded）→ NO_PROGRESS', () => {
    const degraded = { degraded: 'infra-failure', reason: 'verify JSON 非法' };
    const result = decideStop({
      report: degraded,
      round: 3,
      config: { ...DEFAULT_CONFIG, max_iterations: 5, no_progress_max_rounds: 2 },
      prevReports: [degraded], // 上轮也是 infra-failure → 连续无进展
      rollbackResult: null,
    });
    assert.equal(result.stop, true);
    assert.equal(result.exit_reason, 'NO_PROGRESS');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T-GL-18：文件锁 I/O 集成测试（FR-018）—— 非纯函数，temp-dir
// ──────────────────────────────────────────────────────────────────────────
describe('文件锁 I/O 集成（FR-018，非纯函数）', () => {
  it('T-GL-18: acquire → true；二次 acquire → false/lock_exists；release → 锁消失；再 acquire → true', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-loop-lock-'));
    const lockPath = path.join(tmpDir, '.lock');
    try {
      const first = acquireLock(lockPath);
      assert.equal(first.acquired, true);
      assert.ok(fs.existsSync(lockPath));

      const second = acquireLock(lockPath);
      assert.equal(second.acquired, false);
      assert.equal(second.reason, 'lock_exists');

      const rel = releaseLock(lockPath);
      assert.equal(rel.released, true);
      assert.ok(!fs.existsSync(lockPath));

      const third = acquireLock(lockPath);
      assert.equal(third.acquired, true);
      releaseLock(lockPath);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('锁文件内容含 pid 与 start_time', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-loop-lock-'));
    const lockPath = path.join(tmpDir, '.lock');
    try {
      acquireLock(lockPath);
      const content = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      assert.equal(typeof content.pid, 'number');
      assert.ok(typeof content.start_time === 'string' && content.start_time.length > 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Codex W3：stale 锁恢复（崩溃后不永久死锁）──
  // 找一个几乎肯定不存在的 PID（避免误杀真实进程）
  function findDeadPid() {
    for (let pid = 0x7fffff; pid > 0x700000; pid--) {
      try {
        process.kill(pid, 0);
      } catch (err) {
        if (err.code === 'ESRCH') return pid; // 进程不存在 = 我们要的死 PID
      }
    }
    return 0x7ffffe; // 兜底（极不可能命中存活进程）
  }

  it('W3: 持锁进程已不存在（ESRCH）→ stale 锁可被接管', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-loop-lock-'));
    const lockPath = path.join(tmpDir, '.lock');
    try {
      const deadPid = findDeadPid();
      // 手写一个持有者已死的锁
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ pid: deadPid, start_time: new Date().toISOString() }),
      );
      const result = acquireLock(lockPath);
      assert.equal(result.acquired, true, '死 PID 的 stale 锁应被接管');
      // 接管后锁内容应更新为当前进程
      const content = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      assert.equal(content.pid, process.pid);
      releaseLock(lockPath);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('W3/Phase B 修正: 存活 PID + 锁年龄远超 TTL（31min 前）→ 仍 lock_exists 不接管（FR-018 单实例保证）', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-loop-lock-'));
    const lockPath = path.join(tmpDir, '.lock');
    try {
      const oldTime = new Date(Date.now() - 31 * 60 * 1000).toISOString(); // 31min 前（曾超 TTL）
      // 用当前进程 PID（存活）但 start_time 很老：真实长任务跑满 max_iterations×max_verify_seconds
      // 容易超 30min，绝不能因此被新实例强抢活锁
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, start_time: oldTime }));
      const result = acquireLock(lockPath);
      assert.equal(result.acquired, false, '存活 PID 无论锁多老都不可接管');
      assert.equal(result.reason, 'lock_exists');
      assert.equal(result.holderPid, process.pid);
      releaseLock(lockPath);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('W3/Phase B 修正: 死 PID + 锁很新（刚建）→ 仍可接管（接管只看存活性不看锁龄）', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-loop-lock-'));
    const lockPath = path.join(tmpDir, '.lock');
    try {
      const deadPid = findDeadPid();
      // 死 PID + 全新 start_time → 仅凭"持有者已死"即可接管，与锁龄无关
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ pid: deadPid, start_time: new Date().toISOString() }),
      );
      const result = acquireLock(lockPath);
      assert.equal(result.acquired, true, '死 PID 的锁即使很新也应被接管');
      releaseLock(lockPath);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('W3: 持锁进程存活（刚建锁）→ lock_exists（不可接管，含 holderPid）', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-loop-lock-'));
    const lockPath = path.join(tmpDir, '.lock');
    try {
      // 当前进程持锁、刚建 → 非 stale
      const first = acquireLock(lockPath);
      assert.equal(first.acquired, true);
      const second = acquireLock(lockPath);
      assert.equal(second.acquired, false);
      assert.equal(second.reason, 'lock_exists');
      assert.equal(second.holderPid, process.pid);
      releaseLock(lockPath);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('W3: 锁内容损坏（非法 JSON）→ 视为 stale 可接管', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-loop-lock-'));
    const lockPath = path.join(tmpDir, '.lock');
    try {
      fs.writeFileSync(lockPath, '{ 损坏的非法 JSON');
      const result = acquireLock(lockPath);
      assert.equal(result.acquired, true, '不可解析的锁应被接管');
      releaseLock(lockPath);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
