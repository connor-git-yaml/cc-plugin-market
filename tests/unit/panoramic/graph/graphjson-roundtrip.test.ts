/**
 * Feature 214 T024 / W-4（真实入口重构）— GraphJSON write→read→write round-trip 看护
 * （SC-003a, FR-005a, NFR-002）。
 *
 * 走真实 `writeKnowledgeGraph` 写盘出口（portable 守卫 + normalizeGraphForWrite + 原子写整条链路）
 * → 读回 → 再写 → byte 比较；fixture 含 contains + 同名 member + Python canonical `::` ID。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUnifiedGraph } from '../../../../src/knowledge-graph/index.js';
import { buildKnowledgeGraph, writeKnowledgeGraph } from '../../../../src/panoramic/graph/graph-builder.js';
import type { CodeSkeleton } from '../../../../src/models/code-skeleton.js';
import type { GraphJSON } from '../../../../src/panoramic/graph/graph-types.js';

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
          { name: 'value', kind: 'setter', signature: 'value', isStatic: false },
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

describe('Feature 214 — GraphJSON write→read→write byte 稳定（真实 writeKnowledgeGraph 出口）', () => {
  let dir1: string;
  let dir2: string;
  beforeEach(() => {
    dir1 = mkdtempSync(join(tmpdir(), 'f214-gj-rt1-'));
    dir2 = mkdtempSync(join(tmpdir(), 'f214-gj-rt2-'));
    mkdirSync(join(dir1, '_meta'), { recursive: true });
    mkdirSync(join(dir2, '_meta'), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir1, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  });

  it('真实写盘→读回→再写盘 bytes 完全一致（含 contains + 同名 member + Python :: ID）', () => {
    const unified = buildUnifiedGraph({ projectRoot: '/proj', codeSkeletons: pySkeleton() });
    const gj = buildKnowledgeGraph({ unifiedGraph: unified });

    // write 1：真实出口（portable 守卫 + normalize + 原子写）
    const path1 = writeKnowledgeGraph(gj, dir1, { stripTimestamps: true });
    const bytes1 = readFileSync(path1, 'utf-8');

    // read → write 2：把读回的 GraphJSON 再走一次真实出口
    const readBack = JSON.parse(bytes1) as GraphJSON;
    const path2 = writeKnowledgeGraph(readBack, dir2, { stripTimestamps: true });
    const bytes2 = readFileSync(path2, 'utf-8');

    expect(bytes2).toEqual(bytes1);

    // 结构前置断言：contains + 无 legacy # + 同名 member 折叠
    const parsed = JSON.parse(bytes1) as GraphJSON;
    expect(parsed.links.filter((l) => l.relation === 'contains').length).toBeGreaterThan(0);
    expect(parsed.nodes.some((n) => n.id.includes('#'))).toBe(false);
    expect(parsed.nodes.filter((n) => n.id === 'pkg/model.py::Model.value')).toHaveLength(1);
  });
});
