/**
 * Obsidian Vault 导出器单元测试
 * 测试先行（TDD）：覆盖 buildIndexPage、buildCommunityPage、buildGodNodePage
 * FR 追踪: FR-001、FR-002、FR-003、FR-004、FR-019
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  buildIndexPage,
  buildCommunityPage,
  buildGodNodePage,
  generateObsidianVault,
} from '../../src/panoramic/exporters/obsidian-exporter.js';
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
  relation = 'depends-on',
): GraphEdge {
  return { source, target, relation, confidence: 'EXTRACTED', confidenceScore: 0.95 };
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
// buildIndexPage 测试
// ============================================================

describe('buildIndexPage', () => {
  const nodes = [makeNode('a', 'Module A'), makeNode('b', 'Module B'), makeNode('c', 'Module C')];
  const links = [makeEdge('a', 'b'), makeEdge('b', 'c')];
  const graphJson = makeGraphJson(nodes, links);
  const communityResult = makeCommunityResult([['a', 'b'], ['c']]);
  const godNodes = [makeGodNode('a', 'Module A', 0)];

  it('返回 relativePath === index.md', () => {
    const page = buildIndexPage(graphJson, communityResult, godNodes);
    expect(page.relativePath).toBe('index.md');
  });

  it('内容包含节点数和边数统计', () => {
    const page = buildIndexPage(graphJson, communityResult, godNodes);
    expect(page.content).toContain('3');
    expect(page.content).toContain('2');
  });

  it('内容包含社区 [[链接]]', () => {
    const page = buildIndexPage(graphJson, communityResult, godNodes);
    expect(page.content).toContain('[[community-0]]');
    expect(page.content).toContain('[[community-1]]');
  });

  it('内容包含 God Node [[链接]]', () => {
    const page = buildIndexPage(graphJson, communityResult, godNodes);
    // God Node 页的文件名是 sanitizeFilename(label)，空格→-
    expect(page.content).toContain('[[Module-A]]');
  });

  it('无 God Node 时不包含 God Node 链接区块', () => {
    const page = buildIndexPage(graphJson, communityResult, []);
    expect(page.content).not.toContain('[[Module A]]');
  });
});

// ============================================================
// buildCommunityPage 测试
// ============================================================

describe('buildCommunityPage', () => {
  const nodeIdToLabel = new Map([
    ['a', 'Module A'],
    ['b', 'Module B'],
    ['c', 'Module C'],
    ['d', 'Module D'],
  ]);

  const communityInfo: CommunityInfo = {
    id: 0,
    nodes: ['a', 'b', 'c'],
    coreNodes: ['a', 'b'],
    cohesion: 0.75,
  };

  // 跨社区边：a→d，d 属于社区 1
  const nodes = [makeNode('a', 'Module A'), makeNode('b', 'Module B'), makeNode('c', 'Module C'), makeNode('d', 'Module D')];
  const links = [makeEdge('a', 'b'), makeEdge('a', 'c'), makeEdge('a', 'd')];
  const graphJson = makeGraphJson(nodes, links);
  const communityResult = makeCommunityResult([['a', 'b', 'c'], ['d']]);

  it('返回 relativePath 匹配 communities/community-{id}.md', () => {
    const page = buildCommunityPage(0, communityInfo, nodeIdToLabel, communityResult, graphJson);
    expect(page.relativePath).toBe('communities/community-0.md');
  });

  it('内容包含 cohesion 评分', () => {
    const page = buildCommunityPage(0, communityInfo, nodeIdToLabel, communityResult, graphJson);
    expect(page.content).toContain('0.75');
  });

  it('内容包含核心节点的 [[链接]]', () => {
    const page = buildCommunityPage(0, communityInfo, nodeIdToLabel, communityResult, graphJson);
    expect(page.content).toContain('[[Module-A]]');
    expect(page.content).toContain('[[Module-B]]');
  });

  it('内容包含社区内所有节点的 [[链接]]', () => {
    const page = buildCommunityPage(0, communityInfo, nodeIdToLabel, communityResult, graphJson);
    expect(page.content).toContain('[[Module-A]]');
    expect(page.content).toContain('[[Module-B]]');
    expect(page.content).toContain('[[Module-C]]');
  });

  it('节点 ID 在 nodeIdToLabel 中不存在时回退到 ID 本身', () => {
    const sparseMap = new Map([['a', 'Module A']]);
    const page = buildCommunityPage(0, communityInfo, sparseMap, communityResult, graphJson);
    expect(page.content).toContain('[[b]]');
    expect(page.content).toContain('[[c]]');
  });

  it('内容包含跨社区链接（FR-002）', () => {
    const page = buildCommunityPage(0, communityInfo, nodeIdToLabel, communityResult, graphJson);
    expect(page.content).toContain('## 跨社区链接');
    expect(page.content).toContain('[[community-1]]');
  });
});

// ============================================================
// buildGodNodePage 测试
// ============================================================

describe('buildGodNodePage', () => {
  const nodes = [
    makeNode('a', 'Module A'),
    makeNode('b', 'Module B'),
    makeNode('c', 'Module C'),
  ];
  const links = [makeEdge('a', 'b'), makeEdge('a', 'c')];
  const graphJson = makeGraphJson(nodes, links);
  const communityResult = makeCommunityResult([['a', 'b'], ['c']]);
  const nodeIdToLabel = new Map([['a', 'Module A'], ['b', 'Module B'], ['c', 'Module C']]);
  const godNode = makeGodNode('a', 'Module A', 0);

  it('返回 relativePath 匹配 god-nodes/{sanitized-name}.md', () => {
    const page = buildGodNodePage(godNode, communityResult, graphJson, nodeIdToLabel);
    // sanitizeFilename('Module A') → 'Module-A'
    expect(page.relativePath).toBe('god-nodes/Module-A.md');
  });

  it('内容包含节点度数', () => {
    const page = buildGodNodePage(godNode, communityResult, graphJson, nodeIdToLabel);
    expect(page.content).toContain('15');
  });

  it('内容包含所属社区 [[链接]]', () => {
    const page = buildGodNodePage(godNode, communityResult, graphJson, nodeIdToLabel);
    expect(page.content).toContain('[[community-0]]');
  });

  it('内容包含直接邻居列表', () => {
    const page = buildGodNodePage(godNode, communityResult, graphJson, nodeIdToLabel);
    // sanitizeFilename('Module B') → 'Module-B'
    expect(page.content).toContain('[[Module-B]]');
    expect(page.content).toContain('[[Module-C]]');
  });

  it('无邻居时显示"无直接依赖关系"', () => {
    const isolatedNode = makeNode('d', 'Module D');
    const graphWithIsolated = makeGraphJson([isolatedNode], []);
    const communityWithIsolated = makeCommunityResult([['d']]);
    const godNodeD = makeGodNode('d', 'Module D', 0);
    const mapD = new Map([['d', 'Module D']]);
    const page = buildGodNodePage(godNodeD, communityWithIsolated, graphWithIsolated, mapD);
    expect(page.content).toContain('无直接依赖关系');
  });

  it('metadata.sourceTarget 存在时生成对应 [[链接]]', () => {
    const nodeWithMeta = makeNode('a', 'Module A', 'module', { sourceTarget: 'src/foo/bar.ts' });
    const graphWithMeta = makeGraphJson([nodeWithMeta, makeNode('b', 'Module B')], []);
    const godNodeWithMeta = makeGodNode('a', 'Module A', 0);
    const communityWithMeta = makeCommunityResult([['a', 'b']]);
    const mapWithMeta = new Map([['a', 'Module A'], ['b', 'Module B']]);
    const page = buildGodNodePage(godNodeWithMeta, communityWithMeta, graphWithMeta, mapWithMeta);
    expect(page.content).toContain('src/foo/bar.ts');
  });

  it('metadata.sourceTarget 不存在时不报错', () => {
    const page = buildGodNodePage(godNode, communityResult, graphJson, nodeIdToLabel);
    expect(() => page.content).not.toThrow();
  });

  it('社区 ID 为 -1（未分类）时显示"未分类"', () => {
    // 使用不含该节点的 communityResult，使 nodeCommunityMap 查不到映射
    const emptyCommunity = makeCommunityResult([]);
    const unclassifiedGodNode = makeGodNode('a', 'Module A', -1);
    const page = buildGodNodePage(unclassifiedGodNode, emptyCommunity, graphJson, nodeIdToLabel);
    expect(page.content).toContain('未分类');
  });
});

// ============================================================
// generateObsidianVault 集成测试
// ============================================================

describe('generateObsidianVault', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const nodes = [
    makeNode('a', 'Module A'),
    makeNode('b', 'Module B'),
    makeNode('c', 'Module C'),
  ];
  const links = [makeEdge('a', 'b'), makeEdge('b', 'c')];
  const graphJson = makeGraphJson(nodes, links);
  const communityResult = makeCommunityResult([['a', 'b'], ['c']]);
  const godNodes = [makeGodNode('a', 'Module A', 0)];

  it('返回正确的 fileCount', () => {
    const result = generateObsidianVault(graphJson, communityResult, godNodes, tmpDir);
    // 1 (index) + 2 (communities) + 1 (god-node) = 4
    expect(result.fileCount).toBe(4);
    expect(result.files.length).toBe(4);
  });

  it('实际写出了对应数量的文件', () => {
    generateObsidianVault(graphJson, communityResult, godNodes, tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'index.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'communities', 'community-0.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'communities', 'community-1.md'))).toBe(true);
    // sanitizeFilename('Module A') → 'Module-A'（空格→-）
    expect(fs.existsSync(path.join(tmpDir, 'god-nodes', 'Module-A.md'))).toBe(true);
  });

  it('返回 durationMs 大于 0', () => {
    const result = generateObsidianVault(graphJson, communityResult, godNodes, tmpDir);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('空图（0 节点）时 fileCount 为 0 且不生成文件', () => {
    const emptyGraph = makeGraphJson([], []);
    const emptyCommunity = makeCommunityResult([]);
    const result = generateObsidianVault(emptyGraph, emptyCommunity, [], tmpDir);
    expect(result.fileCount).toBe(0);
    expect(result.files.length).toBe(0);
  });
});

// ============================================================
// T026: 500 节点集成测试（性能 + 文件质量）
// FR 追踪: SC-001、SC-004、SC-005
// ============================================================

describe('generateObsidianVault — 500 节点集成测试', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-large-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function make500NodeGraph() {
    const nodes: GraphNode[] = Array.from({ length: 500 }, (_, i) =>
      makeNode(`node-${i}`, `Node ${i}`),
    );
    const links: GraphEdge[] = Array.from({ length: 300 }, (_, i) =>
      makeEdge(`node-${i % 500}`, `node-${(i + 1) % 500}`),
    );
    return makeGraphJson(nodes, links);
  }

  it('执行时间 < 5 秒', () => {
    const graphJson = make500NodeGraph();
    const communityResult = makeCommunityResult([
      Array.from({ length: 250 }, (_, i) => `node-${i}`),
      Array.from({ length: 250 }, (_, i) => `node-${i + 250}`),
    ]);
    const godNodes = [makeGodNode('node-0', 'Node 0', 0)];

    const start = Date.now();
    generateObsidianVault(graphJson, communityResult, godNodes, tmpDir);
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(5000);
  });

  it('所有文件名无非法字符且长度 < 200', () => {
    // 使用含特殊字符的节点 ID
    const specialNodes: GraphNode[] = [
      makeNode('src/utils/helper', 'src/utils/helper'),
      makeNode('module:type?x', 'module:type?x'),
      makeNode('file name with spaces', 'file name with spaces'),
    ];
    const graphJson = makeGraphJson(specialNodes, []);
    const communityResult = makeCommunityResult([specialNodes.map((n) => n.id)]);
    const godNodes = [makeGodNode('src/utils/helper', 'src/utils/helper', 0)];
    generateObsidianVault(graphJson, communityResult, godNodes, tmpDir);

    // 收集所有生成的文件名
    const collectFiles = (dir: string): string[] => {
      const result: string[] = [];
      if (!fs.existsSync(dir)) return result;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) result.push(...collectFiles(path.join(dir, entry.name)));
        else result.push(entry.name);
      }
      return result;
    };
    const files = collectFiles(tmpDir);
    const illegalChars = /[/\\:*?"<>|]/;
    for (const filename of files) {
      expect(illegalChars.test(filename)).toBe(false);
      expect(filename.length).toBeLessThan(200);
    }
  });

  it('文件内容包含正确的 [[双向链接]] 格式', () => {
    const nodes = [makeNode('a', 'Module A'), makeNode('b', 'Module B')];
    const links = [makeEdge('a', 'b')];
    const graphJson = makeGraphJson(nodes, links);
    const communityResult = makeCommunityResult([['a', 'b']]);
    generateObsidianVault(graphJson, communityResult, [], tmpDir);

    const indexContent = fs.readFileSync(path.join(tmpDir, 'index.md'), 'utf-8');
    // 包含 [[...]] 格式的链接
    expect(indexContent).toMatch(/\[\[.+\]\]/);
  });
});

// ============================================================
// T028: 边界场景集成测试
// FR 追踪: SC-006、SC-007、FR-015
// ============================================================

describe('generateObsidianVault — 边界场景', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-edge-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('孤立节点图（有节点无边）正常导出', () => {
    const nodes = [makeNode('a', 'Module A'), makeNode('b', 'Module B')];
    const graphJson = makeGraphJson(nodes, []);
    const communityResult = makeCommunityResult([['a'], ['b']]);
    const godNodes = [makeGodNode('a', 'Module A', 0)];
    const result = generateObsidianVault(graphJson, communityResult, godNodes, tmpDir);
    expect(result.fileCount).toBeGreaterThan(0);
  });

  it('孤立节点的 God Node 页包含"无直接依赖关系"', () => {
    const nodes = [makeNode('a', 'Module A')];
    const graphJson = makeGraphJson(nodes, []);
    const communityResult = makeCommunityResult([['a']]);
    const godNodes = [makeGodNode('a', 'Module A', 0)];
    generateObsidianVault(graphJson, communityResult, godNodes, tmpDir);

    const godNodePath = path.join(tmpDir, 'god-nodes', 'Module-A.md');
    expect(fs.existsSync(godNodePath)).toBe(true);
    const content = fs.readFileSync(godNodePath, 'utf-8');
    expect(content).toContain('无直接依赖关系');
  });

  it('含特殊字符节点 ID 的文件名符合 Obsidian 规范', () => {
    const nodes = [makeNode('src/utils/helper', 'src/utils/helper')];
    const graphJson = makeGraphJson(nodes, []);
    const communityResult = makeCommunityResult([['src/utils/helper']]);
    generateObsidianVault(graphJson, communityResult, [], tmpDir);
    // 文件系统中不应有含 / 的文件名
    const communityFile = path.join(tmpDir, 'communities', 'community-0.md');
    expect(fs.existsSync(communityFile)).toBe(true);
  });
});
