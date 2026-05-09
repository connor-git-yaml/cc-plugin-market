#!/usr/bin/env node
/**
 * Feature 158 T-030 — ast-diff fuzzy match (FR-D-002 / EC-12)
 *
 * 用途：
 *   退化 oracle 路径 — 当裸机 pytest 不可行时，通过比对 actual diff 与 goldPatch
 *   的语义行 token multiset Jaccard 相似度来判定 task 是否 pass。
 *
 * 算法（plan.md §normalize 算法 + 修复后版本）：
 *   1. 读 expected / actual 两份 unified diff
 *   2. 按行分割，仅保留以单字符 `+` 或 `-` 开头的语义行；排除：
 *      - `--- a/...` / `+++ b/...` file header
 *      - `@@ -..,.. +..,.. @@` hunk header
 *      - 单空格开头 context line
 *      - 空行 / `\ No newline at end of file`
 *   3. 每行：trim 尾空白 / 去除 +/- 前缀 / 再 trim
 *   4. 拆 token（空白分词，保留重复）→ 构造 multiset M1（expected）/ M2（actual）
 *   5. 计算 |min(M1,M2)| / |max(M1,M2)| 即 multiset Jaccard
 *
 * 退出码：
 *   0：相似度 ≥ threshold/100（pass）
 *   1：相似度 <  threshold/100（fail）
 *   2：参数错误 / 文件读取失败
 *
 * 用法：
 *   node scripts/eval-diff-fuzzy-match.mjs --expected <gold.diff> --actual <actual.diff> [--threshold 60]
 *
 * 设计说明（plan.md §额外技术风险）：
 *   - 不依赖 process substitution `<(...)`（POSIX shell 兼容性）
 *   - actual 必须是文件路径，不接受 stdin（避免 buffer 截断）
 */

import * as fs from 'node:fs';

// ───────────────────────────────────────────────────────────
// argv 解析
// ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { expected: undefined, actual: undefined, threshold: 60 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--expected' && argv[i + 1]) {
      out.expected = argv[i + 1];
      i += 1;
    } else if (arg === '--actual' && argv[i + 1]) {
      out.actual = argv[i + 1];
      i += 1;
    } else if (arg === '--threshold' && argv[i + 1]) {
      const n = Number.parseFloat(argv[i + 1]);
      if (!Number.isNaN(n) && n >= 0 && n <= 100) out.threshold = n;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: node scripts/eval-diff-fuzzy-match.mjs --expected <file> --actual <file> [--threshold N]',
      '',
      '  --expected <file>   gold patch (.diff) 路径，必填',
      '  --actual <file>     actual diff 路径，必填',
      '  --threshold N       相似度阈值（0-100，默认 60）',
      '',
      'Exit codes:',
      '  0  similarity >= threshold (pass)',
      '  1  similarity <  threshold (fail)',
      '  2  argument / IO error',
      '',
    ].join('\n'),
  );
}

// ───────────────────────────────────────────────────────────
// normalize：从 unified diff 提取语义行 token multiset
// ───────────────────────────────────────────────────────────

/**
 * 提取语义行：仅保留以 + / - 开头但不是 file header 的行。
 * 返回去前缀 + trim 后的字符串数组。
 */
export function extractSemanticLines(diffText) {
  const lines = diffText.split('\n');
  const out = [];
  for (const raw of lines) {
    // 统一行尾（去掉 \r）
    const line = raw.replace(/\r$/, '');
    if (line.length === 0) continue;
    // 排除 file header
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    // 排除 hunk header
    if (line.startsWith('@@')) continue;
    // 排除 "\ No newline at end of file"
    if (line.startsWith('\\ ')) continue;
    // context line：单空格开头 + 至少 1 字符
    if (line.startsWith(' ')) continue;
    // 仅保留以 + 或 - 开头、且第二个字符不是 +/- 的语义行
    const ch0 = line.charAt(0);
    if (ch0 !== '+' && ch0 !== '-') continue;
    // 去前缀 + trim
    const stripped = line.slice(1).replace(/\s+$/, '').replace(/^\s+/, '');
    if (stripped.length === 0) continue;
    out.push(stripped);
  }
  return out;
}

/**
 * 把语义行拆为 token multiset（以 Map<string, count> 表示）。
 * 分词规则：按 \s+ 切分，保留所有非空 token（含重复）。
 */
export function toTokenMultiset(lines) {
  const m = new Map();
  for (const line of lines) {
    const tokens = line.split(/\s+/).filter((t) => t.length > 0);
    for (const t of tokens) {
      m.set(t, (m.get(t) ?? 0) + 1);
    }
  }
  return m;
}

/**
 * Multiset Jaccard：|min(M1,M2)| / |max(M1,M2)|
 * 业务定义：M1 / M2 同时为空 → 100%（完全匹配的边界情形）
 */
export function multisetJaccard(m1, m2) {
  if (m1.size === 0 && m2.size === 0) return 1.0;
  let minSum = 0;
  let maxSum = 0;
  const allKeys = new Set([...m1.keys(), ...m2.keys()]);
  for (const k of allKeys) {
    const a = m1.get(k) ?? 0;
    const b = m2.get(k) ?? 0;
    minSum += Math.min(a, b);
    maxSum += Math.max(a, b);
  }
  if (maxSum === 0) return 1.0;
  return minSum / maxSum;
}

/**
 * 顶层入口：返回 0~1 之间的相似度。
 */
export function computeSimilarity(expectedText, actualText) {
  const exp = extractSemanticLines(expectedText);
  const act = extractSemanticLines(actualText);
  const m1 = toTokenMultiset(exp);
  const m2 = toTokenMultiset(act);
  return multisetJaccard(m1, m2);
}

// ───────────────────────────────────────────────────────────
// 主入口（仅 CLI 模式触发）
// ───────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === true) {
    printHelp();
    process.exit(0);
  }
  if (args.expected === undefined || args.actual === undefined) {
    process.stderr.write('Error: --expected 和 --actual 都必填\n\n');
    printHelp();
    process.exit(2);
  }
  let expectedText;
  let actualText;
  try {
    expectedText = fs.readFileSync(args.expected, 'utf-8');
  } catch (err) {
    process.stderr.write(`Error: 读取 --expected 失败: ${args.expected}: ${err.message}\n`);
    process.exit(2);
  }
  try {
    actualText = fs.readFileSync(args.actual, 'utf-8');
  } catch (err) {
    process.stderr.write(`Error: 读取 --actual 失败: ${args.actual}: ${err.message}\n`);
    process.exit(2);
  }
  const similarity = computeSimilarity(expectedText, actualText);
  const pct = similarity * 100;
  const passed = pct >= args.threshold;
  process.stdout.write(
    JSON.stringify({
      similarity: Number(similarity.toFixed(6)),
      similarityPct: Number(pct.toFixed(2)),
      threshold: args.threshold,
      passed,
    }) + '\n',
  );
  process.exit(passed ? 0 : 1);
}

// 仅当作为 CLI 调用时执行 main（被测试 import 时不触发）
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('eval-diff-fuzzy-match.mjs');
if (isMain) {
  main();
}
