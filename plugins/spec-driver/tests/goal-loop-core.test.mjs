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
import { execFileSync } from 'node:child_process';
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
  assessPreservedConfigSafety,
  parsePreservedConfigStates,
  isCleanExcludingPreserved,
  evaluateSmokeReadiness,
  validateFullCommandKinds,
  PRESERVED_CONFIG_PATHSPECS,
} from '../scripts/lib/goal-loop-core.mjs';
import { acquireLock, releaseLock } from '../scripts/goal-loop-cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'goal-loop');

// W5（环境健壮性）：受限/只读沙箱里 os.tmpdir() 可能 EPERM（如 Codex 审查沙箱）。
// 允许通过 TEST_TMPDIR 指向可写目录；未设则退回 os.tmpdir()。仅影响测试落点，不改锁逻辑。
const TMP_ROOT = process.env.TEST_TMPDIR || os.tmpdir();
// 确保 TMP_ROOT 父目录存在（TEST_TMPDIR 指向尚未创建的路径时 mkdtemp 会 ENOENT）。
fs.mkdirSync(TMP_ROOT, { recursive: true });

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

  // ── F203 修订 #2：full 轮 dist_not_built SKIPPED → infra-failure（契约违反真闭合）──
  it('F203: full 轮含 dist_not_built SKIPPED → degraded=infra-failure（不是只判非达标）', () => {
    const result = parseReport(readFixtureText('report-full-skipped-dist.json'));
    assert.equal(result.degraded, 'infra-failure');
    assert.ok(
      typeof result.reason === 'string' && /dist_not_built/.test(result.reason),
      'reason 应说明 full 不应出现 dist_not_built',
    );
    assert.equal(result.report, undefined);
  });

  it('F203: smoke 轮含 dist_not_built SKIPPED → 正常放行（不降级，返回 { report }）', () => {
    const result = parseReport(readFixtureText('report-smoke-skipped-e2e.json'));
    assert.ok(result.report, 'smoke 的 dist_not_built 应正常放行');
    assert.equal(result.report.verify_mode, 'smoke');
    assert.equal(result.degraded, undefined);
  });

  // ── F203 修订 #2 / WARNING-1：非法/缺失 verify_mode → infra-failure（防绕过 escalate）──
  it('WARNING-1: verify_mode 缺失 → infra-failure（防 decideStop 误 escalate）', () => {
    const base = loadFixture('report-full-pass.json');
    delete base.verify_mode;
    const result = parseReport(JSON.stringify(base));
    assert.equal(result.degraded, 'infra-failure');
    assert.ok(/verify_mode/.test(result.reason));
    assert.equal(result.report, undefined);
  });

  it('WARNING-1: verify_mode="xxx"（typo）→ infra-failure', () => {
    const base = loadFixture('report-full-pass.json');
    base.verify_mode = 'xxx';
    const result = parseReport(JSON.stringify(base));
    assert.equal(result.degraded, 'infra-failure');
    assert.ok(/verify_mode/.test(result.reason));
  });

  it('WARNING-1: 既有合法 full fixture 不回归（仍返回 { report }）', () => {
    const result = parseReport(readFixtureText('report-full-pass.json'));
    assert.ok(result.report);
    assert.equal(result.report.verify_mode, 'full');
    assert.equal(result.degraded, undefined);
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

  it('T-GL-19: isClean=false → stash push -u + pathspec 排除 + rev-parse + apply --index 完整序列（W4 完整 deepEqual）', () => {
    // W4：从弱断言（逐条 regex/includes）强化为完整命令序列 deepEqual，锁定字面值与顺序
    // F203 缺陷 1：stash push 必须用 pathspec 排除 preserved config，避免误卷 untracked override
    assert.deepEqual(planSnapshotCommands(false), [
      'git stash push --include-untracked -m "goal_loop-S{i}" -- . \':(exclude).specify/orchestration-overrides.yaml\'',
      'git rev-parse stash@{0}',
      'git stash apply --index {stash_ref}',
    ]);
  });

  it('F203: 多 preserved path 注入 → 多个独立 :(exclude) token（不 join）', () => {
    const cmds = planSnapshotCommands(false, [
      '.specify/orchestration-overrides.yaml',
      '.other/keep.yaml',
    ]);
    assert.deepEqual(cmds, [
      'git stash push --include-untracked -m "goal_loop-S{i}" -- . \':(exclude).specify/orchestration-overrides.yaml\' \':(exclude).other/keep.yaml\'',
      'git rev-parse stash@{0}',
      'git stash apply --index {stash_ref}',
    ]);
  });

  // ── F203 修订 #3 / WARNING-5：injectable preservedPaths 含单引号 → 抛错防注入 ──
  it('WARNING-5: planSnapshotCommands(preserved 含单引号) → 抛错，拒绝拼入', () => {
    assert.throws(() => planSnapshotCommands(false, ["a'b.yaml"]), /单引号/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// F203 CRITICAL-7：isCleanExcludingPreserved —— 排除 preserved 后判 isClean
// ──────────────────────────────────────────────────────────────────────────
describe('isCleanExcludingPreserved (F203 CRITICAL-7)', () => {
  const OVERRIDE = '.specify/orchestration-overrides.yaml';

  it('only-preserved（唯一 dirty 是 untracked override）→ true（杜绝空 stash 抓旧 stash）', () => {
    assert.equal(isCleanExcludingPreserved(`?? ${OVERRIDE}\n`), true);
  });

  it('preserved + other dirty → false', () => {
    assert.equal(isCleanExcludingPreserved(`?? ${OVERRIDE}\n M src/foo.ts\n`), false);
  });

  it('空输入（全仓干净）→ true', () => {
    assert.equal(isCleanExcludingPreserved(''), true);
  });

  it('only-other（无 preserved，有普通 dirty）→ false', () => {
    assert.equal(isCleanExcludingPreserved(' M src/foo.ts\n'), false);
  });

  it('多 preserved 均 dirty → true', () => {
    const p2 = '.other/keep.yaml';
    assert.equal(
      isCleanExcludingPreserved(`?? ${OVERRIDE}\n?? ${p2}\n`, [OVERRIDE, p2]),
      true,
    );
  });

  it('rename 一端非 preserved → false（两端只要一端非 preserved 即算非 preserved 变更）', () => {
    // R 行：old -> new，old=preserved 但 new=普通文件 → 非 preserved 变更
    assert.equal(
      isCleanExcludingPreserved(`R  ${OVERRIDE} -> src/renamed.ts\n`),
      false,
    );
  });

  // F203 CRITICAL-7 漏网根因守护：折叠形式 vs 展开形式
  it('折叠目录输入 `?? .specify/` → false（保守判脏；故调用方 MUST 用 --untracked-files=all 喂入展开形式）', () => {
    // 默认 `git status --porcelain`（无 -uall）把整个 untracked 目录折叠成 `?? .specify/`，
    // 折叠路径 `.specify/` ≠ preserved 文件路径 → 被判非 preserved 变更 → false。
    // 这是正确的防御性行为：函数对非展开输入保守判脏，逼迫调用方喂入 -uall 展开形式。
    assert.equal(isCleanExcludingPreserved('?? .specify/\n', [OVERRIDE]), false);
  });

  it('展开文件输入 `?? .specify/orchestration-overrides.yaml`（-uall 形式）→ true', () => {
    // --untracked-files=all 展开到文件级，路径精确命中 preserved → 排除后 isClean=true。
    assert.equal(
      isCleanExcludingPreserved(`?? ${OVERRIDE}\n`, [OVERRIDE]),
      true,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T-GL-12b：planRollbackCommands（FR-013）—— 双分支完整命令序列
// ──────────────────────────────────────────────────────────────────────────
describe('planRollbackCommands (FR-013)', () => {
  // 合法 40 位 hex SHA-1（Codex W2 校验通过）
  const VALID_SHA = 'a'.repeat(40);
  const VALID_SHA_2 = '0123456789abcdef0123456789abcdef01234567';

  it('T-GL-12b: clean 分支 → [reset --hard HEAD, clean -fd -e <preserved>]（无 stash apply，clean 不校验 ref）', () => {
    // clean 分支不拼 ref，故即使 ref 非法也不应抛错
    // F203 缺陷 1：clean -fd 必须用 -e 排除 preserved config
    const cmds = planRollbackCommands({ clean: true, ref: 'abc123' });
    assert.deepEqual(cmds, [
      'git reset --hard HEAD',
      "git clean -fd -e '.specify/orchestration-overrides.yaml'",
    ]);
  });

  it('T-GL-12b: 非 clean 分支 → [reset --hard HEAD, clean -fd -e <preserved>, stash apply --index <ref>] 完整有序', () => {
    const cmds = planRollbackCommands({ clean: false, ref: VALID_SHA_2 });
    assert.deepEqual(cmds, [
      'git reset --hard HEAD',
      "git clean -fd -e '.specify/orchestration-overrides.yaml'",
      `git stash apply --index ${VALID_SHA_2}`,
    ]);
  });

  it('F203: 多 preserved path 注入 → 多个独立 -e token（不 join）', () => {
    const cmds = planRollbackCommands(
      { clean: true, ref: 'abc123' },
      ['.specify/orchestration-overrides.yaml', '.other/keep.yaml'],
    );
    assert.deepEqual(cmds, [
      'git reset --hard HEAD',
      "git clean -fd -e '.specify/orchestration-overrides.yaml' -e '.other/keep.yaml'",
    ]);
  });

  it('clean -fd 不带 -x（保留 .gitignore 文件），不带 -ff（不删嵌套仓库）', () => {
    const cmds = planRollbackCommands({ clean: false, ref: VALID_SHA });
    const cleanCmd = cmds.find((c) => c.startsWith('git clean'));
    assert.equal(cleanCmd, "git clean -fd -e '.specify/orchestration-overrides.yaml'");
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

  // ── F203 修订 #3 / WARNING-5：injectable preservedPaths 含单引号 → 抛错防注入 ──
  it('WARNING-5: planRollbackCommands(preserved 含单引号) → 抛错，拒绝拼入', () => {
    assert.throws(
      () => planRollbackCommands({ clean: true, ref: 'unused' }, ["a'b.yaml"]),
      /单引号/,
    );
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

  // ── Codex C1：escalate 非递归不变量（full 报告永不返回 escalate_full）──
  it('C1: full 报告 metric 满足 → REACHED_GOAL，action 永不为 escalate_full（堵死递归升级）', () => {
    // 核心不变量：escalate_full 只在 verify_mode!=full 时返回。
    // forced full verify 回到 decideStop 后，full 报告必走 REACHED_GOAL，无法再 escalate → 不可递归。
    const fullPass = loadFixture('report-full-pass.json');
    assert.equal(fullPass.verify_mode, 'full', '前置：fixture 为 full 模式');
    // 跨多个 round / prevReports 组合都不应出现 escalate_full
    for (const round of [1, 2, 5]) {
      for (const prev of [[], [loadFixture('report-smoke-pass.json')]]) {
        const result = decideStop({
          report: fullPass,
          round,
          config: { ...DEFAULT_CONFIG, max_iterations: 5 },
          prevReports: prev,
          rollbackResult: null,
        });
        assert.notEqual(
          result.action,
          'escalate_full',
          `full 报告（round=${round}）绝不应返回 escalate_full（递归风险）`,
        );
        assert.equal(result.exit_reason, 'REACHED_GOAL');
      }
    }
  });

  it('C1: full 报告即使未达标（含 FAIL）也永不返回 escalate_full（仅 smoke 满足才触发）', () => {
    // escalate_full 唯一触发条件 = verify_mode!=full 且 metric 满足。
    // full 报告无论达标与否都不会落入 escalate_full 分支。
    const fullFail = loadFixture('report-fail-regression.json'); // full，未达标
    assert.equal(fullFail.verify_mode, 'full');
    assert.equal(evaluateMetric(fullFail), false, '前置：该 full 报告不达标');
    const result = decideStop({
      report: fullFail,
      round: 2,
      config: { ...DEFAULT_CONFIG, max_iterations: 5 },
      prevReports: [], // 无同模式前轮 → 不触发 regression
      rollbackResult: null,
    });
    assert.notEqual(result.action, 'escalate_full');
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

  // ── F203 缺陷 2：smoke escalate（evaluateSmokeReadiness）+ C1 回归 ──
  it('F203: smoke 含 SKIPPED e2e + 非 e2e 全 PASS → escalate_full', () => {
    const result = decideStop({
      report: loadFixture('report-smoke-skipped-e2e.json'),
      round: 2,
      config: DEFAULT_CONFIG,
      prevReports: [],
      rollbackResult: null,
    });
    assert.equal(result.action, 'escalate_full');
    assert.equal(result.stop, false);
    assert.equal(result.exit_reason, null);
  });

  it('F203: smoke 全 SKIPPED → 不 escalate（vacuous 防护 C3）', () => {
    const allSkipped = {
      verify_mode: 'smoke',
      layer2_commands: [
        { name: 'tsc --noEmit', exit_code: null, status: 'SKIPPED', skipped_reason: 'dist_not_built' },
        { name: 'npx vitest run --project e2e', exit_code: null, status: 'SKIPPED', skipped_reason: 'dist_not_built' },
      ],
      layer1_fr_coverage: { p1_coverage_pct: 100 },
      layer1_5_evidence: { status: 'COMPLIANT' },
      delta_inputs: { layer2_pass_count: 0, p1_fr_coverage_pct: 100, layer1_5_status_score: 2, regression_count: 0, net_loc_delta: 0 },
    };
    const result = decideStop({
      report: allSkipped,
      round: 2,
      config: DEFAULT_CONFIG,
      prevReports: [],
      rollbackResult: null,
    });
    assert.notEqual(result.action, 'escalate_full');
  });

  it('F203: full 含 SKIPPED 命令（非 dist_not_built）→ 永不 REACHED_GOAL', () => {
    // 用一个 full 报告，其中含一条 SKIPPED（skipped_reason 非 dist_not_built，绕过 parseReport 降级，
    // 直接喂 decideStop 验证 evaluateMetric 严格门禁：SKIPPED 即不达标）
    const fullWithSkipped = {
      verify_mode: 'full',
      layer2_commands: [
        { name: 'npm run build', exit_code: 0, status: 'PASS', skipped_reason: null },
        { name: 'npm run lint', exit_code: null, status: 'SKIPPED', skipped_reason: 'tool_not_installed' },
      ],
      layer1_fr_coverage: { p1_coverage_pct: 100 },
      layer1_5_evidence: { status: 'COMPLIANT' },
      delta_inputs: { layer2_pass_count: 1, p1_fr_coverage_pct: 100, layer1_5_status_score: 2, regression_count: 0, net_loc_delta: 0 },
    };
    const result = decideStop({
      report: fullWithSkipped,
      round: 2,
      config: DEFAULT_CONFIG,
      prevReports: [],
      rollbackResult: null,
    });
    assert.notEqual(result.exit_reason, 'REACHED_GOAL');
  });

  it('F203: full 报告全 PASS+p1=100+COMPLIANT → REACHED_GOAL，永不 escalate_full（C1 回归）', () => {
    const result = decideStop({
      report: loadFixture('report-full-pass.json'),
      round: 2,
      config: DEFAULT_CONFIG,
      prevReports: [],
      rollbackResult: null,
    });
    assert.equal(result.exit_reason, 'REACHED_GOAL');
    assert.notEqual(result.action, 'escalate_full');
  });

  it('F203 不回归: 既有 report-smoke-pass.json（全 PASS）仍 escalate_full（修订 Codex#2）', () => {
    const result = decideStop({
      report: loadFixture('report-smoke-pass.json'),
      round: 2,
      config: DEFAULT_CONFIG,
      prevReports: [],
      rollbackResult: null,
    });
    assert.equal(result.action, 'escalate_full');
  });

  it('F203 不回归: round==max 的 smoke pass 仍 escalate（escalate 优先于 MAX_ITERATIONS，修订 Codex#2）', () => {
    const result = decideStop({
      report: loadFixture('report-smoke-pass.json'),
      round: 5,
      config: { ...DEFAULT_CONFIG, max_iterations: 5 },
      prevReports: [],
      rollbackResult: null,
    });
    assert.equal(result.action, 'escalate_full');
    assert.notEqual(result.exit_reason, 'MAX_ITERATIONS');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// F204：validateFullCommandKinds（命令集完整性校验）—— 纯函数单元
// ──────────────────────────────────────────────────────────────────────────
describe('validateFullCommandKinds (F204)', () => {
  // 含 build/test/lint/check 四条全 PASS 带 kind 的 full 报告
  const withKinds = () => loadFixture('report-full-pass-with-kinds.json');

  it('AC-4: requiredKinds=[] → { complete:true, missing:[] }（优雅降级，不读 report）', () => {
    assert.deepEqual(validateFullCommandKinds(withKinds(), []), { complete: true, missing: [] });
  });

  it('AC-4: requiredKinds=null → 视同 []，complete:true（防御性）', () => {
    assert.deepEqual(validateFullCommandKinds(withKinds(), null), { complete: true, missing: [] });
  });

  it('requiredKinds 非数组（对象）→ 视同 []，complete:true（防御性）', () => {
    assert.deepEqual(validateFullCommandKinds(withKinds(), { bad: 1 }), { complete: true, missing: [] });
  });

  it('requiredKinds 含非字符串元素（123）→ 该元素被过滤、不抛异常（C-3）', () => {
    // 123 被过滤，剩 'test' 已覆盖 → complete:true
    const result = validateFullCommandKinds(withKinds(), [123, 'test']);
    assert.equal(result.complete, true);
    assert.deepEqual(result.missing, []);
  });

  it('AC-3: PASS 命令含全部 required kinds → complete:true, missing:[]', () => {
    assert.deepEqual(
      validateFullCommandKinds(withKinds(), ['build', 'test', 'lint', 'check']),
      { complete: true, missing: [] },
    );
  });

  it('AC-2: PASS 命令缺 lint → complete:false, missing:["lint"]', () => {
    const r = withKinds();
    r.layer2_commands = r.layer2_commands.filter((c) => c.kind !== 'lint');
    const result = validateFullCommandKinds(r, ['build', 'test', 'lint', 'check']);
    assert.equal(result.complete, false);
    assert.deepEqual(result.missing, ['lint']);
  });

  it('AC-2 变体: 命令全无 kind 字段 + required=["test"] → missing=["test"]', () => {
    const r = loadFixture('report-full-pass.json'); // 无 kind 字段
    const result = validateFullCommandKinds(r, ['test']);
    assert.equal(result.complete, false);
    assert.deepEqual(result.missing, ['test']);
  });

  it('AC-2 变体: FAIL 命令有 kind + PASS 命令无该 kind → 缺失（FAIL 不代缴）', () => {
    const r = withKinds();
    // 把 lint 命令转 FAIL（仍带 kind:lint），required 仍要求 lint
    r.layer2_commands = r.layer2_commands.map((c) =>
      c.kind === 'lint' ? { ...c, exit_code: 1, status: 'FAIL' } : c,
    );
    const result = validateFullCommandKinds(r, ['lint']);
    assert.equal(result.complete, false, 'FAIL 命令的 kind 不计入有效集合');
    assert.deepEqual(result.missing, ['lint']);
  });

  it('C-3: 命令 kind 为非字符串（123）→ 不贡献 kind、不抛异常', () => {
    const r = withKinds();
    r.layer2_commands = r.layer2_commands.map((c) =>
      c.kind === 'test' ? { ...c, kind: 123 } : c,
    );
    // test 的 kind 被畸形成 123 → 不贡献 → 要求 test 时缺失，但绝不抛
    let result;
    assert.doesNotThrow(() => {
      result = validateFullCommandKinds(r, ['test']);
    });
    assert.equal(result.complete, false);
    assert.deepEqual(result.missing, ['test']);
  });

  it('边界: kind 大小写变体（"Build"）匹配 "build"', () => {
    const r = withKinds();
    r.layer2_commands = r.layer2_commands.map((c) =>
      c.kind === 'build' ? { ...c, kind: 'Build' } : c,
    );
    const result = validateFullCommandKinds(r, ['build']);
    assert.equal(result.complete, true);
  });

  it('边界: requiredKinds 含重复元素 ["test","test"] → 去重后正常比较', () => {
    const result = validateFullCommandKinds(withKinds(), ['test', 'test']);
    assert.deepEqual(result, { complete: true, missing: [] });
  });

  it('Codex Phase3 W-3: kind 含前后空白 "  build  " + required ["build"] → trim 后匹配 complete:true', () => {
    const r = withKinds();
    r.layer2_commands = r.layer2_commands.map((c) =>
      c.kind === 'build' ? { ...c, kind: '  build  ' } : c,
    );
    const result = validateFullCommandKinds(r, ['build']);
    assert.equal(result.complete, true, 'trim 应消除空白，避免合法命令被误判缺失 → false INCOMPLETE');
  });

  it('Codex Phase3 W-3: required 含空白 "  test  " 也 trim 归一', () => {
    const result = validateFullCommandKinds(withKinds(), ['  test  ']);
    assert.equal(result.complete, true);
  });

  it('AC-5 基础: echo-ok 单条命令（无 kind）+ required=["test"] → complete:false', () => {
    const echoOnly = {
      verify_mode: 'full',
      layer2_commands: [{ name: 'echo ok', exit_code: 0, status: 'PASS', skipped_reason: null }],
      layer1_fr_coverage: { p1_coverage_pct: 100 },
      layer1_5_evidence: { status: 'COMPLIANT' },
    };
    const result = validateFullCommandKinds(echoOnly, ['build', 'test', 'lint', 'check']);
    assert.equal(result.complete, false);
    assert.deepEqual(result.missing, ['build', 'test', 'lint', 'check']);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// F204：decideStop 命令集完整性集成（full 权威门禁）
// ──────────────────────────────────────────────────────────────────────────
describe('decideStop 命令集完整性 (F204)', () => {
  const REQUIRED = ['build', 'test', 'lint', 'check'];

  it('AC-1 零回归: report-full-pass.json + full_required_kinds:[]（默认）→ REACHED_GOAL 不变', () => {
    const result = decideStop({
      report: loadFixture('report-full-pass.json'),
      round: 2,
      config: DEFAULT_CONFIG, // 无 full_required_kinds → 等价默认 []
      prevReports: [],
      rollbackResult: null,
    });
    assert.equal(result.exit_reason, 'REACHED_GOAL');
    assert.equal(result.stop, true);
    assert.equal(result.action, 'goto_gate_verify');
  });

  it('AC-3: with-kinds 报告 + 全部 required kinds → REACHED_GOAL', () => {
    const result = decideStop({
      report: loadFixture('report-full-pass-with-kinds.json'),
      round: 2,
      config: { ...DEFAULT_CONFIG, full_required_kinds: REQUIRED },
      prevReports: [],
      rollbackResult: null,
    });
    assert.equal(result.exit_reason, 'REACHED_GOAL');
  });

  it('AC-2: full 报告缺 lint kind + required 含 lint → INCOMPLETE_FULL_VERIFY（不 REACHED_GOAL）', () => {
    const r = loadFixture('report-full-pass-with-kinds.json');
    r.layer2_commands = r.layer2_commands.filter((c) => c.kind !== 'lint');
    const result = decideStop({
      report: r,
      round: 2,
      config: { ...DEFAULT_CONFIG, full_required_kinds: REQUIRED },
      prevReports: [],
      rollbackResult: null,
    });
    assert.equal(result.stop, true);
    assert.equal(result.exit_reason, 'INCOMPLETE_FULL_VERIFY');
    assert.equal(result.action, 'goto_gate_verify');
    assert.notEqual(result.exit_reason, 'REACHED_GOAL');
  });

  it('AC-5 CRITICAL-8 直证: echo-ok full（无 kind）+ required kinds → 不 REACHED_GOAL', () => {
    // 构造 reward-hacking 报告：verify_mode:full、仅 echo ok 一条、覆盖 100、COMPLIANT
    const echoOk = {
      round: 2,
      verify_mode: 'full',
      layer2_commands: [
        { name: 'echo ok', exit_code: 0, status: 'PASS', skipped_reason: null },
      ],
      layer1_fr_coverage: { p1_coverage_pct: 100 },
      layer1_5_evidence: { status: 'COMPLIANT' },
      delta_inputs: { layer2_pass_count: 1, p1_fr_coverage_pct: 100, layer1_5_status_score: 2, regression_count: 0, net_loc_delta: 0 },
    };
    // 前置：evaluateMetric 自身放行（单命令全 PASS + 覆盖 100 + COMPLIANT）
    assert.equal(evaluateMetric(echoOk), true, '前置：echo-ok 在 metric 层是放行的（漏洞前提）');
    const result = decideStop({
      report: echoOk,
      round: 2,
      config: { ...DEFAULT_CONFIG, full_required_kinds: REQUIRED },
      prevReports: [],
      rollbackResult: null,
    });
    assert.notEqual(result.exit_reason, 'REACHED_GOAL', '漏洞必须被堵死');
    assert.equal(result.exit_reason, 'INCOMPLETE_FULL_VERIFY');
    assert.equal(result.stop, true);
  });

  it('AC-4: full_required_kinds:[] + echo-ok full → 跳过校验 → REACHED_GOAL（降级同现状）', () => {
    const echoOk = {
      round: 2,
      verify_mode: 'full',
      layer2_commands: [
        { name: 'echo ok', exit_code: 0, status: 'PASS', skipped_reason: null },
      ],
      layer1_fr_coverage: { p1_coverage_pct: 100 },
      layer1_5_evidence: { status: 'COMPLIANT' },
      delta_inputs: { layer2_pass_count: 1, p1_fr_coverage_pct: 100, layer1_5_status_score: 2, regression_count: 0, net_loc_delta: 0 },
    };
    const result = decideStop({
      report: echoOk,
      round: 2,
      config: { ...DEFAULT_CONFIG, full_required_kinds: [] },
      prevReports: [],
      rollbackResult: null,
    });
    assert.equal(result.exit_reason, 'REACHED_GOAL', '空 required → 跳过校验，行为同现状');
  });

  it('AC-6: smoke 报告 + 任意 full_required_kinds → 不受影响（走 smoke 分支 escalate_full）', () => {
    const result = decideStop({
      report: loadFixture('report-smoke-pass.json'),
      round: 2,
      config: { ...DEFAULT_CONFIG, full_required_kinds: REQUIRED },
      prevReports: [],
      rollbackResult: null,
    });
    assert.equal(result.action, 'escalate_full', 'smoke 不进 full kind 校验');
    assert.notEqual(result.exit_reason, 'INCOMPLETE_FULL_VERIFY');
  });

  it('Codex Phase3 W-1 变异守卫: full metric=false（含 FAIL）+ required 非空 → 不得 INCOMPLETE_FULL_VERIFY（守卫仅在 metric 为真后生效）', () => {
    // 翻一条命令为 FAIL → evaluateMetric=false。若守卫被误挪到 evaluateMetric 之前（W-1 反向），
    // 这种 metric 未达标的 full（且缺 build kind）会被错判 INCOMPLETE。锁定守卫只在 metric 为真后触发。
    const r = loadFixture('report-full-pass-with-kinds.json');
    r.layer2_commands = r.layer2_commands.map((c, i) =>
      i === 0 ? { ...c, exit_code: 1, status: 'FAIL' } : c,
    );
    assert.equal(evaluateMetric(r), false, '前置：含 FAIL → metric 不达标');
    const result = decideStop({
      report: r,
      round: 5,
      config: { ...DEFAULT_CONFIG, full_required_kinds: REQUIRED, max_iterations: 5 },
      prevReports: [],
      rollbackResult: null,
    });
    assert.notEqual(result.exit_reason, 'INCOMPLETE_FULL_VERIFY', 'metric 未达标的 full 绝不能走完整性校验分支');
    assert.notEqual(result.exit_reason, 'REACHED_GOAL');
    assert.equal(result.exit_reason, 'MAX_ITERATIONS', 'round>=max → 落 MAX_ITERATIONS（守卫未误触）');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T-GL-18：文件锁 I/O 集成测试（FR-018）—— 非纯函数，temp-dir
// ──────────────────────────────────────────────────────────────────────────
describe('文件锁 I/O 集成（FR-018，非纯函数）', () => {
  it('T-GL-18: acquire → true；二次 acquire → false/lock_exists；release → 锁消失；再 acquire → true', () => {
    const tmpDir = fs.mkdtempSync(path.join(TMP_ROOT, 'goal-loop-lock-'));
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
    const tmpDir = fs.mkdtempSync(path.join(TMP_ROOT, 'goal-loop-lock-'));
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
    const tmpDir = fs.mkdtempSync(path.join(TMP_ROOT, 'goal-loop-lock-'));
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
    const tmpDir = fs.mkdtempSync(path.join(TMP_ROOT, 'goal-loop-lock-'));
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
    const tmpDir = fs.mkdtempSync(path.join(TMP_ROOT, 'goal-loop-lock-'));
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
    const tmpDir = fs.mkdtempSync(path.join(TMP_ROOT, 'goal-loop-lock-'));
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
    const tmpDir = fs.mkdtempSync(path.join(TMP_ROOT, 'goal-loop-lock-'));
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

// ──────────────────────────────────────────────────────────────────────────
// Phase C golden-text 校验：SKILL.md 散文含必需步骤 + CLI 子命令名对齐（T024 / T025）
//   读真实 SKILL.md / goal-loop-cli.mjs 文件，断言散文契约与 core/CLI 实际一致，
//   防 implement 期接口漂移（T025）与迭代日志接线缺失（T024）。
// ──────────────────────────────────────────────────────────────────────────

const SKILL_MD_PATH = path.join(
  __dirname,
  '..',
  'skills',
  'spec-driver-feature',
  'SKILL.md',
);
const CLI_PATH = path.join(__dirname, '..', 'scripts', 'goal-loop-cli.mjs');

/**
 * 从 goal-loop-cli.mjs 源码提取真实注册的子命令名（`case '<name>':` 字面量），
 * 作为 golden-text 校验散文 CLI 调用的权威清单 —— 防散文调用了不存在的子命令（漂移）。
 */
function extractCliSubcommands() {
  const src = fs.readFileSync(CLI_PATH, 'utf-8');
  const names = new Set();
  const re = /case\s+'([a-z-]+)'\s*:/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    names.add(m[1]);
  }
  return names;
}

describe('goal_loop SKILL.md golden-text 校验（T025）', () => {
  const skillMd = fs.readFileSync(SKILL_MD_PATH, 'utf-8');

  it('SKILL.md 含 goal_loop 分派分支（decide-dispatch）', () => {
    assert.ok(skillMd.includes('goal_loop'), '散文应含 goal_loop');
    assert.ok(skillMd.includes('decide-dispatch'), '分派应调 decide-dispatch');
  });

  it('SKILL.md 含步骤 1：建立 snapshot（plan-snapshot）', () => {
    assert.ok(skillMd.includes('plan-snapshot'));
    assert.ok(skillMd.includes('snapshot'));
  });

  it('SKILL.md 含步骤 2：Spectra impact 注入（interpret-impact）', () => {
    assert.ok(skillMd.includes('Spectra MCP') || skillMd.includes('impact'));
    assert.ok(skillMd.includes('interpret-impact'));
  });

  it('SKILL.md 含步骤 4：select-verify-mode（smoke/full 分层）', () => {
    assert.ok(skillMd.includes('select-verify-mode'));
  });

  it('SKILL.md 含步骤 5：verify GOAL_LOOP_MODE 注入 + parse-report', () => {
    assert.ok(skillMd.includes('GOAL_LOOP_MODE'));
    assert.ok(skillMd.includes('parse-report'));
  });

  it('SKILL.md 含步骤 6：decide-stop 决策', () => {
    assert.ok(skillMd.includes('decide-stop'));
  });

  it('SKILL.md 含 escalate_full 消费分支（Codex C2 修正的关键落地）', () => {
    // smoke 全绿不得直接达标 → 必须有 escalate_full → 强制 full verify 重判 的分支
    assert.ok(skillMd.includes('escalate_full'), '散文必须显式消费 escalate_full action');
    assert.ok(
      skillMd.includes('REACHED_GOAL'),
      'escalate_full 后 full 轮才可能 REACHED_GOAL',
    );
  });

  it('SKILL.md 含 F204 命令集完整性接线（C-1 读 full_required_kinds + C-2 INCOMPLETE_FULL_VERIFY 路由）', () => {
    // 锁定 C-1/C-2 散文接线存在——这是不可单测的编排接线的唯一自动护栏（Codex Phase3 W-2）：
    // 删 C-1 → step1 不读 config → 校验空转、漏洞真实运行时复活；删 C-2 → 新 exit_reason 失配。
    assert.ok(
      skillMd.includes('full_required_kinds'),
      'step1 必须读 full_required_kinds 进 config，否则不进 decide-stop payload、漏洞空转（C-1）',
    );
    assert.ok(
      skillMd.includes('INCOMPLETE_FULL_VERIFY'),
      'dispatch（branch e + escalate 二次路由 branch c）必须覆盖 INCOMPLETE_FULL_VERIFY（C-2）',
    );
  });

  it('SKILL.md 含回滚分支（plan-rollback + REGRESSION_ROLLBACK）', () => {
    assert.ok(skillMd.includes('plan-rollback'));
    assert.ok(skillMd.includes('REGRESSION_ROLLBACK'));
  });

  it('SKILL.md 含单实例锁 acquire-lock / release-lock（FR-018）', () => {
    assert.ok(skillMd.includes('acquire-lock'));
    assert.ok(skillMd.includes('release-lock'));
  });

  it('SKILL.md 含 reward hacking 护栏诚实说明（FR-023）', () => {
    assert.ok(
      skillMd.includes('reward hacking') || skillMd.includes('测试过拟合'),
      '应含 reward hacking / 测试过拟合 诚实标注',
    );
    assert.ok(skillMd.includes('GATE_VERIFY'), '应说明 GATE_VERIFY 是真正强护栏');
  });

  it('散文调用的每个 goal-loop-cli 子命令名都在真实 CLI 清单内（防接口漂移）', () => {
    const realSubcommands = extractCliSubcommands();
    // sanity：CLI 至少注册了核心子命令，提取逻辑有效
    assert.ok(realSubcommands.size >= 9, `CLI 子命令提取应 ≥ 9，实得 ${realSubcommands.size}`);

    // 散文中出现的 `goal-loop-cli.mjs <subcommand>` 调用
    const calledInProse = new Set();
    const callRe = /goal-loop-cli\.mjs"?\s+([a-z-]+)/g;
    let mm;
    while ((mm = callRe.exec(skillMd)) !== null) {
      calledInProse.add(mm[1]);
    }
    assert.ok(calledInProse.size > 0, '散文应至少调用一个 goal-loop-cli 子命令');

    for (const sub of calledInProse) {
      assert.ok(
        realSubcommands.has(sub),
        `散文调用的子命令 "${sub}" 不在 CLI 真实清单 [${[...realSubcommands].join(', ')}] 内（接口漂移）`,
      );
    }
  });

  // ── W4：golden-text 精化（消除"includes 一个词"假绿）──

  it('W4: 必需 CLI 子命令全集都在散文出现（不止子集校验，反向锁定缺失）', () => {
    // 散文必须真实接线这些子命令名（format-iteration-log-entry 为 W3 新增的真实可执行入口）
    const REQUIRED = [
      'acquire-lock',
      'release-lock',
      'plan-snapshot',
      'interpret-impact',
      'select-verify-mode',
      'parse-report',
      'decide-stop',
      'plan-rollback',
      'format-iteration-log-entry',
    ];
    const realSubcommands = extractCliSubcommands();
    for (const sub of REQUIRED) {
      // 既要散文出现，也要确实是 CLI 真实子命令（双向锁定，防散文写了 CLI 没有的名字）
      assert.ok(skillMd.includes(sub), `散文缺必需 CLI 子命令调用 "${sub}"`);
      assert.ok(
        realSubcommands.has(sub),
        `必需子命令 "${sub}" 不在 CLI 真实清单（实现漂移）`,
      );
    }
  });

  it('W4: decide-stop payload 五字段均在散文出现（report/round/config/prevReports/rollbackResult）', () => {
    for (const field of ['report', 'round', 'config', 'prevReports', 'rollbackResult']) {
      assert.ok(skillMd.includes(field), `散文缺 decide-stop payload 字段 "${field}"`);
    }
  });

  it('W4: escalate 用 select-verify-mode {i} {max_iterations} true（aboutToExit=true）', () => {
    // escalate_full 分支强制 full：select-verify-mode 第三参 aboutToExit 必须为 true
    assert.ok(
      /select-verify-mode \{i\} \{max_iterations\} true/.test(skillMd),
      '散文 escalate 分支应以 aboutToExit=true 调 select-verify-mode 强制 full',
    );
    // 同时存在循环体内 aboutToExit=false 的常规调用（smoke/full 分层）
    assert.ok(
      /select-verify-mode \{i\} \{max_iterations\} false/.test(skillMd),
      '散文循环体应有 aboutToExit=false 的常规 select-verify-mode 调用',
    );
  });

  it('W4: post-full 不可再 escalate（散文含"escalate 不可递归"/"不再升级"语义，Codex C1）', () => {
    assert.ok(
      skillMd.includes('escalate 不可递归'),
      '散文必须显式声明 escalate 不可递归（C1 非递归硬约束）',
    );
    // forced full 后须先校验 verify_mode === 'full'（C1 第 1 道防护）
    assert.ok(
      skillMd.includes("verify_mode === 'full'") || skillMd.includes('verify_mode!=full'),
      '散文应在 forced full 后校验 curReportFull.verify_mode === full',
    );
  });

  it('W4: rollback planning failure 路径（plan-rollback CLI 退出码检查，Codex W2）', () => {
    // 散文须先查 plan-rollback CLI 自身退出码，非零 → ROLLBACK_FAILED
    assert.ok(
      skillMd.includes('plan-rollback CLI 退出码') || /plan-rollback.*退出码/.test(skillMd),
      '散文应先检查 plan-rollback CLI 自身退出码',
    );
    assert.ok(skillMd.includes('ROLLBACK_FAILED'), '回滚规划/执行失败应导向 ROLLBACK_FAILED');
  });
});

describe('goal_loop 迭代日志接线 golden-text 校验（T024 / T-GL-21b）', () => {
  const skillMd = fs.readFileSync(SKILL_MD_PATH, 'utf-8');

  it('T-GL-21b: 散文调用 formatIterationLogEntry 并写 iteration-log', () => {
    assert.ok(
      skillMd.includes('formatIterationLogEntry') || skillMd.includes('迭代日志'),
      '散文应接线 formatIterationLogEntry / 迭代日志',
    );
    assert.ok(skillMd.includes('iteration-log'), '散文应写 iteration-log.md');
  });

  it('W3: 散文经 format-iteration-log-entry CLI 子命令格式化（真实可执行入口，非"调 core"）', () => {
    assert.ok(
      skillMd.includes('format-iteration-log-entry'),
      '散文应调 format-iteration-log-entry CLI 子命令（编排器经 Bash 可执行），而非笼统"调 core"',
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// W3：format-iteration-log-entry CLI 子命令集成测试（真实 spawn CLI，验证 stdout）
//   编排器经 Bash 调该子命令把 entry → markdown 块；这里直接 spawn 校验真实 I/O。
// ──────────────────────────────────────────────────────────────────────────
describe('format-iteration-log-entry CLI 子命令集成（W3）', () => {
  it('W3: spawn CLI format-iteration-log-entry → stdout 为含内嵌 ```json 围栏的 markdown 块且可解析', () => {
    const tmpDir = fs.mkdtempSync(path.join(TMP_ROOT, 'goal-loop-cli-'));
    const entryFile = path.join(tmpDir, 'entry.json');
    try {
      const entry = {
        round: 3,
        verify_mode: 'full',
        metric: true,
        delta: [1, 0, 0, 0, 12],
        exit_reason: 'REACHED_GOAL',
        injection_status: 'injected',
        snapshot: { clean: false, ref: 'a'.repeat(40) },
        timestamp: '2026-06-20T10:05:00Z',
      };
      fs.writeFileSync(entryFile, JSON.stringify(entry));
      const stdout = execFileSync('node', [CLI_PATH, 'format-iteration-log-entry', entryFile], {
        encoding: 'utf-8',
      });
      // 输出为原始 markdown（非 JSON.stringify 包裹）：含标题 + ```json 围栏
      assert.ok(/round|轮/i.test(stdout), 'stdout 应含轮次标题');
      assert.ok(stdout.includes('```json'), 'stdout 应含 ```json 围栏');
      const match = stdout.match(/```json\s*([\s\S]*?)```/);
      assert.ok(match, '必须含可提取的 ```json 围栏');
      const parsed = JSON.parse(match[1]);
      assert.equal(parsed.round, 3);
      assert.equal(parsed.exit_reason, 'REACHED_GOAL');
      assert.deepEqual(parsed.snapshot, { clean: false, ref: 'a'.repeat(40) });
      // CLI 输出应与 core 纯函数完全一致（薄包装不引入差异）
      assert.equal(stdout, formatIterationLogEntry(entry));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('W3: format-iteration-log-entry 缺 entryJsonFile 参数 → 非零退出', () => {
    assert.throws(
      () => execFileSync('node', [CLI_PATH, 'format-iteration-log-entry'], { encoding: 'utf-8' }),
      /Command failed|status/,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// F203 缺陷 1：assessPreservedConfigSafety（preflight 守护）—— T205
// ──────────────────────────────────────────────────────────────────────────
const PRESERVED_PATH = '.specify/orchestration-overrides.yaml';
const OTHER_PATH = '.other/keep.yaml';

describe('assessPreservedConfigSafety (F203 缺陷 1)', () => {
  it('absent → 安全', () => {
    assert.deepEqual(assessPreservedConfigSafety([{ path: PRESERVED_PATH, state: 'absent' }]), {
      safe: true,
      unsafe: [],
    });
  });

  it('untracked → 安全', () => {
    assert.deepEqual(assessPreservedConfigSafety([{ path: PRESERVED_PATH, state: 'untracked' }]), {
      safe: true,
      unsafe: [],
    });
  });

  it('tracked-clean → 安全', () => {
    assert.deepEqual(assessPreservedConfigSafety([{ path: PRESERVED_PATH, state: 'tracked-clean' }]), {
      safe: true,
      unsafe: [],
    });
  });

  it('staged → 不安全（含 path/state/reason）', () => {
    const r = assessPreservedConfigSafety([{ path: PRESERVED_PATH, state: 'staged' }]);
    assert.equal(r.safe, false);
    assert.equal(r.unsafe.length, 1);
    assert.equal(r.unsafe[0].path, PRESERVED_PATH);
    assert.equal(r.unsafe[0].state, 'staged');
    assert.ok(typeof r.unsafe[0].reason === 'string' && r.unsafe[0].reason.length > 0);
  });

  it('tracked-modified → 不安全（含 path/state/reason）', () => {
    const r = assessPreservedConfigSafety([{ path: PRESERVED_PATH, state: 'tracked-modified' }]);
    assert.equal(r.safe, false);
    assert.equal(r.unsafe.length, 1);
    assert.equal(r.unsafe[0].state, 'tracked-modified');
    assert.ok(typeof r.unsafe[0].reason === 'string' && r.unsafe[0].reason.length > 0);
  });

  it('多 path 全安全 → safe=true, unsafe=[]', () => {
    const r = assessPreservedConfigSafety([
      { path: PRESERVED_PATH, state: 'untracked' },
      { path: OTHER_PATH, state: 'absent' },
    ]);
    assert.deepEqual(r, { safe: true, unsafe: [] });
  });

  it('多 path 一个不安全 → safe=false, unsafe 仅含 staged 项', () => {
    const r = assessPreservedConfigSafety([
      { path: PRESERVED_PATH, state: 'untracked' },
      { path: OTHER_PATH, state: 'staged' },
    ]);
    assert.equal(r.safe, false);
    assert.equal(r.unsafe.length, 1);
    assert.equal(r.unsafe[0].path, OTHER_PATH);
    assert.equal(r.unsafe[0].state, 'staged');
  });

  it('空数组 → 安全', () => {
    assert.deepEqual(assessPreservedConfigSafety([]), { safe: true, unsafe: [] });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// F203 主线程精化 #2：parsePreservedConfigStates（raw porcelain → entries）—— T205b
// ──────────────────────────────────────────────────────────────────────────
describe('parsePreservedConfigStates (F203 精化 #2)', () => {
  it('未跟踪 ?? → untracked', () => {
    const r = parsePreservedConfigStates(`?? ${PRESERVED_PATH}\n`, [PRESERVED_PATH]);
    assert.deepEqual(r, [{ path: PRESERVED_PATH, state: 'untracked' }]);
  });

  it('路径不在输出（空 porcelain）→ absent', () => {
    const r = parsePreservedConfigStates('', [PRESERVED_PATH]);
    assert.deepEqual(r, [{ path: PRESERVED_PATH, state: 'absent' }]);
  });

  it('路径不在输出（仅含其他路径）→ absent', () => {
    const r = parsePreservedConfigStates(' M src/foo.ts\n', [PRESERVED_PATH]);
    assert.deepEqual(r, [{ path: PRESERVED_PATH, state: 'absent' }]);
  });

  it('index 暂存修改 M  → staged', () => {
    const r = parsePreservedConfigStates(`M  ${PRESERVED_PATH}\n`, [PRESERVED_PATH]);
    assert.deepEqual(r, [{ path: PRESERVED_PATH, state: 'staged' }]);
  });

  it('新增已暂存 A  → staged', () => {
    const r = parsePreservedConfigStates(`A  ${PRESERVED_PATH}\n`, [PRESERVED_PATH]);
    assert.deepEqual(r, [{ path: PRESERVED_PATH, state: 'staged' }]);
  });

  it('暂存+工作区均改 MM → staged（index 列非空优先）', () => {
    const r = parsePreservedConfigStates(`MM ${PRESERVED_PATH}\n`, [PRESERVED_PATH]);
    assert.deepEqual(r, [{ path: PRESERVED_PATH, state: 'staged' }]);
  });

  it('仅工作区修改（未暂存）" M" → tracked-modified', () => {
    const r = parsePreservedConfigStates(` M ${PRESERVED_PATH}\n`, [PRESERVED_PATH]);
    assert.deepEqual(r, [{ path: PRESERVED_PATH, state: 'tracked-modified' }]);
  });

  it('多 path 混合状态 → 各自正确 state', () => {
    const text = `?? ${PRESERVED_PATH}\nM  ${OTHER_PATH}\n`;
    const r = parsePreservedConfigStates(text, [PRESERVED_PATH, OTHER_PATH]);
    assert.deepEqual(r, [
      { path: PRESERVED_PATH, state: 'untracked' },
      { path: OTHER_PATH, state: 'staged' },
    ]);
  });

  it('含引号路径（porcelain 对含空格路径加引号）→ 正确去引号匹配', () => {
    const spacePath = '.specify/has space.yaml';
    const r = parsePreservedConfigStates(`?? "${spacePath}"\n`, [spacePath]);
    assert.deepEqual(r, [{ path: spacePath, state: 'untracked' }]);
  });

  it('rename 行 R  old -> new：new 端命中 preserved → staged（修订 #3）', () => {
    const text = `R  src/old.yaml -> ${PRESERVED_PATH}\n`;
    const r = parsePreservedConfigStates(text, [PRESERVED_PATH]);
    assert.deepEqual(r, [{ path: PRESERVED_PATH, state: 'staged' }]);
  });

  it('rename 行 R  old -> new：old 端命中 preserved → staged（两端都查，修订 #3）', () => {
    const text = `R  ${PRESERVED_PATH} -> src/new.yaml\n`;
    const r = parsePreservedConfigStates(text, [PRESERVED_PATH]);
    assert.deepEqual(r, [{ path: PRESERVED_PATH, state: 'staged' }]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// F203 缺陷 2：evaluateSmokeReadiness（smoke escalate 非权威触发）—— T206
// ──────────────────────────────────────────────────────────────────────────
describe('evaluateSmokeReadiness (F203 缺陷 2)', () => {
  it('全 SKIPPED（vacuous 防护 C3）→ false', () => {
    const r = {
      verify_mode: 'smoke',
      layer2_commands: [
        { name: 'a', exit_code: null, status: 'SKIPPED', skipped_reason: 'dist_not_built' },
        { name: 'b', exit_code: null, status: 'SKIPPED', skipped_reason: 'dist_not_built' },
      ],
      layer1_fr_coverage: { p1_coverage_pct: 100 },
      layer1_5_evidence: { status: 'COMPLIANT' },
    };
    assert.equal(evaluateSmokeReadiness(r), false);
  });

  it('非 SKIPPED 有 FAIL → false', () => {
    assert.equal(evaluateSmokeReadiness(loadFixture('report-smoke-fail-real.json')), false);
  });

  it('≥1 非 SKIPPED PASS + 其余 SKIPPED → true（fixture report-smoke-skipped-e2e）', () => {
    assert.equal(evaluateSmokeReadiness(loadFixture('report-smoke-skipped-e2e.json')), true);
  });

  it('p1_coverage_pct !== 100 → false', () => {
    const r = loadFixture('report-smoke-skipped-e2e.json');
    r.layer1_fr_coverage.p1_coverage_pct = 80;
    assert.equal(evaluateSmokeReadiness(r), false);
  });

  it('layer1_5 非 COMPLIANT → false', () => {
    const r = loadFixture('report-smoke-skipped-e2e.json');
    r.layer1_5_evidence.status = 'UNKNOWN';
    assert.equal(evaluateSmokeReadiness(r), false);
  });

  it('UNKNOWN 命令存在（非 SKIPPED 且非 PASS）→ false', () => {
    const r = loadFixture('report-smoke-skipped-e2e.json');
    // 把一条非 SKIPPED 命令变成 UNKNOWN（去掉 exit_code）
    r.layer2_commands[0] = { name: 'tsc --noEmit', exit_code: null, status: 'UNKNOWN', skipped_reason: null };
    assert.equal(evaluateSmokeReadiness(r), false);
  });
});

// 引用导入常量做 sanity（确保 PRESERVED_CONFIG_PATHSPECS 导出可用）
describe('PRESERVED_CONFIG_PATHSPECS 常量', () => {
  it('导出含 .specify/orchestration-overrides.yaml', () => {
    assert.ok(Array.isArray(PRESERVED_CONFIG_PATHSPECS));
    assert.ok(PRESERVED_CONFIG_PATHSPECS.includes('.specify/orchestration-overrides.yaml'));
  });
});
