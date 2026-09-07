/**
 * orchestrator.test.mjs
 * Smoke Test Suite for Orchestrator（使用 Node.js 内置测试框架）
 *
 * 运行方式: node --test plugins/spec-driver/tests/orchestrator.test.mjs
 *
 * 测试覆盖：
 * - 配置加载和验证
 * - 7 种模式的 Phase 序列
 * - Gate 4-tier 优先级
 * - 并行组调度
 * - 条件执行
 * - 向后兼容降级
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Orchestrator, validateOrchestrationYaml, evaluateCondition } from '../lib/orchestrator.mjs';
import { generateFallbackConfig } from '../lib/orchestrator-fallback.mjs';
import { orchestrationBaseSchema } from '../contracts/orchestration-schema.mjs';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// ═════════════════════════════════════════════════════════════
// Feature 模式
// ═════════════════════════════════════════════════════════════

describe('Feature Mode', () => {
  it('加载 orchestration.yaml 成功', () => {
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger });
    const summary = orch.getSummary();
    assert.ok(summary.phasesCount > 0, 'Feature 模式应有 Phase');
    assert.equal(summary.gatesCount, 6, '应有 6 个 Gate');
  });

  it('Feature 模式有 10+ 个 Phase', () => {
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger });
    assert.ok(orch.getPhases().length >= 10, 'Feature 模式应有 ≥10 个 Phase');
  });

  it('GATE_DESIGN 在 feature 模式下是硬门禁', () => {
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger });
    const gate = orch.getGateBehavior('GATE_DESIGN');
    assert.equal(gate.behavior, 'always');
    assert.equal(gate.isHardGate, true);
    assert.equal(gate.source, 'hard_gate');
  });

  it('有 3 个并行组', () => {
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger });
    const groups = orch.getParallelGroups();
    assert.equal(groups.length, 3);

    const research = orch.getParallelGroup('RESEARCH_GROUP');
    assert.ok(research);
    assert.deepEqual(research.members, ['1a', '1b']);
    assert.equal(research.convergencePoint, '1c');
  });
});

// ═════════════════════════════════════════════════════════════
// Story 模式
// ═════════════════════════════════════════════════════════════

describe('Story Mode', () => {
  it('加载成功且 Phase 数量 < feature', () => {
    const orch = new Orchestrator({}, 'story', { logger: silentLogger });
    const phases = orch.getPhases();
    assert.ok(phases.length > 0);
    assert.ok(phases.length <= 10, 'Story 模式 Phase 应少于 feature');
  });

  it('GATE_DESIGN 非硬门禁，用户可覆盖', () => {
    const userConfig = {
      gate_policy: 'autonomous',
      gates: { GATE_DESIGN: { pause: 'on_failure' } },
    };
    const orch = new Orchestrator(userConfig, 'story', { logger: silentLogger });
    const gate = orch.getGateBehavior('GATE_DESIGN');
    assert.equal(gate.behavior, 'on_failure', '用户配置应覆盖 story 模式的 GATE_DESIGN');
    assert.equal(gate.source, 'user_config');
  });
});

// ═════════════════════════════════════════════════════════════
// 其他 5 种模式
// ═════════════════════════════════════════════════════════════

describe('Implement Mode', () => {
  it('加载成功', () => {
    const orch = new Orchestrator({}, 'implement', { logger: silentLogger });
    assert.ok(orch.getPhases().length > 0);
  });

  it('GATE_IMPLEMENT_MID 存在', () => {
    const orch = new Orchestrator({}, 'implement', { logger: silentLogger });
    const gate = orch.getGateBehavior('GATE_IMPLEMENT_MID');
    assert.equal(gate.behavior, 'on_failure');
  });
});

describe('Fix Mode', () => {
  it('加载成功且 Phase ≤ 5', () => {
    const orch = new Orchestrator({}, 'fix', { logger: silentLogger });
    const phases = orch.getPhases();
    assert.ok(phases.length > 0);
    assert.ok(phases.length <= 5, 'Fix 模式应为最小化');
  });
});

describe('Resume Mode', () => {
  it('加载成功', () => {
    const orch = new Orchestrator({}, 'resume', { logger: silentLogger });
    assert.ok(orch.getPhases().length > 0);
  });
});

describe('Sync Mode', () => {
  it('加载成功', () => {
    const orch = new Orchestrator({}, 'sync', { logger: silentLogger });
    assert.ok(orch.getPhases().length > 0);
  });
});

describe('Doc Mode', () => {
  it('加载成功', () => {
    const orch = new Orchestrator({}, 'doc', { logger: silentLogger });
    assert.ok(orch.getPhases().length > 0);
  });
});

describe('Refactor Mode', () => {
  it('加载成功且有 5 个 Phase', () => {
    const orch = new Orchestrator({}, 'refactor', { logger: silentLogger });
    const phases = orch.getPhases();
    assert.equal(phases.length, 5, 'Refactor 模式应有 5 个 Phase');
  });

  it('Phase 序列正确: impact→batch_plan→batch_impl→residual→verify', () => {
    const orch = new Orchestrator({}, 'refactor', { logger: silentLogger });
    const names = orch.getPhases().map((p) => p.name);
    assert.deepEqual(names, [
      'impact_analysis', 'batch_planning', 'batch_implement',
      'residual_scan', 'final_verify',
    ]);
  });

  it('batch_implement 使用 batch_loop agent_mode', () => {
    const orch = new Orchestrator({}, 'refactor', { logger: silentLogger });
    const batchPhase = orch.getPhases().find((p) => p.name === 'batch_implement');
    assert.ok(batchPhase);
    assert.equal(batchPhase.agent_mode, 'batch_loop');
  });

  it('GATE_TASKS 和 GATE_VERIFY 适用于 refactor', () => {
    const orch = new Orchestrator({}, 'refactor', { logger: silentLogger });
    const tasks = orch.getGateBehavior('GATE_TASKS');
    const verify = orch.getGateBehavior('GATE_VERIFY');
    assert.ok(tasks.behavior, 'GATE_TASKS 应有行为定义');
    assert.ok(verify.behavior, 'GATE_VERIFY 应有行为定义');
  });
});

// ═════════════════════════════════════════════════════════════
// Gate 4-tier 优先级
// ═════════════════════════════════════════════════════════════

describe('Gate 4-tier Priority', () => {
  it('balanced 策略默认值', () => {
    const orch = new Orchestrator({ gate_policy: 'balanced' }, 'feature', {
      logger: silentLogger,
    });
    assert.equal(orch.getGateBehavior('GATE_RESEARCH').behavior, 'auto');
    assert.equal(orch.getGateBehavior('GATE_TASKS').behavior, 'always');
  });

  it('strict 策略：全部 always', () => {
    const orch = new Orchestrator({ gate_policy: 'strict' }, 'feature', {
      logger: silentLogger,
    });
    assert.equal(orch.getGateBehavior('GATE_RESEARCH').behavior, 'always');
    assert.equal(orch.getGateBehavior('GATE_ANALYSIS').behavior, 'always');
  });

  it('autonomous 策略：全部 on_failure', () => {
    const orch = new Orchestrator({ gate_policy: 'autonomous' }, 'feature', {
      logger: silentLogger,
    });
    // 注意：GATE_DESIGN 在 feature 模式下是硬门禁，不受 autonomous 影响
    assert.equal(orch.getGateBehavior('GATE_RESEARCH').behavior, 'on_failure');
    assert.equal(orch.getGateBehavior('GATE_DESIGN').behavior, 'always', '硬门禁不可覆盖');
  });

  it('用户配置覆盖策略，但硬门禁不受影响', () => {
    const userConfig = {
      gate_policy: 'balanced',
      gates: {
        GATE_DESIGN: { pause: 'on_failure' },  // 应被忽略（硬门禁）
        GATE_RESEARCH: { pause: 'always' },     // 应被应用
      },
    };
    const orch = new Orchestrator(userConfig, 'feature', { logger: silentLogger });
    assert.equal(orch.getGateBehavior('GATE_DESIGN').behavior, 'always', '硬门禁不可覆盖');
    assert.equal(orch.getGateBehavior('GATE_DESIGN').source, 'hard_gate');
    assert.equal(orch.getGateBehavior('GATE_RESEARCH').behavior, 'always', '用户配置应覆盖');
    assert.equal(orch.getGateBehavior('GATE_RESEARCH').source, 'user_config');
  });
});

// ═════════════════════════════════════════════════════════════
// 条件执行
// ═════════════════════════════════════════════════════════════

describe('Phase Condition Evaluation', () => {
  it('research_mode in [full, product-only] — 匹配', () => {
    assert.equal(
      evaluateCondition('research_mode in [full, product-only]', { research_mode: 'full' }),
      true
    );
  });

  it('research_mode in [full, product-only] — 不匹配', () => {
    assert.equal(
      evaluateCondition('research_mode in [full, product-only]', { research_mode: 'tech-only' }),
      false
    );
  });

  it('== 相等比较', () => {
    assert.equal(
      evaluateCondition('online_research_required == true', { online_research_required: 'true' }),
      true
    );
  });

  it('skip_if_exists 跳过已有制品', () => {
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger });
    const phases = orch.getPhases();
    const specifyPhase = phases.find((p) => p.name === 'specify');

    const ctx = {
      featureDir: '/test/feature',
      fileExists: (fp) => fp.includes('spec.md'),
    };
    assert.equal(orch.shouldExecutePhase(specifyPhase, ctx), false, '有 spec.md 应跳过');
  });

  it('空条件默认返回 true', () => {
    assert.equal(evaluateCondition(null, {}), true);
    assert.equal(evaluateCondition('', {}), true);
  });
});

// ═════════════════════════════════════════════════════════════
// Fallback 和向后兼容
// ═════════════════════════════════════════════════════════════

describe('Fallback Configuration', () => {
  it('fallback 配置包含全部 8 种模式', () => {
    const fb = generateFallbackConfig();
    const modes = Object.keys(fb.modes);
    assert.ok(modes.includes('feature'));
    assert.ok(modes.includes('story'));
    assert.ok(modes.includes('implement'));
    assert.ok(modes.includes('fix'));
    assert.ok(modes.includes('resume'));
    assert.ok(modes.includes('sync'));
    assert.ok(modes.includes('doc'));
    assert.ok(modes.includes('refactor'), 'fallback 应包含 refactor 模式');
    assert.equal(modes.length, 8, '应有 8 种模式');
  });

  it('fallback 配置包含全部 6 个 Gate', () => {
    const fb = generateFallbackConfig();
    assert.ok(fb.gates.GATE_RESEARCH);
    assert.ok(fb.gates.GATE_DESIGN);
    assert.ok(fb.gates.GATE_ANALYSIS);
    assert.ok(fb.gates.GATE_TASKS);
    assert.ok(fb.gates.GATE_IMPLEMENT_MID);
    assert.ok(fb.gates.GATE_VERIFY);
  });

  it('fallback feature 模式 Phase gates_after 是字符串数组', () => {
    const fb = generateFallbackConfig();
    const specifyPhase = fb.modes.feature.phases.find((p) => p.name === 'specify');
    assert.ok(specifyPhase, 'feature fallback 应有 specify phase');
    assert.ok(Array.isArray(specifyPhase.gates_after));
    specifyPhase.gates_after.forEach((g) => {
      assert.equal(typeof g, 'string', `Gate 引用应为字符串，实际: ${typeof g}`);
    });
  });
});

// ═════════════════════════════════════════════════════════════
// 配置验证
// ═════════════════════════════════════════════════════════════

describe('Config Validation', () => {
  it('null 配置应报错', () => {
    const r = validateOrchestrationYaml(null);
    assert.equal(r.valid, false);
  });

  it('缺少 modes 应报错', () => {
    const r = validateOrchestrationYaml({ version: '1.0' });
    assert.equal(r.valid, false);
  });

  it('缺少 feature 模式应警告', () => {
    const r = validateOrchestrationYaml({
      version: '1.0',
      modes: { story: { phases: [{ id: '1', name: 'test' }] } },
      gates: {},
    });
    assert.ok(r.warnings.some((w) => w.includes('feature')));
  });

  it('合法配置应通过', () => {
    const r = validateOrchestrationYaml({
      version: '1.0',
      modes: { feature: { phases: [{ id: '1', name: 'test' }] } },
      gates: { GATE_DESIGN: { type: 'test' } },
    });
    assert.equal(r.valid, true);
  });
});

// ═════════════════════════════════════════════════════════════
// T-025：base Zod schema 回归 + preloadedConfig 断言
// ═════════════════════════════════════════════════════════════

describe('Base Zod Schema 回归（T-025）', () => {
  it('base orchestration.yaml 100% 通过 orchestrationBaseSchema', async () => {
    // 通过 Orchestrator 正常加载，若 Zod 校验失败则 isFallback=true
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger });
    assert.equal(orch.isFallback, false, 'base orchestration.yaml 应通过 Zod 校验，isFallback 应为 false');
    // 直接用 orchestrationBaseSchema 校验真实 config
    const result = orchestrationBaseSchema.safeParse(orch.config);
    assert.equal(result.success, true, '现有 config 应通过 orchestrationBaseSchema.safeParse');
  });

  it('Orchestrator with preloadedConfig skips file load', () => {
    // 构造最小合法 preloadedConfig（仅含 modes/gates 基础结构）
    const minConfig = {
      version: '99.0',
      parallel_scheduling: { max_concurrent_tasks: 1 },
      gates: {
        GATE_DESIGN: { default_behavior: 'always', severity: 'critical', hard_gate_modes: null, insertion_point: null },
        GATE_ANALYSIS: { default_behavior: 'always', severity: 'non_critical', hard_gate_modes: null, insertion_point: null },
        GATE_TASKS: { default_behavior: 'always', severity: 'non_critical', hard_gate_modes: null, insertion_point: null },
        GATE_IMPLEMENT_MID: { default_behavior: 'auto', severity: 'non_critical', hard_gate_modes: null, insertion_point: null },
        GATE_VERIFY: { default_behavior: 'always', severity: 'critical', hard_gate_modes: null, insertion_point: null },
        GATE_RESEARCH: { default_behavior: 'auto', severity: 'non_critical', hard_gate_modes: null, insertion_point: null },
      },
      parallel_groups: {},
      modes: {
        feature: { phases: [{ id: '1', name: 'test', display_name: 'Test', agent: null, agent_mode: 'single', gates_before: null, gates_after: null, conditional: null, skip_if_exists: null, is_critical: true }] },
        story: { phases: [] },
        implement: { phases: [] },
        fix: { phases: [] },
        resume: { phases: [] },
        sync: { phases: [] },
        doc: { phases: [] },
        refactor: { phases: [] },
      },
    };
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger }, { preloadedConfig: minConfig });
    // version 应来自 preloadedConfig（99.0），而非真实文件（1.0）
    assert.equal(orch.config.version, '99.0', 'preloadedConfig 应直接使用，不从文件加载');
    assert.equal(orch.isFallback, false, 'preloadedConfig 路径 isFallback 应为 false');
  });

  it('validateOrchestrationYaml 薄壳保留向后兼容行为（CL-016）', () => {
    // 薄壳：null 返回 invalid
    const r1 = validateOrchestrationYaml(null);
    assert.equal(r1.valid, false, 'null 输入应无效');

    // 薄壳：缺失 modes 应无效
    const r2 = validateOrchestrationYaml({ version: '1.0', gates: {} });
    assert.equal(r2.valid, false, '缺少 modes 应无效');

    // 薄壳：合法最小配置通过（不再做 phases/gates 深层校验，只检查 modes 存在性）
    const r3 = validateOrchestrationYaml({
      version: '1.0',
      modes: { feature: { phases: [] } },
      gates: { GATE_DESIGN: {} },
    });
    assert.equal(r3.valid, true, '含 modes 的合法配置应通过薄壳校验');
  });
});

// ═════════════════════════════════════════════════════════════
// Gate 挂载映射 buildGateMountingMap（FR-052 / FR-068 · Feature 277 T008）
//
// 既有缺陷：buildGateBehaviorMap 只遍历 config.gates、从不查 modes.<mode>.phases，
// 因此门被删掉挂载时 is_hard_gate 仍答 true——「配置上完好、执行上不存在」。
// mounted 是把「该 gate 在本 mode 的 effective phase 序列里是否真会被求值」
// 这一既有事实透出来，不引入任何新的编排语义。
// ═════════════════════════════════════════════════════════════

describe('Gate Mounting Map（FR-052 mounted 字段）', () => {
  it('feature：GATE_DESIGN / GATE_TASKS 均挂载（gates_before ∪ gates_after）', () => {
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger });
    assert.equal(orch.getGateMounting('GATE_DESIGN'), true, 'feature 的 phase 3.5/4 挂载 GATE_DESIGN');
    assert.equal(orch.getGateMounting('GATE_TASKS'), true, 'feature 的 phase 5.5/6 挂载 GATE_TASKS');
  });

  it('feature：未被任何 phase 挂载的 gate 为 false（GATE_IMPLEMENT_MID 仅 implement 用）', () => {
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger });
    assert.equal(orch.getGateMounting('GATE_IMPLEMENT_MID'), false);
  });

  it('resume：base 不挂载 GATE_DESIGN → mounted=false（既有编排事实，本卡不改）', () => {
    const orch = new Orchestrator({}, 'resume', { logger: silentLogger });
    assert.equal(orch.getGateMounting('GATE_DESIGN'), false, 'resume 的 phase 序列不挂载 GATE_DESIGN');
    assert.equal(orch.getGateMounting('GATE_TASKS'), true, 'resume 挂载 GATE_TASKS');
  });

  it('fix：base 只挂 GATE_DESIGN，GATE_TASKS 命中数为 0', () => {
    const orch = new Orchestrator({}, 'fix', { logger: silentLogger });
    assert.equal(orch.getGateMounting('GATE_DESIGN'), true);
    assert.equal(orch.getGateMounting('GATE_TASKS'), false);
  });

  it('取不到一律按 false（未知 gate id / 未知 mode，判不出⇒从严）', () => {
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger });
    assert.equal(orch.getGateMounting('GATE_NOT_EXIST'), false, '未知 gate id 应按 false');
    assert.equal(orch.getGateMounting(undefined), false, 'undefined gate id 应按 false');

    const bogus = new Orchestrator({}, 'no_such_mode', { logger: silentLogger });
    assert.equal(bogus.getGateMounting('GATE_DESIGN'), false, '未知 mode 应按 false');
  });

  it('gateMountingMap 覆盖 config.gates 的全部 gate（不是只有被挂载的那几个）', () => {
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger });
    const gateIds = Object.keys(orch.config.gates || {});
    assert.ok(gateIds.length > 0, 'base 应有 gate 定义');
    for (const gateId of gateIds) {
      assert.equal(
        typeof orch.gateMountingMap[gateId], 'boolean',
        `gateMountingMap 应含 ${gateId} 且为 boolean`,
      );
    }
  });

  // 裁定 A-② 第 1 层：fallback 情形下 this.config 就是 generateFallbackConfig() 的
  // 返回值，mounted 由同一段代码算出，无需额外覆盖代码。
  it('fallback 路径：mounted 仍可算出（裁定 A-② 第 1 层）', () => {
    const fallback = generateFallbackConfig();
    const orch = new Orchestrator({}, 'implement', { logger: silentLogger }, { preloadedConfig: fallback });
    assert.equal(orch.getGateMounting('GATE_TASKS'), true, 'fallback 的 implement 挂载 GATE_TASKS');
    // 已登记的既有缺口：fallback 的 implement 段不挂载 GATE_DESIGN，而 base 挂载它。
    // 本卡不补齐该挂载（属改变既有编排事实），此断言把该缺口钉成可见事实而非默认放行。
    assert.equal(
      orch.getGateMounting('GATE_DESIGN'), false,
      'fallback 的 implement 不挂载 GATE_DESIGN —— 已登记的既有缺口，机械保障仍缺席',
    );
  });
});

// ═════════════════════════════════════════════════════════════
// get-gate-behavior 输出面（FR-052 / FR-068 · Feature 277 T010）
//
// 新增 mounted（effective 侧）与 mounted_in_base（base 侧同一算法）。
// mounted_in_base 是裁定 A-③ 判据的另一半：缺它则按 FR-068 字面口径实现
// 会使 resume / fix 永久 BLOCKED（二者在 base 里就不挂载对应的门）。
// ═════════════════════════════════════════════════════════════

describe('get-gate-behavior 输出面（mounted / mounted_in_base）', () => {
  const CLI_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'orchestrator-cli.mjs',
  );

  /** 跑 CLI 并解析 JSON 输出 */
  function runGateBehavior(mode, gateId, extraArgs = []) {
    const r = spawnSync('node', [CLI_PATH, 'get-gate-behavior', mode, gateId, ...extraArgs], {
      encoding: 'utf-8',
      timeout: 30000,
    });
    assert.equal(r.status, 0, `CLI 应以 0 退出，stderr: ${r.stderr}`);
    return JSON.parse(r.stdout);
  }

  it('既有 8 个输出字段一个不少（向后兼容，不得因加字段而挤掉旧字段）', () => {
    const out = runGateBehavior('feature', 'GATE_DESIGN');
    for (const field of [
      'success', 'mode', 'gate_id', 'behavior', 'source', 'is_hard_gate', 'severity', 'description',
    ]) {
      assert.ok(field in out, `既有字段 ${field} 应仍在输出中`);
    }
    assert.equal(out.success, true);
    assert.equal(out.is_hard_gate, true, 'feature 下 GATE_DESIGN 仍是硬门禁');
  });

  it('新增 mounted 与 mounted_in_base 两字段（feature / GATE_DESIGN 均为 true）', () => {
    const out = runGateBehavior('feature', 'GATE_DESIGN');
    assert.equal(out.mounted, true, 'feature 的 phase 3.5/4 挂载 GATE_DESIGN');
    assert.equal(out.mounted_in_base, true, 'base 侧同一算法应同为 true');
  });

  it('resume / GATE_DESIGN：两字段同为 false —— 按 FR-068 字面口径实现会使 resume 永久 BLOCKED', () => {
    const out = runGateBehavior('resume', 'GATE_DESIGN');
    assert.equal(out.mounted, false);
    assert.equal(out.mounted_in_base, false);
    // 判据是 mounted_in_base === true ⇒ mounted === true；此处前件为假，蕴含式成立、不 BLOCKED
  });

  it('fix / GATE_TASKS：两字段同为 false（fix 段 GATE_TASKS 命中数 = 0）', () => {
    const out = runGateBehavior('fix', 'GATE_TASKS');
    assert.equal(out.mounted, false);
    assert.equal(out.mounted_in_base, false);
  });

  it('两字段类型必须是 boolean（不得是 undefined —— undefined 会让蕴含式判据空转）', () => {
    for (const [mode, gate] of [['story', 'GATE_TASKS'], ['implement', 'GATE_DESIGN'], ['feature', 'GATE_IMPLEMENT_MID']]) {
      const out = runGateBehavior(mode, gate);
      assert.equal(typeof out.mounted, 'boolean', `${mode}/${gate} 的 mounted 应为 boolean`);
      assert.equal(typeof out.mounted_in_base, 'boolean', `${mode}/${gate} 的 mounted_in_base 应为 boolean`);
    }
  });

  it('删门挂载的 override 下：mounted_in_base 仍为 true（base 侧不受 override 影响）', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-mounting-cli-'));
    try {
      fs.mkdirSync(path.join(tmpDir, '.specify'), { recursive: true });
      fs.copyFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)),
          'fixtures', 'orchestration', 'attack-feature-drops-gate-design.yaml'),
        path.join(tmpDir, '.specify', 'orchestration-overrides.yaml'),
      );
      const out = runGateBehavior('feature', 'GATE_DESIGN', ['--project-root', tmpDir]);
      // resolver 已拒绝该覆盖并回退 base，故 effective 侧也应重新挂上
      assert.equal(out.mounted_in_base, true, 'base 侧挂载不受 override 影响');
      assert.equal(out.mounted, true, '覆盖被拒 + 回退 base 后 effective 侧应重新挂载');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ═════════════════════════════════════════════════════════════
// mounted 的语义升级（Phase A 对抗修订 · α-C1 / α-C2 / α-C3）
//
// 修订前 mounted 是纯结构存在性（「gates_* 数组里有没有这个字符串」），
// 三类构造能在不删任何东西的情况下让门一次都不被求值而 mounted 仍答 true。
// 现在 mounted = 与 base 锚定且可达：同名同侧仍挂、无新增抑制条件、位序保持。
// ═════════════════════════════════════════════════════════════

describe('get-gate-behavior · mounting_violations 与 base 锚定语义', () => {
  const CLI = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'orchestrator-cli.mjs',
  );
  const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'orchestration');

  /** 跑 CLI，同时返回 stdout 解析结果与 stderr 原文 */
  function runCli(args) {
    const r = spawnSync('node', [CLI, ...args], { encoding: 'utf-8', timeout: 30000 });
    assert.equal(r.status, 0, `CLI 应以 0 退出，stderr: ${r.stderr}`);
    return { json: JSON.parse(r.stdout), stderr: r.stderr };
  }

  /** 建一个带指定 overrides fixture 的临时项目根 */
  function withOverrides(fixtureName, fn) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-mounting-adv-'));
    try {
      fs.mkdirSync(path.join(tmpDir, '.specify'), { recursive: true });
      fs.copyFileSync(path.join(FIXTURES, fixtureName), path.join(tmpDir, '.specify', 'orchestration-overrides.yaml'));
      return fn(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  it('新增 mounting_violations 字段，干净仓根下为空数组（不是 undefined）', () => {
    const { json } = runCli(['get-gate-behavior', 'feature', 'GATE_DESIGN']);
    assert.ok(Array.isArray(json.mounting_violations), 'mounting_violations 必须是数组');
    assert.deepEqual(json.mounting_violations, [], '无 overrides 时不应有违规');
  });

  for (const [label, fixture] of [
    ['α-C1 幽灵 conditional', 'attack-feature-ghost-conditional.yaml'],
    ['α-C2 幽灵 skip_if_exists', 'attack-feature-ghost-skip-if-exists.yaml'],
    ['α-C3 挂到序列末尾', 'attack-feature-mount-at-end.yaml'],
  ]) {
    it(`${label}：resolver 拒绝并回退 base ⇒ mounted 仍为 true（诚实值），BLOCKED 由 error 级 diagnostic 承担`, () => {
      withOverrides(fixture, (root) => {
        const { json, stderr } = runCli(['get-gate-behavior', 'feature', 'GATE_DESIGN', '--project-root', root]);
        // 覆盖被拒 + 整份回退 base ⇒ effective ≡ base ⇒ mounted: true 是诚实值而非 fail-open
        assert.equal(json.mounted, true, '回退 base 后 effective 侧重新挂上门');
        assert.equal(json.mounted_in_base, true);
        assert.deepEqual(json.mounting_violations, [], '回退后 effective ≡ base，无残留违规');
        // 三道防线里真正在这一步说话的是 diagnostics
        assert.match(stderr, /gate-mounting-lost/, `应在 stderr 报出 gate-mounting-lost；实际: ${stderr}`);

        const eff = runCli(['effective-orchestration', 'feature', '--format', 'json', '--project-root', root]);
        assert.equal(
          eff.json.diagnostics.filter(d => d.level === 'error' && d.code === 'orchestration-overrides.gate-mounting-lost').length,
          1,
          `FR-068 判据 2 必须在此触发；实际: ${JSON.stringify(eff.json.diagnostics)}`,
        );
      });
    });
  }

  it('非强制 mode（fix）上的幽灵门位：resolver 不拒 ⇒ mounted=false + mounted_in_base=true + 逐条 violations', () => {
    // 前提核实：base 的 fix 段确实挂载 GATE_DESIGN（否则本用例测的是空集）
    const baseFix = new Orchestrator({}, 'fix', { logger: silentLogger });
    assert.equal(baseFix.getGateMounting('GATE_DESIGN'), true);

    withOverrides('attack-fix-ghost-conditional.yaml', (root) => {
      const { json } = runCli(['get-gate-behavior', 'fix', 'GATE_DESIGN', '--project-root', root]);
      assert.equal(json.mounted_in_base, true, 'base 的 fix 挂载 GATE_DESIGN');
      assert.equal(json.mounted, false, '幽灵门位不构成可达挂载');
      assert.ok(json.mounting_violations.length > 0, '必须给出逐条违规明细');
      assert.ok(
        json.mounting_violations.every(v => ['missing-anchor', 'suppressor-added', 'order-broken'].includes(v.kind)),
        `未知 violation kind: ${JSON.stringify(json.mounting_violations)}`,
      );

      // fix 不在强制 mode 集内 ⇒ resolver 不拒 ⇒ 幽灵 phase 真的落进了 effective
      const eff = runCli(['effective-orchestration', 'fix', '--format', 'json', '--project-root', root]);
      assert.equal(
        eff.json.diagnostics.filter(d => d.level === 'error').length, 0,
        `fix 不在 FR-052 丙射程内，不应报 error；实际: ${JSON.stringify(eff.json.diagnostics)}`,
      );
      assert.ok(
        eff.json.config.modes.fix.phases.some(p => p.name === 'ghost_gate'),
        '幽灵 phase 应真实存在于 effective 配置中（否则本用例没测到东西）',
      );
    });
  });

  it('getGateMountingDetail 对未知 gate id 现场算，返回对象而非 undefined（undefined 会让蕴含式判据空转）', () => {
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger });
    const detail = orch.getGateMountingDetail('GATE_NOT_EXIST');
    assert.equal(typeof detail, 'object');
    assert.equal(detail.mountedInBase, false);
    assert.equal(detail.mounted, false);
    assert.deepEqual(detail.violations, []);
  });

  it('baseConfig 不传时自锚定为 this.config —— 无覆盖场景恒无违规（向后兼容）', () => {
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger });
    assert.equal(orch.baseConfig, orch.config, '未注入 baseConfig 时应退回 this.config');
    for (const gateId of ['GATE_DESIGN', 'GATE_TASKS']) {
      assert.deepEqual(orch.getGateMountingDetail(gateId).violations, []);
      assert.equal(orch.getGateMounting(gateId), true);
    }
  });
});
