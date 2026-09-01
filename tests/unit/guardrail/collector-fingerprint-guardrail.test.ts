/**
 * F249 T046/T047：双轨重建-对比护栏 + 扰动注入测试组（FR-005 / SC-005(b) / SC-010(a)）。
 *
 * 护栏在回答一个问题：**采集器行为悄悄变了，但 `behaviorVersion` 没人 bump**——这种情况下所有
 * 既有图产物都成了"指纹说没变、内容实际已变"的谎言，而单元测试不会红（各管线单测测的是各自
 * 契约，没人测"整体产物是否还是那张图"）。
 *
 * 为什么必须双轨（plan Complexity Tracking 已定案）：`moduleDerivationScan`（#7/#8）管线**只**被
 * full batch 主链消费，`buildAstGraphOnly` 全程不触达它（该前提由 T032 的 spy 回归锁定）。
 * 只跑 a-track 会让 `.mjs`/`.cjs`/`.mts`/`.cts` 这一整片采集面处于护栏盲区。
 *
 * 测试组结构：
 *   1. a-track 基础比对（graph-only 重建 vs pinned，节点 id multiset + 边 multiset 严格相等）
 *   2. b-track 基础比对（module 派生重建 → 归一化 vs pinned，深度相等 + 指定端点边精确断言）
 *   3. b-track fallback 用例（空 registry，#8 路径端到端扫描面 == SSoT）
 *   4. 扰动注入组（T047）：比较器灵敏度 + 真实重建绿路径活性 + 拒绝纯函数真值表交叉引用
 *
 * 比较器**从再生脚本 import**（非本文件另写一份）：一旦"生成 pinned 时怎么比"与"护栏怎么比"
 * 分叉，护栏会静默退化为永久绿。同理 `normalizeModuleGraphSnapshot`/registry helper/typed loader
 * 三者也与再生脚本共用。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  MODULE_DERIVATION_SCAN_SURFACE,
  TSJS_SKELETON_WALK_SURFACE,
} from '../../../src/collector-surface.js';
import { buildAstGraphOnly } from '../../../src/batch/batch-orchestrator.js';
import { buildModuleGraphForProject } from '../../../src/knowledge-graph/module-derivation.js';
import { buildUnifiedGraph } from '../../../src/knowledge-graph/index.js';
import { collectTsJsCodeSkeletons } from '../../../src/batch/stages/source-discovery.js';
import { collectGenericLanguageCodeSkeletons } from '../../../src/batch/generic-language-skeleton-collector.js';
import { PythonLanguageAdapter } from '../../../src/adapters/python-adapter.js';
import {
  BEHAVIOR_VERSION,
  computeCollectorFingerprint,
  fingerprintsEqual,
  isValidCollectorFingerprint,
  parseCollectorFingerprint,
} from '../../../src/panoramic/graph/collector-fingerprint.js';
import type { GraphJSON } from '../../../src/panoramic/graph/graph-types.js';
import {
  compareGraphOnlyStructure,
  compareModuleGraphSnapshot,
  GRAPH_ONLY_ASSET_FILENAME,
  MODULE_GRAPH_ASSET_FILENAME,
} from '../../../scripts/regen-collector-fingerprint-fixtures.js';
import {
  bootstrapGuardrailRegistryFallback,
  bootstrapGuardrailRegistryMain,
  resetGuardrailRegistry,
} from '../../helpers/bootstrap-guardrail-registry.js';
import {
  normalizeModuleGraphSnapshot,
  type NormalizedModuleGraphSnapshot,
} from '../../helpers/module-graph-snapshot-normalize.js';
import {
  loadPinnedGraphOnlyAsset,
  loadPinnedModuleGraphAsset,
} from '../../helpers/pinned-asset-loader.js';

const FIXTURE_ROOT = path.resolve(
  __dirname,
  '../../fixtures/collector-fingerprint-guardrail',
);

/** b-track 精确端点断言的两个 module id（`entry.mjs` 内容钉死才使这条边稳定存在，P10）。 */
const ENTRY_MODULE_ID = 'src/module-only/entry.mjs';
const FOO_MODULE_ID = 'src/ts/foo.ts';

const tmpDirs: string[] = [];

/** 把 fixture 的 `src/` 复制到独立临时目录：两轨互不共享，避免 a 轨写盘产物影响 b 轨扫描面。 */
function stageFixture(): string {
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-guardrail-'));
  tmpDirs.push(staged);
  fs.cpSync(path.join(FIXTURE_ROOT, 'src'), path.join(staged, 'src'), { recursive: true });
  return staged;
}

/** 结构化深拷贝：扰动注入必须改副本，否则一个用例的扰动会污染后续用例的比对基线。 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const pinnedGraphOnly = loadPinnedGraphOnlyAsset(
  path.join(FIXTURE_ROOT, GRAPH_ONLY_ASSET_FILENAME),
);
const pinnedModuleGraph = loadPinnedModuleGraphAsset(
  path.join(FIXTURE_ROOT, MODULE_GRAPH_ASSET_FILENAME),
);

let rebuiltGraph: GraphJSON;
let rebuiltModuleGraph: NormalizedModuleGraphSnapshot;

beforeAll(async () => {
  // a-track：`buildAstGraphOnly` 的三个采集器（source-discovery 的 py/tsjs + generic collector）
  // 均不经 LanguageAdapterRegistry，故本轨产物与 registry 状态无关；仍与 b 轨用不同临时目录。
  const graphStage = stageFixture();
  const result = await buildAstGraphOnly(graphStage);
  rebuiltGraph = JSON.parse(fs.readFileSync(result.graphPath, 'utf-8')) as GraphJSON;

  // b-track：显式 bootstrap（#7 ts-js adapter 已注册路径），`finally` 里 reset-to-empty，
  // 与再生脚本的 `try/finally` 纪律逐字一致。
  const moduleStage = stageFixture();
  bootstrapGuardrailRegistryMain();
  try {
    rebuiltModuleGraph = normalizeModuleGraphSnapshot(
      await buildModuleGraphForProject(moduleStage),
    );
  } finally {
    resetGuardrailRegistry();
  }
});

afterEach(() => {
  // 两类用例统一 reset-to-empty（plan 决策 8）：不猜测下一个用例需要什么 bootstrap 状态
  resetGuardrailRegistry();
});

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('a-track：graph-only 重建 vs pinned 期望（FR-005 / SC-005(b)）', () => {
  it('节点 id multiset + 边 multiset + metadata key 集合三维度与 pinned 严格相等（FR-005 / FR-009 活性证明）', () => {
    const comparison = compareGraphOnlyStructure(rebuiltGraph, pinnedGraphOnly.graph);
    expect(comparison.differences).toEqual([]);
    expect(comparison.mismatch).toBe(false);
  });

  it('pinned 与重建产物均记录合法指纹，且 behaviorVersion 等于当前 BEHAVIOR_VERSION（FR-005(c)）', () => {
    const pinnedFingerprint = pinnedGraphOnly.graph.graph.fingerprint;
    const rebuiltFingerprint = rebuiltGraph.graph.fingerprint;

    expect(isValidCollectorFingerprint(pinnedFingerprint)).toBe(true);
    expect(isValidCollectorFingerprint(rebuiltFingerprint)).toBe(true);
    expect(pinnedFingerprint?.behaviorVersion).toBe(BEHAVIOR_VERSION);
    expect(rebuiltFingerprint?.behaviorVersion).toBe(BEHAVIOR_VERSION);
    // F252：isValidCollectorFingerprint 收紧为纯 boolean 后不再是类型谓词，`as never` 类型
    // 断言绕过已不是合适写法——改经 parseCollectorFingerprint 拿到强类型 snapshot（if-throw
    // 是真实 control-flow narrowing，而非 expect() 内的伪窄化）。
    const pinnedSnapshot = parseCollectorFingerprint(pinnedFingerprint);
    if (pinnedSnapshot === null) {
      throw new Error('pinned fingerprint 应合法（上方 isValidCollectorFingerprint 已断言为 true）');
    }
    // pinned 记录的指纹与当前代码状态语义相等——不等就说明 pinned 过期，护栏本身失去参照
    expect(fingerprintsEqual(pinnedSnapshot, computeCollectorFingerprint())).toBe(true);
  });

  it('覆盖 #1 六扩展 + #2 两扩展 + #3 大小写变体样本（护栏输入面未被悄悄缩小）', () => {
    const fileNodeIds = new Set(rebuiltGraph.nodes.map((node) => node.id));
    for (const expected of [
      'src/ts/foo.ts',
      'src/ts/foo.tsx',
      'src/ts/bar.js',
      'src/ts/bar.jsx',
      'src/py/mod.py',
      'src/py/mod.pyi',
      'src/java/Foo.JAVA',
      'src/go/main.go',
      // rebase 调和：`.mjs` 经 d27ba75 扩面进入 tsjsSkeletonWalk（#1），entry.mjs 因此
      // 从"仅 b-track 可见"变为**双轨都可见**。原断言是 `not.toContain`——那条 a-track
      // 盲区随扩面消失，这里如实翻转为正向断言（而不是保留一条已经不成立的"盲区"叙事）。
      ENTRY_MODULE_ID,
    ]) {
      expect(fileNodeIds).toContain(expected);
    }
  });

  // F259 T009：护栏对 `#2 pyWalk` 管线此前零独占覆盖（探针 C：整体剔除 pythonSkeletons 后
  // 护栏仍 20/20 全绿）——mod.py/mod.pyi 样本无 import/callSite，两条生产者（#2 pyWalk /
  // #11 pythonSymbolScan）在节点面完全重合，`#2` 唯一能独占贡献的 calls/depends-on 边面因此
  // 是空的。producer.py/consumer.py 构成真实 py→py import + call，`#11`（extractSymbolNodes）
  // 结构上不读取 imports/callSites，产不出这两条边——断言具体端点而非仅"边数非空"（P10 纪律）。
  it('#2 pyWalk 独占贡献 py→py 的 depends-on 与 calls 边（探针 C 边面覆盖，禁止仅断言非空）', () => {
    expect(rebuiltGraph.links).toContainEqual(
      expect.objectContaining({
        source: 'src/py/consumer.py',
        target: 'src/py/producer.py',
        relation: 'depends-on',
      }),
    );
    expect(rebuiltGraph.links).toContainEqual(
      expect.objectContaining({
        source: 'src/py/consumer.py::use',
        target: 'src/py/producer.py::make',
        relation: 'calls',
      }),
    );
  });

  // 扩面后 b-track 的存在理由需要重新锚定：a-track 仍**看不到** `.mts`/`.cts`
  // （tsjsSkeletonWalk 显式不含，仅 moduleDerivationScan 覆盖），且 a-track 比较的是
  // symbol/file 图而非 module 投影。这条用例把"两轨覆盖面确实不等"钉死，避免将来
  // 有人以"两轨都能看到 entry.mjs"为由删掉 b-track。
  it('a-track 与 b-track 覆盖面仍不等价：.mts/.cts 不在 #1 面内（b-track 不可被裁掉）', () => {
    expect(TSJS_SKELETON_WALK_SURFACE.extensions.has('.mjs')).toBe(true);
    expect(TSJS_SKELETON_WALK_SURFACE.extensions.has('.mts')).toBe(false);
    expect(TSJS_SKELETON_WALK_SURFACE.extensions.has('.cts')).toBe(false);
    expect(MODULE_DERIVATION_SCAN_SURFACE.extensions.has('.mts')).toBe(true);
    expect(MODULE_DERIVATION_SCAN_SURFACE.extensions.has('.cts')).toBe(true);
  });
});

describe('b-track 主用例：module 派生重建 vs pinned 期望（#7 registry 已注册路径）', () => {
  beforeEach(() => {
    bootstrapGuardrailRegistryMain();
  });

  it('归一化投影与 pinned 深度相等', () => {
    const comparison = compareModuleGraphSnapshot(rebuiltModuleGraph, pinnedModuleGraph.moduleGraph);
    expect(comparison.differences).toEqual([]);
    expect(comparison.mismatch).toBe(false);
  });

  it('modules/edges 非空，且存在 entry.mjs → foo.ts 这条指定端点的边（P10：禁止仅断言非空）', () => {
    expect(rebuiltModuleGraph.modules.length).toBeGreaterThan(0);
    expect(rebuiltModuleGraph.edges.length).toBeGreaterThan(0);

    const moduleIds = rebuiltModuleGraph.modules.map((module) => module.source);
    expect(moduleIds).toContain(ENTRY_MODULE_ID);
    expect(moduleIds).toContain(FOO_MODULE_ID);

    const targetedEdge = rebuiltModuleGraph.edges.find(
      (edge) => edge.from === ENTRY_MODULE_ID && edge.to === FOO_MODULE_ID,
    );
    expect(targetedEdge).toBeDefined();
    expect(targetedEdge?.importType).toBe('static');
  });

  it('pinned 资产记录的 behaviorVersion 等于当前 BEHAVIOR_VERSION', () => {
    expect(pinnedModuleGraph.fingerprint.behaviorVersion).toBe(BEHAVIOR_VERSION);
    expect(fingerprintsEqual(pinnedModuleGraph.fingerprint, computeCollectorFingerprint())).toBe(
      true,
    );
  });

  it('两份 pinned 资产的 fixtureInputHash 彼此一致（资产对未被单侧手工编辑）', () => {
    expect(pinnedGraphOnly.fixtureInputHash).toBe(pinnedModuleGraph.fixtureInputHash);
  });
});

describe('b-track fallback 用例：空 registry 时的 #8 fallback 扫描面（R4 防守项 5）', () => {
  beforeEach(() => {
    // 故意不注册任何 adapter：让 module-derivation 走 MODULE_DERIVATION_SCAN_SURFACE fallback
    bootstrapGuardrailRegistryFallback();
  });

  it('fallback 路径与 #7 路径产出的拓扑完全一致，唯一差异是 modules[].language 缺席', async () => {
    const staged = stageFixture();
    const snapshot = normalizeModuleGraphSnapshot(await buildModuleGraphForProject(staged));

    // 实测确认的**真实**行为差异（非缺陷）：`language` 由命中的 adapter 赋值，空 registry 下
    // 无 adapter 可归属，故该字段缺席。把它当成"两条路径完全等价"来断言会是假绿；
    // 这里显式钉死差异面，未来若 fallback 开始编造 language、或 #7 路径丢掉 language，都会变红。
    expect(snapshot.modules.every((module) => module.language === undefined)).toBe(true);
    expect(pinnedModuleGraph.moduleGraph.modules.every((module) => module.language === 'ts-js')).toBe(
      true,
    );

    // 除 language 外的其余字段（含 source/度数/level/edges/sccs/topologicalOrder/mermaidSource）
    // 逐字段深度相等——证明 #8 fallback 的扫描面与派生逻辑与 #7 路径同口径。
    const stripLanguage = (graph: NormalizedModuleGraphSnapshot): NormalizedModuleGraphSnapshot => {
      const copy = deepClone(graph);
      for (const module of copy.modules) delete module.language;
      return copy;
    };
    const comparison = compareModuleGraphSnapshot(
      stripLanguage(snapshot),
      stripLanguage(pinnedModuleGraph.moduleGraph),
    );
    expect(comparison.differences).toEqual([]);
  });

  it('fallback 端到端扫描到的扩展名集合与 SSoT MODULE_DERIVATION_SCAN_SURFACE 完全一致', async () => {
    // 为什么另造探针目录而不复用 guardrail fixture：fixture 只含 .mjs 一个 module 专属扩展，
    // 用它只能证明"集合是 SSoT 的子集"。要证明**相等**，必须每个 SSoT 扩展各一个样本；
    // 而 fixture 内容是 pinned 的，不能为这条断言扩充（扩充等同基线变更，见 README 禁止事项）。
    const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-ext-probe-'));
    tmpDirs.push(probeRoot);
    const probeSrc = path.join(probeRoot, 'src');
    fs.mkdirSync(probeSrc, { recursive: true });

    const expectedExtensions = [...MODULE_DERIVATION_SCAN_SURFACE.extensions].sort();
    for (const extension of expectedExtensions) {
      fs.writeFileSync(path.join(probeSrc, `probe${extension}`), 'export const probe = 1;\n', 'utf-8');
    }
    // 负控：SSoT 未声明的扩展名 MUST NOT 被 fallback 扫描面采集
    fs.writeFileSync(path.join(probeSrc, 'probe.py'), 'probe = 1\n', 'utf-8');
    fs.writeFileSync(path.join(probeSrc, 'probe.go'), 'package probe\n', 'utf-8');

    const graph = await buildModuleGraphForProject(probeRoot);
    const scannedExtensions = [
      ...new Set(graph.modules.map((module) => path.extname(module.source))),
    ].sort();

    expect(scannedExtensions).toEqual(expectedExtensions);
  });
});

describe('扰动注入组（T047 / SC-010(a) 三件套）', () => {
  describe('① 比较器灵敏度证明：注入语义扰动后 MUST 报不一致', () => {
    it('a-track：删除一条边 → 严格比较器报不一致', () => {
      const perturbed = deepClone(rebuiltGraph);
      expect(perturbed.links.length).toBeGreaterThan(0);
      const removed = perturbed.links.pop();

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain(String(removed?.target));
    });

    it('a-track：篡改一个节点 id → 严格比较器报不一致（集合等价性被打破）', () => {
      const perturbed = deepClone(rebuiltGraph);
      const victim = perturbed.nodes[0];
      expect(victim).toBeDefined();
      const originalId = victim?.id as string;
      if (victim) victim.id = `${originalId}__PERTURBED`;

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain('__PERTURBED');
    });

    it('a-track：重复一个节点（W-007 multiset 计数变化）→ 报不一致（集合式比较会漏掉这类）', () => {
      const perturbed = deepClone(rebuiltGraph);
      const duplicated = perturbed.nodes[0];
      expect(duplicated).toBeDefined();
      if (duplicated) perturbed.nodes.push(deepClone(duplicated));

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      // 原实现节点侧用 Set，重复 id 被折叠 → 判"一致"；multiset 后必须报计数差异
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain('节点计数不一致');
      expect(comparison.differences.join('\n')).toContain(String(duplicated?.id));
    });

    it('a-track：仅节点顺序不同（无重复、无增删）→ 判一致（multiset 不引入顺序敏感性）', () => {
      const reordered = deepClone(rebuiltGraph);
      reordered.nodes.reverse();
      reordered.links.reverse();

      expect(compareGraphOnlyStructure(reordered, pinnedGraphOnly.graph).mismatch).toBe(false);
    });

    it('a-track：重复一条边（multiset 计数变化）→ 报不一致（集合式比较会漏掉这类）', () => {
      const perturbed = deepClone(rebuiltGraph);
      const duplicated = perturbed.links[0];
      expect(duplicated).toBeDefined();
      if (duplicated) perturbed.links.push(deepClone(duplicated));

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain('边计数不一致');
    });

    // F278 M1/M2/M3（FR-005/FR-007/FR-010）：node metadata 的 **key 集合**扰动。
    // 这三条与上面五条的分工是：上面证明"节点/边的存在与计数"变了会红，这三条证明
    // "节点还在、id 不变，但它携带的字段名集合变了"同样会红——F271 的 lineRange 入库正是
    // 这一形态，当时既有两个维度全程判绿，护栏对它完全失明。
    it('a-track：删除某节点的一个 metadata key（lineRange）→ 报 metadata key 集合不一致', () => {
      const perturbed = deepClone(rebuiltGraph);
      const victim = perturbed.nodes.find((node) => node.metadata?.lineRange !== undefined);
      expect(victim).toBeDefined();
      if (victim) delete victim.metadata.lineRange;

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      const joined = comparison.differences.join('\n');
      expect(joined).toContain('metadata key 集合不一致');
      expect(joined).toContain(String(victim?.id));
      // F278 返工 A3：断到**含格子**的完整子串。原断言 `toContain('lineRange')` 对"同一个词
      // 换了个格子"完全无感——把 missing/extra 两个数组算反（重建缺失 [] vs 重建新增 [lineRange]）
      // 时它照样绿，而对护栏来说"是重建丢了字段还是重建多了字段"就是全部的信息量。
      expect(joined).toContain(
        `metadata key 集合不一致（重建缺失 [lineRange] vs 重建新增 []）: ${String(victim?.id)}`,
      );
    });

    it('a-track：给某节点新增一个 metadata key → 同样报不一致（双向变异，非单向"只抓删"）', () => {
      const perturbed = deepClone(rebuiltGraph);
      const victim = perturbed.nodes[0];
      expect(victim).toBeDefined();
      if (victim) victim.metadata.__mutantKey = 1;

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      // F278 返工 A3：同上，断到含格子的完整子串（`toContain('__mutantKey')` 对方向反转无感）
      expect(comparison.differences.join('\n')).toContain(
        `metadata key 集合不一致（重建缺失 [] vs 重建新增 [__mutantKey]）: ${String(victim?.id)}`,
      );
    });

    it('a-track：整个 metadata 字段缺席（undefined）→ 报缺席态不一致（与 `{}` 不得混同）', () => {
      const perturbed = deepClone(rebuiltGraph);
      const victim = perturbed.nodes[0];
      expect(victim).toBeDefined();
      // 类型上 metadata 必填，但磁盘/运行时确实可能整字段缺席——这正是本用例要钉死的退化态
      if (victim) delete (victim as { metadata?: unknown }).metadata;

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      const joined = comparison.differences.join('\n');
      expect(joined).toContain('metadata 缺席态不一致');
      expect(joined).toContain('<absent>');
    });

    /**
     * A1/A2（F278 返工）共用构造器：对**同一个 node id** 的两侧分别注入不同的 metadata 形态。
     *
     * 为什么两侧都要动、且必须锁同一个 id：第三维度只对"两侧该 id 的节点数相等"的 id 求值，
     * 两侧各取 `nodes[0]`（顺序不保证一致）会退化成"改了两个不同节点"，测到的就成了第一维度
     * 而不是缺席态分档。
     *
     * 为什么必须直接把两种缺席态对上，而不是各自与"正常 4-key 节点"对比：既有 M3 用例的对照侧
     * （`pinnedGraphOnly.graph` 的同 id 节点）恒有 4 个 key，因此它对"`{}` 或 `null` 被折叠进
     * `<absent>`"这类**档位塌缩**变异完全无鉴别力——塌缩后两侧仍不等，用例照样绿。
     */
    function injectMetadataOnSharedNode(
      mutateRebuilt: (node: Record<string, unknown>) => void,
      mutatePinned: (node: Record<string, unknown>) => void,
    ): { rebuilt: GraphJSON; pinned: GraphJSON; id: string } {
      const rebuilt = deepClone(rebuiltGraph);
      const pinned = deepClone(pinnedGraphOnly.graph);
      const id = rebuilt.nodes[0]?.id as string;
      expect(id).toBeTruthy();
      const rebuiltVictim = rebuilt.nodes.find((node) => node.id === id);
      const pinnedVictim = pinned.nodes.find((node) => node.id === id);
      expect(rebuiltVictim).toBeDefined();
      expect(pinnedVictim).toBeDefined();
      mutateRebuilt(rebuiltVictim as unknown as Record<string, unknown>);
      mutatePinned(pinnedVictim as unknown as Record<string, unknown>);
      return { rebuilt, pinned, id };
    }

    it('a-track：一侧 metadata 整字段缺席、另一侧 metadata={} → 报缺席态不一致（两态 MUST NOT 塌缩，FR-007）', () => {
      const { rebuilt, pinned, id } = injectMetadataOnSharedNode(
        (node) => {
          delete node.metadata;
        },
        (node) => {
          node.metadata = {};
        },
      );

      const comparison = compareGraphOnlyStructure(rebuilt, pinned);
      expect(comparison.mismatch).toBe(true);
      // 断到含两侧签名的完整文案：只断"报了不一致"分不清"两态被正确分档"与"两态塌缩成同一档
      // 但恰好与对侧不等"；这里的 `<absent>` 与 `[]` 必须同时出现在同一行上
      expect(comparison.differences.join('\n')).toContain(
        `metadata 缺席态不一致（重建 <absent> vs pinned []）: ${id}`,
      );
    });

    it('a-track：一侧 metadata 整字段缺席、另一侧 metadata=null → 报缺席态不一致且 null 单列一档', () => {
      const { rebuilt, pinned, id } = injectMetadataOnSharedNode(
        (node) => {
          delete node.metadata;
        },
        (node) => {
          node.metadata = null;
        },
      );

      const comparison = compareGraphOnlyStructure(rebuilt, pinned);
      // 把 `<non-object:*>` 折叠进 `<absent>` 会让这里判"一致"——那是对真退化的静默放行，
      // 比"报错文案不够精确"严重一个量级，因此 mismatch 与文案两项都要断
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain(
        `metadata 缺席态不一致（重建 <absent> vs pinned <non-object:null>）: ${id}`,
      );
    });

    it('a-track：逐节点重排 metadata 的 key 插入顺序（内容一字不改）→ 判一致（签名规范化，不引入顺序敏感性）', () => {
      const reordered = deepClone(rebuiltGraph);
      let reorderedNodeCount = 0;
      for (const node of reordered.nodes) {
        const raw = (node as { metadata?: Record<string, unknown> }).metadata;
        if (raw === undefined || raw === null) continue;
        const keys = Object.keys(raw);
        if (keys.length < 2) continue;
        const rebuiltMetadata: Record<string, unknown> = {};
        for (const key of [...keys].reverse()) rebuiltMetadata[key] = raw[key];
        (node as { metadata: Record<string, unknown> }).metadata = rebuiltMetadata;
        reorderedNodeCount += 1;
      }
      // 活性前提：至少有一个节点真的被重排过，否则本用例是恒真的空断言
      expect(reorderedNodeCount).toBeGreaterThan(0);

      // 签名函数若丢掉 `Object.keys().sort()`，护栏会就地变成**假红发生器**（每个多 key 节点
      // 都误报），而既有 8 条 a-track 扰动用例全部是"注入扰动 → 期望报不一致"的方向，
      // 对"不该报却报了"零覆盖
      const comparison = compareGraphOnlyStructure(reordered, pinnedGraphOnly.graph);
      expect(comparison.differences).toEqual([]);
      expect(comparison.mismatch).toBe(false);
    });

    /**
     * F278 收尾 B1 共用构造器：让**同一个 node id** 在两侧各出现 2 次，并分别指定两个副本的
     * metadata key 集合，用于覆盖 `compareNodeMetadataKeys` 的**重复 id 通用 multiset 分支**
     * （spec US2 Acceptance Scenario 2 点名的场景，此前只有实现、没有任何验收）。
     *
     * 为什么两侧都必须复制成同样的份数：第三维度只对"两侧该 id 的节点数相等"的 id 求值。只复制
     * 一侧的话，第一维度（节点 id multiset）会抢先报 `节点计数不一致`，第三维度直接跳过——用例
     * 测到的就成了第一维度，重复 id 分支依旧零覆盖。
     */
    function injectDuplicatedNodeMetadata(
      rebuiltKeySets: readonly string[][],
      pinnedKeySets: readonly string[][],
    ): { rebuilt: GraphJSON; pinned: GraphJSON; id: string } {
      const buildSide = (source: GraphJSON, id: string, keySets: readonly string[][]): GraphJSON => {
        const graph = deepClone(source);
        const template = graph.nodes.find((node) => node.id === id);
        expect(template).toBeDefined();
        const copyWithKeys = (keys: readonly string[]): GraphJSON['nodes'][number] => {
          const copy = deepClone(template as GraphJSON['nodes'][number]);
          copy.metadata = Object.fromEntries(keys.map((key) => [key, 1]));
          return copy;
        };
        // 先摘掉该 id 的原始副本，再按 keySets 放回等量副本：两侧份数由入参对称保证
        graph.nodes = [...graph.nodes.filter((node) => node.id !== id), ...keySets.map(copyWithKeys)];
        return graph;
      };
      const id = rebuiltGraph.nodes[0]?.id as string;
      expect(id).toBeTruthy();
      return {
        rebuilt: buildSide(rebuiltGraph, id, rebuiltKeySets),
        pinned: buildSide(pinnedGraphOnly.graph, id, pinnedKeySets),
        id,
      };
    }

    it('a-track：同一 node id 两侧各 2 次、key-set multiset 不同 → 报 metadata key 签名计数不一致（重复 id 分支，US2 AS-2）', () => {
      const { rebuilt, pinned, id } = injectDuplicatedNodeMetadata(
        [
          ['A', 'B'],
          ['A', 'B'],
        ],
        [['A', 'B'], ['A']],
      );

      const comparison = compareGraphOnlyStructure(rebuilt, pinned);
      expect(comparison.mismatch).toBe(true);
      const joined = comparison.differences.join('\n');
      // 活性前提：两侧该 id 的节点数都是 2，第一维度不会报差异——断言"没被第一维度抢先报掉"，
      // 否则本用例会在第三维度被整段删掉时依然绿（那正是它要防的退化）
      expect(joined).not.toContain('节点计数不一致');
      // 断到含计数与签名的完整文案：只断"报了不一致"分不清是重复 id 分支报的、还是别的分支
      expect(joined).toContain(`metadata key 签名计数不一致（重建 2 vs pinned 1）: ${id} @ ["A","B"]`);
      expect(joined).toContain(`metadata key 签名计数不一致（重建 0 vs pinned 1）: ${id} @ ["A"]`);
    });

    it('a-track：同一 node id 两侧各 2 次、key-set multiset 相同但顺序不同 → 判一致（multiset 语义，不是按下标配对）', () => {
      const { rebuilt, pinned } = injectDuplicatedNodeMetadata(
        [['A', 'B'], ['A']],
        [['A'], ['A', 'B']],
      );

      // 重复 id 分支若退化成"按数组下标两两配对"，这条会误报两处差异——与上一条互补：
      // 上一条证明"该报会报"，这一条证明"不该报不会报"
      const comparison = compareGraphOnlyStructure(rebuilt, pinned);
      expect(comparison.differences).toEqual([]);
      expect(comparison.mismatch).toBe(false);
    });

    it('b-track：删除一个 module → 深度比较报不一致', () => {
      const perturbed = deepClone(rebuiltModuleGraph);
      expect(perturbed.modules.length).toBeGreaterThan(0);
      perturbed.modules.pop();

      const comparison = compareModuleGraphSnapshot(perturbed, pinnedModuleGraph.moduleGraph);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain('数组长度不一致');
    });

    it('b-track：篡改一条边端点 → 深度比较报不一致', () => {
      const perturbed = deepClone(rebuiltModuleGraph);
      const victim = perturbed.edges[0];
      expect(victim).toBeDefined();
      if (victim) victim.to = 'src/ts/NOT-A-REAL-MODULE.ts';

      const comparison = compareModuleGraphSnapshot(perturbed, pinnedModuleGraph.moduleGraph);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain('NOT-A-REAL-MODULE');
    });

    it('b-track：篡改 modules[].language 等非结构字段 → 同样报不一致（归一化未过度剥离）', () => {
      const perturbed = deepClone(rebuiltModuleGraph);
      const victim = perturbed.modules[0];
      expect(victim).toBeDefined();
      if (victim) victim.language = 'perturbed-language';

      const comparison = compareModuleGraphSnapshot(perturbed, pinnedModuleGraph.moduleGraph);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain('perturbed-language');
    });
  });

  describe('② 真实重建绿路径证明（活性；排除"比较器永远报不一致"式退化）', () => {
    // 与 ① 互补、缺一不可：只证明"能报错"不能排除"永远报错"，只证明"能通过"不能排除"永远通过"。
    // 基础比对用例（a-track / b-track 两个 describe）是本条的主证据，此处做交叉断言收口。
    it('未注入扰动时，a-track 与 b-track 双轨均判一致', () => {
      expect(compareGraphOnlyStructure(rebuiltGraph, pinnedGraphOnly.graph).mismatch).toBe(false);
      expect(
        compareModuleGraphSnapshot(rebuiltModuleGraph, pinnedModuleGraph.moduleGraph).mismatch,
      ).toBe(false);
    });

    it('比较器对自身输入是自反的（同一对象比自己必判一致）', () => {
      expect(compareGraphOnlyStructure(rebuiltGraph, rebuiltGraph).mismatch).toBe(false);
      expect(compareModuleGraphSnapshot(rebuiltModuleGraph, rebuiltModuleGraph).mismatch).toBe(
        false,
      );
    });
  });

  // ③ 拒绝纯函数真值表：见 tests/unit/collector-fingerprint-regen-predicate.test.ts
  //   （`shouldRejectRegen` 2×2 全覆盖 + `selectRegenDiagnostic` 分流），本文件不重复实现。
});

describe('F259 T013 — 验证 #2 pyWalk 是 py→py depends-on/calls 边的唯一生产者（隔离对照，探针 C 永久等价用例）', () => {
  // fix-report 探针 C 的做法是临时改 graph-assembly.ts 源码把 pythonSkeletons 整体剔除。
  // plan.md Complexity Tracking 明确不采用该做法做永久回归（生产源码结构一旦调整测试会静默
  // 失效或需同步改生产代码）。这里改用「合法公开 API 用法」复现同等因果链：直接调用
  // collectTsJsCodeSkeletons + collectGenericLanguageCodeSkeletons（显式不调用
  // collectPythonCodeSkeletons），把结果喂给 buildUnifiedGraph——效果等价于「#2 pyWalk
  // 未运行」，不 monkey-patch 任何生产源码内部结构。
  //
  // 内部对抗复审 C4 澄清：本用例只证明"buildUnifiedGraph 不吃 python skeleton 就产不出这两条
  // 边"——这是 buildUnifiedGraph 与 #11（extractSymbolNodes）两条互不相交调用路径的必然结果，
  // 本身是同义反复，不构成"#2 是这两条边的唯一生产者"的独立证据。真正的风险点是：#11 未来若
  // 被扩展为也产 calls/depends-on（例如为了功能对齐），`buildKnowledgeGraph` 按
  // `source|target|relation` 去重合并两路 edges，届时即便 #2 整条管线被删，边仍会"复活"，
  // 探针 C 与本用例都会失去意义。下方新增的正向不变量钉死用例（钉死 #11 当前只产 contains）
  // 才是真正堵住这个复发路径的护栏——一旦有人给 #11 加上 calls/depends-on 产出能力，改动当下
  // 就会 fail-loud，而不是要等到有人手滑删掉 #2 才被发现。
  it('排除 python codeSkeletons 后，producer/consumer 的 depends-on/calls 边缺失', async () => {
    const staged = stageFixture();
    const tsJsSkeletons = await collectTsJsCodeSkeletons(staged, { extractCallSites: true });
    const genericSkeletons = await collectGenericLanguageCodeSkeletons(staged);
    const codeSkeletons = new Map([...tsJsSkeletons, ...genericSkeletons]);

    const graph = buildUnifiedGraph({ projectRoot: staged, codeSkeletons });

    const hasDependsOn = graph.edges.some(
      (e) =>
        e.source === 'src/py/consumer.py' &&
        e.target === 'src/py/producer.py' &&
        e.relation === 'depends-on',
    );
    const hasCalls = graph.edges.some(
      (e) =>
        e.source === 'src/py/consumer.py::use' &&
        e.target === 'src/py/producer.py::make' &&
        e.relation === 'calls',
    );
    expect(hasDependsOn).toBe(false);
    expect(hasCalls).toBe(false);
    // 佐证：py 相关节点也完全不存在（codeSkeletons 里根本没有 python 文件），
    // 与探针 C「节点仍存在（由 #11 单独产出），边面为空」的现象在本用例的收窄输入下
    // 进一步简化为「节点边皆无」——因为本用例连 #11 的输出也未合并，只验证 #2 这一路的
    // 独占贡献，不依赖 #11 是否参与。
    const pyNodeIds = graph.nodes.filter((n) => n.id.startsWith('src/py/'));
    expect(pyNodeIds).toEqual([]);
  });

  // F259 内部对抗复审 C4 —— 正向不变量钉死：#11 pythonSymbolScan（extractSymbolNodes）当前
  // 结构上只读 skeleton.exports 派生 module→component 的 contains 边，从不读取
  // imports/callSites。这是「#2 独占贡献 depends-on/calls」这一事实成立的**前提**，但此前
  // 全仓无测试把这条前提钉死——一旦未来有人给 #11 加上 depends-on/calls 产出能力，
  // `buildKnowledgeGraph` 按 `source|target|relation` 去重合并两路 edges，即便整条 #2 管线
  // 被误删，边仍会由 #11 补上，掩码原样复发，且上面的探针/隔离对照两个用例都感知不到这一幕。
  it('#11 extractSymbolNodes 当前只产 contains 边（钉死前提，防止未来给 #11 加边后掩码复发）', async () => {
    const staged = stageFixture();
    const results = await new PythonLanguageAdapter().extractSymbolNodes(staged);
    const relations = new Set(results.flatMap((r) => r.edges.map((e) => e.relation)));
    expect(relations).toEqual(new Set(['contains']));
  });
});
