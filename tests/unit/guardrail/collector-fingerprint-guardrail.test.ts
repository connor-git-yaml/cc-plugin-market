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
      // F279：metadata 签名下沉为**递归 key 路径**后，删掉整棵 lineRange 子树会同时缺失
      // `lineRange` / `lineRange.end` / `lineRange.start` 三条路径（默认字符串序：`lineRange`
      // 是另两条的前缀故排最前，`end` < `start`）。这里如实更新为三路径完整文案，而不是把诊断
      // 剪枝成"只报最浅路径"——剪枝会在展示层引入一个"依赖判定层完整集合却选择性隐藏"的新
      // 耦合点，与本文件"诊断正确性不依赖签名格式"的既有哲学方向相反。
      expect(joined).toContain(
        `metadata key 集合不一致（重建缺失 [lineRange, lineRange.end, lineRange.start] vs 重建新增 []）: ${String(victim?.id)}`,
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
     * A1/A2（F278 返工）共用构造器：对**同一个 node id** 的两侧分别注入不同的节点形态。
     * F279 起 mutator 拿到的是**整个节点对象**，故 kind / label / metadata 三个 facet 都可注入。
     *
     * 为什么两侧都要动、且必须锁同一个 id：第三维度只对"两侧该 id 的节点数相等"的 id 求值，
     * 两侧各取 `nodes[0]`（顺序不保证一致）会退化成"改了两个不同节点"，测到的就成了第一维度
     * 而不是缺席态分档。
     *
     * 为什么必须直接把两种缺席态对上，而不是各自与"正常 4-key 节点"对比：既有 M3 用例的对照侧
     * （`pinnedGraphOnly.graph` 的同 id 节点）恒有 4 个 key，因此它对"`{}` 或 `null` 被折叠进
     * `<absent>`"这类**档位塌缩**变异完全无鉴别力——塌缩后两侧仍不等，用例照样绿。
     */
    function injectNodeShapeOnSharedNode(
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
      const { rebuilt, pinned, id } = injectNodeShapeOnSharedNode(
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
      const { rebuilt, pinned, id } = injectNodeShapeOnSharedNode(
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

    it('a-track：同一 node id 两侧各 2 次、key-set multiset 不同 → 报节点形态签名计数不一致（重复 id 分支，US2 AS-2）', () => {
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
      // 断到含计数与签名的完整文案：只断"报了不一致"分不清是重复 id 分支报的、还是别的分支。
      // F279：multiset 计数 key 由 metadata 单签名换成 kind/label/metadata 三 facet 的**复合**
      // 签名（`JSON.stringify([kindSignature, labelSignature, metadataSignature])`），故文案里的
      // `@` 部分从 `["A","B"]` 变成三元组，前缀也从 `metadata key` 变成 `节点形态`——本用例仍只
      // 变异 metadata（kind/label 两侧同值），复合化不削弱它对 metadata 维度的鉴别力。
      expect(joined).toContain(
        `节点形态签名计数不一致（重建 2 vs pinned 1）: ${id} @ ["\\"module\\"","\\"main.go\\"","[\\"A\\",\\"B\\"]"]`,
      );
      expect(joined).toContain(
        `节点形态签名计数不一致（重建 0 vs pinned 1）: ${id} @ ["\\"module\\"","\\"main.go\\"","[\\"A\\"]"]`,
      );
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

    // ────────────────────────────────────────────────────────────────────
    // F279 US1：node.kind / node.label 维度（此前结构性零检测力，事实清单 §2 盲区 1；
    // §3 记录了它在 F250 已经导致过一次真实误读——改了 label 却把 contentMismatch=false
    // 当作"节点结构零变化"的独立佐证引用）。
    // ────────────────────────────────────────────────────────────────────

    it('a-track：仅变异首个节点的 kind → 报不一致（F279 US1，盲区 1）', () => {
      const perturbed = deepClone(rebuiltGraph);
      const victim = perturbed.nodes[0];
      expect(victim).toBeDefined();
      // 活性前提兼精确文案的取值依据：首个节点当前是 module。写死而非用变量拼，是为了让
      // 下面那条断言在"实现把新旧值算反"时也会红——用变量拼会跟着实现一起反过来。
      expect(victim?.kind).toBe('module');
      // 换成另一个**合法**枚举值：变异必须落在"合法但不同"上，否则测到的是"值非法"
      // 而不是"这个字段根本没进比较"
      if (victim) victim.kind = 'component';

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      const joined = comparison.differences.join('\n');
      // 活性前提：只动 kind ⇒ 节点 id / 边 / metadata 三个既有维度全程判绿，
      // 报红只可能来自新维度
      expect(joined).not.toContain('节点仅存在于');
      expect(comparison.mismatch).toBe(true);
      // FR-003：必须定位到节点 id + 字段名 + 新旧值。断到含格子的完整子串——
      // `toContain('kind')` 对"新旧值算反"完全无感，而"是重建变了还是 pinned 变了"
      // 就是这条诊断的全部信息量
      expect(joined).toContain(
        `节点 kind 不一致（重建 "component" vs pinned "module"）: ${String(victim?.id)}`,
      );
    });

    it('a-track：仅变异首个节点的 label → 报不一致（F279 US1，盲区 1）', () => {
      const perturbed = deepClone(rebuiltGraph);
      const victim = perturbed.nodes[0];
      expect(victim).toBeDefined();
      expect(victim?.label).toBe('main.go');
      if (victim) victim.label = 'main.go__RENAMED';

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      const joined = comparison.differences.join('\n');
      expect(joined).not.toContain('节点仅存在于');
      expect(comparison.mismatch).toBe(true);
      // F250 的真实误读形态就是 `label mod.pyi→mod`：这条诊断必须能把"哪个节点、哪个字段、
      // 从什么变成什么"一次说清
      expect(joined).toContain(
        `节点 label 不一致（重建 "main.go__RENAMED" vs pinned "main.go"）: ${String(victim?.id)}`,
      );
    });

    it('a-track：首个节点 kind 整字段缺席（undefined）→ 报不一致（F279 US1 缺席档）', () => {
      const perturbed = deepClone(rebuiltGraph);
      const victim = perturbed.nodes[0];
      expect(victim).toBeDefined();
      // 类型上 kind 必填，但两侧实参一侧来自磁盘 pinned JSON、一侧来自重建产物反序列化，
      // 历史资产完全可能整字段缺席——这正是本用例要钉死的退化态
      if (victim) delete (victim as { kind?: unknown }).kind;

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain(
        `节点 kind 不一致（重建 <absent> vs pinned "module"）: ${String(victim?.id)}`,
      );
    });

    it('a-track：首个节点 label 整字段缺席（undefined）→ 报不一致（F279 US1 缺席档）', () => {
      const perturbed = deepClone(rebuiltGraph);
      const victim = perturbed.nodes[0];
      expect(victim).toBeDefined();
      if (victim) delete (victim as { label?: unknown }).label;

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain(
        `节点 label 不一致（重建 <absent> vs pinned "main.go"）: ${String(victim?.id)}`,
      );
    });

    // 空字符串对照：`<absent>` 与 `""` MUST NOT 塌缩成同一档（spec Edge Case
    // "缺失与存在但为空字符串视为不同状态"）。必须把两种缺席态**直接对上**，
    // 而不是各自与正常值比——各自与正常值比时，即使两档塌缩了用例照样绿。
    it('a-track：一侧 kind 缺席、另一侧 kind="" → 报不一致（两档 MUST NOT 塌缩）', () => {
      const { rebuilt, pinned, id } = injectNodeShapeOnSharedNode(
        (node) => {
          delete node.kind;
        },
        (node) => {
          node.kind = '';
        },
      );

      const comparison = compareGraphOnlyStructure(rebuilt, pinned);
      expect(comparison.mismatch).toBe(true);
      // 两个档位必须同时出现在同一行上：只断"报了不一致"分不清"两档被正确分档"与
      // "两档塌缩成同一档但恰好与对侧不等"
      expect(comparison.differences.join('\n')).toContain(
        `节点 kind 不一致（重建 <absent> vs pinned ""）: ${id}`,
      );
    });

    it('a-track：一侧 label 缺席、另一侧 label="" → 报不一致（两档 MUST NOT 塌缩）', () => {
      const { rebuilt, pinned, id } = injectNodeShapeOnSharedNode(
        (node) => {
          delete node.label;
        },
        (node) => {
          node.label = '';
        },
      );

      const comparison = compareGraphOnlyStructure(rebuilt, pinned);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain(
        `节点 label 不一致（重建 <absent> vs pinned ""）: ${id}`,
      );
    });

    /**
     * F279 T009 共用构造器：让**同一个 node id** 在两侧各出现 2 次，两侧的 metadata 与 label
     * 逐字相同、**只有 kind 不同**，用于覆盖重复 id 的 multiset 分支在复合签名下的检测力。
     *
     * 为什么 metadata / label 要显式钉成同一个字面量而不是沿用模板自带的值：本用例要证明的是
     * "kind 差异能被 multiset 分支捕获"，若 metadata 恰好也不同，用例即使在只比 metadata 的
     * 旧实现下也会绿，测到的就不是 kind 维度。
     *
     * 为什么两侧份数必须相等：第三维度只对"两侧该 id 节点数相等"的 id 求值，只复制一侧会被
     * 第一维度（节点 id multiset）抢先报 `节点计数不一致`，第三维度直接跳过。
     */
    function injectDuplicatedNodeKinds(
      rebuiltKinds: readonly GraphJSON['nodes'][number]['kind'][],
      pinnedKinds: readonly GraphJSON['nodes'][number]['kind'][],
    ): { rebuilt: GraphJSON; pinned: GraphJSON; id: string } {
      const buildSide = (
        source: GraphJSON,
        id: string,
        kinds: readonly GraphJSON['nodes'][number]['kind'][],
      ): GraphJSON => {
        const graph = deepClone(source);
        const template = graph.nodes.find((node) => node.id === id);
        expect(template).toBeDefined();
        const copyWithKind = (kind: GraphJSON['nodes'][number]['kind']): GraphJSON['nodes'][number] => {
          const copy = deepClone(template as GraphJSON['nodes'][number]);
          copy.kind = kind;
          copy.label = 'shared-label';
          copy.metadata = { shared: 1 };
          return copy;
        };
        graph.nodes = [...graph.nodes.filter((node) => node.id !== id), ...kinds.map(copyWithKind)];
        return graph;
      };
      const id = rebuiltGraph.nodes[0]?.id as string;
      expect(id).toBeTruthy();
      return {
        rebuilt: buildSide(rebuiltGraph, id, rebuiltKinds),
        pinned: buildSide(pinnedGraphOnly.graph, id, pinnedKinds),
        id,
      };
    }

    it('a-track：同一 node id 两侧各 2 次、仅 kind 的 multiset 不同 → 报不一致（F279 重复 id 复合签名）', () => {
      const { rebuilt, pinned } = injectDuplicatedNodeKinds(
        ['module', 'module'],
        ['module', 'component'],
      );

      const comparison = compareGraphOnlyStructure(rebuilt, pinned);
      const joined = comparison.differences.join('\n');
      // 活性前提：两侧该 id 都是 2 个节点 ⇒ 第一维度不会报，报红只可能来自第三维度
      expect(joined).not.toContain('节点计数不一致');
      expect(comparison.mismatch).toBe(true);
    });

    // ────────────────────────────────────────────────────────────────────
    // F279 US2：metadata **嵌套** key 维度（顶层 key 集合不变时此前零检测力，
    // 事实清单 §2 盲区 2）。与 F271 的 lineRange 事件同构、只是下沉一层。
    // ────────────────────────────────────────────────────────────────────

    it('a-track：某节点 metadata.lineRange 内层由 {start,end} 改名为 {from,to} → 报不一致（F279 US2）', () => {
      const perturbed = deepClone(rebuiltGraph);
      const victim = perturbed.nodes.find((node) => node.metadata?.lineRange !== undefined);
      expect(victim).toBeDefined();
      const lineRange = victim?.metadata.lineRange as { start: number; end: number };
      // 活性前提：内层确实是 {start,end}，且**顶层 key 集合一字不变**——本用例要测的正是
      // "顶层看不出差异"这一档，顶层若也变了就退化成 F278 已覆盖的维度
      expect(Object.keys(lineRange).sort()).toEqual(['end', 'start']);
      if (victim) victim.metadata.lineRange = { from: lineRange.start, to: lineRange.end };

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      // FR-005：必须定位到节点 id + 具体**递归路径**，而不是只报"metadata 不一致"。
      // 断到含格子的完整子串：missing/extra 两侧算反时 `toContain('lineRange.start')` 照样绿，
      // 而"是重建丢了内层字段还是重建多了内层字段"就是这条诊断的全部信息量。
      // 注意 `lineRange` 这条路径本身两侧都在（只是内层变了），故它 MUST NOT 出现在缺失侧。
      expect(comparison.differences.join('\n')).toContain(
        `metadata key 集合不一致（重建缺失 [lineRange.end, lineRange.start] vs 重建新增 [lineRange.from, lineRange.to]）: ${String(victim?.id)}`,
      );
    });

    it('a-track：某节点 metadata.lineRange 内层删掉 end 子 key → 报不一致（F279 US2）', () => {
      const perturbed = deepClone(rebuiltGraph);
      const victim = perturbed.nodes.find((node) => node.metadata?.lineRange !== undefined);
      expect(victim).toBeDefined();
      const lineRange = victim?.metadata.lineRange as Record<string, unknown>;
      expect(lineRange.end).toBeDefined();
      delete lineRange.end;

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      const joined = comparison.differences.join('\n');
      expect(joined).toContain(
        `metadata key 集合不一致（重建缺失 [lineRange.end] vs 重建新增 []）: ${String(victim?.id)}`,
      );
      // "只报真正变化的路径"负控：`lineRange` 与 `lineRange.start` 两条路径一字未动，
      // 递归实现若把整棵子树都算成缺失（或把祖先路径连坐），这两条断言会红
      expect(joined).not.toContain('lineRange.start');
      expect(joined).not.toContain('[lineRange,');
    });

    /**
     * F279 edge case (b)：**空嵌套对象**不得与"该 key 根本不存在"碰撞。
     *
     * 为什么两侧都包一层 `x`：直接用 `{lineRange:{}}` vs `{}`（plan 原文给的形态）在
     * F279 之前的**顶层 key** 实现下就已经可分辨（`['lineRange']` vs `[]`），拿它做红先行
     * 探针会直接绿——那不是"盲区被证明"，而是探针没打到目标维度。包一层之后两侧顶层 key
     * 集合都是 `['x']`，旧实现必然碰撞，探针才真的红。
     *
     * 这条同时钉死递归规则里"**先记录 key 自身路径、再判断是否递归**"这一步：若实现只记叶子，
     * 左侧（`x.lineRange` 是空对象、无叶子）与右侧都会产出 0 条路径，碰撞复发。
     */
    it('a-track：{x:{lineRange:{}}} vs {x:{}} → 报不一致（空嵌套对象 MUST NOT 与 key 缺席碰撞）', () => {
      const { rebuilt, pinned } = injectNodeShapeOnSharedNode(
        (node) => {
          node.metadata = { x: { lineRange: {} } };
        },
        (node) => {
          node.metadata = { x: {} };
        },
      );

      const comparison = compareGraphOnlyStructure(rebuilt, pinned);
      expect(comparison.mismatch).toBe(true);
    });

    /**
     * F279 对抗审查 WARNING-6：**根层与嵌套层的"可展开性"判据必须同源**。
     *
     * 根层若只判 `typeof raw !== 'object'`（数组也是 object），数组会被 `Object.keys` 当成
     * plain object 展开出下标 key；而每个嵌套层都由 `isRecursableMetadataValue` 正确排除数组。
     * 同一份数据两套规则 ⇒ `metadata: []` 与 `metadata: {}` 静默判一致。
     *
     * 下面第二条（数组 vs 同形对象）是更强的形态：不修根层判据时两侧路径集合都是 `['0','1']`。
     */
    it('a-track：metadata:[] vs metadata:{} → 报不一致（根层数组 MUST 与空对象分档）', () => {
      const { rebuilt, pinned } = injectNodeShapeOnSharedNode(
        (node) => {
          (node as unknown as Record<string, unknown>).metadata = [];
        },
        (node) => {
          node.metadata = {};
        },
      );

      const comparison = compareGraphOnlyStructure(rebuilt, pinned);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain('<non-object:array>');
    });

    it('a-track：metadata:["x","y"] vs metadata:{"0":..,"1":..} → 报不一致（根层数组不得被展开成下标 key）', () => {
      const { rebuilt, pinned } = injectNodeShapeOnSharedNode(
        (node) => {
          (node as unknown as Record<string, unknown>).metadata = ['x', 'y'];
        },
        (node) => {
          node.metadata = { 0: 'x', 1: 'y' };
        },
      );

      const comparison = compareGraphOnlyStructure(rebuilt, pinned);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain('<non-object:array>');
    });

    /**
     * F279 edge case (c)：路径分隔符歧义。key 名里的字面 `.` 必须与"路径分隔用的 `.`"可区分。
     *
     * 构造要点（两侧路径数量必须配平，否则测到的是"少了一条路径"而不是"两条路径撞了"）：
     *   左 `{x:{'a.b':1, a:{}}}` → 未转义时路径集合 {x, x.a, x.a.b}
     *   右 `{x:{a:{b:1}}}`      → 未转义时路径集合 {x, x.a, x.a.b}   ← 完全相同，碰撞
     * 转义之后左侧是 `x.a\.b`、右侧是 `x.a.b`，两者可分辨。
     * 同样包一层 `x` 是为了让旧的顶层 key 实现（两侧都是 `['x']`）真的红。
     */
    it('a-track：{x:{"a.b":1,a:{}}} vs {x:{a:{b:1}}} → 报不一致（key 名含字面 . 不得与路径分隔符碰撞）', () => {
      const { rebuilt, pinned } = injectNodeShapeOnSharedNode(
        (node) => {
          node.metadata = { x: { 'a.b': 1, a: {} } };
        },
        (node) => {
          node.metadata = { x: { a: { b: 1 } } };
        },
      );

      const comparison = compareGraphOnlyStructure(rebuilt, pinned);
      expect(comparison.mismatch).toBe(true);
    });

    // ────────────────────────────────────────────────────────────────────
    // F279 US3：graph.graph 元数据 + 顶层 directed/multigraph（此前零检测力，
    // 事实清单 §2 盲区 3 六项实测全 diffs=0）。`compareGraphDeep` 的文件头注释早已逐字
    // 点名过这一族："这恰恰是 pinned 资产陈旧的核心信号"。
    // ────────────────────────────────────────────────────────────────────

    it('a-track：graph.graph.nodeCount 被篡改 → 报不一致（F279 US3，盲区 3）', () => {
      const perturbed = deepClone(rebuiltGraph);
      // 活性前提：pinned 基线是 22 节点（事实清单 §6）。写死而非用变量拼，理由同 kind 用例
      expect(perturbed.graph.nodeCount).toBe(22);
      perturbed.graph.nodeCount = 999;

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      // FR-008：必须定位到字段名 + 新旧值。断到含格子的完整子串——只断"报了不一致"
      // 分不清是这个字段报的还是别的字段报的，也分不清新旧值有没有算反
      expect(comparison.differences.join('\n')).toContain(
        'graph.graph.nodeCount 不一致（重建 999 vs pinned 22）',
      );
    });

    it('a-track：graph.graph.schemaVersion 被降级 → 报不一致（F279 US3，盲区 3）', () => {
      const perturbed = deepClone(rebuiltGraph);
      expect(perturbed.graph.schemaVersion).toBe('2.0');
      perturbed.graph.schemaVersion = '1.0';

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain(
        'graph.graph.schemaVersion 不一致（重建 "1.0" vs pinned "2.0"）',
      );
    });

    it('a-track：graph.graph.sources 被清空 → 报不一致（F279 US3，盲区 3）', () => {
      const perturbed = deepClone(rebuiltGraph);
      expect(perturbed.graph.sources).toEqual(['extraction', 'unified-graph']);
      perturbed.graph.sources = [];

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain(
        'graph.graph.sources 不一致（重建 [] vs pinned ["extraction","unified-graph"]）',
      );
    });

    it('a-track：顶层 directed 被翻转 → 报不一致（F279 US3，GraphJSON 顶层字段）', () => {
      const perturbed = deepClone(rebuiltGraph);
      expect(perturbed.directed).toBe(false);
      perturbed.directed = true;

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      // 文案不带 `graph.graph.` 前缀：directed 是 GraphJSON 顶层字段，加前缀等于说假话
      expect(comparison.differences.join('\n')).toContain(
        'directed 不一致（重建 true vs pinned false）',
      );
    });

    it('a-track：顶层 multigraph 被翻转 → 报不一致（F279 US3，GraphJSON 顶层字段）', () => {
      const perturbed = deepClone(rebuiltGraph);
      expect(perturbed.multigraph).toBe(false);
      // 类型上 multigraph 是字面量 false，但磁盘资产完全可能写着 true——这正是要钉死的退化态
      (perturbed as unknown as { multigraph: boolean }).multigraph = true;

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain(
        'multigraph 不一致（重建 true vs pinned false）',
      );
    });

    /**
     * F279 US3 负控（FR-009 / SC-004）：`graph.graph.builder` 是 denylist 里**唯一**一条。
     *
     * builder 跟踪宿主仓库 / dist 构建戳（commit / dirty / distSha256），跨机器跨 commit 必然
     * 不同，与"这份 pinned 是否代表当前采集**行为**"无关——即 F261 D1「builder 戳只可见不判定」。
     * 把它纳入比较会让 fixture 在别人机器上永久红，且红因与被护栏保护的采集面毫无关系。
     * 与 `tests/integration/graph-quality-pinned-staleness.test.ts:154` 的排除表逐字同一条。
     *
     * 这条是"必须保持 GREEN"的负控，不是红先行用例：它防的是 denylist 迭代逻辑意外漏掉 builder。
     */
    it('a-track：只改 graph.graph.builder → 判一致（F279 US3 负控，0 例误报）', () => {
      const perturbed = deepClone(rebuiltGraph);
      // 活性前提：再生路径走 tsx 直跑 src/，builder-stamp 定位不到 .spectra-build-meta.json
      // ⇒ 诚实降级 null（事实清单 §4.1）。这里注入一个"真实戳"形态来模拟跨机器场景
      expect(perturbed.graph.builder).toBeNull();
      (perturbed.graph as unknown as Record<string, unknown>).builder = {
        formatVersion: 1,
        commit: '68b5929cb16e4a1b2c3d4e5f60718293a4b5c6d7',
        dirty: false,
        sourceDirty: false,
        distSha256: '40ba0fdb'.repeat(8),
      };

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.differences).toEqual([]);
      expect(comparison.mismatch).toBe(false);
    });

    /**
     * F279 US3：`graph.graph.fingerprint` **纳入比较**（曾被排除，经异构对抗审查证伪后撤回）。
     *
     * 当时的排除理由是"它已有一条独立通道 `runRegen` 的 `fingerprintUnchanged`"。该理由不成立：
     * `fingerprintUnchanged = fingerprintsEqual(pinned.fingerprint, computeCollectorFingerprint())`
     * 比的是 **pinned 记录值** vs **现算值**，两个操作数都不是重建产物；而本比较器比的是
     * **重建产物** vs **pinned**。两者是不同的事实，不是同一事实的双重计数。
     *
     * 排除它的实际后果（对抗审查实证）：`rebuilt.graph.graph.fingerprint`——即将被写进 pinned
     * 资产的那个戳——在脚本、比较器、护栏单测三处**无人读**（上方 `:139-144` 对重建侧只查
     * "结构合法 + behaviorVersion 相等"，唯一的等值断言 `:153` 用的是 pinned 侧）。写盘链路
     * 若把坏戳烤进资产，此后 `fingerprintUnchanged` 恒 false ⇒ `shouldRejectRegen` 恒 false
     * ⇒ 整条护栏的拒绝语义永久失效。
     *
     * "裸值比较与 canonical 比较会分歧"的顾虑同样不成立：`toSurfaceEntry`
     * （`src/panoramic/graph/collector-fingerprint.ts:175-180`）对 extensions 做 `[...].sort()`，
     * 注释明写是为跨环境 byte-identical，两侧同源同序。
     */
    it('a-track：只改 graph.graph.fingerprint → 报不一致（重建侧 stamp 此前无人比较）', () => {
      const perturbed = deepClone(rebuiltGraph);
      const fingerprint = perturbed.graph.fingerprint as { behaviorVersion: number };
      expect(fingerprint.behaviorVersion).toBe(BEHAVIOR_VERSION);
      fingerprint.behaviorVersion = BEHAVIOR_VERSION - 1;

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain('graph.graph.fingerprint 不一致');
    });

    /**
     * 上一条的**同族补强**：重建侧 stamp 的 `extensionSurface` 被换成另一套采集面
     * （`behaviorVersion` 不动）——这正是对抗审查用来证伪"已有专用通道"的那个反例形态，
     * 单测既有的三条 fingerprint 断言（`:141-153`）对它全部照过。
     */
    it('a-track：重建侧 stamp 的 extensionSurface 被削（behaviorVersion 不动）→ 报不一致', () => {
      const perturbed = deepClone(rebuiltGraph);
      const fingerprint = perturbed.graph.fingerprint as unknown as {
        behaviorVersion: number;
        extensionSurface: { tsjsSkeletonWalk: { extensions: string[] } };
      };
      expect(fingerprint.extensionSurface.tsjsSkeletonWalk.extensions.length).toBeGreaterThan(1);
      fingerprint.extensionSurface.tsjsSkeletonWalk.extensions = ['.ts'];
      // 该形态确实骗得过既有三条断言：behaviorVersion 一字未动
      expect(fingerprint.behaviorVersion).toBe(BEHAVIOR_VERSION);

      const comparison = compareGraphOnlyStructure(perturbed, pinnedGraphOnly.graph);
      expect(comparison.mismatch).toBe(true);
      expect(comparison.differences.join('\n')).toContain('graph.graph.fingerprint 不一致');
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
