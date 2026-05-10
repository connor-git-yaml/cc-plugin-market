#!/usr/bin/env node
/**
 * Feature 158 — SWE-Bench Lite Grounding Eval 自动验收脚本
 *
 * SC-001 到 SC-008 全部由本脚本机器验收（spec FR-007 + plan §6）。
 *
 * 用法：
 *   node scripts/verify-feature-158-classic.mjs
 *   node scripts/verify-feature-158-classic.mjs --out /tmp/sc.json
 *   node scripts/verify-feature-158-classic.mjs --target tests/baseline/tasks --repeats 3
 *
 * Exit code：
 *   0 = 所有 SC 都不是 FAIL（PASS/SKIP/WARN 任一组合）
 *   1 = 任一 SC 报 FAIL
 *
 * SKIP 语义：
 *   - SC-004/006/007: fixture 不存在 → SKIP（NFR-003 fixture 不入库，干净 repo 上正常）
 *   - SC-005: §6 章节不存在 → SKIP（T-013 完成后才能验）
 *
 * WARN 语义：
 *   - SC-007: 部分 fixture 无 costUsd 字段 → WARN，跳过该 fixture 累加（不算 FAIL）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(PROJECT_ROOT, 'specs/158-swe-bench-lite-grounding-eval/research/task-fixtures');
const REPORT_PATH = path.join(PROJECT_ROOT, 'specs/147-competitor-evaluation-platform/competitive-evaluation-report.md');
const BASELINE_DIR = path.join(PROJECT_ROOT, 'tests/baseline/tasks');
const EXPECTED_TASKS = ['T158-micrograd-1', 'T158-micrograd-2', 'T158-micrograd-3', 'T158-micrograd-4', 'T158-nanoGPT-5', 'T158-micrograd-6'];
const COHORTS = ['control', 'spec-driver-spectra', 'mcp-pull'];
const BUDGET_USD = 50;

function parseArgs(argv) {
  const args = { out: null, target: BASELINE_DIR, repeats: 3, skipSanity: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--out') args.out = argv[++i];
    else if (k === '--target') args.target = argv[++i];
    else if (k === '--repeats') args.repeats = Number(argv[++i]);
    else if (k === '--skip-sanity') args.skipSanity = true;
    else if (k === '--help' || k === '-h') {
      console.error(`用法: node scripts/verify-feature-158-classic.mjs [--out <file.json>] [--target <baseline-dir>] [--repeats N] [--skip-sanity]
  --skip-sanity: 跳过 SC-001 中 eval-task-fixture-check.mjs 实跑（CI 快速 smoke 模式）`);
      process.exit(0);
    }
  }
  return args;
}

function logSc(id, status, msg) {
  const tag = status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : status === 'WARN' ? 'WARN' : 'FAIL';
  console.log(`[${id}] ${tag}: ${msg}`);
  return { id, status, msg };
}

// ============================================================
// SC-001: 6 个 T158-* fixture 入库 + sanity ok + checks.length >= 2
// ============================================================

function checkSc001(args) {
  if (!fs.existsSync(FIXTURE_DIR)) {
    return logSc('SC-001', 'FAIL', `fixture dir not found: ${FIXTURE_DIR}`);
  }
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json') && f.startsWith('T158-'));
  if (files.length < 4) {
    return logSc('SC-001', 'FAIL', `only ${files.length} T158-* fixtures (expected ≥ 4 per spec FR-001)`);
  }
  const issues = [];
  for (const f of files) {
    const fixturePath = path.join(FIXTURE_DIR, f);
    let fixture;
    try {
      fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    } catch (e) {
      issues.push(`${f}: JSON parse error: ${e.message}`);
      continue;
    }
    const checksLen = fixture.primaryOracle?.checks?.length ?? 0;
    if (checksLen < 2) {
      issues.push(`${f}: checks.length = ${checksLen} (W-6 要求 ≥ 2)`);
    }
    if (!Array.isArray(fixture.expectedSpectraToolCalls)) {
      issues.push(`${f}: expectedSpectraToolCalls 不是数组（FR-001 要求）`);
    }
  }
  if (issues.length > 0) {
    return logSc('SC-001', 'FAIL', `fixture schema issues:\n  - ${issues.join('\n  - ')}`);
  }

  // C-1 Codex round-2 修复：spec FR-001 验收信号要求 "eval-task-fixture-check.mjs 输出 sanity: ok"
  // 默认跑 fixture-check，--skip-sanity 跳过（用于 CI 快速 smoke）
  if (args.skipSanity) {
    return logSc('SC-001', 'PASS', `${files.length} T158-* fixtures schema OK (sanity check 跳过 — --skip-sanity)`);
  }
  const sanityIssues = [];
  for (const f of files) {
    const taskId = f.replace(/\.json$/, '');
    try {
      execSync(`node scripts/eval-task-fixture-check.mjs --task ${taskId}`, {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
        encoding: 'utf-8',
        timeout: 120000,
      });
    } catch (e) {
      sanityIssues.push(`${taskId}: sanity check exit ${e.status ?? 'unknown'}: ${(e.stderr ?? '').slice(0, 100)}`);
    }
  }
  if (sanityIssues.length > 0) {
    return logSc('SC-001', 'FAIL', `fixture sanity check failed:\n  - ${sanityIssues.join('\n  - ')}`);
  }
  return logSc('SC-001', 'PASS', `${files.length} T158-* fixtures schema OK + sanity check 全 PASS`);
}

// ============================================================
// SC-002: eval-mcp-augmented-classic.mjs 存在 + --dry-run 退出码 0
// ============================================================

function checkSc002() {
  const scriptPath = path.join(PROJECT_ROOT, 'scripts/eval-mcp-augmented-classic.mjs');
  if (!fs.existsSync(scriptPath)) {
    return logSc('SC-002', 'FAIL', `script not found: ${scriptPath}`);
  }
  try {
    execSync(`node ${scriptPath} --task T158-micrograd-1 --cohort all --repeats 1 --dry-run`, {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return logSc('SC-002', 'PASS', 'eval-mcp-augmented-classic.mjs --dry-run exit 0');
  } catch (e) {
    return logSc('SC-002', 'FAIL', `dry-run exit ${e.status ?? 'unknown'}: ${e.stderr?.slice(0, 200) ?? e.message}`);
  }
}

// ============================================================
// SC-003: eval-task-runner.mjs 含 mcp-pull + mcp-config 关键字
// ============================================================

function checkSc003() {
  const runnerPath = path.join(PROJECT_ROOT, 'scripts/eval-task-runner.mjs');
  if (!fs.existsSync(runnerPath)) {
    return logSc('SC-003', 'FAIL', `runner not found: ${runnerPath}`);
  }
  const content = fs.readFileSync(runnerPath, 'utf-8').toLowerCase();
  const hasMcpPull = content.includes('mcp-pull');
  const hasMcpConfig = content.includes('mcp-config') || content.includes('.mcp.json');
  if (!hasMcpPull) {
    return logSc('SC-003', 'FAIL', `eval-task-runner.mjs 缺少 'mcp-pull' 关键字`);
  }
  if (!hasMcpConfig) {
    return logSc('SC-003', 'FAIL', `eval-task-runner.mjs 缺少 'mcp-config' 或 '.mcp.json' 关键字`);
  }
  return logSc('SC-003', 'PASS', `eval-task-runner.mjs 含 mcp-pull + mcp-config（FR-002 接入）`);
}

// ============================================================
// SC-004: mcp-pull fixture 含 mcpToolCallTrace（数组）+ w3Flag（boolean）
// ============================================================

function checkSc004(target) {
  if (!fs.existsSync(target)) {
    return logSc('SC-004', 'SKIP', `baseline dir 不存在（NFR-003 不入库；干净 repo 正常）: ${target}`);
  }
  const taskDirs = fs.readdirSync(target).filter((d) => d.startsWith('T158-'));
  if (taskDirs.length === 0) {
    return logSc('SC-004', 'SKIP', `no T158-* task fixture in ${target}（eval 阶段未跑或 fixture 不入库）`);
  }
  let mcpFixturesFound = 0;
  const issues = [];
  for (const taskId of taskDirs) {
    const fp = path.join(target, taskId, 'mcp-pull', 'full.json');
    if (!fs.existsSync(fp)) continue;
    mcpFixturesFound++;
    let fixture;
    try { fixture = JSON.parse(fs.readFileSync(fp, 'utf-8')); }
    catch (e) { issues.push(`${taskId}: JSON parse fail`); continue; }
    // Feature 162 plan §2.4.3：canonical 字段 perf.mcpToolCalls；兼容旧字段名 perf.mcpToolCallTrace
    const trace = fixture.perf?.mcpToolCalls ?? fixture.perf?.mcpToolCallTrace;
    if (!Array.isArray(trace)) {
      issues.push(`${taskId}: perf.mcpToolCalls / mcpToolCallTrace 都不是数组（type=${trace === null ? 'null' : typeof trace}）`);
    }
    if (typeof fixture.perf?.w3Flag !== 'boolean') {
      issues.push(`${taskId}: perf.w3Flag 不是 boolean（type=${typeof fixture.perf?.w3Flag}）`);
    }
  }
  if (mcpFixturesFound === 0) {
    return logSc('SC-004', 'SKIP', `no mcp-pull fixture exists yet（T-010 未完成或干净 repo）`);
  }
  if (issues.length > 0) {
    return logSc('SC-004', 'FAIL', `mcp-pull fixture schema issues:\n  - ${issues.join('\n  - ')}`);
  }
  return logSc('SC-004', 'PASS', `${mcpFixturesFound} mcp-pull fixture(s), all含 mcpToolCallTrace 数组 + w3Flag boolean`);
}

// ============================================================
// SC-005: §6 章节存在 + 表格行 ≥ 3 + Limitation 子节
// ============================================================

function checkSc005() {
  if (!fs.existsSync(REPORT_PATH)) {
    return logSc('SC-005', 'SKIP', `competitive-evaluation-report.md 不存在`);
  }
  const content = fs.readFileSync(REPORT_PATH, 'utf-8');
  // 共存方案：master §10 = "SWE-Bench Grounding Lift" / 本 micrograd-track §12 = "SWE-Bench-Style Grounding Lift（micrograd-track）"
  // 两者标题区分点是 "-Style"；本 verify 只 match 本节（含 -Style）；\d+ 支持多位数章节号
  const titleRegex = /^##\s+\d+\.?\s*SWE-Bench-Style\s+Grounding\s+Lift/im;
  const titleMatch = content.match(titleRegex);
  if (!titleMatch) {
    return logSc('SC-005', 'SKIP', `§12 "SWE-Bench-Style Grounding Lift（micrograd-track）" 章节标题缺失`);
  }
  // 取从标题到下一个 ## 标题之间的内容（§6 范围）
  const startIdx = content.indexOf(titleMatch[0]);
  const restAfterTitle = content.slice(startIdx + titleMatch[0].length);
  const nextH2Match = restAfterTitle.match(/^##\s/m);
  const sec6 = nextH2Match ? restAfterTitle.slice(0, nextH2Match.index) : restAfterTitle;

  // 验证：管道 markdown table 行 ≥ 3
  const tableRows = sec6.match(/^\|.+\|.+\|/gm) ?? [];
  if (tableRows.length < 3) {
    return logSc('SC-005', 'FAIL', `§6 表格行 ${tableRows.length} < 3（spec FR-006 要求 ≥ 3 行）`);
  }
  // Limitation 子节
  const hasLimitation = /^###?\s+.*Limitation/im.test(sec6);
  if (!hasLimitation) {
    return logSc('SC-005', 'FAIL', `§6 缺少 "Limitation" 子节（FR-006 + WR-5 要求）`);
  }
  // WR-5：3 cohort name + ≥ 6 percentage + "95% CI" + "tokens" + "W-3" 或 "trap"
  const cohortNames = ['control', 'spec-driver-spectra', 'mcp-pull'];
  for (const name of cohortNames) {
    if (!sec6.toLowerCase().includes(name.toLowerCase())) {
      return logSc('SC-005', 'FAIL', `§6 缺少 cohort 名 "${name}"（WR-5 要求）`);
    }
  }
  const percentMatches = sec6.match(/\b\d+(\.\d+)?%/g) ?? [];
  if (percentMatches.length < 6) {
    return logSc('SC-005', 'FAIL', `§6 百分比数据 ${percentMatches.length} < 6（WR-5 要求 ≥ 6）`);
  }
  if (!/95%\s*CI/i.test(sec6)) {
    return logSc('SC-005', 'FAIL', `§6 缺少 "95% CI" 字样（WR-5）`);
  }
  if (!/tokens?/i.test(sec6)) {
    return logSc('SC-005', 'FAIL', `§6 缺少 "tokens" 字样（WR-5）`);
  }
  if (!/W-3|trap/i.test(sec6)) {
    return logSc('SC-005', 'FAIL', `§6 缺少 "W-3" 或 "trap" 字样（WR-5：trace 已分析）`);
  }
  return logSc('SC-005', 'PASS', `§6 表格行=${tableRows.length}, percentages=${percentMatches.length}, Limitation+95%CI+tokens+W-3 全齐`);
}

// ============================================================
// SC-006: token ratio (tokensInput + tokensOutput) MCP pull vs spec.md push
// ============================================================

function checkSc006(target) {
  if (!fs.existsSync(target)) {
    return logSc('SC-006', 'SKIP', `baseline dir 不存在`);
  }
  const taskDirs = fs.readdirSync(target).filter((d) => d.startsWith('T158-'));
  let pushTotal = 0;
  let mcpTotal = 0;
  let pushCount = 0;
  let mcpCount = 0;
  let controlNullCount = 0;
  let controlTotalCount = 0;
  for (const taskId of taskDirs) {
    for (const cohortDir of ['spec-driver-spectra', 'mcp-pull', 'control']) {
      const fp = path.join(target, taskId, cohortDir, 'full.json');
      if (!fs.existsSync(fp)) continue;
      const fixture = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      const tin = fixture.perf?.tokensInput ?? null;
      const tout = fixture.perf?.tokensOutput ?? null;
      const total = (tin ?? 0) + (tout ?? 0);
      if (cohortDir === 'control') {
        controlTotalCount++;
        if (tin === null && tout === null) controlNullCount++;
      } else if (cohortDir === 'spec-driver-spectra' && total > 0) {
        pushTotal += total;
        pushCount++;
      } else if (cohortDir === 'mcp-pull' && total > 0) {
        mcpTotal += total;
        mcpCount++;
      }
    }
  }
  if (controlTotalCount > 0 && controlNullCount === controlTotalCount) {
    return logSc('SC-006', 'SKIP', `control cohort tokens 字段全为 null（claude --print text mode 已知限制；不算 FAIL）`);
  }
  if (mcpCount === 0 || pushCount === 0) {
    return logSc('SC-006', 'SKIP', `mcp-pull/spec-driver-spectra fixture 不足，无法计算 ratio (mcp=${mcpCount}, push=${pushCount})`);
  }
  const pushAvg = pushTotal / pushCount;
  const mcpAvg = mcpTotal / mcpCount;
  const ratio = pushAvg > 0 ? pushAvg / mcpAvg : null;
  return logSc('SC-006', 'PASS', `token ratio push:mcp = ${pushAvg.toFixed(0)} / ${mcpAvg.toFixed(0)} = ${ratio?.toFixed(2) ?? 'N/A'}x`);
}

// ============================================================
// SC-007: 总成本 ≤ $50 (taskExecution.costUsd)
// ============================================================

function checkSc007(target) {
  if (!fs.existsSync(target)) {
    return logSc('SC-007', 'SKIP', `baseline dir 不存在`);
  }
  const taskDirs = fs.readdirSync(target).filter((d) => d.startsWith('T158-'));
  let total = 0;
  let withCost = 0;
  let warned = 0;
  for (const taskId of taskDirs) {
    for (const cohortDir of COHORTS) {
      const fp = path.join(target, taskId, cohortDir, 'full.json');
      if (!fs.existsSync(fp)) continue;
      const fixture = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      // CR-6: cost 在 taskExecution.costUsd（不是 perf.costUsd）
      const cost = fixture.taskExecution?.costUsd ?? null;
      if (cost === null) {
        warned++;
        continue;
      }
      // 也累加 runs 内单 run cost 总和（aggregate.totalCostUsd）
      const aggCost = fixture.aggregate?.totalCostUsd ?? cost;
      total += aggCost;
      withCost++;
    }
  }
  if (withCost === 0) {
    return logSc('SC-007', 'SKIP', `所有 fixture 无 costUsd 字段（claude --print text mode 限制 / fixture 不存在）`);
  }
  if (total > BUDGET_USD) {
    return logSc('SC-007', 'FAIL', `累计 cost $${total.toFixed(2)} > $${BUDGET_USD}（NFR-001 上限）`);
  }
  if (warned > 0) {
    return logSc('SC-007', 'WARN', `累计 cost $${total.toFixed(2)} <= $${BUDGET_USD}（${warned} fixture 无 costUsd 已跳过累加）`);
  }
  return logSc('SC-007', 'PASS', `累计 cost $${total.toFixed(2)} <= $${BUDGET_USD} (NFR-001)`);
}

// ============================================================
// SC-008: stdout 含 7 行 SC 输出 + FAIL count == 0 → exit 0
// ============================================================

function checkSc008(allResults) {
  const failCount = allResults.filter((r) => r.status === 'FAIL').length;
  const lineCount = allResults.length;
  if (lineCount < 7) {
    return logSc('SC-008', 'FAIL', `stdout 只有 ${lineCount} 行 SC 输出（spec SC-008 要求 ≥ 7 行 SC-001~007）`);
  }
  if (failCount > 0) {
    return logSc('SC-008', 'FAIL', `${failCount} SC 报 FAIL（SC-008 要求 fail_count == 0）`);
  }
  return logSc('SC-008', 'PASS', `${lineCount} SC outputs, FAIL count = 0`);
}

// ============================================================
// 入口
// ============================================================

async function main() {
  const args = parseArgs(process.argv);
  const results = [];
  results.push(checkSc001(args));
  results.push(checkSc002());
  results.push(checkSc003());
  results.push(checkSc004(args.target));
  results.push(checkSc005());
  results.push(checkSc006(args.target));
  results.push(checkSc007(args.target));
  results.push(checkSc008(results));

  console.log('');
  const passCount = results.filter((r) => r.status === 'PASS').length;
  const skipCount = results.filter((r) => r.status === 'SKIP').length;
  const warnCount = results.filter((r) => r.status === 'WARN').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  console.log(`Summary: ${passCount} PASS, ${skipCount} SKIP, ${warnCount} WARN, ${failCount} FAIL (total ${results.length})`);

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(results, null, 2) + '\n', 'utf-8');
    console.log(`Wrote ${args.out}`);
  }

  // exit code: FAIL count == 0 → 0; else 1
  process.exit(failCount === 0 ? 0 : 1);
}

const isCliEntry = process.argv[1]?.endsWith('verify-feature-158-classic.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[verify-feature-158] FATAL: ${err.message}\n${err.stack}`);
    process.exit(2);
  });
}
