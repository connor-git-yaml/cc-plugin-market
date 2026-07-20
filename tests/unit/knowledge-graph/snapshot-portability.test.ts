/**
 * Feature 193 T021 — 快照可移植性测试（决策 1b / FR-006a / SC-002 / SC-004）。
 *
 * 覆盖：
 *   - 快照相对化往返：fileHashes key + 内嵌 graph node.id/filePath + metadata.projectRoot
 *     全部为 repo-relative POSIX
 *   - 旧绝对 key（1.0 版本）快照 → loadSnapshotDetailed 判 format-stale
 *   - buildIncremental 遇旧格式快照 → 安全退化 full reindex（fallbackReason=snapshot-format-stale）
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadSnapshotDetailed,
  saveSnapshot,
  snapshotPath,
  buildSnapshotWrapper,
  computeAllFileHashes,
  SNAPSHOT_WRAPPER_VERSION,
} from '../../../src/knowledge-graph/persistence.js';
import { buildUnifiedGraph } from '../../../src/knowledge-graph/index.js';
import { buildIncremental } from '../../../src/knowledge-graph/incremental.js';
import { bootstrapAdapters } from '../../../src/adapters/index.js';
import { analyzeFile } from '../../../src/core/ast-analyzer.js';
import type { CodeSkeleton } from '../../../src/models/code-skeleton.js';

let tmpRoot: string;

beforeAll(() => {
  // 增量链 buildIncremental 内部用 analyzeFile，需要语言适配器已注册
  bootstrapAdapters();
});

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'f193-snap-'));
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

function mkSk(filePath: string, partial: Partial<CodeSkeleton> = {}): CodeSkeleton {
  return {
    filePath,
    language: 'typescript',
    loc: 100,
    imports: [],
    exports: [],
    hash: 'a'.repeat(64),
    analyzedAt: '2026-05-08T10:00:00.000Z',
    parserUsed: 'tree-sitter',
    callSites: [],
    ...partial,
  };
}

describe('Feature 193 T021 — 快照相对化往返', () => {
  it('saveSnapshot/loadSnapshot 后 fileHashes key + 内嵌 graph + projectRoot 全部相对', async () => {
    const absFile = path.join(tmpRoot, 'src', 'foo.ts');
    await fsp.mkdir(path.dirname(absFile), { recursive: true });
    await fsp.writeFile(absFile, 'export const foo = 1;\n', 'utf-8');

    const skeletons = new Map<string, CodeSkeleton>([
      [absFile, mkSk(absFile, {
        exports: [{ name: 'foo', kind: 'const', signature: 'const foo', isDefault: false, startLine: 1, endLine: 1 }],
      })],
    ]);
    const graph = buildUnifiedGraph({ projectRoot: tmpRoot, codeSkeletons: skeletons });
    const fileHashes = await computeAllFileHashes(tmpRoot, [absFile]);
    const snapshot = buildSnapshotWrapper(graph, fileHashes);
    await saveSnapshot(snapshot, tmpRoot);

    const { snapshot: loaded, reason } = await loadSnapshotDetailed(tmpRoot);
    expect(reason).toBe('ok');
    expect(loaded).not.toBeNull();

    // fileHashes key 相对（POSIX）
    expect(Object.keys(loaded!.fileHashes)).toContain('src/foo.ts');
    expect(Object.keys(loaded!.fileHashes).some((k) => path.isAbsolute(k))).toBe(false);

    // 内嵌 graph node.id / filePath 相对
    for (const n of loaded!.graph.nodes) {
      const filePart = n.id.includes('::') ? n.id.slice(0, n.id.indexOf('::')) : n.id;
      expect(path.isAbsolute(filePart)).toBe(false);
      if (n.filePath) expect(path.isAbsolute(n.filePath)).toBe(false);
    }

    // metadata.projectRoot = '.'
    expect(loaded!.graph.metadata.projectRoot).toBe('.');
  });
});

describe('Feature 193 T021 — 旧绝对 key 快照触发 format-stale', () => {
  it('1.0 版本快照 → loadSnapshotDetailed reason=format-stale', async () => {
    const target = snapshotPath(tmpRoot);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const old: Record<string, unknown> = {
      schemaVersion: '1.0', // 旧 wrapper 版本
      generatedAt: '2026-05-09T10:00:00.000Z',
      graph: {
        nodes: [{ id: '/old/repo/src/a.ts', kind: 'module', language: 'typescript', filePath: '/old/repo/src/a.ts' }],
        edges: [],
        metadata: { generatedAt: '2026-05-09T10:00:00.000Z', projectRoot: '/old/repo', schemaVersion: '1.0' },
      },
      fileHashes: { '/old/repo/src/a.ts': 'a'.repeat(64) },
    };
    await fsp.writeFile(target, JSON.stringify(old), 'utf-8');

    const { snapshot, reason } = await loadSnapshotDetailed(tmpRoot);
    expect(snapshot).toBeNull();
    expect(reason).toBe('format-stale');
  });

  it('buildIncremental 遇旧格式快照 → fallbackToFull + reason=snapshot-format-stale', async () => {
    // 写一个真实源文件，让 full reindex 能产出
    const absFile = path.join(tmpRoot, 'a.ts');
    await fsp.writeFile(absFile, 'export const a = 1;\n', 'utf-8');

    const target = snapshotPath(tmpRoot);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const old = {
      schemaVersion: '1.0',
      generatedAt: '2026-05-09T10:00:00.000Z',
      graph: {
        nodes: [],
        edges: [],
        metadata: { generatedAt: '2026-05-09T10:00:00.000Z', projectRoot: '/old/repo', schemaVersion: '1.0' },
      },
      fileHashes: { '/old/repo/a.ts': 'a'.repeat(64) },
    };
    await fsp.writeFile(target, JSON.stringify(old), 'utf-8');

    const result = await buildIncremental({ projectRoot: tmpRoot, disableShallowFallback: true });
    expect(result.fallbackToFull).toBe(true);
    expect(result.fallbackReason).toBe('snapshot-format-stale');

    // full reindex 重建为当前 wrapper 版本 + 相对快照（Feature 214 W1：引用常量防漂）
    const { snapshot: rebuilt, reason } = await loadSnapshotDetailed(tmpRoot);
    expect(reason).toBe('ok');
    expect(rebuilt!.schemaVersion).toBe(SNAPSHOT_WRAPPER_VERSION);
    expect(Object.keys(rebuilt!.fileHashes).some((k) => path.isAbsolute(k))).toBe(false);
  });
});

describe('Feature 193 T021 — 快照跨 worktree byte 一致（Codex implement-W3 / FR-016）', () => {
  it('两个不同深度 worktree（同内容文件）产 byte-identical 快照（strip 时间戳后）', async () => {
    // 用两个不同深度的真实 tmpdir 模拟两个 worktree，写入逐字节相同的源文件
    const shallow = await fsp.mkdtemp(path.join(os.tmpdir(), 'f193-wt-shallow-'));
    const deepBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'f193-wt-deep-'));
    const deep = path.join(deepBase, 'very', 'deep', 'nested', 'wt');
    await fsp.mkdir(deep, { recursive: true });

    const SRC = 'export const foo = 1;\nexport function bar() { return foo; }\n';

    async function buildSnapshotJson(root: string): Promise<string> {
      const absFile = path.join(root, 'src', 'foo.ts');
      await fsp.mkdir(path.dirname(absFile), { recursive: true });
      await fsp.writeFile(absFile, SRC, 'utf-8');
      const sk = await analyzeFile(absFile, { projectRoot: root });
      const skeletons = new Map<string, CodeSkeleton>();
      if (sk) skeletons.set(absFile, sk);
      const graph = buildUnifiedGraph({ projectRoot: root, codeSkeletons: skeletons });
      const fileHashes = await computeAllFileHashes(root, [absFile]);
      const snapshot = buildSnapshotWrapper(graph, fileHashes);
      // strip 两处时间戳（top-level + 内嵌 graph.metadata），其余须 byte 相等
      const stripped = {
        ...snapshot,
        generatedAt: 'STRIPPED',
        graph: { ...snapshot.graph, metadata: { ...snapshot.graph.metadata, generatedAt: 'STRIPPED' } },
      };
      return JSON.stringify(stripped, null, 2);
    }

    try {
      const a = await buildSnapshotJson(shallow);
      const b = await buildSnapshotJson(deep);
      expect(a).toBe(b);
      // 反向证伪：确认两 root 的绝对前缀都没残留在快照里
      expect(a).not.toContain(shallow);
      expect(b).not.toContain(deep);
      expect(a).toContain('src/foo.ts');
    } finally {
      await fsp.rm(shallow, { recursive: true, force: true });
      await fsp.rm(deepBase, { recursive: true, force: true });
    }
  });
});

describe('Feature 193 T021 — 增量保活往返（SC-004 局部）', () => {
  it('相对快照 + 改一个文件 commit-less override → 走增量（fallbackToFull=false）', async () => {
    // 初始化两个源文件
    const fileA = path.join(tmpRoot, 'a.ts');
    const fileB = path.join(tmpRoot, 'b.ts');
    await fsp.writeFile(fileA, 'export const a = 1;\n', 'utf-8');
    await fsp.writeFile(fileB, 'export const b = 2;\n', 'utf-8');

    // 先建立相对快照（full，用真实 analyzeFile 保证 node id 与增量重建同形）
    const skeletons = new Map<string, CodeSkeleton>();
    for (const f of [fileA, fileB]) {
      const sk = await analyzeFile(f, { projectRoot: tmpRoot });
      if (sk) skeletons.set(f, sk);
    }
    const graph = buildUnifiedGraph({ projectRoot: tmpRoot, codeSkeletons: skeletons });
    const fileHashes = await computeAllFileHashes(tmpRoot, [fileA, fileB]);
    await saveSnapshot(buildSnapshotWrapper(graph, fileHashes), tmpRoot);

    // 改 a.ts，用 changedFilesOverride 走 watch 路径（不依赖 git）
    await fsp.writeFile(fileA, 'export const a = 99;\nexport const a2 = 100;\n', 'utf-8');
    const result = await buildIncremental({
      projectRoot: tmpRoot,
      changedFilesOverride: [fileA],
      disableShallowFallback: true,
    });

    expect(result.fallbackToFull).toBe(false);
    // 新 symbol a2 应出现在重建快照中（相对 id）
    const a2 = result.snapshot.graph.nodes.find((n) => n.id === 'a.ts::a2');
    expect(a2).toBeDefined();
    // 未改动的 b.ts 节点保留
    expect(result.snapshot.graph.nodes.some((n) => n.id === 'b.ts::b')).toBe(true);
    // 快照仍可加载且相对
    expect(fs.existsSync(snapshotPath(tmpRoot))).toBe(true);
  });
});
