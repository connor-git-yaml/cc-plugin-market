/**
 * F261 T006（红先行，T-R2）— `writeKnowledgeGraph` 写盘出口的 builder stamp 注入。
 *
 * 断言两件事：
 * ① 写盘出口**一定**会写入 `graph.graph.builder` 键（存在性，不是"有值才写"）；
 * ② vitest 跑的是 `src/`（非 dist），按决策 2 形态 (b) 结构性定位不到 build-meta ⇒ 值为 `null`
 *    （诚实降级），且不影响既有归一化（nodes 仍按 id 有序）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildKnowledgeGraph, writeKnowledgeGraph } from './graph-builder.js';
import { describeBuilderStamp } from '../../cli/commands/graph-quality.js';
import type { GraphJSON } from './graph-types.js';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f261-write-graph-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** 最小合法图：两个乱序节点，用于顺带验证归一化排序未被注入点破坏。 */
function minimalGraph(): GraphJSON {
  return {
    directed: true,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 2,
      edgeCount: 0,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
      sourceCommit: null,
      fingerprint: null,
    },
    nodes: [
      { id: 'src/z.ts', kind: 'module', label: 'z', metadata: {} },
      { id: 'src/a.ts', kind: 'module', label: 'a', metadata: {} },
    ],
    links: [],
  };
}

function readWritten(outputDir: string): GraphJSON {
  const raw = fs.readFileSync(path.join(outputDir, '_meta', 'graph.json'), 'utf-8');
  return JSON.parse(raw) as GraphJSON;
}

/** 建图链路的写盘口径：调用方显式声明"这张图的内容是本进程刚建出来的"。 */
const STAMP = { builderProvenance: 'stamp-this-build' } as const;

describe('writeKnowledgeGraph — builder stamp 注入（F261 T-R2）', () => {
  it('声明 stamp-this-build 时，写盘产物的 graph.graph 一定含 builder 键', () => {
    const outputDir = makeTmpDir();
    writeKnowledgeGraph(minimalGraph(), outputDir, STAMP);

    const parsed = readWritten(outputDir);
    expect('builder' in parsed.graph).toBe(true);
  });

  it('vitest 跑 src ⇒ 定位不到 build-meta ⇒ builder 为 null（诚实降级，形态 b）', () => {
    const outputDir = makeTmpDir();
    writeKnowledgeGraph(minimalGraph(), outputDir, STAMP);

    expect(readWritten(outputDir).graph.builder).toBeNull();
  });

  it('注入不影响既有归一化：nodes 仍按 id 字典序排序', () => {
    const outputDir = makeTmpDir();
    writeKnowledgeGraph(minimalGraph(), outputDir, STAMP);

    expect(readWritten(outputDir).nodes.map((n) => n.id)).toEqual(['src/a.ts', 'src/z.ts']);
  });

  it('既有 provenance 字段不被注入动作改写（sourceCommit / fingerprint 保持原值）', () => {
    const outputDir = makeTmpDir();
    writeKnowledgeGraph(minimalGraph(), outputDir, STAMP);

    const parsed = readWritten(outputDir);
    expect(parsed.graph.sourceCommit).toBeNull();
    expect(parsed.graph.fingerprint).toBeNull();
    expect(parsed.graph.schemaVersion).toBe('2.0');
  });
});

/**
 * 复审 F4（第二轮）—— 注入 MUST 是"仅字段缺席时"，不得无条件覆盖。
 *
 * 失效形态（已在真 dist 上实证复现）：把磁盘 graph.json 的 `builder.commit` 改成 `deaddead…`
 * （模拟陈旧 dist 建的图）→ 跑一次 `spectra community`（它只往节点 metadata 塞 community id、
 * 不碰 nodes/edges 语义）→ builder 被改写成当前 commit。**正是本特性要抓的失效模式被本特性
 * 自己的写盘出口洗白了。**
 *
 * 口径对齐：`community-persist.test.ts` 的 F249 防线要求 community 写回**保留** collector
 * fingerprint；builder 同为 provenance 字段，不该有相反语义。
 *
 * 安全性前提（已实查，非推断）：除 `community` 外没有"载入既有 graph.json → 再分析 → 回写"的
 * 链路；其余 3 个 `writeKnowledgeGraph` 调用方写的都是 `buildKnowledgeGraph` 当场新建的对象，
 * 而该函数的 `graph` 字面量里**没有** `builder` 键 ⇒ 新建图必被注入，不存在"陈旧 builder 永久
 * 冻结"。下方第 3 条用例直接把这个前提钉成回归断言。
 */
describe('writeKnowledgeGraph — builder 由调用方显式声明（F4 反洗白 + 复审 C-2）', () => {
  const FOREIGN_BUILDER = {
    formatVersion: 1 as const,
    commit: 'deaddead'.repeat(5),
    dirty: false,
    sourceDirty: false,
    distSha256: '1'.repeat(64),
  };

  it('preserve-recorded：磁盘载入的图已带 builder → 原样保留，MUST NOT 被当前 dist 覆盖', () => {
    const outputDir = makeTmpDir();
    const graph = minimalGraph();
    graph.graph.builder = { ...FOREIGN_BUILDER };

    writeKnowledgeGraph(graph, outputDir, { builderProvenance: 'preserve-recorded' });

    expect(readWritten(outputDir).graph.builder).toEqual(FOREIGN_BUILDER);
  });

  it('preserve-recorded：显式 builder: null（tsx/src 写出的诚实降级产物）保留为 null', () => {
    const outputDir = makeTmpDir();
    const graph = minimalGraph();
    graph.graph.builder = null;

    writeKnowledgeGraph(graph, outputDir, { builderProvenance: 'preserve-recorded' });

    const parsed = readWritten(outputDir);
    expect('builder' in parsed.graph).toBe(true);
    expect(parsed.graph.builder).toBeNull();
  });

  /**
   * 复审 C-2（两路对抗审查独立复现，我方亦已用真 dist 复现）——**"键缺席"这一支才是危害最大的**。
   *
   * 上线前的**存量图 100% 没有 `builder` 键**。上一版修法用 `!('builder' in graph)` 作注入判据，
   * 于是这些旧图跑一次 `spectra community`（只往 node.metadata 塞 community id、完全不重建内容）
   * 就会被盖上当前 dist 的章：`unrecorded`（诚实的"不知道"）→ 变成一句自信的错误断言。
   *
   * 教训与 F238 同类：**控制信号不能由数据形态承担**（那里是字符串前缀，这里是"键是否存在"）。
   * 终态是调用方显式传参——建图链路声明 `stamp-this-build`，纯 metadata 回写链路声明
   * `preserve-recorded`，默认（省略）取 fail-safe 的 `preserve-recorded`。
   */
  it('C-2：preserve-recorded + 磁盘图无 builder 键 → 写盘后仍无该键（MUST NOT 补写）', () => {
    const outputDir = makeTmpDir();
    const graph = minimalGraph();
    expect('builder' in graph.graph).toBe(false);

    writeKnowledgeGraph(graph, outputDir, { builderProvenance: 'preserve-recorded' });

    expect('builder' in readWritten(outputDir).graph).toBe(false);
  });

  it('C-2：省略 builderProvenance 时取 fail-safe 默认（不盖章），新写者忘了传只会丢信息、不会造假', () => {
    const outputDir = makeTmpDir();

    writeKnowledgeGraph(minimalGraph(), outputDir);

    expect('builder' in readWritten(outputDir).graph).toBe(false);
  });

  /**
   * **第二轮 A-W1 的磁盘侧口径已被第四轮推翻，此用例随之反转** —— 保留原文脉络以免下一任把它当回归。
   *
   * 第二轮要求"保留 = 投影后保留"，理由是外来 `builtAtIso`（墙钟）与绝对路径（F193 portable 面）
   * 不该落盘。但"投影"与"前向兼容"在同一个分支上是冲突的：投影必然丢弃额外键，而本模块的演进
   * 口径是"加字段不必 bump `formatVersion`"，于是**更新版本写的合法 stamp 会被旧版本静默削字段**
   * （对抗复审 A-W1 用真 CLI 实证）。
   *
   * 第四轮取舍：写盘侧**不承担销毁证据的职责**，判据改为"覆盖无损才覆盖"。外来 `builtAtIso` /
   * 绝对路径因此**会**留在磁盘上——其危害（值进终端）由消费侧独立封死：`describeBuilderStamp`
   * 对这种形态渲染的是**合法 stamp 的正常文案**（额外键根本不参与渲染），`graph-semantic-diff`
   * 的值一律过十六进制闸口。两处各有用例。
   */
  it('A-W1（第四轮反转）：带外来键的合法 stamp → 原样保留，且外来键不进任何渲染面', () => {
    const outputDir = makeTmpDir();
    const graph = minimalGraph();
    const withForeignKeys = {
      ...FOREIGN_BUILDER,
      builtAtIso: '2026-08-08T07:54:22.450Z',
      distRoot: '/Users/alice/secret/dist',
    };
    (graph.graph as { builder?: unknown }).builder = { ...withForeignKeys };

    writeKnowledgeGraph(graph, outputDir, { builderProvenance: 'preserve-recorded' });

    const written = readWritten(outputDir);
    expect(written.graph.builder).toEqual(withForeignKeys);
    // 渲染面零外泄：额外键不参与 advisory（该值可解析 ⇒ 走正常 stamp 文案）
    const advisory = describeBuilderStamp(written, null);
    expect(advisory).not.toContain('builtAtIso');
    expect(advisory).not.toContain('/Users/alice');
    expect(advisory).not.toContain('2026-08-08');
  });

  /**
   * D6（第四轮主线程裁决）—— 保留通道遇**不可解析**的原值时 MUST 原样不动该键。
   *
   * 上一版（第二轮 A-W1）在这里 collapse 成 `null`，实证后果（对抗复审 C1 复现）：一张由
   * **更新版本 spectra** 盖章的图，被**旧版** `spectra community` 跑一次，原始 stamp
   * **不可恢复**地变成 `null` —— `unrecognized`（"更新版本写出 / 已被篡改"，排查动作与
   * "根本没盖章"完全不同）这一态被一次纯 metadata 回写永久抹平。版本偏斜在本仓库是常态
   * （全局 MCP 用旧 dist、repo 用新 dist），可达性不低。
   *
   * 裁决口径：**旧版本无权抹掉更新版本写入的内容**；把"不可识别"抹成"未盖章"是把未知伪装成
   * 已知，与本特性全部设计意图相反。合法值仍走投影收口（上一条用例），两者职责不同：
   * 投影管"我们看得懂的东西按我们的字段集写回"，保留管"我们看不懂的东西别动"。
   *
   * 值层面的展示安全由**消费侧**承担（`describeBuilderStamp` / `graph-semantic-diff` 的
   * `unrecognized` 态都不回显原始内容，各有专门用例钉住），不再依赖"写盘时销毁证据"。
   */
  it('D6：保留时遇不可解析的 builder（更新版本 formatVersion + 未来字段）→ 原样保留，MUST NOT 抹成 null', () => {
    const outputDir = makeTmpDir();
    const graph = minimalGraph();
    const futureStamp = {
      formatVersion: 2,
      commit: 'c'.repeat(40),
      dirty: false,
      sourceDirty: false,
      distSha256: 'd'.repeat(64),
      newFieldFromFuture: 'x',
    };
    (graph.graph as { builder?: unknown }).builder = { ...futureStamp };

    writeKnowledgeGraph(graph, outputDir, { builderProvenance: 'preserve-recorded' });

    expect(readWritten(outputDir).graph.builder).toEqual(futureStamp);
  });

  it('D6：值域不合规（路径 / 时间戳）同样原样保留 —— 销毁证据不是回写链路的职责', () => {
    const outputDir = makeTmpDir();
    const graph = minimalGraph();
    const bogus = {
      formatVersion: 1,
      commit: '/Users/alice/secret @ 2026-08-08T09:00:00Z',
      dirty: false,
      sourceDirty: false,
      distSha256: '/abs/path',
    };
    (graph.graph as { builder?: unknown }).builder = { ...bogus };

    writeKnowledgeGraph(graph, outputDir, { builderProvenance: 'preserve-recorded' });

    expect(readWritten(outputDir).graph.builder).toEqual(bogus);
  });

  it('D6：非对象形态（字符串 / 数组 / 数字）也原样保留，且写盘不抛', () => {
    for (const raw of ['future-opaque-token', [1, 2], 42]) {
      const outputDir = makeTmpDir();
      const graph = minimalGraph();
      (graph.graph as { builder?: unknown }).builder = raw;

      expect(() =>
        writeKnowledgeGraph(graph, outputDir, { builderProvenance: 'preserve-recorded' }),
      ).not.toThrow();
      expect((readWritten(outputDir).graph as { builder?: unknown }).builder).toEqual(raw);
    }
  });

  /**
   * 保留通道**必须仍是幂等的**：不可解析的原值连写两次逐字节相同，否则 F193 的写盘确定性
   * （以及 `graph-only-pipeline` 的 byte-stable 断言）会被这条新通道从侧面破坏。
   */
  it('D6：不可解析原值连续两次回写，产物逐字节相同（保留不引入写盘非确定性）', () => {
    const bogus = { formatVersion: 2, zzz: 1, aaa: [3, 2, 1] };
    const render = (): string => {
      const outputDir = makeTmpDir();
      const graph = minimalGraph();
      (graph.graph as { builder?: unknown }).builder = { ...bogus };
      writeKnowledgeGraph(graph, outputDir, { builderProvenance: 'preserve-recorded' });
      return fs.readFileSync(path.join(outputDir, '_meta', 'graph.json'), 'utf-8');
    };

    expect(render()).toBe(render());
  });

  it('buildKnowledgeGraph 新建的图不含 builder 键 ⇒ 由建图链路显式声明后盖章（不会冻结陈旧值）', () => {
    const fresh = buildKnowledgeGraph({});

    expect('builder' in fresh.graph).toBe(false);
  });

  /**
   * 对抗复审 A-W1（第四轮）—— **"可解析"不等于"覆盖无损"**。
   *
   * `parseGraphBuilderStamp` 解构固定 5 键后重建对象，额外键一律丢弃；而本模块的演进口径恰恰是
   * "加字段**不必** bump `formatVersion`"（`builder-stamp.ts` 文件头的显式论证）。二者相乘：
   * 更新版本写的 `formatVersion: 1` ＋ 新字段是**可解析**的 ⇒ 走投影 ⇒ 新字段被旧版本静默抹掉，
   * 与 D6 要根除的是同一件事，只是换了个入口。D6 的三条用例全用 `formatVersion: 2` 或非对象形态
   * 构造，系统性绕开了这个**唯一现实**的冲突点（真 CLI 已实证复现字段消失）。
   */
  it('A-W1：formatVersion 1 + 未来字段（可解析但覆盖有损）→ 原样保留，未来字段不得被抹掉', () => {
    const outputDir = makeTmpDir();
    const graph = minimalGraph();
    const futureSuperset = {
      ...FOREIGN_BUILDER,
      nodeVersion: 'v20.11.0',
      FUTURE_CANARY: 1,
    };
    (graph.graph as { builder?: unknown }).builder = { ...futureSuperset };

    writeKnowledgeGraph(graph, outputDir, { builderProvenance: 'preserve-recorded' });

    expect(readWritten(outputDir).graph.builder).toEqual(futureSuperset);
  });

  it('A-W1：键集合恰为已知 5 项时仍走投影（键序被规范化，投影分支未变成死代码）', () => {
    const outputDir = makeTmpDir();
    const graph = minimalGraph();
    // 打乱键序，且 formatVersion 放最后——投影会把它复位成声明顺序
    (graph.graph as { builder?: unknown }).builder = {
      distSha256: FOREIGN_BUILDER.distSha256,
      sourceDirty: FOREIGN_BUILDER.sourceDirty,
      dirty: FOREIGN_BUILDER.dirty,
      commit: FOREIGN_BUILDER.commit,
      formatVersion: 1,
    };

    writeKnowledgeGraph(graph, outputDir, { builderProvenance: 'preserve-recorded' });

    const written = readWritten(outputDir).graph.builder as Record<string, unknown>;
    expect(Object.keys(written)).toEqual([
      'formatVersion',
      'commit',
      'dirty',
      'sourceDirty',
      'distSha256',
    ]);
  });

  /**
   * 对抗复审 A-W2（第四轮）—— 一个 advisory 字段 MUST NOT 具备让写盘失败的能力。
   *
   * `cli community` 的入口校验只查 `nodes` / `links` 是数组、不查 `graph`，外来 / 手工构造的
   * graph.json 完全可能带 `graph: null`。F261 之前 `writeKnowledgeGraph` 对该形态不抛；加了
   * `in` / 属性赋值之后变成 `TypeError`，真 CLI 实证是**半成功**：GRAPH_REPORT.md 已重写、
   * graph.json 未更新，两个产物就此不一致。
   */
  it('A-W2：graph.graph 为 null / undefined / 数组等畸形形态 → 写盘不抛，其余内容照常落盘', () => {
    for (const bogus of [null, undefined, 'x', 42]) {
      for (const mode of ['stamp-this-build', 'preserve-recorded'] as const) {
        const outputDir = makeTmpDir();
        const graph = minimalGraph();
        (graph as { graph: unknown }).graph = bogus;

        expect(() =>
          writeKnowledgeGraph(graph, outputDir, { builderProvenance: mode }),
        ).not.toThrow();
        expect(readWritten(outputDir).nodes.map((n) => n.id)).toEqual(['src/a.ts', 'src/z.ts']);
      }
    }
  });

  /**
   * 对抗复审 I-3（第四轮）：`in` 走原型链。污染 `Object.prototype.builder` 后，一张**本无该键**的
   * 存量图会被判成"有记录"、走进保留分支并被写成**自有属性** —— 恰好是 C-2 用例要防的"补写"。
   */
  it('I-3：Object.prototype 被污染时，无 builder 键的存量图仍不得被补写该键', () => {
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto['builder'] = { ...FOREIGN_BUILDER };
    try {
      const outputDir = makeTmpDir();
      const graph = minimalGraph();

      writeKnowledgeGraph(graph, outputDir, { builderProvenance: 'preserve-recorded' });

      const raw = fs.readFileSync(path.join(outputDir, '_meta', 'graph.json'), 'utf-8');
      expect(raw).not.toContain('"builder"');
    } finally {
      delete proto['builder'];
    }
  });

  it('保留动作不影响同批次的其它 provenance 字段与归一化', () => {
    const outputDir = makeTmpDir();
    const graph = minimalGraph();
    graph.graph.builder = { ...FOREIGN_BUILDER };
    graph.graph.sourceCommit = 'c'.repeat(40);

    writeKnowledgeGraph(graph, outputDir, { builderProvenance: 'preserve-recorded' });

    const parsed = readWritten(outputDir);
    expect(parsed.graph.sourceCommit).toBe('c'.repeat(40));
    expect(parsed.nodes.map((n) => n.id)).toEqual(['src/a.ts', 'src/z.ts']);
  });
});

// ════════════════════════════════════════════════════════════════════
// F271 FR-004 — UnifiedNode → GraphNode 的 lineRange 透传（两条分支缺一不可）
// ════════════════════════════════════════════════════════════════════

/** 构造一个只含 unifiedGraph 数据源的最小 build 入参。 */
function unifiedOnly(
  nodes: Array<{ id: string; kind?: string; label?: string; filePath?: string; metadata?: Record<string, unknown> }>,
): { unifiedGraph: { nodes: typeof nodes; edges: never[] } } {
  return { unifiedGraph: { nodes, edges: [] } };
}

describe('buildKnowledgeGraph — lineRange 透传（F271 FR-004）', () => {
  it('分支①（新节点构造）：unified 侧 lineRange 透传到 GraphNode.metadata', () => {
    const graph = buildKnowledgeGraph(
      unifiedOnly([
        {
          id: 'src/a.ts::namedFn',
          kind: 'symbol',
          label: 'namedFn',
          filePath: 'src/a.ts',
          metadata: { exportKind: 'function', lineRange: { start: 42, end: 57 } },
        },
      ]),
    );

    const node = graph.nodes.find((n) => n.id === 'src/a.ts::namedFn');
    expect(node).toBeDefined();
    // 走的确实是"新节点"路径
    expect(node!.metadata['sourceTag']).toBe('unified-graph');
    expect(node!.metadata['lineRange']).toEqual({ start: 42, end: 57 });
  });

  it('分支②（已有节点补齐）：extraction 侧先写入的同 id 节点被补齐 lineRange', () => {
    // 第四路（extraction）先写入同 id 节点 → unified 侧进入 `existing` 补齐分支
    const graph = buildKnowledgeGraph({
      extractionResults: [
        {
          nodes: [
            {
              id: 'src/a.ts::namedFn',
              kind: 'component',
              label: 'namedFn',
              source_file: 'src/a.ts',
              confidence: 'EXTRACTED',
              metadata: { symbolKind: 'function' },
            },
          ],
          edges: [],
        },
      ],
      ...unifiedOnly([
        {
          id: 'src/a.ts::namedFn',
          kind: 'symbol',
          label: 'namedFn',
          filePath: 'src/a.ts',
          metadata: { exportKind: 'function', lineRange: { start: 7, end: 21 } },
        },
      ]),
    } as Parameters<typeof buildKnowledgeGraph>[0]);

    const node = graph.nodes.find((n) => n.id === 'src/a.ts::namedFn');
    expect(node).toBeDefined();
    // 走的确实是"已有节点补齐"路径：extraction provenance 未被覆盖
    expect(node!.metadata['sourceTag']).toBe('extraction');
    expect(node!.metadata['symbolKind']).toBe('function');
    // 补齐分支同样透传 lineRange（不加就静默丢弃）
    expect(node!.metadata['lineRange']).toEqual({ start: 7, end: 21 });
  });

  it('负向（Delta 再审 W1）：extraction 侧畸形 lineRange 在合流分支被剔除，不经 spread 存活', () => {
    // extraction 侧带畸形值（start:0 是 number、能穿过消费端 typeof 闸的最危险形态），
    // unified 侧无 lineRange → merged 为 undefined。收口点必须剥掉旧 key，
    // 只"不写新 key"会让畸形原值经 ...existing.metadata 原样进图。
    const graph = buildKnowledgeGraph({
      extractionResults: [
        {
          nodes: [
            {
              id: 'src/a.ts::badSpan',
              kind: 'component',
              label: 'badSpan',
              source_file: 'src/a.ts',
              confidence: 'EXTRACTED',
              metadata: { symbolKind: 'function', lineRange: { start: 0, end: 5 } },
            },
          ],
          edges: [],
        },
      ],
      ...unifiedOnly([
        {
          id: 'src/a.ts::badSpan',
          kind: 'symbol',
          label: 'badSpan',
          filePath: 'src/a.ts',
          metadata: { exportKind: 'function' },
        },
      ]),
    } as Parameters<typeof buildKnowledgeGraph>[0]);

    const node = graph.nodes.find((n) => n.id === 'src/a.ts::badSpan');
    expect(node).toBeDefined();
    expect(node!.metadata['sourceTag']).toBe('extraction');
    expect('lineRange' in node!.metadata).toBe(false);
  });

  it('负向：unified 侧无 lineRange 时，产出节点不含该 key（不写 undefined 占位）', () => {
    const graph = buildKnowledgeGraph(
      unifiedOnly([
        {
          id: 'src/a.ts::Foo.bar',
          kind: 'symbol',
          label: 'Foo.bar',
          filePath: 'src/a.ts',
          metadata: { memberKind: 'method' },
        },
      ]),
    );

    const node = graph.nodes.find((n) => n.id === 'src/a.ts::Foo.bar');
    expect(node).toBeDefined();
    expect('lineRange' in node!.metadata).toBe(false);
  });

  it('负向：畸形 lineRange（非数字 / 非对象 / null）一律按缺席处理，不带进图', () => {
    const graph = buildKnowledgeGraph(
      unifiedOnly([
        {
          id: 'bad/str.ts::a',
          kind: 'symbol',
          metadata: { lineRange: 'oops' },
        },
        {
          id: 'bad/partial.ts::b',
          kind: 'symbol',
          metadata: { lineRange: { start: 1 } },
        },
        {
          id: 'bad/nonnum.ts::c',
          kind: 'symbol',
          metadata: { lineRange: { start: '1', end: '2' } },
        },
        {
          id: 'bad/null.ts::d',
          kind: 'symbol',
          metadata: { lineRange: null },
        },
      ]),
    );

    for (const id of ['bad/str.ts::a', 'bad/partial.ts::b', 'bad/nonnum.ts::c', 'bad/null.ts::d']) {
      const node = graph.nodes.find((n) => n.id === id);
      expect(node).toBeDefined();
      expect('lineRange' in node!.metadata).toBe(false);
    }
  });

  // F271 对抗审查 F3：结构校验与两个生产端同判据（整数 / 1-indexed / start <= end）
  it.each([
    ['start > end', { start: 9, end: 3 }],
    ['start = 0（非 1-indexed）', { start: 0, end: 5 }],
    ['负数', { start: -3, end: -1 }],
    ['非整数', { start: 1.5, end: 4 }],
  ])('负向：畸形 span（%s）按缺席处理', (_label, lineRange) => {
    const graph = buildKnowledgeGraph(
      unifiedOnly([{ id: 'src/a.ts::s', kind: 'symbol', metadata: { lineRange } }]),
    );
    const node = graph.nodes.find((n) => n.id === 'src/a.ts::s');
    expect(node).toBeDefined();
    expect('lineRange' in node!.metadata).toBe(false);
  });

  // F271 对抗审查 F1：合流分支的两侧不保证等值（同名符号在 extraction / unified 两条路径上
  // 可能折叠到不同条目），静默覆盖会丢掉一侧的行区间。
  it('合流：两侧 lineRange 不等时取并集（不是让 unified 侧静默覆盖 extraction 侧）', () => {
    const graph = buildKnowledgeGraph({
      extractionResults: [
        {
          nodes: [
            {
              id: 'src/a.ts::dup',
              kind: 'component',
              label: 'dup',
              source_file: 'src/a.ts',
              confidence: 'EXTRACTED',
              metadata: { symbolKind: 'function', lineRange: { start: 3, end: 8 } },
            },
          ],
          edges: [],
        },
      ],
      ...unifiedOnly([
        {
          id: 'src/a.ts::dup',
          kind: 'symbol',
          label: 'dup',
          filePath: 'src/a.ts',
          metadata: { exportKind: 'function', lineRange: { start: 20, end: 26 } },
        },
      ]),
    } as Parameters<typeof buildKnowledgeGraph>[0]);

    const node = graph.nodes.find((n) => n.id === 'src/a.ts::dup');
    expect(node!.metadata['lineRange']).toEqual({ start: 3, end: 26 });
  });

  it('合流：unified 侧缺席时保留 extraction 侧已有 lineRange（不被抹掉）', () => {
    const graph = buildKnowledgeGraph({
      extractionResults: [
        {
          nodes: [
            {
              id: 'src/a.ts::only',
              kind: 'component',
              label: 'only',
              source_file: 'src/a.ts',
              confidence: 'EXTRACTED',
              metadata: { symbolKind: 'function', lineRange: { start: 5, end: 11 } },
            },
          ],
          edges: [],
        },
      ],
      ...unifiedOnly([
        { id: 'src/a.ts::only', kind: 'symbol', label: 'only', filePath: 'src/a.ts', metadata: {} },
      ]),
    } as Parameters<typeof buildKnowledgeGraph>[0]);

    const node = graph.nodes.find((n) => n.id === 'src/a.ts::only');
    expect(node!.metadata['lineRange']).toEqual({ start: 5, end: 11 });
  });
});
