/**
 * F280：共享 GraphQueryEngine 缓存（mtime + size 复合失效）。
 * 背景：panoramic/qa 侧 engineCache 零失效判据 → MCP 同进程重建图后 panoramic-query 永远拿旧图。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEngineCached, clearEngineCache, toGraphEvidence } from '../../../src/panoramic/graph/engine-cache.js';
import { GraphQueryEngine } from '../../../src/panoramic/graph/graph-query.js';

function writeGraph(graphPath: string, nodeIds: string[]): void {
  const nodes = nodeIds.map((id) => ({ id, kind: 'module', label: id, metadata: {} }));
  const graph = {
    directed: true,
    multigraph: false,
    graph: { name: 'g', generatedAt: '1970-01-01T00:00:00.000Z', nodeCount: nodes.length, edgeCount: 0, schemaVersion: '2.0', sources: ['extraction'], skippedSources: [], sourceCommit: null },
    nodes,
    links: [],
  };
  writeFileSync(graphPath, JSON.stringify(graph), 'utf-8');
}

describe('F280 loadEngineCached — mtime+size 复合失效', () => {
  let root = '';
  afterEach(() => {
    clearEngineCache();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function setup(): string {
    root = mkdtempSync(join(tmpdir(), 'f280-engine-cache-'));
    mkdirSync(join(root, 'specs', '_meta'), { recursive: true });
    const graphPath = join(root, 'specs', '_meta', 'graph.json');
    writeGraph(graphPath, ['a.ts']);
    return graphPath;
  }

  it('同一 graph.json 未变 → 复用同一缓存条目（engine 同一实例）', () => {
    const graphPath = setup();
    const e1 = loadEngineCached(graphPath, root);
    const e2 = loadEngineCached(graphPath, root);
    expect(e2).toBe(e1);
    expect(e2.engine).toBe(e1.engine);
  });

  it('条目元数据 = 验证这份 engine 的那次 stat；toGraphEvidence 的 graphData 就是 engine 持有的图', () => {
    const graphPath = setup();
    const entry = loadEngineCached(graphPath, root);
    const stat = statSync(graphPath);
    expect(entry.graphPath).toBe(graphPath);
    expect(entry.mtimeMs).toBe(stat.mtimeMs);
    expect(entry.sizeBytes).toBe(stat.size);
    const evidence = toGraphEvidence(entry);
    expect(evidence.graphData).toBe(entry.engine.rawGraph);
    expect(evidence).toMatchObject({ graphPath, mtimeMs: stat.mtimeMs, sizeBytes: stat.size });
  });

  it('graph.json 内容重写（size 变）→ 重新加载，新图可见', () => {
    const graphPath = setup();
    const e1 = loadEngineCached(graphPath, root);
    writeGraph(graphPath, ['a.ts', 'b.ts', 'c.ts']);
    const e2 = loadEngineCached(graphPath, root);
    expect(e2).not.toBe(e1);
    expect(e2.engine).not.toBe(e1.engine);
    expect(e2.engine.rawGraph.nodes.length).toBe(3);
  });

  it('size 不变但 mtime 变（同尺寸重写）→ 重新加载', () => {
    const graphPath = setup();
    const e1 = loadEngineCached(graphPath, root);
    writeGraph(graphPath, ['b.ts']); // 同长度 id → size 相同
    const before = statSync(graphPath).mtimeMs;
    utimesSync(graphPath, new Date(before + 5000), new Date(before + 5000));
    const e2 = loadEngineCached(graphPath, root);
    expect(e2).not.toBe(e1);
    expect(e2.engine.rawGraph.nodes[0]?.id).toBe('b.ts');
  });

  it('不同 projectRoot 同一 graphPath → 各自 engine（F170e 语义保留）', () => {
    const graphPath = setup();
    const other = mkdtempSync(join(tmpdir(), 'f280-other-root-'));
    try {
      const e1 = loadEngineCached(graphPath, root);
      const e2 = loadEngineCached(graphPath, other);
      expect(e2).not.toBe(e1);
      expect(e2.engine).not.toBe(e1.engine);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('文件不可 stat 却可 load（测试替身）→ 条目不入缓存、身份为每次唯一的负数（=== 与字符串模板键都必然 miss）', () => {
    root = mkdtempSync(join(tmpdir(), 'f280-unstatable-'));
    const missing = join(root, 'specs', '_meta', 'graph.json');
    const fake = { rawGraph: { nodes: [] } } as unknown as GraphQueryEngine;
    const spy = vi.spyOn(GraphQueryEngine, 'loadFromFile').mockReturnValue(fake);
    try {
      const e1 = loadEngineCached(missing, root);
      const e2 = loadEngineCached(missing, root);
      expect(e1.engine).toBe(fake);
      expect(Number.isFinite(e1.mtimeMs) && e1.mtimeMs < 0).toBe(true);
      expect(Number.isFinite(e1.sizeBytes) && e1.sizeBytes < 0).toBe(true);
      expect(e2).not.toBe(e1); // 未入缓存：每次都重新 load
      expect(e2.mtimeMs).not.toBe(e1.mtimeMs);
      // 字符串模板键（query-helpers buildAdjKey 形态）也不得碰撞——NaN 会撞成 "NaN::NaN"
      expect(`${e2.mtimeMs}::${e2.sizeBytes}`).not.toBe(`${e1.mtimeMs}::${e1.sizeBytes}`);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('graph.json 不存在 → 抛出 loadFromFile 的原始错误（不被 stat 的 ENOENT 抢先）', () => {
    root = mkdtempSync(join(tmpdir(), 'f280-missing-'));
    const missing = join(root, 'specs', '_meta', 'graph.json');
    // 钉 loadFromFile 特有文案（statSync 原生 ENOENT 消息不含「请先运行」；delta 复审 I-3：旧正则对两者都匹配、钉不住）
    expect(() => loadEngineCached(missing, root)).toThrow(/无法读取图谱文件[\s\S]*请先运行/);
  });
});
