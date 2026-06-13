/**
 * Feature 156 W2 T-027 — persistence.ts 单测（P-1 ~ P-6）
 *
 * 覆盖 spec FR-1 ~ FR-5 + AC-8 + EC-8 corruption + EC-9 rename-delete + EC-11 多进程：
 *   P-1：save → load roundtrip 字段等价
 *   P-2：load corruption 降级 → null
 *   P-3：detectStaleFiles 在文件 hash 变更时返回 stale
 *   P-4：loadSnapshot 在 .spectra 不存在时返回 null
 *   P-5：多进程并发 save，最终 load 仍能 safeParse 成功（最后写者胜，不损坏）
 *   P-6：UnifiedEdge.metadata 字段经 save → load roundtrip 后保留
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  buildSnapshotWrapper,
  computeFileHash,
  detectStaleFiles,
  loadSnapshot,
  saveSnapshot,
  snapshotPath,
  SnapshotWrapperSchema,
  type SnapshotWrapper,
} from '../../../src/knowledge-graph/persistence.js';
import type { UnifiedGraph } from '../../../src/knowledge-graph/index.js';

// ───────────────────────────────────────────────────────────
// 测试夹具
// ───────────────────────────────────────────────────────────

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'spectra-persistence-'));
});

afterEach(async () => {
  // 清理 tmp 目录
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

/** 构造一个最小可用的 UnifiedGraph fixture */
function mkGraph(): UnifiedGraph {
  return {
    nodes: [
      {
        id: '/proj/a.ts',
        label: 'a.ts',
        kind: 'module',
        language: 'typescript',
        filePath: '/proj/a.ts',
      },
      {
        id: '/proj/b.ts',
        label: 'b.ts',
        kind: 'module',
        language: 'typescript',
        filePath: '/proj/b.ts',
      },
    ],
    edges: [
      {
        source: '/proj/a.ts',
        target: '/proj/b.ts',
        relation: 'depends-on',
        confidence: 'high',
        directional: true,
        evidence: './b',
      },
    ],
    metadata: {
      generatedAt: '2026-05-09T10:00:00.000Z',
      projectRoot: '/proj',
      schemaVersion: '1.0',
    },
  };
}

// ───────────────────────────────────────────────────────────
// P-1：save → load roundtrip
// ───────────────────────────────────────────────────────────

describe('persistence — P-1 save/load roundtrip', () => {
  it('完整 SnapshotWrapper 写盘后读回字段等价', async () => {
    const graph = mkGraph();
    const fileHashes: Record<string, string> = {
      '/proj/a.ts': 'a'.repeat(64),
      '/proj/b.ts': 'b'.repeat(64),
    };
    const snapshot = buildSnapshotWrapper(graph, fileHashes);

    await saveSnapshot(snapshot, tmpRoot);

    const loaded = await loadSnapshot(tmpRoot);
    expect(loaded).not.toBeNull();
    // Feature 193：SNAPSHOT_WRAPPER_VERSION bump '1.0' → '2.0'
    expect(loaded!.schemaVersion).toBe('2.0');
    expect(loaded!.fileHashes).toEqual(fileHashes);
    expect(loaded!.graph.nodes).toHaveLength(2);
    expect(loaded!.graph.edges).toHaveLength(1);
    expect(loaded!.graph.edges[0]!.source).toBe('/proj/a.ts');
    expect(loaded!.graph.edges[0]!.target).toBe('/proj/b.ts');
    // 内嵌 graph.metadata.schemaVersion 是 UnifiedGraph 自身版本（解耦于 wrapper 版本），仍 '1.0'
    expect(loaded!.graph.metadata.schemaVersion).toBe('1.0');

    // 文件确实被写到 .spectra/unified-graph.json
    expect(fs.existsSync(snapshotPath(tmpRoot))).toBe(true);
  });

  it('SnapshotWrapperSchema.safeParse 应通过', async () => {
    const snapshot = buildSnapshotWrapper(mkGraph(), {});
    await saveSnapshot(snapshot, tmpRoot);
    const raw = await fsp.readFile(snapshotPath(tmpRoot), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    const result = SnapshotWrapperSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────
// P-2：corruption 降级
// ───────────────────────────────────────────────────────────

describe('persistence — P-2 corruption 降级', () => {
  it('JSON 解析失败时 loadSnapshot 返回 null（不抛错）', async () => {
    const target = snapshotPath(tmpRoot);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, '{not valid json', 'utf-8');

    const loaded = await loadSnapshot(tmpRoot);
    expect(loaded).toBeNull();
  });

  it('schema 校验失败时 loadSnapshot 返回 null', async () => {
    const target = snapshotPath(tmpRoot);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    // 合法 JSON 但缺 graph 字段
    await fsp.writeFile(
      target,
      JSON.stringify({ schemaVersion: '1.0', generatedAt: '2026-05-09T10:00:00.000Z' }),
      'utf-8',
    );

    const loaded = await loadSnapshot(tmpRoot);
    expect(loaded).toBeNull();
  });

  it('schemaVersion 不匹配时 loadSnapshot 返回 null（EC-3）', async () => {
    const target = snapshotPath(tmpRoot);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const bad: Record<string, unknown> = {
      schemaVersion: '0.9', // 非 '1.0'
      generatedAt: '2026-05-09T10:00:00.000Z',
      graph: mkGraph(),
      fileHashes: {},
    };
    await fsp.writeFile(target, JSON.stringify(bad), 'utf-8');

    const loaded = await loadSnapshot(tmpRoot);
    expect(loaded).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────
// P-3：stale 检测
// ───────────────────────────────────────────────────────────

describe('persistence — P-3 stale 检测', () => {
  // Feature 193 决策 1b：snapshot.fileHashes key = repo-relative POSIX（持久化域）；
  // detectStaleFiles 入参 currentFiles = 绝对（IO 域），返回 = 绝对。第三参 = projectRoot。
  it('文件内容修改后 detectStaleFiles 返回该文件路径', async () => {
    const fileA = path.join(tmpRoot, 'a.ts');
    await fsp.writeFile(fileA, 'export const a = 1;\n', 'utf-8');
    const hashV1 = await computeFileHash(fileA);
    expect(hashV1).not.toBeNull();

    // 持久化域 key（相对 tmpRoot）
    const snapshot: SnapshotWrapper = buildSnapshotWrapper(mkGraph(), {
      'a.ts': hashV1!,
    });

    // 未修改 → 不 stale
    const stale1 = await detectStaleFiles(snapshot, [fileA], tmpRoot);
    expect(stale1).toEqual([]);

    // 修改文件内容
    await fsp.writeFile(fileA, 'export const a = 2;\n', 'utf-8');
    const stale2 = await detectStaleFiles(snapshot, [fileA], tmpRoot);
    expect(stale2).toContain(fileA);
  });

  it('文件被删除时 detectStaleFiles 把旧路径标为 stale（EC-9）', async () => {
    const fileA = path.join(tmpRoot, 'deleted.ts');
    await fsp.writeFile(fileA, 'x', 'utf-8');
    const hash = await computeFileHash(fileA);
    const snapshot: SnapshotWrapper = buildSnapshotWrapper(mkGraph(), {
      'deleted.ts': hash!,
    });

    // 模拟 rename / delete
    await fsp.rm(fileA);

    const stale = await detectStaleFiles(snapshot, [], tmpRoot);
    // deleted 旧相对 key 转回绝对路径返回（IO 域）
    expect(stale).toContain(fileA);
  });

  it('新增文件（snapshot 中无记录）应被标为 stale', async () => {
    const fileNew = path.join(tmpRoot, 'new.ts');
    await fsp.writeFile(fileNew, 'export const x = 1;', 'utf-8');
    const snapshot: SnapshotWrapper = buildSnapshotWrapper(mkGraph(), {});

    const stale = await detectStaleFiles(snapshot, [fileNew], tmpRoot);
    expect(stale).toContain(fileNew);
  });
});

// ───────────────────────────────────────────────────────────
// P-4：missing snapshot
// ───────────────────────────────────────────────────────────

describe('persistence — P-4 missing snapshot', () => {
  it('.spectra/ 目录不存在时 loadSnapshot 返回 null（不抛错）', async () => {
    const loaded = await loadSnapshot(tmpRoot);
    expect(loaded).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────
// P-5：多进程并发冲突（最后写者胜，不损坏）
// ───────────────────────────────────────────────────────────

describe('persistence — P-5 多进程并发冲突', () => {
  it('两次并发 save 后 load 仍能 safeParse 成功', async () => {
    const snapA = buildSnapshotWrapper(mkGraph(), { '/proj/a.ts': 'a'.repeat(64) });
    const snapB = buildSnapshotWrapper(mkGraph(), { '/proj/b.ts': 'b'.repeat(64) });

    // 并发触发两次 save（模拟两个进程）
    await Promise.all([saveSnapshot(snapA, tmpRoot), saveSnapshot(snapB, tmpRoot)]);

    const loaded = await loadSnapshot(tmpRoot);
    expect(loaded).not.toBeNull();
    // 最终内容必为其中一个（最后写者胜，但绝不损坏）
    const isA = loaded!.fileHashes['/proj/a.ts'] === 'a'.repeat(64);
    const isB = loaded!.fileHashes['/proj/b.ts'] === 'b'.repeat(64);
    expect(isA || isB).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────
// P-6：UnifiedEdge.metadata roundtrip（W1 v3 → W2 handoff）
// ───────────────────────────────────────────────────────────

describe('persistence — P-6 UnifiedEdge.metadata roundtrip', () => {
  it('含 metadata.importType 的边经 save→load 后字段保留', async () => {
    const graph: UnifiedGraph = {
      nodes: [
        { id: '/proj/a.ts', label: 'a.ts', kind: 'module', filePath: '/proj/a.ts' },
        { id: '/proj/b.ts', label: 'b.ts', kind: 'module', filePath: '/proj/b.ts' },
      ],
      edges: [
        {
          source: '/proj/a.ts',
          target: '/proj/b.ts',
          relation: 'depends-on',
          confidence: 'high',
          directional: true,
          evidence: './b',
          metadata: { importType: 'dynamic', extra: 42 },
        },
      ],
      metadata: {
        generatedAt: '2026-05-09T10:00:00.000Z',
        projectRoot: '/proj',
        schemaVersion: '1.0',
      },
    };

    const snapshot = buildSnapshotWrapper(graph, {});
    await saveSnapshot(snapshot, tmpRoot);

    const loaded = await loadSnapshot(tmpRoot);
    expect(loaded).not.toBeNull();
    const edge = loaded!.graph.edges[0]!;
    expect(edge.metadata).toBeDefined();
    expect(edge.metadata!['importType']).toBe('dynamic');
    expect(edge.metadata!['extra']).toBe(42);
  });
});
