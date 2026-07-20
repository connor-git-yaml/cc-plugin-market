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
import { evaluateFreshness } from '../../panoramic/graph/source-commit.js';
import { LanguageAdapterRegistry } from '../../adapters/language-adapter-registry.js';
import type {
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
  - freshness:              graph.sourceCommit 与当前 HEAD 的一致性（fresh/dirty/stale/unknown-provenance）

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
  2  无法完成评估（overallVerdict 为 cannot-assess：图产物不存在 / JSON 解析失败或结构损坏 / schemaVersion 过旧）`;

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

/** cannot-assess 场景下的占位六指标（未实际执行判定，語义为"无违规可报告"的空态，见 T034 实现说明）。 */
function buildCannotAssessReport(
  graphPath: string,
  reason: NonNullable<GraphQualityReport['cannotAssessReason']>,
  nextSteps: string[],
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
    freshness: { state: 'unknown-provenance', recordedSourceCommit: null, currentHead: null },
    overallVerdict: 'cannot-assess',
    cannotAssessReason: reason,
    nextSteps,
  };
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
    steps.push(
      `图产物记录的 sourceCommit（${report.freshness.recordedSourceCommit ?? 'null'}）与当前 HEAD（${report.freshness.currentHead ?? 'null'}）不一致，请重新运行 \`spectra batch --mode graph-only\` 重建图。`,
    );
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

/** 组装完整 GraphQualityReport（成功读取到合法图产物场景）。 */
function buildReport(graph: GraphJSON, graphPath: string, projectRoot: string): GraphQualityReport {
  const isIgnored = createIgnoreOracle(projectRoot);
  const structural = runGraphQualityChecks(graph, { isIgnored, getTestPatterns });
  const rawFreshness = evaluateFreshness(graph.graph.sourceCommit, projectRoot);
  // --json 契约稳定性：JSON.stringify 会丢弃值为 undefined 的 key（字段缺失场景）。
  // recordedSourceCommit 为 undefined（旧图产物字段缺失）与显式 null（非 git 仓库）在
  // FR-010 语义上等价（均判定 unknown-provenance），故此处归一化为 null，避免 --json
  // 输出因该字段整体消失而破坏契约（详见 graph-quality-report.schema.json 的 required）。
  const freshness: GraphFreshnessVerdict = {
    ...rawFreshness,
    recordedSourceCommit: rawFreshness.recordedSourceCommit ?? null,
  };
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

  return { ...base, nextSteps: buildNextSteps(base) };
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

/** 完整报告的人读文本渲染。 */
function formatReportText(report: GraphQualityReport): string {
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
      ` (recorded=${report.freshness.recordedSourceCommit ?? 'null'}, current=${report.freshness.currentHead ?? 'null'})`,
  ];

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
        } else {
          report = buildReport(parsed, graphPath, projectRoot);
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
    output = useJson ? JSON.stringify(report, null, 2) : formatReportText(report);
  }

  if (command.graphQualityOutput) {
    const fileFormat = command.graphQualityFormat ?? 'text';
    const fileContent =
      fileFormat === 'json'
        ? JSON.stringify(command.graphQualityStatus ? toStatusReport(report, graphExists) : report, null, 2)
        : command.graphQualityStatus
          ? formatStatusText(toStatusReport(report, graphExists))
          : formatReportText(report);
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
