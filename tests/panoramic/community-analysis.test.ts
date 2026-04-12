/**
 * community-analysis 端到端集成测试
 * 覆盖完整分析管道：GraphJSON → 社区检测 → God Node → 异常边 → 报告生成
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import { runCommunityAnalysis } from '../../src/panoramic/community/index.js';
import type { GraphJSON, GraphNode, GraphEdge } from '../../src/panoramic/graph/graph-types.js';

// ============================================================
// 辅助函数
// ============================================================

function makeNode(id: string, kind: GraphNode['kind'] = 'module'): GraphNode {
  return { id, kind, label: id, metadata: {} };
}

function makeEdge(
  source: string,
  target: string,
  relation = 'depends-on',
  confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' = 'EXTRACTED',
): GraphEdge {
  const scores = { EXTRACTED: 0.95, INFERRED: 0.65, AMBIGUOUS: 0.25 };
  return { source, target, relation, confidence, confidenceScore: scores[confidence] };
}

function makeGraphJSON(nodes: GraphNode[], links: GraphEdge[]): GraphJSON {
  return {
    directed: false, multigraph: false,
    graph: { name: 'spectra-knowledge-graph', generatedAt: new Date().toISOString(), nodeCount: nodes.length, edgeCount: links.length, sources: ['architecture-ir'], schemaVersion: '1.0' },
    nodes, links,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// 测试用例
// ============================================================

describe('runCommunityAnalysis 端到端', () => {
  it('生成完整的 GRAPH_REPORT.md', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeNode(id));
    const links = [
      makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('a', 'c'),
      makeEdge('d', 'e'), makeEdge('e', 'f'), makeEdge('d', 'f'),
      makeEdge('c', 'd', 'depends-on', 'INFERRED'),
    ];
    const graphJson = makeGraphJSON(nodes, links);

    const reportPath = runCommunityAnalysis(graphJson, tmpDir);

    expect(fs.existsSync(reportPath)).toBe(true);
    const content = fs.readFileSync(reportPath, 'utf-8');

    // 验证报告包含所有 5 个必需区块
    expect(content).toContain('# 架构图谱分析报告');
    expect(content).toContain('## 概述');
    expect(content).toContain('## God Nodes');
    expect(content).toContain('## 社区列表');
    expect(content).toContain('## Surprising Connections');
    expect(content).toContain('## Knowledge Gaps');
  });

  it('报告写入 _meta/GRAPH_REPORT.md', () => {
    const graphJson = makeGraphJSON(
      [makeNode('a'), makeNode('b')],
      [makeEdge('a', 'b')],
    );
    const reportPath = runCommunityAnalysis(graphJson, tmpDir);
    expect(reportPath).toBe(path.join(tmpDir, '_meta', 'GRAPH_REPORT.md'));
  });

  it('minSize 选项传递到社区检测', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeNode(id));
    const links = [
      makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('a', 'c'),
      makeEdge('d', 'e'), makeEdge('e', 'f'), makeEdge('d', 'f'),
      makeEdge('c', 'd'),
    ];
    const graphJson = makeGraphJSON(nodes, links);

    const reportPath = runCommunityAnalysis(graphJson, tmpDir, { minSize: 10 });
    const content = fs.readFileSync(reportPath, 'utf-8');
    // 应该没有满足 minSize=10 的社区
    expect(content).toContain('未检测到有效社区');
  });

  it('5000 节点性能 < 5 秒', () => {
    // 生成大图：5000 节点，每个节点连接 2-4 个邻居
    const nodeCount = 5000;
    const nodes = Array.from({ length: nodeCount }, (_, i) => makeNode(`n${i}`));
    const links: GraphEdge[] = [];

    for (let i = 0; i < nodeCount; i++) {
      // 连接到相邻节点
      const neighborCount = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < neighborCount; j++) {
        const target = (i + j + 1) % nodeCount;
        links.push(makeEdge(`n${i}`, `n${target}`));
      }
    }

    const graphJson = makeGraphJSON(nodes, links);

    const start = performance.now();
    runCommunityAnalysis(graphJson, tmpDir);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });
});
