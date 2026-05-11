#!/usr/bin/env node
// Feature 162 T050 — Pilot 27 跑批后分析脚本
// 用途：跑完 pilot 27 runs 后，聚合 token / wall clock / cohort pass rate
//      + inheritance_status 分布（FR-037 §10.5），输出供决策全量 450 用。
//
// Usage:
//   node scripts/pilot-27-analyze.mjs
//
// 输出：specs/162-codex-driver-glm-judge-eval/pilot-27-analysis.json + console summary

import fs from 'node:fs';
import path from 'node:path';
import { pearson } from './lib/pearson.mjs';

const REPO_ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, '');
const RUNS_DIR = path.join(REPO_ROOT, 'tests/baseline/swe-bench-lite/runs');
const OUT_PATH = path.join(REPO_ROOT, 'specs/162-codex-driver-glm-judge-eval/pilot-27-analysis.json');

const COHORTS = ['A', 'B', 'C'];
const FIXTURES = ['SWE-L001', 'SWE-L003', 'SWE-L005'];
const REPEAT = 3;

function findRunFiles(cohort, fixture) {
  const dir = path.join(RUNS_DIR, cohort, fixture);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => /^run-.*\.json$/.test(n))
    .map((n) => path.join(dir, n));
}

function summarize() {
  const summary = {
    runAt: new Date().toISOString(),
    cohorts: {},
    overall: {
      totalRuns: 0,
      finalized: 0,
      failed: 0,
      partial: 0,
      avgWallClockS: 0,
      avgTokensInput: 0,
      avgTokensOutput: 0,
    },
    inheritance: { available: 0, unavailable: 0, unknown: 0 },
    failedReasons: [],
  };

  const allWall = [];
  const allInput = [];
  const allOutput = [];

  for (const cohort of COHORTS) {
    const cohortStats = {
      total: 0,
      finalized: 0,
      failed: 0,
      partial: 0,
      avgWallClockS: 0,
      avgTokensInput: 0,
      avgTokensOutput: 0,
      oracleCounts: { pass: 0, fail: 0 },
      jurySuccessCounts: { opus: 0, glm: 0, kimi: 0, codex: 0 },
      runs: [],
    };
    const wallList = [];
    const inputList = [];
    const outputList = [];

    for (const fixture of FIXTURES) {
      const runFiles = findRunFiles(cohort, fixture);
      for (const fp of runFiles) {
        cohortStats.total += 1;
        summary.overall.totalRuns += 1;
        try {
          const r = JSON.parse(fs.readFileSync(fp, 'utf8'));
          const status = r.status ?? (r.finalizedAt ? 'success' : 'partial');
          if (status === 'success') {
            cohortStats.finalized += 1;
            summary.overall.finalized += 1;
          } else if (status === 'failed') {
            cohortStats.failed += 1;
            summary.overall.failed += 1;
            if (r.error?.message) summary.failedReasons.push(`${cohort}/${fixture}: ${r.error.message.slice(0, 120)}`);
          } else {
            cohortStats.partial += 1;
            summary.overall.partial += 1;
          }

          // perf metrics
          const wallMs = r.perf?.wallClockMs ?? r.wallClockMs ?? 0;
          const tIn = r.perf?.tokensInput ?? r.tokensInput ?? 0;
          const tOut = r.perf?.tokensOutput ?? r.tokensOutput ?? 0;
          if (wallMs > 0) { wallList.push(wallMs); allWall.push(wallMs); }
          if (tIn > 0) { inputList.push(tIn); allInput.push(tIn); }
          if (tOut > 0) { outputList.push(tOut); allOutput.push(tOut); }

          // oracle
          if (r.oracle?.passed === true) cohortStats.oracleCounts.pass += 1;
          else if (r.oracle?.passed === false) cohortStats.oracleCounts.fail += 1;

          // jury success counts
          for (const slot of ['opus', 'glm', 'kimi', 'codex']) {
            if (r.juryScores?.[slot]?.ok || r.judges?.[slot]?.ok) cohortStats.jurySuccessCounts[slot] += 1;
          }

          // inheritance status (cohort C only)
          if (cohort === 'C' && r.perf?.inheritanceStatus) {
            const st = r.perf.inheritanceStatus;
            if (st in summary.inheritance) summary.inheritance[st] += 1;
          }

          cohortStats.runs.push({
            fixture, runId: r.runId, status,
            wallS: wallMs / 1000,
            tokens: { in: tIn, out: tOut },
            oracle: r.oracle?.passed,
            mcpToolCalls: r.perf?.mcpToolCalls?.length ?? 0,
          });
        } catch (e) {
          cohortStats.failed += 1;
          summary.overall.failed += 1;
          summary.failedReasons.push(`${cohort}/${fixture} parse fail: ${e.message}`);
        }
      }
    }

    cohortStats.avgWallClockS = wallList.length ? (wallList.reduce((a, b) => a + b, 0) / wallList.length / 1000) : 0;
    cohortStats.avgTokensInput = inputList.length ? Math.round(inputList.reduce((a, b) => a + b, 0) / inputList.length) : 0;
    cohortStats.avgTokensOutput = outputList.length ? Math.round(outputList.reduce((a, b) => a + b, 0) / outputList.length) : 0;
    summary.cohorts[cohort] = cohortStats;
  }

  summary.overall.avgWallClockS = allWall.length ? (allWall.reduce((a, b) => a + b, 0) / allWall.length / 1000) : 0;
  summary.overall.avgTokensInput = allInput.length ? Math.round(allInput.reduce((a, b) => a + b, 0) / allInput.length) : 0;
  summary.overall.avgTokensOutput = allOutput.length ? Math.round(allOutput.reduce((a, b) => a + b, 0) / allOutput.length) : 0;

  // 全量 450 runs 投影（基于 pilot 平均 wall clock + token）
  const fullRunsCount = 450;
  summary.fullProjection = {
    runsCount: fullRunsCount,
    estWallClockS: summary.overall.avgWallClockS * fullRunsCount,
    estWallClockH: (summary.overall.avgWallClockS * fullRunsCount / 3600).toFixed(1),
    estTokensInputTotal: summary.overall.avgTokensInput * fullRunsCount,
    estTokensOutputTotal: summary.overall.avgTokensOutput * fullRunsCount,
    decision: summary.overall.avgTokensOutput < 10000 ? 'safe-1-shot' : 'split-multi-week',
    decisionReason: summary.overall.avgTokensOutput < 10000
      ? `单 run output < 10K tokens (${summary.overall.avgTokensOutput})，全量 450 可单 calendar week 跑完`
      : `单 run output ≥ 10K tokens (${summary.overall.avgTokensOutput})，需分 2-3 calendar week 用 --max-runs-per-day 控制`,
  };

  return summary;
}

const summary = summarize();
fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));

console.log('=== Pilot 27 分析摘要 ===');
console.log(`总跑批: ${summary.overall.totalRuns}, finalized: ${summary.overall.finalized}, failed: ${summary.overall.failed}, partial: ${summary.overall.partial}`);
console.log(`平均 wall clock: ${summary.overall.avgWallClockS.toFixed(1)}s/run`);
console.log(`平均 tokens: ${summary.overall.avgTokensInput} input / ${summary.overall.avgTokensOutput} output`);
console.log('');
console.log('每 cohort:');
for (const c of COHORTS) {
  const cs = summary.cohorts[c];
  console.log(`  ${c}: ${cs.finalized}/${cs.total} finalized, oracle ${cs.oracleCounts.pass}/${cs.oracleCounts.pass + cs.oracleCounts.fail} pass, jury ok: opus ${cs.jurySuccessCounts.opus} glm ${cs.jurySuccessCounts.glm} kimi ${cs.jurySuccessCounts.kimi} codex ${cs.jurySuccessCounts.codex}`);
}
console.log('');
console.log('Cohort C inheritance:', summary.inheritance);
console.log('');
console.log('全量 450 投影:');
console.log(`  wall clock: ${summary.fullProjection.estWallClockH}h`);
console.log(`  tokens: ${summary.fullProjection.estTokensInputTotal} input / ${summary.fullProjection.estTokensOutputTotal} output total`);
console.log(`  决策: ${summary.fullProjection.decision} — ${summary.fullProjection.decisionReason}`);
console.log('');
console.log(`artifact: ${OUT_PATH}`);
if (summary.failedReasons.length) {
  console.log('\nfailed 详情 (首 5)：');
  summary.failedReasons.slice(0, 5).forEach((r) => console.log(`  - ${r}`));
}
