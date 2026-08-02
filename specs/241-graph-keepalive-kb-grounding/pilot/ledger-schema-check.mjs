#!/usr/bin/env node
/**
 * F241 pilot — ledger 轻量 schema 校验（批 0 preflight，T001 / P-C2）
 *
 * 职责边界：**只做结构校验**，不重算 M-1 计数。M-1 重算是批 4 `ledger-verify.mjs` 的职责，
 * 二者不重复——preflight 要能在 implement 开始前跑、在没有报告数字可比对时也给出确定结论。
 *
 * 校验三件事：
 *   (a) `predicted-impact-set.md` 已存在（M-2 预测集必须先于 implement 冻结，SC-015 的前置）
 *   (b) ledger 每行字段集合完整、`seq` 单调递增
 *   (c) 迁移条款（P-C2 point 3）：schema 定稿前的既有行 `timestamp === null` 且 `timestampNote` 非空；
 *       此后新增行必须带真实 ISO 8601 `timestamp`（禁止伪造事后时间戳，也禁止继续留 null）
 *
 * 用法：node specs/241-graph-keepalive-kb-grounding/pilot/ledger-schema-check.mjs
 * 退出码：0 = 全部通过；1 = 存在违规（逐条打印）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PILOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = path.join(PILOT_DIR, 'ledger.jsonl');
const PREDICTED_SET_PATH = path.join(PILOT_DIR, 'predicted-impact-set.md');

/**
 * schema 定稿前写入的行数。这些行允许 `timestamp: null`（真实调用时刻已不可重建），
 * 但必须带 `timestampNote` 说明；序号 ≥ 该值的行一律要求真实 ISO timestamp。
 */
export const LEGACY_ROW_COUNT = 11;

/** 每行必须存在的字段（不含迁移期才有的 timestampNote 与可选的 crossCheckedWrong/caller）。 */
export const REQUIRED_FIELDS = [
  'seq',
  'segment',
  'target',
  'tool',
  'category',
  'countsTowardM1',
  'note',
  'graphState',
  'timestamp',
];

/** `seq` 形如 `"<segment>-<index>"`，用元组比较避免 "1-10" < "1-9" 的字典序陷阱。 */
function parseSeq(seq) {
  if (typeof seq !== 'string') return null;
  const match = /^(\d+)-(\d+)$/.exec(seq);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function seqGreaterThan(current, previous) {
  if (previous === null) return true;
  if (current[0] !== previous[0]) return current[0] > previous[0];
  return current[1] > previous[1];
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * @param {{ ledgerText: string, predictedSetExists: boolean }} input
 * @returns {string[]} 违规描述列表（空数组 = 全部通过）
 */
export function checkLedger({ ledgerText, predictedSetExists }) {
  const violations = [];

  if (!predictedSetExists) {
    violations.push('(a) predicted-impact-set.md 不存在——M-2 预测集必须在 implement 前冻结');
  }

  const lines = ledgerText.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    violations.push('(b) ledger.jsonl 为空');
    return violations;
  }
  if (lines.length < LEGACY_ROW_COUNT) {
    violations.push(
      `(b) ledger.jsonl 只有 ${lines.length} 行，少于迁移基线 ${LEGACY_ROW_COUNT} 行——既有记账不得被删除`,
    );
  }

  let previousSeq = null;
  lines.forEach((line, index) => {
    const where = `第 ${index + 1} 行`;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      violations.push(`(b) ${where} JSON 不可解析：${String(error)}`);
      return;
    }

    for (const field of REQUIRED_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(row, field)) {
        violations.push(`(b) ${where}（seq=${row.seq ?? '?'}）缺字段 ${field}`);
      }
    }

    const parsed = parseSeq(row.seq);
    if (parsed === null) {
      violations.push(`(b) ${where} seq 形态非法：${JSON.stringify(row.seq)}`);
    } else if (!seqGreaterThan(parsed, previousSeq)) {
      violations.push(`(b) ${where} seq=${row.seq} 未相对上一行单调递增`);
    } else {
      previousSeq = parsed;
    }

    // (c) 迁移条款：按行序而非按内容判定归属，避免新行也偷偷留 null
    if (index < LEGACY_ROW_COUNT) {
      if (row.timestamp !== null) {
        violations.push(`(c) ${where}（迁移行 seq=${row.seq}）timestamp 应为 null，实为 ${JSON.stringify(row.timestamp)}`);
      }
      if (typeof row.timestampNote !== 'string' || row.timestampNote.trim().length === 0) {
        violations.push(`(c) ${where}（迁移行 seq=${row.seq}）缺非空 timestampNote`);
      }
    } else if (typeof row.timestamp !== 'string' || !ISO_8601.test(row.timestamp)) {
      violations.push(
        `(c) ${where}（seq=${row.seq}）必须带真实 ISO 8601 timestamp，实为 ${JSON.stringify(row.timestamp)}`,
      );
    }
  });

  return violations;
}

function main() {
  let ledgerText;
  try {
    ledgerText = fs.readFileSync(LEDGER_PATH, 'utf-8');
  } catch (error) {
    process.stderr.write(`ledger.jsonl 读取失败：${String(error)}\n`);
    return 1;
  }

  const violations = checkLedger({
    ledgerText,
    predictedSetExists: fs.existsSync(PREDICTED_SET_PATH),
  });

  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`${violation}\n`);
    process.stderr.write(`\nledger schema 校验失败：${violations.length} 条违规\n`);
    return 1;
  }

  const rowCount = ledgerText.split('\n').filter((line) => line.trim().length > 0).length;
  process.stdout.write(`ledger schema 校验通过：${rowCount} 行，predicted-impact-set.md 存在\n`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exitCode = main();
}
