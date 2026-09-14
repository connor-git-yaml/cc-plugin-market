/**
 * M11 卡 A（P1-I）— calls 边解析标签词表。
 *
 * 词表是 contracts/mcp-return-surface-contract.yaml 的 TS 侧事实源：
 * 每个 strategy 必须映射到合法 stage / basis；占位与通配类一律 heuristic。
 */
import { describe, expect, it } from 'vitest';
import {
  CALL_EDGE_BASES,
  CALL_EDGE_STAGES,
  CALL_EDGE_STRATEGIES,
  CALL_SITES_CAP,
  resolutionFor,
} from '../../../src/knowledge-graph/call-resolution-labels.js';

describe('call-resolution-labels 词表', () => {
  it('每个 strategy 都映射到合法 stage 与 basis', () => {
    const strategies = Object.keys(CALL_EDGE_STRATEGIES);
    expect(strategies.length).toBe(14);
    for (const s of strategies) {
      const m = CALL_EDGE_STRATEGIES[s as keyof typeof CALL_EDGE_STRATEGIES];
      expect(CALL_EDGE_STAGES).toContain(m.stage);
      expect(CALL_EDGE_BASES).toContain(m.basis);
    }
  });

  it('占位（*-placeholder）与通配（star-import）一律 heuristic，其余 index', () => {
    for (const [s, m] of Object.entries(CALL_EDGE_STRATEGIES)) {
      const expectHeuristic = s.endsWith('-placeholder') || s === 'star-import';
      expect(m.basis, s).toBe(expectHeuristic ? 'heuristic' : 'index');
    }
  });

  it('resolutionFor 展开为 { stage, strategy, basis } 三元组', () => {
    expect(resolutionFor('export-table')).toEqual({ stage: 'local-export', strategy: 'export-table', basis: 'index' });
    expect(resolutionFor('star-import')).toEqual({ stage: 'cross-module', strategy: 'star-import', basis: 'heuristic' });
    expect(resolutionFor('unresolved-placeholder')).toEqual({ stage: 'fallback', strategy: 'unresolved-placeholder', basis: 'heuristic' });
  });

  it('常量冻结（词表不可在运行时被改写）', () => {
    expect(Object.isFrozen(CALL_EDGE_STRATEGIES)).toBe(true);
    expect(Object.isFrozen(CALL_EDGE_STAGES)).toBe(true);
    expect(Object.isFrozen(CALL_EDGE_BASES)).toBe(true);
    expect(CALL_SITES_CAP).toBe(20);
  });
});
