/**
 * F280：`buildPanoramicQueryHonesty` 装配合同（helper 级；handler 级接线见 panoramic-query-honesty-wiring.test.ts）。
 * 输入只来自 QA 随结果带回的 honestyInputs：本函数不自己加载图（对抗复审 C-1 / W-1）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPanoramicQueryHonesty } from '../../../src/mcp/lib/graph-honesty.js';
import { loadEngineCached, clearEngineCache, toGraphEvidence } from '../../../src/panoramic/graph/engine-cache.js';

function writeGraph(root: string, sourceCommit: string): string {
  mkdirSync(join(root, 'specs', '_meta'), { recursive: true });
  const graphPath = join(root, 'specs', '_meta', 'graph.json');
  writeFileSync(
    graphPath,
    JSON.stringify({
      directed: true,
      multigraph: false,
      graph: { name: 'g', generatedAt: '1970-01-01T00:00:00.000Z', nodeCount: 1, edgeCount: 0, schemaVersion: '2.0', sources: ['extraction'], skippedSources: [], sourceCommit },
      nodes: [{ id: 'a.ts', kind: 'module', label: 'a.ts', metadata: {} }],
      links: [],
    }),
    'utf-8',
  );
  return graphPath;
}

describe('F280 buildPanoramicQueryHonesty', () => {
  let root = '';
  afterEach(() => {
    clearEngineCache();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('无 honestyInputs（非 natural-language 或旧调用面）→ null', () => {
    expect(buildPanoramicQueryHonesty('/nowhere', undefined)).toBeNull();
  });

  it('图缺席（QA 走了 graph-insufficient 回退）→ null（由调用方决定不挂标注，而非伪造 fresh）', () => {
    expect(buildPanoramicQueryHonesty('/nowhere', { graph: null, resultsEmpty: true })).toBeNull();
  });

  it('图在场 + 结果非空 → freshness 三字段齐全；resolution / resolutionOmitted 皆不产出（F266：非空结果本就不需要）', () => {
    root = mkdtempSync(join(tmpdir(), 'f280-honesty-'));
    const graph = toGraphEvidence(loadEngineCached(writeGraph(root, 'deadbeef'), root));
    const honesty = buildPanoramicQueryHonesty(root, { graph, resultsEmpty: false });
    expect(honesty).not.toBeNull();
    expect(typeof honesty!.freshness.verdict.state).toBe('string');
    expect(honesty!.freshness).toHaveProperty('builderMismatch');
    expect(honesty!.resolution).toBeUndefined();
    expect(honesty!.resolutionOmitted).toBeUndefined();
    expect(honesty!.annotationDegraded).toBeUndefined();
  });

  it('图在场 + 零图证据 → resolutionOmitted 以 non-caller-oriented-query 结构化缺席（F266 D4）', () => {
    root = mkdtempSync(join(tmpdir(), 'f280-honesty-empty-'));
    const graph = toGraphEvidence(loadEngineCached(writeGraph(root, 'deadbeef'), root));
    const honesty = buildPanoramicQueryHonesty(root, { graph, resultsEmpty: true });
    expect(honesty!.resolution).toBeUndefined();
    expect(honesty!.resolutionOmitted).toEqual({ reason: 'non-caller-oriented-query' });
  });

  it('标注描述的是传入的那份图，不重新读盘', () => {
    root = mkdtempSync(join(tmpdir(), 'f280-honesty-bind-'));
    const graphPath = writeGraph(root, 'AAAA');
    const graph = toGraphEvidence(loadEngineCached(graphPath, root));
    writeGraph(root, 'BBBBBB'); // 盘上已是另一份图（size 变）
    const honesty = buildPanoramicQueryHonesty(root, { graph, resultsEmpty: false });
    expect(honesty!.freshness.verdict.recordedSourceCommit).toBe('AAAA');
  });
});
