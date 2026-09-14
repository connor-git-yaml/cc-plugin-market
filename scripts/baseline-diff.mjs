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
 *   --ignore-quality        保留旗标（历史用法）；minor 版本不一致现在只提示不拒绝，major 不一致仍拒绝
 *
 * 退出码：
 *   0 = PASS（含黄色 warning）
 *   1 = FAIL（红色或 reproducibility 超阈值）
 *   2 = schemaVersion major 段不一致
 */

import * as fs from 'node:fs';

// ============================================================
// 阈值常量
// ============================================================

export const REGRESSION_THRESHOLDS = {
  'perf.totalWallMs': { yellowMin: 10, redMin: 20 },
  'perf.tokensInputPlusOutput': { yellowMin: 5, redMin: 15 },
  // M11 卡 E：perf.estimatedCostUsd 不再进回归门——它随缓存冷热变化（同 commit、token 数完全相同的两次采集实测 $6.98 ↔ $23.95），
  // 不是 token 的确定函数；token 数才是回归信号，成本只展示（见 DISPLAY_ONLY_DIMENSIONS）
  'output.graphNodeCount': { yellowMin: 10, redMin: 20, twoSided: true },
  'output.specSuccessRatio': { yellowBelow: 95, redBelow: 90 },
};

/** 只展示、不判定的维度（severity 恒 info）：成本随缓存冷热变化，删出阈值表后不能从报告里消失（delta 复审 W-Δ3） */
export const DISPLAY_ONLY_DIMENSIONS = ['perf.estimatedCostUsd', 'perf.reportedCostUsd'];

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
  // minor 不一致（1.1 vs 1.2）是升版流程的常态（CLAUDE.local.md「跑 diff 对比旧版本 fixture」），只提示不拒绝；
  // 字段定义可能不同（如 estimatedCostUsd 1.2 起优先取 CLI 真值），提示里说明
  if (oldV !== newV) {
    return { ok: true, warning: `schemaVersion ${oldV} vs ${newV}：跨 minor 版本比较，字段定义可能不同（1.2 起 estimatedCostUsd 优先取 CLI 自报成本）` };
  }
  void ignoreQuality;
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
  // 只展示的维度：算 Δ% 但 severity 恒 info，不参与 overall
  for (const field of DISPLAY_ONLY_DIMENSIONS) {
    const oldV = getValue(oldFx, field);
    const newV = getValue(newFx, field);
    const unavailable = oldV == null || newV == null;
    const deltaPct = unavailable || oldV === 0 ? null : Math.round(((newV - oldV) / Math.abs(oldV)) * 1000) / 10;
    results.push({ field, oldValue: oldV, newValue: newV, deltaPct, severity: unavailable ? 'na' : 'info' });
  }
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
  if (diff.schemaWarning) lines.push(`  note: ${diff.schemaWarning}`);
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
  return { ok: !hasRed, results, overall, ...(compat.warning ? { schemaWarning: compat.warning } : {}) };
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
