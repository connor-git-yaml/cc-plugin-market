/**
 * technical-debt.md 生成器
 *
 * 接收 DebtReport，产出满足 AC-3.1/AC-3.2/AC-3.3 的 Markdown 文本。
 */
import type {
  CodeDebtEntry,
  DebtDiagnostics,
  DebtKind,
  DebtMetrics,
  DebtReport,
  OpenQuestionEntry,
  TokenUsage,
} from '../types.js';

export interface BuildReportOptions {
  codeEntries: CodeDebtEntry[];
  openQuestions: OpenQuestionEntry[];
  diagnostics: DebtDiagnostics;
  metrics: DebtMetrics;
  tokenUsage: TokenUsage;
  durationMs: number;
  llmModel?: string;
  fallbackReason?: string;
  /** 扫描的语言集合，用于文档描述 */
  languages: string[];
}

/**
 * 生成 technical-debt.md 内容。
 */
export function buildDebtReportMarkdown(opts: BuildReportOptions): string {
  const { codeEntries, openQuestions, diagnostics, metrics, tokenUsage, durationMs, llmModel, fallbackReason } = opts;

  const isEmpty = codeEntries.length === 0 && openQuestions.length === 0;

  const frontmatter = [
    '---',
    'generated: true',
    `tokenUsage: {input: ${tokenUsage.input}, output: ${tokenUsage.output}}`,
    `durationMs: ${durationMs}`,
    `llmModel: ${llmModel ?? 'null'}`,
    `fallbackReason: ${fallbackReason ?? 'null'}`,
    '---',
    '',
  ].join('\n');

  const scanLine =
    '> 由 Spectra debt-intelligence pipeline 生成。本次扫描范围：' +
    `${diagnostics.filesScanned} 个源文件（${opts.languages.length ? opts.languages.join(', ') : 'n/a'}），` +
    `${diagnostics.docsScanned} 个 design-doc。`;

  const body: string[] = [];

  if (isEmpty) {
    body.push('# 技术债清单\n');
    body.push(scanLine + '\n');
    body.push('**项目当前未识别出技术债。**\n');
    body.push('- 代码注释债务：0 条');
    body.push('- Design-doc 开放问题：0 条\n');
    return frontmatter + body.join('\n') + '\n';
  }

  body.push('# 技术债清单\n');
  body.push(scanLine + '\n');

  // 概要
  body.push('## 概要\n');
  body.push(renderSummary(metrics, codeEntries));
  body.push('');

  // 代码注释债务
  body.push('## 代码注释债务\n');
  if (codeEntries.length === 0) {
    body.push('项目当前未识别出代码注释债务。\n');
  } else {
    body.push(renderCodeTable(codeEntries));
    body.push('');
  }

  // Design-doc 开放问题
  body.push('## Design-doc 开放问题\n');
  if (openQuestions.length === 0) {
    body.push('未识别出开放问题。\n');
  } else {
    body.push(renderOpenQuestionsByDoc(openQuestions));
    body.push('');
  }

  // 引用清单
  body.push('## 引用清单\n');
  body.push(renderReferences(codeEntries));
  body.push('');

  return frontmatter + body.join('\n') + '\n';
}

function renderSummary(metrics: DebtMetrics, entries: CodeDebtEntry[]): string {
  const ageBuckets = { '<30': 0, '30-90': 0, '90-180': 0, '>180': 0 };
  for (const e of entries) {
    if (e.ageDays < 30) ageBuckets['<30']++;
    else if (e.ageDays < 90) ageBuckets['30-90']++;
    else if (e.ageDays < 180) ageBuckets['90-180']++;
    else ageBuckets['>180']++;
  }
  const oldest = [...entries].sort((a, b) => b.ageDays - a.ageDays).slice(0, 5);
  const oldestLines = oldest.length > 0
    ? oldest
        .map((e) => `- ${e.kind} @ \`${e.filePath}:${e.line}\`（${e.ageDays} 天）— ${escapeText(e.text)}`)
        .join('\n')
    : '- （无）';

  const kindLine = (Object.keys(metrics.byKind) as DebtKind[])
    .map((k) => `${k} ${metrics.byKind[k]}`)
    .join('，');

  return [
    `- **代码注释债务**：${metrics.totalEntries} 条（${kindLine}）`,
    `- **Design-doc 开放问题**：${metrics.openQuestionsCount} 条`,
    `- **年龄分布**：< 30 天 ${ageBuckets['<30']} | 30-90 天 ${ageBuckets['30-90']} | 90-180 天 ${ageBuckets['90-180']} | > 180 天 ${ageBuckets['>180']}`,
    `- **代码债务密度**：${metrics.densityPerKloc.toFixed(2)} 条/kLOC`,
    `- **最老条目年龄**：${metrics.oldestAgeDays} 天`,
    '',
    '### 最老 5 条',
    '',
    oldestLines,
  ].join('\n');
}

function renderCodeTable(entries: CodeDebtEntry[]): string {
  const header = '| # | Kind | 文件 | 行 | 符号 | 作者 | 年龄(天) | 描述 |';
  const sep = '|---|------|------|-----|------|------|----------|------|';
  const rows = entries.map((e, i) =>
    `| ${i + 1} | ${e.kind} | \`${e.filePath}\` | ${e.line} | ${e.symbol ?? '—'} | ${e.author} | ${e.ageDays} | ${escapeText(e.text)} |`,
  );
  return [header, sep, ...rows].join('\n');
}

function renderOpenQuestionsByDoc(questions: OpenQuestionEntry[]): string {
  const byDoc = new Map<string, OpenQuestionEntry[]>();
  for (const q of questions) {
    let list = byDoc.get(q.docPath);
    if (!list) {
      list = [];
      byDoc.set(q.docPath, list);
    }
    list.push(q);
  }
  const blocks: string[] = [];
  const sortedDocs = [...byDoc.keys()].sort();
  for (const doc of sortedDocs) {
    blocks.push(`### ${doc}\n`);
    for (const q of byDoc.get(doc)!) {
      const topics = q.topics.length ? ` _[主题: ${q.topics.join(', ')}]_` : '';
      const src = q.source === 'rule' ? '(规则命中)' : '(LLM 判定)';
      blocks.push(`- **${q.headingPath}** ${src}${topics}`);
      blocks.push(`  > ${escapeText(q.snippet)}`);
    }
    blocks.push('');
  }
  return blocks.join('\n');
}

function renderReferences(entries: CodeDebtEntry[]): string {
  if (entries.length === 0) return '（无代码注释债务引用）';
  const byFile = new Map<string, CodeDebtEntry[]>();
  for (const e of entries) {
    let arr = byFile.get(e.filePath);
    if (!arr) {
      arr = [];
      byFile.set(e.filePath, arr);
    }
    arr.push(e);
  }
  const out: string[] = [];
  for (const file of [...byFile.keys()].sort()) {
    out.push(`- \`${file}\``);
    for (const e of byFile.get(file)!) {
      out.push(`  - 第 ${e.line} 行 — ${e.kind}: ${escapeText(e.text)}`);
    }
  }
  return out.join('\n');
}

/** 表格与 blockquote 兼容：移除换行，限长 200 字符 */
function escapeText(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
  return s.length <= 200 ? s : s.slice(0, 199) + '…';
}

/** 从 DebtReport 直接构建 markdown（便利 wrapper） */
export function buildDebtReportFromReport(
  report: DebtReport,
  languages: string[],
): string {
  return buildDebtReportMarkdown({
    codeEntries: report.codeEntries,
    openQuestions: report.openQuestions,
    diagnostics: report.diagnostics,
    metrics: report.metrics,
    tokenUsage: report.tokenUsage,
    durationMs: report.durationMs,
    llmModel: report.llmModel,
    fallbackReason: report.fallbackReason,
    languages,
  });
}
