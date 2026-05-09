/**
 * Feature 156 W3 T-032 — incremental.ts 单测（≥ 6 条）
 *
 * 覆盖：
 *   I-1：gitDiff 解析 git diff --name-only HEAD 输出（在临时 git repo 中真实跑）
 *   I-2：expandCallers depth=1 反向扩展直接 caller
 *   I-3：mergeIncremental 节点 / 边替换 + fileHashes 三态正确（修改 / 新增 / 删除）
 *   I-4：buildIncremental 无 snapshot fallback to full（reason='no-snapshot'）
 *   I-5：buildIncremental snapshot corruption fallback（reason='corruption'）
 *   I-6：expandCallers depth>1 BFS 多跳（验证 clarify Q3 接口预留）
 *   I-7：buildIncremental 空 diff（changedFilesOverride=[]）保持 snapshot 不变（AC-4 跨 run 复用）
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildIncremental,
  expandCallers,
  gitDiff,
  mergeIncremental,
} from '../../../src/knowledge-graph/incremental.js';
import {
  buildSnapshotWrapper,
  loadSnapshot,
  saveSnapshot,
  snapshotPath,
  type SnapshotWrapper,
} from '../../../src/knowledge-graph/persistence.js';
import { bootstrapAdapters } from '../../../src/adapters/index.js';
import type { UnifiedGraph } from '../../../src/knowledge-graph/unified-graph.js';

beforeAll(() => {
  bootstrapAdapters();
});

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'spectra-w3-incremental-'));
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

// ─── helpers ───

/** 构造一个最小可用 SnapshotWrapper，含给定 file 的 module 节点 */
function mkSnapshot(
  projectRoot: string,
  files: Array<{ path: string; hash?: string }>,
  edges: Array<{ source: string; target: string; relation?: 'depends-on' | 'calls' }> = [],
): SnapshotWrapper {
  const graph: UnifiedGraph = {
    nodes: files.map((f) => ({
      id: f.path,
      label: path.basename(f.path),
      kind: 'module' as const,
      filePath: f.path,
    })),
    edges: edges.map((e) => ({
      source: e.source,
      target: e.target,
      relation: e.relation ?? 'depends-on',
      confidence: 'high' as const,
      directional: true,
    })),
    metadata: {
      generatedAt: new Date().toISOString(),
      projectRoot,
      schemaVersion: '1.0',
    },
  };
  const fileHashes: Record<string, string> = {};
  for (const f of files) fileHashes[f.path] = f.hash ?? 'h_' + path.basename(f.path);
  return buildSnapshotWrapper(graph, fileHashes);
}

// ───────────────────────────────────────────────────────────
// I-1: gitDiff 解析（真实 git repo）
// ───────────────────────────────────────────────────────────

describe('gitDiff', () => {
  it('I-1：在临时 git repo 中正确解析 git diff --name-only HEAD 输出', async () => {
    // 1. 初始化 git repo + 1 个 commit
    execSync('git init -q', { cwd: tmpRoot });
    execSync('git config user.email "t@t.test"', { cwd: tmpRoot });
    execSync('git config user.name "t"', { cwd: tmpRoot });
    await fsp.writeFile(path.join(tmpRoot, 'a.ts'), 'export const a = 1;\n');
    await fsp.writeFile(path.join(tmpRoot, 'b.ts'), 'export const b = 1;\n');
    execSync('git add -A', { cwd: tmpRoot });
    execSync('git commit -q -m init', { cwd: tmpRoot });

    // 2. 修改两个文件
    await fsp.writeFile(path.join(tmpRoot, 'a.ts'), 'export const a = 2;\n');
    await fsp.writeFile(path.join(tmpRoot, 'b.ts'), 'export const b = 2;\n');

    // 3. gitDiff 应取到这两个绝对路径
    const result = await gitDiff({ projectRoot: tmpRoot });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
    // tmpRoot 在 macOS 可能含 /private/var → /var symlink，比 basename 更稳
    const basenames = result!.map((p) => path.basename(p)).sort();
    expect(basenames).toEqual(['a.ts', 'b.ts']);
  });

  it('I-1b：非 git 目录返回 null', async () => {
    const result = await gitDiff({ projectRoot: tmpRoot });
    expect(result).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────
// I-2 / I-6: expandCallers
// ───────────────────────────────────────────────────────────

describe('expandCallers', () => {
  it('I-2：depth=1 反向扩展直接 caller（a.ts → b.ts，改 b 时 a 应被 expand）', () => {
    const a = path.join(tmpRoot, 'a.ts');
    const b = path.join(tmpRoot, 'b.ts');
    const snapshot = mkSnapshot(
      tmpRoot,
      [{ path: a }, { path: b }],
      [{ source: a, target: b, relation: 'depends-on' }],
    );
    const expanded = expandCallers({
      changedFiles: [b],
      snapshot,
      depth: 1,
    });
    expect(expanded.sort()).toEqual([a, b].sort());
  });

  it('I-6：depth>1 BFS 多跳扩展（a → b → c，改 c，depth=2 应取到 a）', () => {
    const a = path.join(tmpRoot, 'a.ts');
    const b = path.join(tmpRoot, 'b.ts');
    const c = path.join(tmpRoot, 'c.ts');
    const snapshot = mkSnapshot(
      tmpRoot,
      [{ path: a }, { path: b }, { path: c }],
      [
        { source: a, target: b, relation: 'depends-on' },
        { source: b, target: c, relation: 'depends-on' },
      ],
    );

    const depth1 = expandCallers({ changedFiles: [c], snapshot, depth: 1 });
    expect(depth1.sort()).toEqual([b, c].sort()); // 仅一跳

    const depth2 = expandCallers({ changedFiles: [c], snapshot, depth: 2 });
    expect(depth2.sort()).toEqual([a, b, c].sort()); // 两跳取到 a
  });

  it('I-2b：无 caller 时仅返回 changed 自身', () => {
    const a = path.join(tmpRoot, 'a.ts');
    const snapshot = mkSnapshot(tmpRoot, [{ path: a }], []);
    const expanded = expandCallers({ changedFiles: [a], snapshot });
    expect(expanded).toEqual([a]);
  });
});

// ───────────────────────────────────────────────────────────
// I-3: mergeIncremental 节点 / 边替换 + fileHashes 三态
// ───────────────────────────────────────────────────────────

describe('mergeIncremental', () => {
  it('I-3：修改 1 文件 + 新增 1 文件 + 删除 1 文件 — 节点 / 边 / hash 三态正确', () => {
    const a = path.join(tmpRoot, 'a.ts');
    const b = path.join(tmpRoot, 'b.ts');
    const c = path.join(tmpRoot, 'c.ts');
    const d = path.join(tmpRoot, 'd.ts'); // 新增

    const oldSnapshot = mkSnapshot(
      tmpRoot,
      [
        { path: a, hash: 'h_a_old' },
        { path: b, hash: 'h_b_old' },
        { path: c, hash: 'h_c_old' },
      ],
      [
        { source: a, target: b, relation: 'depends-on' }, // a → b（改 b 时应该消失）
        { source: a, target: c, relation: 'depends-on' }, // a → c（不变；c 不在 changedSet）
      ],
    );

    // changedSet = { b（修改）, d（新增）, c（删除）}
    // newPartialGraph：b 节点 + 新边 b → d，d 节点
    const newPartial: UnifiedGraph = {
      nodes: [
        { id: b, label: 'b.ts', kind: 'module', filePath: b },
        { id: d, label: 'd.ts', kind: 'module', filePath: d },
      ],
      edges: [
        { source: b, target: d, relation: 'depends-on', confidence: 'high', directional: true },
      ],
      metadata: { generatedAt: new Date().toISOString(), projectRoot: tmpRoot, schemaVersion: '1.0' },
    };

    const merged = mergeIncremental({
      oldSnapshot,
      changedSet: new Set([b, d, c]),
      newPartialGraph: newPartial,
      newFileHashes: { [b]: 'h_b_new', [d]: 'h_d_new' }, // c 不在 → 视为 deleted
    });

    // 节点：a 保留 + b 重写 + d 新增；c 移除（在 changedSet 内）
    const nodeFiles = merged.graph.nodes.map((n) => n.filePath).sort();
    expect(nodeFiles).toEqual([a, b, d].sort());

    // 边：a→b 因 b 是 owningId 被移除；a→c 因 c 是 owningId 被移除（deletion 不留孤儿）
    // 新边 b→d 加入。所以最终只有 b→d。
    expect(merged.graph.edges).toHaveLength(1);
    expect(merged.graph.edges[0].source).toBe(b);
    expect(merged.graph.edges[0].target).toBe(d);

    // fileHashes：a 保留旧值 / b 更新 / d 新增 / c 删除
    expect(merged.fileHashes[a]).toBe('h_a_old');
    expect(merged.fileHashes[b]).toBe('h_b_new');
    expect(merged.fileHashes[d]).toBe('h_d_new');
    expect(merged.fileHashes[c]).toBeUndefined();
  });

  it('I-3b：未变更文件的节点 / 边 / hash 完全不变', () => {
    const a = path.join(tmpRoot, 'a.ts');
    const b = path.join(tmpRoot, 'b.ts');
    const oldSnapshot = mkSnapshot(
      tmpRoot,
      [
        { path: a, hash: 'h_a' },
        { path: b, hash: 'h_b' },
      ],
      [{ source: a, target: b, relation: 'depends-on' }],
    );
    const merged = mergeIncremental({
      oldSnapshot,
      changedSet: new Set(),
      newPartialGraph: {
        nodes: [],
        edges: [],
        metadata: { generatedAt: new Date().toISOString(), projectRoot: tmpRoot, schemaVersion: '1.0' },
      },
      newFileHashes: {},
    });
    expect(merged.graph.nodes).toHaveLength(2);
    expect(merged.graph.edges).toHaveLength(1);
    expect(merged.fileHashes[a]).toBe('h_a');
    expect(merged.fileHashes[b]).toBe('h_b');
  });
});

// ───────────────────────────────────────────────────────────
// I-4 / I-5: buildIncremental fallback
// ───────────────────────────────────────────────────────────

describe('buildIncremental fallback', () => {
  it('I-4：无 snapshot 时 fallbackToFull=true / reason="no-snapshot"', async () => {
    // 没创建 .spectra/，loadSnapshot 返回 null
    await fsp.writeFile(path.join(tmpRoot, 'sample.ts'), 'export const x = 1;\n');
    const result = await buildIncremental({
      projectRoot: tmpRoot,
      changedFilesOverride: [],
      disableShallowFallback: true,
    });
    expect(result.fallbackToFull).toBe(true);
    expect(result.fallbackReason).toBe('no-snapshot');
    // 全量 reindex 后 snapshot 应被写入
    const snap = await loadSnapshot(tmpRoot);
    expect(snap).not.toBeNull();
  });

  it('I-5：snapshot 文件被损坏（无效 JSON）→ fallbackReason="no-snapshot"（loadSnapshot 返回 null）', async () => {
    // 写一份损坏的 .spectra/unified-graph.json
    const target = snapshotPath(tmpRoot);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, '{ not valid json', 'utf-8');
    await fsp.writeFile(path.join(tmpRoot, 'x.ts'), 'export const x = 1;\n');

    const result = await buildIncremental({
      projectRoot: tmpRoot,
      changedFilesOverride: [],
      disableShallowFallback: true,
    });
    // loadSnapshot 损坏返回 null，buildIncremental 视为 'no-snapshot'（与 spec EC-3 / EC-8 一致）
    expect(result.fallbackToFull).toBe(true);
    expect(result.fallbackReason).toBe('no-snapshot');
  });
});

// ───────────────────────────────────────────────────────────
// I-7: 空 diff 跨 run 复用（AC-4）
// ───────────────────────────────────────────────────────────

describe('buildIncremental cross-run reuse', () => {
  it('I-7：第二次 buildIncremental 在 changedFilesOverride=[] 时不重新索引（changedFiles=0）', async () => {
    // 1. 准备 fixture + 跑一次 full（用 buildIncremental 的 fallback 路径触发）
    await fsp.writeFile(path.join(tmpRoot, 'a.ts'), 'export const a = 1;\n');
    const r1 = await buildIncremental({
      projectRoot: tmpRoot,
      changedFilesOverride: [],
      disableShallowFallback: true,
    });
    expect(r1.fallbackToFull).toBe(true); // 首次：no-snapshot 触发 full
    const snap1 = await loadSnapshot(tmpRoot);
    expect(snap1).not.toBeNull();
    const generatedAt1 = snap1!.generatedAt;

    // 2. 第二次：snapshot 已在 + override=[] → 应直接返回，不重新索引
    const r2 = await buildIncremental({
      projectRoot: tmpRoot,
      changedFilesOverride: [],
      disableShallowFallback: true,
    });
    expect(r2.fallbackToFull).toBe(false);
    expect(r2.changedFiles).toEqual([]);

    // snapshot 文件内的 generatedAt 不应被重写（buildIncremental 空 diff 短路不调 saveSnapshot）
    const snap2 = await loadSnapshot(tmpRoot);
    expect(snap2!.generatedAt).toBe(generatedAt1);
  });
});
