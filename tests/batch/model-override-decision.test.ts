/**
 * decideModelOverride 单元测试（Fix 134）
 *
 * 验证三种触发条件（任一为真即 override）的决策矩阵：
 * - isSmallModule
 * - budgetCheaperModelAll
 * - effectiveMode !== 'full'（reading / code-only）
 *
 * 重点验证 reading/code-only 强制 override（Fix 134 P0-3 — SC-001 < 120s 硬指标）。
 */
import { describe, it, expect } from 'vitest';
import {
  decideModelOverride,
  type ModelOverrideDecisionInput,
} from '../../src/batch/model-override-decision.js';

const SONNET_ID = 'claude-sonnet-4-6';

function input(overrides: Partial<ModelOverrideDecisionInput>): ModelOverrideDecisionInput {
  return {
    isSmallModule: false,
    budgetCheaperModelAll: false,
    effectiveMode: 'full',
    sonnetModelId: SONNET_ID,
    ...overrides,
  };
}

describe('decideModelOverride - Fix 134 P0-3 reading 模式 model override', () => {
  describe('Fix 134 核心：reading / code-only 模式强制 sonnet override', () => {
    it('reading 模式 → 返回 sonnetModelId（即使非小模块且无 budget 降级）', () => {
      const result = decideModelOverride(input({ effectiveMode: 'reading' }));
      expect(result).toBe(SONNET_ID);
    });

    it('code-only 模式 → 返回 sonnetModelId', () => {
      const result = decideModelOverride(input({ effectiveMode: 'code-only' }));
      expect(result).toBe(SONNET_ID);
    });
  });

  describe('full 模式：仅在 small-module 或 budget 降级时 override', () => {
    it('full 模式 + 非小模块 + 无 budget 降级 → undefined（沿用默认 model）', () => {
      const result = decideModelOverride(input({ effectiveMode: 'full' }));
      expect(result).toBeUndefined();
    });

    it('full 模式 + 小模块 → 返回 sonnetModelId（小模块优化）', () => {
      const result = decideModelOverride(
        input({ effectiveMode: 'full', isSmallModule: true }),
      );
      expect(result).toBe(SONNET_ID);
    });

    it('full 模式 + budget gate 降级 → 返回 sonnetModelId', () => {
      const result = decideModelOverride(
        input({ effectiveMode: 'full', budgetCheaperModelAll: true }),
      );
      expect(result).toBe(SONNET_ID);
    });
  });

  describe('多条件叠加：任一为真即 override', () => {
    it('reading 模式 + 小模块 + budget 降级 → 返回 sonnetModelId', () => {
      const result = decideModelOverride(
        input({
          effectiveMode: 'reading',
          isSmallModule: true,
          budgetCheaperModelAll: true,
        }),
      );
      expect(result).toBe(SONNET_ID);
    });

    it('code-only 模式 + budget 降级 → 返回 sonnetModelId', () => {
      const result = decideModelOverride(
        input({ effectiveMode: 'code-only', budgetCheaperModelAll: true }),
      );
      expect(result).toBe(SONNET_ID);
    });
  });

  describe('sonnetModelId 透传', () => {
    it('override 时返回的是输入的 sonnetModelId（不硬编码模型名）', () => {
      const customId = 'claude-any-model-test-id';
      const result = decideModelOverride(
        input({ effectiveMode: 'reading', sonnetModelId: customId }),
      );
      expect(result).toBe(customId);
    });
  });
});
