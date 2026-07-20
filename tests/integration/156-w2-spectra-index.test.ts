/**
 * Feature 156 W2 T-029 — `spectra index` 全量路径集成测试
 *
 * 验证：
 *   1. runIndexCommand 在 fixture 项目执行后退出码 0（无 process.exitCode 设置）
 *   2. .spectra/unified-graph.json 被创建在指定 projectRoot 下
 *   3. 读出的 SnapshotWrapper 通过 Zod 校验
 *   4. graph.edges 含至少 1 条 depends-on 边（fixture 中 main.ts 引用 lib.mjs / legacy.cjs）
 *   5. graph.metadata.projectRoot 与传入路径一致
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import { runIndexCommand } from '../../src/cli/commands/index.js';
import {
  loadSnapshot,
  snapshotPath,
  SnapshotWrapperSchema,
  SNAPSHOT_WRAPPER_VERSION,
} from '../../src/knowledge-graph/persistence.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import type { CLICommand } from '../../src/cli/utils/parse-args.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_SRC = path.resolve(__dirname, '../fixtures/156-w1.2-v2/ts-mjs-cjs');

beforeAll(() => {
  // 测试环境下显式 bootstrap，CLI 入口才会自动调用
  bootstrapAdapters();
});

let workspaceRoot: string;
let originalExitCode: number | undefined;

beforeEach(async () => {
  // 复制 fixture 到 tmp 目录，避免污染源 fixture（写 .spectra/ 会改变 git status）
  workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'spectra-w2-index-'));
  await copyDir(FIXTURE_SRC, workspaceRoot);
  originalExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(async () => {
  await fsp.rm(workspaceRoot, { recursive: true, force: true });
  process.exitCode = originalExitCode;
});

/** 简易递归复制工具（不引入额外依赖） */
async function copyDir(src: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isFile()) {
      await fsp.copyFile(s, d);
    }
  }
}

/** 构造一个最小可用的 CLICommand 对象（用于直接调用 runIndexCommand） */
function mkIndexCommand(overrides: Partial<CLICommand> = {}): CLICommand {
  return {
    subcommand: 'index',
    deep: false,
    force: false,
    version: false,
    help: false,
    global: false,
    remove: false,
    skillTarget: 'claude',
    ...overrides,
  };
}

describe('Feature 156 W2 — spectra index 全量路径', () => {
  it('在 ts-mjs-cjs fixture 上执行 spectra index 后产出有效 snapshot', async () => {
    await runIndexCommand(
      mkIndexCommand({ projectRoot: workspaceRoot }),
    );

    // (1) 退出码 0（runIndexCommand 不应设置 exitCode）
    expect(process.exitCode).toBeUndefined();

    // (2) snapshot 文件被创建
    const snapPath = snapshotPath(workspaceRoot);
    expect(fs.existsSync(snapPath)).toBe(true);

    // (3) Zod 校验通过
    const raw = await fsp.readFile(snapPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    const result = SnapshotWrapperSchema.safeParse(parsed);
    expect(result.success).toBe(true);

    // (4) loadSnapshot 也能正常返回
    const loaded = await loadSnapshot(workspaceRoot);
    expect(loaded).not.toBeNull();
    // Feature 214 W1：引用版本常量，避免下次 bump 再漂
    expect(loaded!.schemaVersion).toBe(SNAPSHOT_WRAPPER_VERSION);

    // (5) graph 含 depends-on 边（main.ts → lib.mjs / legacy.cjs）
    const dependsOnEdges = loaded!.graph.edges.filter(
      (e) => e.relation === 'depends-on',
    );
    expect(dependsOnEdges.length).toBeGreaterThanOrEqual(1);

    // (6) Feature 193：metadata.projectRoot 持久化为相对标记 '.'（可移植）
    expect(loaded!.graph.metadata.projectRoot).toBe('.');

    // (7) Feature 193：fileHashes key 为 repo-relative POSIX（持久化域）
    expect(loaded!.fileHashes['main.ts']).toBeDefined();
    expect(loaded!.fileHashes['main.ts']).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);

  it('--watch + --incremental 互斥：同时传入 → exit 1（FR-30）', async () => {
    await runIndexCommand(
      mkIndexCommand({
        projectRoot: workspaceRoot,
        indexWatch: true,
        indexIncremental: true,
      }),
    );
    expect(process.exitCode).toBe(1);
    expect(fs.existsSync(snapshotPath(workspaceRoot))).toBe(false);
  });

  it('--incremental 无 baseline snapshot 时降级为全量索引（fallbackToFull + exit 0）', async () => {
    await runIndexCommand(
      mkIndexCommand({ projectRoot: workspaceRoot, indexIncremental: true }),
    );
    // W3：buildIncremental 在无 snapshot 时会走 fallback-to-full 路径，仍 exit 0
    expect(process.exitCode).toBeUndefined();
    expect(fs.existsSync(snapshotPath(workspaceRoot))).toBe(true);
  }, 30_000);
});
