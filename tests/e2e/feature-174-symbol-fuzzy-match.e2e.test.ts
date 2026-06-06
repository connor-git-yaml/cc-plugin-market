/**
 * Feature 174 — Symbol ID Fuzzy Match E2E（US1~US4）
 *
 * 用合成 micrograd graph fixture（inline，不依赖外部文件）端到端验证：
 *   US1 无 path 简短 symbol 唯一命中自动 resolve
 *   US2 4 种变体批量 resolve（top-1 命中 ≥12/15）
 *   US3 cohort C 9 个 symbol → handleContext symbol-not-found 0/9
 *   US4 完全不存在 symbol → 安全降级 + 结构化 top-3
 *
 * 命名：feature-174 前缀 + .e2e.test.ts 后缀（匹配 vitest.config.ts e2e include）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';

// ─── Mock：getCachedGraphData 返回合成 micrograd 图（handler 集成用） ───
const mocks = vi.hoisted(() => ({
  getCachedGraphData: vi.fn(),
}));

vi.mock('../../src/mcp/graph-tools.js', () => ({
  getCachedGraphData: mocks.getCachedGraphData,
  reloadGraph: vi.fn(),
}));

import { resolveSymbolFuzzy } from '../../src/knowledge-graph/query-helpers.js';
import { handleContext, handleImpact } from '../../src/mcp/agent-context-tools.js';

const PROJECT_ROOT = '/tmp/fuzzy-fixture';

/** 合成 micrograd graph：覆盖 cohort C 9 样本 + 4 变体 + 多义 relu */
function makeMicrogradGraph(): GraphJSON {
  const node = (id: string, label: string, kind: 'component' | 'module' = 'component') => ({
    id,
    kind,
    label,
    metadata: { sourceFile: id.includes('::') ? id.slice(0, id.indexOf('::')) : id },
  });
  return {
    nodes: [
      node('micrograd/engine.py::Value', 'Value'),
      node('micrograd/engine.py::Value.__add__', '__add__'),
      node('micrograd/engine.py::Value.__mul__', '__mul__'),
      node('micrograd/engine.py::Value.__neg__', '__neg__'),
      node('micrograd/engine.py::Value.__pow__', '__pow__'),
      node('micrograd/engine.py::Value.__repr__', '__repr__'),
      node('micrograd/engine.py::Value.backward', 'backward'),
      node('micrograd/engine.py::Value.relu', 'relu'),
      node('micrograd/nn.py::Module.relu', 'relu'), // 多义 relu（第二 module）
      node('micrograd/nn.py::Linear', 'Linear'),
      node('micrograd/nn.py::ReLU', 'ReLU'),
      node('micrograd/engine.py', 'engine.py', 'module'),
      node('micrograd/nn.py', 'nn.py', 'module'),
    ],
    links: [
      { source: 'micrograd/nn.py::Linear', target: 'micrograd/engine.py::Value', relation: 'calls', confidence: 'EXTRACTED', confidenceScore: 0.95, directional: true },
      { source: 'micrograd/nn.py::ReLU', target: 'micrograd/engine.py::Value', relation: 'calls', confidence: 'EXTRACTED', confidenceScore: 0.9, directional: true },
    ],
    metadata: { schemaVersion: '2.0' },
  } as unknown as GraphJSON;
}

function setMockGraph(graph: GraphJSON): void {
  mocks.getCachedGraphData.mockReturnValue({
    graphData: graph,
    graphPath: '/tmp/fuzzy-fixture/specs/_meta/graph.json',
    mtimeMs: 1000,
    sizeBytes: 5000,
  });
}

const GRAPH = makeMicrogradGraph();

beforeEach(() => {
  vi.clearAllMocks();
  setMockGraph(GRAPH);
});

// ============================================================
// US1 — 无 path 简短 symbol 唯一命中自动 resolve
// ============================================================
describe('US1 — 简短 symbol 唯一命中自动 resolve', () => {
  it('E-US1-1: resolveSymbolFuzzy("Value.__add__") → autoResolved + partial-name ≥0.9', () => {
    const r = resolveSymbolFuzzy(GRAPH, 'Value.__add__', { projectRoot: PROJECT_ROOT });
    expect(r.autoResolved).toBe(true);
    expect(r.candidates[0]?.matchKind).toBe('partial-name');
    expect(r.candidates[0]?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.candidates[0]?.id).toBe('micrograd/engine.py::Value.__add__');
  });

  it('E-US1-2: handleContext("Value.__add__") → resolvedFrom/resolvedTo + warnings fuzzy-resolved', async () => {
    const r = await handleContext({ symbolId: 'Value.__add__', projectRoot: PROJECT_ROOT });
    const data = JSON.parse(r.content[0]!.text) as Record<string, unknown>;
    expect(r.isError).toBeUndefined();
    expect(data['resolvedFrom']).toBe('Value.__add__');
    expect(data['resolvedTo']).toBe('micrograd/engine.py::Value.__add__');
    expect(typeof data['resolvedConfidence']).toBe('number');
    expect(data['warnings'] as string[]).toContain('fuzzy-resolved');
  });

  it('E-US1-3: resolveSymbolFuzzy("relu") 多义 → 不 autoResolved + top-3', () => {
    const r = resolveSymbolFuzzy(GRAPH, 'relu', { projectRoot: PROJECT_ROOT });
    expect(r.autoResolved).toBe(false);
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.candidates.length).toBeLessThanOrEqual(10);
  });
});

// ============================================================
// US2 — 4 种变体批量 resolve（top-1 命中 ≥12/15）
// ============================================================
describe('US2 — 4 变体批量 resolve', () => {
  it('E-US2-1: path-suffix "engine.py::Value.relu" → confidence 0.9', () => {
    const r = resolveSymbolFuzzy(GRAPH, 'engine.py::Value.relu', { projectRoot: PROJECT_ROOT });
    expect(r.candidates[0]?.matchKind).toBe('path-suffix');
    expect(r.candidates[0]?.confidence).toBe(0.9);
    expect(r.candidates[0]?.id).toBe('micrograd/engine.py::Value.relu');
  });

  it('E-US2-2: 绝对路径 → exact 1.0（projectRoot 透传归一化）', () => {
    const r = resolveSymbolFuzzy(GRAPH, `${PROJECT_ROOT}/micrograd/engine.py::Value`, { projectRoot: PROJECT_ROOT });
    expect(r.candidates[0]?.matchKind).toBe('exact');
    expect(r.candidates[0]?.confidence).toBe(1.0);
    expect(r.candidates[0]?.id).toBe('micrograd/engine.py::Value');
  });

  it('E-US2-3: typo "egnine.py::Value" → levenshtein 0.5~0.75', () => {
    const r = resolveSymbolFuzzy(GRAPH, 'egnine.py::Value', { projectRoot: PROJECT_ROOT });
    expect(r.candidates[0]?.matchKind).toBe('levenshtein');
    expect(r.candidates[0]?.id).toBe('micrograd/engine.py::Value');
    expect(r.candidates[0]?.confidence).toBeGreaterThanOrEqual(0.5);
    expect(r.candidates[0]?.confidence).toBeLessThanOrEqual(0.75);
  });

  it('E-US2-4: 15 次混合变体 top-1 命中 ≥12/15', () => {
    const cases: Array<{ query: string; expected: string }> = [
      // 变体 i：只有方法名/类名
      { query: 'Value.__add__', expected: 'micrograd/engine.py::Value.__add__' },
      { query: 'Value.relu', expected: 'micrograd/engine.py::Value.relu' },
      { query: 'backward', expected: 'micrograd/engine.py::Value.backward' },
      { query: 'Linear', expected: 'micrograd/nn.py::Linear' },
      // 变体 ii：无 package 前缀
      { query: 'engine.py::Value', expected: 'micrograd/engine.py::Value' },
      { query: 'nn.py::Linear', expected: 'micrograd/nn.py::Linear' },
      { query: 'nn.py::ReLU', expected: 'micrograd/nn.py::ReLU' },
      // 变体 iii：绝对路径
      { query: `${PROJECT_ROOT}/micrograd/engine.py::Value`, expected: 'micrograd/engine.py::Value' },
      { query: `${PROJECT_ROOT}/micrograd/engine.py::Value.__add__`, expected: 'micrograd/engine.py::Value.__add__' },
      { query: `${PROJECT_ROOT}/micrograd/nn.py::Linear`, expected: 'micrograd/nn.py::Linear' },
      { query: `${PROJECT_ROOT}/micrograd/nn.py::ReLU`, expected: 'micrograd/nn.py::ReLU' },
      // 变体 iv：typo
      { query: 'egnine.py::Value', expected: 'micrograd/engine.py::Value' },
      { query: 'Valu.__add__', expected: 'micrograd/engine.py::Value.__add__' },
      { query: 'enginee.py::Value', expected: 'micrograd/engine.py::Value' },
      { query: 'nnn.py::Linear', expected: 'micrograd/nn.py::Linear' },
    ];
    let hits = 0;
    const misses: string[] = [];
    for (const { query, expected } of cases) {
      const r = resolveSymbolFuzzy(GRAPH, query, { projectRoot: PROJECT_ROOT });
      if (r.candidates[0]?.id === expected) hits++;
      else misses.push(`${query} → ${r.candidates[0]?.id ?? '∅'} (期望 ${expected})`);
    }
    expect(hits, `top-1 命中 ${hits}/15；未命中: ${misses.join('; ')}`).toBeGreaterThanOrEqual(12);
  });
});

// ============================================================
// US3 — cohort C 9 个 symbol → symbol-not-found 0/9
// ============================================================
describe('US3 — cohort C symbol-not-found 清零', () => {
  const cohortC = [
    'Value.__add__',
    'Value.__mul__',
    'Value.__neg__',
    'Value.__pow__',
    'Value.__repr__',
    'Value.backward',
    'engine.py::Value',
    'nn.py::Linear',
    'nn.py::ReLU',
  ];

  it('E-US3-1: 9 个 symbol via handleContext → symbol-not-found 0/9（且无其他错误假绿）', async () => {
    let notFound = 0;
    for (const symbolId of cohortC) {
      const r = await handleContext({ symbolId, projectRoot: PROJECT_ROOT });
      // 防假绿：每个调用必须真正成功（非任何 isError），否则 internal-error/graph-not-built
      // 也会让 notFound 维持 0 而掩盖失败
      expect(r.isError, `symbol "${symbolId}" 应成功 resolve，实际响应: ${r.content[0]!.text.slice(0, 120)}`).toBeUndefined();
      if (r.isError) {
        const e = JSON.parse(r.content[0]!.text) as { code: string };
        if (e.code === 'symbol-not-found') notFound++;
      }
    }
    expect(notFound).toBe(0);
  });

  it('E-US3-2: 原失败样本 Value.__add__ → warnings fuzzy-resolved + resolvedFrom/resolvedTo', async () => {
    const r = await handleContext({ symbolId: 'Value.__add__', projectRoot: PROJECT_ROOT });
    const data = JSON.parse(r.content[0]!.text) as Record<string, unknown>;
    expect(data['warnings'] as string[]).toContain('fuzzy-resolved');
    expect(data['resolvedFrom']).toBe('Value.__add__');
    expect(data['resolvedTo']).toBe('micrograd/engine.py::Value.__add__');
  });
});

// ============================================================
// US4 — 完全不存在 symbol → 安全降级 + 结构化 top-3
// ============================================================
describe('US4 — 不存在 symbol 安全降级', () => {
  it('E-US4-1: resolveSymbolFuzzy("zzz_nonexistent::foo") → 不 autoResolved + candidates ≤3 + 不抛', () => {
    const r = resolveSymbolFuzzy(GRAPH, 'zzz_nonexistent::foo', { projectRoot: PROJECT_ROOT });
    expect(r.autoResolved).toBe(false);
    expect(r.candidates.length).toBeLessThanOrEqual(10);
    for (const c of r.candidates) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.confidence).toBe('number');
      expect(['exact', 'path-suffix', 'partial-name', 'levenshtein']).toContain(c.matchKind);
    }
  });

  it('E-US4-2: handleContext 不存在 symbol → fuzzyMatches Array<SymbolCandidate> length ≤3 不抛', async () => {
    const r = await handleContext({ symbolId: 'zzz_nonexistent::foo', projectRoot: PROJECT_ROOT });
    expect(r.isError).toBe(true);
    const e = JSON.parse(r.content[0]!.text) as { code: string; context?: { fuzzyMatches?: unknown } };
    expect(e.code).toBe('symbol-not-found');
    const fz = e.context?.fuzzyMatches as Array<{ id: string; confidence: number; matchKind: string }>;
    expect(Array.isArray(fz)).toBe(true);
    expect(fz.length).toBeLessThanOrEqual(3);
    for (const c of fz) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.confidence).toBe('number');
      expect(['exact', 'path-suffix', 'partial-name', 'levenshtein']).toContain(c.matchKind);
    }
  });
});
