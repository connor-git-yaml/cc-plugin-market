/**
 * Feature 155 T-007 — agent-context-tools.ts 单测
 *
 * 覆盖 3 个 tool handler：
 *   - impact: 6+ case
 *   - context: 6+ case
 *   - detect_changes: 6+ case
 *   - 通用错误：3+ case
 *
 * Mock 策略：
 *   - getCachedGraphData mock 返回合成 GraphJSON
 *   - spawnSync mock 模拟 git rev-parse / diff 输出
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphJSON } from '../../../src/panoramic/graph/graph-types.js';

// ─── Mock：必须在 import handler 之前 hoist ───
const mocks = vi.hoisted(() => ({
  getCachedGraphData: vi.fn(),
  spawnSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  // F170c: response-helpers mocks（用于 partial fill / degraded 路径注入）
  buildTopImpactedRanking: vi.fn(),
  generateNextStepHint: vi.fn(),
  buildTopRelevantCallers: vi.fn(),
  safeStderrLog: vi.fn(),
}));

vi.mock('../../../src/mcp/graph-tools.js', () => ({
  getCachedGraphData: mocks.getCachedGraphData,
  reloadGraph: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawnSync: mocks.spawnSync,
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: mocks.existsSync, statSync: mocks.statSync };
});

// F170c: mock response-helpers 允许 partial fill 失败注入
vi.mock('../../../src/mcp/lib/response-helpers.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/mcp/lib/response-helpers.js')>('../../../src/mcp/lib/response-helpers.js');
  return {
    ...actual,
    buildTopImpactedRanking: mocks.buildTopImpactedRanking,
    generateNextStepHint: mocks.generateNextStepHint,
    buildTopRelevantCallers: mocks.buildTopRelevantCallers,
    safeStderrLog: mocks.safeStderrLog,
  };
});

import {
  handleImpact,
  handleContext,
  handleDetectChanges,
} from '../../../src/mcp/agent-context-tools.js';
import { clearReverseAdjacencyCache } from '../../../src/knowledge-graph/query-helpers.js';

// ─── 合成 fixture 工厂 ─────────────────────────────────────

function makeGraph(): GraphJSON {
  return {
    directed: true,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-05-09T00:00:00.000Z',
      nodeCount: 5,
      edgeCount: 4,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
    },
    nodes: [
      {
        id: 'fixture/engine.py::Value',
        kind: 'component',
        label: 'Value',
        metadata: {
          sourceFile: 'fixture/engine.py',
          confidence: 'EXTRACTED',
          lineRange: { start: 10, end: 80 },
        },
      },
      { id: 'fixture/nn.py::Linear', kind: 'component', label: 'Linear', metadata: { sourceFile: 'fixture/nn.py' } },
      { id: 'fixture/nn.py::ReLU', kind: 'component', label: 'ReLU', metadata: { sourceFile: 'fixture/nn.py' } },
      { id: 'fixture/loss.py::MSELoss', kind: 'component', label: 'MSELoss', metadata: { sourceFile: 'fixture/loss.py' } },
      { id: 'fixture/optim.py::SGD', kind: 'component', label: 'SGD', metadata: { sourceFile: 'fixture/optim.py' } },
      { id: 'fixture/engine.py', kind: 'module', label: 'engine.py', metadata: {} },
      { id: 'fixture/nn.py', kind: 'module', label: 'nn.py', metadata: {} },
    ],
    links: [
      { source: 'fixture/nn.py::Linear', target: 'fixture/engine.py::Value', relation: 'calls', confidence: 'EXTRACTED', confidenceScore: 0.95, directional: true },
      { source: 'fixture/nn.py::ReLU', target: 'fixture/engine.py::Value', relation: 'calls', confidence: 'EXTRACTED', confidenceScore: 0.95, directional: true },
      { source: 'fixture/loss.py::MSELoss', target: 'fixture/engine.py::Value', relation: 'calls', confidence: 'INFERRED', confidenceScore: 0.65, directional: true },
      { source: 'fixture/optim.py::SGD', target: 'fixture/engine.py::Value', relation: 'calls', confidence: 'AMBIGUOUS', confidenceScore: 0.25, directional: true },
      { source: 'fixture/nn.py', target: 'fixture/engine.py', relation: 'depends-on', confidence: 'EXTRACTED', confidenceScore: 0.95, directional: true },
    ],
  };
}

function setMockGraph(graph?: GraphJSON | null): void {
  if (graph === null) {
    mocks.getCachedGraphData.mockReturnValue(null);
  } else {
    mocks.getCachedGraphData.mockReturnValue({
      graphData: graph ?? makeGraph(),
      graphPath: '/p/specs/_meta/graph.json',
      mtimeMs: 1000,
      sizeBytes: 5000,
    });
  }
}

function parseSuccess(result: { content: Array<{ text: string }>; isError?: true }): Record<string, unknown> {
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

function parseError(result: { content: Array<{ text: string }>; isError?: true }): { code: string; message: string; hint?: string; context?: Record<string, unknown> } {
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0]!.text);
}

beforeEach(() => {
  vi.clearAllMocks();
  clearReverseAdjacencyCache();
  mocks.existsSync.mockReturnValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// impact tool
// ============================================================

describe('impact tool', () => {
  it('C-101 成功路径：4 callers + warnings 含 input-clamped 否', async () => {
    setMockGraph();
    const r = await handleImpact({
      target: 'fixture/engine.py::Value',
      depth: 2,
      minConfidence: 0,
      direction: 'upstream',
      budget: 200,
    });
    const data = parseSuccess(r);
    expect(Array.isArray(data['affected'])).toBe(true);
    expect((data['affected'] as unknown[]).length).toBe(4);
    expect((data['summary'] as Record<string, unknown>)['directCallers']).toBe(4);
    expect(data['effectiveDepth']).toBe(2);
    expect(data['effectiveDirection']).toBe('upstream');
  });

  it('C-102 target 不存在 → symbol-not-found + fuzzyMatches', async () => {
    setMockGraph();
    const r = await handleImpact({ target: 'fixture/engine.py::DoesNotExist' });
    const e = parseError(r);
    expect(e.code).toBe('symbol-not-found');
    expect(Array.isArray(e.context?.['fuzzyMatches'])).toBe(true);
  });

  it('C-103 depth=10 clamp 到 5 + warnings depth-clamped', async () => {
    setMockGraph();
    const r = await handleImpact({
      target: 'fixture/engine.py::Value',
      depth: 10,
      minConfidence: 0,
      direction: 'upstream',
      budget: 200,
    });
    const data = parseSuccess(r);
    expect(data['effectiveDepth']).toBe(5);
    expect((data['warnings'] as string[])).toContain('depth-clamped');
  });

  it('C-104 budget=999999 clamp + warnings budget-clamped', async () => {
    setMockGraph();
    const r = await handleImpact({
      target: 'fixture/engine.py::Value',
      depth: 2,
      direction: 'upstream',
      budget: 5000,
    });
    const data = parseSuccess(r);
    expect(data['effectiveBudget']).toBe(1000);
    expect((data['warnings'] as string[])).toContain('budget-clamped');
  });

  it('C-105 minConfidence=0.99 全过滤 → warnings confidence-filtered-all', async () => {
    setMockGraph();
    const r = await handleImpact({
      target: 'fixture/engine.py::Value',
      depth: 2,
      minConfidence: 0.99,
      direction: 'upstream',
      budget: 200,
    });
    const data = parseSuccess(r);
    expect((data['affected'] as unknown[]).length).toBe(0);
    expect((data['warnings'] as string[])).toContain('confidence-filtered-all');
  });

  it('C-106 budget=3 强制截断 → warnings budget-truncated', async () => {
    setMockGraph();
    const r = await handleImpact({
      target: 'fixture/engine.py::Value',
      depth: 5,
      minConfidence: 0,
      direction: 'upstream',
      budget: 3,
    });
    const data = parseSuccess(r);
    expect((data['affected'] as unknown[]).length).toBe(3);
    expect((data['warnings'] as string[])).toContain('budget-truncated');
  });

  it('C-107 graph.json 不存在 → graph-not-built', async () => {
    setMockGraph(null);
    const r = await handleImpact({ target: 'x' });
    expect(parseError(r).code).toBe('graph-not-built');
  });

  it('C-108 invalid input：target 空字符串 → invalid-input', async () => {
    setMockGraph();
    const r = await handleImpact({ target: '' });
    expect(parseError(r).code).toBe('invalid-input');
  });

  it('C-109 invalid-symbol-id：含控制字符', async () => {
    setMockGraph();
    const r = await handleImpact({ target: 'fixture/engine.py::Val\x00ue' });
    expect(parseError(r).code).toBe('invalid-symbol-id');
  });

  it('C-110 riskTier 计算：4 directCallers → medium', async () => {
    setMockGraph();
    const r = await handleImpact({
      target: 'fixture/engine.py::Value',
      depth: 2,
      minConfidence: 0,
      direction: 'upstream',
      budget: 200,
    });
    const data = parseSuccess(r);
    expect((data['summary'] as Record<string, unknown>)['riskTier']).toBe('medium');
  });
});

// ============================================================
// context tool
// ============================================================

describe('context tool', () => {
  it('C-201 成功路径：definition + callers + callees + imports', async () => {
    setMockGraph();
    const r = await handleContext({
      symbolId: 'fixture/engine.py::Value',
      include: ['callers', 'callees', 'imports'],
    });
    const data = parseSuccess(r);
    const def = data['definition'] as Record<string, unknown>;
    expect(def['id']).toBe('fixture/engine.py::Value');
    expect(def['file']).toBe('fixture/engine.py');
    expect(def['kind']).toBe('component');
    expect(def['label']).toBe('Value');
    expect(def['lineStart']).toBe(10);
    expect(def['lineEnd']).toBe(80);
    expect(Array.isArray(data['callers'])).toBe(true);
    expect((data['callers'] as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data['callees'])).toBe(true);
    expect(Array.isArray(data['imports'])).toBe(true);
  });

  it('C-202 include 子集：仅 callers，其他字段不出现', async () => {
    setMockGraph();
    const r = await handleContext({
      symbolId: 'fixture/engine.py::Value',
      include: ['callers'],
    });
    const data = parseSuccess(r);
    expect(data['callers']).toBeDefined();
    expect(data['callees']).toBeUndefined();
    expect(data['imports']).toBeUndefined();
    expect(data['relatedSpec']).toBeUndefined();
  });

  it('C-203 default include 不含 related-spec', async () => {
    setMockGraph();
    const r = await handleContext({ symbolId: 'fixture/engine.py::Value' });
    const data = parseSuccess(r);
    expect(data['callers']).toBeDefined();
    expect(data['callees']).toBeDefined();
    expect(data['imports']).toBeDefined();
    expect(data['relatedSpec']).toBeUndefined();
  });

  it('C-204 relatedSpec 命中 panoramic/modules/<slug>.spec.md', async () => {
    setMockGraph();
    mocks.existsSync.mockImplementation((p: unknown) => {
      return typeof p === 'string' && p.includes('panoramic/modules/engine.spec.md');
    });
    const r = await handleContext({
      symbolId: 'fixture/engine.py::Value',
      include: ['related-spec'],
      projectRoot: '/p',
    });
    const data = parseSuccess(r);
    const rs = data['relatedSpec'] as Record<string, unknown>;
    expect(rs['kind']).toBe('module-coarse');
    expect(typeof rs['path']).toBe('string');
    expect((rs['path'] as string).includes('engine.spec.md')).toBe(true);
  });

  it('C-205 relatedSpec 不命中 → unknown', async () => {
    setMockGraph();
    mocks.existsSync.mockReturnValue(false);
    const r = await handleContext({
      symbolId: 'fixture/engine.py::Value',
      include: ['related-spec'],
      projectRoot: '/p',
    });
    const data = parseSuccess(r);
    expect((data['relatedSpec'] as Record<string, unknown>)['kind']).toBe('unknown');
  });

  it('C-206 symbolId 不存在 → symbol-not-found + fuzzy', async () => {
    setMockGraph();
    const r = await handleContext({ symbolId: 'fixture/engine.py::Nonexistent' });
    const e = parseError(r);
    expect(e.code).toBe('symbol-not-found');
    expect(Array.isArray(e.context?.['fuzzyMatches'])).toBe(true);
  });

  it('C-207 invalid-symbol-id 含控制字符', async () => {
    setMockGraph();
    const r = await handleContext({ symbolId: 'fixture/engine.py::Val\x7f' });
    expect(parseError(r).code).toBe('invalid-symbol-id');
  });

  it('C-208 imports 字段：来自 module 的 depends-on 边', async () => {
    setMockGraph();
    const r = await handleContext({
      symbolId: 'fixture/nn.py::Linear',
      include: ['imports'],
    });
    const data = parseSuccess(r);
    const imports = data['imports'] as Array<Record<string, unknown>>;
    expect(imports.length).toBeGreaterThanOrEqual(1);
    expect(imports[0]?.['moduleId']).toBe('fixture/engine.py');
    expect(imports[0]?.['file']).toBe('fixture/engine.py');
    expect(typeof imports[0]?.['confidence']).toBe('number');
  });
});

// ============================================================
// detect_changes tool
// ============================================================

describe('detect_changes tool', () => {
  const VALID_DIFF = `diff --git a/fixture/engine.py b/fixture/engine.py
index 0000001..0000002 100644
--- a/fixture/engine.py
+++ b/fixture/engine.py
@@ -1,3 +1,3 @@
-old
+new
`;

  const RENAME_DIFF = `diff --git a/fixture/old.py b/fixture/new.py
similarity index 100%
rename from fixture/old.py
rename to fixture/new.py
`;

  const BINARY_DIFF = `diff --git a/asset.png b/asset.png
index 0000001..0000002 100644
Binary files a/asset.png and b/asset.png differ
`;

  it('C-301 diff 文本成功：changedSymbols 非空', async () => {
    setMockGraph();
    const r = await handleDetectChanges({ diff: VALID_DIFF });
    const data = parseSuccess(r);
    const cs = data['changedSymbols'] as Array<Record<string, unknown>>;
    expect(cs.length).toBeGreaterThanOrEqual(1);
    expect(cs[0]?.['file']).toBe('fixture/engine.py');
    expect(cs[0]?.['changeKind']).toBe('modified');
  });

  it('C-302 baseRef 路径成功：spawnSync 串接 rev-parse + diff', async () => {
    setMockGraph();
    mocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'abc123\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'M\tfixture/engine.py\n', stderr: '' });
    const r = await handleDetectChanges({ baseRef: 'HEAD~1' });
    const data = parseSuccess(r);
    const cs = data['changedSymbols'] as Array<Record<string, unknown>>;
    expect(cs[0]?.['file']).toBe('fixture/engine.py');
  });

  it('C-303 diff + baseRef 都缺 → invalid-input', async () => {
    setMockGraph();
    const r = await handleDetectChanges({});
    expect(parseError(r).code).toBe('invalid-input');
  });

  it('C-304 rename diff 解析为 changeKind=rename', async () => {
    const graph = makeGraph();
    graph.nodes.push({ id: 'fixture/new.py::Foo', kind: 'component', label: 'Foo', metadata: {} });
    setMockGraph(graph);
    const r = await handleDetectChanges({ diff: RENAME_DIFF });
    const data = parseSuccess(r);
    const cs = data['changedSymbols'] as Array<Record<string, unknown>>;
    expect(cs[0]?.['changeKind']).toBe('rename');
    expect(cs[0]?.['file']).toBe('fixture/new.py');
  });

  it('C-305 binary diff → unmappedFiles reason=binary', async () => {
    setMockGraph();
    const r = await handleDetectChanges({ diff: BINARY_DIFF });
    const data = parseSuccess(r);
    const um = data['unmappedFiles'] as Array<Record<string, unknown>>;
    expect(um.some((u) => u['reason'] === 'binary')).toBe(true);
  });

  it('C-306 baseRef 含非法字符（"; rm -rf"）→ invalid-input baseref-format', async () => {
    setMockGraph();
    const r = await handleDetectChanges({ baseRef: 'HEAD; rm -rf' });
    const e = parseError(r);
    expect(e.code).toBe('invalid-input');
    expect(e.context?.['reason']).toBe('baseref-format');
  });

  it('C-307 baseRef rev-parse 失败 → git-spawn-failed', async () => {
    setMockGraph();
    mocks.spawnSync.mockReturnValueOnce({ status: 128, stdout: '', stderr: "fatal: bad revision 'foo'\n" });
    const r = await handleDetectChanges({ baseRef: 'foo' });
    const e = parseError(r);
    expect(e.code).toBe('git-spawn-failed');
    expect(e.context?.['reason']).toBe('baseref-invalid');
  });

  it('C-308 大于 5MB diff → payload-too-large', async () => {
    setMockGraph();
    const huge = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n' + 'x'.repeat(6 * 1024 * 1024);
    const r = await handleDetectChanges({ diff: huge });
    expect(parseError(r).code).toBe('payload-too-large');
  });

  it('C-309 同时给 diff + baseRef → 优先 diff + warnings baseRef-ignored', async () => {
    setMockGraph();
    const r = await handleDetectChanges({ diff: VALID_DIFF, baseRef: 'HEAD~1' });
    const data = parseSuccess(r);
    expect((data['warnings'] as string[])).toContain('baseRef-ignored');
  });

  it('C-310 invalid-diff 格式（非 unified diff）', async () => {
    setMockGraph();
    const r = await handleDetectChanges({ diff: 'not a real diff content' });
    expect(parseError(r).code).toBe('invalid-diff');
  });

  it('C-311 diff 内 file 不在 graph → unmappedFiles reason=not-in-graph', async () => {
    setMockGraph();
    const otherDiff = `diff --git a/unknown.py b/unknown.py
--- a/unknown.py
+++ b/unknown.py
@@ -1 +1 @@
-x
+y
`;
    const r = await handleDetectChanges({ diff: otherDiff });
    const data = parseSuccess(r);
    const um = data['unmappedFiles'] as Array<Record<string, unknown>>;
    expect(um.some((u) => u['file'] === 'unknown.py' && u['reason'] === 'not-in-graph')).toBe(true);
  });

  it('C-312 detect_changes 跨 changedSymbol 共享 budget', async () => {
    setMockGraph();
    const r = await handleDetectChanges({ diff: VALID_DIFF, budget: 2 });
    const data = parseSuccess(r);
    expect((data['affectedSymbols'] as unknown[]).length).toBeLessThanOrEqual(2);
  });

  it('C-313 graph 不存在 → graph-not-built', async () => {
    setMockGraph(null);
    const r = await handleDetectChanges({ diff: VALID_DIFF });
    expect(parseError(r).code).toBe('graph-not-built');
  });

  it('C-314 mode-only diff（仅 diff --git 头无内容）→ no-changed-files warning', async () => {
    setMockGraph();
    const modeOnly = 'diff --git a/x.py b/x.py\nold mode 100644\nnew mode 100755\n';
    const r = await handleDetectChanges({ diff: modeOnly });
    const data = parseSuccess(r);
    expect((data['changedSymbols'] as unknown[]).length).toBe(0);
    expect((data['warnings'] as string[])).toContain('no-changed-files');
  });

  it('C-315 baseRef 以 - 开头 → invalid-input baseref-format', async () => {
    setMockGraph();
    const r = await handleDetectChanges({ baseRef: '-foo' });
    const e = parseError(r);
    expect(e.code).toBe('invalid-input');
    expect(e.context?.['reason']).toBe('baseref-format');
  });

  it('C-316 git timeout → git-timeout', async () => {
    setMockGraph();
    mocks.spawnSync.mockReturnValueOnce({
      status: null,
      error: Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' }),
      stdout: '',
      stderr: '',
    });
    const r = await handleDetectChanges({ baseRef: 'HEAD~1' });
    expect(parseError(r).code).toBe('git-timeout');
  });

  it('C-317 deleted 文件 (D 状态) → unmappedFiles reason=deleted-file', async () => {
    setMockGraph();
    mocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'abc\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'D\tfixture/old.py\n', stderr: '' });
    const r = await handleDetectChanges({ baseRef: 'HEAD~1' });
    const data = parseSuccess(r);
    const um = data['unmappedFiles'] as Array<Record<string, unknown>>;
    expect(um.some((u) => u['file'] === 'fixture/old.py' && u['reason'] === 'deleted-file')).toBe(true);
  });
});

// ============================================================
// 通用错误 / payload-truncated
// ============================================================

describe('通用 / payload', () => {
  it('C-401 internal-error: 异常情况下兜底 + stack 截断', async () => {
    // 让 getCachedGraphData 抛错（非 null 路径）
    mocks.getCachedGraphData.mockImplementation(() => {
      throw new Error('synthetic crash with stack');
    });
    const r = await handleImpact({ target: 'x' });
    const e = parseError(r);
    expect(e.code).toBe('internal-error');
    expect(typeof e.context?.['stack']).toBe('string');
    expect((e.context!['stack'] as string).length).toBeLessThanOrEqual(200);
  });
});

// ============================================================
// F170c SC-003 — 三路径 (success / enrichment degraded / handler error)
// 修订（响应 codex C1/C2）：mock helper 触发 degraded + 用真实 diff 参数
// ============================================================

// 真实 unified diff fixture，能被 parseUnifiedDiff 正确解析（响应 codex C2）
const VALID_DIFF = `diff --git a/fixture/engine.py b/fixture/engine.py
index abc..def 100644
--- a/fixture/engine.py
+++ b/fixture/engine.py
@@ -10,3 +10,3 @@
-old line
+new line
 unchanged
`;

describe('F170c SC-003 — 三路径', () => {
  // 默认 helper mock 实现（success path）
  beforeEach(() => {
    mocks.buildTopImpactedRanking.mockImplementation((affected: unknown[], maxItems: number) => {
      return (affected as Array<{ id: string }>).slice(0, maxItems).map((a) => ({ id: a.id, score: 1.0 }));
    });
    mocks.generateNextStepHint.mockImplementation((toolName: string) => `建议接下来调相关工具（${toolName} success default mock）`);
    mocks.buildTopRelevantCallers.mockImplementation((callers: unknown[], maxItems: number) => {
      return (callers as Array<{ id: string; confidence: number }>).slice(0, maxItems).map((c) => ({ id: c.id, confidence: c.confidence, score: c.confidence }));
    });
    mocks.safeStderrLog.mockImplementation(() => {
      /* no-op */
    });
  });

  // ─── impact handler ───────────────────────────────────────
  describe('handleImpact', () => {
    it('success 路径：response 含 topImpacted (≤5) + nextStepHint (≥5 字符) + _enrichmentDegraded 缺失', async () => {
      setMockGraph();
      const r = await handleImpact({
        target: 'fixture/engine.py::Value',
        depth: 2,
        minConfidence: 0,
        direction: 'upstream',
        budget: 200,
      });
      const data = parseSuccess(r);
      expect(Array.isArray(data['topImpacted']), 'topImpacted 必须为数组').toBe(true);
      expect((data['topImpacted'] as unknown[]).length).toBeLessThanOrEqual(5);
      expect(typeof data['nextStepHint'], 'nextStepHint 必须为字符串').toBe('string');
      expect((data['nextStepHint'] as string).length).toBeGreaterThanOrEqual(5);
      expect(data['_enrichmentDegraded'], 'success 路径 _enrichmentDegraded 必须缺失').toBeUndefined();
    });

    it('enrichment degraded 路径（mock ranking 抛错）：topImpacted=[]、nextStepHint=""、_enrichmentDegraded=true，affected 完整（响应 codex C1）', async () => {
      setMockGraph();
      // 触发 enrichment degraded：让 ranking helper 抛错
      mocks.buildTopImpactedRanking.mockImplementationOnce(() => {
        throw new Error('synthetic ranking crash');
      });
      const r = await handleImpact({
        target: 'fixture/engine.py::Value',
        depth: 2,
        minConfidence: 0,
        direction: 'upstream',
        budget: 200,
      });
      const data = parseSuccess(r);
      // 精确断言 fallback 全量字段（响应 codex C1）
      expect(data['topImpacted'], 'degraded: topImpacted 必须为 []').toEqual([]);
      expect(data['nextStepHint'], 'degraded: nextStepHint 必须为 ""').toBe('');
      expect(data['_enrichmentDegraded'], 'degraded: 标志必须为 true').toBe(true);
      // 旧字段完整性
      expect(data).toHaveProperty('affected');
      expect(data).toHaveProperty('summary');
    });

    it('partial fill 失败注入（ranking 成功 + hint 抛错）：topImpacted=[]、nextStepHint=""、affected 真实（响应 codex C1）', async () => {
      setMockGraph();
      // ranking 成功，但 hint 抛错 — 验证 catch 显式 reset topImpacted（plan G 节关键约束）
      mocks.generateNextStepHint.mockImplementationOnce(() => {
        throw new Error('synthetic hint crash');
      });
      const r = await handleImpact({
        target: 'fixture/engine.py::Value',
        depth: 2,
        minConfidence: 0,
        direction: 'upstream',
        budget: 200,
      });
      const data = parseSuccess(r);
      // 关键断言：partial fill 不泄露 — topImpacted 必须被 catch 重置为 []
      expect(data['topImpacted'], 'partial fill: topImpacted 必须被 reset 为 []').toEqual([]);
      expect(data['nextStepHint']).toBe('');
      expect(data['_enrichmentDegraded']).toBe(true);
      expect(data).toHaveProperty('affected');
    });

    it('handler error 路径（baseline 不变性）：response 不含 topImpacted / nextStepHint / _enrichmentDegraded', async () => {
      mocks.getCachedGraphData.mockImplementation(() => {
        throw new Error('synthetic crash');
      });
      const r = await handleImpact({ target: 'fixture/engine.py::Value' });
      const e = parseError(r);
      expect(e.code).toBe('internal-error');
      expect(e).not.toHaveProperty('topImpacted');
      expect(e).not.toHaveProperty('nextStepHint');
      expect(e).not.toHaveProperty('_enrichmentDegraded');
    });
  });

  // ─── context handler ──────────────────────────────────────
  describe('handleContext', () => {
    it('success 路径：response 含 topRelevantCallers (≤3) + nextStepHint (≥5 字符) + _enrichmentDegraded 缺失', async () => {
      setMockGraph();
      const r = await handleContext({ symbolId: 'fixture/engine.py::Value' });
      const data = parseSuccess(r);
      expect(Array.isArray(data['topRelevantCallers'])).toBe(true);
      expect((data['topRelevantCallers'] as unknown[]).length).toBeLessThanOrEqual(3);
      expect(typeof data['nextStepHint']).toBe('string');
      expect((data['nextStepHint'] as string).length).toBeGreaterThanOrEqual(5);
      expect(data['_enrichmentDegraded']).toBeUndefined();
    });

    it('enrichment degraded 路径（mock callers ranking 抛错）：topRelevantCallers=[]、nextStepHint=""、_enrichmentDegraded=true（响应 codex C1）', async () => {
      setMockGraph();
      mocks.buildTopRelevantCallers.mockImplementationOnce(() => {
        throw new Error('synthetic callers ranking crash');
      });
      const r = await handleContext({ symbolId: 'fixture/engine.py::Value' });
      const data = parseSuccess(r);
      expect(data['topRelevantCallers']).toEqual([]);
      expect(data['nextStepHint']).toBe('');
      expect(data['_enrichmentDegraded']).toBe(true);
      // 旧字段完整性
      expect(data).toHaveProperty('definition');
    });

    it('partial fill 失败注入（callers ranking 成功 + hint 抛错）：全 fallback（响应 codex C1）', async () => {
      setMockGraph();
      mocks.generateNextStepHint.mockImplementationOnce(() => {
        throw new Error('synthetic hint crash');
      });
      const r = await handleContext({ symbolId: 'fixture/engine.py::Value' });
      const data = parseSuccess(r);
      expect(data['topRelevantCallers'], 'partial fill: 必须 reset 为 []').toEqual([]);
      expect(data['nextStepHint']).toBe('');
      expect(data['_enrichmentDegraded']).toBe(true);
    });

    it('handler error 路径（baseline 不变性）：error response 不含 M7 新字段', async () => {
      mocks.getCachedGraphData.mockImplementation(() => {
        throw new Error('synthetic crash');
      });
      const r = await handleContext({ symbolId: 'fixture/engine.py::Value' });
      const e = parseError(r);
      expect(e.code).toBe('internal-error');
      expect(e).not.toHaveProperty('topRelevantCallers');
      expect(e).not.toHaveProperty('nextStepHint');
      expect(e).not.toHaveProperty('_enrichmentDegraded');
    });
  });

  // ─── detect_changes handler ──────────────────────────────
  describe('handleDetectChanges', () => {
    it('success 路径：response 含顶层 riskTier (mirror riskSummary.riskTier) + topImpacted + nextStepHint（响应 codex C2: 用真实 diff 参数）', async () => {
      setMockGraph();
      const r = await handleDetectChanges({ diff: VALID_DIFF });
      // 真实 diff + 真实 mock graph 应进入 success path（响应 codex C2）
      expect(r.isError, '不应为 error response（valid diff + mock graph 完整）').toBeUndefined();
      const data = parseSuccess(r);
      expect(['low', 'medium', 'high']).toContain(data['riskTier']);
      // 关键断言：顶层 riskTier 必须 mirror riskSummary.riskTier（FR-008 + plan D 节）
      const riskSummary = data['riskSummary'] as Record<string, unknown>;
      expect(riskSummary, 'riskSummary 必须存在').toBeDefined();
      expect(data['riskTier'], '顶层 riskTier 必须等于 riskSummary.riskTier（mirror 断言）').toBe(riskSummary['riskTier']);
      expect(Array.isArray(data['topImpacted'])).toBe(true);
      expect(typeof data['nextStepHint']).toBe('string');
    });

    it('enrichment degraded 路径（mock ranking 抛错）：顶层 riskTier 仍 mirror（不走 "low" fallback）、topImpacted=[]、nextStepHint=""', async () => {
      setMockGraph();
      mocks.buildTopImpactedRanking.mockImplementationOnce(() => {
        throw new Error('synthetic ranking crash');
      });
      const r = await handleDetectChanges({ diff: VALID_DIFF });
      expect(r.isError).toBeUndefined();
      const data = parseSuccess(r);
      // 关键：顶层 riskTier 不允许走 "low" fallback，仍 mirror 真实值
      const riskSummary = data['riskSummary'] as Record<string, unknown>;
      expect(data['riskTier'], 'degraded: 顶层 riskTier 仍 mirror（plan D 修订）').toBe(riskSummary['riskTier']);
      expect(data['topImpacted']).toEqual([]);
      expect(data['nextStepHint']).toBe('');
      expect(data['_enrichmentDegraded']).toBe(true);
    });

    it('partial fill 失败注入（ranking 成功 + hint 抛错）：topImpacted=[]、nextStepHint=""、riskTier 仍真实', async () => {
      setMockGraph();
      mocks.generateNextStepHint.mockImplementationOnce(() => {
        throw new Error('synthetic hint crash');
      });
      const r = await handleDetectChanges({ diff: VALID_DIFF });
      expect(r.isError).toBeUndefined();
      const data = parseSuccess(r);
      const riskSummary = data['riskSummary'] as Record<string, unknown>;
      expect(data['topImpacted'], 'partial fill: 必须 reset').toEqual([]);
      expect(data['nextStepHint']).toBe('');
      expect(data['riskTier']).toBe(riskSummary['riskTier']);
    });

    it('handler error 路径（baseline 不变性）：error response 不含任何 M7 新字段', async () => {
      mocks.getCachedGraphData.mockImplementation(() => {
        throw new Error('synthetic crash');
      });
      const r = await handleDetectChanges({ diff: VALID_DIFF });
      const e = parseError(r);
      expect(e.code, '必须返回 internal-error code').toBe('internal-error');
      expect(e).not.toHaveProperty('riskTier');
      expect(e).not.toHaveProperty('topImpacted');
      expect(e).not.toHaveProperty('nextStepHint');
      expect(e).not.toHaveProperty('_enrichmentDegraded');
    });
  });
});
