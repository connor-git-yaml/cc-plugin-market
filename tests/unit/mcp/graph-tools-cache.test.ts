/**
 * Feature 155 T-002 — graph-tools.ts engineCache 升级回归测试。
 *
 * 验证：
 *   - getCachedGraphData 命中缓存复用 engine
 *   - graph.json mtime 变化时 stale detection 触发 reload
 *   - graph.json size 变化时 reload
 *   - graph.json 不存在时返回 null（不抛错）
 *   - reloadGraph 清空缓存
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCachedGraphData, reloadGraph } from '../../../src/mcp/graph-tools.js';

let tempProjectRoot: string;

/** 写一个最小可加载的 GraphJSON，并设定 mtime 让我们能测 stale */
function writeGraphJson(graphPath: string, links: number, mtimeMs: number): void {
  const graph = {
    directed: true,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-05-09T00:00:00.000Z',
      nodeCount: 2,
      edgeCount: links,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
    },
    nodes: [
      { id: 'a', kind: 'component', label: 'a', metadata: {} },
      { id: 'b', kind: 'component', label: 'b', metadata: {} },
    ],
    links: Array.from({ length: links }, () => ({
      source: 'a',
      target: 'b',
      relation: 'calls',
      confidence: 'EXTRACTED',
      confidenceScore: 0.95,
      directional: true,
    })),
  };
  writeFileSync(graphPath, JSON.stringify(graph));
  const sec = Math.floor(mtimeMs / 1000);
  utimesSync(graphPath, sec, sec);
}

beforeEach(() => {
  tempProjectRoot = mkdtempSync(join(tmpdir(), 'spectra-cache-test-'));
  mkdirSync(join(tempProjectRoot, 'specs', '_meta'), { recursive: true });
  reloadGraph();
});

afterEach(() => {
  reloadGraph();
  rmSync(tempProjectRoot, { recursive: true, force: true });
});

describe('graph-tools engineCache 升级（Feature 155 T-002）', () => {
  it('命中：连续两次返回的 graphData 来自同一 engine 缓存', () => {
    const graphPath = join(tempProjectRoot, 'specs', '_meta', 'graph.json');
    writeGraphJson(graphPath, 1, Date.now());
    const r1 = getCachedGraphData(tempProjectRoot);
    const r2 = getCachedGraphData(tempProjectRoot);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    // 命中：两次返回的 graphData 应是同一对象（来自缓存的同一 engine.rawGraph）
    expect(r1?.graphData).toBe(r2?.graphData);
  });

  it('stale: mtime 变化触发 reload，graphData 是新对象', () => {
    const graphPath = join(tempProjectRoot, 'specs', '_meta', 'graph.json');
    const baseMtime = Date.now() - 10_000;
    writeGraphJson(graphPath, 1, baseMtime);
    const r1 = getCachedGraphData(tempProjectRoot);
    expect(r1).not.toBeNull();

    // 改 mtime（用 utimes 显式设置成不同的秒）
    writeGraphJson(graphPath, 1, baseMtime + 5_000);
    const r2 = getCachedGraphData(tempProjectRoot);
    expect(r2).not.toBeNull();
    // mtime 变化应让 cache stale → 新 engine 实例 → 新 graphData
    expect(r1?.graphData).not.toBe(r2?.graphData);
    expect(r2?.mtimeMs).not.toBe(r1?.mtimeMs);
  });

  it('stale: size 变化触发 reload', () => {
    const graphPath = join(tempProjectRoot, 'specs', '_meta', 'graph.json');
    const baseMtime = Date.now() - 10_000;
    writeGraphJson(graphPath, 1, baseMtime);
    const r1 = getCachedGraphData(tempProjectRoot);
    expect(r1).not.toBeNull();
    const size1 = r1?.sizeBytes;

    // 改 link 数量（size 必变，mtime 也会变）
    writeGraphJson(graphPath, 5, baseMtime);
    // 故意把 mtime 改回原值，强制 size-only 触发
    const sec = Math.floor(baseMtime / 1000);
    utimesSync(graphPath, sec, sec);

    const r2 = getCachedGraphData(tempProjectRoot);
    expect(r2).not.toBeNull();
    expect(r2?.sizeBytes).not.toBe(size1);
    expect(r2?.graphData).not.toBe(r1?.graphData);
  });

  it('graph.json 不存在 → null（不抛错）', () => {
    const r = getCachedGraphData(tempProjectRoot);
    expect(r).toBeNull();
  });

  it('reloadGraph 清空缓存，下一次返回的 graphData 是新对象', () => {
    const graphPath = join(tempProjectRoot, 'specs', '_meta', 'graph.json');
    writeGraphJson(graphPath, 1, Date.now());
    const r1 = getCachedGraphData(tempProjectRoot);
    expect(r1).not.toBeNull();

    reloadGraph();

    const r2 = getCachedGraphData(tempProjectRoot);
    expect(r2).not.toBeNull();
    // reloadGraph 之后即使 graph 文件没变，cache 是新的 → 新 engine
    expect(r1?.graphData).not.toBe(r2?.graphData);
  });

  it('返回字段完整：graphData / graphPath / mtimeMs / sizeBytes', () => {
    const graphPath = join(tempProjectRoot, 'specs', '_meta', 'graph.json');
    writeGraphJson(graphPath, 1, Date.now());
    const r = getCachedGraphData(tempProjectRoot);
    expect(r).not.toBeNull();
    expect(r?.graphPath).toBe(graphPath);
    expect(typeof r?.mtimeMs).toBe('number');
    expect(typeof r?.sizeBytes).toBe('number');
    expect(r?.graphData.nodes.length).toBe(2);
  });
});
