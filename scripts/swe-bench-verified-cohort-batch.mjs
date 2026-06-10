#!/usr/bin/env node
/**
 * Feature 176 — SWE-Bench Verified 5-cohort 批跑编排器（tasks T-E1）。
 *
 * 职责：入口校验（spike gate / 版本门禁 / 预注册 / 凭据）→ 跑 run 矩阵（runner CLI）
 * → fixture 归位到 Verified 路径 → oracle 三分类 → jury 质量叠加（blinding）→ 聚合。
 *
 * 用法（host shell，需 claude OAuth）：
 *   node scripts/swe-bench-verified-cohort-batch.mjs --smoke              # 5 cohort × 1 task × N=1
 *   node scripts/swe-bench-verified-cohort-batch.mjs --full               # 10 task × 5 cohort × N=3 = 150
 *   node scripts/swe-bench-verified-cohort-batch.mjs --full --resume      # 断点续跑（跳过已 finalized success）
 *   node scripts/swe-bench-verified-cohort-batch.mjs --smoke --dry-run    # 只列计划不跑
 * 选项：
 *   --skip-jury            跳过 jury（smoke 默认跳，--full 默认跑）
 *   --on-quota pause|continue   配额信号处置（默认 pause：写 checkpoint 退出，--resume 续）
 *   --quota-check-cmd "<cmd>"   每 6 runs 执行；exit!=0 视为配额告警（无则打印人工提醒）
 *   --allow-global-spectra      --full 时容忍全局 spectra plugin 存在（默认 hard-fail，见 runbook）
 *   --task <id>            smoke 指定 task（默认取预注册/fixtures 第一个）
 *
 * 复用：eval-task-runner CLI（单 run）/ eval-quota-store（状态+resume）/ swe-bench-verified-paths
 *       / spectra-version-gate / preregistration-check / cohort-aggregate / eval-judge-jury CLI。
 * 关联 spec：FR-A-006/007/007b/008b/009、FR-A-001b（oracle 三分类）、FR-B-*（聚合）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT, VERIFIED_ROOT, fixturesDir, runFixturePath, aggregateDir, smokeDir } from './lib/swe-bench-verified-paths.mjs';
import { verifySpectraVersion } from './lib/spectra-version-gate.mjs';
import { checkPreregistration, parsePreregistration } from './lib/preregistration-check.mjs';
import { aggregateCohorts, COHORT_IDS } from './lib/cohort-aggregate.mjs';
import { globalSpectraPluginPresent, globalSpecDriverPluginPresent } from './lib/local-spectra-plugin.mjs';
import { classifyRuns, writeRunStarted, writeRunFinalizedSuccess, writeRunFinalizedFailed, atomicWriteJson } from './lib/eval-quota-store.mjs';
import { anonymizeFixture } from './eval-judge.mjs';

const __filename = fileURLToPath(import.meta.url);
const RUNNER = path.join(PROJECT_ROOT, 'scripts', 'eval-task-runner.mjs');
const JURY = path.join(PROJECT_ROOT, 'scripts', 'eval-judge-jury.mjs');
const SPIKE_RESULT = path.join(PROJECT_ROOT, 'specs/176-swe-bench-verified-cross-cohort/verification/spike-result.md');
const PREREG = path.join(PROJECT_ROOT, 'specs/176-swe-bench-verified-cross-cohort/verification/preregistration.md');
const STATE_DIR = path.join(VERIFIED_ROOT, 'runs-state');

// cohort id（报告/聚合）→ runner --tool 值（cohort1=control 即裸 claude）
export const COHORT_TO_TOOL = {
  'baseline-claude': 'control',
  'spec-driver': 'spec-driver',
  'spec-driver-spectra-mcp': 'spec-driver-spectra-mcp',
  'SuperPowers': 'superpowers',
  'GStack': 'gstack',
};

// ───────────────────────────────────────────────────────────
// argv
// ───────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const args = {
    mode: null, // 'smoke' | 'full'
    dryRun: false, resume: false, skipJury: null,
    onQuota: 'pause', quotaCheckCmd: process.env.SPECTRA_QUOTA_CHECK_CMD ?? null,
    allowGlobalSpectra: false, task: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--smoke': args.mode = 'smoke'; break;
      case '--full': args.mode = 'full'; break;
      case '--dry-run': args.dryRun = true; break;
      case '--resume': args.resume = true; break;
      case '--skip-jury': args.skipJury = true; break;
      case '--on-quota': args.onQuota = argv[++i]; break;
      case '--quota-check-cmd': args.quotaCheckCmd = argv[++i]; break;
      case '--allow-global-spectra': args.allowGlobalSpectra = true; break;
      case '--task': args.task = argv[++i]; break;
      default: if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!args.mode) throw new Error('--smoke 或 --full 必选其一');
  if (!['pause', 'continue'].includes(args.onQuota)) throw new Error('--on-quota 须为 pause|continue');
  if (args.skipJury == null) args.skipJury = args.mode === 'smoke'; // smoke 默认省 jury 成本
  return args;
}

// ───────────────────────────────────────────────────────────
// 入口校验（FR-A-007b spike gate / FR-A-004b 版本门禁 / FR-A-002b 预注册 / 凭据）
// ───────────────────────────────────────────────────────────

export function readSpikeStatus(spikeResultPath = SPIKE_RESULT) {
  if (!fs.existsSync(spikeResultPath)) return null;
  const m = fs.readFileSync(spikeResultPath, 'utf-8').match(/^status:\s*(\S+)/m);
  return m ? m[1] : null;
}

function entryValidation(args) {
  const problems = [];

  // 1. spike gate：必须 PASS_SUBAGENT（synthetic 不写该文件 → 文件存在即 host 真跑过）
  const spike = readSpikeStatus();
  if (spike !== 'PASS_SUBAGENT') {
    problems.push(`spike gate 未过（spike-result status=${spike ?? '缺失'}，需 PASS_SUBAGENT）→ 先按 runbook 跑 spike（FR-A-007b）`);
  }

  // 2. 版本门禁：cohort3 的 spectra 必须是含 F177-F181 的 clean-src build
  const distCli = path.join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
  const gate = verifySpectraVersion(distCli, { allowDirty: false });
  if (!gate.ok) problems.push(`版本门禁未过: ${gate.reason}`);

  // 3. 预注册：--full 必须冻结一致；--smoke 仅提示
  const taskIds = listTaskIds(args);
  if (args.mode === 'full') {
    const check = checkPreregistration(taskIds, PREREG);
    if (!check.ok) problems.push(`预注册校验未过: ${check.reason}（FR-A-002b：全量前必须冻结且一致）`);
  } else if (!fs.existsSync(PREREG) || !parsePreregistration(fs.readFileSync(PREREG, 'utf-8')).frozen) {
    console.warn('[batch] ⚠️ 预注册未冻结 — smoke 可跑，但 --full 前必须冻结（FR-A-002b）');
  }

  // 4. 凭据：jury 需要 SILICONFLOW_API_KEY（.env.local）；driver 走 claude OAuth（CON-3 不查 API key）
  if (!args.skipJury) {
    const envLocal = path.join(PROJECT_ROOT, '.env.local');
    const hasKey = fs.existsSync(envLocal) && /^export SILICONFLOW_API_KEY=/m.test(fs.readFileSync(envLocal, 'utf-8'));
    if (!hasKey) problems.push('jury 需要 SILICONFLOW_API_KEY（.env.local），或 --skip-jury');
  }
  const claudeOk = spawnSync('claude', ['--version'], { encoding: 'utf-8' }).status === 0;
  if (!claudeOk) problems.push('claude CLI 不可用（driver 必需，host OAuth）');

  // 5. 全局 plugin 歧义（cohort 用 --plugin-dir 注入本地/仓内源；全局同名并存 → 加载歧义，
  //    版本审计失真，codex CRITICAL）。smoke/full 同规则：默认 hard-fail，--allow-global-spectra 显式放行
  if (globalSpectraPluginPresent() && !args.allowGlobalSpectra) {
    problems.push('全局 spectra plugin 启用 — 与 cohort3 本地 plugin 同名加载歧义（版本审计失真）。claude plugin disable spectra@cc-plugin-market --scope user 后再跑，或 --allow-global-spectra 显式放行并自担歧义');
  }
  if (globalSpecDriverPluginPresent() && !args.allowGlobalSpectra) {
    problems.push('全局 spec-driver plugin 启用 — 已发布 4.1.0 agents 是旧 namespace（无 F170a），与仓内源同名加载歧义。claude plugin disable spec-driver@cc-plugin-market --scope user 后再跑');
  }

  if (problems.length > 0) {
    console.error('[batch] 入口校验失败（hard-fail）：');
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(2);
  }
  console.error(`[batch] 入口校验通过：spike=PASS_SUBAGENT / 版本门禁 ${gate.reason}`);
  return { gate };
}

// ───────────────────────────────────────────────────────────
// run 矩阵
// ───────────────────────────────────────────────────────────

function listTaskIds(args) {
  // 优先预注册冻结清单；未冻结（smoke 早期）退回 fixtures 目录扫描
  if (fs.existsSync(PREREG)) {
    const pre = parsePreregistration(fs.readFileSync(PREREG, 'utf-8'));
    if (pre.frozen && pre.taskIds.length > 0) return pre.taskIds;
  }
  const dir = fixturesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith('_')).map((n) => n.replace(/\.json$/, '')).sort();
}

export function buildRunMatrix(mode, taskIds, smokeTask = null) {
  const repeats = mode === 'smoke' ? 1 : 3;
  const tasks = mode === 'smoke' ? [smokeTask ?? taskIds[0]].filter(Boolean) : taskIds;
  if (tasks.length === 0) throw new Error('无可跑 task（先跑 Verified importer + 预注册）');
  const matrix = [];
  for (const taskId of tasks) {
    for (const cohort of COHORT_IDS) {
      for (let r = 1; r <= repeats; r++) matrix.push({ taskId, cohort, repeatIndex: r });
    }
  }
  return matrix;
}

// ───────────────────────────────────────────────────────────
// oracle 三分类（FR-A-001b：环境不可用 ≠ 测试失败）
// ───────────────────────────────────────────────────────────

/** exit 126/127（命令不可执行/不存在）或全 check timedOut → 环境不可用，剔除分母 */
export function classifyOracle(oracleResult) {
  if (!oracleResult) return 'unavailable';
  if (oracleResult.passed === true) return 'pass';
  const details = Array.isArray(oracleResult.details) ? oracleResult.details : [];
  if (details.length > 0) {
    const envSignals = details.filter((d) => d.exitCode === 126 || d.exitCode === 127 || d.timedOut === true);
    if (envSignals.length === details.length) return 'unavailable'; // 全部是环境信号才判 unavailable（保守）
  }
  return 'fail';
}

// ───────────────────────────────────────────────────────────
// 单 run 执行
// ───────────────────────────────────────────────────────────

function runOne({ taskId, cohort, repeatIndex }, args) {
  const tool = COHORT_TO_TOOL[cohort];
  const suffix = `f176r${repeatIndex}`;
  const runnerFixture = path.join(PROJECT_ROOT, 'tests/baseline/tasks', taskId, `${tool}-${suffix}`, 'full.json');
  const destFixture = runFixturePath(taskId, cohort, repeatIndex);

  const runnerArgs = [
    RUNNER, '--task', taskId, '--tool', tool,
    '--repeat-index', String(repeatIndex),
    '--fixture-suffix', suffix,
    '--bypass-permissions', '--cleanup', 'on-success',
    // F176 driver 统一（KD-7 + smoke 迭代实测）：全 cohort opus-4-7 + stream-json（token 采集）
    // + stdin（variadic 防吃）+ 真实 skill 调用（prompt 提及 workflow 不触发真实机制）
    '--model', 'claude-opus-4-7',
    '--output-format', 'stream-json',
    '--prompt-via-stdin',
    '--skill-invocation',
  ];
  if (args.dryRun) {
    console.log(`[batch][dry-run] node ${runnerArgs.map((a) => path.basename(a)).join(' ')}`);
    return { status: 'dry-run' };
  }
  console.error(`[batch] ▶ ${taskId} × ${cohort} × r${repeatIndex}`);
  // --allow-global-spectra 经 env 透传给 runner 的 cohort3 preflight（否则 runner 对全局 plugin hard-fail）
  const env = { ...process.env, ...(args.allowGlobalSpectra ? { F176_ALLOW_GLOBAL_SPECTRA: '1' } : {}) };
  const r = spawnSync('node', runnerArgs, { cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['ignore', 'inherit', 'inherit'], timeout: 2400000, env });
  if (r.status !== 0 || !fs.existsSync(runnerFixture)) {
    return { status: 'broken', exitCode: r.status, reason: r.status !== 0 ? `runner exit ${r.status}` : 'fixture 未产出' };
  }
  // fixture 归位到 Verified 路径（runner 原生路径是 Lite 时代的 tasks/<task>/<tool>/）
  fs.mkdirSync(path.dirname(destFixture), { recursive: true });
  fs.copyFileSync(runnerFixture, destFixture);

  const fixture = JSON.parse(fs.readFileSync(destFixture, 'utf-8'));
  const oracleState = classifyOracle(fixture.taskExecution?.oracleResult ?? fixture.oracleResult);

  // jury 质量叠加（blinding：jury 内部 anonymize；此处记 blindingHash 供审计 FR-A-008b）
  if (!args.skipJury) {
    const blindingHash = crypto.createHash('sha256').update(JSON.stringify(anonymizeFixture(fixture))).digest('hex');
    const jr = spawnSync('node', [JURY, '--fixture', destFixture], { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 600000 });
    const updated = JSON.parse(fs.readFileSync(destFixture, 'utf-8'));
    updated.meta = updated.meta ?? {};
    updated.meta.blindingHash = blindingHash;
    updated.meta.juryInvoked = jr.status === 0;
    atomicWriteJson(destFixture, updated);
    if (jr.status !== 0) console.warn(`[batch] ⚠️ jury 失败（不影响 oracle 真值）: exit ${jr.status}`);
  }
  return { status: 'success', oracleState, fixturePath: destFixture };
}

// ───────────────────────────────────────────────────────────
// 配额检查点（FR-A-009：每 6 runs；默认非交互 pause/resume）
// ───────────────────────────────────────────────────────────

function quotaCheckpoint(completedCount, args) {
  if (completedCount === 0 || completedCount % 6 !== 0) return 'ok';
  if (args.quotaCheckCmd) {
    const r = spawnSync('bash', ['-c', args.quotaCheckCmd], { encoding: 'utf-8', timeout: 60000 });
    if (r.status !== 0) {
      console.error(`[batch] 🔶 配额检查命令告警（exit ${r.status}）：${(r.stdout + r.stderr).slice(0, 200)}`);
      return args.onQuota === 'pause' ? 'pause' : 'ok';
    }
    return 'ok';
  }
  console.error(`[batch] ⏱ 已完成 ${completedCount} runs — 请人工查看 Claude Max / ChatGPT 配额 dashboard（≥60% weekly 建议 --resume 分日续跑）`);
  return 'ok';
}

// ───────────────────────────────────────────────────────────
// 聚合 + smoke 断言
// ───────────────────────────────────────────────────────────

export function loadRunRecords(taskIds, repeats) {
  const records = [];
  for (const taskId of taskIds) {
    for (const cohort of COHORT_IDS) {
      for (let r = 1; r <= repeats; r++) {
        const p = runFixturePath(taskId, cohort, r);
        if (!fs.existsSync(p)) continue;
        const fx = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const oracleState = classifyOracle(fx.taskExecution?.oracleResult ?? fx.oracleResult);
        const tokens = (fx.perf?.tokensInput ?? null) != null && (fx.perf?.tokensOutput ?? null) != null
          ? fx.perf.tokensInput + fx.perf.tokensOutput : null;
        records.push({
          cohort, taskId, repeatIndex: r,
          oraclePassed: oracleState === 'unavailable' ? null : oracleState === 'pass',
          tokens,
        });
      }
    }
  }
  return records;
}

function smokeAssertions(results, matrix) {
  const broken = results.filter((x) => x.result.status !== 'success');
  const c3 = results.find((x) => x.run.cohort === 'spec-driver-spectra-mcp');
  let c3McpCalls = null;
  if (c3?.result.fixturePath && fs.existsSync(c3.result.fixturePath)) {
    const fx = JSON.parse(fs.readFileSync(c3.result.fixturePath, 'utf-8'));
    const trace = fx.perf?.mcpToolCalls ?? fx.perf?.mcpToolCallTrace ?? [];
    c3McpCalls = Array.isArray(trace) ? trace.reduce((s, t) => s + (t.callCount ?? 0), 0) : 0;
  }
  const pass = broken.length === 0 && (c3McpCalls ?? 0) > 0;
  // frontmatter 含机器可读断言字段 + source 标记（codex CRITICAL：verify 不能只看 status，
  // 需交叉核对计数；synthetic 防线 = 本文件仅由真实 batch 跑写出 + git 历史 + 人工 review）
  const body = `---
feature: 176
artifact: smoke-result
status: ${pass ? 'PASS' : 'FAIL'}
source: host(batch)
runCount: ${results.length}
brokenCount: ${broken.length}
c3McpCallCount: ${c3McpCalls ?? 'null'}
generatedAtIso: ${new Date().toISOString()}
---

# F176 smoke 结果（5 cohort × 1 task × N=1）

| 断言 | 结果 |
|------|------|
| 5/5 runs success（无 broken）| ${broken.length === 0 ? '✅' : `❌ broken=${broken.length}: ${broken.map((b) => `${b.run.cohort}(${b.result.reason ?? b.result.status})`).join('; ')}`} |
| cohort3 mcpToolCallCount > 0 | ${(c3McpCalls ?? 0) > 0 ? `✅ (${c3McpCalls})` : `❌ (${c3McpCalls ?? 'n/a'})`} |

runs: ${matrix.map((m) => `${m.taskId}×${m.cohort}`).join(', ')}
${pass ? '✅ SC-001 达成 → 解锁 --full（先冻结预注册 FR-A-002b）' : '❌ 阻断全量（FR-A-007）：修复后重跑 smoke'}
`;
  fs.mkdirSync(smokeDir(), { recursive: true });
  fs.writeFileSync(path.join(smokeDir(), 'smoke-result.md'), body, 'utf-8');
  // smoke 判定也写入 specs verification（入库侧 host 产物）
  fs.writeFileSync(path.join(PROJECT_ROOT, 'specs/176-swe-bench-verified-cross-cohort/verification/smoke-result.md'), body, 'utf-8');
  console.error(`[batch] smoke ${pass ? 'PASS ✅' : 'FAIL ❌'} → verification/smoke-result.md`);
  return pass;
}

// ───────────────────────────────────────────────────────────
// main
// ───────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { gate } = args.dryRun ? { gate: null } : entryValidation(args);
  if (args.dryRun) console.error('[batch] --dry-run：跳过入口校验的 hard-fail（仅列计划）');

  const taskIds = listTaskIds(args);
  const matrix = buildRunMatrix(args.mode, taskIds, args.task);
  console.error(`[batch] 计划：${matrix.length} runs（${args.mode}; jury=${args.skipJury ? 'skip' : 'on'}; resume=${args.resume}）`);
  if (args.dryRun) {
    for (const m of matrix) console.log(`[plan] ${m.taskId} × ${m.cohort} × r${m.repeatIndex}`);
    return;
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  // resume：跳过已 finalized success 的 run。注意 classifyRuns 只认 run-*.json 文件名，
  // finalized 条目的 id 来自文件内 run_id 字段（quota-store F162 合同）
  const done = new Set();
  if (args.resume) {
    const cls = classifyRuns({ runDir: STATE_DIR });
    for (const f of cls.finalized ?? []) done.add(f.id);
    console.error(`[batch] --resume：跳过 ${done.size} 个已完成 run`);
  }

  const results = [];
  let completed = 0;
  for (const run of matrix) {
    const runId = `${run.taskId}__${run.cohort}__r${run.repeatIndex}`;
    const stateFile = path.join(STATE_DIR, `run-${runId}.json`);
    if (done.has(runId)) { results.push({ run, result: { status: 'success', resumed: true } }); continue; }

    writeRunStarted({ runFilePath: stateFile, runId });
    const startedAt = new Date().toISOString();
    let result;
    try {
      result = runOne(run, args);
    } catch (e) {
      result = { status: 'broken', reason: e.message };
    }
    if (result.status === 'success') {
      writeRunFinalizedSuccess({ runFilePath: stateFile, runId, startedAt, payload: { oracleState: result.oracleState } });
    } else {
      writeRunFinalizedFailed({ runFilePath: stateFile, runId, startedAt, errorPhase: 'run', error: result.reason ?? result.status });
    }
    results.push({ run, result });
    completed++;

    if (quotaCheckpoint(completed, args) === 'pause') {
      console.error(`[batch] ⏸ 配额暂停（--on-quota=pause）：已完成 ${completed}/${matrix.length}；隔日 \`--${args.mode} --resume\` 续跑`);
      process.exit(3);
    }
  }

  if (args.mode === 'smoke') {
    const ok = smokeAssertions(results, matrix);
    process.exit(ok ? 0 : 4);
  }

  // --full 完成：聚合（oracle-only pass rate / lift / c3_vs_c4 / token）
  const records = loadRunRecords(taskIds, 3);
  const agg = aggregateCohorts(records);
  fs.mkdirSync(aggregateDir(), { recursive: true });
  // taskSetHash 把 aggregate 绑回预注册（codex WARNING：防旧/手写 aggregate 纸面通过 verify）
  const { computeTaskSetHash } = await import('./lib/preregistration-check.mjs');
  atomicWriteJson(path.join(aggregateDir(), 'cohort-aggregate.json'), {
    generatedAtIso: new Date().toISOString(),
    source: 'host(batch--full)',
    spectraVersionGate: gate ? { commit: gate.meta.commit, distSha256: gate.meta.distSha256 } : null,
    taskSetHash: computeTaskSetHash(taskIds),
    expectedRunCount: taskIds.length * COHORT_IDS.length * 3,
    runCount: records.length,
    ...agg,
  });
  console.error(`[batch] ✅ 全量完成：${records.length} run records → ${path.relative(PROJECT_ROOT, path.join(aggregateDir(), 'cohort-aggregate.json'))}`);
  console.error(`[batch] lift(c3/c1)=${agg.lift?.toFixed(3) ?? 'n/a'} | c3_vs_c4 diff=${agg.c3_vs_c4?.diff?.toFixed(3) ?? 'n/a'} | tokenRatio(c3/c1)=${agg.tokenRatioC3overC1?.toFixed(3) ?? 'n/a'}`);
}

const isCliEntry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCliEntry) {
  main().catch((e) => { console.error(`[batch] error: ${e.message}`); process.exit(1); });
}
