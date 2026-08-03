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
import {
  BEHAVIOR_VERSION,
  computeCollectorFingerprint,
  fingerprintsEqual,
  isValidCollectorFingerprint,
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
  it('节点 id multiset + 边 multiset 与 pinned 严格相等', () => {
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
    // pinned 记录的指纹与当前代码状态语义相等——不等就说明 pinned 过期，护栏本身失去参照
    expect(
      fingerprintsEqual(pinnedFingerprint as never, computeCollectorFingerprint()),
    ).toBe(true);
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
