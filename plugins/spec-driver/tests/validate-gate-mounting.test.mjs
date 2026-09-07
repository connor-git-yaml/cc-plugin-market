/**
 * validate-gate-mounting.test.mjs
 * FR-053 —— repo:check 侧的门挂载与门字段事后守护（Feature 277 Phase A · T012）
 *
 * 运行方式: node --test plugins/spec-driver/tests/validate-gate-mounting.test.mjs
 *
 * 12 条断言（核对式 6 + 1 + 1 + 1 + 3 = 12，单位：断言条）：
 *   (i)   挂载断言    3 强制 mode × 2 gate = 6
 *   (ii)  feature 下 GATE_DESIGN 的 is_hard_gate === true            1
 *   (iii) GATE_DESIGN.default_behavior ≠ skip                        1
 *   (iv)  GATE_TASKS.default_behavior ∉ {auto, skip}                 1
 *   (v)   每个强制 mode 的 diagnostics 无 error 级条目               3
 *
 * (i) 刻意保持**绝对存在性**形式，不随 FR-068 / FR-052 (丙) 改为相对形式
 * （`mounted_in_base ⇒ mounted`）——改了本条也会对「base 被直接编辑掉挂载」
 * 失明，而那正是本守护项唯一承担的路径。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateGateMounting,
  evaluateGateMountingAssertions,
} from '../scripts/validate-gate-mounting.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'orchestration');

/** 建一个带 overrides 的临时项目根 */
function createTempProjectDir(fixtureFileName = null) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-mounting-'));
  if (fixtureFileName) {
    fs.mkdirSync(path.join(tmpDir, '.specify'), { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURES_DIR, fixtureFileName),
      path.join(tmpDir, '.specify', 'orchestration-overrides.yaml'),
    );
  }
  return tmpDir;
}

function cleanupTempDir(tmpDir) {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

/** 从结果里取断言清单 */
function assertionsOf(result) {
  return result.checks?.[0]?.evidence?.assertions ?? [];
}

/** 造一份「健康」的合成输入（不读盘，用于隔离测 (i) 的红灯） */
function buildHealthyInput() {
  const phase = (id, before, after) => ({
    id, name: `p${id}`, display_name: `P${id}`, agent: null, agent_mode: 'gate',
    gates_before: before, gates_after: after, conditional: null,
    skip_if_exists: null, is_critical: true,
  });
  const modeWithGates = () => ({
    name: 'm', description: 'm',
    phases: [phase('1', null, ['GATE_DESIGN']), phase('2', ['GATE_TASKS'], null)],
  });
  return {
    effectiveConfig: {
      version: '1.0',
      gates: {
        GATE_DESIGN: { default_behavior: 'always', severity: 'critical', hard_gate_modes: ['feature'] },
        GATE_TASKS: { default_behavior: 'always', severity: 'critical', hard_gate_modes: null },
      },
      modes: {
        feature: modeWithGates(), story: modeWithGates(), implement: modeWithGates(),
      },
    },
    gateBehaviorByMode: { feature: { GATE_DESIGN: { is_hard_gate: true } } },
    diagnosticsByMode: { feature: [], story: [], implement: [] },
  };
}

describe('validate-gate-mounting — 干净仓根（12 条全 PASS）', () => {
  it('导出 validateGateMounting 与 evaluateGateMountingAssertions', () => {
    assert.equal(typeof validateGateMounting, 'function');
    assert.equal(typeof evaluateGateMountingAssertions, 'function');
  });

  it('本仓根：status=pass，check id = effective-config，12 条断言全 PASS', async () => {
    const result = await validateGateMounting({ projectRoot: REPO_ROOT });
    assert.equal(result.status, 'pass', `本仓无 overrides，应全 PASS；实际: ${JSON.stringify(result.errors)}`);
    assert.equal(result.checks.length, 1, '守护项按 1 个 check id 计（守护项数与断言数是两个量）');
    assert.equal(result.checks[0].id, 'effective-config');
    assert.equal(result.checks[0].status, 'pass');

    const assertions = assertionsOf(result);
    assert.equal(assertions.length, 12, `断言条数换算式 6+1+1+1+3=12，实际 ${assertions.length}`);
    assert.equal(assertions.filter(a => a.status === 'pass').length, 12, '12 条应全 PASS');
  });

  it('12 条按类别分布正确（6 挂载 / 1 硬门禁 / 1 + 1 字段 / 3 diagnostics）', async () => {
    const result = await validateGateMounting({ projectRoot: REPO_ROOT });
    const byKind = {};
    for (const a of assertionsOf(result)) byKind[a.kind] = (byKind[a.kind] || 0) + 1;
    assert.deepEqual(byKind, {
      mounting: 6, is_hard_gate: 1, gate_design_behavior: 1, gate_tasks_behavior: 1, diagnostics: 3,
    }, `分布不符：${JSON.stringify(byKind)}`);
  });
});

describe('validate-gate-mounting — (i) 的红灯构造（本守护项存在的唯一理由）', () => {
  it('effective 配置里 feature 失去 GATE_DESIGN 挂载 → (i) 必须红，(ii)~(v) 全 PASS', () => {
    const input = buildHealthyInput();
    // 模拟「base 被直接编辑掉挂载」：这条路径 FR-068 的第一道闸是盲的
    // （mounted_in_base 同步变假、蕴含式空洞成立），只有本条的绝对形式能抓到。
    input.effectiveConfig.modes.feature.phases = input.effectiveConfig.modes.feature.phases
      .map(p => ({ ...p, gates_after: (p.gates_after || []).filter(g => g !== 'GATE_DESIGN') }))
      .map(p => ({ ...p, gates_after: p.gates_after.length ? p.gates_after : null }));

    const assertions = evaluateGateMountingAssertions(input);
    assert.equal(assertions.length, 12, '断言条数不变');

    const failed = assertions.filter(a => a.status === 'fail');
    assert.equal(failed.length, 1, `应恰有 1 条红；实际: ${JSON.stringify(failed)}`);
    assert.equal(failed[0].kind, 'mounting', '红的必须是挂载断言 (i)');
    assert.equal(failed[0].mode, 'feature');
    assert.equal(failed[0].gateId, 'GATE_DESIGN');

    // (ii)~(v) 在该构造下全 PASS —— 这正是它们抓不到「删挂载」的证据
    for (const a of assertions.filter(a => a.kind !== 'mounting')) {
      assert.equal(a.status, 'pass', `(ii)~(v) 在删挂载构造下应全 PASS，${a.id} 却红了`);
    }
  });

  it('(iii)/(iv) 字段断言各自能红（default_behavior 被改坏）', () => {
    const a = buildHealthyInput();
    a.effectiveConfig.gates.GATE_DESIGN.default_behavior = 'skip';
    const r1 = evaluateGateMountingAssertions(a).filter(x => x.status === 'fail');
    assert.deepEqual(r1.map(x => x.kind), ['gate_design_behavior']);

    for (const bad of ['auto', 'skip']) {
      const b = buildHealthyInput();
      b.effectiveConfig.gates.GATE_TASKS.default_behavior = bad;
      const r2 = evaluateGateMountingAssertions(b).filter(x => x.status === 'fail');
      assert.deepEqual(r2.map(x => x.kind), ['gate_tasks_behavior'], `GATE_TASKS=${bad} 应红`);
    }
    // always / on_failure 仍留有暂停路径，不得误报
    for (const ok of ['always', 'on_failure']) {
      const c = buildHealthyInput();
      c.effectiveConfig.gates.GATE_TASKS.default_behavior = ok;
      assert.equal(
        evaluateGateMountingAssertions(c).filter(x => x.status === 'fail').length, 0,
        `GATE_TASKS=${ok} 不应被判红（防守护过宽）`,
      );
    }
  });

  it('(ii) 能红（feature 被移出 GATE_DESIGN.hard_gate_modes）', () => {
    const input = buildHealthyInput();
    input.gateBehaviorByMode.feature.GATE_DESIGN.is_hard_gate = false;
    const failed = evaluateGateMountingAssertions(input).filter(x => x.status === 'fail');
    assert.deepEqual(failed.map(x => x.kind), ['is_hard_gate']);
  });

  it('(v) 能红（某个强制 mode 的 diagnostics 含 error）', () => {
    const input = buildHealthyInput();
    input.diagnosticsByMode.story = [{ level: 'error', code: 'x', message: 'boom' }];
    const failed = evaluateGateMountingAssertions(input).filter(x => x.status === 'fail');
    assert.deepEqual(failed.map(x => x.kind), ['diagnostics']);
    assert.equal(failed[0].mode, 'story');
  });
});

describe('validate-gate-mounting — 判不出⇒从严 / 禁写字面量 / catch 不放行', () => {
  it('强制 mode 清单从 hard_gate_modes 派生，不是写死的字面量', () => {
    const input = buildHealthyInput();
    input.effectiveConfig.gates.GATE_DESIGN.hard_gate_modes = ['feature', 'refactor'];
    input.effectiveConfig.modes.refactor = { name: 'r', description: 'r', phases: [] };
    input.diagnosticsByMode.refactor = [];
    input.gateBehaviorByMode.refactor = { GATE_DESIGN: { is_hard_gate: true } };

    const assertions = evaluateGateMountingAssertions(input);
    // refactor 自动进入射程：挂载 6→8、diagnostics 3→4，共 12→15
    assert.equal(assertions.length, 15, `refactor 应自动进入射程，实际断言数 ${assertions.length}`);
    assert.ok(
      assertions.some(a => a.kind === 'mounting' && a.mode === 'refactor'),
      '判据若写成 [feature,story,implement] 字面量，此处必漏（F259 反模式）',
    );
  });

  it('effective 配置取不到时判断言不成立，不得因「判不出」而放行', () => {
    const assertions = evaluateGateMountingAssertions({
      effectiveConfig: null, gateBehaviorByMode: {}, diagnosticsByMode: {},
    });
    assert.ok(assertions.length > 0, '不得返回空断言集（空集等于全 PASS）');
    assert.ok(
      assertions.every(a => a.status === 'fail'),
      `effective 取不到时全部断言应判 fail；实际: ${JSON.stringify(assertions.map(a => a.status))}`,
    );
  });

  it('catch 分支返回 fail 结果，禁止返回空结果或 pass（FR-045）', async () => {
    const result = await validateGateMounting({
      projectRoot: REPO_ROOT,
      _runCli: () => { throw new Error('模拟 CLI 崩溃'); },
    });
    assert.equal(result.status, 'fail', 'CLI 崩溃时必须记 fail，不得记 pass');
    assert.ok(result.checks.length > 0, '不得返回空 checks 数组');
    assert.equal(result.checks[0].status, 'fail');
    assert.ok(
      result.errors.some(e => e.includes('模拟 CLI 崩溃')),
      `异常消息须进 errors；实际: ${JSON.stringify(result.errors)}`,
    );
  });
});

describe('validate-gate-mounting — 真实 override 攻击路径（端到端）', () => {
  it('删门挂载的 override → 守护项判 fail（经 (v)：resolver 已发 error 级 diagnostic）', async () => {
    const tmpDir = createTempProjectDir('attack-feature-drops-gate-design.yaml');
    try {
      const result = await validateGateMounting({ projectRoot: tmpDir });
      assert.equal(result.status, 'fail', '删门挂载的 override 必须让守护项红');
      const failed = assertionsOf(result).filter(a => a.status === 'fail');
      assert.ok(failed.length > 0, '应有红的断言');
      // FR-052 的 resolver 侧校验已拒绝该覆盖并回退 base，故 effective 侧门重新挂上，
      // (i) 转绿而 (v) 变红。这与 FR-053 验证点 3 原写的「(i) 必须红、(ii)~(v) 全 PASS」
      // 不同——那条验证点成文于 resolver 侧拒绝落地之前。此处断言真实行为。
      assert.ok(
        failed.some(a => a.kind === 'diagnostics'),
        `应由 (v) diagnostics 断言抓到；实际红的: ${JSON.stringify(failed.map(a => a.id))}`,
      );
    } finally {
      cleanupTempDir(tmpDir);
    }
  });
});

// ═════════════════════════════════════════════════════════════
// (i) 由「结构存在性」收紧为「存在无条件挂载锚点」（Phase A 对抗修订 · α-C1）
//
// 断言条数不变（仍是 12），变的是 (i) 的判据强度。收紧的边界必须两侧都钉住：
//   - conditional 恒假的幽灵门位必须判红（否则 α-C1 在事后守护上仍失明）；
//   - base 自身带 skip_if_exists 的合法锚点不得判红（story / implement 的
//     GATE_DESIGN 锚点实测全部带 skip_if_exists，一并要求会把干净仓库判红）。
// ═════════════════════════════════════════════════════════════

describe('validate-gate-mounting — (i) 的可达性收紧（α-C1）', () => {
  it('挂载 phase 全部带 conditional → (i) 判红（纯存在性判据在此判绿）', () => {
    const input = buildHealthyInput();
    for (const p of input.effectiveConfig.modes.feature.phases) {
      p.conditional = 'never_true_flag == true';
    }
    const assertions = evaluateGateMountingAssertions(input);
    assert.equal(assertions.length, 12, '断言条数不变（收紧的是判据强度，不是条数）');

    const failed = assertions.filter(a => a.status === 'fail');
    assert.deepEqual(
      failed.map(a => a.id).sort(),
      ['mounting:feature:GATE_DESIGN', 'mounting:feature:GATE_TASKS'],
      `feature 两道门都应判红；实际: ${JSON.stringify(failed.map(a => a.id))}`,
    );
    assert.match(failed[0].detail, /conditional/, 'detail 须点明是被 conditional 抑制');
  });

  it('部分锚点带 conditional、仍有一个无条件锚点 → 不判红（防守护过宽）', () => {
    const input = buildHealthyInput();
    const phases = input.effectiveConfig.modes.feature.phases;
    // 再加一个带 conditional 的 GATE_DESIGN 挂载：无条件锚点仍在 ⇒ 门仍会被求值
    phases.push({
      ...phases[0], id: '9', name: 'p9',
      gates_after: ['GATE_DESIGN'], conditional: 'never_true_flag == true',
    });
    const failed = evaluateGateMountingAssertions(input).filter(a => a.status === 'fail');
    assert.deepEqual(failed, [], `仍有无条件锚点时不得判红；实际: ${JSON.stringify(failed.map(a => a.id))}`);
  });

  it('锚点带 skip_if_exists 但 conditional 为 null → 不判红（base 自身就是这个形态）', () => {
    const input = buildHealthyInput();
    for (const p of input.effectiveConfig.modes.feature.phases) {
      p.skip_if_exists = 'plan.md';
    }
    const failed = evaluateGateMountingAssertions(input).filter(a => a.status === 'fail');
    assert.deepEqual(failed, [], `skip_if_exists 侧的收紧只能相对 base 判，绝对形式不得判红；实际: ${JSON.stringify(failed.map(a => a.id))}`);
  });

  it('本仓 base 的实况前提核实：story / implement 的 GATE_DESIGN 锚点全部带 skip_if_exists', async () => {
    // 这条不是「测代码」，是把上一条用例赖以成立的前提钉成可复核的事实——
    // 前提一旦变化（base 给这些 mode 加了无条件锚点），绝对形式就可以收得更紧。
    const { collectGateMountAnchors } = await import('../contracts/orchestration-schema.mjs');
    const result = await validateGateMounting({ projectRoot: REPO_ROOT });
    assert.equal(result.status, 'pass', '前提核实需在干净仓根上做');

    const { execFileSync } = await import('node:child_process');
    const cliPath = path.join(__dirname, '..', 'scripts', 'orchestrator-cli.mjs');
    const effective = JSON.parse(execFileSync(
      process.execPath,
      [cliPath, 'effective-orchestration', 'feature', '--format', 'json', '--project-root', REPO_ROOT],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    )).config;

    for (const mode of ['story', 'implement']) {
      const anchors = collectGateMountAnchors(effective, mode, 'GATE_DESIGN');
      assert.ok(anchors.length > 0, `${mode} 应有 GATE_DESIGN 锚点`);
      assert.ok(
        anchors.every(a => a.skipIfExists !== null),
        `${mode} 的 GATE_DESIGN 锚点实测应全部带 skip_if_exists；实际: ${JSON.stringify(anchors)}`,
      );
      assert.ok(
        anchors.every(a => a.conditional === null),
        `${mode} 的 GATE_DESIGN 锚点不应带 conditional（否则 (i) 会把干净仓库判红）`,
      );
    }
  });

  it('三份 feature 攻击 fixture 端到端：守护项一律判 fail（不得静默 pass）', async () => {
    for (const fixture of [
      'attack-feature-ghost-conditional.yaml',
      'attack-feature-ghost-skip-if-exists.yaml',
      'attack-feature-mount-at-end.yaml',
    ]) {
      const tmpDir = createTempProjectDir(fixture);
      try {
        const result = await validateGateMounting({ projectRoot: tmpDir });
        assert.equal(result.status, 'fail', `${fixture} 必须让守护项红`);
        const failed = assertionsOf(result).filter(a => a.status === 'fail');
        // resolver 已拒绝并回退 base ⇒ (i) 转绿，由 (v) diagnostics 抓红（同 attack-feature-drops-gate-design）
        assert.ok(
          failed.some(a => a.kind === 'diagnostics'),
          `${fixture} 应由 (v) 抓到；实际红的: ${JSON.stringify(failed.map(a => a.id))}`,
        );
      } finally {
        cleanupTempDir(tmpDir);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// β-C2 / β-W4 —— 「减」方向：配置里少一个强制 mode 时断言必须判红，不是消失
//
// 旧实现的射程 = `[...派生].filter(mode => baseModes[mode] !== undefined)`：
// 删掉 modes.implement 整段 ⇒ 断言数 12 → 9 且 status = pass（β-C2 实测）；
// effectiveConfig 取不到时 ⇒ 12 → 9（β-W4 实测，缺的正是 feature 的三条）。
// 现在射程以常量 GATE_MOUNTING_MANDATORY_MODES 为下界，恒 ≥ 12 条。
// ═══════════════════════════════════════════════════════════════

describe('validate-gate-mounting — 「减」方向：缺强制 mode 时断言判红而非消失（β-C2）', () => {
  /** 造一份「删掉某几个 mode 段」的输入；对应 mode 的 CLI 取数也一并失败（真实链路如此） */
  function withModesRemoved(...modes) {
    const input = buildHealthyInput();
    for (const mode of modes) {
      delete input.effectiveConfig.modes[mode];
      delete input.diagnosticsByMode[mode];
    }
    return input;
  }

  const idsOf = list => list.map(a => a.id).sort();

  it('删 modes.implement ⇒ 仍为 12 条，且恰好 implement 的三条判红', () => {
    const assertions = evaluateGateMountingAssertions(withModesRemoved('implement'));
    assert.equal(assertions.length, 12, `断言总数必须仍是 12，实际 ${assertions.length}`);
    assert.deepEqual(
      idsOf(assertions.filter(a => a.status === 'fail')),
      ['diagnostics:implement', 'mounting:implement:GATE_DESIGN', 'mounting:implement:GATE_TASKS'],
    );
    const mountFail = assertions.find(a => a.id === 'mounting:implement:GATE_DESIGN');
    assert.match(mountFail.detail, /读不出 modes\.implement\.phases/);
  });

  it('删 modes.story ⇒ 仍为 12 条，且恰好 story 的三条判红', () => {
    const assertions = evaluateGateMountingAssertions(withModesRemoved('story'));
    assert.equal(assertions.length, 12);
    assert.deepEqual(
      idsOf(assertions.filter(a => a.status === 'fail')),
      ['diagnostics:story', 'mounting:story:GATE_DESIGN', 'mounting:story:GATE_TASKS'],
    );
  });

  it('三段全删 ⇒ 仍为 12 条，9 条判红（6 挂载 + 3 diagnostics），字段类三条仍绿', () => {
    const assertions = evaluateGateMountingAssertions(withModesRemoved('feature', 'story', 'implement'));
    assert.equal(assertions.length, 12);
    const failed = assertions.filter(a => a.status === 'fail');
    assert.equal(failed.length, 9, `实际红 ${failed.length} 条：${JSON.stringify(idsOf(failed))}`);
    assert.deepEqual(
      idsOf(assertions.filter(a => a.status === 'pass')),
      ['default-behavior:GATE_DESIGN', 'default-behavior:GATE_TASKS', 'is-hard-gate:feature:GATE_DESIGN'],
    );
  });

  it('β-W4 · effectiveConfig 取不到时射程不缩水：仍是 12 条（旧实现掉到 9，缺 feature 三条）', () => {
    const assertions = evaluateGateMountingAssertions({
      effectiveConfig: null, gateBehaviorByMode: {}, diagnosticsByMode: {},
    });
    assert.equal(assertions.length, 12, `注释宣称「不缩小射程」，实际 ${assertions.length} 条`);
    assert.ok(assertions.every(a => a.status === 'fail'));
    for (const id of ['mounting:feature:GATE_DESIGN', 'mounting:feature:GATE_TASKS', 'diagnostics:feature']) {
      assert.ok(assertions.some(a => a.id === id), `断言 ${id} 不得缺席`);
    }
  });

  it('CLI 对缺席 mode 退出 1 时不上抛：族入口仍产出 12 条，取数错误原文进 detail', async () => {
    // 真实链路：`effective-orchestration implement` 对不存在的 mode exit 1 ⇒ execFileSync 抛错。
    // 上抛会把 12 条坍缩成 1 条 catch 结论——那是把「断言静默消失」换个形式重演。
    const healthy = buildHealthyInput();
    const config = JSON.parse(JSON.stringify(healthy.effectiveConfig));
    delete config.modes.implement;
    const result = await validateGateMounting({
      projectRoot: REPO_ROOT,
      _runCli: (args) => {
        if (args[0] === 'get-gate-behavior') return { is_hard_gate: true };
        if (args[1] === 'implement') throw new Error('CLI exit 1: mode "implement" 不存在');
        return { config, diagnostics: [] };
      },
    });
    const assertions = assertionsOf(result);
    assert.equal(result.status, 'fail');
    assert.equal(assertions.length, 12, `实际 ${assertions.length} 条：${JSON.stringify(assertions.map(a => a.id))}`);
    assert.deepEqual(
      assertions.filter(a => a.status === 'fail').map(a => a.id).sort(),
      ['diagnostics:implement', 'mounting:implement:GATE_DESIGN', 'mounting:implement:GATE_TASKS'],
    );
    assert.ok(
      result.errors.some(e => e.includes('mode "implement" 不存在')),
      `取数失败原文须进 errors；实际: ${JSON.stringify(result.errors)}`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// δ-C1 —— 在锚点之前插入 base 未定义名字的产出型 phase
// ═══════════════════════════════════════════════════════════════

describe('validate-gate-mounting — δ-C1 七组构造端到端（锚点一字未改 / 只改一个字段）', () => {
  const cases = [
    // 第二轮：新名字 + 真 agent + 非 gate 模式
    ['attack-story-prepend-producers.yaml', 'story'],
    ['attack-implement-prepend-plan-early.yaml', 'implement'],
    // 第三轮 N-1 的四个逃逸口 + 锚点自身被改成产出型
    ['attack-story-duplicate-base-name.yaml', 'story'],
    ['attack-implement-rebind-base-name.yaml', 'implement'],
    ['attack-story-inline-producer.yaml', 'story'],
    ['attack-story-gate-mode-producer.yaml', 'story'],
    ['attack-feature-anchor-agent-swap.yaml', 'feature'],
  ];

  for (const [fixture, mode] of cases) {
    it(`${fixture}（${mode}）→ 守护项判 fail，经 (v) 的 error 级 diagnostic`, async () => {
      const tmpDir = createTempProjectDir(fixture);
      try {
        const result = await validateGateMounting({ projectRoot: tmpDir });
        assert.equal(result.status, 'fail', '该攻击必须让守护项红');
        const failed = assertionsOf(result).filter(a => a.status === 'fail');
        assert.ok(
          failed.some(a => a.kind === 'diagnostics'),
          `应由 (v) 抓到（resolver 已拒绝并回退 base）；实际红的: ${JSON.stringify(failed.map(a => a.id))}`,
        );
        assert.equal(assertionsOf(result).length, 12);
      } finally {
        cleanupTempDir(tmpDir);
      }
    });
  }

  it('不误伤 · 锚点前缩减（删掉 base 的 constitution）⇒ 12 条全绿', async () => {
    const tmpDir = createTempProjectDir('valid-overrides-story-drop-preanchor.yaml');
    try {
      const result = await validateGateMounting({ projectRoot: tmpDir });
      const failed = assertionsOf(result).filter(a => a.status === 'fail');
      assert.deepEqual(failed.map(a => a.id), [], '合法缩减不得让任何一条断言红');
      assert.equal(result.status, 'pass');
      assert.equal(assertionsOf(result).length, 12);
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('不误伤 · valid-overrides-goal-loop（gates_before 锚点改 agent_mode）⇒ 12 条全绿', async () => {
    const tmpDir = createTempProjectDir('valid-overrides-goal-loop.yaml');
    try {
      const result = await validateGateMounting({ projectRoot: tmpDir });
      const failed = assertionsOf(result).filter(a => a.status === 'fail');
      assert.deepEqual(failed.map(a => a.id), [], 'F201 goal_loop 的合法激活位不得被判据 3 误伤');
      assert.equal(assertionsOf(result).length, 12);
    } finally {
      cleanupTempDir(tmpDir);
    }
  });
});
