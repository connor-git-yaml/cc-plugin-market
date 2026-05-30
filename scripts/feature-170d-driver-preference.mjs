#!/usr/bin/env node
/**
 * F170d — Driver Preference Shaping E2E harness
 *
 * 在 F170c SC-002 harness 基础上，通过 --append-system-prompt 注入「工具优先使用规则」
 * 引导块，实测 guided active-call rate（≥ 50% primary gate；vs F170c spontaneous 0/10）。
 *
 * 唯一变量：system-prompt 注入引导块（忠实模拟 Phase A 投递通道 = agent body 即子代理 system prompt）。
 * namespace 与 production 统一：.mcp.json server key = plugin_spectra_spectra（→ mcp__plugin_spectra_spectra__*）。
 * 复用 scripts/lib/driver-eval-core.mjs 的纯函数（不复制 170c；170c 冻结）。
 *
 * 用法（host shell + Claude Max OAuth）：
 *   npm run build   # 先生成 dist/cli/index.js
 *   node scripts/feature-170d-driver-preference.mjs [--repeats N] [--agent implement]
 *        [--negative-control] [--simulate-graph-missing] [--out FILE]
 *
 * 退出码：0 = primary-pass (≥50%)；1 = <50%（degraded/fail）；2 = harness/setup fatal。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  TASKS,
  NEGATIVE_CONTROL_TASKS,
  validatePrompts,
  parseToolEvents,
  computeMetrics,
  wilsonCI,
  resolveTargetInGraph,
  isImpactToolName,
  renderInjectionBlock,
  parseFrontmatterTools,
  NS,
} from './lib/driver-eval-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_CLI = path.join(PROJECT_ROOT, 'dist/cli/index.js');
const TEMPLATE_PATH = path.join(PROJECT_ROOT, 'plugins/spec-driver/templates/preference-rules.md');
const SPEC_DIR = path.join(PROJECT_ROOT, 'specs/170d-driver-preference-shaping');
const VERIFICATION_DIR = path.join(SPEC_DIR, 'verification');
const GRAPH_PATH = path.join(PROJECT_ROOT, 'specs/_meta/graph.json');
const MCP_SERVER_KEY = 'plugin_spectra_spectra';
const ALLOWED_TOOLS = [
  `${NS}impact`,
  `${NS}context`,
  `${NS}detect_changes`,
  'Read', 'Grep', 'Glob',
].join(',');
const DRIVER_MODEL = 'claude-sonnet-4-6';

// ============================================================
// 纯 builder（sandbox 单测覆盖）
// ============================================================

/** .mcp.json 内容；server key 必须为 plugin_spectra_spectra（与 production namespace 一致）。 */
export function buildMcpConfig(_wtDir) {
  return {
    mcpServers: {
      [MCP_SERVER_KEY]: { command: 'node', args: [DIST_CLI, 'mcp-server'] },
    },
  };
}

/** claude --print args；allowedTools production namespace + --append-system-prompt 紧随其值。 */
export function buildClaudeArgs(wtDir, systemPrompt) {
  return [
    '--print',
    '--model', DRIVER_MODEL,
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--permission-mode', 'acceptEdits',
    '--mcp-config', path.join(wtDir, '.mcp.json'),
    // 只用本 harness 写的 .mcp.json（server key=plugin_spectra_spectra），屏蔽用户全局
    // 的 ambient `spectra` server——否则 driver 会调旧命名 mcp__spectra__impact（不在
    // allowedTools 中 → 被拦截 → resolved=false，US2 实测据此发现）。
    '--strict-mcp-config',
    '--append-system-prompt', systemPrompt,
    '--allowedTools', ALLOWED_TOOLS,
  ];
}

/** 读 template + 指定 agent frontmatter tools，渲染注入块（含 framing），供 --append-system-prompt。 */
export function buildInjectionBlock(agent = 'implement') {
  const templateText = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const agentText = fs.readFileSync(path.join(PROJECT_ROOT, `plugins/spec-driver/agents/${agent}.md`), 'utf-8');
  const tools = parseFrontmatterTools(agentText);
  const block = renderInjectionBlock(templateText, tools);
  return `以下是本次任务的工具优先使用约定（spec-driver ${agent} agent 约定）：\n\n${block}`;
}

/** 断言注入块中出现的 fully-qualified spectra 工具 ⊆ allowedTools，否则 throw。 */
export function assertInjectionSubsetOfAllowed(block, allowedTools) {
  const allowedSet = new Set(
    Array.isArray(allowedTools) ? allowedTools : String(allowedTools).split(','),
  );
  const re = new RegExp(`${NS}\\w+`, 'g');
  const found = new Set(String(block).match(re) ?? []);
  for (const tool of found) {
    if (!allowedSet.has(tool)) {
      throw new Error(`[injection] 注入块工具 ${tool} 不在 allowedTools；US2 数据会失真`);
    }
  }
  return true;
}

// ============================================================
// preflight / setup（host-only，非纯）
// ============================================================

function preflight(systemPrompt) {
  // 1. dist 存在
  if (!fs.existsSync(DIST_CLI)) {
    throw new Error(`[preflight] ${DIST_CLI} 不存在；请先 npm run build`);
  }
  // 2. 注入块非空 + 工具 ⊆ allowedTools
  if (!systemPrompt || systemPrompt.trim().length === 0) {
    throw new Error('[preflight] 注入块为空（FR-008 fail-fast）');
  }
  assertInjectionSubsetOfAllowed(systemPrompt, ALLOWED_TOOLS);
  // 3. claude --version + --append-system-prompt 接受性探测
  const ver = spawnSync('claude', ['--version'], { encoding: 'utf-8', timeout: 30000 });
  if (ver.status !== 0) {
    throw new Error(`[preflight] claude --version 失败：${(ver.stderr ?? '').slice(0, 200)}`);
  }
  const help = spawnSync('claude', ['--help'], { encoding: 'utf-8', timeout: 30000 });
  if (!String(help.stdout ?? '').includes('--append-system-prompt')) {
    throw new Error('[preflight] 当前 claude CLI 不支持 --append-system-prompt（FR-015 fail-fast）');
  }
  console.log(`[preflight] claude ${String(ver.stdout ?? '').trim()}；--append-system-prompt 支持 ✅`);
  console.log(`[preflight] 注入块 sha256=${crypto.createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16)}…（证明非裸 baseline）`);
}

function writeMcpConfig(wtDir) {
  const cfgPath = path.join(wtDir, '.mcp.json');
  fs.writeFileSync(cfgPath, JSON.stringify(buildMcpConfig(wtDir), null, 2) + '\n', 'utf-8');
  return cfgPath;
}

function runSpectraBatch(wtDir) {
  console.log('[setup] 跑 spectra batch --mode code-only ...');
  const r = spawnSync('node', [DIST_CLI, 'batch', '--mode', 'code-only', '--no-html'], {
    cwd: wtDir, encoding: 'utf-8', timeout: 600000, maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`[setup] spectra batch failed: exit=${r.status}\n${(r.stderr ?? '').slice(0, 500)}`);
  }
  if (!fs.existsSync(GRAPH_PATH)) throw new Error(`[setup] graph.json 未生成: ${GRAPH_PATH}`);
}

function ensureGraphAndValidateTargets(wtDir, tasks) {
  if (!fs.existsSync(GRAPH_PATH)) runSpectraBatch(wtDir);
  const loadIds = () => {
    const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf-8'));
    const ids = new Set();
    if (Array.isArray(graph.nodes)) for (const n of graph.nodes) if (typeof n.id === 'string') ids.add(n.id);
    return ids;
  };
  let ids = loadIds();
  let missing = tasks.filter((t) => t.target && resolveTargetInGraph(ids, t.target) === null);
  if (missing.length > 0) {
    runSpectraBatch(wtDir);
    ids = loadIds();
    missing = tasks.filter((t) => t.target && resolveTargetInGraph(ids, t.target) === null);
    if (missing.length > 0) {
      throw new Error(`[setup] task target 不在 graph 中：\n${missing.map((t) => `  - ${t.id}: ${t.target}`).join('\n')}`);
    }
  }
  console.log(`[setup] graph 含 ${ids.size} nodes；${tasks.filter((t) => t.target).length} 个 target 验证通过`);
}

function spawnClaude(prompt, wtDir, systemPrompt, timeoutMs = 300000) {
  const args = buildClaudeArgs(wtDir, systemPrompt);
  const env = { ...process.env };
  if (env.ANTHROPIC_API_KEY === '') delete env.ANTHROPIC_API_KEY;
  const start = Date.now();
  const r = spawnSync('claude', args, {
    cwd: wtDir, encoding: 'utf-8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, input: prompt, env,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', durationMs: Date.now() - start, error: r.error ? String(r.error) : null };
}

// ============================================================
// main
// ============================================================

function parseArgs() {
  const a = process.argv.slice(2);
  const opts = { repeats: 2, agent: 'implement', negativeControl: false, simulateGraphMissing: false, out: null, delayMs: 0 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--repeats') opts.repeats = parseInt(a[++i], 10);
    else if (a[i] === '--agent') opts.agent = a[++i];
    else if (a[i] === '--negative-control') opts.negativeControl = true;
    else if (a[i] === '--simulate-graph-missing') opts.simulateGraphMissing = true;
    else if (a[i] === '--delay-ms') opts.delayMs = parseInt(a[++i], 10); // run 间限速，控制 API rate
    else if (a[i] === '--out') opts.out = a[++i];
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opts = parseArgs();
  const wtDir = PROJECT_ROOT;
  const tasks = opts.negativeControl ? NEGATIVE_CONTROL_TASKS : TASKS;

  console.log('=== F170d Driver Preference Shaping E2E ===');
  console.log(`mode=${opts.negativeControl ? 'negative-control' : opts.simulateGraphMissing ? 'graph-missing' : 'guided'} agent=${opts.agent} repeats=${opts.repeats} tasks=${tasks.length}`);

  // prompt 字面量校验（caller-analysis tasks 才有 forbidden literal 约束）
  if (!opts.negativeControl) {
    const errs = validatePrompts(tasks);
    if (errs.length > 0) { console.error('[FATAL] prompt 含禁止字面量:', errs); process.exit(2); }
  }

  const systemPrompt = buildInjectionBlock(opts.agent);
  preflight(systemPrompt);

  writeMcpConfig(wtDir);

  const runs = [];
  const total = tasks.length * opts.repeats;
  let graphBackup = null; // 仅 graph-missing 模式置位（codex C1：try/finally 保证恢复）

  try {
    if (opts.simulateGraphMissing) {
      if (fs.existsSync(GRAPH_PATH)) {
        graphBackup = `${GRAPH_PATH}.f170d-bak`;
        if (fs.existsSync(graphBackup)) {
          throw new Error(`[setup] 残留备份 ${graphBackup} 已存在；请先手动清理后再跑，避免覆盖`);
        }
        fs.renameSync(GRAPH_PATH, graphBackup);
      }
      console.log('[setup] graph-missing 模拟：已移走 graph.json，期望 driver 回退 Grep');
    } else {
      ensureGraphAndValidateTargets(wtDir, tasks);
    }

    let idx = 0;
    for (let r = 0; r < opts.repeats; r++) {
      for (const task of tasks) {
        idx++;
        if (idx > 1 && opts.delayMs > 0) {
          console.log(`  [rate-control] sleep ${opts.delayMs}ms`);
          await sleep(opts.delayMs);
        }
        console.log(`\n[run ${idx}/${total}] task=${task.id} repeat=${r + 1}`);
        const res = spawnClaude(task.prompt, wtDir, systemPrompt);
        console.log(`  ${(res.durationMs / 1000).toFixed(1)}s exit=${res.status} stdout=${(res.stdout.length / 1024).toFixed(1)}KB`);
        if (res.error) throw new Error(`[harness-fatal] claude spawn error: ${res.error}`);
        if (res.status !== 0 && res.stdout.trim() === '') {
          throw new Error(`[harness-fatal] claude exit=${res.status} 且 stdout 空；stderr: ${res.stderr.slice(0, 300)}`);
        }
        const events = parseToolEvents(res.stdout);
        const m = computeMetrics(events);
        const mcpCalls = events.toolUses.filter((t) => t.name.startsWith(NS)).length;
        console.log(`  impactAttempt=${m.impactAttempt} resolved=${m.impactResolvedSuccess} fallback=${m.fallbackAfterImpactFailure} grep=${m.grepCount} mcpCalls=${mcpCalls}`);
        runs.push({ idx, taskId: task.id, repeat: r + 1, durationMs: res.durationMs, mcpCalls, ...m });
      }
    }
  } finally {
    // codex C1：无论是否中途 throw，都恢复 graph.json
    if (graphBackup && fs.existsSync(graphBackup)) fs.renameSync(graphBackup, GRAPH_PATH);
  }

  // 三层指标
  const resolvedCount = runs.filter((r) => r.impactResolvedSuccess).length;
  const attemptCount = runs.filter((r) => r.impactAttempt).length;
  const fallbackCount = runs.filter((r) => r.fallbackAfterImpactFailure).length;
  const grepRunCount = runs.filter((r) => r.grepCount > 0).length;
  const ci = wilsonCI(resolvedCount, total);

  // 按模式分别计算 summary / outcome / exit（codex C2：negative-control / graph-missing 不能用 SC-002 退出语义）
  let summary; let scenario; let exitCode;
  console.log('\n=== 总结 ===');
  if (opts.negativeControl) {
    scenario = 'SC-009';
    const overCall = runs.filter((r) => r.mcpCalls > 0).length;
    const threshold = Math.floor(total / 3);
    const softGatePass = overCall <= threshold;
    console.log(`negative-control over-call: ${overCall}/${total}（soft gate ≤ ${threshold}）→ ${softGatePass ? '✅ pass' : '⚠️ over-call'}`);
    summary = { overCallCount: overCall, overCallRate: overCall / total, threshold, softGatePass, outcomeType: softGatePass ? 'soft-pass' : 'soft-fail' };
    exitCode = 0; // soft gate：仅 harness/setup fatal 才非 0（由外层 catch → exit 2）
  } else if (opts.simulateGraphMissing) {
    scenario = 'SC-003';
    // 成功 = MCP 不可用时 driver 回退 Grep（不应有 resolved success）
    const fallbackOk = grepRunCount >= 1 && resolvedCount === 0;
    console.log(`graph-missing fallback: grepRuns=${grepRunCount}/${total} resolved=${resolvedCount} → ${fallbackOk ? '✅ Grep fallback 生效' : '⚠️ 未观察到预期 fallback'}`);
    summary = { grepRunCount, grepRunRate: grepRunCount / total, resolvedCount, fallbackWorks: fallbackOk, outcomeType: fallbackOk ? 'fallback-pass' : 'fallback-fail' };
    exitCode = fallbackOk ? 0 : 1;
  } else {
    scenario = 'SC-002';
    const outcomeType = ci.point >= 0.5 ? 'primary-pass' : ci.point >= 0.25 ? 'degraded' : 'below-secondary';
    console.log(`impactAttemptRate: ${attemptCount}/${total}`);
    console.log(`impactResolvedSuccessRate (= guided active-call rate, SC-002): ${resolvedCount}/${total} (${(ci.point * 100).toFixed(1)}%)`);
    console.log(`fallbackAfterImpactFailureRate: ${fallbackCount}/${total}`);
    console.log(`Wilson 95% CI: [${(ci.lower * 100).toFixed(1)}%, ${(ci.upper * 100).toFixed(1)}%]`);
    console.log(`SC-002 (≥50%): ${ci.point >= 0.5 ? '✅ primary-pass' : ci.point >= 0.25 ? '🟠 degraded' : '🔴 fail'}`);
    summary = { impactAttemptRate: attemptCount / total, impactResolvedSuccessRate: ci.point, fallbackAfterImpactFailureRate: fallbackCount / total, wilsonCI: { lower: ci.lower, upper: ci.upper, level: 0.95 }, primaryPassGate: ci.point >= 0.5, outcomeType };
    exitCode = ci.point >= 0.5 ? 0 : 1;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = opts.out || path.join(VERIFICATION_DIR, `sc-002-driver-eval-${ts}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const report = {
    feature: 'F170d', scenario,
    timestamp: new Date().toISOString(),
    config: { driverModel: DRIVER_MODEL, agent: opts.agent, mode: opts.negativeControl ? 'negative-control' : opts.simulateGraphMissing ? 'graph-missing' : 'guided', tasks: tasks.length, repeats: opts.repeats, totalRuns: total, mcpServerKey: MCP_SERVER_KEY, allowedTools: ALLOWED_TOOLS, injectionSha256: crypto.createHash('sha256').update(systemPrompt).digest('hex') },
    summary,
    runs,
  };
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  console.log(`\nReport: ${outFile}\noutcomeType: ${summary.outcomeType}`);
  process.exit(exitCode);
}

// CLI guard：仅直跑时执行 main，被 vitest import 时不执行（endsWith，非 string===URL）
const isCliEntry = process.argv[1] != null
  && path.resolve(process.argv[1]).endsWith('feature-170d-driver-preference.mjs');
if (isCliEntry) {
  main().catch((err) => { console.error('[FATAL]', err); process.exit(2); });
}
