import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadGraph, detectCommunities } from '../../src/panoramic/community/community-detector.js';
import { writeKnowledgeGraph } from '../../src/panoramic/graph/index.js';
import { runCommunityCommand } from '../../src/cli/commands/community.js';
import type { CLICommand } from '../../src/cli/utils/parse-args.js';
import {
  computeCollectorFingerprint,
  isValidCollectorFingerprint,
} from '../../src/panoramic/graph/collector-fingerprint.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';

function baseCommand(overrides: Partial<CLICommand>): CLICommand {
  return {
    subcommand: 'community',
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

describe('community ID 持久化逻辑（跑真实生产入口 runCommunityCommand，非自行复刻逻辑）', () => {
  let tmpDir: string;
  let outputDir: string;
  let graphPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-persist-'));
    outputDir = path.join(tmpDir, 'specs');
    fs.mkdirSync(path.join(outputDir, '_meta'), { recursive: true });
    graphPath = path.join(outputDir, '_meta', 'graph.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runCommunityCommand 执行后将社区 ID 注入 graph.json 磁盘产物的 nodes[].metadata.community', async () => {
    // 构造最小 GraphJSON fixture（5 节点，几条边），落盘为 runCommunityCommand 的真实输入
    const seed: GraphJSON = {
      directed: false,
      nodes: [
        { id: 'node-a', label: 'node-a', kind: 'module', metadata: { description: 'node a' } },
        { id: 'node-b', label: 'node-b', kind: 'module', metadata: { description: 'node b' } },
        { id: 'node-c', label: 'node-c', kind: 'module', metadata: { description: 'node c' } },
        { id: 'node-d', label: 'node-d', kind: 'module', metadata: { description: 'node d' } },
        { id: 'node-e', label: 'node-e', kind: 'module', metadata: { description: 'node e' } },
      ],
      links: [
        { source: 'node-a', target: 'node-b', relation: 'import', confidence: 1 },
        { source: 'node-b', target: 'node-c', relation: 'import', confidence: 1 },
        { source: 'node-c', target: 'node-a', relation: 'import', confidence: 1 },
        { source: 'node-d', target: 'node-e', relation: 'import', confidence: 1 },
      ],
    } as unknown as GraphJSON;
    fs.writeFileSync(graphPath, JSON.stringify(seed), 'utf-8');

    await runCommunityCommand(baseCommand({ outputDir }));

    // 验证真实写盘产物：每个节点都有 metadata.community 字段
    const written = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
    for (const node of written.nodes) {
      expect(node.metadata['community']).toBeDefined();
      expect(typeof node.metadata['community']).toBe('string');
      expect((node.metadata['community'] as string).length).toBeGreaterThan(0);
    }
  });

  it('nodeCommunityMap 覆盖所有节点', () => {
    const graphJson = {
      directed: false,
      nodes: [
        { id: 'a', label: 'a', kind: 'module' as const, metadata: {} },
        { id: 'b', label: 'b', kind: 'module' as const, metadata: {} },
        { id: 'c', label: 'c', kind: 'module' as const, metadata: {} },
      ],
      links: [
        { source: 'a', target: 'b', relation: 'import' as const, confidence: 1 },
      ],
    };

    const g = loadGraph(graphJson as any);
    const { nodeCommunityMap } = detectCommunities(g);

    // 所有节点都应该有对应的社区 ID
    for (const node of graphJson.nodes) {
      expect(nodeCommunityMap.has(node.id)).toBe(true);
      const communityId = nodeCommunityMap.get(node.id);
      expect(communityId).not.toBeUndefined();
      // 社区 ID 应为数字
      expect(typeof communityId).toBe('number');
    }
  });

  it('runCommunityCommand 将社区 ID 转换为字符串写入磁盘产物的 metadata', async () => {
    const seed: GraphJSON = {
      directed: false,
      nodes: [
        { id: 'x', label: 'x', kind: 'module', metadata: {} },
        { id: 'y', label: 'y', kind: 'module', metadata: {} },
      ],
      links: [
        { source: 'x', target: 'y', relation: 'import', confidence: 1 },
      ],
    } as unknown as GraphJSON;
    fs.writeFileSync(graphPath, JSON.stringify(seed), 'utf-8');

    await runCommunityCommand(baseCommand({ outputDir }));

    // 确认真实写盘产物里的 community 字段是字符串类型（不是数字）
    const written = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
    for (const node of written.nodes) {
      expect(node.metadata['community']).toBeDefined();
      if (node.metadata['community'] !== undefined) {
        expect(typeof node.metadata['community']).toBe('string');
        // 字符串应该是有效数字
        expect(isNaN(Number(node.metadata['community']))).toBe(false);
      }
    }
  });
});

/**
 * F249 I-001：community 写回链路 MUST 原样保留 `graph.fingerprint`。
 *
 * 风险形态：`spectra community` 是**第三条写盘路径**——它 `JSON.parse` 已有 graph.json、只往
 * 节点 metadata 里塞 community id，然后整份 `writeKnowledgeGraph` 回去。指纹由建图链路
 * （batch / graph-only）写入，community 自己**不**计算指纹；因此只要写盘出口的归一化把这个
 * "它不认识的字段"剥掉，跑一次 community 就会把一张有指纹的图降级成 `unrecorded`——
 * 而 freshness 会因此把它判 stale，表现为"我什么都没改，图怎么就过期了"。
 *
 * 这条回归测试直接跑真实写盘出口（不是模拟），断言指纹字节级存活。
 */
describe('F249 I-001：writeKnowledgeGraph（community 写回出口）保留 collector fingerprint', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** 带指纹 + sourceCommit 的最小合法图（模拟建图链路刚写出的产物）。 */
  function graphWithFingerprint(): GraphJSON {
    return {
      directed: false,
      multigraph: false,
      graph: {
        name: 'spectra-knowledge-graph',
        generatedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 2,
        edgeCount: 1,
        sources: ['unified-graph'],
        schemaVersion: '2.0',
        sourceCommit: 'a'.repeat(40),
        fingerprint: computeCollectorFingerprint(),
      },
      nodes: [
        { id: 'src/a.ts', label: 'a', kind: 'module', metadata: {} },
        { id: 'src/b.ts', label: 'b', kind: 'module', metadata: {} },
      ],
      links: [{ source: 'src/a.ts', target: 'src/b.ts', relation: 'import', confidence: 'EXTRACTED' }],
    } as unknown as GraphJSON;
  }

  it('注入 community metadata 后写回，重新读出的 graph.fingerprint 与写入前深相等且仍合法', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-community-writeback-'));
    tmpDirs.push(outputDir);

    const graphJson = graphWithFingerprint();
    const before = structuredClone(graphJson.graph.fingerprint);

    // 复刻 src/cli/commands/community.ts 的写回步骤：改节点 metadata → writeKnowledgeGraph
    const g = loadGraph(graphJson);
    const { nodeCommunityMap } = detectCommunities(g);
    for (const node of graphJson.nodes) {
      const communityId = nodeCommunityMap.get(node.id);
      if (communityId !== undefined) node.metadata['community'] = String(communityId);
    }
    const writtenPath = writeKnowledgeGraph(graphJson, outputDir);

    const reloaded = JSON.parse(fs.readFileSync(writtenPath, 'utf-8')) as GraphJSON;
    expect(reloaded.graph.fingerprint).toEqual(before);
    expect(isValidCollectorFingerprint(reloaded.graph.fingerprint)).toBe(true);
    // sourceCommit 同为 provenance 字段，一并锁定（两者一起丢才是最难察觉的形态）
    expect(reloaded.graph.sourceCommit).toBe('a'.repeat(40));
    // 活性对照：community 注入确实发生了（否则这条测试可能测的是一张没被改过的图）
    expect(reloaded.nodes.some((node) => node.metadata['community'] !== undefined)).toBe(true);
  });
});

/**
 * F261 复审 F4：community 写回链路 MUST 原样保留 `graph.builder`——与上方 F249 fingerprint
 * 防线**同款**。
 *
 * 风险形态与 F249 同构、危害更直接：builder 记的是"这份图由哪一版编译产物写出"。第一轮实现
 * 在写盘出口**无条件覆盖**该字段，于是"陈旧 dist 建出来的图"只要被 `spectra community` 过一手，
 * provenance 就被洗成当前 dist——而 community 只往节点 metadata 塞 community id，根本没重建图。
 * 这恰好是本特性立项要抓的失效模式（F259 那起"陈旧 dist 建基线图、虚高 148 节点"事故）。
 */
describe('F261 F4：writeKnowledgeGraph（community 写回出口）保留 builder stamp', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** 模拟"陈旧 dist 建出来的图"：builder.commit 明显不是当前 dist。 */
  const STALE_BUILDER = {
    formatVersion: 1 as const,
    commit: 'deaddead'.repeat(5),
    dirty: false,
    sourceDirty: false,
    distSha256: '1'.repeat(64),
  };

  it('注入 community metadata 后写回，graph.builder 与写入前深相等（不被当前 dist 洗白）', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f261-community-builder-'));
    tmpDirs.push(outputDir);

    const graphJson = {
      directed: false,
      multigraph: false,
      graph: {
        name: 'spectra-knowledge-graph',
        generatedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 2,
        edgeCount: 1,
        sources: ['unified-graph'],
        schemaVersion: '2.0',
        sourceCommit: 'a'.repeat(40),
        fingerprint: null,
        builder: { ...STALE_BUILDER },
      },
      nodes: [
        { id: 'src/a.ts', label: 'a', kind: 'module', metadata: {} },
        { id: 'src/b.ts', label: 'b', kind: 'module', metadata: {} },
      ],
      links: [
        { source: 'src/a.ts', target: 'src/b.ts', relation: 'import', confidence: 'EXTRACTED' },
      ],
    } as unknown as GraphJSON;

    // 复刻 src/cli/commands/community.ts 的写回步骤
    const g = loadGraph(graphJson);
    const { nodeCommunityMap } = detectCommunities(g);
    for (const node of graphJson.nodes) {
      const communityId = nodeCommunityMap.get(node.id);
      if (communityId !== undefined) node.metadata['community'] = String(communityId);
    }
    const writtenPath = writeKnowledgeGraph(graphJson, outputDir, {
      builderProvenance: 'preserve-recorded',
    });

    const reloaded = JSON.parse(fs.readFileSync(writtenPath, 'utf-8')) as GraphJSON;
    expect(reloaded.graph.builder).toEqual(STALE_BUILDER);
    // 活性对照：写回确实发生了
    expect(reloaded.nodes.some((node) => node.metadata['community'] !== undefined)).toBe(true);
  });

  /**
   * 复审 C-2：**存量旧图（无 `builder` 键）经 community 不得被补写**。
   *
   * 这是危害最大的一支——上线前的图全都没有该键，跑一次 community 就从"诚实的 unrecorded"
   * 变成"自信的错误断言"。真 dist 实证（修复前，advisory 当时还是旧语义）：
   *   community 前 `[builder] unstamped …` → community 后 `[builder] 0d3e385 … 与 sourceCommit=… 不一致`。
   * 第三轮 D1 改语义后，同一支的危害形态不变，只是措辞变成
   *   `[builder] unrecorded …` → `[builder] … 由当前运行的 build 写出`（把"不知道"洗成"就是我建的"）。
   */
  it('C-2：无 builder 键的旧图经 community 写回后，仍不含该键（不被补写成当前 dist）', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f261-community-legacy-'));
    tmpDirs.push(outputDir);

    const graphJson = {
      directed: false,
      multigraph: false,
      graph: {
        name: 'spectra-knowledge-graph',
        generatedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 2,
        edgeCount: 1,
        sources: ['unified-graph'],
        schemaVersion: '2.0',
        sourceCommit: 'a'.repeat(40),
        fingerprint: null,
      },
      nodes: [
        { id: 'src/a.ts', label: 'a', kind: 'module', metadata: {} },
        { id: 'src/b.ts', label: 'b', kind: 'module', metadata: {} },
      ],
      links: [
        { source: 'src/a.ts', target: 'src/b.ts', relation: 'import', confidence: 'EXTRACTED' },
      ],
    } as unknown as GraphJSON;
    expect('builder' in graphJson.graph).toBe(false);

    const g = loadGraph(graphJson);
    const { nodeCommunityMap } = detectCommunities(g);
    for (const node of graphJson.nodes) {
      const communityId = nodeCommunityMap.get(node.id);
      if (communityId !== undefined) node.metadata['community'] = String(communityId);
    }
    const writtenPath = writeKnowledgeGraph(graphJson, outputDir, {
      builderProvenance: 'preserve-recorded',
    });

    const reloaded = JSON.parse(fs.readFileSync(writtenPath, 'utf-8')) as GraphJSON;
    expect('builder' in reloaded.graph).toBe(false);
    expect(reloaded.nodes.some((node) => node.metadata['community'] !== undefined)).toBe(true);
  });

  /**
   * D6（第四轮主线程裁决）：**旧版跑 community 不得抹掉更新版本写入的 stamp**。
   *
   * 这是与上面两支并列的第三支，且是唯一会造成**磁盘信息永久丢失**的一支：更新版本写的 stamp
   * 旧版读不懂，上一版实现把它 collapse 成 `null` ⇒ `unrecognized`（"更新版本写出 / 已被篡改"）
   * 被伪装成 `unstamped`（"根本没盖章"），且原值不可恢复。版本偏斜在本仓库是常态
   * （全局 MCP 装的是旧 dist，repo 里跑的是新 dist）。
   */
  it('D6：更新版本写入的不可识别 stamp 经旧版 community 写回后，原值一字不变', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f261-community-future-'));
    tmpDirs.push(outputDir);

    const FUTURE_BUILDER = {
      formatVersion: 2,
      commit: 'c'.repeat(40),
      dirty: false,
      sourceDirty: false,
      distSha256: 'd'.repeat(64),
      newFieldFromFuture: 'x',
    };
    const graphJson = {
      directed: false,
      multigraph: false,
      graph: {
        name: 'spectra-knowledge-graph',
        generatedAt: '2026-01-01T00:00:00.000Z',
        nodeCount: 2,
        edgeCount: 1,
        sources: ['unified-graph'],
        schemaVersion: '2.0',
        sourceCommit: 'a'.repeat(40),
        fingerprint: null,
        builder: { ...FUTURE_BUILDER },
      },
      nodes: [
        { id: 'src/a.ts', label: 'a', kind: 'module', metadata: {} },
        { id: 'src/b.ts', label: 'b', kind: 'module', metadata: {} },
      ],
      links: [
        { source: 'src/a.ts', target: 'src/b.ts', relation: 'import', confidence: 'EXTRACTED' },
      ],
    } as unknown as GraphJSON;

    const g = loadGraph(graphJson);
    const { nodeCommunityMap } = detectCommunities(g);
    for (const node of graphJson.nodes) {
      const communityId = nodeCommunityMap.get(node.id);
      if (communityId !== undefined) node.metadata['community'] = String(communityId);
    }
    const writtenPath = writeKnowledgeGraph(graphJson, outputDir, {
      builderProvenance: 'preserve-recorded',
    });

    const reloaded = JSON.parse(fs.readFileSync(writtenPath, 'utf-8')) as GraphJSON;
    expect(reloaded.graph.builder).toEqual(FUTURE_BUILDER);
    expect(reloaded.nodes.some((node) => node.metadata['community'] !== undefined)).toBe(true);
  });
});
