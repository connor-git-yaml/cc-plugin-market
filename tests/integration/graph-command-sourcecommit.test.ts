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

  // ── F249 T033 / SC-012：fingerprint 同走诚实降级 ──

  it('F249 SC-012：spectra graph 写盘的 graph.json 中 graph.fingerprint 恒为 null（不凭空推导指纹）', async () => {
    const outputDir = path.join(tmpDir, 'specs-fingerprint');
    await runGraphCommand(
      baseCommand({ subcommand: 'graph', graphOperation: 'build', outputDir }),
    );

    const graphPath = path.join(outputDir, '_meta', 'graph.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
    // 显式 null（字段存在但为 null），而非字段缺席——诚实表达"这条路径没有采集器指纹可言"
    expect(graph.graph.fingerprint).toBeNull();
    expect('fingerprint' in graph.graph).toBe(true);
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

  /**
   * F261 对抗复审 C-2（第四轮补齐）—— 钉住 `graph.ts` 的 `stamp-this-build` 字面量。
   *
   * 判别力来自"键是否存在"这一维，与 builder 的取值无关：`buildKnowledgeGraph` 新建的图**不含**
   * `builder` 键，所以声明一旦被改成 `preserve-recorded`（或漏写、走 fail-safe 默认），写盘后该键
   * **整个消失**；声明为 `stamp-this-build` 时该键必然存在（vitest 跑 src 定位不到 build-meta，
   * 值为 `null` 的诚实降级，见 `builder-stamp.ts` 形态 (b)）。
   */
  it('F261 C-2：spectra graph MUST 声明 stamp-this-build —— 产物必含 builder 键（src 直跑时值为 null）', async () => {
    const outputDir = path.join(tmpDir, 'specs-builder');
    await runGraphCommand(
      baseCommand({ subcommand: 'graph', graphOperation: 'build', outputDir }),
    );

    const graphPath = path.join(outputDir, '_meta', 'graph.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
    expect('builder' in graph.graph).toBe(true);
    expect(graph.graph.builder).toBeNull();
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

  /**
   * F261 对抗复审 C-2（第四轮补齐）—— **调用点声明字面量的护栏**。
   *
   * F261 把"谁有资格给图盖 builder 章"的控制信号从"对象形态反推"改成"caller 显式传参"，
   * 消除了绕过面，却把正确性完全押在 4 个调用点的**字面量**上。实测证伪：把 `community.ts` 的
   * `preserve-recorded` 改成 `stamp-this-build`（= 本特性立项要抓的伪造 provenance 形态）、
   * 把 `graph.ts` 的改成 `preserve-recorded`，全量 7000+ 用例**无一变红**。
   *
   * `tests/panoramic/community-persist.test.ts` 那几条**不能**替代本用例：它们手写
   * `{ builderProvenance: 'preserve-recorded' }` 复刻 community 的步骤，把被测的那个开关当成了
   * 输入常量，守的是 `writeKnowledgeGraph` 的内部分支，不是 `community.ts` 的声明。
   * 本用例走**真 `runCommunityCommand`**，是这条链路上唯一能钉住该字面量的位置。
   */
  it('F261 C-2：community 命令 MUST 声明 preserve-recorded —— 陈旧 builder 不被洗成当前 dist', async () => {
    const STALE_BUILDER = {
      formatVersion: 1 as const,
      commit: 'deaddead'.repeat(5),
      dirty: false,
      sourceDirty: false,
      distSha256: '1'.repeat(64),
    };
    writeSeedGraph('a'.repeat(40));
    const seeded = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
    seeded.graph.builder = { ...STALE_BUILDER };
    fs.writeFileSync(graphPath, JSON.stringify(seeded, null, 2), 'utf-8');

    await runCommunityCommand(baseCommand({ subcommand: 'community', outputDir }));

    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
    expect(graph.graph.builder).toEqual(STALE_BUILDER);
    // 活性对照：回写确实发生（否则本断言会因"什么都没跑"而假绿）
    expect(graph.nodes.every((n) => typeof n.metadata['community'] === 'string')).toBe(true);
  });

  it('F261 C-2：community 命令不得给无 builder 键的存量图补写该键', async () => {
    writeSeedGraph('a'.repeat(40));

    await runCommunityCommand(baseCommand({ subcommand: 'community', outputDir }));

    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
    expect('builder' in graph.graph).toBe(false);
    expect(graph.nodes.every((n) => typeof n.metadata['community'] === 'string')).toBe(true);
  });
});
