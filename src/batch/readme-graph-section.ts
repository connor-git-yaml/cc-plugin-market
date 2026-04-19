/**
 * Feature 127 — README.md 图摘要提取器
 *
 * 读取 `_meta/graph.json` 和 `_meta/GRAPH_REPORT.md`，提取：
 * - 代码核心抽象（按节点 degree 降序 Top N）
 * - 意外连接（Surprising Connections 前 M 条）
 *
 * 设计原则：
 * - 产物缺失时优雅降级（返回 null，README 展示占位文案）
 * - 不改变图分析算法，只 read-only 提取
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GodNodeHighlight {
  id: string;
  label: string;
  degree: number;
  kind: string;
}

export interface SurprisingConnection {
  source: string;
  target: string;
  relation: string;
  crossCommunity: boolean;
  confidence: string;
}

export interface GraphHighlights {
  /** top N 核心抽象（按 degree 降序）；空数组表示图为空 */
  godNodes: GodNodeHighlight[];
  /** 前 M 条意外连接；空数组表示未检测到 */
  surprisingConnections: SurprisingConnection[];
  /** graph.json 是否存在 */
  hasGraph: boolean;
  /** GRAPH_REPORT.md 是否存在 */
  hasGraphReport: boolean;
}

/**
 * 从 batch 输出目录中提取图摘要信息
 *
 * @param outputDir - batch 输出根目录（含 `_meta/` 子目录）
 * @param opts - top N / M 上限（默认 5 / 3，符合 spec FR-001/FR-002）
 */
export function extractGraphHighlights(
  outputDir: string,
  opts: { topGodNodes?: number; topSurprising?: number } = {},
): GraphHighlights {
  const topGodNodes = opts.topGodNodes ?? 5;
  const topSurprising = opts.topSurprising ?? 3;

  const metaDir = path.join(outputDir, '_meta');
  const graphJsonPath = path.join(metaDir, 'graph.json');
  const reportPath = path.join(metaDir, 'GRAPH_REPORT.md');

  const result: GraphHighlights = {
    godNodes: [],
    surprisingConnections: [],
    hasGraph: false,
    hasGraphReport: false,
  };

  // 读 graph.json 拿 Top N degree
  if (fs.existsSync(graphJsonPath)) {
    result.hasGraph = true;
    try {
      const raw = fs.readFileSync(graphJsonPath, 'utf-8');
      const graph = JSON.parse(raw) as {
        nodes?: Array<{ id: string; label: string; kind: string; metadata?: { degree?: number } }>;
      };
      const withDegree = (graph.nodes ?? [])
        .map((n) => ({
          id: n.id,
          label: n.label,
          degree: Number(n.metadata?.degree ?? 0),
          kind: n.kind,
        }))
        .filter((n) => n.degree > 0);
      withDegree.sort((a, b) => b.degree - a.degree);
      result.godNodes = withDegree.slice(0, topGodNodes);
    } catch {
      // 解析失败保留 hasGraph=true 但 godNodes=[]
    }
  }

  // 读 GRAPH_REPORT.md 解析 Surprising Connections 表格
  if (fs.existsSync(reportPath)) {
    result.hasGraphReport = true;
    try {
      const text = fs.readFileSync(reportPath, 'utf-8');
      result.surprisingConnections = parseSurprisingConnections(text, topSurprising);
    } catch {
      // 解析失败保留空数组
    }
  }

  return result;
}

/**
 * 从 GRAPH_REPORT.md 文本中解析 "Surprising Connections" 节的表格
 * 表格列：Source | Target | 关系类型 | 跨社区 | 置信度 | 评分
 */
export function parseSurprisingConnections(
  reportText: string,
  limit: number,
): SurprisingConnection[] {
  const sectionMatch = reportText.split(/^##\s+Surprising Connections\s*$/m)[1];
  if (!sectionMatch) return [];

  // 取到下一个 ## 标题之前
  const sectionBody = sectionMatch.split(/^##\s+/m)[0] ?? '';
  if (sectionBody.includes('未检测到')) return [];

  const rows: SurprisingConnection[] = [];
  for (const line of sectionBody.split('\n')) {
    if (!line.startsWith('|')) continue;
    // 跳过表头和分隔行
    if (/\|\s*Source\s*\|/.test(line)) continue;
    if (/^\|[\s|:-]+\|$/.test(line)) continue;

    const cells = line.split('|').map((c) => c.trim());
    // 期望 8 个 cell（前后 pipe 各产生一个空 cell + 6 数据 cell）
    if (cells.length < 8) continue;
    const [, source, target, relation, crossStr, confidence] = cells;
    if (!source || !target) continue;

    rows.push({
      source: source.replace(/^`|`$/g, ''),
      target: target.replace(/^`|`$/g, ''),
      relation: relation ?? '',
      crossCommunity: crossStr === '是',
      confidence: confidence ?? '',
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

/**
 * 渲染 README 的"代码核心抽象"块
 * FR-001 / FR-003
 */
export function renderGodNodesBlock(highlights: GraphHighlights): string[] {
  const lines: string[] = [];
  lines.push('## 代码核心抽象');
  lines.push('');

  if (!highlights.hasGraph) {
    lines.push('_图谱未生成，运行 `spectra batch` 后可用。_');
    lines.push('');
    return lines;
  }

  if (highlights.godNodes.length === 0) {
    lines.push('_本项目规模较小，未识别到显著核心抽象节点。_');
    lines.push('');
    return lines;
  }

  lines.push(`> 按图谱度数排序的 Top ${highlights.godNodes.length} 节点，完整列表见 [架构图谱分析报告](${BATCH_META_ANCHOR_REPORT}#god-nodes)。`);
  lines.push('');
  lines.push('| 节点 | 类型 | 度数 |');
  lines.push('|------|------|------|');
  for (const n of highlights.godNodes) {
    lines.push(`| [\`${n.label}\`](${BATCH_META_ANCHOR_REPORT}#god-nodes) | ${n.kind} | ${n.degree} |`);
  }
  lines.push('');
  return lines;
}

/**
 * 渲染 README 的"意外连接"块
 * FR-002 / FR-003
 */
export function renderSurprisingBlock(highlights: GraphHighlights): string[] {
  const lines: string[] = [];
  lines.push('## 意外连接');
  lines.push('');

  if (!highlights.hasGraphReport) {
    lines.push('_图谱报告未生成，运行 `spectra batch` 后可用。_');
    lines.push('');
    return lines;
  }

  if (highlights.surprisingConnections.length === 0) {
    lines.push('_未检测到跨社区的意外连接（所有依赖都在同一模块聚类内）。_');
    lines.push('');
    return lines;
  }

  lines.push(`> 跨社区或低置信度的关系，完整列表见 [架构图谱分析报告](${BATCH_META_ANCHOR_REPORT}#surprising-connections)。`);
  lines.push('');
  lines.push('| 源 | 目标 | 关系 | 跨社区 |');
  lines.push('|----|------|------|--------|');
  for (const e of highlights.surprisingConnections) {
    const cross = e.crossCommunity ? '是' : '否';
    lines.push(`| [\`${e.source}\`](${BATCH_META_ANCHOR_REPORT}#surprising-connections) | \`${e.target}\` | ${e.relation} | ${cross} |`);
  }
  lines.push('');
  return lines;
}

/**
 * 渲染 README 的"图查询能力"入口指引（FR-004）
 */
export function renderGraphQueryHint(): string[] {
  return [
    '### 图查询能力（MCP）',
    '',
    'Spectra 提供 5 个 MCP 图查询工具，可在支持 MCP 的 AI 助手（Claude Code、Cline 等）中直接调用：',
    '',
    '- `graph_query`：按关键词查询相关模块和子图（"认证模块"、"数据库连接"）',
    '- `graph_node`：查询指定节点的详情和邻居',
    '- `graph_path`：查询两个节点之间的最短依赖路径',
    '- `graph_community`：列出某个社区（模块聚类）的所有节点',
    '- `graph_god_nodes`：识别图谱中度数最高的枢纽节点',
    '',
    '详见各插件的 [SKILL.md](../../plugins/spectra/skills/spectra-batch/SKILL.md)。',
    '',
  ];
}

const BATCH_META_ANCHOR_REPORT = '_meta/GRAPH_REPORT.md';
