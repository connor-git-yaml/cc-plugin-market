#!/usr/bin/env node
/**
 * Feature 158 — Cross-task Aggregation + §6 报告输入数据
 *
 * 把 6 task × 3 cohort × N=3 = 54 个 run 聚合为 §6 报告所需的 JSON：
 *   - 每 cohort 的 18-sample bootstrap 95% CI（正确口径，不是单 task 内 N=3 偏窄 CI）
 *   - 每 task 的 cohort × passRate 矩阵
 *   - W-3 trap 比例
 *   - Token 效率对比（spec.md push vs mcp-pull）
 *   - 总成本累加
 *
 * 用法：
 *   node scripts/eval-feature-158-summary-classic.mjs --out /tmp/f158-summary.json
 *   node scripts/eval-feature-158-summary-classic.mjs --target tests/baseline/tasks --out summary.json --markdown
 *
 * Output:
 *   --out json: 结构化 summary（验证 + 报告引用）
 *   --markdown: 同时生成 markdown 表格段（可拷贝进 §6 报告）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateBootstrap } from './eval-mcp-augmented-classic.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BASELINE_DIR = path.join(PROJECT_ROOT, 'tests/baseline/tasks');
const COHORTS = ['control', 'spec-driver-spectra', 'mcp-pull'];
const COHORT_DISPLAY = {
  'control': 'control',
  'spec-driver-spectra': 'spec-driver-spectra',
  'mcp-pull': 'mcp-pull',
};

function parseArgs(argv) {
  const args = { target: BASELINE_DIR, out: null, markdown: false, repeats: 3 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--target') args.target = argv[++i];
    else if (k === '--out') args.out = argv[++i];
    else if (k === '--markdown') args.markdown = true;
    else if (k === '--repeats') args.repeats = Number(argv[++i]);
    else if (k === '--help') {
      console.error(`用法: node scripts/eval-feature-158-summary-classic.mjs [--target <dir>] [--out <json>] [--markdown]`);
      process.exit(0);
    }
  }
  return args;
}

function listTaskIds(target) {
  if (!fs.existsSync(target)) return [];
  return fs.readdirSync(target).filter((d) => d.startsWith('T158-')).sort();
}

function loadCohortFixture(target, taskId, cohort) {
  const fp = path.join(target, taskId, cohort, 'full.json');
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); }
  catch { return null; }
}

/**
 * 从 fixture 中提取 18 sample（pass/fail bool 数组）
 */
function extractRunsBoolean(fixture) {
  const runs = fixture?.runs ?? [];
  return runs.map((r) => r.passed === true);
}

function summarize(args) {
  const tasks = listTaskIds(args.target);
  const taskRows = [];
  const cohortAllRuns = {};
  for (const c of COHORTS) cohortAllRuns[c] = [];

  let totalCostUsd = 0;
  let totalWallMs = 0;

  // 收集每 task × cohort 数据
  for (const taskId of tasks) {
    const row = { taskId };
    for (const cohort of COHORTS) {
      const fx = loadCohortFixture(args.target, taskId, cohort);
      if (!fx) {
        row[cohort] = { passRate: null, runs: 0, w3FlaggedCount: null, missing: true };
        continue;
      }
      const runsBool = extractRunsBoolean(fx);
      const ci = aggregateBootstrap(runsBool);
      const w3FlaggedCount = (fx.runs ?? []).filter((r) => r.w3Flag === true).length;
      row[cohort] = {
        passRate: ci.passRate,
        passCount: runsBool.filter((b) => b).length,
        ci95Lower: ci.ci95Lower,
        ci95Upper: ci.ci95Upper,
        runs: runsBool.length,
        w3FlaggedCount,
        totalCostUsd: fx.aggregate?.totalCostUsd ?? null,
        totalWallMs: fx.aggregate?.totalWallMs ?? null,
        mcpTraceSummary: fx.aggregate?.mcpTraceSummary ?? null,
        runsDetail: (fx.runs ?? []).map((r) => ({ runIdx: r.runIdx, passed: r.passed, costUsd: r.costUsd, w3Flag: r.w3Flag, wallMs: r.wallMs })),
      };
      cohortAllRuns[cohort].push(...runsBool);
      totalCostUsd += fx.aggregate?.totalCostUsd ?? 0;
      totalWallMs += fx.aggregate?.totalWallMs ?? 0;
    }
    taskRows.push(row);
  }

  // Cohort-level cross-task bootstrap (18 sample = 6 task × N=3)
  const cohortLevel = {};
  for (const cohort of COHORTS) {
    const samples = cohortAllRuns[cohort];
    const ci = aggregateBootstrap(samples);
    cohortLevel[cohort] = {
      totalRuns: samples.length,
      passCount: samples.filter((b) => b).length,
      passRate: ci.passRate,
      ci95Lower: ci.ci95Lower,
      ci95Upper: ci.ci95Upper,
      bootstrapB: ci.b,
    };
  }

  // Token 效率（mcp-pull vs spec-driver-spectra）
  let pushTokensTotal = 0;
  let mcpTokensTotal = 0;
  let pushFixtures = 0;
  let mcpFixtures = 0;
  for (const taskId of tasks) {
    for (const fixturePath of ['spec-driver-spectra', 'mcp-pull']) {
      const fx = loadCohortFixture(args.target, taskId, fixturePath);
      if (!fx) continue;
      const tin = fx.perf?.tokensInput ?? 0;
      const tout = fx.perf?.tokensOutput ?? 0;
      const total = tin + tout;
      if (total > 0) {
        if (fixturePath === 'spec-driver-spectra') { pushTokensTotal += total; pushFixtures++; }
        else { mcpTokensTotal += total; mcpFixtures++; }
      }
    }
  }
  const tokenEfficiency = {
    pushAvgTokens: pushFixtures > 0 ? pushTokensTotal / pushFixtures : null,
    mcpAvgTokens: mcpFixtures > 0 ? mcpTokensTotal / mcpFixtures : null,
    pushFixtures,
    mcpFixtures,
    ratio: pushFixtures > 0 && mcpFixtures > 0 && mcpTokensTotal > 0
      ? (pushTokensTotal / pushFixtures) / (mcpTokensTotal / mcpFixtures)
      : null,
  };

  // W-3 trap rate
  const mcpW3Stats = (() => {
    let totalRuns = 0;
    let trapRuns = 0;
    let mcpToolCallTotalAcrossRuns = 0;
    let runsWithCalls = 0;
    let firstCallTurnSum = 0;
    for (const row of taskRows) {
      if (!row['mcp-pull'] || row['mcp-pull'].missing) continue;
      const mcpData = row['mcp-pull'];
      totalRuns += mcpData.runs;
      trapRuns += mcpData.w3FlaggedCount ?? 0;
      const summary = mcpData.mcpTraceSummary;
      if (summary?.totalCallsAcrossRuns) {
        mcpToolCallTotalAcrossRuns += summary.totalCallsAcrossRuns;
        if (summary.avgFirstCallTurn) {
          firstCallTurnSum += summary.avgFirstCallTurn;
          runsWithCalls++;
        }
      }
    }
    return {
      totalRuns,
      trapRuns,
      trapRate: totalRuns > 0 ? trapRuns / totalRuns : null,
      avgCallsPerRun: totalRuns > 0 ? mcpToolCallTotalAcrossRuns / totalRuns : null,
      avgFirstCallTurn: runsWithCalls > 0 ? firstCallTurnSum / runsWithCalls : null,
    };
  })();

  // Lift 计算（mcp-pull vs control）
  const ctrlPass = cohortLevel.control?.passRate ?? null;
  const pushPass = cohortLevel['spec-driver-spectra']?.passRate ?? null;
  const mcpPass = cohortLevel['mcp-pull']?.passRate ?? null;
  const lift = {
    pushVsControl: ctrlPass !== null && pushPass !== null ? pushPass - ctrlPass : null,
    mcpVsControl: ctrlPass !== null && mcpPass !== null ? mcpPass - ctrlPass : null,
    mcpVsPush: pushPass !== null && mcpPass !== null ? mcpPass - pushPass : null,
  };

  return {
    generatedAt: new Date().toISOString(),
    feature: 158,
    target: args.target,
    tasks: taskRows,
    cohortLevel,
    tokenEfficiency,
    mcpW3Stats,
    lift,
    totalCostUsd,
    totalWallMs,
    completeness: {
      tasks: tasks.length,
      cohortsCovered: tasks.length > 0 && COHORTS.every((c) => taskRows.every((r) => !r[c]?.missing)),
    },
  };
}

function fmtPct(x, dp = 1) {
  if (x === null || x === undefined) return 'N/A';
  return (x * 100).toFixed(dp) + '%';
}

function fmtCi(low, high) {
  if (low === null || high === null) return 'N/A';
  return `[${(low * 100).toFixed(1)}%, ${(high * 100).toFixed(1)}%]`;
}

function renderMarkdownTable(summary) {
  const lines = [];
  lines.push('### Cohort-level Pass Rate（18 sample 跨 task 聚合 + bootstrap 95% CI）\n');
  lines.push('| Cohort | Pass | Total | Pass Rate | 95% CI |');
  lines.push('| --- | ---: | ---: | ---: | --- |');
  for (const cohort of COHORTS) {
    const c = summary.cohortLevel[cohort];
    if (!c) continue;
    lines.push(`| ${COHORT_DISPLAY[cohort]} | ${c.passCount} | ${c.totalRuns} | ${fmtPct(c.passRate)} | ${fmtCi(c.ci95Lower, c.ci95Upper)} |`);
  }
  lines.push('');
  lines.push('### Per-Task Pass Rate（6 task × 3 cohort）\n');
  lines.push('| Task | control | spec-driver-spectra | mcp-pull | mcp-pull W-3 |');
  lines.push('| --- | --- | --- | --- | ---: |');
  for (const row of summary.tasks) {
    const c = row.control ?? {};
    const p = row['spec-driver-spectra'] ?? {};
    const m = row['mcp-pull'] ?? {};
    lines.push(`| ${row.taskId} | ${fmtPct(c.passRate)} (${c.passCount ?? '?'}/${c.runs ?? 0}) | ${fmtPct(p.passRate)} (${p.passCount ?? '?'}/${p.runs ?? 0}) | ${fmtPct(m.passRate)} (${m.passCount ?? '?'}/${m.runs ?? 0}) | ${m.w3FlaggedCount ?? 0}/${m.runs ?? 0} |`);
  }
  lines.push('');
  lines.push('### Token 效率（mcp-pull vs spec-driver-spectra）\n');
  if (summary.tokenEfficiency.mcpAvgTokens && summary.tokenEfficiency.pushAvgTokens) {
    lines.push(`| Cohort | Avg Tokens (input+output) | Fixtures |`);
    lines.push(`| --- | ---: | ---: |`);
    lines.push(`| spec-driver-spectra | ${Math.round(summary.tokenEfficiency.pushAvgTokens)} | ${summary.tokenEfficiency.pushFixtures} |`);
    lines.push(`| mcp-pull | ${Math.round(summary.tokenEfficiency.mcpAvgTokens)} | ${summary.tokenEfficiency.mcpFixtures} |`);
    lines.push(`| **Ratio (push:mcp)** | **${summary.tokenEfficiency.ratio?.toFixed(2)}x** | — |`);
  } else {
    lines.push('（数据不足，cohort fixture 缺少 tokens 字段）');
  }
  lines.push('');
  lines.push('### W-3 Trap 监控（mcp-pull cohort）\n');
  if (summary.mcpW3Stats.totalRuns > 0) {
    lines.push(`- 总 mcp-pull runs: **${summary.mcpW3Stats.totalRuns}**`);
    lines.push(`- W-3 trap 触发数: **${summary.mcpW3Stats.trapRuns}**（${fmtPct(summary.mcpW3Stats.trapRate)}）`);
    lines.push(`- 平均每 run spectra tool 调用次数: **${summary.mcpW3Stats.avgCallsPerRun?.toFixed(2) ?? 'N/A'}**`);
    lines.push(`- 平均首次调用轮次: **${summary.mcpW3Stats.avgFirstCallTurn?.toFixed(1) ?? 'N/A'}**`);
  }
  lines.push('');
  lines.push('### Grounding Lift（vs control baseline）\n');
  lines.push(`- spec-driver-spectra → control: **${(summary.lift.pushVsControl * 100).toFixed(1)}pp**`);
  lines.push(`- mcp-pull → control: **${(summary.lift.mcpVsControl * 100).toFixed(1)}pp**`);
  lines.push(`- mcp-pull → spec-driver-spectra: **${(summary.lift.mcpVsPush * 100).toFixed(1)}pp**`);
  lines.push('');
  lines.push(`### 总成本 / Wall Time\n`);
  lines.push(`- 累计 cost: **$${summary.totalCostUsd.toFixed(2)}**`);
  lines.push(`- 累计 wall time: **${(summary.totalWallMs / 60000).toFixed(1)} min**`);

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const summary = summarize(args);
  if (args.markdown) {
    console.log(renderMarkdownTable(summary));
    console.log('\n---\n');
  }
  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(summary, null, 2) + '\n', 'utf-8');
    console.error(`[summary] wrote ${args.out}`);
  } else if (!args.markdown) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

const isCliEntry = process.argv[1]?.endsWith('eval-feature-158-summary-classic.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[summary] FATAL: ${err.message}\n${err.stack}`);
    process.exit(1);
  });
}
