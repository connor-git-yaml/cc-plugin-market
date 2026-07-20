/**
 * F217 T031 — graph.ts / community.ts sourceCommit provenance 测试。
 *
 * 覆盖决策 3 裁定表后两行：
 * ① spectra graph 写盘 graph.sourceCommit 恒为 null（不解析源码，禁止盖当前 HEAD，FR-009）
 * ② spectra community 仅 patch metadata.community 字段，原图已有 sourceCommit 自然透传
 *    （未改动时保留原值，不重算）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runGraphCommand } from '../../src/cli/commands/graph.js';
import { runCommunityCommand } from '../../src/cli/commands/community.js';
import type { CLICommand } from '../../src/cli/utils/parse-args.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';

function baseCommand(overrides: Partial<CLICommand>): CLICommand {
  return {
    subcommand: 'graph',
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

describe('runGraphCommand — F217 T031: sourceCommit 恒为 null', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-command-sourcecommit-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('spectra graph 写盘的 graph.json 中 graph.sourceCommit 恒为 null', async () => {
    const outputDir = path.join(tmpDir, 'specs');
    await runGraphCommand(
      baseCommand({ subcommand: 'graph', graphOperation: 'build', outputDir }),
    );

    const graphPath = path.join(outputDir, '_meta', 'graph.json');
    expect(fs.existsSync(graphPath)).toBe(true);
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
    expect(graph.graph.sourceCommit).toBeNull();
  });

  it('即使在真实 git 仓库内运行，spectra graph 仍不盖当前 HEAD（provenance 诚实降级）', async () => {
    // tmpDir 本身不是 git 仓库；即使调用方 cwd 位于本仓库内，runGraphCommand 也
    // 不应调用 git —— 该断言通过读取产物验证行为契约，而非 mock child_process
    // （graph.ts 本身不应 import 任何 git 交互模块）。
    const outputDir = path.join(tmpDir, 'specs2');
    await runGraphCommand(
      baseCommand({ subcommand: 'graph', graphOperation: 'build', outputDir }),
    );
    const graphPath = path.join(outputDir, '_meta', 'graph.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
    expect(graph.graph.sourceCommit).toBeNull();
  });
});

describe('runCommunityCommand — F217 T031: sourceCommit 透传（零改动确认）', () => {
  let tmpDir: string;
  let outputDir: string;
  let graphPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-command-sourcecommit-'));
    outputDir = path.join(tmpDir, 'specs');
    fs.mkdirSync(path.join(outputDir, '_meta'), { recursive: true });
    graphPath = path.join(outputDir, '_meta', 'graph.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSeedGraph(sourceCommit: string | null | undefined): void {
    const seed: GraphJSON = {
      directed: false,
      multigraph: false,
      graph: {
        name: 'spectra-knowledge-graph',
        generatedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 2,
        edgeCount: 1,
        sources: ['unified-graph'],
        schemaVersion: '2.0',
        ...(sourceCommit !== undefined ? { sourceCommit } : {}),
      },
      nodes: [
        { id: 'a', kind: 'module', label: 'a', metadata: {} },
        { id: 'b', kind: 'module', label: 'b', metadata: {} },
      ],
      links: [
        { source: 'a', target: 'b', relation: 'depends-on', confidence: 'EXTRACTED', confidenceScore: 1 },
      ],
    };
    fs.writeFileSync(graphPath, JSON.stringify(seed, null, 2), 'utf-8');
  }

  it('原图已有真实 sourceCommit 值时，community 命令写盘后透传不变', async () => {
    const recorded = 'a'.repeat(40);
    writeSeedGraph(recorded);

    await runCommunityCommand(baseCommand({ subcommand: 'community', outputDir }));

    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
    expect(graph.graph.sourceCommit).toBe(recorded);
    // 确认 community 命令确实执行了 patch（metadata.community 已写入）
    expect(graph.nodes.every((n) => typeof n.metadata['community'] === 'string')).toBe(true);
  });

  it('原图 sourceCommit 为 null 时，community 命令写盘后仍为 null（不重算/不凭空补上）', async () => {
    writeSeedGraph(null);

    await runCommunityCommand(baseCommand({ subcommand: 'community', outputDir }));

    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
    expect(graph.graph.sourceCommit).toBeNull();
  });

  it('原图 sourceCommit 字段缺失（旧版本图产物）时，community 命令写盘后仍缺失（不凭空补上）', async () => {
    writeSeedGraph(undefined);

    await runCommunityCommand(baseCommand({ subcommand: 'community', outputDir }));

    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
    expect('sourceCommit' in graph.graph).toBe(false);
  });
});
