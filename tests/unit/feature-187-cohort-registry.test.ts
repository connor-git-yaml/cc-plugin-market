/**
 * Feature 187 — 声明式 cohort registry 单测（spec FR-004 / SC-007/008/013）。
 *
 * 验证：① 派生 COHORT_IDS/COHORT_TO_TOOL 正确；② 未注册 cohort → throw（不静默对照组）；
 * ③ 竞品 cohort golden：registry.promptBuilder 输出与直接 buildDriverPrompt 逐字一致（方法论零改动）。
 */
import { describe, expect, it } from 'vitest';
import {
  REGISTRY, COHORT_IDS, COHORT_TO_TOOL, resolveCohort, getPromptBuilder,
} from '../../scripts/lib/cohort-registry.mjs';
import { buildDriverPrompt } from '../../scripts/eval-task-runner.mjs';

describe('cohort-registry 派生（FR-004-b：单一来源）', () => {
  it('COHORT_IDS = 5 个 cohort', () => {
    expect(COHORT_IDS).toEqual(['baseline-claude', 'spec-driver', 'spec-driver-spectra-mcp', 'SuperPowers', 'GStack']);
  });

  it('COHORT_TO_TOOL 从 registry 派生且映射正确', () => {
    expect(COHORT_TO_TOOL).toEqual({
      'baseline-claude': 'control',
      'spec-driver': 'spec-driver',
      'spec-driver-spectra-mcp': 'spec-driver-spectra-mcp',
      'SuperPowers': 'superpowers',
      'GStack': 'gstack',
    });
  });

  it('每个 cohort 都声明完整字段（id/tool/promptBuilder/claudeArgsProfile/prepSteps/stdinPolicy）', () => {
    for (const c of REGISTRY) {
      expect(c.id, 'id').toBeTruthy();
      expect(c.tool, `${c.id}.tool`).toBeTruthy();
      expect(typeof c.promptBuilder, `${c.id}.promptBuilder`).toBe('function');
      expect(c.claudeArgsProfile, `${c.id}.claudeArgsProfile`).toBeTruthy();
      expect(Array.isArray(c.prepSteps), `${c.id}.prepSteps`).toBe(true);
      expect(c.stdinPolicy, `${c.id}.stdinPolicy`).toBeTruthy();
    }
  });
});

describe('resolveCohort / getPromptBuilder 漏接 → throw（FR-004-a / SC-007）', () => {
  it('未注册 cohort → throw 含 cohort id', () => {
    expect(() => resolveCohort('totally-new-cohort')).toThrow(/totally-new-cohort/);
    expect(() => getPromptBuilder('totally-new-cohort')).toThrow(/totally-new-cohort/);
  });

  it('已注册 cohort → 返回声明', () => {
    expect(resolveCohort('spec-driver').tool).toBe('spec-driver');
  });
});

describe('竞品 cohort golden — promptBuilder 与 buildDriverPrompt 逐字一致（SC-013 回归护栏）', () => {
  const taskPrompt = '修复 foo.py 的空指针并补测试';
  const spectraContext = '## ctx\nmodule foo';
  for (const c of REGISTRY) {
    it(`${c.id}（tool=${c.tool}）promptBuilder 输出 == buildDriverPrompt`, () => {
      for (const skillInvocation of [false, true]) {
        const fromRegistry = c.promptBuilder({ taskPrompt, spectraContext, skillInvocation });
        const direct = buildDriverPrompt({ tool: c.tool, taskPrompt, spectraContext, skillInvocation });
        expect(fromRegistry).toBe(direct);
      }
    });
  }
});
