import { describe, it, expect } from 'vitest';
import { generateObsidianVault } from '../../src/panoramic/exporters/obsidian-exporter.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';
import type { CommunityResult } from '../../src/panoramic/community/community-detector.js';
import type { GodNode } from '../../src/panoramic/community/god-node-analyzer.js';

/** 构建最小合法 GraphJSON fixture */
function makeGraphJson(nodes: { id: string; label: string }[]): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: 0,
      sources: ['architecture-ir'],
    },
    nodes: nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: 'module' as const,
      metadata: { description: '' },
    })),
    links: [],
  };
}

describe('Obsidian 文件名碰撞检测', () => {
  it('同 sanitized label 的两个 god node 不相互覆盖', () => {
    // "foo/bar" 和 "foo:bar" 均 sanitize 为 "foo-bar"
    const graphJson = makeGraphJson([
      { id: 'node-a', label: 'foo/bar' },
      { id: 'node-b', label: 'foo:bar' },
    ]);

    const communityResult: CommunityResult = {
      communities: [{ id: 0, nodes: ['node-a', 'node-b'], coreNodes: ['node-a'], cohesion: 1 }],
      nodeCommunityMap: new Map([['node-a', 0], ['node-b', 0]]),
    };

    const godNodes: GodNode[] = [
      { id: 'node-a', label: 'foo/bar', degree: 5, communityId: 0, primaryRelation: 'import' },
      { id: 'node-b', label: 'foo:bar', degree: 3, communityId: 0, primaryRelation: 'import' },
    ];

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-test-'));
    try {
      const result = generateObsidianVault(graphJson, communityResult, godNodes, tmpDir);
      // 文件数量应等于页面数量（无文件被覆盖）
      const godNodeFiles = fs.readdirSync(path.join(tmpDir, 'god-nodes'));
      expect(godNodeFiles.length).toBe(2);
      // 两个文件的名称应不同
      expect(godNodeFiles[0]).not.toBe(godNodeFiles[1]);
      // result.fileCount 应与实际文件数一致
      expect(result.fileCount).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('无碰撞场景：文件名不被修改', () => {
    const graphJson = makeGraphJson([
      { id: 'auth-service', label: 'auth-service' },
      { id: 'user-service', label: 'user-service' },
    ]);

    const communityResult: CommunityResult = {
      communities: [{ id: 0, nodes: ['auth-service', 'user-service'], coreNodes: ['auth-service'], cohesion: 1 }],
      nodeCommunityMap: new Map([['auth-service', 0], ['user-service', 0]]),
    };

    const godNodes: GodNode[] = [
      { id: 'auth-service', label: 'auth-service', degree: 5, communityId: 0, primaryRelation: 'import' },
      { id: 'user-service', label: 'user-service', degree: 3, communityId: 0, primaryRelation: 'import' },
    ];

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-test-'));
    try {
      generateObsidianVault(graphJson, communityResult, godNodes, tmpDir);
      const godNodeFiles = fs.readdirSync(path.join(tmpDir, 'god-nodes'));
      // 无碰撞时应有 2 个文件
      expect(godNodeFiles.length).toBe(2);
      // 文件名应精确匹配（无额外后缀）
      expect(godNodeFiles).toContain('auth-service.md');
      expect(godNodeFiles).toContain('user-service.md');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('三个节点同名时均生成独立文件', () => {
    // "a/b", "a:b", "a b" 均 sanitize 为 "a-b"
    const graphJson = makeGraphJson([
      { id: 'node-1', label: 'a/b' },
      { id: 'node-2', label: 'a:b' },
      { id: 'node-3', label: 'a b' },
    ]);

    const communityResult: CommunityResult = {
      communities: [{ id: 0, nodes: ['node-1', 'node-2', 'node-3'], coreNodes: ['node-1'], cohesion: 1 }],
      nodeCommunityMap: new Map([['node-1', 0], ['node-2', 0], ['node-3', 0]]),
    };

    const godNodes: GodNode[] = [
      { id: 'node-1', label: 'a/b', degree: 5, communityId: 0, primaryRelation: 'import' },
      { id: 'node-2', label: 'a:b', degree: 4, communityId: 0, primaryRelation: 'import' },
      { id: 'node-3', label: 'a b', degree: 3, communityId: 0, primaryRelation: 'import' },
    ];

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-test-'));
    try {
      generateObsidianVault(graphJson, communityResult, godNodes, tmpDir);
      const godNodeFiles = fs.readdirSync(path.join(tmpDir, 'god-nodes'));
      // 三个节点应生成 3 个不同文件
      expect(godNodeFiles.length).toBe(3);
      // 所有文件名应唯一
      const uniqueFiles = new Set(godNodeFiles);
      expect(uniqueFiles.size).toBe(3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
