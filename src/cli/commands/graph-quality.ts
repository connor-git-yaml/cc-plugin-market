/**
 * F217 T034 — graph-quality 子命令 handler。
 *
 * 读取 specs/_meta/graph.json → 组装五项结构指标（quality-engine）+ freshness
 * （source-commit）→ 输出完整体检报告（text / --json / --status）→ exit code。
 *
 * CLI 层职责（plan §2 决策 2）：读文件 / 读 git / 组装完整 GraphQualityReport /
 * 格式化输出 / exit code。六指标判定函数与 freshness 判定函数本身零 I/O，
 * 由本文件统一构造回调并注入。
 *
 * git 上下文语义（plan §2 决策 3）：默认 projectRoot = process.cwd()；显式 --graph
 * 时不反推路径，仍以 process.cwd() 作为 git 上下文（--help 与命令输出均声明）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CLICommand } from '../utils/parse-args.js';
import type { GraphJSON } from '../../panoramic/graph/graph-types.js';
import { runGraphQualityChecks } from '../../panoramic/graph/quality/quality-engine.js';
import { createIgnoreOracle } from '../../panoramic/graph/quality/ignore-oracle.js';
import type { UndeterminableSummary } from '../../utils/gitignore-oracle.js';
import { evaluateFreshness } from '../../panoramic/graph/source-commit.js';
import {
  getBuilderStamp,
  parseGraphBuilderStamp,
  type GraphBuilderStamp,
} from '../../panoramic/graph/builder-stamp.js';
import { LanguageAdapterRegistry } from '../../adapters/language-adapter-registry.js';
import type {
  FreshnessStaleReason,
  GraphQualityReport,
  GraphFreshnessVerdict,
  OrphanExceptionCategory,
} from '../../panoramic/graph/quality/quality-types.js';
import type { OrphanCheckTestPatterns } from '../../panoramic/graph/quality/orphan-check.js';

/**
 * 图产物当前唯一支持的 schemaVersion（决策 5：sourceCommit 纯可选新增，不 bump schemaVersion）。
 * FIX-7（Codex 对抗审查）：本值同时充当"最低支持版本"与"最高支持版本"的双重边界——
 * 本命令当前只理解 schemaVersion=2.0 的图产物；低于该值判定为 schema-too-old（旧版本
 * 建图需重建），高于该值判定为 schema-newer-than-supported（图由更新版本 spectra 生成，
 * 需升级本工具而非误判为陈旧/损坏）。
 */
const MIN_SUPPORTED_SCHEMA_VERSION = '2.0';

const GRAPH_QUALITY_HELP = `spectra graph-quality — 图质量体检（六指标 + freshness，F217）

用法:
  spectra graph-quality [--graph <path>] [--json] [--output <path>] [--format json|text]
  spectra graph-quality --status [--json]

说明:
  读取 graph.json，机器判定六项质量指标：
  - duplicate-canonical-id: 语义重复 canonical ID（强不变量）
  - contains-coverage:      symbol 节点 contains 覆盖率
  - orphan-ratio:           source symbol orphan 比例
  - dangling-edge:          悬空边（强不变量）
  - legacy-ignored:         遗留 # 节点 / ignored 路径节点
  - freshness:              双维一致性（fresh/dirty/stale/unknown-provenance）：
                            ① graph.sourceCommit 与当前 HEAD 是否一致
                            ② graph.fingerprint（collector fingerprint）与当前采集器实现是否一致
                            任一不一致即 stale，具体原因见 staleReasons（source-commit /
                            collector-fingerprint / -unrecorded / -invalid）

  git 上下文固定为运行本命令时的 process.cwd()（即使显式 --graph 指向其他路径的
  graph.json，也不反推其所属仓库根，避免多 worktree/嵌套仓库场景误判）。

选项:
  --graph <path>   graph.json 路径（默认: specs/_meta/graph.json）
  --json           以结构化 JSON 输出完整报告（供脚本/CI 解析）
  --status         轻量模式：仅输出 graphExists / freshness / overallVerdict 三字段
  --output <path>  报告写入路径（默认: 仅 stdout）
  --format json|text  写入 --output 文件时的格式（默认 text）
  --help           显示帮助信息

退出码:
  0  完成完整评估，且无强不变量违反（overallVerdict 为 pass 或 pass-with-warnings）
  1  强不变量违反（overallVerdict 为 fail-strong-invariant：重复 canonical ID / 悬空边）
  2  无法完成评估（overallVerdict 为 cannot-assess：图产物不存在 / JSON 解析失败或结构损坏 /
     schemaVersion 过旧或过新 / 图为空（0 节点 0 边））`;

/** --status 轻量模式的三字段裁剪结果（决策 7）。 */
interface GraphQualityStatusReport {
  graphExists: boolean;
  freshness: GraphFreshnessVerdict['state'];
  overallVerdict: GraphQualityReport['overallVerdict'];
}

/**
 * 结构深度校验：JSON.parse 成功后仍需确认顶层字段形态与逐 node/edge 形态，否则视为
 * 结构损坏（FR-014 cannot-assess）——FIX-1（Codex CRITICAL）：此前只查 nodes/links
 * 是否为数组、schemaVersion 是否为 string，未校验顶层 directed/multigraph/graph 是否
 * 存在、也未逐条校验 node.id / edge.source / edge.target 是否为非空 string，导致：
 * ① 顶层缺 directed/multigraph 的畸形输入被误判为合法结构（错误地 pass）；
 * ② edge 缺 source/target（如 `{}`）被放行进引擎，dangling-edge-check 把
 *    `undefined` 当悬空边处理，误判为强不变量违反（exit 1），而非"结构损坏、
 *    根本无法评估"（exit 2）。
 *
 * 导出供 tests/unit 直接测（不经 CLI 子进程）。
 */
export function validateGraphJsonShape(value: unknown): value is GraphJSON {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate['directed'] !== 'boolean') return false;
  if (typeof candidate['multigraph'] !== 'boolean') return false;

  const graphMeta = candidate['graph'];
  if (graphMeta === null || typeof graphMeta !== 'object') return false;
  const schemaVersion = (graphMeta as Record<string, unknown>)['schemaVersion'];
  if (typeof schemaVersion !== 'string') return false;

  const nodes = candidate['nodes'];
  if (!Array.isArray(nodes)) return false;
  for (const node of nodes) {
    if (node === null || typeof node !== 'object') return false;
    const id = (node as Record<string, unknown>)['id'];
    if (typeof id !== 'string' || id.length === 0) return false;
  }

  const links = candidate['links'];
  if (!Array.isArray(links)) return false;
  for (const link of links) {
    if (link === null || typeof link !== 'object') return false;
    const source = (link as Record<string, unknown>)['source'];
    const target = (link as Record<string, unknown>)['target'];
    if (typeof source !== 'string' || source.length === 0) return false;
    if (typeof target !== 'string' || target.length === 0) return false;
    const relation = (link as Record<string, unknown>)['relation'];
    if (relation !== undefined && typeof relation !== 'string') return false;
  }

  return true;
}

/** 解析结果：major.minor 数值形式（FIX-7：schemaVersion 数值比较，而非字符串相等）。 */
interface ParsedSchemaVersion {
  major: number;
  minor: number;
}

/** 解析形如 "2.0" / "3.1" 的 schemaVersion 字符串；格式不合法（非 `\d+\.\d+`）返回 null。 */
function parseSchemaVersion(raw: string): ParsedSchemaVersion | null {
  const match = /^(\d+)\.(\d+)$/.exec(raw);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/** 比较两个已解析的 schemaVersion：负数=a<b，0=相等，正数=a>b。 */
function compareSchemaVersion(a: ParsedSchemaVersion, b: ParsedSchemaVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  return a.minor - b.minor;
}

/**
 * cannot-assess 场景下的占位六指标（未实际执行判定，語义为"无违规可报告"的空态，见 T034 实现说明）。
 *
 * @param freshness 读到了**合法图产物**的 cannot-assess 分支（当前只剩 empty-graph——
 *   `no-symbol-nodes` 在 delta 审查 D1 后改走 `downgradeForNoSymbolNodes` 的后置降级，
 *   它保留 `buildReport` 的完整报告体，根本不经过本函数）
 *   MUST 传入按该图真实算出的 freshness：那两条路上 `graph.sourceCommit` 磁盘上确有其值，
 *   硬写 `unknown-provenance / recordedSourceCommit: null` 是拿"没读"冒充"读了没有"，
 *   下游（sync-worktree-local-state 等）会据此死循环建议"provenance 不明，请重建"。
 *   真正无图可读的分支（graph-missing / json-parse-error / schema-*）不传——那里的 null 是真值。
 */
function buildCannotAssessReport(
  graphPath: string,
  reason: NonNullable<GraphQualityReport['cannotAssessReason']>,
  nextSteps: string[],
  freshness?: GraphFreshnessVerdict,
): GraphQualityReport {
  const exemptedByCategory: Record<OrphanExceptionCategory, number> = {
    entrypoint: 0,
    'pure-type': 0,
    'test-export': 0,
  };
  return {
    graphPath,
    generatedAt: new Date().toISOString(),
    schemaVersion: 'unknown',
    duplicateCanonicalId: { status: 'pass', groups: [] },
    containsCoverage: { status: 'not-applicable', total: 0, covered: 0, ratio: null, uncoveredIds: [] },
    orphanRatio: {
      status: 'not-applicable',
      totalSymbolNodes: 0,
      rawOrphanCount: 0,
      exemptedByCategory,
      offendingRatio: null,
      offendingIds: [],
      allNodeZeroDegreeRatio: 0,
    },
    danglingEdges: { status: 'pass', edges: [] },
    legacyAndIgnoredNodes: { status: 'pass', legacyHashNodeIds: [], ignoredPathNodeIds: [] },
    freshness: freshness ?? { state: 'unknown-provenance', recordedSourceCommit: null, currentHead: null },
    overallVerdict: 'cannot-assess',
    cannotAssessReason: reason,
    nextSteps,
  };
}

/**
 * F266 FR-006：空图判据——节点与边**同时**为空。
 *
 * 为什么必须在 `buildReport` 之前拦掉：六项指标对空图的每一项都会走进"分母为 0 ⇒
 * not-applicable"或"没有违规样本 ⇒ pass"的空态，聚合出来就是 `overallVerdict: 'pass'`。
 * 也就是说，建图彻底失败（零节点）反而比建出一张有瑕疵的图更容易过门——判定器对
 * "根本没建出图"这件事说了假话。
 *
 * 为什么是 `&&` 而不是 `||`：`nodes` 非空但 `links` 为空是"全孤岛图"。**注意**：原注释称
 * 这种图"已经能被 orphan-ratio / contains-coverage 判为 fail/warning"——该说法只在图里
 * **有 symbol 级节点**时成立（那两项指标的分母都是 `unifiedKind === 'symbol'` 的节点数）。
 * 一张只有 module 节点的退化图分母为 0，两项指标双双 not-applicable，会一路 pass。
 * 那个缺口由 `hasNoSymbolNodes` 单独收口，不靠放宽本判据（放宽会把真正属于
 * warning 级的"有 symbol 的全孤岛图"误升为硬失败）。
 *
 * **为什么本闸可以前置短路、而 `no-symbol-nodes` 不行**（delta 审查 D1）：空图上六指标
 * 是**可证明**无违规的——没有节点就没有重复 canonical ID、没有 ignored 路径节点、没有遗留
 * `#` 节点；没有边就没有悬空边。前置跳过 `buildReport` 因此零信息损失。而"有节点、只是没有
 * symbol 节点"完全不同：duplicate-id / dangling-edge / legacy-ignored 三项检查遍历的是**全部
 * 节点与边**，与 symbol 层在不在场无关，那种图上照样能有真违规（`spectra graph` 读 arch-IR
 * 建出的图不写 `unifiedKind`，却可以同时含 `a.ts::Foo` 与 `a.ts#Foo` 两个 element）。
 * 故 `no-symbol-nodes` MUST 走后置降级（先跑完 `buildReport` 再改判），见 `downgradeForNoSymbolNodes`。
 *
 * 本判据只看结构性计数，不读 builder 戳（裁决 1：builder 戳只可见不判定）。
 */
function isEmptyGraph(graph: GraphJSON): boolean {
  return graph.nodes.length === 0 && graph.links.length === 0;
}

/**
 * F266 对抗审查 A6a：节点非空、但没有任何 symbol 级节点 —— 六项结构指标**部分**失去判定对象。
 *
 * 判据来源必须与指标本身同源：`contains-coverage` 与 `orphan-ratio` 的分母都是
 * `metadata.unifiedKind === 'symbol'` 的节点数（contains-coverage-check.ts / orphan-check.ts），
 * 分母为 0 时它们返回 not-applicable；`freshness` 与 symbol 层无关但也说明不了结构质量。
 * 于是这种"只剩模块骨架、symbol 层整体缺失"的图会聚合出 `pass` —— 门禁说它没问题。
 *
 * **本函数只是"要不要改判"的必要条件，不是充分条件**（delta 审查 D1 推翻了上一版注释）：
 * 上一版这里写着「duplicate-canonical-id / dangling-edges / legacy-ignored 在无 symbol 节点时
 * 也没有违规样本可报」——**该断言为假**。这三项检查遍历的是全部节点与全部边，判据里没有任何
 * 一处读 `unifiedKind`。实证反例：`spectra graph` 从 arch-IR 建出的图不写 `unifiedKind`，却能
 * 同时放进 `src/a.ts::Foo` 与 `src/a.ts#Foo` 两个 element —— 那是货真价实的重复 canonical ID
 * （旧判定面 exit 1 / repo:check FAIL），当时却被前置短路洗成 `duplicateCanonicalId: pass` 的占位值。
 * 因此改判必须**后置**：先跑完 `buildReport` 拿到真实指标，再由 `downgradeForNoSymbolNodes` 决定。
 */
function hasNoSymbolNodes(graph: GraphJSON): boolean {
  return graph.nodes.length > 0 && !graph.nodes.some((n) => n.metadata?.['unifiedKind'] === 'symbol');
}

/** `no-symbol-nodes` 改判时置顶的处方文案（machine-readable 的是 `cannotAssessReason`，本条供人读）。 */
function noSymbolNodesNextStep(nodeCount: number): string {
  return (
    `图中无任何 symbol 级节点（共 ${nodeCount} 个节点，全部为模块/骨架层），` +
    'contains-coverage / orphan-ratio 等依赖 symbol 分母的指标全部失去判定对象，本次体检结论不可采信。' +
    '请运行 `spectra batch --mode graph-only`（纯 AST · 零 LLM · <2min）重建完整图；' +
    '若重建后仍无 symbol 节点，说明源码解析阶段未产出任何符号（如项目使用的语言尚未被 Spectra 支持）。'
  );
}

/**
 * D1：无 symbol 图的**后置**降级 —— 在 `buildReport` 跑完之后改判，而不是在它之前短路。
 *
 * 两条硬规则：
 * 1. `fail-strong-invariant` **原样保留**（exit 1）。重复 canonical ID / 悬空边是全节点、全边
 *    维度的强不变量，与 symbol 层在不在场无关；把它降级成 `cannot-assess` 等于用"我评估不了"
 *    吞掉一条已经评估出来的硬违规，是比原缺陷更糟的 fail-open。
 * 2. 其余情形改判 `cannot-assess`，但**报告体保留 `buildReport` 算出的真实指标**（不再用
 *    `buildCannotAssessReport` 的 pass 占位覆盖）：`legacyAndIgnoredNodes: fail` 这类真发现
 *    必须留在报告里，只是它不足以支撑"这张图体检通过"的结论。
 *
 * 关于第 2 条的一个刻意取舍：**warning 级发现不阻止降级**。一张 symbol 层整体缺失的图，
 * 恰好带一个 `node_modules/` 节点时报 `pass-with-warnings`（exit 0）、不带时报 `cannot-assess`
 * （exit 2），会让门禁的诚实度取决于一个无关的巧合。规则收敛为"无 symbol ⇒ 绝不宣称 pass"，
 * warning 级发现照常保留在报告体与 nextSteps 里，不丢失。
 */
function downgradeForNoSymbolNodes(report: GraphQualityReport, nodeCount: number): GraphQualityReport {
  if (report.overallVerdict === 'fail-strong-invariant') return report;
  return {
    ...report,
    overallVerdict: 'cannot-assess',
    cannotAssessReason: 'no-symbol-nodes',
    // E3：本报告体是 `buildReport` 的真实测量结果，只是**结论**不可采信。消费方（repo:check 的
    // graph-quality-core.mjs）据此继续发射逐维度 check——否则 legacy-ignored 真发现 / freshness
    // stale / F258 的 ignore-undeterminable 诊断会随 cannot-assess 一起整体塌陷。
    metricsPopulated: true,
    // 处方置顶，`buildReport` 的真实 nextSteps（stale 建议 / ignored 路径发现 / oracle 诊断）全部保留
    nextSteps: [noSymbolNodesNextStep(nodeCount), ...report.nextSteps],
  };
}

/**
 * 对一张**已读到的合法图**算真实 freshness（与 `buildReport` 内同一口径，含 recordedSourceCommit 归一化）。
 * 抽出来是为了让 cannot-assess 的"读到图"分支与正常分支共用同一实现，不产生第二套口径。
 */
function evaluateGraphFreshness(graph: GraphJSON, projectRoot: string): GraphFreshnessVerdict {
  const raw = evaluateFreshness(graph.graph.sourceCommit, projectRoot, graph.graph.fingerprint);
  return { ...raw, recordedSourceCommit: raw.recordedSourceCommit ?? null };
}

/** 按节点 sourcePath 查找对应语言的测试文件匹配模式（决策 2 test-export 例外判定）。 */
function getTestPatterns(sourcePath: string): OrphanCheckTestPatterns | null {
  const adapter = LanguageAdapterRegistry.getInstance().getAdapter(sourcePath);
  if (!adapter) return null;
  return adapter.getTestPatterns();
}

/** 综合五项结构指标 verdict 与 freshness state 计算完整 overallVerdict（FR-012 四态）。 */
function computeOverallVerdict(
  structuralVerdict: 'pass' | 'pass-with-warnings' | 'fail-strong-invariant',
  freshnessState: GraphFreshnessVerdict['state'],
): GraphQualityReport['overallVerdict'] {
  if (structuralVerdict === 'fail-strong-invariant') return 'fail-strong-invariant';
  if (structuralVerdict === 'pass-with-warnings' || freshnessState === 'stale') {
    return 'pass-with-warnings';
  }
  return 'pass';
}

/**
 * F249 FR-013：把单条 `staleReasons` 原因渲染为面向维护者的修复建议。
 *
 * 每条文案都显式含原因字面量（如 `collector-fingerprint-unrecorded`），让人读输出与
 * `--json` 的 `staleReasons` 可对照，也让"指纹型问题被渲染成 sourceCommit 诊断"这类
 * 错配在测试中可被字面量断言直接抓住。
 *
 * 严重度措辞（FR-011/SC-006）：四类原因统一使用"请重新运行 …… 重建图"的祈使句式，
 * 指纹型不弱于 sourceCommit 型——三者都是"这张图不可信、必须重建"，没有轻重之分。
 */
function describeStaleReason(
  reason: FreshnessStaleReason,
  freshness: GraphFreshnessVerdict,
): string {
  switch (reason) {
    case 'source-commit':
      return `[source-commit] 图产物记录的 sourceCommit（${freshness.recordedSourceCommit ?? 'null'}）与当前 HEAD（${freshness.currentHead ?? 'null'}）不一致，请重新运行 \`spectra batch --mode graph-only\` 重建图。`;
    case 'collector-fingerprint':
      return '[collector-fingerprint] 图产物记录的 collector fingerprint 与当前采集器实现不一致（采集面或 behaviorVersion 已变更），该图可能遗漏/多计文件，请重新运行 `spectra batch --mode graph-only` 重建图。';
    case 'collector-fingerprint-unrecorded':
      return '[collector-fingerprint-unrecorded] 图产物未记录 collector fingerprint（本机制上线前生成的旧图，或绕过 CLI 直连建图 API 未写入指纹），无法证明其与当前采集器行为一致，请重新运行 `spectra batch --mode graph-only` 重建图。';
    case 'collector-fingerprint-invalid':
      return '[collector-fingerprint-invalid] 图产物记录的 collector fingerprint 结构畸形（字段缺失/类型错误/formatVersion 不受支持），内容不可信，请重新运行 `spectra batch --mode graph-only` 重建图。';
  }
}

/**
 * stale 态的 nextSteps：逐条原因各出一句，顺序沿用 `staleReasons` 的确定性顺序。
 *
 * `staleReasons` 缺席时（旧版本判定器产出的报告，或字段被下游裁剪）回落到 sourceCommit
 * 型文案——这是本命令上线本机制前的唯一 stale 语义，比"stale 却给不出任何建议"更有用。
 */
function buildStaleNextSteps(freshness: GraphFreshnessVerdict): string[] {
  const reasons = freshness.staleReasons ?? [];
  if (reasons.length === 0) {
    return [describeStaleReason('source-commit', freshness)];
  }
  return reasons.map((reason) => describeStaleReason(reason, freshness));
}

/** SC-011：为每个 fail/stale 项生成面向维护者的下一步修复建议文本。 */
function buildNextSteps(report: Omit<GraphQualityReport, 'nextSteps'>): string[] {
  const steps: string[] = [];
  if (report.duplicateCanonicalId.status === 'fail') {
    steps.push(
      `发现 ${report.duplicateCanonicalId.groups.length} 组重复 canonical ID，请检查 producer 是否对同一符号产出了多个 ID（常见于 # / :: 分隔符混用），修复后重新运行 \`spectra batch --mode graph-only\` 重建图。`,
    );
  }
  if (report.danglingEdges.status === 'fail') {
    steps.push(
      `发现 ${report.danglingEdges.edges.length} 条悬空边（source/target 指向不存在的节点），请检查边生成逻辑是否引用了已被剔除的节点 id，修复后重新建图。`,
    );
  }
  if (report.containsCoverage.status === 'fail') {
    steps.push(
      `${report.containsCoverage.uncoveredIds.length} 个 symbol 节点未被任何 contains 边覆盖，请检查这些节点是否遗漏了父容器边（deriveContainsEdges）。`,
    );
  }
  if (report.orphanRatio.status === 'fail') {
    steps.push(
      `orphan 比例 ${((report.orphanRatio.offendingRatio ?? 0) * 100).toFixed(1)}% 超过 5% 阈值（${report.orphanRatio.offendingIds.length} 个未落入例外分类的 zero-degree symbol 节点），请检查这些符号是否应有调用/依赖关系但缺失。`,
    );
  }
  if (report.legacyAndIgnoredNodes.status === 'fail') {
    if (report.legacyAndIgnoredNodes.legacyHashNodeIds.length > 0) {
      steps.push(
        `发现 ${report.legacyAndIgnoredNodes.legacyHashNodeIds.length} 个遗留 \`#\` 分隔符 symbol 节点，请运行 \`spectra index\` 或 \`spectra batch\` 在当前 worktree 重建图以升级为 canonical \`::\` 格式。`,
      );
    }
    if (report.legacyAndIgnoredNodes.ignoredPathNodeIds.length > 0) {
      steps.push(
        `发现 ${report.legacyAndIgnoredNodes.ignoredPathNodeIds.length} 个源自应被排除路径（.gitignore / 内置忽略目录）的节点，请检查扫描器忽略规则是否失效后重新建图。`,
      );
    }
  }
  if (report.freshness.state === 'stale') {
    steps.push(...buildStaleNextSteps(report.freshness));
  }
  if (report.freshness.state === 'dirty') {
    if (report.freshness.porcelainReadFailed) {
      // FIX-3（Codex WARNING）：工作树状态读取本身失败（如 ENOBUFS），保守判 dirty，
      // 需明确告知维护者这是"读取失败的保守降级"而非真实检测到的未提交改动。
      steps.push(
        '工作树状态读取失败，按 dirty 保守处理；请手动运行 `git status` 确认实际改动，或重新运行 `spectra batch --mode graph-only` 重建图。',
      );
    } else {
      steps.push('图可能未反映未提交改动，如需精确请先提交或重新建图。');
    }
  }
  return steps;
}

/**
 * F258：不可判忽略判定的机读前缀 token。
 *
 * `graph-quality-report.schema.json` 顶层是 `additionalProperties: false`，新增结构化字段
 * 代价过大，故诊断走已有的 `nextSteps: string[]`。代价是它只能是一条**文本契约**——
 * 消费者 `scripts/lib/graph-quality-core.mjs` 对本 token 做前缀匹配，改文案即静默断链。
 * 因此该字面值由 `tests/unit/graph-quality-core.test.ts` 的跨侧测试**双向钉住**。
 */
export const IGNORE_UNDETERMINABLE_TOKEN = '[ignore-undeterminable]';

/**
 * F258 审查修复轮 M-1：三态 oracle **整体降级**的机读子 token（嵌在同一条 nextSteps 文案里）。
 *
 * 单独一个子 token 而不是靠中文文案关键词：消费者要据此把 `degraded` 放进结构化 evidence，
 * 靠"文案里有没有'降级'两个字"做判据等于把门禁挂在措辞上。与外层 token 同为文本契约，
 * 同样由 `tests/unit/graph-quality-core.test.ts` 跨侧双向钉住。
 */
export const IGNORE_ORACLE_DEGRADED_TOKEN = '[oracle-degraded]';

/**
 * F258：把 oracle 累积的"判不了"诊断渲染成一条 nextSteps 文案。
 *
 * 文案必须能区分**三件**互不等价的事（D7 + 审查修复轮 M-1/M-2）：
 * - "判不了"（`count`）：git 对该路径形态拒答 / 权限受限等；
 * - "预算耗尽所以没去判"（`budgetExhausted`）：具名出口 `l2-budget-exhausted`；
 * - "整个三态判定根本没在跑"（`degraded`）：git 仓内忽略清单预取失败 ⇒ oracle 退成二态近似。
 *
 * `degraded` 优先级最高且必须**先**判：该态下 `count` 与 `budgetExhausted` 结构性恒为
 * 0 / false，沿用另外两条文案会把"没在判"说成"判过了没问题"——正是这条文案要堵的洞。
 */
export function describeUndeterminable(summary: UndeterminableSummary): string {
  if (summary.degraded) {
    return (
      `${IGNORE_UNDETERMINABLE_TOKEN} ${IGNORE_ORACLE_DEGRADED_TOKEN} ` +
      'git 仓库内忽略清单预取失败（git 不可用 / 仓库损坏 / 输出超限），三态忽略判定已整体降级为' +
      '仅根 .gitignore 近似解析的二态结果：本次运行**不产出**不可判计数，' +
      '因此"0 个不可判路径"不构成"忽略判定无盲区"的证据；' +
      'ignoredPathNodeIds 维度的保真度同步降级，请先修复 git 环境再复核本报告。'
    );
  }
  const sampleText = summary.samples.length > 0 ? `；样本：${summary.samples.join(', ')}` : '';
  if (summary.count === 0) {
    // 预算恰在最后一次 L2 之后耗尽：一条也没落进 undeterminable，但此后的离盘路径不再被查询
    return (
      `${IGNORE_UNDETERMINABLE_TOKEN} 本次运行未产出不可判路径，但权威忽略判定预算已耗尽` +
      '[l2-budget-exhausted]：此后的离盘路径一律不再发起权威查询，' +
      'ignoredPathNodeIds 维度可能不完整。'
    );
  }
  const budgetText = summary.budgetExhausted
    ? '（其中部分路径因权威判定预算耗尽 [l2-budget-exhausted] 而未实际查询，并非 git 拒答）'
    : '';
  return (
    `${IGNORE_UNDETERMINABLE_TOKEN} ${summary.count} 个节点路径的忽略判定不可判` +
    `（symlink 穿越 / submodule / 仓外 / 越界 / 权限受限）${budgetText}，` +
    `已按未忽略处理，未计入 ignoredPathNodeIds${sampleText}。`
  );
}

/**
 * 诊断是否需要出声。
 *
 * **不得写成 `count > 0`**（审查修复轮 M-1 / M-2）：那条判据同时漏掉两个出口——
 * `degraded`（三态判定整体没在跑，count 结构性恒 0）与 `budgetExhausted`（没去判，
 * 预算恰在最后一次 L2 后耗尽时 count 也是 0）。两者都是"沉默即绿灯"的方向。
 *
 * 与 {@link describeUndeterminable} 一同导出：这两个纯函数是诊断通道的**判据与文案契约**，
 * `budgetExhausted` 那条出口在 E2E 里成本极高（要真把 L2 预算跑穿），直接对它们下断言是
 * 唯一能让该出口被变异测试杀掉的方式。
 */
export function shouldVoiceUndeterminable(summary: UndeterminableSummary): boolean {
  return summary.count > 0 || summary.degraded || summary.budgetExhausted;
}

/**
 * 十六进制摘要的人读展示形态：截到 `length` 位（展示层裁剪，图产物本身仍存全长）。
 *
 * 入参刻意放宽到 `unknown` 并显式判类型（复审 F1）：第二轮实测过一份 `sourceCommit: 123` 的图
 * 能一路走到展示层，旧实现的 `sha.slice(0,7)` 当场抛 `sha.slice is not a function`，整条
 * graph-quality 崩成 exit 2。第三轮 D1 把比对对象换成 builder 之后，那条具体路径已结构性消失
 * （本函数的实参现在只剩经 `parseGraphBuilderStamp` 校验过的字段），但**类型守卫按裁决保留**为
 * 防御纵深：一个 advisory 展示函数 MUST NOT 具备改变 exit code 的能力，这条不变量不该依赖
 * "调用方恰好只传合法值"。
 */
function short(hex: unknown, length = 7): string {
  return typeof hex === 'string' && hex.length > 0 ? hex.slice(0, length) : 'null';
}

/**
 * 单份 stamp 的人读身份：commit 7 位 + dist 前 12 位 + 两个 build 时刻的脏标志。
 *
 * **`dist` 必须出现（第三轮 D2）**：在**未提交的 feature 分支**上 `builder.commit` 恒等于 HEAD，
 * 无论 dist 落后源码多少次编辑——"同 commit 内 dist 落后"恰恰是本机制要抓的**主形态**，只比
 * commit 对它完全失明。第二轮实测：两份仅 `distSha256` 不同的 stamp 渲染出的文案**逐字相同**。
 *
 * 复审 F7：两个 flag 取的是 **`npm run build` 那一刻**的工作树状态（`stampBuild`，
 * `scripts/lib/spectra-version-gate.mjs:68-90`），与**建图时刻**无关，两者可以差数天。
 * 而 `dirty` 恰好又是 freshness 四态之一、语义是"建图时工作树脏"——实跑输出里
 * `[freshness] fresh` 紧邻 `(dirty=true, ...)`，不标时间参照系必被误读成互相矛盾。
 */
function stampIdentity(stamp: GraphBuilderStamp): string {
  return (
    `commit ${short(stamp.commit)} / dist ${short(stamp.distSha256, 12)} ` +
    `(build 时: 工作树 dirty=${stamp.dirty}, build 输入 sourceDirty=${stamp.sourceDirty})`
  );
}

/**
 * 两个 commit 记法是否**相容**：一方是另一方的前缀即算相容（含完全相等）。
 *
 * 为什么不能裸 `!==`（对抗复审 W1 实证）：`COMMIT_VALUE_PATTERN` 的 7 位下界是**刻意**为
 * "外部工具 / 手工构造的图用 short-sha 记账"开的。裸比较会让"图记 `0d3e385`、当前是
 * `0d3e385f…`"判成"commit 不同"，而展示层两侧都截到 7 位 ⇒ **同一行里两个渲染值逐字相同、
 * 结论却说不同**，是一句读者能当场证伪的话——正是前两轮栽过的形状。
 *
 * 前缀相容**不等于**同一 commit（7 位前缀会碰撞），所以它只用来避免"自相矛盾的断言"，
 * 不用来充当同一性证据；同一性由 `distSha256` 承担（见 {@link describeBuilderStamp}）。
 */
function commitNotationCompatible(a: string, b: string): boolean {
  const shared = Math.min(a.length, b.length);
  return a.slice(0, shared) === b.slice(0, shared);
}

/**
 * `distSha256` 不同（= 两份编译产物内容不同）时，点名是哪一维不同。
 */
function describeProductDelta(recorded: GraphBuilderStamp, current: GraphBuilderStamp): string {
  return commitNotationCompatible(recorded.commit, current.commit)
    ? '同一 commit 下 dist 内容不同（源码改了但未重新提交，两次 build 之间 dist 变过）'
    : 'commit 与 dist 内容两维都不同';
}

/**
 * `distSha256` 相同（= 编译产物内容按 sha256 无差别）但盖章元数据仍有出入时，逐项列出。
 *
 * 为什么这些差异不配占据结论位（对抗复审 W4）：`stampBuild` 的 `dirty` 取的是**整树**
 * `git status --porcelain`，与 dist 内容毫无关系——碰任何一个无关文件（再生 specs、临时脚本）
 * 后重建，`distSha256` 不变而 `dirty` 翻转，此前建的所有图会一律被标"不是同一个 build"。
 * 那正是本机制设计时要避免的"天天红 → 被当噪声忽略"。
 */
function describeMetadataDeltas(
  recorded: GraphBuilderStamp,
  current: GraphBuilderStamp,
): string[] {
  const notes: string[] = [];
  if (recorded.commit !== current.commit) {
    notes.push(
      commitNotationCompatible(recorded.commit, current.commit)
        ? `commit 记法长度不同（图 ${recorded.commit.length} 位 / 当前 ${current.commit.length} 位，前缀相同）`
        : `盖章 commit 不同（图 ${short(recorded.commit)} / 当前 ${short(current.commit)}）`,
    );
  }
  if (recorded.dirty !== current.dirty || recorded.sourceDirty !== current.sourceDirty) {
    // 两侧取值都要给出：本分支只渲染了 recorded 一侧的 stampIdentity，不列出当前侧的取值
    // 就等于把差异说了个"有"却不让读者看见"差在哪"。
    notes.push(
      '盖章时记录的工作树状态不同（' +
        `图 dirty=${recorded.dirty}/sourceDirty=${recorded.sourceDirty}，` +
        `当前 dirty=${current.dirty}/sourceDirty=${current.sourceDirty}）`,
    );
  }
  return notes;
}

/**
 * F261：把图产物的 builder stamp 渲染成一行 **advisory**（INFO 级，非判定）。
 *
 * ## 比对对象（第三轮 D1）：**当前正在运行的 builder**，不是 `sourceCommit`
 *
 * 前两轮把 `builder.commit` 与 `graph.graph.sourceCommit` 比对，这是**设计级错误**：前者是
 * Spectra 自己 dist 的 build commit，后者是**被分析项目**的 commit，除自举外二者跨仓库，
 * **不等是结构性恒真的**。真 dist 实证（外部临时项目，dist 一点也不滞后）：
 *
 * ```
 * [builder] 0d3e385 (…) — 与 sourceCommit=eceb956 不一致：本图由与源码树不同版本的编译产物写出
 * ```
 *
 * 这句对每个外部用户每次运行都出现且恒为假，正好复现 fix-report 决策 2 要避免的
 * "天天红 → 被当噪声忽略"。
 *
 * 新语义把**图里记录的 builder** 与 {@link getBuilderStamp}（本进程加载期抓到的 builder）比对，
 * 回答「**这张图是不是由你现在跑的这一版 spectra 建的**」——对任何被分析项目都良定义，且恰好
 * 就是 fix-report 那起事故的形状（陈旧 dist 建的基线图，在新 dist 下被使用 / 被对比）。
 *
 * 比对**渲染**整份 stamp（`commit` + `distSha256` + 两个脏标志，见 {@link stampIdentity}），
 * 但**结论由 `distSha256` 判定**——它是"执行的编译产物是不是同一份"的唯一硬证据；commit 记法
 * 与脏标志只是盖章元数据，差异降级为同一行内的括注（对抗复审 W1/W4，理由见
 * {@link commitNotationCompatible} 与 {@link describeMetadataDeltas}）。
 *
 * ## 七态（记录侧三态 × 比对侧四态收敛而来）
 *
 * | 情形 | 输出要点 |
 * |------|----------|
 * | 记录键缺失 | `unrecorded` — 未记录（旧图产物，或元数据结构异常） |
 * | 记录显式 `null` | `unstamped` — 记录为 null（未盖章 build / 源码直跑写出） |
 * | 记录存在但解析失败 | `unrecognized` — 更新版本写出、或已被篡改（**MUST NOT** 塌进 `unstamped`，且输出 MUST 与记录内容无关） |
 * | 当前找不到盖章 | 无法比对（源码直跑，**或** dist 缺 build-meta） |
 * | dist 相同且元数据全同 | 由当前运行的 build 写出 |
 * | dist 相同但元数据有出入 | 由当前运行的这一份编译产物写出 + 逐项列出元数据出入 |
 * | dist 不同 | 不是同一个 build，并点名是"同 commit 下 dist 变了"还是"两维都不同" |
 *
 * 记录侧三态刻意分列（对齐 F249 `collector-fingerprint-unrecorded` / `-invalid` 分列的既有先例）：
 * "没记"、"记了个 null"、"记了但读不懂"对应完全不同的排查动作，塌成一句等于抹掉诊断信息。
 *
 * **任何由 `JSON.parse` 能产出的输入都不得抛异常**——本函数处在 `graph-quality` 的成功路径上，
 * 一次抛出就是 exit 2，等于 advisory 反过来当了门禁。收口做在**两层**：外层 `graph`、内层
 * `graph.graph`，各自非对象形态先折叠成 `{}`（对抗复审 B-W1：上一版只挡内层，`graph` 自身为
 * `null` / `undefined` 时第一条语句就抛）。
 *
 * 边界如实登记：**未**用 try/catch 兜底，因此进程内手工构造的"取值即抛的 getter"仍会穿透。
 * 这类输入不可能来自 `JSON.parse`（本函数唯一的生产输入源），而加一层 catch-all 会把真 bug
 * 一并吞掉——宁可把不变量的作用域写准，也不用一个包住一切的 catch 去凑一句更漂亮的绝对句。
 *
 * ## 为什么只"可见"不"判定"
 *
 * dist 与源码树不同步是开发期常态，把它升为 stale 会让 `graph-quality` 天天红、迅速被当噪声
 * 忽略，反而降低现有 stale 信号（真正的采集面变更）的信噪比。本行 **不改** exit code /
 * `overallVerdict` / freshness 四态，也 **不进** `--json`（`graph-quality-report.schema.json`
 * 顶层 `additionalProperties: false`；机读需求由 `graph.graph.builder` 结构化字段本身满足，
 * 报告工具不该充当第二个可漂移的副本）。
 *
 * 为什么不走 `nextSteps`：① `nextSteps` 的合同是"面向维护者的下一步**修复建议**"，同 build 态
 * 没有任何要修的东西，塞进去是把 INFO 伪装成 action item；② `nextSteps` 靠"非空即有问题"被扫读，
 * 每次运行都多一条会稀释它；③ F258 已登记 `nextSteps` 文本前缀是脆弱机读契约，不该再挂第三个 token。
 *
 * **文案硬约束（plan §7.3）**：MUST NOT 出现 `[source-commit]` / `[collector-fingerprint]` /
 * `[collector-fingerprint-unrecorded]` / `[collector-fingerprint-invalid]` 四个方括号字面量——
 * `graph-quality-cli.test.ts` 的"错配防线"会对未命中场景逐个断言 `not.toContain('[<reason>]')`，
 * 一旦撞上就会在某个 stale 场景里误红。
 *
 * @param currentBuilder 当前正在运行的 builder。默认取 {@link getBuilderStamp}（进程加载期常量）；
 *   显式入参**只为可测性**存在——生产进程里它恒为同一个值，单测无法通过构造输入覆盖六态。
 *
 * 导出供单测直接打（不经 CLI 子进程）。
 */
export function describeBuilderStamp(
  graph: GraphJSON,
  currentBuilder: GraphBuilderStamp | null = getBuilderStamp(),
): string {
  // 入口收口：`graph.graph` 在类型上是对象，但本函数是**导出**的、且 CLI 侧的
  // `validateGraphJsonShape` 只保证它 `typeof === 'object'`（数组也过）。用 `in` 运算符前先把
  // 非对象形态折叠掉——`'builder' in null` 会抛，而一次抛出就是 exit 2（advisory 反当门禁）。
  //
  // 收口必须**两层都做**（对抗复审 B-W1 实证）：上一版只折叠了内层 `graph.graph`，第一条语句
  // `graph.graph` 本身在 `graph` 为 `null` / `undefined` 时就已经抛了，17 组敌意输入里正是这 2 组
  // 穿透。本函数的 JSDoc 与 `short()` 的注释都把"不抛"声明成**不依赖调用方**的纵深防御，
  // 只挡内层等于这条不变量按其自身口径没成立。
  const outer: Record<string, unknown> =
    graph !== null && typeof graph === 'object'
      ? (graph as unknown as Record<string, unknown>)
      : {};
  const rawMeta: unknown = outer['graph'];
  const meta: Record<string, unknown> =
    rawMeta !== null && typeof rawMeta === 'object'
      ? (rawMeta as Record<string, unknown>)
      : {};
  // 同 `writeKnowledgeGraph`：用 hasOwnProperty 而非 `in`，不让原型链上的 `builder` 冒充图的记录。
  const rawRecorded: unknown = Object.prototype.hasOwnProperty.call(meta, 'builder')
    ? meta['builder']
    : undefined;

  // 记录侧三态：没记 / 记了 null / 记了但读不懂——排查动作各不相同，MUST NOT 合并。
  if (rawRecorded === undefined) {
    // 措辞不写死单一成因（复审 I2）：图产物元数据整体畸形时也落在这里。
    return '[builder] unrecorded — 图未记录 builder（本字段上线前的旧图产物，或元数据结构异常），无从判断由哪一版 build 建出';
  }
  if (rawRecorded === null) {
    // 成因收窄回"未盖章 / 源码直跑"两条（第四轮 D6）：上一版这里还挂着"或曾被回写链路降级"
    // 的兜底措辞，因为 `preserve-recorded` 当时会把读不懂的原值 collapse 成 null。D6 已从写盘
    // 侧根除该通道（读不懂就原样不动），这条成因不再可达，留着反而是一句无法发生的假设。
    return '[builder] unstamped — 图记录 builder 为 null（未盖章 build / 源码直跑写出），无 build 身份可比对';
  }
  const recorded = parseGraphBuilderStamp(rawRecorded);
  if (recorded === null) {
    // 值域不合规（控制字符 / 路径 / 时间戳）与 formatVersion 不受支持都落在这里：图**自称**有
    // builder 却读不懂，这是"更新版本写出、或已被篡改"，与"根本没盖章"是两回事。
    //
    // **返回值 MUST 是与 `rawRecorded` 内容无关的常量串**（D6 配套不变量）：D6 之后磁盘上会
    // 长期存在我们读不懂的 builder 值（前向兼容的代价），"控制字符不进终端 / 绝对路径与时间戳
    // 不外泄"这条不变量因此**完全落在本行**——写盘侧不再销毁证据当第二道保险。任何形式的回显
    // （哪怕只是"顺手把 formatVersion 打出来帮助排查"）都会重新打开 F3 已实证的注入面。
    // 由 `graph-quality-builder-advisory.test.ts` 的恒定性用例（8 组敌意输入输出必须完全相同）钉住。
    return '[builder] unrecognized — builder 记录存在但不可识别（更新版本写出、或已被篡改）';
  }

  // 比对侧：当前进程找不到盖章 ⇒ 只报身份，MUST NOT 下同/异判断。
  // 成因不写死成"源码直跑"（复审 W2 实证）：`npx tsc` / IDE build task /
  // `npm run build --ignore-scripts` 都会产出**真编译 dist 但没有 build-meta**，同样落在这里。
  if (currentBuilder === null) {
    return (
      `[builder] 图记录 ${stampIdentity(recorded)} — 无法比对：` +
      '当前进程未找到 build 盖章（源码直跑，或 dist 缺 .spectra-build-meta.json）'
    );
  }

  // **同一性由 `distSha256` 判定**：它是 dist 全树 .js 的内容 hash，相同即意味着"执行的编译产物
  // 就是同一份"。commit / 脏标志是盖章时刻的**元数据**，与产物内容无关（复审 W1/W4）：
  // 前者可能只是 short-sha 记法差异，后者碰任何无关文件重建就会翻转。让元数据差异去主导
  // "是不是同一个 build"的结论，会同时制造①自相矛盾的断言 与②高频误报噪声。
  const sameProduct = recorded.distSha256 === currentBuilder.distSha256;

  // D2 后半条：`sourceDirty === true` 时**禁止**说"一致"——脏工作树 build 的 commit 本就不构成
  // 可复现身份（同一 commit 可以对应无数份不同的 dist）。措辞按分支区分：不等分支里两侧可能
  // 只有一侧脏，说成"该 build"会指代不明。
  const anyDirty = recorded.sourceDirty || currentBuilder.sourceDirty;

  if (sameProduct) {
    const caveat = anyDirty ? '；注意该 build 出自脏工作树，commit 不构成可复现身份' : '';
    const deltas = describeMetadataDeltas(recorded, currentBuilder);
    if (deltas.length === 0) {
      return `[builder] ${stampIdentity(recorded)} — 由当前运行的 build 写出${caveat}`;
    }
    return (
      `[builder] ${stampIdentity(recorded)} — 由当前运行的这一份编译产物写出（dist 按 sha256 相同）；` +
      `仅盖章元数据有出入：${deltas.join('、')}${caveat}`
    );
  }
  const caveat = anyDirty ? '；注意至少一侧 build 出自脏工作树，commit 不构成可复现身份' : '';
  return (
    `[builder] 图记录 ${stampIdentity(recorded)}；当前运行 ${stampIdentity(currentBuilder)} — ` +
    `不是同一个 build：${describeProductDelta(recorded, currentBuilder)}${caveat}`
  );
}

/** 组装完整 GraphQualityReport（成功读取到合法图产物场景）。 */
function buildReport(graph: GraphJSON, graphPath: string, projectRoot: string): GraphQualityReport {
  const ignoreOracle = createIgnoreOracle(projectRoot);
  const structural = runGraphQualityChecks(graph, {
    isIgnored: ignoreOracle.isIgnored,
    getTestPatterns,
  });
  // F249 FR-009：evaluateGraphFreshness 内把图产物记录的指纹作为第三参传入（可能为
  // undefined/null/畸形值，evaluateFreshness 内部经 isValidCollectorFingerprint 收口）。
  // 同时归一化 recordedSourceCommit：JSON.stringify 会丢弃值为 undefined 的 key，而
  // undefined（旧图字段缺失）与显式 null（非 git 仓库）在 FR-010 语义上等价，
  // 不归一化会让 --json 输出因该字段整体消失而破坏契约（见 schema 的 required）。
  const freshness = evaluateGraphFreshness(graph, projectRoot);
  const overallVerdict = computeOverallVerdict(structural.structuralVerdict, freshness.state);

  const base: Omit<GraphQualityReport, 'nextSteps'> = {
    graphPath,
    generatedAt: new Date().toISOString(),
    schemaVersion: graph.graph.schemaVersion,
    duplicateCanonicalId: structural.duplicateCanonicalId,
    containsCoverage: structural.containsCoverage,
    orphanRatio: structural.orphanRatio,
    danglingEdges: structural.danglingEdges,
    legacyAndIgnoredNodes: structural.legacyAndIgnoredNodes,
    freshness,
    overallVerdict,
  };

  const nextSteps = buildNextSteps(base);

  // F258：三态 oracle 的"判不了"诊断——有界（不逐条 warn）、双通道（nextSteps 供机读、
  // stderr 供人读）。两类消费方（采集面 walk / 图质量门）对 undeterminable **同向**按
  // not-ignored 处理，故这里只报告、不改判定。
  const undeterminable = ignoreOracle.drainUndeterminable();
  if (shouldVoiceUndeterminable(undeterminable)) {
    const message = describeUndeterminable(undeterminable);
    nextSteps.push(message);
    console.error(`[graph-quality] ${message}`);
  }

  return { ...base, nextSteps };
}

function toStatusReport(report: GraphQualityReport, graphExists: boolean): GraphQualityStatusReport {
  return {
    graphExists,
    freshness: report.freshness.state,
    overallVerdict: report.overallVerdict,
  };
}

function formatPercent(ratio: number | null): string {
  return ratio === null ? 'n/a' : `${(ratio * 100).toFixed(1)}%`;
}

/**
 * 完整报告的人读文本渲染。
 *
 * @param builderAdvisory F261：builder stamp 的 advisory 行（`describeBuilderStamp` 的产出）。
 *   只有"成功读到合法图产物"时才有值——`cannot-assess` 系列报告根本没有可读的 `graph.graph`，
 *   此时传 `null` 即不渲染该行。**刻意作为独立入参而非 report 字段**：report 会被
 *   `JSON.stringify` 直出 `--json`，加字段就会撞上 schema 的 `additionalProperties: false`。
 */
function formatReportText(report: GraphQualityReport, builderAdvisory: string | null): string {
  const lines: string[] = [
    'Graph Quality Report',
    '=====================',
    `Graph:     ${report.graphPath}`,
    `Generated: ${report.generatedAt}`,
    `Schema:    ${report.schemaVersion}`,
    `Overall Verdict: ${report.overallVerdict}`,
    '',
    `[duplicate-canonical-id] ${report.duplicateCanonicalId.status}` +
      (report.duplicateCanonicalId.status === 'fail'
        ? ` (${report.duplicateCanonicalId.groups.length} 组重复)`
        : ''),
    `[contains-coverage] ${report.containsCoverage.status}` +
      (report.containsCoverage.status !== 'not-applicable'
        ? ` (${report.containsCoverage.covered}/${report.containsCoverage.total}, ${formatPercent(report.containsCoverage.ratio)})`
        : ''),
    `[orphan-ratio] ${report.orphanRatio.status}` +
      (report.orphanRatio.status !== 'not-applicable'
        ? ` (超标 ${report.orphanRatio.offendingIds.length}/${report.orphanRatio.totalSymbolNodes}, ${formatPercent(report.orphanRatio.offendingRatio)}; 全节点 zero-degree 率 ${formatPercent(report.orphanRatio.allNodeZeroDegreeRatio)})`
        : ''),
    `[dangling-edge] ${report.danglingEdges.status}` +
      (report.danglingEdges.status === 'fail' ? ` (${report.danglingEdges.edges.length} 条)` : ''),
    `[legacy-ignored] ${report.legacyAndIgnoredNodes.status}` +
      (report.legacyAndIgnoredNodes.status === 'fail'
        ? ` (legacy: ${report.legacyAndIgnoredNodes.legacyHashNodeIds.length}, ignored: ${report.legacyAndIgnoredNodes.ignoredPathNodeIds.length})`
        : ''),
    `[freshness] ${report.freshness.state}` +
      ` (recorded=${report.freshness.recordedSourceCommit ?? 'null'}, current=${report.freshness.currentHead ?? 'null'})` +
      // F249 FR-013：stale 的具体原因必须出现在人读摘要行本身，而不是只藏在 nextSteps 里——
      // 摘要行是扫读时唯一必看的一行
      (report.freshness.staleReasons && report.freshness.staleReasons.length > 0
        ? ` [staleReasons: ${report.freshness.staleReasons.join(', ')}]`
        : ''),
  ];

  // F261：advisory 紧跟 [freshness] 之后——两者都在回答"这张图还能不能信"，只是维度不同
  // （freshness 判源码/采集面，builder 记执行体）。仅人读文本面新增，判定面一律不动。
  if (builderAdvisory !== null) {
    lines.push(builderAdvisory);
  }

  if (report.duplicateCanonicalId.status === 'fail') {
    lines.push('', 'Duplicate canonical ID groups:');
    for (const group of report.duplicateCanonicalId.groups) {
      lines.push(`  ${group.filePath} :: ${group.symbolName} (${group.kind}) -> ${group.ids.join(', ')}`);
    }
  }
  if (report.danglingEdges.status === 'fail') {
    lines.push('', 'Dangling edges:');
    for (const edge of report.danglingEdges.edges) {
      lines.push(`  ${edge.source} -[${edge.relation}]-> ${edge.target}`);
    }
  }

  if (report.nextSteps.length > 0) {
    lines.push('', 'Next steps:');
    for (const step of report.nextSteps) {
      lines.push(`  - ${step}`);
    }
  }

  return lines.join('\n');
}

function formatStatusText(status: GraphQualityStatusReport): string {
  return [
    `graphExists: ${status.graphExists}`,
    `freshness: ${status.freshness}`,
    `overallVerdict: ${status.overallVerdict}`,
  ].join('\n');
}

function exitCodeFor(overallVerdict: GraphQualityReport['overallVerdict']): number {
  if (overallVerdict === 'fail-strong-invariant') return 1;
  if (overallVerdict === 'cannot-assess') return 2;
  return 0;
}

/**
 * FIX-8b（Codex WARNING）：写入失败（如目标路径不可写）不应抛出中断进程——评估本身
 * 已完成，退出码必须仍按 report.overallVerdict 语义退出，而非因"报告落盘"这个
 * 次要动作失败而整体失败。失败原因通过返回值告知调用方打印到 stderr。
 */
function writeOutputFile(outputPath: string, content: string): { success: boolean; error?: string } {
  try {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 执行 graph-quality 子命令。
 */
export async function runGraphQualityCommand(command: CLICommand): Promise<void> {
  if (command.help) {
    console.log(GRAPH_QUALITY_HELP);
    return;
  }

  const projectRoot = process.cwd();
  const graphPath = command.graphQualityGraph
    ? path.resolve(command.graphQualityGraph)
    : path.join(projectRoot, 'specs', '_meta', 'graph.json');

  const graphExists = fs.existsSync(graphPath);

  let report: GraphQualityReport;
  // F261：仅在成功读到合法图产物时才有 builder advisory；cannot-assess 系列没有可读的 graph.graph。
  let builderAdvisory: string | null = null;
  if (!graphExists) {
    report = buildCannotAssessReport(graphPath, 'graph-missing', [
      '未建图，请先运行 `spectra batch --mode graph-only`（纯 AST · 零 LLM · <2min）生成 graph.json。',
    ]);
  } else {
    const raw = fs.readFileSync(graphPath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || !validateGraphJsonShape(parsed)) {
      report = buildCannotAssessReport(graphPath, 'json-parse-error', [
        '图产物损坏（JSON 解析失败，或缺少 directed/multigraph/graph/nodes/links 等基础字段，或 node.id / edge.source / edge.target 形态不合法），建议重新运行 `spectra batch --mode graph-only` 重建。',
      ]);
    } else {
      // FIX-7：schemaVersion 数值比较，而非字符串相等——低于支持版本 → schema-too-old；
      // 高于支持版本（如未来更新版本 spectra 生成的图）→ schema-newer-than-supported；
      // 无法解析为 major.minor 数值形态 → 归入 json-parse-error 家族。
      const supportedVersion = parseSchemaVersion(MIN_SUPPORTED_SCHEMA_VERSION);
      const actualVersion = parseSchemaVersion(parsed.graph.schemaVersion);
      if (!supportedVersion || !actualVersion) {
        report = buildCannotAssessReport(graphPath, 'json-parse-error', [
          `图产物 schemaVersion（${parsed.graph.schemaVersion}）格式不合法（应为 major.minor 数值形态，如 "2.0"），建议重新运行 \`spectra batch --mode graph-only\` 重建。`,
        ]);
      } else {
        const cmp = compareSchemaVersion(actualVersion, supportedVersion);
        if (cmp < 0) {
          report = buildCannotAssessReport(graphPath, 'schema-too-old', [
            `图产物 schemaVersion（${parsed.graph.schemaVersion}）低于当前命令支持的最低版本（${MIN_SUPPORTED_SCHEMA_VERSION}），请重新运行 \`spectra batch --mode graph-only\` 重建。`,
          ]);
        } else if (cmp > 0) {
          report = buildCannotAssessReport(graphPath, 'schema-newer-than-supported', [
            `图产物 schemaVersion（${parsed.graph.schemaVersion}）高于本工具当前支持的版本（${MIN_SUPPORTED_SCHEMA_VERSION}），请升级 spectra 后重试。`,
          ]);
        } else if (isEmptyGraph(parsed)) {
          // F266 FR-006：结构合法但零节点零边 —— 归入既有 cannot-assess 通道继承 exit 2，
          // 不给 exit code 新增语义（FR-007），也不进 buildReport（否则六指标空态会聚合成 pass）。
          report = buildCannotAssessReport(
            graphPath,
            'empty-graph',
            [
              '图产物为空（0 节点 / 0 边），无法对其做任何质量判定——空图不等于"图没问题"，而是"没建出图"。请重新运行 `spectra batch --mode graph-only`（纯 AST · 零 LLM · <2min）建图；若重建后仍为空，说明项目内未发现任何受支持语言的源文件（或该项目使用的语言尚未被 Spectra 支持）。',
            ],
            evaluateGraphFreshness(parsed, projectRoot),
          );
        } else {
          // F266 对抗审查 A6a + delta 审查 D1：无 symbol 节点的退化图**照常跑完整体检**，
          // 再按结果决定是否改判——强不变量违反原样保留（exit 1），其余改判 cannot-assess
          // 但保留真实指标。前置短路会把 duplicate-id / dangling-edge / legacy-ignored 这三项
          // 与 symbol 无关的检查一并吞掉（已实证会把真 exit 1 洗成 warn）。
          report = buildReport(parsed, graphPath, projectRoot);
          builderAdvisory = describeBuilderStamp(parsed);
          if (hasNoSymbolNodes(parsed)) {
            report = downgradeForNoSymbolNodes(report, parsed.nodes.length);
          }
        }
      }
    }
  }

  const useJson = Boolean(command.graphQualityJson);

  let output: string;
  if (command.graphQualityStatus) {
    const status = toStatusReport(report, graphExists);
    output = useJson ? JSON.stringify(status, null, 2) : formatStatusText(status);
  } else {
    output = useJson ? JSON.stringify(report, null, 2) : formatReportText(report, builderAdvisory);
  }

  if (command.graphQualityOutput) {
    const fileFormat = command.graphQualityFormat ?? 'text';
    const fileContent =
      fileFormat === 'json'
        ? JSON.stringify(command.graphQualityStatus ? toStatusReport(report, graphExists) : report, null, 2)
        : command.graphQualityStatus
          ? formatStatusText(toStatusReport(report, graphExists))
          : formatReportText(report, builderAdvisory);
    const writeResult = writeOutputFile(command.graphQualityOutput, fileContent);
    // FIX-8（Codex WARNING）：写入通知/失败提示均打印到 stderr，保证 --json 时 stdout
    // 只含结构化报告本身，可被下游脚本直接 JSON.parse，不被人读提示污染。
    if (writeResult.success) {
      console.error(`[graph-quality] 报告已写入: ${command.graphQualityOutput}`);
    } else {
      console.error(`[graph-quality] 报告写入失败: ${writeResult.error}`);
    }
  }

  console.log(output);
  process.exitCode = exitCodeFor(report.overallVerdict);
}
