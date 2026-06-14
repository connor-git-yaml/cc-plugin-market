/**
 * F190 T019/T020 — KB 产物隔离（SC-013）
 * 第 1、2 条在 Phase A 验：graph.json 哈希不变 + chunks.sqlite 路径在 kb/ 内。
 * 第 3 条（kb_* 工具名与 17 工具交集为空）在 Phase B（T050）补。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { buildKb } from '../../src/scaffold-kb/index.js';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'kb-iso-'));
  mkdirSync(join(workdir, 'docs'), { recursive: true });
  mkdirSync(join(workdir, '_meta'), { recursive: true });
  writeFileSync(join(workdir, 'docs', 'a.md'), '# A\n\n错误码说明 sdk.Init()。\n');
  // 模拟现有 Spectra 产物
  writeFileSync(join(workdir, '_meta', 'graph.json'), JSON.stringify({ nodes: [], edges: [] }));
});
afterEach(() => rmSync(workdir, { recursive: true, force: true }));

function hashFile(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

describe('KB 产物隔离（SC-013）', () => {
  it('buildKb 前后 _meta/graph.json 哈希不变', async () => {
    const graphPath = join(workdir, '_meta', 'graph.json');
    const before = hashFile(graphPath);
    await buildKb({ dirPath: join(workdir, 'docs'), outputPath: join(workdir, 'kb'), builtAt: 'B' });
    const after = hashFile(graphPath);
    expect(after).toBe(before);
  });

  it('chunks.sqlite 产物路径在 kb/ 内（不与现有产物路径重叠）', async () => {
    const out = join(workdir, 'kb');
    await buildKb({ dirPath: join(workdir, 'docs'), outputPath: out, builtAt: 'B' });
    const sqlitePath = join(out, 'chunks.sqlite');
    expect(existsSync(sqlitePath)).toBe(true);
    // 路径在 kb/ 内，且不等于 _meta/graph.json
    const rel = relative(out, sqlitePath);
    expect(rel.startsWith('..')).toBe(false);
    expect(sqlitePath).not.toBe(join(workdir, '_meta', 'graph.json'));
  });
});
