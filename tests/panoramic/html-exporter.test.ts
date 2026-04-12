/**
 * HTML 导出器单元测试
 * 测试先行（TDD）：覆盖 communityColor、nodeRadius、edgeOpacity、computeGridLayout、buildGraphData、generateHtml
 * FR 追踪: FR-007、FR-012
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  communityColor,
  nodeRadius,
  edgeOpacity,
  computeGridLayout,
  buildGraphData,
  generateHtml,
  generateHtmlExport,
} from '../../src/panoramic/exporters/html-exporter.js';
import type { GraphJSON, GraphNode, GraphEdge } from '../../src/panoramic/graph/graph-types.js';
import type { CommunityResult, CommunityInfo } from '../../src/panoramic/community/community-detector.js';
import type { GodNode } from '../../src/panoramic/community/god-node-analyzer.js';

// ============================================================
// 测试数据工厂
// ============================================================

function makeNode(
  id: string,
  label?: string,
  kind: GraphNode['kind'] = 'module',
  metadata: Record<string, unknown> = {},
): GraphNode {
  return { id, kind, label: label ?? id, metadata };
}

function makeEdge(
  source: string,
  target: string,
  confidenceScore = 0.8,
): GraphEdge {
  return { source, target, relation: 'depends-on', confidence: 'EXTRACTED', confidenceScore };
}

function makeGraphJson(nodes: GraphNode[], links: GraphEdge[]): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: nodes.length,
      edgeCount: links.length,
      sources: ['architecture-ir'],
      schemaVersion: '1.0',
    },
    nodes,
    links,
  };
}

function makeCommunityResult(nodeIds: string[][]): CommunityResult {
  const communities: CommunityInfo[] = nodeIds.map((nodes, idx) => ({
    id: idx,
    nodes,
    coreNodes: nodes.slice(0, 3),
    cohesion: 0.75,
  }));
  const nodeCommunityMap = new Map<string, number>();
  nodeIds.forEach((nodes, idx) => {
    nodes.forEach((n) => nodeCommunityMap.set(n, idx));
  });
  return { communities, nodeCommunityMap };
}

function makeGodNode(id: string, label: string, communityId: number): GodNode {
  return { id, label, degree: 15, primaryRelation: 'depends-on', communityId };
}

// ============================================================
// communityColor 测试 — FR-007
// ============================================================

describe('communityColor', () => {
  it('返回 hsl(...) 格式字符串', () => {
    const color = communityColor(0, 4);
    expect(color).toMatch(/^hsl\(\d+(?:\.\d+)?,\s*\d+(?:\.\d+)?%,\s*\d+(?:\.\d+)?%\)$/);
  });

  it('不同社区 ID 产生不同颜色', () => {
    const total = 8;
    const colors = Array.from({ length: total }, (_, i) => communityColor(i, total));
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(total);
  });

  it('社区数量为 1 时不报错', () => {
    expect(() => communityColor(0, 1)).not.toThrow();
  });

  it('社区数量为 0 时不报错（回退处理）', () => {
    expect(() => communityColor(0, 0)).not.toThrow();
  });

  it('色相值在 [0, 360) 范围内', () => {
    for (let i = 0; i < 10; i++) {
      const color = communityColor(i, 10);
      const match = color.match(/^hsl\((\d+(?:\.\d+)?)/);
      expect(match).not.toBeNull();
      const hue = parseFloat(match![1]!);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});

// ============================================================
// nodeRadius 测试 — FR-007
// ============================================================

describe('nodeRadius', () => {
  it('度数为 0 时返回最小值 4', () => {
    expect(nodeRadius(0)).toBe(4);
  });

  it('返回值在 [4, 20] 范围内', () => {
    const degrees = [0, 1, 5, 10, 50, 100, 500, 1000];
    for (const d of degrees) {
      const r = nodeRadius(d);
      expect(r).toBeGreaterThanOrEqual(4);
      expect(r).toBeLessThanOrEqual(20);
    }
  });

  it('度数越大半径越大（单调递增）', () => {
    const r1 = nodeRadius(1);
    const r5 = nodeRadius(5);
    const r10 = nodeRadius(10);
    expect(r5).toBeGreaterThanOrEqual(r1);
    expect(r10).toBeGreaterThanOrEqual(r5);
  });

  it('负数度数视为 0，返回最小值', () => {
    expect(nodeRadius(-1)).toBe(4);
  });
});

// ============================================================
// edgeOpacity 测试 — FR-007
// ============================================================

describe('edgeOpacity', () => {
  it('confidenceScore 为 0 时返回最小透明度 0.1', () => {
    expect(edgeOpacity(0)).toBeCloseTo(0.1);
  });

  it('confidenceScore 为 1 时返回最大透明度 0.8', () => {
    expect(edgeOpacity(1)).toBeCloseTo(0.8);
  });

  it('返回值在 [0.1, 0.8] 范围内', () => {
    const scores = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
    for (const s of scores) {
      const opacity = edgeOpacity(s);
      expect(opacity).toBeGreaterThanOrEqual(0.1);
      expect(opacity).toBeLessThanOrEqual(0.8);
    }
  });

  it('线性映射：中间值 0.5 对应约 0.45', () => {
    // 线性映射：0.1 + (0.8 - 0.1) * 0.5 = 0.1 + 0.35 = 0.45
    expect(edgeOpacity(0.5)).toBeCloseTo(0.45);
  });
});

// ============================================================
// computeGridLayout 测试 — FR-012
// ============================================================

describe('computeGridLayout', () => {
  it('空节点列表时返回空 Map', () => {
    const layout = computeGridLayout([]);
    expect(layout.size).toBe(0);
  });

  it('每个节点都有坐标', () => {
    const nodeIds = ['a', 'b', 'c', 'd'];
    const layout = computeGridLayout(nodeIds);
    for (const id of nodeIds) {
      expect(layout.has(id)).toBe(true);
      const pos = layout.get(id)!;
      expect(typeof pos.x).toBe('number');
      expect(typeof pos.y).toBe('number');
    }
  });

  it('列数 = Math.ceil(Math.sqrt(n))', () => {
    // 9 节点 → 列数 = 3，最大 x = 2 * 60 = 120
    const nodeIds = Array.from({ length: 9 }, (_, i) => `node-${i}`);
    const layout = computeGridLayout(nodeIds);
    const cols = Math.ceil(Math.sqrt(9)); // = 3
    const maxX = (cols - 1) * 60;
    for (const pos of layout.values()) {
      expect(pos.x).toBeLessThanOrEqual(maxX);
    }
  });

  it('节点间距 60px', () => {
    const nodeIds = ['a', 'b'];
    const layout = computeGridLayout(nodeIds);
    const posA = layout.get('a')!;
    const posB = layout.get('b')!;
    // a 在 (0,0)，b 在 (60,0) 或 (0,60)
    const dist = Math.abs(posA.x - posB.x) + Math.abs(posA.y - posB.y);
    expect(dist).toBe(60);
  });

  it('4 节点布局：2 列 2 行', () => {
    const nodeIds = ['a', 'b', 'c', 'd'];
    const layout = computeGridLayout(nodeIds);
    const cols = Math.ceil(Math.sqrt(4)); // = 2
    // 验证所有 x 坐标都是 0 或 60
    for (const pos of layout.values()) {
      expect(pos.x % 60).toBe(0);
      expect(pos.y % 60).toBe(0);
    }
    // 最大 x = (cols - 1) * 60 = 60
    const maxX = Math.max(...[...layout.values()].map((p) => p.x));
    expect(maxX).toBeLessThanOrEqual((cols - 1) * 60);
  });
});

// ============================================================
// buildGraphData 测试 — FR-007、FR-012、FR-016、FR-017
// ============================================================

describe('buildGraphData', () => {
  const nodes = [makeNode('a', 'Module A'), makeNode('b', 'Module B')];
  const links = [makeEdge('a', 'b', 0.8)];
  const graphJson = makeGraphJson(nodes, links);
  const communityResult = makeCommunityResult([['a', 'b']]);
  const godNodes = [makeGodNode('a', 'Module A', 0)];

  it('返回合法 JSON 字符串', () => {
    const json = buildGraphData(graphJson, communityResult, godNodes);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('节点包含 color、radius、communityId 字段', () => {
    const json = buildGraphData(graphJson, communityResult, godNodes);
    const data = JSON.parse(json) as { nodes: Array<{ color: string; radius: number; communityId: number }> };
    for (const node of data.nodes) {
      expect(node.color).toBeDefined();
      expect(typeof node.radius).toBe('number');
      expect(typeof node.communityId).toBe('number');
    }
  });

  it('节点的 communityId 来自 nodeCommunityMap', () => {
    const json = buildGraphData(graphJson, communityResult, godNodes);
    const data = JSON.parse(json) as { nodes: Array<{ id: string; communityId: number }> };
    const nodeA = data.nodes.find((n) => n.id === 'a');
    expect(nodeA?.communityId).toBe(0);
  });

  it('不在社区 Map 中的节点 communityId 为 -1', () => {
    const nodeOnly = makeGraphJson([makeNode('z', 'Z')], []);
    const json = buildGraphData(nodeOnly, makeCommunityResult([]), []);
    const data = JSON.parse(json) as { nodes: Array<{ id: string; communityId: number }> };
    const nodeZ = data.nodes.find((n) => n.id === 'z');
    expect(nodeZ?.communityId).toBe(-1);
  });

  it('悬空边被静默跳过（FR-017）', () => {
    // edge 引用了不存在的节点 x
    const linksWithDangling = [makeEdge('a', 'x', 0.5)];
    const graphWithDangling = makeGraphJson(nodes, linksWithDangling);
    const json = buildGraphData(graphWithDangling, communityResult, godNodes);
    const data = JSON.parse(json) as { links: Array<{ source: string; target: string }> };
    // 悬空边不出现在输出中
    expect(data.links.some((l) => l.target === 'x')).toBe(false);
  });

  it('节点数 > 5000 时包含 fx/fy 固定坐标', () => {
    // 生成 5001 个节点
    const largeNodes = Array.from({ length: 5001 }, (_, i) => makeNode(`n${i}`, `Node ${i}`));
    const largeGraph = makeGraphJson(largeNodes, []);
    const json = buildGraphData(largeGraph, makeCommunityResult([]), []);
    const data = JSON.parse(json) as { nodes: Array<{ fx?: number; fy?: number }> };
    // 所有节点都有 fx/fy
    const hasFx = data.nodes.every((n) => n.fx !== undefined && n.fy !== undefined);
    expect(hasFx).toBe(true);
  });

  it('节点数 ≤ 5000 时不包含 fx/fy', () => {
    const json = buildGraphData(graphJson, communityResult, godNodes);
    const data = JSON.parse(json) as { nodes: Array<{ fx?: number; fy?: number }> };
    const hasFx = data.nodes.some((n) => n.fx !== undefined || n.fy !== undefined);
    expect(hasFx).toBe(false);
  });
});

// ============================================================
// generateHtml 测试 — FR-006、FR-018
// ============================================================

describe('generateHtml', () => {
  const nodes = [makeNode('a', 'Module A'), makeNode('b', 'Module B')];
  const links = [makeEdge('a', 'b')];
  const graphJson = makeGraphJson(nodes, links);
  const communityResult = makeCommunityResult([['a', 'b']]);
  const godNodes: GodNode[] = [];

  it('返回包含 <!DOCTYPE html> 的字符串', () => {
    const html = generateHtml(graphJson, communityResult, godNodes);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('包含 d3-force bundle 的关键字', () => {
    const html = generateHtml(graphJson, communityResult, godNodes);
    // d3-force bundle 中包含 forceSimulation
    expect(html).toContain('forceSimulation');
  });

  it('包含图谱数据 JSON', () => {
    const html = generateHtml(graphJson, communityResult, godNodes);
    expect(html).toContain('Module A');
  });

  it('不包含外部资源加载（无 script src、link href 等外部引用）', () => {
    const html = generateHtml(graphJson, communityResult, godNodes);
    // 不应有 <script src="...">, <link href="...">, <img src="..."> 等外部资源加载
    expect(html).not.toMatch(/<script[^>]+src\s*=/i);
    expect(html).not.toMatch(/<link[^>]+href\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/<img[^>]+src\s*=\s*["']https?:/i);
  });

  it('500 节点时文件大小 < 2 MB', () => {
    const largeNodes = Array.from({ length: 500 }, (_, i) => makeNode(`n${i}`, `Node ${i}`));
    const largeLinks = Array.from({ length: 200 }, (_, i) => makeEdge(`n${i}`, `n${i + 1}`));
    const largeGraph = makeGraphJson(largeNodes, largeLinks);
    const largeCommunity = makeCommunityResult([largeNodes.map((n) => n.id)]);
    const html = generateHtml(largeGraph, largeCommunity, []);
    const sizeBytes = Buffer.byteLength(html, 'utf-8');
    expect(sizeBytes).toBeLessThan(2 * 1024 * 1024);
  });
});

// ============================================================
// generateHtmlExport 集成测试
// ============================================================

describe('generateHtmlExport', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const nodes = [makeNode('a', 'Module A'), makeNode('b', 'Module B')];
  const links = [makeEdge('a', 'b')];
  const graphJson = makeGraphJson(nodes, links);
  const communityResult = makeCommunityResult([['a', 'b']]);
  const godNodes: GodNode[] = [];

  it('写出 graph.html 文件', () => {
    generateHtmlExport(graphJson, communityResult, godNodes, tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'graph.html'))).toBe(true);
  });

  it('返回 fileCount 为 1', () => {
    const result = generateHtmlExport(graphJson, communityResult, godNodes, tmpDir);
    expect(result.fileCount).toBe(1);
  });

  it('返回的文件路径存在', () => {
    const result = generateHtmlExport(graphJson, communityResult, godNodes, tmpDir);
    expect(result.files.length).toBe(1);
    expect(fs.existsSync(result.files[0]!)).toBe(true);
  });

  it('返回 durationMs 大于等于 0', () => {
    const result = generateHtmlExport(graphJson, communityResult, godNodes, tmpDir);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// T027: 500 节点 HTML 导出集成测试
// FR 追踪: SC-002、FR-018
// ============================================================

describe('generateHtmlExport — 500 节点集成测试', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-large-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function make500NodeGraph() {
    const nodes: GraphNode[] = Array.from({ length: 500 }, (_, i) =>
      makeNode(`node-${i}`, `Node ${i}`),
    );
    const links: GraphEdge[] = Array.from({ length: 300 }, (_, i) =>
      makeEdge(`node-${i % 500}`, (i + 1) % 500 === i ? undefined : undefined, 0.7),
    ).filter((_, i) => `node-${i % 500}` !== `node-${(i + 1) % 500}`);
    // 简化：直接创建前 300 个简单链接
    const simpleLinks: GraphEdge[] = Array.from({ length: 300 }, (_, i) =>
      makeEdge(`node-${i}`, `node-${(i + 7) % 500}`, 0.7),
    );
    return makeGraphJson(nodes, simpleLinks);
  }

  it('单文件大小 < 2 MB', () => {
    const graphJson = make500NodeGraph();
    const communityResult = makeCommunityResult([
      Array.from({ length: 250 }, (_, i) => `node-${i}`),
      Array.from({ length: 250 }, (_, i) => `node-${i + 250}`),
    ]);
    generateHtmlExport(graphJson, communityResult, [], tmpDir);
    const htmlPath = path.join(tmpDir, 'graph.html');
    const stats = fs.statSync(htmlPath);
    expect(stats.size).toBeLessThan(2 * 1024 * 1024);
  });

  it('执行时间 < 3 秒', () => {
    const graphJson = make500NodeGraph();
    const communityResult = makeCommunityResult([
      Array.from({ length: 500 }, (_, i) => `node-${i}`),
    ]);
    const start = Date.now();
    generateHtmlExport(graphJson, communityResult, [], tmpDir);
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(3000);
  });

  it('HTML 包含 d3-force 版本注释和核心函数', () => {
    const graphJson = make500NodeGraph();
    const communityResult = makeCommunityResult([]);
    generateHtmlExport(graphJson, communityResult, [], tmpDir);
    const htmlContent = fs.readFileSync(path.join(tmpDir, 'graph.html'), 'utf-8');
    // D3_FORCE_BUNDLE 的开头包含版本注释 "d3-force/ v..."
    expect(htmlContent).toContain('d3-force');
    // 包含 forceSimulation（d3-force 的核心函数）
    expect(htmlContent).toContain('forceSimulation');
  });

  it('不包含外部资源加载', () => {
    const graphJson = make500NodeGraph();
    const communityResult = makeCommunityResult([]);
    generateHtmlExport(graphJson, communityResult, [], tmpDir);
    const htmlContent = fs.readFileSync(path.join(tmpDir, 'graph.html'), 'utf-8');
    expect(htmlContent).not.toMatch(/<script[^>]+src\s*=/i);
    expect(htmlContent).not.toMatch(/<link[^>]+href\s*=\s*["']https?:/i);
  });
});

// ============================================================
// T028: HTML 导出边界场景
// ============================================================

describe('generateHtmlExport — 边界场景', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-edge-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('孤立节点图（有节点无边）正常生成 HTML', () => {
    const nodes = [makeNode('a', 'Module A'), makeNode('b', 'Module B')];
    const graphJson = makeGraphJson(nodes, []);
    const communityResult = makeCommunityResult([['a'], ['b']]);
    const result = generateHtmlExport(graphJson, communityResult, [], tmpDir);
    expect(result.fileCount).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, 'graph.html'))).toBe(true);
  });

  it('含特殊字符节点 ID 的图正常生成 HTML', () => {
    const nodes = [makeNode('src/utils/helper', 'src/utils/helper'), makeNode('module:type?x', 'module:type?x')];
    const graphJson = makeGraphJson(nodes, [makeEdge('src/utils/helper', 'module:type?x')]);
    const communityResult = makeCommunityResult([['src/utils/helper', 'module:type?x']]);
    const result = generateHtmlExport(graphJson, communityResult, [], tmpDir);
    expect(result.fileCount).toBe(1);
    // 生成的 HTML 中节点 ID 以 JSON 形式嵌入，不影响文件系统
    const htmlContent = fs.readFileSync(path.join(tmpDir, 'graph.html'), 'utf-8');
    expect(htmlContent).toContain('src/utils/helper');
  });
});
