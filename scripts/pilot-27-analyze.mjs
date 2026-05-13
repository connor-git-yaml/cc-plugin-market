#!/usr/bin/env node
// Feature 162 T050 — Pilot 27 跑批后分析脚本（v2，适配 actual run-*.json schema）
//
// Schema discovered post pilot 27 start (Phase A/B/C canonical schema 迁移
// 未完整覆盖 eval-mcp-augmented 写入路径)：
//   - r.perf.wallMs (not wallClockMs)
//   - r.oracleResult ("pass"/"fail"/"error")  -- not r.oracle.passed
//   - r.status ("success"/"failed")
//   - r.inheritance_status (顶层，not r.perf.inheritanceStatus)
//   - r.perf.subAgentMeta.{specDriverVersion, frontmatterTools, confidence, loadSource}
//   - r.productMetrics.{commits, filesChanged, uncommittedChanges, diffStat}
//   - r.claudeCliVersion / r.claudeExit / r.claudeTimedOut
//   - r.costUsd (always null in current schema — fall back to group log parse)
// 缺失字段（spec FR-037 canonical schema 设计但代码未落地）：
//   - tokensInput/tokensOutput, mcpToolCalls[], judges.{opus/glm/kimi/codex}.{ok,score}
//   → 留 Feature 163+ 修；本 analyze 跳过这些字段
//
// Usage: node scripts/pilot-27-analyze.mjs
// 输出: specs/162-codex-driver-glm-judge-eval/pilot-27-analysis.json + console

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '');
const RUNS_DIR = path.join(REPO_ROOT, 'tests/baseline/swe-bench-lite/runs');
const PILOT_LOG_DIR = '/tmp/spectra-pilot-27';
const OUT_PATH = path.join(REPO_ROOT, 'specs/162-codex-driver-glm-judge-eval/pilot-27-analysis.json');

const COHORTS = ['A', 'B', 'C'];
const FIXTURES = ['SWE-L001', 'SWE-L003', 'SWE-L005'];

function findRunFiles(cohort, fixturePrefix) {
  const cohortDir = path.join(RUNS_DIR, cohort);
  if (!fs.existsSync(cohortDir)) return [];
  // 实际 actual schema: fixture subdir 是 short ID（如 SWE-L001），不是 full stem
  // 兼容两种命名：精确 short ID 匹配 + prefix match
  const out = [];
  for (const entry of fs.readdirSync(cohortDir)) {
    if (entry !== fixturePrefix && !entry.startsWith(`${fixturePrefix}-`)) continue;
    const dir = path.join(cohortDir, entry);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/^run-.*\.json$/.test(f)) out.push(path.join(dir, f));
    }
  }
  return out;
}

function parseGroupLogCost(cohort, fixturePrefix) {
  // /tmp/spectra-pilot-27/group-A-SWE-L001.log 末行 [summary] cost=$0.75
  const logPath = path.join(PILOT_LOG_DIR, `group-${cohort}-${fixturePrefix}.log`);
  if (!fs.existsSync(logPath)) return null;
  const content = fs.readFileSync(logPath, 'utf8');
  const m = content.match(/cost=\$([0-9.]+)/);
  return m ? Number(m[1]) : null;
}

function summarize() {
  const summary = {
    runAt: new Date().toISOString(),
    schemaNote: 'Actual schema 缺 tokensInput/Output / mcpToolCalls[] / judges.* (spec FR-037 canonical 未落地)；本分析用 wallMs + oracleResult + inheritance_status + costUsd (from group log)。',
    cohorts: {},
    overall: {
      totalRuns: 0,
      success: 0,
      failed: 0,
      avgWallMs: 0,
      totalCostUsd: 0,
      oraclePass: 0,
      oracleFail: 0,
      oracleError: 0,
    },
    inheritance: { available: 0, unavailable: 0, unknown: 0 },
    confidence: { 'env-only': 0, 'self-report': 0, 'self-report-only': 0, merged: 0, mixed: 0, absent: 0 },
    failedReasons: [],
  };

  const allWall = [];

  for (const cohort of COHORTS) {
    const cohortStats = {
      total: 0,
      success: 0,
      failed: 0,
      avgWallMs: 0,
      costUsd: 0,
      oraclePass: 0,
      oracleFail: 0,
      oracleError: 0,
      inheritance: { available: 0, unavailable: 0, unknown: 0 },
      runs: [],
    };
    const wallList = [];

    for (const fixturePrefix of FIXTURES) {
      const cost = parseGroupLogCost(cohort, fixturePrefix);
      if (cost !== null) cohortStats.costUsd += cost;

      const runFiles = findRunFiles(cohort, fixturePrefix);
      for (const fp of runFiles) {
        cohortStats.total += 1;
        summary.overall.totalRuns += 1;
        try {
          const r = JSON.parse(fs.readFileSync(fp, 'utf8'));
          const status = r.status ?? 'unknown';
          if (status === 'success') {
            cohortStats.success += 1;
            summary.overall.success += 1;
          } else {
            cohortStats.failed += 1;
            summary.overall.failed += 1;
            if (r.oracleError || r.error?.message) {
              summary.failedReasons.push(`${cohort}/${fixturePrefix}/r${r.repeatIndex ?? '?'}: ${r.oracleError ?? r.error?.message ?? 'unknown'}`);
            }
          }

          const wallMs = r.perf?.wallMs ?? 0;
          if (wallMs > 0) { wallList.push(wallMs); allWall.push(wallMs); }

          const oracleR = r.oracleResult ?? 'unknown';
          if (oracleR === 'pass') { cohortStats.oraclePass += 1; summary.overall.oraclePass += 1; }
          else if (oracleR === 'fail') { cohortStats.oracleFail += 1; summary.overall.oracleFail += 1; }
          else { cohortStats.oracleError += 1; summary.overall.oracleError += 1; }

          // inheritance_status (顶层 + Cohort C 重点)
          const inh = r.inheritance_status ?? 'unknown';
          if (inh in cohortStats.inheritance) cohortStats.inheritance[inh] += 1;
          if (inh in summary.inheritance) summary.inheritance[inh] += 1;

          // confidence (from subAgentMeta)
          const conf = r.perf?.subAgentMeta?.confidence ?? 'absent';
          if (conf in summary.confidence) summary.confidence[conf] += 1;

          cohortStats.runs.push({
            taskId: r.taskId, repeat: r.repeatIndex, status, wallMs,
            oracleResult: oracleR,
            filesChanged: r.productMetrics?.filesChanged ?? 0,
            commits: r.productMetrics?.commits ?? 0,
            inheritance_status: inh,
            confidence: conf,
          });
        } catch (e) {
          cohortStats.failed += 1;
          summary.overall.failed += 1;
          summary.failedReasons.push(`${cohort}/${fixturePrefix} parse fail: ${e.message}`);
        }
      }
    }

    cohortStats.avgWallMs = wallList.length ? Math.round(wallList.reduce((a, b) => a + b, 0) / wallList.length) : 0;
    summary.overall.totalCostUsd += cohortStats.costUsd;
    summary.cohorts[cohort] = cohortStats;
  }

  summary.overall.avgWallMs = allWall.length ? Math.round(allWall.reduce((a, b) => a + b, 0) / allWall.length) : 0;

  // 全量 450 runs 投影（基于 pilot wall clock + cost）
  const fullRunsCount = 450;
  const pilotRunsCount = summary.overall.totalRuns;
  const avgWallS = summary.overall.avgWallMs / 1000;
  const avgCostPerRun = pilotRunsCount > 0 ? summary.overall.totalCostUsd / pilotRunsCount : 0;
  summary.fullProjection = {
    runsCount: fullRunsCount,
    estWallClockH: ((avgWallS * fullRunsCount) / 3600).toFixed(1),
    estTotalCostUsd: (avgCostPerRun * fullRunsCount).toFixed(2),
    avgWallSPerRun: avgWallS.toFixed(1),
    avgCostPerRunUsd: avgCostPerRun.toFixed(4),
    // 决策：单 run wall clock < 15 min 视为 1-shot 可行；否则需分批
    decision: avgWallS < 900 ? 'safe-1-shot-or-bg' : 'split-multi-week',
    decisionReason: avgWallS < 900
      ? `单 run < 15min (${avgWallS.toFixed(0)}s)，450 runs 可后台 1-shot 跑（est ${((avgWallS * fullRunsCount) / 3600).toFixed(1)}h wall clock）`
      : `单 run ≥ 15min (${avgWallS.toFixed(0)}s)，450 runs wall clock ${((avgWallS * fullRunsCount) / 3600).toFixed(1)}h 过长，需分多 calendar day 用 --max-runs-per-day 控制`,
  };

  return summary;
}

const summary = summarize();
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));

console.log('=== Pilot 27 分析摘要（actual schema）===');
console.log(`总跑批: ${summary.overall.totalRuns}, success: ${summary.overall.success}, failed: ${summary.overall.failed}`);
console.log(`平均 wall: ${(summary.overall.avgWallMs / 1000).toFixed(1)}s/run = ${(summary.overall.avgWallMs / 60000).toFixed(1)}min`);
console.log(`总 cost: $${summary.overall.totalCostUsd.toFixed(2)}`);
console.log(`Oracle: pass=${summary.overall.oraclePass} fail=${summary.overall.oracleFail} error=${summary.overall.oracleError}`);
console.log('');
console.log('每 cohort:');
for (const c of COHORTS) {
  const cs = summary.cohorts[c];
  console.log(`  ${c}: ${cs.success}/${cs.total} success | cost $${cs.costUsd.toFixed(2)} | avg wall ${(cs.avgWallMs / 60000).toFixed(1)}min | oracle pass=${cs.oraclePass} fail=${cs.oracleFail} | inheritance ${JSON.stringify(cs.inheritance)}`);
}
console.log('');
console.log('subAgentMeta confidence (overall):', summary.confidence);
console.log('inheritance_status (overall):', summary.inheritance);
console.log('');
console.log('全量 450 投影:');
console.log(`  wall clock: ${summary.fullProjection.estWallClockH}h (单 run ${summary.fullProjection.avgWallSPerRun}s)`);
console.log(`  cost: $${summary.fullProjection.estTotalCostUsd} (单 run $${summary.fullProjection.avgCostPerRunUsd})`);
console.log(`  决策: ${summary.fullProjection.decision} — ${summary.fullProjection.decisionReason}`);
console.log('');
console.log(`artifact: ${OUT_PATH}`);
if (summary.failedReasons.length) {
  console.log('\nfailed 详情 (首 5):');
  summary.failedReasons.slice(0, 5).forEach((r) => console.log(`  - ${r}`));
}
