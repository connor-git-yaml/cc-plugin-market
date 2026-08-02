#!/usr/bin/env node
/**
 * F241 pilot — M-1 重算与报告一致性校验（批 4，T067 / SC-016）
 *
 * 为什么需要它：`report.md` 里的 M-1 数字是人写的，人会算错。批 3 的 Codex 审查（W4）
 * 已经在 M-2 上抓到过一次真实算术错误。本脚本把 M-1 那一组数字变成**可机器重算**的，
 * 报告一改就得重跑，数字对不上直接非 0 退出。
 *
 * 它治得了什么、治不了什么（这句必须留着，别删）：
 *   - 治得了：算术漂移、抄错、改报告忘改台账。
 *   - **治不了**：台账本身是自报的。类别是我（编排器）当场判的，
 *     判错或漏记，机器重算只会忠实地把错误再算一遍。
 *
 * 职责边界：结构校验复用批 0 的 `ledger-schema-check.mjs::checkLedger`（同一份实现，
 * 不再写第二套）；本脚本在其之上追加三件事——
 *   (1) 分段内 `seq` 单调；(2) M-1 四分类计数、命中率、交叉核对错误数重算；
 *   (3) 与 `report.md` 标记区块内的表格逐项比对。
 *
 * 用法：node specs/241-graph-keepalive-kb-grounding/pilot/ledger-verify.mjs
 * 退出码：0 = 全部一致；1 = 存在违规或数字不一致（逐条打印）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkLedger, LEGACY_ROW_COUNT } from './ledger-schema-check.mjs';

const PILOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = path.join(PILOT_DIR, 'ledger.jsonl');
const PREDICTED_SET_PATH = path.join(PILOT_DIR, 'predicted-impact-set.md');
const REPORT_PATH = path.join(PILOT_DIR, 'report.md');

/** M-1 冻结口径的四个类别（measurement-design.md，取数后不得增删）。 */
export const M1_CATEGORIES = ['hit', 'fuzzy-hit', 'miss-empty', 'miss-structural'];

/** 计入命中的两类。`fuzzy-hit` 虽多花一次往返但最终可用，按冻结口径计入分子。 */
const HIT_CATEGORIES = ['hit', 'fuzzy-hit'];

/** 「symbol-not-found 后按 fuzzy 候选重查」的首次调用，并入后继行，不单独计类。 */
const MERGED_CATEGORY_PATTERN = /^merged-into-(\d+-\d+)$/;

/** report.md 中被本脚本比对的表格区块标记。 */
const TABLE_BEGIN = '<!-- ledger-verify:m1:begin -->';
const TABLE_END = '<!-- ledger-verify:m1:end -->';

function parseSeq(seq) {
  const match = /^(\d+)-(\d+)$/.exec(String(seq));
  return match === null ? null : { segment: Number(match[1]), index: Number(match[2]) };
}

function formatRate(numerator, denominator) {
  if (denominator === 0) return 'n/a';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function parseLedgerRows(ledgerText) {
  return ledgerText
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * 分段内 `seq` 单调 + 类别取值合法性。
 * 与 `checkLedger` 的全局单调检查互补：这里额外锁住「段号只增不减」与
 * 「计入 M-1 的行类别必须落在冻结的四分类内」。
 * @param {object[]} rows
 * @returns {string[]}
 */
export function checkSegmentsAndCategories(rows) {
  const violations = [];
  const knownSeqs = new Set(rows.map((row) => String(row.seq)));
  const lastIndexBySegment = new Map();
  let maxSegmentSeen = -1;

  rows.forEach((row, position) => {
    const where = `第 ${position + 1} 行（seq=${row.seq}）`;
    const parsed = parseSeq(row.seq);
    if (parsed === null) {
      violations.push(`[seq] ${where} 形态非法`);
      return;
    }

    if (parsed.segment < maxSegmentSeen) {
      violations.push(`[seq] ${where} 段号回退（此前已出现段 ${maxSegmentSeen}）`);
    }
    maxSegmentSeen = Math.max(maxSegmentSeen, parsed.segment);

    const lastIndex = lastIndexBySegment.get(parsed.segment);
    if (lastIndex !== undefined && parsed.index <= lastIndex) {
      violations.push(`[seq] ${where} 段内序号未单调递增（上一条 ${parsed.segment}-${lastIndex}）`);
    }
    lastIndexBySegment.set(parsed.segment, parsed.index);

    if (typeof row.countsTowardM1 !== 'boolean') {
      violations.push(`[category] ${where} countsTowardM1 必须是布尔值`);
    }

    const merged = MERGED_CATEGORY_PATTERN.exec(String(row.category));
    if (merged !== null) {
      if (row.countsTowardM1 === true) {
        violations.push(`[category] ${where} merged-into 行不得计入 M-1`);
      }
      if (!knownSeqs.has(merged[1])) {
        violations.push(`[category] ${where} merged-into 指向不存在的 seq=${merged[1]}`);
      }
      return;
    }

    if (!M1_CATEGORIES.includes(row.category)) {
      violations.push(
        `[category] ${where} 类别 ${JSON.stringify(row.category)} 不在冻结四分类内`,
      );
    }
  });

  return violations;
}

/**
 * 从台账重算 M-1 全部对外声称的数字。
 * @param {object[]} rows
 */
export function recomputeM1(rows) {
  const counted = rows.filter((row) => row.countsTowardM1 === true);

  const byCategory = Object.fromEntries(M1_CATEGORIES.map((category) => [category, 0]));
  for (const row of counted) {
    if (byCategory[row.category] !== undefined) byCategory[row.category] += 1;
  }

  const total = counted.length;
  const nominalHits = HIT_CATEGORIES.reduce((sum, category) => sum + byCategory[category], 0);

  // 第五态：解析成功、返回非错误，但内容经 grep 交叉核对被证伪。四分类表达不了它。
  const crossCheckedWrong = counted.filter((row) => row.crossCheckedWrong === true);
  const wrongAmongHits = crossCheckedWrong.filter((row) =>
    HIT_CATEGORIES.includes(row.category),
  ).length;
  const undetermined = counted.filter((row) => row.crossCheckedWrong === null).length;

  // `.mjs` 侧的结构性封顶（O-5）：图的 TS/JS walker 白名单不收 .mjs，命中率恒为 0。
  const mjsRows = counted.filter((row) => String(row.target).includes('.mjs'));
  const mjsHits = mjsRows.filter((row) => HIT_CATEGORIES.includes(row.category)).length;

  return {
    hit: byCategory.hit,
    'fuzzy-hit': byCategory['fuzzy-hit'],
    'miss-empty': byCategory['miss-empty'],
    'miss-structural': byCategory['miss-structural'],
    total,
    nominalHits,
    nominalRate: formatRate(nominalHits, total),
    crossCheckedWrong: crossCheckedWrong.length,
    wrongAmongHits,
    undetermined,
    trustedHits: nominalHits - wrongAmongHits,
    trustedRate: formatRate(nominalHits - wrongAmongHits, total),
    mjsTotal: mjsRows.length,
    mjsHits,
    mjsRate: formatRate(mjsHits, mjsRows.length),
  };
}

/** 表格标签 → 重算结果字段。标签即人在报告里读到的那一行，保证机器校验的是同一个数。 */
const LABEL_TO_FIELD = new Map([
  ['hit', 'hit'],
  ['fuzzy-hit', 'fuzzy-hit'],
  ['miss-empty', 'miss-empty'],
  ['miss-structural', 'miss-structural'],
  ['计入 M-1 的调用总数', 'total'],
  ['名义命中数（hit + fuzzy-hit）', 'nominalHits'],
  ['名义命中率', 'nominalRate'],
  ['经交叉核对证实结果错误', 'crossCheckedWrong'],
  ['其中被四分类计为 hit / fuzzy-hit', 'wrongAmongHits'],
  ['其中人工无法判定（该为空还是漏报）', 'undetermined'],
  ['修正后可信命中数', 'trustedHits'],
  ['修正后可信命中率', 'trustedRate'],
  ['.mjs target 调用数', 'mjsTotal'],
  ['.mjs target 命中数', 'mjsHits'],
  ['.mjs 命中率（结构性封顶）', 'mjsRate'],
]);

function normalizeCell(cell) {
  return cell
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/^[—\-\s]+/, '')
    .trim();
}

/**
 * 解析 report.md 标记区块内的 `| 标签 | 值 |` 表格。
 * @param {string} reportText
 * @returns {{ values: Map<string,string>, violations: string[] }}
 */
export function parseReportTable(reportText) {
  const violations = [];
  const values = new Map();

  const begin = reportText.indexOf(TABLE_BEGIN);
  const end = reportText.indexOf(TABLE_END);
  if (begin === -1 || end === -1 || end < begin) {
    violations.push(`[report] 找不到成对的 ${TABLE_BEGIN} / ${TABLE_END} 标记区块`);
    return { values, violations };
  }

  const block = reportText.slice(begin + TABLE_BEGIN.length, end);
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined).split('|');
    if (cells.length < 2) continue;
    const label = normalizeCell(cells[0]);
    if (!LABEL_TO_FIELD.has(label)) continue;
    values.set(label, normalizeCell(cells[1]));
  }

  for (const label of LABEL_TO_FIELD.keys()) {
    if (!values.has(label)) violations.push(`[report] 标记区块内缺少「${label}」一行`);
  }

  return { values, violations };
}

/**
 * @param {{ ledgerText: string, reportText: string, predictedSetExists: boolean }} input
 * @returns {{ violations: string[], metrics: object }}
 */
export function verify({ ledgerText, reportText, predictedSetExists }) {
  const violations = [
    ...checkLedger({ ledgerText, predictedSetExists }),
  ];

  let rows;
  try {
    rows = parseLedgerRows(ledgerText);
  } catch (error) {
    violations.push(`[ledger] 解析失败：${String(error)}`);
    return { violations, metrics: null };
  }

  violations.push(...checkSegmentsAndCategories(rows));

  const metrics = recomputeM1(rows);
  const { values, violations: reportViolations } = parseReportTable(reportText);
  violations.push(...reportViolations);

  for (const [label, field] of LABEL_TO_FIELD) {
    if (!values.has(label)) continue;
    const reported = values.get(label);
    const recomputed = String(metrics[field]);
    if (reported !== recomputed) {
      violations.push(
        `[mismatch] 「${label}」：report.md 写 ${JSON.stringify(reported)}，台账重算 ${JSON.stringify(recomputed)}`,
      );
    }
  }

  return { violations, metrics };
}

function main() {
  let ledgerText;
  let reportText;
  try {
    ledgerText = fs.readFileSync(LEDGER_PATH, 'utf-8');
  } catch (error) {
    process.stderr.write(`ledger.jsonl 读取失败：${String(error)}\n`);
    return 1;
  }
  try {
    reportText = fs.readFileSync(REPORT_PATH, 'utf-8');
  } catch (error) {
    process.stderr.write(
      `report.md 读取失败（比对目标尚未就绪，这是 T067 先写脚本阶段的预期红态）：${String(error)}\n`,
    );
    return 1;
  }

  const { violations, metrics } = verify({
    ledgerText,
    reportText,
    predictedSetExists: fs.existsSync(PREDICTED_SET_PATH),
  });

  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`${violation}\n`);
    process.stderr.write(`\nM-1 重算校验失败：${violations.length} 条违规\n`);
    return 1;
  }

  const rowCount = parseLedgerRows(ledgerText).length;
  process.stdout.write(
    [
      `ledger-verify 通过：${rowCount} 行台账（迁移基线 ${LEGACY_ROW_COUNT} 行），report.md 逐项一致`,
      `  四分类：hit ${metrics.hit} / fuzzy-hit ${metrics['fuzzy-hit']} / miss-empty ${metrics['miss-empty']} / miss-structural ${metrics['miss-structural']}（计入 ${metrics.total}）`,
      `  名义命中率 ${metrics.nominalRate}；交叉核对证实错误 ${metrics.crossCheckedWrong}（其中计为命中 ${metrics.wrongAmongHits}）；修正后可信命中率 ${metrics.trustedRate}`,
      `  .mjs 侧 ${metrics.mjsHits}/${metrics.mjsTotal} = ${metrics.mjsRate}（O-5 结构性封顶）`,
      '',
    ].join('\n'),
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fs.realpathSync(path.resolve(process.argv[1])) ===
    fs.realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exitCode = main();
}
