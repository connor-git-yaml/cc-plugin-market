import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadGraph, detectCommunities } from '../../src/panoramic/community/community-detector.js';
import { writeKnowledgeGraph } from '../../src/panoramic/graph/index.js';
import {
  computeCollectorFingerprint,
  isValidCollectorFingerprint,
} from '../../src/panoramic/graph/collector-fingerprint.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';

describe('community ID 持久化逻辑', () => {
  it('detectCommunities 后将社区 ID 注入 graphJson.nodes[].metadata.community', () => {
    // 构造最小 GraphJSON fixture（5 节点，几条边）
    const graphJson = {
      directed: false,
      nodes: [
        { id: 'node-a', label: 'node-a', kind: 'module' as const, metadata: { description: 'node a' } },
        { id: 'node-b', label: 'node-b', kind: 'module' as const, metadata: { description: 'node b' } },
        { id: 'node-c', label: 'node-c', kind: 'module' as const, metadata: { description: 'node c' } },
        { id: 'node-d', label: 'node-d', kind: 'module' as const, metadata: { description: 'node d' } },
        { id: 'node-e', label: 'node-e', kind: 'module' as const, metadata: { description: 'node e' } },
      ],
      links: [
        { source: 'node-a', target: 'node-b', relation: 'import' as const, confidence: 1 },
        { source: 'node-b', target: 'node-c', relation: 'import' as const, confidence: 1 },
        { source: 'node-c', target: 'node-a', relation: 'import' as const, confidence: 1 },
        { source: 'node-d', target: 'node-e', relation: 'import' as const, confidence: 1 },
      ],
    };

    // 模拟 community.ts 的持久化逻辑
    const g = loadGraph(graphJson as any);
    const { nodeCommunityMap } = detectCommunities(g);

    // 将社区 ID 注入节点 metadata
    for (const node of graphJson.nodes) {
      const communityId = nodeCommunityMap.get(node.id);
      if (communityId !== undefined) {
        node.metadata['community'] = String(communityId);
      }
    }

    // 验证每个节点都有 metadata.community 字段
    for (const node of graphJson.nodes) {
      expect(node.metadata['community']).toBeDefined();
      expect(typeof node.metadata['community']).toBe('string');
      expect((node.metadata['community'] as string).length).toBeGreaterThan(0);
    }
  });

  it('nodeCommunityMap 覆盖所有节点', () => {
    const graphJson = {
      directed: false,
      nodes: [
        { id: 'a', label: 'a', kind: 'module' as const, metadata: {} },
        { id: 'b', label: 'b', kind: 'module' as const, metadata: {} },
        { id: 'c', label: 'c', kind: 'module' as const, metadata: {} },
      ],
      links: [
        { source: 'a', target: 'b', relation: 'import' as const, confidence: 1 },
      ],
    };

    const g = loadGraph(graphJson as any);
    const { nodeCommunityMap } = detectCommunities(g);

    // 所有节点都应该有对应的社区 ID
    for (const node of graphJson.nodes) {
      expect(nodeCommunityMap.has(node.id)).toBe(true);
      const communityId = nodeCommunityMap.get(node.id);
      expect(communityId).not.toBeUndefined();
      // 社区 ID 应为数字
      expect(typeof communityId).toBe('number');
    }
  });

  it('将社区 ID 转换为字符串写入 metadata', () => {
    const graphJson = {
      directed: false,
      nodes: [
        { id: 'x', label: 'x', kind: 'module' as const, metadata: {} },
        { id: 'y', label: 'y', kind: 'module' as const, metadata: {} },
      ],
      links: [
        { source: 'x', target: 'y', relation: 'import' as const, confidence: 1 },
      ],
    };

    const g = loadGraph(graphJson as any);
    const { nodeCommunityMap } = detectCommunities(g);

    for (const node of graphJson.nodes) {
      const communityId = nodeCommunityMap.get(node.id);
      if (communityId !== undefined) {
        node.metadata['community'] = String(communityId);
      }
    }

    // 确认写入的是字符串类型（不是数字）
    for (const node of graphJson.nodes) {
      if (node.metadata['community'] !== undefined) {
        expect(typeof node.metadata['community']).toBe('string');
        // 字符串应该是有效数字
        expect(isNaN(Number(node.metadata['community']))).toBe(false);
      }
    }
  });
});

/**
 * F249 I-001：community 写回链路 MUST 原样保留 `graph.fingerprint`。
 *
 * 风险形态：`spectra community` 是**第三条写盘路径**——它 `JSON.parse` 已有 graph.json、只往
 * 节点 metadata 里塞 community id，然后整份 `writeKnowledgeGraph` 回去。指纹由建图链路
 * （batch / graph-only）写入，community 自己**不**计算指纹；因此只要写盘出口的归一化把这个
 * "它不认识的字段"剥掉，跑一次 community 就会把一张有指纹的图降级成 `unrecorded`——
 * 而 freshness 会因此把它判 stale，表现为"我什么都没改，图怎么就过期了"。
 *
 * 这条回归测试直接跑真实写盘出口（不是模拟），断言指纹字节级存活。
 */
describe('F249 I-001：writeKnowledgeGraph（community 写回出口）保留 collector fingerprint', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** 带指纹 + sourceCommit 的最小合法图（模拟建图链路刚写出的产物）。 */
  function graphWithFingerprint(): GraphJSON {
    return {
      directed: false,
      multigraph: false,
      graph: {
        name: 'spectra-knowledge-graph',
        generatedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 2,
        edgeCount: 1,
        sources: ['unified-graph'],
        schemaVersion: '2.0',
        sourceCommit: 'a'.repeat(40),
        fingerprint: computeCollectorFingerprint(),
      },
      nodes: [
        { id: 'src/a.ts', label: 'a', kind: 'module', metadata: {} },
        { id: 'src/b.ts', label: 'b', kind: 'module', metadata: {} },
      ],
      links: [{ source: 'src/a.ts', target: 'src/b.ts', relation: 'import', confidence: 'EXTRACTED' }],
    } as unknown as GraphJSON;
  }

  it('注入 community metadata 后写回，重新读出的 graph.fingerprint 与写入前深相等且仍合法', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-community-writeback-'));
    tmpDirs.push(outputDir);

    const graphJson = graphWithFingerprint();
    const before = structuredClone(graphJson.graph.fingerprint);

    // 复刻 src/cli/commands/community.ts 的写回步骤：改节点 metadata → writeKnowledgeGraph
    const g = loadGraph(graphJson);
    const { nodeCommunityMap } = detectCommunities(g);
    for (const node of graphJson.nodes) {
      const communityId = nodeCommunityMap.get(node.id);
      if (communityId !== undefined) node.metadata['community'] = String(communityId);
    }
    const writtenPath = writeKnowledgeGraph(graphJson, outputDir);

    const reloaded = JSON.parse(fs.readFileSync(writtenPath, 'utf-8')) as GraphJSON;
    expect(reloaded.graph.fingerprint).toEqual(before);
    expect(isValidCollectorFingerprint(reloaded.graph.fingerprint)).toBe(true);
    // sourceCommit 同为 provenance 字段，一并锁定（两者一起丢才是最难察觉的形态）
    expect(reloaded.graph.sourceCommit).toBe('a'.repeat(40));
    // 活性对照：community 注入确实发生了（否则这条测试可能测的是一张没被改过的图）
    expect(reloaded.nodes.some((node) => node.metadata['community'] !== undefined)).toBe(true);
  });
});
