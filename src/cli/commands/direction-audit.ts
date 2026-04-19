/**
 * direction-audit 子命令 handler
 * 读取 graph.json 对每条跨模块边进行方向分类审计
 * 支持 --snapshot / --compare-snapshot 作为 SC-006 CI regression guard
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { CLICommand } from '../utils/parse-args.js';

// ============================================================
// 内部类型定义
// ============================================================

/** 方向审计结论 */
type DirectionResult = 'correct' | 'suspicious' | 'incorrect' | 'skipped';

/** 推测错误来源阶段 */
type SuspectedStage = 'ast-extraction' | 'panoramic-builder' | 'cross-reference-inference';

/** 单条边的审计结果（符合 direction-audit-report-schema.json） */
interface DirectionAuditEdge {
  sourceId: string;
  targetId: string;
  relation: string;
  result: DirectionResult;
  confidence: number;
  rationale: string;
  suspectedStage?: SuspectedStage;
}

/** 根因分解（符合 schema 中的 rootCauseBreakdown） */
interface RootCauseBreakdown {
  astExtraction: number;
  panoramicBuilder: number;
  crossReferenceInference: number;
  unknown: number;
}

/** 完整审计报告（符合 direction-audit-report-schema.json） */
interface DirectionAuditReport {
  graphPath: string;
  generatedAt: string;
  totalEdges: number;
  summary: {
    correct: number;
    suspicious: number;
    incorrect: number;
    skipped: number;
  };
  edges: DirectionAuditEdge[];
  rootCauseBreakdown: RootCauseBreakdown;
}

/** CI 快照文件格式 */
interface AuditSnapshot {
  generatedAt: string;
  graphPath: string;
  incorrectCount: number;
  /** incorrect 边按 sourceId+targetId 排序后的 SHA-256 前 32 位 */
  incorrectHash: string;
}

/** graph.json 边的原始格式（宽松类型，仅取必要字段） */
interface RawGraphEdge {
  source: string;
  target: string;
  relation?: string;
  confidence?: string | number;
  confidenceScore?: number;
  metadata?: Record<string, unknown>;
}

/** graph.json 节点的原始格式 */
interface RawGraphNode {
  id: string;
  kind?: string;
  metadata?: Record<string, unknown>;
}

/** graph.json 顶层结构（宽松类型） */
interface RawGraphJSON {
  directed?: boolean;
  nodes?: RawGraphNode[];
  links?: RawGraphEdge[];
  graph?: {
    generatedAt?: string;
    sources?: string[];
  };
}

// ============================================================
// 帮助文本
// ============================================================

const DIRECTION_AUDIT_HELP = `spectra direction-audit — 依赖方向自查工具

用法:
  spectra direction-audit [--graph <path>] [--output <path>] [--format json|text]
  spectra direction-audit --snapshot <path>
  spectra direction-audit --compare-snapshot <path>

说明:
  读取 graph.json 并对每条跨模块边进行方向分类：
  - correct:    有 AST import 证据支撑的边（置信度 EXTRACTED）
  - suspicious: 无直接 import 证据（LLM 推断或 cross-reference 推断）
  - incorrect:  AST 证据与边方向矛盾（反向 import 存在）
  - skipped:    无充分数据判断（如纯文档节点）

选项:
  --graph <path>            graph.json 路径（默认: specs/_meta/graph.json）
  --output <path>           报告写入路径（默认: 仅 stdout）
  --format json|text        输出格式（默认: text）
  --snapshot <path>         生成 CI baseline 快照并写入文件
  --compare-snapshot <path> 对比快照；incorrect 增加时以 exit 1 退出
  --help                    显示帮助信息

退出码:
  0  成功 / incorrect 未增加
  1  incorrect 增加（compare-snapshot 模式）/ 文件读取失败`;

// ============================================================
// 核心审计逻辑
// ============================================================

/**
 * 解析 graph.json 中 confidence 字段，统一为 ConfidenceLevel 字符串
 * graph.json 可能存放字符串（'EXTRACTED'/'INFERRED'/'AMBIGUOUS'）或数值分数
 */
function parseConfidenceLevel(edge: RawGraphEdge): string {
  if (typeof edge.confidence === 'string') {
    return edge.confidence.toUpperCase();
  }
  // 数值形式：>= 0.9 视为 EXTRACTED，>= 0.6 视为 INFERRED，其余 AMBIGUOUS
  const score = edge.confidenceScore ?? (typeof edge.confidence === 'number' ? edge.confidence : 0);
  if (score >= 0.9) return 'EXTRACTED';
  if (score >= 0.6) return 'INFERRED';
  return 'AMBIGUOUS';
}

/**
 * 解析 confidence 数值分数（0.0-1.0）
 * 用于 DirectionAuditEdge.confidence 字段
 */
function parseConfidenceScore(edge: RawGraphEdge): number {
  if (typeof edge.confidenceScore === 'number') return Math.min(1, Math.max(0, edge.confidenceScore));
  if (typeof edge.confidence === 'number') return Math.min(1, Math.max(0, edge.confidence));
  // 字符串 confidence level 映射为数值
  const level = typeof edge.confidence === 'string' ? edge.confidence.toUpperCase() : '';
  if (level === 'EXTRACTED') return 0.95;
  if (level === 'INFERRED') return 0.65;
  return 0.3;
}

/**
 * 判断边的 source 和 target 是否跨模块
 * 简单策略：比较 source/target 的顶级路径前缀（第一个 "/" 前部分）
 * 完全匹配的视为同模块
 */
function isCrossModuleEdge(source: string, target: string): boolean {
  // 若 source 与 target 完全相同则非跨模块（自环）
  if (source === target) return false;
  // 取路径第一段作为模块标识
  const getModule = (id: string): string => {
    const normalized = id.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[0] ?? id;
  };
  const srcModule = getModule(source);
  const tgtModule = getModule(target);
  // 若第一段相同则视为同模块（src/a/foo → src/a/bar 同属 src 模块）
  // 若 ID 不含路径分隔符，则均视为独立模块（跨模块）
  return srcModule !== tgtModule || (!source.includes('/') && !target.includes('/') && source !== target);
}

/**
 * 对单条边进行方向分类
 * 分类规则：
 * - 若节点为纯文档类型（spec/document/diagram）→ skipped
 * - 若 confidence 为 EXTRACTED → correct（有 AST 证据）
 * - 若 confidence 为 INFERRED 且 relation 含 cross-reference → suspicious（cross-reference-inference 阶段）
 * - 若 confidence 为 INFERRED → suspicious（panoramic-builder 阶段）
 * - 否则 → suspicious（unknown 来源）
 *
 * incorrect 的判断需要"反向 AST import 存在"的机制，
 * 当前 Phase 仅通过 metadata 标记检测（若 metadata.reversedBy 存在则视为 incorrect）
 */
function classifyEdge(
  edge: RawGraphEdge,
  nodeKindMap: Map<string, string>,
): DirectionAuditEdge {
  const sourceId = edge.source;
  const targetId = edge.target;
  const relation = edge.relation ?? 'unknown';
  const confidenceScore = parseConfidenceScore(edge);
  const confidenceLevel = parseConfidenceLevel(edge);

  // 检查 metadata 中是否有 reversedBy 标记（表示反向 AST import 存在 → incorrect）
  const hasReversal = Boolean(edge.metadata?.['reversedBy']);

  // 纯文档节点（spec/document/diagram）无法做 AST 方向审计 → skipped
  const srcKind = nodeKindMap.get(sourceId) ?? 'module';
  const tgtKind = nodeKindMap.get(targetId) ?? 'module';
  const isDocOnly = (srcKind === 'spec' || srcKind === 'document' || srcKind === 'diagram') &&
                    (tgtKind === 'spec' || tgtKind === 'document' || tgtKind === 'diagram');

  if (isDocOnly) {
    return {
      sourceId,
      targetId,
      relation,
      result: 'skipped',
      confidence: confidenceScore,
      rationale: '两侧均为文档节点，无 AST import 数据可供方向审计',
    };
  }

  // incorrect：metadata 明确标记了反向 import
  if (hasReversal) {
    const reversedBy = String(edge.metadata?.['reversedBy'] ?? '');
    return {
      sourceId,
      targetId,
      relation,
      result: 'incorrect',
      confidence: confidenceScore,
      rationale: `AST 证据显示依赖方向相反：${reversedBy} 实际 import ${sourceId}，但图中边为 ${sourceId} → ${targetId}`,
      suspectedStage: 'ast-extraction',
    };
  }

  // correct：EXTRACTED 置信度 → 有 AST import 证据
  if (confidenceLevel === 'EXTRACTED') {
    return {
      sourceId,
      targetId,
      relation,
      result: 'correct',
      confidence: confidenceScore,
      rationale: 'AST import 证据支撑（EXTRACTED 置信度）',
    };
  }

  // suspicious：cross-reference 推断
  const isCrossRef = relation.includes('cross-reference') || relation.includes('cross_reference') ||
    (typeof edge.metadata?.['source'] === 'string' && (edge.metadata['source'] as string).includes('cross-reference'));
  if (isCrossRef) {
    return {
      sourceId,
      targetId,
      relation,
      result: 'suspicious',
      confidence: confidenceScore,
      rationale: '边来自 cross-reference 推断，无直接 AST import 证据',
      suspectedStage: 'cross-reference-inference',
    };
  }

  // suspicious：INFERRED（LLM 语义推断）
  if (confidenceLevel === 'INFERRED') {
    return {
      sourceId,
      targetId,
      relation,
      result: 'suspicious',
      confidence: confidenceScore,
      rationale: '边来自 LLM 语义推断（INFERRED 置信度），无直接 AST import 证据',
      suspectedStage: 'panoramic-builder',
    };
  }

  // 其余（AMBIGUOUS / 未知）→ suspicious
  return {
    sourceId,
    targetId,
    relation,
    result: 'suspicious',
    confidence: confidenceScore,
    rationale: `弱置信度（${confidenceLevel}），无直接 AST import 证据`,
    suspectedStage: 'panoramic-builder',
  };
}

/**
 * 计算 incorrect 边集合的稳定 SHA-256 哈希（前 32 位十六进制）
 * 按 sourceId+targetId 排序后序列化
 */
function computeIncorrectHash(incorrectEdges: DirectionAuditEdge[]): string {
  const sorted = [...incorrectEdges]
    .sort((a, b) => {
      const ka = `${a.sourceId}\0${a.targetId}`;
      const kb = `${b.sourceId}\0${b.targetId}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .map((e) => `${e.sourceId}|${e.targetId}|${e.relation}`)
    .join('\n');
  return crypto.createHash('sha256').update(sorted).digest('hex').slice(0, 32);
}

/**
 * 主审计函数：读取 graph.json，对所有跨模块边分类，返回报告
 */
function auditGraph(graphPath: string): DirectionAuditReport {
  const raw = fs.readFileSync(graphPath, 'utf-8');
  const graphJson = JSON.parse(raw) as RawGraphJSON;

  const links: RawGraphEdge[] = graphJson.links ?? [];
  const nodes: RawGraphNode[] = graphJson.nodes ?? [];

  // 建立 nodeId → kind 映射，供方向分类使用
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    nodeKindMap.set(node.id, node.kind ?? 'module');
  }

  // 仅审计跨模块边
  const crossModuleLinks = links.filter((e) => isCrossModuleEdge(e.source, e.target));

  // 对每条跨模块边分类
  const auditedEdges: DirectionAuditEdge[] = crossModuleLinks.map((edge) =>
    classifyEdge(edge, nodeKindMap),
  );

  // 汇总统计
  const summary = { correct: 0, suspicious: 0, incorrect: 0, skipped: 0 };
  const rootCauseBreakdown: RootCauseBreakdown = {
    astExtraction: 0,
    panoramicBuilder: 0,
    crossReferenceInference: 0,
    unknown: 0,
  };

  for (const edge of auditedEdges) {
    summary[edge.result]++;
    if (edge.result === 'incorrect' || edge.result === 'suspicious') {
      switch (edge.suspectedStage) {
        case 'ast-extraction':
          rootCauseBreakdown.astExtraction++;
          break;
        case 'panoramic-builder':
          rootCauseBreakdown.panoramicBuilder++;
          break;
        case 'cross-reference-inference':
          rootCauseBreakdown.crossReferenceInference++;
          break;
        default:
          // incorrect 但无 suspectedStage 时记入 unknown
          if (edge.result === 'incorrect') rootCauseBreakdown.unknown++;
      }
    }
  }

  return {
    graphPath,
    generatedAt: new Date().toISOString(),
    totalEdges: auditedEdges.length,
    summary,
    edges: auditedEdges,
    rootCauseBreakdown,
  };
}

// ============================================================
// 输出格式化
// ============================================================

/** 生成 text 格式报告 */
function formatText(report: DirectionAuditReport): string {
  const lines: string[] = [
    'Direction Audit Report',
    '======================',
    `Graph:     ${report.graphPath}`,
    `Generated: ${report.generatedAt}`,
    `Total cross-module edges: ${report.totalEdges}`,
    `  correct:    ${report.summary.correct} (AST-grounded)`,
    `  suspicious: ${report.summary.suspicious} (no direct AST evidence)`,
    `  incorrect:  ${report.summary.incorrect} (AST contradicts direction)`,
    `  skipped:    ${report.summary.skipped} (doc-only nodes, no AST data)`,
  ];

  if (report.summary.incorrect > 0) {
    lines.push('');
    lines.push('Incorrect edges (direction contradicted by AST):');
    for (const edge of report.edges.filter((e) => e.result === 'incorrect')) {
      lines.push(`  [INCORRECT] ${edge.sourceId} → ${edge.targetId}`);
      lines.push(`              relation: ${edge.relation}`);
      lines.push(`              rationale: ${edge.rationale}`);
    }
  }

  if (report.summary.suspicious > 0) {
    // 仅显示前 10 条 suspicious（避免输出过长）
    const suspiciousList = report.edges.filter((e) => e.result === 'suspicious').slice(0, 10);
    lines.push('');
    lines.push(`Suspicious edges (first ${suspiciousList.length} of ${report.summary.suspicious}):`);
    for (const edge of suspiciousList) {
      lines.push(`  [SUSPICIOUS] ${edge.sourceId} → ${edge.targetId}`);
      lines.push(`               relation: ${edge.relation}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// 快照操作
// ============================================================

/** 生成并写入 CI baseline 快照 */
function writeSnapshot(report: DirectionAuditReport, snapshotPath: string): void {
  const incorrectEdges = report.edges.filter((e) => e.result === 'incorrect');
  const snapshot: AuditSnapshot = {
    generatedAt: report.generatedAt,
    graphPath: report.graphPath,
    incorrectCount: report.summary.incorrect,
    incorrectHash: computeIncorrectHash(incorrectEdges),
  };
  const dir = path.dirname(snapshotPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  console.log(`[direction-audit] 快照已写入: ${snapshotPath}`);
  console.log(`  incorrect count: ${snapshot.incorrectCount}`);
  console.log(`  incorrect hash:  ${snapshot.incorrectHash}`);
}

/**
 * 对比当前报告与快照
 * @returns true = 通过（incorrect 未增加），false = 失败（incorrect 增加）
 */
function compareSnapshot(report: DirectionAuditReport, snapshotPath: string): boolean {
  const raw = fs.readFileSync(snapshotPath, 'utf-8');
  const snapshot = JSON.parse(raw) as AuditSnapshot;

  const currentIncorrect = report.summary.incorrect;
  const baselineIncorrect = snapshot.incorrectCount;

  console.log(`[direction-audit] 对比快照: ${snapshotPath}`);
  console.log(`  baseline incorrect: ${baselineIncorrect}`);
  console.log(`  current  incorrect: ${currentIncorrect}`);

  if (currentIncorrect > baselineIncorrect) {
    console.error(
      `[direction-audit] 回归检测：incorrect 边数从 ${baselineIncorrect} 增加到 ${currentIncorrect}，存在依赖方向倒置引入！`,
    );
    return false;
  }

  if (currentIncorrect < baselineIncorrect) {
    console.log(`[direction-audit] incorrect 边数减少（${baselineIncorrect} → ${currentIncorrect}），建议更新 baseline 快照`);
  } else {
    console.log(`[direction-audit] incorrect 边数无变化，通过`);
  }
  return true;
}

// ============================================================
// CLI 入口
// ============================================================

/**
 * 执行 direction-audit 子命令
 * 完整流程：读取 graph.json → 审计边方向 → 输出报告 → 可选快照操作
 */
export async function runDirectionAuditCommand(command: CLICommand): Promise<void> {
  if (command.help) {
    console.log(DIRECTION_AUDIT_HELP);
    return;
  }

  // 解析参数
  const graphPath = command.directionAuditGraph ?? path.join(process.cwd(), 'specs', '_meta', 'graph.json');
  const outputPath = command.directionAuditOutput;
  const format = command.directionAuditFormat ?? 'text';
  const snapshotPath = command.directionAuditSnapshot;
  const compareSnapshotPath = command.directionAuditCompareSnapshot;

  // 检查 graph.json 是否存在
  if (!fs.existsSync(graphPath)) {
    console.error(`[direction-audit] graph.json 不存在: ${graphPath}`);
    console.error('请先运行 `spectra graph` 生成 graph.json');
    process.exitCode = 1;
    return;
  }

  // 执行审计
  let report: DirectionAuditReport;
  try {
    report = auditGraph(graphPath);
  } catch (err) {
    console.error(
      `[direction-audit] 审计失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
    return;
  }

  // 快照写入模式（--snapshot）
  if (snapshotPath) {
    try {
      writeSnapshot(report, snapshotPath);
    } catch (err) {
      console.error(
        `[direction-audit] 快照写入失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
    }
    return;
  }

  // 快照对比模式（--compare-snapshot）
  if (compareSnapshotPath) {
    if (!fs.existsSync(compareSnapshotPath)) {
      console.error(`[direction-audit] 快照文件不存在: ${compareSnapshotPath}`);
      console.error('请先运行 `spectra direction-audit --snapshot <path>` 生成 baseline');
      process.exitCode = 1;
      return;
    }
    try {
      const passed = compareSnapshot(report, compareSnapshotPath);
      if (!passed) {
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(
        `[direction-audit] 快照对比失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
    }
    return;
  }

  // 常规输出模式
  let output: string;
  if (format === 'json') {
    output = JSON.stringify(report, null, 2);
  } else {
    output = formatText(report);
  }

  // 写入文件（若指定 --output）
  if (outputPath) {
    try {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(outputPath, output, 'utf-8');
      console.log(`[direction-audit] 报告已写入: ${outputPath}`);
    } catch (err) {
      console.error(
        `[direction-audit] 报告写入失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
      return;
    }
  }

  // 始终输出到 stdout
  console.log(output);
}
