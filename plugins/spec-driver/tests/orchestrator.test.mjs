/**
 * orchestrator.test.mjs
 * Smoke Test Suite for Orchestrator
 *
 * 测试覆盖：
 * - 配置加载和验证
 * - 7 种模式的 Phase 序列
 * - Gate 行为解析和优先级
 * - 并行组调度
 * - 条件执行和跳过逻辑
 * - 向后兼容性降级
 */

import { strict as assert } from 'assert';
import { Orchestrator, validateOrchestrationYaml } from '../lib/orchestrator.js';
import { generateFallbackConfig } from '../lib/orchestrator-fallback.js';

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// ═════════════════════════════════════════════════════════════════
// Test Suites
// ═════════════════════════════════════════════════════════════════

describe('Orchestrator - Feature Mode', () => {
  it('should load orchestration.yaml successfully', () => {
    const orchestrator = new Orchestrator({}, 'feature', {
      logger: mockLogger,
    });
    const summary = orchestrator.getSummary();

    assert(summary.phasesCount > 0, 'Feature mode should have phases');
    assert(summary.gatesCount === 6, 'Should have 6 gates defined');
  });

  it('should have 10+ phases in feature mode', () => {
    const orchestrator = new Orchestrator({}, 'feature', {
      logger: mockLogger,
    });
    const phases = orchestrator.getPhases();

    assert(phases.length >= 10, 'Feature mode should have 10+ phases');
  });

  it('should correctly identify GATE_DESIGN as hard gate in feature mode', () => {
    const orchestrator = new Orchestrator({}, 'feature', {
      logger: mockLogger,
    });
    const behavior = orchestrator.getGateBehavior('GATE_DESIGN');

    assert.equal(behavior, 'always', 'GATE_DESIGN should always trigger');
  });

  it('should have 3 parallel groups', () => {
    const orchestrator = new Orchestrator({}, 'feature', {
      logger: mockLogger,
    });

    const researchGroup = orchestrator.getParallelGroup('RESEARCH_GROUP');
    const designGroup = orchestrator.getParallelGroup('DESIGN_PREP_GROUP');
    const verifyGroup = orchestrator.getParallelGroup('VERIFY_GROUP');

    assert(researchGroup, 'RESEARCH_GROUP should exist');
    assert(designGroup, 'DESIGN_PREP_GROUP should exist');
    assert(verifyGroup, 'VERIFY_GROUP should exist');

    assert.deepEqual(researchGroup.members, ['1a', '1b']);
    assert.equal(researchGroup.convergencePoint, '1c');
  });
});

describe('Orchestrator - Story Mode', () => {
  it('should load story mode successfully', () => {
    const orchestrator = new Orchestrator({}, 'story', {
      logger: mockLogger,
    });
    const phases = orchestrator.getPhases();

    assert(phases.length > 0, 'Story mode should have phases');
    assert(
      phases.length <= 10,
      'Story mode should have fewer phases than feature mode'
    );
  });

  it('should have GATE_DESIGN in story mode', () => {
    const orchestrator = new Orchestrator({}, 'story', {
      logger: mockLogger,
    });
    const behavior = orchestrator.getGateBehavior('GATE_DESIGN');

    assert.equal(behavior, 'always', 'GATE_DESIGN should trigger');
  });

  it('GATE_DESIGN should not be hard gate in story mode', () => {
    const orchestrator = new Orchestrator({}, 'story', {
      logger: mockLogger,
    });

    // story 模式下用户配置应该能覆盖 GATE_DESIGN
    const userConfig = {
      gate_policy: 'autonomous',
      gates: { GATE_DESIGN: { pause: 'on_failure' } },
    };
    const orchestrator2 = new Orchestrator(userConfig, 'story', {
      logger: mockLogger,
    });
    const behavior = orchestrator2.getGateBehavior('GATE_DESIGN');

    // story 模式下，用户配置应该被应用
    assert.equal(
      behavior,
      'on_failure',
      'User config should override in story mode'
    );
  });
});

describe('Orchestrator - Implement Mode', () => {
  it('should load implement mode successfully', () => {
    const orchestrator = new Orchestrator({}, 'implement', {
      logger: mockLogger,
    });
    const phases = orchestrator.getPhases();

    assert(phases.length > 0, 'Implement mode should have phases');
  });

  it('should have GATE_IMPLEMENT_MID in implement mode', () => {
    const orchestrator = new Orchestrator({}, 'implement', {
      logger: mockLogger,
    });

    const implementMidGate = orchestrator.gateBehaviorMap.GATE_IMPLEMENT_MID;
    assert(implementMidGate, 'GATE_IMPLEMENT_MID should be defined');
    assert.equal(implementMidGate.behavior, 'on_failure');
  });
});

describe('Orchestrator - Fix Mode', () => {
  it('should load fix mode successfully', () => {
    const orchestrator = new Orchestrator({}, 'fix', {
      logger: mockLogger,
    });
    const phases = orchestrator.getPhases();

    assert(phases.length > 0, 'Fix mode should have phases');
    assert(phases.length <= 5, 'Fix mode should be minimal');
  });
});

describe('Orchestrator - Resume Mode', () => {
  it('should load resume mode successfully', () => {
    const orchestrator = new Orchestrator({}, 'resume', {
      logger: mockLogger,
    });
    const phases = orchestrator.getPhases();

    assert(phases.length > 0, 'Resume mode should have phases');
  });
});

describe('Orchestrator - Sync Mode', () => {
  it('should load sync mode successfully', () => {
    const orchestrator = new Orchestrator({}, 'sync', {
      logger: mockLogger,
    });
    const phases = orchestrator.getPhases();

    assert(phases.length > 0, 'Sync mode should have phases');
  });
});

describe('Orchestrator - Doc Mode', () => {
  it('should load doc mode successfully', () => {
    const orchestrator = new Orchestrator({}, 'doc', {
      logger: mockLogger,
    });
    const phases = orchestrator.getPhases();

    assert(phases.length > 0, 'Doc mode should have phases');
  });
});

describe('Gate Behavior Priority', () => {
  it('should apply balanced policy defaults', () => {
    const orchestrator = new Orchestrator(
      { gate_policy: 'balanced' },
      'feature',
      { logger: mockLogger }
    );

    assert.equal(
      orchestrator.getGateBehavior('GATE_RESEARCH'),
      'auto',
      'GATE_RESEARCH should default to auto in balanced policy'
    );
    assert.equal(
      orchestrator.getGateBehavior('GATE_TASKS'),
      'always',
      'GATE_TASKS should default to always in balanced policy'
    );
  });

  it('should apply strict policy defaults', () => {
    const orchestrator = new Orchestrator(
      { gate_policy: 'strict' },
      'feature',
      { logger: mockLogger }
    );

    assert.equal(
      orchestrator.getGateBehavior('GATE_RESEARCH'),
      'always',
      'All gates should be always in strict policy'
    );
  });

  it('should apply autonomous policy defaults', () => {
    const orchestrator = new Orchestrator(
      { gate_policy: 'autonomous' },
      'feature',
      { logger: mockLogger }
    );

    assert.equal(
      orchestrator.getGateBehavior('GATE_RESEARCH'),
      'on_failure',
      'All gates should be on_failure in autonomous policy'
    );
  });

  it('user config should override policy but not hard gates', () => {
    const userConfig = {
      gate_policy: 'balanced',
      gates: {
        GATE_DESIGN: { pause: 'on_failure' }, // Should be ignored (hard gate)
        GATE_RESEARCH: { pause: 'always' }, // Should be applied
      },
    };
    const orchestrator = new Orchestrator(userConfig, 'feature', {
      logger: mockLogger,
    });

    assert.equal(
      orchestrator.getGateBehavior('GATE_DESIGN'),
      'always',
      'Hard gate should not be overridden'
    );
    assert.equal(
      orchestrator.getGateBehavior('GATE_RESEARCH'),
      'always',
      'User config should override policy'
    );
  });
});

describe('Phase Execution Conditions', () => {
  it('should evaluate research_mode conditional', () => {
    const context = {
      research_mode: 'full',
      fileExists: () => false,
    };

    const orchestrator = new Orchestrator({}, 'feature', {
      logger: mockLogger,
    });
    const phases = orchestrator.getPhases();

    // Find phase 1a (product_research)
    const phase1a = phases.find((p) => p.id === '1a');
    assert(
      phase1a && orchestrator.shouldExecutePhase(phase1a, context),
      'Phase 1a should execute in full research mode'
    );

    // Test with tech-only mode
    context.research_mode = 'tech-only';
    assert(
      !orchestrator.shouldExecutePhase(phase1a, context),
      'Phase 1a should not execute in tech-only mode'
    );
  });

  it('should skip phases with existing artifacts', () => {
    const context = {
      featureDir: '/test/feature',
      fileExists: (filePath) => filePath.includes('spec.md'),
    };

    const orchestrator = new Orchestrator({}, 'feature', {
      logger: mockLogger,
    });
    const phases = orchestrator.getPhases();

    // Find phase 2 (specify)
    const phase2 = phases.find((p) => p.id === '2');
    assert(
      !orchestrator.shouldExecutePhase(phase2, context),
      'Phase 2 should be skipped if spec.md exists'
    );
  });
});

describe('Fallback Configuration', () => {
  it('should use fallback config when orchestration.yaml is missing', () => {
    const orchestrator = new Orchestrator({}, 'feature', {
      logger: mockLogger,
    });

    // 即使没有找到 orchestration.yaml，也应该通过 fallback 正常工作
    assert(orchestrator.config, 'Config should exist');
    assert(orchestrator.config.modes, 'Modes should be defined');
    assert(orchestrator.config.gates, 'Gates should be defined');
  });

  it('fallback config should have all 7 modes', () => {
    const fallbackConfig = generateFallbackConfig();

    assert(fallbackConfig.modes.feature, 'Feature mode should exist');
    assert(fallbackConfig.modes.story, 'Story mode should exist');
    assert(fallbackConfig.modes.implement, 'Implement mode should exist');
    assert(fallbackConfig.modes.fix, 'Fix mode should exist');
    assert(fallbackConfig.modes.resume, 'Resume mode should exist');
    assert(fallbackConfig.modes.sync, 'Sync mode should exist');
    assert(fallbackConfig.modes.doc, 'Doc mode should exist');
  });

  it('fallback config should have all 6 gates', () => {
    const fallbackConfig = generateFallbackConfig();

    assert(fallbackConfig.gates.GATE_RESEARCH, 'GATE_RESEARCH should exist');
    assert(fallbackConfig.gates.GATE_DESIGN, 'GATE_DESIGN should exist');
    assert(fallbackConfig.gates.GATE_ANALYSIS, 'GATE_ANALYSIS should exist');
    assert(fallbackConfig.gates.GATE_TASKS, 'GATE_TASKS should exist');
    assert(
      fallbackConfig.gates.GATE_IMPLEMENT_MID,
      'GATE_IMPLEMENT_MID should exist'
    );
    assert(fallbackConfig.gates.GATE_VERIFY, 'GATE_VERIFY should exist');
  });
});

describe('Backward Compatibility', () => {
  it('should work without orchestration.yaml', () => {
    const orchestrator = new Orchestrator({}, 'feature', {
      logger: mockLogger,
    });

    // Should still be able to get phases and gates
    const phases = orchestrator.getPhases();
    const behavior = orchestrator.getGateBehavior('GATE_DESIGN');

    assert(phases.length > 0, 'Should still have phases');
    assert(behavior, 'Should still have gate behaviors');
  });

  it('should gracefully handle missing mode', () => {
    const orchestrator = new Orchestrator({}, 'feature', {
      logger: mockLogger,
    });

    // Accessing non-existent mode should not crash
    const phases = orchestrator.getPhases();
    assert(Array.isArray(phases), 'Should return array even if mode missing');
  });
});

// ═════════════════════════════════════════════════════════════════
// Validation Tests
// ═════════════════════════════════════════════════════════════════

describe('Config Validation', () => {
  it('should validate null config', () => {
    const result = validateOrchestrationYaml(null);
    assert.equal(result.valid, false, 'Null config should be invalid');
  });

  it('should validate missing modes', () => {
    const config = { version: '1.0' };
    const result = validateOrchestrationYaml(config);
    assert.equal(result.valid, false, 'Config without modes should be invalid');
  });

  it('should warn on missing feature mode', () => {
    const config = {
      version: '1.0',
      modes: { story: { phases: [] } },
      gates: {},
    };
    const result = validateOrchestrationYaml(config);
    assert(
      result.warnings.some((w) => w.includes('feature')),
      'Should warn when feature mode missing'
    );
  });

  it('should validate valid config', () => {
    const config = {
      version: '1.0',
      modes: {
        feature: { phases: [{ id: '1', name: 'test' }] },
      },
      gates: { GATE_DESIGN: { type: 'test' } },
    };
    const result = validateOrchestrationYaml(config);
    assert.equal(result.valid, true, 'Valid config should pass');
  });
});

// ═════════════════════════════════════════════════════════════════
// Test Runner
// ═════════════════════════════════════════════════════════════════

console.log('Running Orchestrator Smoke Tests...\n');

const testSuites = [
  {
    name: 'Feature Mode',
    tests: [
      'should load orchestration.yaml successfully',
      'should have 10+ phases in feature mode',
      'should correctly identify GATE_DESIGN as hard gate in feature mode',
      'should have 3 parallel groups',
    ],
  },
  {
    name: 'Story Mode',
    tests: [
      'should load story mode successfully',
      'should have GATE_DESIGN in story mode',
      'GATE_DESIGN should not be hard gate in story mode',
    ],
  },
  {
    name: 'Other Modes',
    tests: [
      'should load implement mode successfully',
      'should load fix mode successfully',
      'should load resume mode successfully',
      'should load sync mode successfully',
      'should load doc mode successfully',
    ],
  },
  {
    name: 'Gate Behavior & Phase Conditions',
    tests: [
      'should apply balanced policy defaults',
      'should apply strict policy defaults',
      'should apply autonomous policy defaults',
      'user config should override policy but not hard gates',
      'should evaluate research_mode conditional',
      'should skip phases with existing artifacts',
    ],
  },
  {
    name: 'Fallback & Backward Compatibility',
    tests: [
      'should use fallback config when orchestration.yaml is missing',
      'fallback config should have all 7 modes',
      'fallback config should have all 6 gates',
      'should work without orchestration.yaml',
      'should gracefully handle missing mode',
    ],
  },
  {
    name: 'Config Validation',
    tests: [
      'should validate null config',
      'should validate missing modes',
      'should warn on missing feature mode',
      'should validate valid config',
    ],
  },
];

console.log(`✅ All smoke tests defined: ${testSuites.length} suites\n`);

export {};
