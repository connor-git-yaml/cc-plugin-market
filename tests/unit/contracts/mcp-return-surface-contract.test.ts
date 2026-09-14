/**
 * M11 卡 A（P1-I）— contracts/mcp-return-surface-contract.yaml 与 TS 词表机械对拍。
 *
 * 合同 YAML 是消费方可读的事实源，TS 常量是运行时事实源；两处不得各列一套。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseYamlDocument } from '../../../plugins/spec-driver/scripts/lib/simple-yaml.mjs';
import {
  CALL_EDGE_BASES,
  CALL_EDGE_STAGES,
  CALL_EDGE_STRATEGIES,
  CALL_SITES_CAP,
} from '../../../src/knowledge-graph/call-resolution-labels.js';
import { PAYLOAD_CAP_BYTES } from '../../../src/mcp/lib/tool-response.js';

const CONTRACT_PATH = resolve('contracts/mcp-return-surface-contract.yaml');

interface Contract {
  schemaVersion: number;
  vocabulary: Record<string, { type: string; enum?: string[]; carriedBy: string[] }>;
  callEdgeResolution: {
    fieldName: string;
    stages: string[];
    bases: string[];
    strategies: Record<string, { stage: string; basis: string; tier: string }>;
  };
  callSites: { fieldName: string; countField: string; cap: number };
  tokenBudget: { fieldName: string; fields: Record<string, string>; carriedBy: string[] };
  determinism: { toolsListOrder: string[]; guarantees: string[] };
  breakingChanges: Array<{ from: string; to: string }>;
}

function loadContract(): Contract {
  return parseYamlDocument(readFileSync(CONTRACT_PATH, 'utf-8')) as unknown as Contract;
}

describe('mcp-return-surface-contract.yaml ↔ TS 词表', () => {
  it('stages / bases / strategies 与 call-resolution-labels.ts 逐项相等', () => {
    const c = loadContract();
    expect(c.schemaVersion).toBe(1);
    expect(c.callEdgeResolution.fieldName).toBe('resolution');
    expect(c.callEdgeResolution.stages).toEqual([...CALL_EDGE_STAGES]);
    expect(c.callEdgeResolution.bases).toEqual([...CALL_EDGE_BASES]);
    expect(Object.keys(c.callEdgeResolution.strategies)).toEqual(Object.keys(CALL_EDGE_STRATEGIES));
    for (const [name, m] of Object.entries(CALL_EDGE_STRATEGIES)) {
      expect(c.callEdgeResolution.strategies[name]?.stage, name).toBe(m.stage);
      expect(c.callEdgeResolution.strategies[name]?.basis, name).toBe(m.basis);
    }
  });

  it('callSites cap / tokenBudget cap 与运行时常量一致', () => {
    const c = loadContract();
    expect(c.callSites.fieldName).toBe('callSites');
    expect(c.callSites.countField).toBe('callSiteCount');
    expect(Number(c.callSites.cap)).toBe(CALL_SITES_CAP);
    expect(c.tokenBudget.fieldName).toBe('tokenBudget');
    expect(Object.keys(c.tokenBudget.fields)).toEqual(['payloadBytes', 'capBytes', 'estimatedTokens', 'truncated', 'truncatedKeys']);
    expect(c.tokenBudget.fields['capBytes']).toContain(String(PAYLOAD_CAP_BYTES));
  });

  it('toolsListOrder 18 个工具无重复；tokenBudget.carriedBy ⊆ toolsListOrder', () => {
    const c = loadContract();
    const order = c.determinism.toolsListOrder;
    expect(order.length).toBe(18);
    expect(new Set(order).size).toBe(18);
    for (const t of c.tokenBudget.carriedBy) expect(order, t).toContain(t);
    expect(c.tokenBudget.carriedBy.length).toBe(12);
  });

  it('confidence 三词表各自 carriedBy 非空；breakingChanges 登记三处改名', () => {
    const c = loadContract();
    for (const key of ['confidence', 'confidenceLabel', 'matchScore']) {
      expect(c.vocabulary[key]?.carriedBy.length, key).toBeGreaterThan(0);
    }
    expect(c.vocabulary['confidenceLabel']?.enum).toEqual(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']);
    expect(c.breakingChanges.map((b) => `${b.from}→${b.to}`)).toEqual([
      'fuzzyMatches[].confidence→fuzzyMatches[].matchScore',
      'resolvedConfidence→resolvedMatchScore',
      'context.definition.confidence→context.definition.confidenceLabel',
    ]);
  });
});
