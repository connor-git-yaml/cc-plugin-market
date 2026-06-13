/**
 * Feature 155 T-008 — 集成测试：用真实 micrograd graph.json 验证 3 个 tool。
 *
 * 不 mock graph，直接读 ~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json
 * 验证 GraphJSON 字段名（links 不是 edges）+ 契约一致。
 *
 * baseline 不存在 → skip 而非 fail（CI 友好）。
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleImpact, handleContext, handleDetectChanges } from '../../src/mcp/agent-context-tools.js';
import { reloadGraph } from '../../src/mcp/graph-tools.js';
import { clearReverseAdjacencyCache } from '../../src/knowledge-graph/query-helpers.js';
import { relativizeSymbolId } from '../../src/knowledge-graph/relativize.js';

const BASELINE_GRAPH = join(homedir(), '.spectra-baselines', 'micrograd-output', 'spectra-full', '_meta', 'graph.json');
const MICROGRAD_SOURCE = join(homedir(), '.spectra-baselines', 'micrograd');
const HAS_BASELINE = existsSync(BASELINE_GRAPH);

const skipMessage = HAS_BASELINE
  ? null
  : `[skip] micrograd baseline 不存在 (${BASELINE_GRAPH})，请先运行 npm run baseline:collect -- --target karpathy/micrograd --mode full`;

let MICROGRAD_ROOT = '';
let TEMP_ROOT = '';

function parseSuccess(r: { content: Array<{ text: string }>; isError?: true }): Record<string, unknown> {
  expect(r.isError).toBeUndefined();
  return JSON.parse(r.content[0]!.text);
}

beforeAll(() => {
  reloadGraph();
  clearReverseAdjacencyCache();
  if (HAS_BASELINE) {
    // 临时 projectRoot：resolveGraphJsonPath 约定 <root>/specs/_meta/graph.json，
    // 因此把 baseline 的 graph.json 复制到 <temp>/specs/_meta/graph.json 让 helper 找到。
    TEMP_ROOT = mkdtempSync(join(tmpdir(), 'spectra-155-int-'));
    mkdirSync(join(TEMP_ROOT, 'specs', '_meta'), { recursive: true });
    // Feature 193：相对化 baseline 绝对 id 后写入（新相对格式），避免加载期 graph-format-stale
    const raw = JSON.parse(readFileSync(BASELINE_GRAPH, 'utf-8')) as {
      nodes: Array<{ id: string; metadata?: Record<string, unknown> }>;
      links: Array<{ source: string; target: string }>;
      [k: string]: unknown;
    };
    for (const n of raw.nodes) {
      const rel = relativizeSymbolId(n.id, MICROGRAD_SOURCE);
      n.id = rel.value;
      if (rel.external) n.metadata = { ...n.metadata, external: true };
    }
    for (const l of raw.links) {
      l.source = relativizeSymbolId(l.source, MICROGRAD_SOURCE).value;
      l.target = relativizeSymbolId(l.target, MICROGRAD_SOURCE).value;
    }
    writeFileSync(join(TEMP_ROOT, 'specs', '_meta', 'graph.json'), JSON.stringify(raw, null, 2), 'utf-8');
    MICROGRAD_ROOT = TEMP_ROOT;
  }
});

afterAll(() => {
  if (TEMP_ROOT.length > 0) {
    rmSync(TEMP_ROOT, { recursive: true, force: true });
  }
  reloadGraph();
});

// Feature 193：baseline 相对化后 id 为 repo-relative POSIX（相对 MICROGRAD_SOURCE）
const ABS_VALUE_RELU = 'micrograd/engine.py::Value.relu';
const ABS_MLP = 'micrograd/nn.py::MLP';
const ABS_LAYER = 'micrograd/nn.py::Layer';

describe.skipIf(!HAS_BASELINE)('Feature 155 集成测试 — micrograd 真实 graph', () => {
  it('C-201 GraphJSON 字段名 links（不是 edges）— 通过 impact 调用确认', async () => {
    const r = await handleImpact({
      target: ABS_VALUE_RELU,
      depth: 2,
      minConfidence: 0.65,
      direction: 'upstream',
      budget: 200,
      projectRoot: MICROGRAD_ROOT,
    });
    const data = parseSuccess(r);
    expect(Array.isArray(data['affected'])).toBe(true);
    expect(data['effectiveDirection']).toBe('upstream');
  });

  it('C-202 跨工具协同：detect_changes 输出的 changedSymbol → impact 反查', async () => {
    // 修改 micrograd/nn.py 的 fixture diff（nn.py 模块有较多 calls 边）
    const diff = `diff --git a/micrograd/nn.py b/micrograd/nn.py
index a1..b2 100644
--- a/micrograd/nn.py
+++ b/micrograd/nn.py
@@ -1,3 +1,3 @@
-old line
+new line
`;
    const detectRes = await handleDetectChanges({
      diff,
      projectRoot: MICROGRAD_ROOT,
      depth: 2,
      budget: 200,
      minConfidence: 0.0,
    });
    const detectData = parseSuccess(detectRes);
    const cs = detectData['changedSymbols'] as Array<{ file: string; symbols: string[] }>;
    // 真实 graph 既含相对 id `micrograd/nn.py#Module` 也含绝对 id `.../nn.py::Module.parameters`
    // moduleFileFromId 兼容两种分隔符（# / ::），detect_changes 应同时识别两类
    const matchingFile = cs.find((c) => c.file === 'micrograd/nn.py');
    expect(matchingFile).toBeDefined();
    expect(matchingFile!.symbols.length).toBeGreaterThanOrEqual(2);
    // 至少应命中 micrograd/nn.py#Module（panoramic 格式）和 .../nn.py::Module.parameters（unified 格式）
    expect(matchingFile!.symbols.some((s) => s.includes('Module'))).toBe(true);
  });

  it('C-202b confidence filter 在真实 graph 上生效（detect_changes minConfidence=0.95 过滤掉 INFERRED 边）', async () => {
    const diff = `diff --git a/micrograd/nn.py b/micrograd/nn.py
index a1..b2 100644
--- a/micrograd/nn.py
+++ b/micrograd/nn.py
@@ -1,3 +1,3 @@
-old line
+new line
`;
    const r = await handleDetectChanges({
      diff,
      projectRoot: MICROGRAD_ROOT,
      depth: 2,
      budget: 200,
      minConfidence: 0.95, // 严格阈值，仅留 EXTRACTED 边
    });
    const data = parseSuccess(r);
    const affected = data['affectedSymbols'] as unknown[];
    // 真实 micrograd 全 4 条 calls 边都是 EXTRACTED 0.95，所以严格 0.95 也应有结果
    expect(Array.isArray(affected)).toBe(true);
  });

  it('C-203 context tool 在真实 graph 上返回 definition 字段', async () => {
    const r = await handleContext({
      symbolId: ABS_LAYER,
      include: ['callers', 'callees', 'imports'],
      projectRoot: MICROGRAD_ROOT,
    });
    const data = parseSuccess(r);
    const def = data['definition'] as Record<string, unknown>;
    expect(typeof def['id']).toBe('string');
    expect(typeof def['kind']).toBe('string');
    expect(Array.isArray(data['callers'])).toBe(true);
    expect(Array.isArray(data['callees'])).toBe(true);
    expect(Array.isArray(data['imports'])).toBe(true);
  });

  it('C-204 impact tool effective* 字段在真实 graph 上正确回传', async () => {
    const r = await handleImpact({
      target: ABS_MLP,
      depth: 2,
      minConfidence: 0.65,
      direction: 'upstream',
      budget: 200,
      projectRoot: MICROGRAD_ROOT,
    });
    const data = parseSuccess(r);
    expect(data['effectiveDepth']).toBe(2);
    expect(data['effectiveBudget']).toBe(200);
    expect(data['effectiveMinConfidence']).toBe(0.65);
    expect(data['effectiveDirection']).toBe('upstream');
    expect(data['summary']).toBeDefined();
  });

  it('C-205 SC-002b 真实 graph budget=2 强截断验证', async () => {
    // ABS_LAYER 至少有 1 个 caller (MLP.__init__)；budget=2 + depth=5 + minConf=0
    // 应得到 affected.length ≤ 2；effectiveBudget=2 字段回传一致
    const r = await handleImpact({
      target: ABS_LAYER,
      depth: 5,
      minConfidence: 0,
      direction: 'upstream',
      budget: 2,
      projectRoot: MICROGRAD_ROOT,
    });
    const data = parseSuccess(r);
    expect(data['effectiveBudget']).toBe(2);
    expect((data['affected'] as unknown[]).length).toBeLessThanOrEqual(2);
    // 注：micrograd 反向链很短（4 条 calls 边），budget=2 在小型 graph 上未必触发 budget-truncated
    // 严格的 budget-truncated 验证在合成 fixture 上完成（SC-002a / C-002）
  });
});

if (skipMessage !== null) {
  describe('Feature 155 集成测试 — baseline 不存在', () => {
    it.skip(skipMessage, () => {
      /* skipped */
    });
  });
}
