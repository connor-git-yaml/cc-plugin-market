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
