#!/usr/bin/env node
/**
 * Feature 169 — Cohort C lift 复现验证（6 fixture × {A, C} × N=3 = 36 runs）
 *
 * 验证策略（spec SC-001 + SC-002）：
 *   1. 读 manifest.json 知 expected (fixtures, cohorts, repeat)
 *   2. 扫描 tests/baseline/swe-bench-lite/runs/<cohort>/<fixture>/run-*.json
 *   3. SC-001 数据完整性：
 *      - 完整跑：finalize_success == expected_runs
 *      - partial（stop-loss 触发）：检查 stop-loss-triggered.txt，落 caveat 不算 fail
 *   4. SC-001 mcpToolCallCount：cohort C runs 必须全 > 0（防 F164 倒退）
 *   5. SC-002 lift verdict 计算：
 *      - strong:    >=3 fixture C > A pass rate
 *      - weak:      aggregate C >= A pass rate
 *      - negative:  >=4 fixture C < A pass rate
 *      - ambiguous: 其他
 *      - SKIP:      完成 fixture < 4
 *   6. 输出 JSON report → /tmp/f169-verify-report.json
 *
 * 用法：
 *   node scripts/verify-feature-169.mjs --manifest /tmp/spectra-f169/manifest.json
 *   node scripts/verify-feature-169.mjs --manifest /tmp/spectra-f169/manifest.json --runs-dir tests/baseline/swe-bench-lite/runs --report-out /tmp/f169-verify-report.json
 *
 * Exit codes:
 *   0: SC-001 + SC-002 全 pass（含 partial 豁免）
 *   0: verdict = ambiguous 但有数据（输出 caveat）
 *   1: SC-001 数据缺口非 stop-loss 原因（异常）
 *   2: verdict = SKIP（partial < 4 fixture，不算 fail 但需人工决策）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─────────────────────────────────────
// argv
// ─────────────────────────────────────
function parseArgs(argv) {
  const out = {
    manifest: '/tmp/spectra-f169/manifest.json',
    runsDir: path.join(PROJECT_ROOT, 'tests/baseline/swe-bench-lite/runs'),
    reportOut: '/tmp/f169-verify-report.json',
    logDir: '/tmp/spectra-f169',
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--manifest' && argv[i + 1]) {
      out.manifest = argv[i + 1];
      out.logDir = path.dirname(out.manifest);
      i += 1;
    } else if (a === '--runs-dir' && argv[i + 1]) {
      out.runsDir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (a === '--report-out' && argv[i + 1]) {
      out.reportOut = argv[i + 1];
      i += 1;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      'verify-feature-169 — F169 cohort C lift 复现验证',
      '',
      'Usage:',
      '  node scripts/verify-feature-169.mjs --manifest <path>',
      '',
      'Options:',
      '  --manifest <path>   manifest.json 路径（默认 /tmp/spectra-f169/manifest.json）',
      '  --runs-dir <path>   runs/ 根目录（默认 tests/baseline/swe-bench-lite/runs）',
      '  --report-out <path> verify report 输出（默认 /tmp/f169-verify-report.json）',
      '  --help, -h          显示帮助',
      '',
    ].join('\n'),
  );
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

// ─────────────────────────────────────
// 加载 manifest
// ─────────────────────────────────────
if (!fs.existsSync(args.manifest)) {
  process.stderr.write(`[verify-169] FATAL: manifest 不存在: ${args.manifest}\n`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf-8'));
const { fixtures, cohorts, repeat, expected_runs: expectedRuns } = manifest;

if (!Array.isArray(fixtures) || !Array.isArray(cohorts) || typeof repeat !== 'number') {
  process.stderr.write('[verify-169] FATAL: manifest 字段缺失（fixtures/cohorts/repeat）\n');
  process.exit(1);
}

// ─────────────────────────────────────
// 扫描 runs
// ─────────────────────────────────────
/**
 * 解析单个 run-N.json 得到关键字段
 * @returns {{ found: true, oraclePass: bool, mcpToolCallCount: number|null, costUsd: number|null, claudeTimedOut: bool, graphErrorCode: string|null, status: 'success'|'fail'|'na'|null } | { found: false }}
 */
function parseRun(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const oracleResult = raw.oracleResult || {};
    const oraclePass = oracleResult.status === 'pass';
    const mcpToolCallCount =
      raw.productMetrics?.mcpToolCallCount ?? raw.mcpToolCallCount ?? null;
    const graphErrorCode = raw.graphInjection?.errorCode ?? null;
    return {
      found: true,
      oraclePass,
      mcpToolCallCount,
      costUsd: raw.costUsd ?? null,
      claudeTimedOut: raw.claudeTimedOut === true,
      graphErrorCode,
      status: oracleResult.status ?? null,
    };
  } catch (e) {
    return { found: false, error: e.message };
  }
}

const matrix = {}; // matrix[fixture][cohort] = { passes, total, mcpToolCallSum, anomalies, costSum }

let totalRunsFound = 0;
let totalCostUsd = 0;
const anomalies = [];

for (const fixture of fixtures) {
  matrix[fixture] = {};
  for (const cohort of cohorts) {
    const cell = { passes: 0, total: 0, mcpZeroCount: 0, costSum: 0 };
    const rundir = path.join(args.runsDir, cohort, fixture);
    if (fs.existsSync(rundir)) {
      const files = fs
        .readdirSync(rundir)
        .filter((f) => /^run-\d+\.json$/.test(f))
        .sort();
      for (const f of files) {
        const fp = path.join(rundir, f);
        const parsed = parseRun(fp);
        if (!parsed.found) {
          anomalies.push({ type: 'parse-error', fixture, cohort, file: fp, error: parsed.error });
          continue;
        }
        cell.total += 1;
        totalRunsFound += 1;
        if (parsed.oraclePass) cell.passes += 1;
        if (parsed.costUsd != null) {
          cell.costSum += parsed.costUsd;
          totalCostUsd += parsed.costUsd;
        }
        if (cohort === 'C' && parsed.mcpToolCallCount === 0) {
          cell.mcpZeroCount += 1;
          anomalies.push({
            type: 'mcp-call-zero',
            fixture,
            cohort,
            file: f,
            note: '可能 F164 fix 回归',
          });
        }
        if (cohort === 'C' && parsed.graphErrorCode) {
          anomalies.push({
            type: 'graph-injection-error',
            fixture,
            cohort,
            file: f,
            errorCode: parsed.graphErrorCode,
          });
        }
        if (parsed.claudeTimedOut) {
          anomalies.push({ type: 'claude-timeout', fixture, cohort, file: f });
        }
      }
    }
    matrix[fixture][cohort] = cell;
  }
}

// ─────────────────────────────────────
// SC-001: 数据完整性
// ─────────────────────────────────────
const stopLossFile = path.join(args.logDir, 'stop-loss-triggered.txt');
const stopLossTriggered = fs.existsSync(stopLossFile)
  ? fs.readFileSync(stopLossFile, 'utf-8').trim()
  : null;

const finalSummaryFile = path.join(args.logDir, 'final-summary.json');
const finalSummary = fs.existsSync(finalSummaryFile)
  ? JSON.parse(fs.readFileSync(finalSummaryFile, 'utf-8'))
  : null;

const completedFixtures = fixtures.filter((fx) =>
  cohorts.some((c) => matrix[fx][c].total > 0),
).length;

const sc001 = {
  expected_runs: expectedRuns,
  total_runs_found: totalRunsFound,
  completion_rate: expectedRuns > 0 ? totalRunsFound / expectedRuns : 0,
  stop_loss_triggered: stopLossTriggered,
  completed_fixtures: completedFixtures,
  mcp_zero_count: anomalies.filter((a) => a.type === 'mcp-call-zero').length,
  pass: false,
  caveat: null,
};

if (totalRunsFound === expectedRuns) {
  sc001.pass = true;
} else if (stopLossTriggered) {
  sc001.pass = true;
  sc001.caveat = `partial: n=${totalRunsFound}/${expectedRuns} due to stop-loss (${stopLossTriggered})`;
} else {
  sc001.pass = false;
  sc001.caveat = `non-stop-loss data gap: n=${totalRunsFound}/${expectedRuns}`;
}

// mcpToolCallCount > 0 检查（仅 cohort C）
if (sc001.mcp_zero_count > 0) {
  sc001.caveat = (sc001.caveat ? sc001.caveat + ' | ' : '') +
    `${sc001.mcp_zero_count} cohort C runs have mcpToolCallCount=0 (potential F164 regression)`;
}

// ─────────────────────────────────────
// SC-002: lift verdict
// ─────────────────────────────────────
function fmtRate(passes, total) {
  if (total === 0) return null;
  return passes / total;
}

const perFixture = {};
for (const fx of fixtures) {
  const a = matrix[fx]['A'] || { passes: 0, total: 0 };
  const c = matrix[fx]['C'] || { passes: 0, total: 0 };
  perFixture[fx] = {
    a_passes: a.passes,
    a_total: a.total,
    a_rate: fmtRate(a.passes, a.total),
    c_passes: c.passes,
    c_total: c.total,
    c_rate: fmtRate(c.passes, c.total),
    c_minus_a_passes: c.passes - a.passes,
  };
}

// 仅含两 cohort 都有数据的 fixture
const usableFixtures = fixtures.filter((fx) => {
  const r = perFixture[fx];
  return r.a_total > 0 && r.c_total > 0;
});

const aggregate = {
  a_passes: usableFixtures.reduce((acc, fx) => acc + perFixture[fx].a_passes, 0),
  a_total: usableFixtures.reduce((acc, fx) => acc + perFixture[fx].a_total, 0),
  c_passes: usableFixtures.reduce((acc, fx) => acc + perFixture[fx].c_passes, 0),
  c_total: usableFixtures.reduce((acc, fx) => acc + perFixture[fx].c_total, 0),
};
aggregate.a_rate = fmtRate(aggregate.a_passes, aggregate.a_total);
aggregate.c_rate = fmtRate(aggregate.c_passes, aggregate.c_total);

const cGtA = usableFixtures.filter((fx) => {
  const r = perFixture[fx];
  return r.c_rate != null && r.a_rate != null && r.c_rate > r.a_rate;
}).length;

const cLtA = usableFixtures.filter((fx) => {
  const r = perFixture[fx];
  return r.c_rate != null && r.a_rate != null && r.c_rate < r.a_rate;
}).length;

let verdict;
if (completedFixtures < 4) {
  verdict = 'SKIP';
} else if (cGtA >= 3) {
  verdict = 'strong';
} else if (aggregate.c_rate != null && aggregate.a_rate != null && aggregate.c_rate >= aggregate.a_rate) {
  verdict = 'weak';
} else if (cLtA >= 4) {
  verdict = 'negative';
} else {
  verdict = 'ambiguous';
}

const sc002 = {
  verdict,
  usable_fixtures: usableFixtures.length,
  count_c_gt_a: cGtA,
  count_c_lt_a: cLtA,
  per_fixture: perFixture,
  aggregate,
  // N=3 离散值 caveat
  disclaimer:
    'verdict 是 directional 启发式分类，不代表 statistical significance。' +
    '每 cell n=3 → per_fixture pass rate ∈ {0, 1/3, 2/3, 1}；±1 pass 即整票漂移。' +
    `aggregate n=${aggregate.a_total} vs ${aggregate.c_total} 不足以做 95% CI 推断。`,
};

// ─────────────────────────────────────
// 输出 JSON report
// ─────────────────────────────────────
const report = {
  feature: 'F169',
  timestamp: new Date().toISOString(),
  manifest_path: args.manifest,
  runs_dir: args.runsDir,
  sc_001: sc001,
  sc_002: sc002,
  anomalies,
  total_cost_usd_from_runs: totalCostUsd,
  final_summary_from_wrapper: finalSummary,
  matrix,
};

fs.mkdirSync(path.dirname(args.reportOut), { recursive: true });
fs.writeFileSync(args.reportOut, JSON.stringify(report, null, 2));

// ─────────────────────────────────────
// stdout 总结
// ─────────────────────────────────────
process.stdout.write('\n');
process.stdout.write('═══════════════════════════════════════\n');
process.stdout.write(`  F169 Verify Report\n`);
process.stdout.write('═══════════════════════════════════════\n');
process.stdout.write(`Runs:              ${totalRunsFound}/${expectedRuns} (${((sc001.completion_rate) * 100).toFixed(1)}%)\n`);
process.stdout.write(`Completed fixtures: ${completedFixtures}/${fixtures.length}\n`);
process.stdout.write(`Stop-loss:         ${stopLossTriggered ?? 'none'}\n`);
process.stdout.write(`MCP zero runs:     ${sc001.mcp_zero_count}\n`);
process.stdout.write(`Anomalies:         ${anomalies.length}\n`);
process.stdout.write(`Total cost (sum):  $${totalCostUsd.toFixed(2)}\n`);
process.stdout.write(`\n`);
process.stdout.write(`SC-001 (data completeness): ${sc001.pass ? '✅ PASS' : '❌ FAIL'}\n`);
if (sc001.caveat) process.stdout.write(`  caveat: ${sc001.caveat}\n`);
process.stdout.write(`\n`);
process.stdout.write(`SC-002 (lift verdict): ${verdict.toUpperCase()}\n`);
process.stdout.write(`  cohort A aggregate: ${aggregate.a_passes}/${aggregate.a_total} (${aggregate.a_rate != null ? (aggregate.a_rate * 100).toFixed(1) + '%' : 'n/a'})\n`);
process.stdout.write(`  cohort C aggregate: ${aggregate.c_passes}/${aggregate.c_total} (${aggregate.c_rate != null ? (aggregate.c_rate * 100).toFixed(1) + '%' : 'n/a'})\n`);
process.stdout.write(`  count_c_gt_a: ${cGtA} | count_c_lt_a: ${cLtA}\n`);
process.stdout.write(`\n`);
process.stdout.write(`Per-fixture matrix:\n`);
for (const fx of fixtures) {
  const r = perFixture[fx];
  const aStr = r.a_total > 0 ? `${r.a_passes}/${r.a_total}` : '—';
  const cStr = r.c_total > 0 ? `${r.c_passes}/${r.c_total}` : '—';
  const lift = r.a_total > 0 && r.c_total > 0
    ? (r.c_rate > r.a_rate ? '+' : (r.c_rate < r.a_rate ? '-' : '='))
    : '?';
  process.stdout.write(`  ${fx.padEnd(50)} A=${aStr.padEnd(5)} C=${cStr.padEnd(5)} [${lift}]\n`);
}
process.stdout.write(`\n`);
process.stdout.write(`Report written: ${args.reportOut}\n`);
process.stdout.write('═══════════════════════════════════════\n');

// ─────────────────────────────────────
// Exit
// ─────────────────────────────────────
if (!sc001.pass) {
  process.exit(1);
}
if (verdict === 'SKIP') {
  process.exit(2);
}
process.exit(0);
