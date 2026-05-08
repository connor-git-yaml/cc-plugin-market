/**
 * Feature 151 — graph-accuracy.mjs 的 SC-001 fill-rate 计算单测（CL-09 + Codex W-2 + C-4）
 *
 * computeFillRate 应：
 * - 优先读取 node.metadata.callSitesCount（T-012a 注入路径）
 * - 兼容 node.metadata.codeSkeleton.callSites 旧路径
 * - 分母用 truth set 的 filesWithCalls；缺失时回退 fileCount
 * - 仅统计 module 节点（避免 symbol/spec 节点污染分子）
 */
import { describe, expect, it } from 'vitest';

// @ts-expect-error — graph-accuracy.mjs 是 mjs，JS 模块；类型由我们手动声明
import { computeFillRate } from '../../scripts/graph-accuracy.mjs';

interface MockNode {
  id: string;
  kind?: string;
  filePath?: string;
  metadata?: {
    callSitesCount?: number;
    codeSkeleton?: { callSites?: unknown[] };
  };
}

function buildGraph(nodes: MockNode[]): { nodes: MockNode[] } {
  return { nodes };
}

describe('computeFillRate (Feature 151 SC-001)', () => {
  it('使用 truth.filesWithCalls 作为分母（优先）', () => {
    const graph = buildGraph([
      { id: 'a.py', kind: 'module', filePath: 'a.py', metadata: { callSitesCount: 3 } },
      { id: 'b.py', kind: 'module', filePath: 'b.py', metadata: { callSitesCount: 0 } },
    ]);
    const truth = { fileCount: 5, filesWithCalls: 4 };
    const result = computeFillRate(graph, truth);
    expect(result.filesWithCallSites).toBe(1); // 仅 a.py 有 callSitesCount > 0
    expect(result.denominator).toBe(4);
    expect(result.callsiteFillRate).toBe(0.25);
  });

  it('truth.filesWithCalls 缺失时回退到 fileCount', () => {
    const graph = buildGraph([
      { id: 'a.py', kind: 'module', filePath: 'a.py', metadata: { callSitesCount: 1 } },
    ]);
    const truth = { fileCount: 10 } as { fileCount: number };
    const result = computeFillRate(graph, truth);
    expect(result.denominator).toBe(10);
    expect(result.callsiteFillRate).toBe(0.1);
  });

  it('兼容 codeSkeleton.callSites 旧路径', () => {
    const graph = buildGraph([
      {
        id: 'a.py',
        kind: 'module',
        filePath: 'a.py',
        metadata: { codeSkeleton: { callSites: [{ calleeName: 'foo', calleeKind: 'free', line: 1 }] } },
      },
    ]);
    const truth = { fileCount: 1, filesWithCalls: 1 };
    const result = computeFillRate(graph, truth);
    expect(result.filesWithCallSites).toBe(1);
    expect(result.callsiteFillRate).toBe(1);
  });

  it('忽略非 module 节点（kind=symbol / spec）', () => {
    const graph = buildGraph([
      { id: 'a.py', kind: 'module', filePath: 'a.py', metadata: { callSitesCount: 5 } },
      { id: 'a.py::foo', kind: 'symbol', filePath: 'a.py', metadata: { callSitesCount: 99 } },
      { id: 'spec/foo', kind: 'spec', metadata: { callSitesCount: 99 } },
    ]);
    const truth = { fileCount: 1, filesWithCalls: 1 };
    const result = computeFillRate(graph, truth);
    expect(result.filesWithCallSites).toBe(1); // 只算 module 节点
  });

  it('callSitesCount === 0 不计入分子', () => {
    const graph = buildGraph([
      { id: 'a.py', kind: 'module', filePath: 'a.py', metadata: { callSitesCount: 0 } },
    ]);
    const truth = { fileCount: 1, filesWithCalls: 1 };
    const result = computeFillRate(graph, truth);
    expect(result.filesWithCallSites).toBe(0);
    expect(result.callsiteFillRate).toBe(0);
  });

  it('分母为 0 时返回 0（避免 NaN）', () => {
    const graph = buildGraph([
      { id: 'a.py', kind: 'module', filePath: 'a.py', metadata: { callSitesCount: 1 } },
    ]);
    const truth = { fileCount: 0 };
    const result = computeFillRate(graph, truth);
    expect(result.callsiteFillRate).toBe(0);
  });
});
