import { describe, it, expect } from 'vitest';
import { loadGraph, detectCommunities } from '../../src/panoramic/community/community-detector.js';

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
