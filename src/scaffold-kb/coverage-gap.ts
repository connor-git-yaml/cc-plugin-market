/**
 * F241 E1 — coverage-gap 聚合器（FR-014 / FR-015）
 *
 * 读 no-hit JSONL → 按 term 聚合 → 用**最小出现阈值**过滤 → backlog。
 *
 * 两条不可动摇的口径：
 * 1. **阈值判据是 `distinctQueries`（不同 `normalizedQueryHash` 数），不是行数**。
 *    同一句话查 N 遍只算 1，否则"把同一个问题问两遍"就能凭空造出一条缺口（C5 指出的绕过形态，EC-30）。
 * 2. **四种空态必须可区分**：`collection-disabled` / `no-data` / `data-unreadable` /
 *    `no-gap-above-threshold`。绝不允许采集关着、或数据存在但读不出来，却回一个空 backlog
 *    让读的人以为"没有文档缺口"（FR-014）。`data-unreadable` 是 v2 增加的第四态：
 *    只要有匹配文件读取失败且一条记录都没解析出来，就必须说"读不了"而不是"还没有"。
 *
 * `minOccurrenceThreshold` **不是**匿名性保证，只是治理信号的最低置信门槛，
 * 输出与文档中都不得使用 k-匿名 / k-anonymity 措辞（C5 更名裁决）。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_OCCURRENCE_THRESHOLD } from './governance-constants.js';
import { REDACTION_PLACEHOLDER_TOKENS } from './query-redaction.js';

/** 与 no-hit 记录文件同一命名口径（recorder 侧写入形态） */
const NOHIT_FILE_PATTERN = /^nohit-\d{8}\.jsonl$/;

export type CoverageGapStatus =
  | 'collection-disabled'
  | 'no-data'
  | 'data-unreadable'
  | 'no-gap-above-threshold'
  | 'ok';

export interface CoverageGapItem {
  term: string;
  /** 包含该 term 的记录总行数，仅作热度可见性，**不参与阈值判定** */
  occurrences: number;
  /** 包含该 term 的记录中不同 `normalizedQueryHash` 的个数，**阈值判据** */
  distinctQueries: number;
  tools: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface CoverageGapOutput {
  schemaVersion: 1;
  status: CoverageGapStatus;
  minOccurrenceThreshold: number;
  /** 有效解析的记录条数（含未产出条目的记录，用于区分 no-data 与 no-gap-above-threshold） */
  totalRecords: number;
  /** JSON 不可解析而跳过的行数（EC-18） */
  skippedLines: number;
  /**
   * 匹配到文件名但整份读取失败的**文件数**（权限不足 / 断链 / I/O 错误）。
   * 与 `skippedLines` 同级但语义不同：那是"行坏了"，这是"文件根本没读到"。
   * 存在读取失败却报 `no-data`，等于把"数据不可读"说成"还没有数据"（B2-3）。
   */
  readErrors: number;
  items: CoverageGapItem[];
}

export interface BuildCoverageGapOptions {
  /** no-hit JSONL 所在目录；采集关闭时该值不被读取 */
  nohitDir: string | null;
  /** 采集是否开启（由调用方传入 `resolveNoHitTelemetryDir() !== null` 的判定结果） */
  isCollectionEnabled: boolean;
}

interface NoHitRecord {
  terms: unknown;
  normalizedQueryHash: unknown;
  tool: unknown;
  timestamp: unknown;
}

/** 单 term 的聚合中间态 */
interface TermAccumulator {
  occurrences: number;
  hashes: Set<string>;
  tools: Set<string>;
  firstSeen: string;
  lastSeen: string;
}

function listNoHitFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => NOHIT_FILE_PATTERN.test(f))
      .sort();
  } catch {
    return []; // 目录不存在/不可读 → 等同无数据（EC-16）
  }
}

function parseRecord(line: string): NoHitRecord | null {
  try {
    const parsed = JSON.parse(line) as NoHitRecord;
    if (parsed === null || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.terms) || typeof parsed.normalizedQueryHash !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 剔除 redaction 占位符切词后的碎片，它们不是真实缺口词（EC-21） */
function meaningfulTerms(terms: unknown[]): string[] {
  return terms.filter(
    (t): t is string => typeof t === 'string' && t.length > 0 && !REDACTION_PLACEHOLDER_TOKENS.has(t),
  );
}

function accumulate(acc: Map<string, TermAccumulator>, record: NoHitRecord): void {
  const hash = record.normalizedQueryHash as string;
  const tool = typeof record.tool === 'string' ? record.tool : 'unknown';
  const timestamp = typeof record.timestamp === 'string' ? record.timestamp : '';
  for (const term of new Set(meaningfulTerms(record.terms as unknown[]))) {
    const existing = acc.get(term);
    if (existing === undefined) {
      acc.set(term, {
        occurrences: 1,
        hashes: new Set([hash]),
        tools: new Set([tool]),
        firstSeen: timestamp,
        lastSeen: timestamp,
      });
      continue;
    }
    existing.occurrences += 1;
    existing.hashes.add(hash);
    existing.tools.add(tool);
    if (timestamp !== '' && (existing.firstSeen === '' || timestamp < existing.firstSeen)) existing.firstSeen = timestamp;
    if (timestamp > existing.lastSeen) existing.lastSeen = timestamp;
  }
}

/**
 * 生成 coverage-gap backlog。
 *
 * 采集关闭时**不读盘**：目录里即便留着历史数据也一律回 `collection-disabled`，
 * 因为此刻的数据不代表当前采集状态，据此下"有/无缺口"的结论会误导读者。
 */
export function buildCoverageGapReport(opts: BuildCoverageGapOptions): CoverageGapOutput {
  const base = { schemaVersion: 1 as const, minOccurrenceThreshold: MIN_OCCURRENCE_THRESHOLD };
  if (!opts.isCollectionEnabled || opts.nohitDir === null) {
    return { ...base, status: 'collection-disabled', totalRecords: 0, skippedLines: 0, readErrors: 0, items: [] };
  }

  const acc = new Map<string, TermAccumulator>();
  let totalRecords = 0;
  let skippedLines = 0;
  let readErrors = 0;
  for (const file of listNoHitFiles(opts.nohitDir)) {
    let text: string;
    try {
      text = readFileSync(join(opts.nohitDir, file), 'utf-8');
    } catch {
      // 单文件不可读不影响其余（与损坏行同样宽容），但必须**计数**——
      // 静默 continue 会让"全部文件都读不了"伪装成 no-data（B2-3）
      readErrors += 1;
      continue;
    }
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue;
      const record = parseRecord(line);
      if (record === null) {
        skippedLines += 1;
        continue;
      }
      totalRecords += 1;
      accumulate(acc, record);
    }
  }

  const items = [...acc.entries()]
    .filter(([, v]) => v.hashes.size >= MIN_OCCURRENCE_THRESHOLD)
    .map(([term, v]) => ({
      term,
      occurrences: v.occurrences,
      distinctQueries: v.hashes.size,
      tools: [...v.tools].sort(),
      firstSeen: v.firstSeen,
      lastSeen: v.lastSeen,
    }))
    // 先按 distinctQueries 降序（信号强度），同分按 term 稳定排序
    .sort((a, b) => b.distinctQueries - a.distinctQueries || a.term.localeCompare(b.term));

  let status: CoverageGapStatus;
  // data-unreadable 先于 no-data：有文件读不出来时，"尚无记录"是错误结论（B2-3）
  if (totalRecords === 0 && readErrors > 0) status = 'data-unreadable';
  else if (totalRecords === 0) status = 'no-data';
  else if (items.length === 0) status = 'no-gap-above-threshold';
  else status = 'ok';

  return { ...base, status, totalRecords, skippedLines, readErrors, items };
}

const STATUS_EXPLANATION: Record<CoverageGapStatus, string> = {
  'collection-disabled': '采集未开启（未设 SPECTRA_KB_NOHIT_TELEMETRY）——**无从判断有无文档缺口**',
  'no-data': '采集已开启但尚无 no-hit 记录',
  'data-unreadable': '存在 no-hit 记录文件但**全部读取失败**（权限/断链/IO）——**无从判断有无文档缺口**',
  'no-gap-above-threshold': `有 no-hit 记录，但没有 term 达到最小出现阈值（distinctQueries ≥ ${MIN_OCCURRENCE_THRESHOLD}）`,
  ok: '以下 term 达到最小出现阈值，建议补充对应文档',
};

/** 渲染报告。markdown 形态在任何状态下都先打出 status，杜绝"空表 = 没有缺口"的误读 */
export function formatCoverageGapReport(report: CoverageGapOutput, format: 'json' | 'markdown'): string {
  if (format === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  const lines = [
    '# KB coverage-gap backlog',
    '',
    `- status: \`${report.status}\` — ${STATUS_EXPLANATION[report.status]}`,
    `- minOccurrenceThreshold: ${report.minOccurrenceThreshold}（阈值判据 = distinctQueries，同一查询重复 N 次只计 1）`,
    `- totalRecords: ${report.totalRecords} / skippedLines: ${report.skippedLines} / readErrors: ${report.readErrors}`,
    '',
  ];
  if (report.items.length === 0) {
    lines.push('（无条目）');
    return `${lines.join('\n')}\n`;
  }
  lines.push('| term | distinctQueries | occurrences | tools | firstSeen | lastSeen |');
  lines.push('|------|-----------------|-------------|-------|-----------|----------|');
  for (const i of report.items) {
    lines.push(
      `| ${i.term} | ${i.distinctQueries} | ${i.occurrences} | ${i.tools.join(', ')} | ${i.firstSeen} | ${i.lastSeen} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
