/**
 * Feature 214 T025（=plan T12）— Python class/member 跨 worktree byte 一致（NFR-001, F193）。
 *
 * 现有 cross-worktree-byte / snapshot-portability 均 TS-only；本测试补 Python 路径：
 * 含 Python class/member 的 fixture 在双 root（/a、/b）建图 → 相对化后 nodes/edges bytes 完全一致。
 */
import { describe, it, expect } from 'vitest';
import { buildUnifiedGraph } from '../../../src/knowledge-graph/index.js';
import type { CodeSkeleton } from '../../../src/models/code-skeleton.js';
import type { UnifiedGraph } from '../../../src/knowledge-graph/unified-graph.js';

/** 在给定绝对 root 下构造含 Python class/member 的 skeleton（filePath 绝对） */
function pySkeletonAt(root: string): Map<string, CodeSkeleton> {
  const abs = `${root}/pkg/model.py`;
  const sk: CodeSkeleton = {
    filePath: abs,
    language: 'python',
    loc: 100,
    exports: [
      {
        name: 'Model',
        kind: 'class',
        signature: 'class Model',
        isDefault: false,
        startLine: 1,
        endLine: 30,
        members: [
          { name: 'forward', kind: 'method', signature: 'forward()', isStatic: false },
          { name: 'shape', kind: 'property', signature: 'shape', isStatic: false },
          { name: 'from_config', kind: 'classmethod', signature: 'from_config()', isStatic: true },
        ],
      },
      { name: 'main', kind: 'function', signature: 'def main()', isDefault: false, startLine: 32, endLine: 40 },
    ],
    imports: [],
    hash: 'a'.repeat(64),
    analyzedAt: '2026-07-20T10:00:00.000Z',
    parserUsed: 'tree-sitter',
  };
  return new Map([[abs, sk]]);
}

/** 序列化 nodes+edges（忽略 metadata.generatedAt/projectRoot 墙钟差异） */
function portableBytes(g: UnifiedGraph): string {
  return JSON.stringify({
    nodes: [...g.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...g.edges].sort((a, b) =>
      `${a.source}|${a.target}|${a.relation}`.localeCompare(`${b.source}|${b.target}|${b.relation}`),
    ),
  });
}

describe('Feature 214 — Python class/member 跨 worktree byte 一致（F193）', () => {
  it('双 root /a、/b 建图相对化后 nodes/edges bytes 完全一致', () => {
    const rootA = '/Users/dev/worktree-a';
    const rootB = '/tmp/ci/deep/nested/worktree-b';
    const gA = buildUnifiedGraph({ projectRoot: rootA, codeSkeletons: pySkeletonAt(rootA) });
    const gB = buildUnifiedGraph({ projectRoot: rootB, codeSkeletons: pySkeletonAt(rootB) });

    // 相对化后所有 id 均为 repo-relative POSIX（无绝对前缀、无 root 泄漏）
    for (const g of [gA, gB]) {
      for (const n of g.nodes) {
        expect(n.id.startsWith('/')).toBe(false);
      }
    }
    // Python canonical `::` + contains 边覆盖
    expect(gA.nodes.some((n) => n.id === 'pkg/model.py::Model.forward')).toBe(true);
    expect(gA.edges.filter((e) => e.relation === 'contains').length).toBeGreaterThan(0);

    expect(portableBytes(gB)).toEqual(portableBytes(gA));
  });
});
