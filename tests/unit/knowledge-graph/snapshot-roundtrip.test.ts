/**
 * Feature 214 T023（=plan T10）— UnifiedGraph snapshot save→load→save round-trip 看护
 * （SC-003a, FR-005a）。真实 saveSnapshot/loadSnapshotDetailed 入口，非 mock。
 *
 * fixture 含 contains 边 + 同名 member（getter/setter 折叠）+ Python canonical `::` ID，
 * 断言两次 save/load 循环后归一化结构相等。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUnifiedGraph } from '../../../src/knowledge-graph/index.js';
import {
  buildSnapshotWrapper,
  saveSnapshot,
  loadSnapshotDetailed,
} from '../../../src/knowledge-graph/persistence.js';
import type { CodeSkeleton } from '../../../src/models/code-skeleton.js';
import type { UnifiedGraph } from '../../../src/knowledge-graph/unified-graph.js';

function pySkeleton(): Map<string, CodeSkeleton> {
  const sk: CodeSkeleton = {
    filePath: 'pkg/model.py',
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
          { name: 'value', kind: 'getter', signature: 'value', isStatic: false },
          { name: 'value', kind: 'setter', signature: 'value', isStatic: false }, // 同名折叠
          { name: 'forward', kind: 'method', signature: 'forward()', isStatic: false },
        ],
      },
      { name: 'main', kind: 'function', signature: 'def main()', isDefault: false, startLine: 32, endLine: 40 },
    ],
    imports: [],
    hash: 'a'.repeat(64),
    analyzedAt: '2026-07-20T10:00:00.000Z',
    parserUsed: 'tree-sitter',
  };
  return new Map([['pkg/model.py', sk]]);
}

/** 仅比较图结构（nodes + edges），忽略 metadata.generatedAt 等墙钟字段 */
function structureOf(g: UnifiedGraph): string {
  return JSON.stringify({
    nodes: [...g.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...g.edges].sort((a, b) =>
      `${a.source}|${a.target}|${a.relation}`.localeCompare(`${b.source}|${b.target}|${b.relation}`),
    ),
  });
}

describe('Feature 214 — UnifiedGraph snapshot save→load→save round-trip', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'f214-snap-rt-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('两次 save/load 循环后图结构（含 contains + 同名 member 折叠 + Python :: ID）字节稳定', async () => {
    const graph = buildUnifiedGraph({ projectRoot: tmpRoot, codeSkeletons: pySkeleton() });

    // 前置断言：canonical `::` ID + contains + 同名 member 折叠
    expect(graph.nodes.some((n) => n.id === 'pkg/model.py::Model')).toBe(true);
    expect(graph.nodes.filter((n) => n.id === 'pkg/model.py::Model.value')).toHaveLength(1); // getter/setter 折叠
    expect(graph.nodes.some((n) => n.id.includes('#'))).toBe(false); // 无 legacy #
    const containsCount = graph.edges.filter((e) => e.relation === 'contains').length;
    expect(containsCount).toBeGreaterThan(0);

    // save→load 循环 1
    await saveSnapshot(buildSnapshotWrapper(graph, {}), tmpRoot);
    const load1 = await loadSnapshotDetailed(tmpRoot);
    expect(load1.reason).toBe('ok');
    // save→load 循环 2（把 load1 再存一次）
    await saveSnapshot(buildSnapshotWrapper(load1.snapshot!.graph, {}), tmpRoot);
    const load2 = await loadSnapshotDetailed(tmpRoot);
    expect(load2.reason).toBe('ok');

    expect(structureOf(load2.snapshot!.graph)).toEqual(structureOf(load1.snapshot!.graph));
    // contains 边计数经 round-trip 不变
    expect(load2.snapshot!.graph.edges.filter((e) => e.relation === 'contains')).toHaveLength(containsCount);
  });
});
