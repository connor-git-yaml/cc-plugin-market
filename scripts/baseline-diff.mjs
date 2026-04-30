#!/usr/bin/env node
/**
 * Feature 143 — baseline diff
 *
 * 对比两份 fixture（old / new），按维度算 delta，按阈值染色。
 *
 * 用法：
 *   node scripts/baseline-diff.mjs <old.json> <new.json> [options]
 *
 * Options:
 *   --mode=regression       默认；用 REGRESSION_THRESHOLDS 判定（黄/红）
 *   --mode=reproducibility  用 REPRODUCIBILITY_THRESHOLDS 判定（任何超阈值即 FAIL）
 *   --format=json|text      输出格式（默认 text）
 *   --ignore-quality        允许 schemaVersion 1.0 与 1.1 跨比 perf（不比 quality 字段）
 *
 * 退出码：
 *   0 = PASS（含黄色 warning）
 *   1 = FAIL（红色或 reproducibility 超阈值）
 *   2 = schemaVersion mismatch（major 段不同 + 未指定 --ignore-quality）
 */

import * as fs from 'node:fs';

// ============================================================
// 阈值常量
// ============================================================

export const REGRESSION_THRESHOLDS = {
  'perf.totalWallMs': { yellowMin: 10, redMin: 20 },
  'perf.tokensInputPlusOutput': { yellowMin: 5, redMin: 15 },
  'perf.estimatedCostUsd': { yellowMin: 10, redMin: 20 },
  'output.graphNodeCount': { yellowMin: 10, redMin: 20, twoSided: true },
  'output.specSuccessRatio': { yellowBelow: 95, redBelow: 90 },
};

export const REPRODUCIBILITY_THRESHOLDS = {
  'perf.totalWallMs': { redMin: 5, twoSided: true },
  'perf.tokensInputPlusOutput': { redMin: 3, twoSided: true },
  'output.graphNodeCount': { redMin: 1, twoSided: true },
  'output.graphEdgeCount': { redMin: 1, twoSided: true },
  'output.specSuccessCount': { exactMatch: true },
};

// ============================================================
// argv
// ============================================================

export function parseArgs(argv) {
  const args = {
    oldPath: null,
    newPath: null,
    mode: 'regression',
    format: 'text',
    ignoreQuality: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--mode=')) args.mode = a.slice('--mode='.length);
    else if (a === '--mode') args.mode = argv[++i];
    else if (a.startsWith('--format=')) args.format = a.slice('--format='.length);
    else if (a === '--format') args.format = argv[++i];
    else if (a === '--ignore-quality') args.ignoreQuality = true;
    else if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    else rest.push(a);
  }
  if (rest.length !== 2) throw new Error(`expected exactly 2 positional args (old, new), got ${rest.length}`);
  [args.oldPath, args.newPath] = rest;
  if (!['regression', 'reproducibility'].includes(args.mode)) {
    throw new Error(`--mode must be regression|reproducibility, got: ${args.mode}`);
  }
  if (!['json', 'text'].includes(args.format)) {
    throw new Error(`--format must be json|text, got: ${args.format}`);
  }
  return args;
}

// ============================================================
// 加载 + 校验
// ============================================================

export function loadFixture(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

export function checkSchemaCompat(oldFx, newFx, ignoreQuality) {
  const oldV = oldFx.schemaVersion ?? '0.0';
  const newV = newFx.schemaVersion ?? '0.0';
  const [oldMajor] = oldV.split('.');
  const [newMajor] = newV.split('.');
  if (oldMajor !== newMajor) {
    return { ok: false, reason: `major version mismatch: ${oldV} vs ${newV}` };
  }
  if (oldV !== newV && !ignoreQuality) {
    // minor diff allowed only with --ignore-quality (避免 quality 字段错位)
    return { ok: false, reason: `minor version mismatch ${oldV} vs ${newV}; pass --ignore-quality to compare perf only` };
  }
  return { ok: true };
}

// ============================================================
// 维度提取（dotted-path getter）
// ============================================================

function getValue(obj, dottedPath) {
  if (dottedPath === 'perf.tokensInputPlusOutput') {
    const i = obj?.perf?.tokensInput;
    const o = obj?.perf?.tokensOutput;
    return i != null && o != null ? i + o : null;
  }
  if (dottedPath === 'output.specSuccessRatio') {
    const s = obj?.output?.specSuccessCount;
    const t = obj?.output?.specModuleCount;
    return s != null && t != null && t > 0 ? Math.round((s / t) * 1000) / 10 : null;
  }
  return dottedPath.split('.').reduce((acc, k) => (acc == null ? null : acc[k]), obj);
}

// ============================================================
// 比较
// ============================================================

export function compareDimensions(oldFx, newFx, thresholdsTable, mode) {
  const results = [];
  for (const [field, t] of Object.entries(thresholdsTable)) {
    const oldV = getValue(oldFx, field);
    const newV = getValue(newFx, field);
    if (oldV == null || newV == null) {
      results.push({ field, oldValue: oldV, newValue: newV, deltaPct: null, severity: 'na' });
      continue;
    }
    // 处理除零：oldValue=0 时无法算百分比
    let deltaPct;
    let severity;
    if (oldV === 0) {
      if (newV === 0) {
        deltaPct = 0;
        severity = mode === 'reproducibility' ? 'green' : 'green';
      } else {
        // 0 → 非 0，无法算百分比；regression 视为可疑（red），reproducibility 视为 FAIL
        deltaPct = null;
        severity = mode === 'reproducibility' ? 'red' : 'red';
      }
    } else {
      deltaPct = Math.round(((newV - oldV) / oldV) * 1000) / 10;
      severity = scoreSeverity(deltaPct, newV, t, mode);
    }
    results.push({ field, oldValue: oldV, newValue: newV, deltaPct, severity });
  }
  return results;
}

function scoreSeverity(deltaPct, newValue, t, mode) {
  if (mode === 'reproducibility') {
    if (t.exactMatch) return deltaPct === 0 ? 'green' : 'red';
    const abs = Math.abs(deltaPct);
    if (abs > t.redMin) return 'red';
    return 'green';
  }
  // regression
  if (t.yellowBelow != null) {
    // ratio 类（specSuccessRatio）：越低越糟
    if (newValue < t.redBelow) return 'red';
    if (newValue < t.yellowBelow) return 'yellow';
    return 'green';
  }
  const abs = Math.abs(deltaPct);
  if (t.twoSided) {
    if (abs >= t.redMin) return 'red';
    if (abs >= t.yellowMin) return 'yellow';
    return 'green';
  }
  // 单边（涨为劣）
  if (deltaPct >= t.redMin) return 'red';
  if (deltaPct >= t.yellowMin) return 'yellow';
  return 'green';
}

// ============================================================
// 输出
// ============================================================

export function formatJson(diff) {
  return JSON.stringify(diff, null, 2);
}

const COLOR = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
};

export function formatText(diff, oldPath, newPath, mode, { useColor = false } = {}) {
  const lines = [];
  lines.push(`baseline-diff (mode=${mode})`);
  lines.push(`  old: ${oldPath}`);
  lines.push(`  new: ${newPath}`);
  lines.push('');
  lines.push('  field                                    old           new           Δ%        severity');
  lines.push('  ---------------------------------------- ------------- ------------- --------- --------');
  for (const r of diff.results) {
    const f = r.field.padEnd(40);
    const oldS = String(r.oldValue ?? 'null').padEnd(13);
    const newS = String(r.newValue ?? 'null').padEnd(13);
    const dS = (r.deltaPct == null ? 'n/a' : `${r.deltaPct >= 0 ? '+' : ''}${r.deltaPct}%`).padEnd(9);
    const sev = r.severity;
    const color = useColor ? (COLOR[sev] ?? '') : '';
    const reset = color ? COLOR.reset : '';
    lines.push(`  ${f} ${oldS} ${newS} ${dS} ${color}${sev}${reset}`);
  }
  lines.push('');
  lines.push(`overall: ${diff.overall}`);
  return lines.join('\n');
}

// ============================================================
// 入口
// ============================================================

export function diff({ oldPath, newPath, mode, ignoreQuality }) {
  const oldFx = loadFixture(oldPath);
  const newFx = loadFixture(newPath);
  const compat = checkSchemaCompat(oldFx, newFx, ignoreQuality);
  if (!compat.ok) {
    return { ok: false, schemaError: compat.reason, results: [], overall: 'schema-mismatch' };
  }
  const table = mode === 'reproducibility' ? REPRODUCIBILITY_THRESHOLDS : REGRESSION_THRESHOLDS;
  const results = compareDimensions(oldFx, newFx, table, mode);
  const hasRed = results.some((r) => r.severity === 'red');
  const hasYellow = results.some((r) => r.severity === 'yellow');
  const overall = hasRed ? 'fail' : hasYellow ? 'warn' : 'pass';
  return { ok: !hasRed, results, overall };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = diff(args);
  if (result.schemaError) {
    console.error(`[baseline-diff] schema error: ${result.schemaError}`);
    process.exit(2);
  }
  const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;
  const output =
    args.format === 'json'
      ? formatJson(result)
      : formatText(result, args.oldPath, args.newPath, args.mode, { useColor });
  console.log(output);
  process.exit(result.ok ? 0 : 1);
}

const isCliEntry = process.argv[1]?.endsWith('baseline-diff.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[baseline-diff] error: ${err.message}`);
    process.exit(1);
  });
}
