#!/usr/bin/env node
/**
 * Feature 147 Phase 5 补 — 自动化评估报告生成器
 *
 * 从 tests/baseline/**\/full.json 读 33 fixture（schema 1.1）→ 聚合关键指标
 * → 输出固定格式 markdown 报告。
 *
 * 用法：
 *   node scripts/eval-report.mjs                                   # 输出到 stdout
 *   node scripts/eval-report.mjs --output specs/.../report.md      # 输出到文件
 *   node scripts/eval-report.mjs --format json                     # JSON 而非 markdown
 *
 * 不依赖 npm 包；纯 Node。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BASELINE_DIR = path.join(PROJECT_ROOT, 'tests/baseline');
const SC008_BUDGET = 120;
const STALE_WARN_DAYS = 30; // staleAfterDate 还有 ≤ 30 天 → warning

// ============================================================
// Feature 155 — Agent-Context capability probe
//
// 强校验：实际 spawn 一个 dist 后的 createMcpServer，遍历 server.tools 数组
// 验证 impact / context / detect_changes 三个 tool 都注册。如 dist 不可用，
// 回退到 source-grep 但标注 weak（不可作为 SC-007 强证据）。
// ============================================================

export function probeAgentContextCapability() {
  const expected = ['impact', 'context', 'detect_changes'];

  // Strong path: 通过 spawn node + dist/mcp/server.js 实例化 server
  const distServer = path.join(PROJECT_ROOT, 'dist/mcp/server.js');
  if (fs.existsSync(distServer)) {
    try {
      const probe = spawnSync(process.execPath, [
        '-e',
        `import('${distServer}').then(m => {
          const server = m.createMcpServer();
          // McpServer.tools 内部为私有；通过 _registeredTools 或类似私有字段访问。
          // 折中：MCP SDK 在 .listTools()/server.server._registeredTools 暴露
          const inst = server.server ?? server;
          const reg = inst._registeredTools ?? {};
          const names = Object.keys(reg);
          process.stdout.write(JSON.stringify(names));
        }).catch(e => { process.stderr.write(e.message); process.exit(2); });`,
      ], { encoding: 'utf-8', timeout: 15000 });
      if (probe.status === 0 && probe.stdout) {
        const names = JSON.parse(probe.stdout);
        const found = expected.filter((n) => names.includes(n));
        if (found.length === expected.length) {
          return { available: true, reason: 'server runtime probe ok', toolNames: found, mode: 'runtime' };
        }
        return {
          available: false,
          reason: `runtime probe: tool 缺失 (找到 ${found.join(',') || '无'})`,
          toolNames: found,
          mode: 'runtime',
        };
      }
      // probe 失败 → fall through 到 source-grep
    } catch {
      /* ignore */
    }
  }

  // Weak fallback：source-grep（dist 不可用 / probe 失败时）
  const toolsFile = path.join(PROJECT_ROOT, 'src/mcp/agent-context-tools.ts');
  const serverFile = path.join(PROJECT_ROOT, 'src/mcp/server.ts');
  if (!fs.existsSync(toolsFile)) {
    return { available: false, reason: 'agent-context-tools.ts 不存在', toolNames: [], mode: 'source' };
  }
  let toolsContent = '';
  let serverContent = '';
  try {
    toolsContent = fs.readFileSync(toolsFile, 'utf-8');
    serverContent = fs.existsSync(serverFile) ? fs.readFileSync(serverFile, 'utf-8') : '';
  } catch (err) {
    return { available: false, reason: `读取 source 失败: ${err.message}`, toolNames: [], mode: 'source' };
  }

  // 1) 移除注释行（避免被注释掉的 server.tool 误报）
  const stripComments = (src) =>
    src
      .split('\n')
      .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
  const toolsClean = stripComments(toolsContent);
  const serverClean = stripComments(serverContent);

  // 2) registerAgentContextTools 必须 export
  if (!/export\s+function\s+registerAgentContextTools/.test(toolsClean)) {
    return { available: false, reason: 'registerAgentContextTools 未导出', toolNames: [], mode: 'source' };
  }
  const found = expected.filter((name) =>
    new RegExp(`server\\.tool\\(\\s*['"]${name}['"]`, 'm').test(toolsClean),
  );
  if (found.length !== expected.length) {
    return {
      available: false,
      reason: `tool 注册不完整：找到 ${found.join(', ') || '无'}`,
      toolNames: found,
      mode: 'source',
    };
  }
  if (!/registerAgentContextTools\s*\(\s*server\s*\)/.test(serverClean)) {
    return { available: false, reason: 'server.ts 未调用 registerAgentContextTools', toolNames: found, mode: 'source' };
  }
  return { available: true, reason: 'source grep ok (weak)', toolNames: found, mode: 'source' };
}

// ============================================================
// argv
// ============================================================

export function parseArgs(argv) {
  const args = { output: null, format: 'markdown', filter: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--output': args.output = argv[++i]; break;
      case '--format': args.format = argv[++i]; break;
      case '--filter': args.filter = argv[++i]; break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!['markdown', 'json'].includes(args.format)) {
    throw new Error(`--format must be markdown|json`);
  }
  return args;
}

// ============================================================
// Fixture 扫描 + 分类
// ============================================================

// Sprint 3 Phase D: <tool>-<suffix> 形式（如 -multiturn）的 fixture 是 sub-class，
// 不进入主 §4 task matrix / Coverage / SC-004，仅 §4.5 配对对照渲染消费
const VARIANT_SUFFIX_RE = /-(multiturn|interactive)$/;

export function scanFixtures(rootDir = BASELINE_DIR) {
  const result = { spectraClass: [], specDriverClass: [], specDriverVariants: [] };
  if (!fs.existsSync(rootDir)) return result;

  // Spectra 类: tests/baseline/<project>/<tool>/full.json
  // 排除 'tasks'（spec-driver 类）/ 'repeats'（feature 149 N-run aggregate）/ README
  for (const proj of fs.readdirSync(rootDir).filter((n) => !n.startsWith('.') && n !== 'tasks' && n !== 'repeats' && n !== 'README.md')) {
    const projDir = path.join(rootDir, proj);
    if (!fs.statSync(projDir).isDirectory()) continue;
    for (const tool of fs.readdirSync(projDir)) {
      const fixturePath = path.join(projDir, tool, 'full.json');
      if (!fs.existsSync(fixturePath)) continue;
      try {
        const fx = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
        result.spectraClass.push({ project: proj, tool, fixturePath, fx });
      } catch (e) {
        console.warn(`[eval-report] skip invalid fixture ${fixturePath}: ${e.message}`);
      }
    }
  }

  // Spec Driver 类: tests/baseline/tasks/<task>/<tool>/full.json
  // Sprint 3 Phase D: <tool>-multiturn / <tool>-interactive 等 variant 进 specDriverVariants（仅 §4.5 用）
  const tasksDir = path.join(rootDir, 'tasks');
  if (fs.existsSync(tasksDir)) {
    for (const task of fs.readdirSync(tasksDir)) {
      const taskDir = path.join(tasksDir, task);
      if (!fs.statSync(taskDir).isDirectory()) continue;
      for (const toolDirName of fs.readdirSync(taskDir)) {
        const fixturePath = path.join(taskDir, toolDirName, 'full.json');
        if (!fs.existsSync(fixturePath)) continue;
        try {
          const fx = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
          const variantMatch = toolDirName.match(VARIANT_SUFFIX_RE);
          if (variantMatch) {
            // variant fixture：分离出 baseTool + variant 标记
            const baseTool = toolDirName.replace(VARIANT_SUFFIX_RE, '');
            result.specDriverVariants.push({ task, tool: toolDirName, baseTool, variant: variantMatch[1], fixturePath, fx });
          } else {
            result.specDriverClass.push({ task, tool: toolDirName, fixturePath, fx });
          }
        } catch (e) {
          console.warn(`[eval-report] skip invalid fixture ${fixturePath}: ${e.message}`);
        }
      }
    }
  }

  return result;
}

// ============================================================
// Feature 149：扫 repeats/ 目录加载 N-run aggregate
// ============================================================

/**
 * 扫 tests/baseline/repeats/<task>/<tool>/aggregate.json，
 * 返回 Map<`${task}|${tool}`, aggregate>。
 *
 * 没有 repeats 目录或所有 fixture 都缺失时返回空 Map（向后兼容渲染分支）。
 *
 * @param {string} [rootDir] tests/baseline 根
 * @returns {Map<string, Record<string, unknown>>}
 */
export function loadRepeatAggregates(rootDir = BASELINE_DIR) {
  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map();
  const repeatsDir = path.join(rootDir, 'repeats');
  if (!fs.existsSync(repeatsDir)) return map;
  for (const task of fs.readdirSync(repeatsDir)) {
    if (task.startsWith('.')) continue;
    const taskDir = path.join(repeatsDir, task);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    for (const tool of fs.readdirSync(taskDir)) {
      const aggPath = path.join(taskDir, tool, 'aggregate.json');
      if (!fs.existsSync(aggPath)) continue;
      try {
        const agg = JSON.parse(fs.readFileSync(aggPath, 'utf-8'));
        map.set(`${task}|${tool}`, agg);
      } catch (e) {
        console.warn(`[eval-report] skip invalid aggregate ${aggPath}: ${e.message}`);
      }
    }
  }
  return map;
}

/**
 * 检测两区间是否 overlap：[a.low, a.high] ∩ [b.low, b.high] 非空
 * @param {{ low: number | null; high: number | null } | null | undefined} a
 * @param {{ low: number | null; high: number | null } | null | undefined} b
 * @returns {boolean}
 */
export function ciOverlaps(a, b) {
  if (!a || !b || a.low == null || a.high == null || b.low == null || b.high == null) return false;
  return a.low <= b.high && b.low <= a.high;
}

// ============================================================
// 聚合指标
// ============================================================

// Pricing per million tokens (USD)，2026-05 SiliconFlow + Anthropic 价格快照
// 估算用，不是精确账单。未列出的 vendor/model 按 fallback price 估算。
const TOKEN_PRICING = {
  'siliconflow': { input: 0.30, output: 1.20 }, // 平均价（GLM-5.1/Kimi-K2.6/Qwen3-235B/DeepSeek-V3.2）
  'anthropic': { input: 3.00, output: 15.00 },  // sonnet 4.6 standard
  'openai': { input: 2.50, output: 10.00 },     // gpt-4o standard
  'unknown': { input: 1.00, output: 5.00 },
};

export function estimateJuryCostUsd(juryScores) {
  let total = 0;
  for (const j of juryScores ?? []) {
    if (!j.promptTokens && !j.completionTokens) continue;
    const vendor = j.vendor ?? 'unknown';
    const px = TOKEN_PRICING[vendor] ?? TOKEN_PRICING.unknown;
    total += ((j.promptTokens ?? 0) * px.input + (j.completionTokens ?? 0) * px.output) / 1_000_000;
  }
  return total;
}

export function aggregateMetrics(scanned) {
  // Cost：区分 execution cost / jury cost / unknown
  // 区分 official tier (sonnet/opus) vs estimate tier (GLM/Kimi 等回填) — Sprint 3 Phase B.2
  let executionCost = 0;
  let executionCostEstimateTier = 0; // tier=='estimate' 单独累计，便于披露
  let juryCost = 0;
  let unknownCostFixtures = 0;
  for (const x of scanned.spectraClass) {
    const c = x.fx.perf?.estimatedCostUsd;
    if (c == null) unknownCostFixtures++;
    else executionCost += c;
  }
  for (const x of scanned.specDriverClass) {
    const c = x.fx.taskExecution?.costUsd;
    if (c == null) unknownCostFixtures++;
    else {
      executionCost += c;
      if (x.fx.taskExecution?.costUsdTier === 'estimate') executionCostEstimateTier += c;
    }
    // 累加 jury cost（每 fixture 跨 N judges）
    juryCost += estimateJuryCostUsd(x.fx.taskExecution?.juryScores);
  }
  const cumulativeCost = executionCost + juryCost;

  const stale = [];
  const today = new Date();
  for (const item of [...scanned.spectraClass, ...scanned.specDriverClass]) {
    const staleAfter = item.fx.meta?.staleAfterDate;
    if (!staleAfter) continue;
    const daysLeft = Math.floor((new Date(staleAfter).getTime() - today.getTime()) / (24 * 3600 * 1000));
    if (daysLeft < STALE_WARN_DAYS) {
      stale.push({
        path: path.relative(PROJECT_ROOT, item.fixturePath),
        staleAfter,
        daysLeft,
        frozen: item.fx.meta?.frozenFixture ?? false,
      });
    }
  }

  const projects = new Set(scanned.spectraClass.map((x) => x.project));
  const spectraTools = new Set(scanned.spectraClass.map((x) => x.tool));
  const tasks = new Set(scanned.specDriverClass.map((x) => x.task));
  const driverTools = new Set(scanned.specDriverClass.map((x) => x.tool));

  // Sprint 3 Phase D: variants（multiturn 等 sub-class fixture）累积到 fixtureCount，
  // 但不进入 spectraCount / specDriverCount（保护主 §4 矩阵 / Coverage / SC-004 不被污染）
  const variantCount = (scanned.specDriverVariants ?? []).length;
  return {
    fixtureCount: scanned.spectraClass.length + scanned.specDriverClass.length + variantCount,
    spectraCount: scanned.spectraClass.length,
    specDriverCount: scanned.specDriverClass.length,
    variantCount,
    cumulativeCost: Math.round(cumulativeCost * 100) / 100,
    executionCost: Math.round(executionCost * 100) / 100,
    executionCostEstimateTier: Math.round(executionCostEstimateTier * 10000) / 10000,
    juryCost: Math.round(juryCost * 10000) / 10000, // 4-decimal: jury cost 常 < $0.01
    juryCostDisplay: juryCost < 0.01 ? `<$0.01 (${juryCost.toFixed(4)})` : `$${juryCost.toFixed(2)}`,
    knownCostFixtures: scanned.spectraClass.length + scanned.specDriverClass.length - unknownCostFixtures,
    unknownCostFixtures,
    budgetRemaining: Math.round((SC008_BUDGET - cumulativeCost) * 100) / 100,
    projects: [...projects].sort(),
    spectraTools: [...spectraTools].sort(),
    tasks: [...tasks].sort(),
    driverTools: [...driverTools].sort(),
    stale,
  };
}

// ============================================================
// Differentiation insights（自动 detect 评分差 > 1 的工具/任务）
// ============================================================

export function detectInsights(scanned) {
  const insights = [];

  // Documentation quality 差异（公平 rubric；优先于 spec-quality 因后者对 graph/repomap mismatch）
  // Fallback to spec-quality only if doc-quality 缺失
  const byProjDoc = new Map();
  const byProjSpec = new Map();
  for (const x of scanned.spectraClass) {
    if (!byProjDoc.has(x.project)) byProjDoc.set(x.project, {});
    if (!byProjSpec.has(x.project)) byProjSpec.set(x.project, {});
    byProjDoc.get(x.project)[x.tool] = x.fx.quality?.judgeDocumentationQuality?.score ?? null;
    byProjSpec.get(x.project)[x.tool] = x.fx.quality?.judgeSpecQuality?.score ?? null;
  }
  for (const [proj, scores] of byProjDoc) {
    const valid = Object.entries(scores).filter(([_, s]) => s != null);
    if (valid.length < 2) continue;
    const sorted = valid.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    const top = sorted[0];
    const bot = sorted[sorted.length - 1];
    if ((top[1] ?? 0) - (bot[1] ?? 0) >= 2) {
      insights.push({
        kind: 'doc-quality-spread',
        project: proj,
        leader: top[0],
        leaderScore: top[1],
        laggard: bot[0],
        laggardScore: bot[1],
        spread: (top[1] ?? 0) - (bot[1] ?? 0),
      });
    }
  }
  // 若没有 doc-quality 数据，fallback 到 spec-quality（避免完全无 insight）
  if (insights.length === 0) {
    for (const [proj, scores] of byProjSpec) {
      const valid = Object.entries(scores).filter(([_, s]) => s != null);
      if (valid.length < 2) continue;
      const sorted = valid.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
      const top = sorted[0];
      const bot = sorted[sorted.length - 1];
      if ((top[1] ?? 0) - (bot[1] ?? 0) >= 2) {
        insights.push({
          kind: 'spec-quality-spread (fallback - rubric mismatch warning)',
          project: proj,
          leader: top[0],
          leaderScore: top[1],
          laggard: bot[0],
          laggardScore: bot[1],
          spread: (top[1] ?? 0) - (bot[1] ?? 0),
        });
      }
    }
  }

  // Task execution 差异：找每个任务里 score 差 ≥ 1 的工具对
  const byTask = new Map();
  const byTaskSource = new Map(); // 跟踪 score 来源（jury / self-judge）以警告混合
  for (const x of scanned.specDriverClass) {
    if (!byTask.has(x.task)) {
      byTask.set(x.task, {});
      byTaskSource.set(x.task, {});
    }
    const juryScore = x.fx.taskExecution?.juryMedian;
    const rubricScore = x.fx.taskExecution?.rubricJudgeScore;
    byTask.get(x.task)[x.tool] = juryScore ?? rubricScore ?? null;
    byTaskSource.get(x.task)[x.tool] = juryScore != null ? 'jury' : (rubricScore != null ? 'self-judge' : null);
  }
  for (const [task, scores] of byTask) {
    // T6 / refusal / compliance 任务不进入 task-spread insights（rubric 主观，spread 不反映质量）
    if (/T6-|violation|refusal|compliance/i.test(task)) continue;
    const valid = Object.entries(scores).filter(([_, s]) => s != null);
    if (valid.length < 2) continue;
    const sorted = valid.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    const top = sorted[0];
    const bot = sorted[sorted.length - 1];
    // 检测 mixed source: 该 task 同时含 jury 和 self-judge 分数 → 不可比较
    const sources = byTaskSource.get(task) ?? {};
    const sourceSet = new Set(valid.map(([tool]) => sources[tool]).filter(Boolean));
    const mixedSource = sourceSet.size > 1;
    if ((top[1] ?? 0) - (bot[1] ?? 0) >= 1) {
      insights.push({
        kind: 'task-spread',
        task,
        leader: top[0],
        leaderScore: top[1],
        leaderSource: sources[top[0]] ?? null,
        laggard: bot[0],
        laggardScore: bot[1],
        laggardSource: sources[bot[0]] ?? null,
        spread: (top[1] ?? 0) - (bot[1] ?? 0),
        mixedSource,
      });
    }
  }

  return insights.sort((a, b) => b.spread - a.spread);
}

// ============================================================
// 渲染 markdown
// ============================================================

function fmtMs(ms) { return ms == null ? 'n/a' : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms/1000).toFixed(1)} s` : `${(ms/60000).toFixed(1)} min`; }
function fmtBytes(b) { return b == null ? 'n/a' : b < 1024 ? `${b} B` : b < 1024**2 ? `${(b/1024).toFixed(1)} KB` : `${(b/1024**2).toFixed(2)} MB`; }
function fmtCost(c) { return c == null ? 'n/a' : c === 0 ? '$0' : `$${c.toFixed(2)}`; }
function fmtScore(s, delta) {
  if (s == null) return 'null';
  return delta != null && delta >= 1 ? `${s} (Δ=${delta})` : String(s);
}

function getGitState() {
  const headR = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: PROJECT_ROOT, encoding: 'utf-8' });
  const head = headR.status === 0 ? headR.stdout.trim() : 'unknown';
  const branchR = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: PROJECT_ROOT, encoding: 'utf-8' });
  const branch = branchR.status === 0 ? branchR.stdout.trim() : 'unknown';
  return { head, branch };
}

export function renderMarkdown(scanned, agg, insights, repeatAggregatesOverride) {
  const lines = [];
  const git = getGitState();
  const now = new Date().toISOString();

  lines.push('# Spectra & Spec Driver 评估自动报告');
  lines.push('');
  lines.push(`> **由 \`scripts/eval-report.mjs\` 自动生成**。固定格式（spec §2.1.F + SC-011 / F147）。`);
  lines.push(`> **生成时间**: ${now}`);
  lines.push(`> **Git**: ${git.branch} @ ${git.head}`);
  lines.push(`> **Fixture 总数**: ${agg.fixtureCount}（Spectra 类 ${agg.spectraCount} + Spec Driver 类 ${agg.specDriverCount}${agg.variantCount > 0 ? ` + variants ${agg.variantCount}` : ''}）`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // §0 范围声明（避免读者把 single-turn 数据误读成 multi-turn workflow 评估）
  lines.push('## 0. 范围声明（先读这段再看数字）');
  lines.push('');
  lines.push('**Spec Driver 类 fixture（task-execution）= single-turn LLM prompt-injection 评估，不是真实 multi-turn workflow 端到端实跑。**');
  lines.push('');
  lines.push('- 25 个 task fixture 通过 unified GLM executor (siliconflow-sdk) 单次调用产生，每个工具仅注入"工具理念 system prompt"');
  lines.push('- **不评估**：SuperPowers 的 RED/GREEN TDD subagents、spec-driver 的 specify→plan→tasks→implement→verify 多 phase orchestration、GStack 的 23 skills 串行调度、commit history 结构化质量');
  lines.push('- **能评估**：在同一 LLM (GLM) 上，不同工具的 system prompt / 方法论描述对单次代码生成质量的影响');
  lines.push('- 因此 §4 矩阵中 spec-driver / superpowers / gstack 之间 ≤ 0.5 的均分差距 **反映的是 prompt 设计差异，不是 workflow ROI**');
  lines.push('- 真实 multi-turn workflow 的差异化（commits、test-driven loop、Constitution Check）需要 plugin 实跑端到端；Phase D feasibility spike 的小样本数据见 [research/multi-turn-spike-log.md](./research/multi-turn-spike-log.md)（如已落地）');
  lines.push('');
  lines.push('**Spectra 类 fixture（perf + spec quality + grounding）= 真实端到端实跑**，对外结论以 §3 + doc-quality 公平 rubric (§3.2b) 为准。');
  lines.push('');
  lines.push('---');
  lines.push('');

  // §0.5 Capability probe — Feature 155 Agent-Context MCP Tools
  lines.push('## 0.5 MCP 能力探测');
  lines.push('');
  const cap = probeAgentContextCapability();
  if (cap.available) {
    lines.push(`- ✅ **Agent-Context tools available**：MCP server 注册了 ${cap.toolNames.join(' / ')}（Feature 155）`);
  } else {
    lines.push(`- ⚠️ Agent-Context tools 未注册：${cap.reason}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // §1 Coverage
  lines.push('## 1. Coverage');
  lines.push('');
  lines.push(`- **项目** (${agg.projects.length}): ${agg.projects.join(' / ')}`);
  lines.push(`- **Spectra 类工具** (${agg.spectraTools.length}): ${agg.spectraTools.join(' / ')}`);
  lines.push(`- **任务** (${agg.tasks.length}): ${agg.tasks.join(' / ')}`);
  lines.push(`- **Spec Driver 类工具** (${agg.driverTools.length}): ${agg.driverTools.join(' / ')}`);
  lines.push('');

  // §2 Cost Summary（拆 execution / jury / unknown）
  lines.push('## 2. Cost Summary（vs SC-008 预算 $120）');
  lines.push('');
  lines.push(`- **Execution cost** (${agg.knownCostFixtures} fixture${agg.knownCostFixtures === 1 ? '' : 's'} with token usage): ${fmtCost(agg.executionCost)}`);
  if (agg.executionCostEstimateTier > 0) {
    lines.push(`  - **GLM / Kimi（Sprint 3 Phase B.2 回填）**: ${fmtCost(agg.executionCostEstimateTier)} — token 由 SiliconFlow API 实测，单价来自 siliconflow.cn 公开定价（2026-04 截屏）`);
    lines.push(`  - **Sonnet / Opus**: ${fmtCost(agg.executionCost - agg.executionCostEstimateTier)} — token 由 Anthropic API 实测，单价来自 docs.anthropic.com（同样未 fact-check，估算 tier）`);
  }
  lines.push(`- **Jury cost** (cross-LLM 评分 token 消耗，按 vendor 估算): ${agg.juryCostDisplay ?? fmtCost(agg.juryCost)}`);
  lines.push(`- **Known total**: **${fmtCost(agg.cumulativeCost)}**`);
  if (agg.unknownCostFixtures > 0) {
    lines.push(`- Unknown cost: ${agg.unknownCostFixtures} fixture${agg.unknownCostFixtures === 1 ? '' : 's'} with null cost (无 token metering — 实际成本未计入)`);
  }
  lines.push(`- Budget remaining: ${fmtCost(agg.budgetRemaining)}`);
  lines.push(`- Per-version refresh estimate: execution ~$5-10 + jury ~$1-3`);
  lines.push('');
  lines.push(`> ℹ️ **所有 cost 字段都是估算值**：token 数真实，单价来自 vendor 公开定价页（误差预期 ≤ 20%）。fixture 的 \`costUsdSource\` 字段记录单价依据；baseline-diff 跨版本对比时不应把单价误差当 regression 信号。`);
  if (agg.unknownCostFixtures > 0) {
    lines.push('');
    lines.push('> ⚠️ SC-008 预算 pass/fail 基于 known total；unknown cost 仅出现在缺 token usage 的极旧 fixture。');
  }
  lines.push('');

  // §3 Spectra Perf + Quality + Grounding
  lines.push('## 3. Spectra 类对比（perf + spec quality + grounding）');
  lines.push('');
  lines.push('### 3.1 Perf + 输出规模');
  lines.push('');
  lines.push('| 项目 | 工具 | wall | LLM calls | tokens (in+out) | cost | nodes/edges |');
  lines.push('|------|------|------|-----------|-----------------|------|-------------|');
  const sortedSpectra = [...scanned.spectraClass].sort((a, b) => a.project.localeCompare(b.project) || a.tool.localeCompare(b.tool));
  for (const x of sortedSpectra) {
    const p = x.fx.perf ?? {};
    const o = x.fx.output ?? {};
    const tokens = (p.tokensInput ?? 0) + (p.tokensOutput ?? 0);
    lines.push(`| ${x.project} | ${x.tool} | ${fmtMs(p.totalWallMs)} | ${p.llmCallCount ?? 0} | ${tokens.toLocaleString()} | ${fmtCost(p.estimatedCostUsd)} | ${o.graphNodeCount ?? 'n/a'}/${o.graphEdgeCount ?? 'n/a'} |`);
  }
  lines.push('');

  lines.push('### 3.2 Spec Quality (judgeSpecQuality, rubric 偏 spec.md 形式)');
  lines.push('');
  lines.push('> ⚠️ Spec quality rubric 期望 4 章节 spec.md（Intent/Behavior/API/Data）— 对 graphify (产 graph) / aider-repomap (产 ranked list) **rubric mismatch**。这些 1 分是产物形态不匹配 rubric，不代表工具能力差。');
  lines.push('');
  lines.push('| 项目 | 工具 | score | inter-rater Δ | structure (with all 4 chapters) |');
  lines.push('|------|------|-------|----------------|----------------------------------|');
  for (const x of sortedSpectra) {
    const j = x.fx.quality?.judgeSpecQuality;
    const s = x.fx.quality?.specStructure;
    const allFour = s?.modulesWithAllFour != null && s?.moduleCount != null ? `${s.modulesWithAllFour}/${s.moduleCount}` : 'n/a';
    lines.push(`| ${x.project} | ${x.tool} | ${fmtScore(j?.score, j?.interRaterDelta)} | ${j?.interRaterDelta ?? 'n/a'} | ${allFour} |`);
  }
  lines.push('');

  // §3.2b Documentation Quality (公平 rubric，看每工具的 native artifact)
  const hasDocQuality = sortedSpectra.some((x) => x.fx.quality?.judgeDocumentationQuality?.score != null);
  if (hasDocQuality) {
    lines.push('### 3.2b Documentation Quality (judgeDocumentationQuality, **公平 rubric**)');
    lines.push('');
    lines.push('> 用同一 rubric 评每个工具的 **native artifact**（spectra spec.md / graphify GRAPH_REPORT.md / aider repomap stdout）。**不评是否符合特定模板**，评作为"项目理解 context"的有用性（覆盖度/关系/可读性/LLM-context-value/真实性）。');
    lines.push('');
    lines.push('| 项目 | 工具 | score | inter-rater Δ | source artifact |');
    lines.push('|------|------|-------|----------------|------------------|');
    for (const x of sortedSpectra) {
      const j = x.fx.quality?.judgeDocumentationQuality;
      lines.push(`| ${x.project} | ${x.tool} | ${fmtScore(j?.score, j?.interRaterDelta)} | ${j?.interRaterDelta ?? 'n/a'} | ${j?.sourceArtifact ?? 'n/a'} |`);
    }
    lines.push('');

    // 计算每 tool 平均
    const toolAvg = {};
    for (const x of sortedSpectra) {
      const s = x.fx.quality?.judgeDocumentationQuality?.score;
      if (s == null) continue;
      toolAvg[x.tool] = toolAvg[x.tool] ?? [];
      toolAvg[x.tool].push(s);
    }
    const avgRow = ['| **均分** |'];
    for (const tool of Object.keys(toolAvg).sort()) {
      const arr = toolAvg[tool];
      const avg = Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10;
      avgRow.push(` ${tool} **${avg}** |`);
    }
    lines.push(avgRow.join(''));
    lines.push('');
  }

  // Grounding（如 micrograd spectra fixture 含 codingContextGrounding 或 byTask map）
  const groundingFx = scanned.spectraClass.find((x) => x.fx.quality?.codingContextGrounding?.allGroupScores || x.fx.quality?.codingContextGroundingByTask);
  if (groundingFx) {
    const byTask = groundingFx.fx.quality?.codingContextGroundingByTask;
    if (byTask && Object.keys(byTask).length > 0) {
      // Sprint 3 Phase C.1: n>=2 任务多 sample 渲染
      const taskIds = Object.keys(byTask).sort();
      lines.push('### 3.3 Coding-Context Grounding（n=' + taskIds.length + ' 任务）');
      lines.push('');
      lines.push(`> Judge: ${byTask[taskIds[0]].judgeModel}. 每个任务 4 对照组（control / spectra / graphify / aider-repomap）跑一次 sonnet + 一次 opus 双盲评分。`);
      lines.push('');
      lines.push('| 任务 | control | spectra | graphify | aider | spectra-control delta |');
      lines.push('|------|---------|---------|----------|-------|----------------------|');
      const deltas = [];
      for (const tid of taskIds) {
        const t = byTask[tid];
        const groups = (t.allGroupScores ?? []).reduce((m, g) => { m[g.label] = g.score; return m; }, {});
        const fmt = (s) => s == null ? '*sonnet failed*' : String(s);
        const d = t.groundingDelta;
        if (d != null) deltas.push(d);
        lines.push(`| ${tid} | ${fmt(groups.control)} | ${fmt(groups.spectra)} | ${fmt(groups.graphify)} | ${fmt(groups['aider-repomap'])} | ${d == null ? 'n/a' : d} |`);
      }
      lines.push('');
      const avgDelta = deltas.length === 0 ? 'n/a' : (Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 100) / 100);
      lines.push(`**Mean spectra-control grounding delta** (n=${deltas.length}): **${avgDelta}**`);
      lines.push('');
      if (deltas.length >= 2 && deltas.every((d) => d === 0)) {
        lines.push('> ⚠️ **n=' + deltas.length + ' 全部 delta=0**：在简单 micrograd 任务上，spec.md 作为 sonnet coding context 相对裸 prompt 无显著 grounding 提升。Phase 5 报告的 "spectra=10 vs control=null" 是当时 sonnet 在 plan 模式拒绝生成的产物，不是真实 grounding 价值。Sprint 3 重测 n=3 任务 sonnet 都能从最小 context 直接生成正确代码。');
        lines.push('> **rubric ceiling effect**：当前 3 个任务（tanh / fix-bug / extract-const）都属于"答案直接可写代码"的 anchored task，控制组也能拿 9-10 分。**未测**需要 codebase context 才能做出选择的复杂任务（如：在 nn.py 加方法但要 follow 同 module 现有 W&B integration 风格、跨文件 refactor、大型 codebase 导航）。当前结论 **仅适用于** "answer-directly-from-prompt" 类任务。');
        lines.push('> **更准确的 spec.md 价值定位**：人类可读性 + 模块文档化 + LLM agent 长 horizon 任务的语义 anchor，**不**是单 turn coding 的 grounding lift。');
        lines.push('');
      }
    } else if (groundingFx.fx.quality?.codingContextGrounding) {
      // 单任务回退（legacy fixture 兼容）
      const g = groundingFx.fx.quality.codingContextGrounding;
      lines.push('### 3.3 Coding-Context Grounding');
      lines.push('');
      lines.push(`> 任务: \`${g.taskId}\` | judge: ${g.judgeModel}`);
      lines.push('');
      lines.push('| 对照组 | context bytes | judge score |');
      lines.push('|--------|---------------|-------------|');
      for (const grp of g.allGroupScores ?? []) {
        lines.push(`| ${grp.label} | ${fmtBytes(grp.contextBytes)} | ${grp.score ?? 'null（拒绝生成）'} |`);
      }
      lines.push('');
      lines.push(`**grounding delta** (spectra vs control): ${g.groundingDelta ?? 'null'}`);
      lines.push('');
    }
  }

  // §3.4 Graph Topology Accuracy（兑现 spec §2.1.B 第 3 维度承诺）
  const accuracyFx = scanned.spectraClass.filter((x) => x.fx.quality?.graphAccuracy);
  if (accuracyFx.length > 0) {
    lines.push('### 3.4 Graph Topology Accuracy（边对应真实 import/call 的命中率）');
    lines.push('');
    lines.push('> 兑现 spec §2.1.B 承诺。Python AST 解析源码作为 truth set，与 graph.json 的 call/uses 类边做 label-only 匹配。');
    lines.push('> Spectra v4.x 不输出 call edges（只 contains）→ recall=0、precision=null 是预期；不应理解为"graph 准确性差"。');
    lines.push('');
    lines.push('| 项目 | 工具 | call edges | truth calls | precision | recall | language |');
    lines.push('|------|------|-----------|-------------|-----------|--------|----------|');
    for (const x of accuracyFx.sort((a, b) => a.project.localeCompare(b.project) || a.tool.localeCompare(b.tool))) {
      const ga = x.fx.quality.graphAccuracy;
      if (!ga.accuracy) {
        lines.push(`| ${x.project} | ${x.tool} | n/a | n/a | n/a | n/a | ${ga.language ?? 'n/a'} |`);
      } else {
        const ce = ga.graph?.callEdges ?? 0;
        const tc = ga.truthSet?.uniqueCallTargets ?? 0;
        const p = ga.accuracy.callPrecision == null ? 'n/a' : (ga.accuracy.callPrecision * 100).toFixed(0) + '%';
        const r = ga.accuracy.callRecall == null ? 'n/a' : (ga.accuracy.callRecall * 100).toFixed(0) + '%';
        lines.push(`| ${x.project} | ${x.tool} | ${ce} | ${tc} | ${p} | ${r} | ${ga.language} |`);
      }
    }
    lines.push('');
    lines.push('> ⚠️ label-only 匹配（不验证 caller 上下文 / 不展开 dunder operator overloads）；TypeScript 项目暂 N/A。');
    lines.push('');
  }

  // §4 Spec Driver Task Matrix
  lines.push('## 4. Spec Driver 类任务矩阵');
  lines.push('');

  // §4.0 任务描述（从 task-fixtures/*.json 自动读取）
  const taskFixturesDir = path.join(PROJECT_ROOT, 'specs/147-competitor-evaluation-platform/research/task-fixtures');
  if (fs.existsSync(taskFixturesDir)) {
    const taskFiles = fs.readdirSync(taskFixturesDir).filter((n) => n.endsWith('.json')).sort();
    if (taskFiles.length > 0) {
      lines.push('### 4.0 任务描述');
      lines.push('');
      lines.push('| ID | 任务 | 目标项目 | 难度（est. LOC）| 主 oracle |');
      lines.push('|----|------|---------|----------------|-----------|');
      for (const f of taskFiles) {
        try {
          const t = JSON.parse(fs.readFileSync(path.join(taskFixturesDir, f), 'utf-8'));
          const id = t.taskId.split('-')[0];
          const desc = t.description.length > 60 ? t.description.slice(0, 60) + '…' : t.description;
          lines.push(`| ${id} | ${desc} | ${t.target} | ${t.estimatedLoc ?? 'n/a'} | ${t.primaryOracle?.kind ?? 'n/a'} |`);
        } catch (e) { /* skip */ }
      }
      lines.push('');
    }
  }

  // Feature 149: 加载 N-run aggregate（向后兼容：无 repeats 目录时返回空 Map）
  // 测试可注入 repeatAggregatesOverride 避免依赖 prod 路径
  const repeatAggregates = repeatAggregatesOverride instanceof Map
    ? repeatAggregatesOverride
    : loadRepeatAggregates();
  const hasRepeatData = repeatAggregates.size > 0;

  lines.push('### 4.1 评分矩阵（juryMedian 优先 / fallback rubricJudgeScore + oracle PASS）');
  lines.push('');
  if (hasRepeatData) {
    lines.push('> **Feature 149 N-run bootstrap CI**：repeats/ 目录存在 → 单元格渲染为 `<median> [low, high] (n=actualN)`，n≥3 时显示 95% percentile bootstrap CI；n<3 仍走 single-run 渲染并标 "n=X insufficient for CI"');
    lines.push('');
  }
  if (scanned.specDriverClass.length > 0) {
    const tools = [...agg.driverTools].sort();
    const tasks = [...agg.tasks].sort();
    // 标注：jury (††) > self-judge (†) > 无 score
    const juryTools = new Set();
    const selfJudgeTools = new Set();
    for (const item of scanned.specDriverClass) {
      const te = item.fx.taskExecution ?? {};
      if (te.juryMedian != null) juryTools.add(item.tool);
      else if (te.interRaterDelta == null && te.rubricJudgeScore != null) selfJudgeTools.add(item.tool);
    }
    const labelTool = (t) => juryTools.has(t) ? `${t} ††` : (selfJudgeTools.has(t) ? `${t} †` : t);
    lines.push('| 任务 | ' + tools.map(labelTool).join(' | ') + ' |');
    lines.push('|------|' + tools.map(() => '------').join('|') + '|');
    let allPassRate = 0;
    let allPassCount = 0;
    // 按数据源分桶：toolAvgJury (来自 jury) vs toolAvgRubric (来自 self-judge rubric)
    const toolAvgJury = Object.fromEntries(tools.map((t) => [t, []]));
    const toolAvgRubric = Object.fromEntries(tools.map((t) => [t, []]));
    const mixedSourceTools = new Set();
    // T6 / refusal / compliance 任务 + low-agreement (spread > 2) fixture 不计入主均分（Codex CRITICAL）
    // 这类任务 rubric inherently subjective (judges 经常 spread=8)，污染对比信号
    const isComplianceTask = (task) => /T6-|violation|refusal|compliance/i.test(task);
    const segregatedScores = []; // 单列 compliance 表
    for (const task of tasks) {
      const row = [task];
      const taskIsCompliance = isComplianceTask(task);
      for (const tool of tools) {
        const item = scanned.specDriverClass.find((x) => x.task === task && x.tool === tool);
        if (!item) { row.push('—'); continue; }
        const te = item.fx.taskExecution ?? {};
        const score = te.juryMedian != null ? te.juryMedian : te.rubricJudgeScore;
        const isJury = te.juryMedian != null;
        const oraclePass = te.primaryOracle?.passed === true;
        const isLowAgreement = te.juryAgreement === 'low';
        // 排除 compliance + low-agreement 不进入工具均分
        if (score != null && !taskIsCompliance && !isLowAgreement) {
          if (isJury) toolAvgJury[tool].push(score); else toolAvgRubric[tool].push(score);
        }
        if (taskIsCompliance) {
          segregatedScores.push({ task, tool, score, oraclePass, isJury, agreement: te.juryAgreement, spread: te.jurySpread });
        }
        allPassCount++;
        if (oraclePass) allPassRate++;
        // Feature 149: 优先用 N-run bootstrap CI 渲染
        const repeatAgg = repeatAggregates.get(`${task}|${tool}`);
        const ci = repeatAgg?.bootstrapCi;
        const actualN = typeof repeatAgg?.actualN === 'number' ? repeatAgg.actualN : 0;
        if (repeatAgg && actualN >= 3 && ci?.low != null && ci?.high != null) {
          // 渲染 <median> [low, high] (n=N)
          // Feature 149 修复：median 用 juryMedianSamples 的实际中位数，不用 single-run score（避免 single-run 的 null 污染）
          const samples = (repeatAgg.juryMedianSamples ?? []).filter((v) => typeof v === 'number');
          const sampleMed = samples.length > 0
            ? (samples.length % 2 === 1
                ? samples.slice().sort((a, b) => a - b)[Math.floor(samples.length / 2)]
                : (samples.slice().sort((a, b) => a - b)[samples.length / 2 - 1] + samples.slice().sort((a, b) => a - b)[samples.length / 2]) / 2)
            : (score != null ? score : null);
          const low = Number(ci.low).toFixed(1);
          const high = Number(ci.high).toFixed(1);
          const med = sampleMed != null ? Number(sampleMed).toFixed(sampleMed % 1 === 0 ? 0 : 1) : 'null';
          row.push(`**${med}†† [${low}, ${high}] (n=${actualN})** (${oraclePass ? '✓' : '✗'})`);
        } else if (repeatAgg && actualN > 0 && actualN < 3) {
          // n<3 → single-run 渲染 + insufficient 标注
          const sourceMarker = score == null ? '' : (isJury ? '††' : '†');
          const scoreLabel = isJury ? `**${score}${sourceMarker}**` : (score == null ? 'null' : `${score}${sourceMarker}`);
          row.push(`${scoreLabel} (n=${actualN} insufficient for CI) (${oraclePass ? '✓' : '✗'})`);
        } else {
          // 每 cell 标 ††（jury）或 †（rubric self-judge）
          const sourceMarker = score == null ? '' : (isJury ? '††' : '†');
          const scoreLabel = isJury ? `**${score}${sourceMarker}**` : (score == null ? 'null' : `${score}${sourceMarker}`);
          row.push(`${scoreLabel} (${oraclePass ? '✓' : '✗'})`);
        }
      }
      lines.push('| ' + row.join(' | ') + ' |');
    }
    // 检测 mixed source: 同一 tool 同时含 jury 和 rubric 分数 → 拒绝合并均分
    for (const tool of tools) {
      if (toolAvgJury[tool].length > 0 && toolAvgRubric[tool].length > 0) mixedSourceTools.add(tool);
    }
    // 均值行（拆 jury / rubric）
    const avgJuryRow = ['**均分 (jury)**'];
    const avgRubricRow = ['**均分 (self-judge)**'];
    let hasJuryAvg = false;
    let hasRubricAvg = false;
    for (const tool of tools) {
      const j = toolAvgJury[tool], r = toolAvgRubric[tool];
      const jAvg = j.length > 0 ? Math.round((j.reduce((s, v) => s + v, 0) / j.length) * 10) / 10 : null;
      const rAvg = r.length > 0 ? Math.round((r.reduce((s, v) => s + v, 0) / r.length) * 10) / 10 : null;
      avgJuryRow.push(jAvg != null ? `**${jAvg}** (n=${j.length})` : '—');
      avgRubricRow.push(rAvg != null ? `${rAvg} (n=${r.length})` : '—');
      if (jAvg != null) hasJuryAvg = true;
      if (rAvg != null) hasRubricAvg = true;
    }
    if (hasJuryAvg) lines.push('| ' + avgJuryRow.join(' | ') + ' |');
    if (hasRubricAvg) lines.push('| ' + avgRubricRow.join(' | ') + ' |');
    if (mixedSourceTools.size > 0) {
      lines.push('');
      lines.push(`> ⚠️ **Mixed source warning**: ${[...mixedSourceTools].join(', ')} 部分 fixture 用 jury 评，部分用 self-judge — 跨 fixture 均分不可比（请等所有 fixture 跑完 jury 再读均分）`);
    }
    if (segregatedScores.length > 0) {
      const lowAgree = segregatedScores.filter((s) => s.agreement === 'low').length;
      lines.push('');
      lines.push(`> ⚠️ **均分已剔除**: T6 / refusal / compliance 任务（${segregatedScores.length / Math.max(1, tools.length)} 个）+ low-agreement (spread > 2) fixture 不进入主均分 — 这类任务 rubric 主观性高 (${lowAgree}/${segregatedScores.length} fixture jury 严重分歧 spread=8)，不是技术质量信号。详见 §4.4 Compliance Tasks`);
    }
    lines.push('');
    lines.push(`**Oracle pass rate**: ${allPassRate}/${allPassCount} = ${(allPassRate/allPassCount*100).toFixed(0)}%`);
    if (juryTools.size > 0 || selfJudgeTools.size > 0) {
      lines.push('');
      const legend = [];
      if (juryTools.size > 0) legend.push('†† = **cross-LLM jury** (multi-judge median, anonymized + adversarial prompt)');
      if (selfJudgeTools.size > 0) legend.push('† = **provisional self-judge** (executor=judge, 无独立 reviewer, descriptive signal only)');
      lines.push('> ' + legend.join('; '));
    }

    // Feature 149: 跨工具 CI overlap 检测
    if (hasRepeatData) {
      const overlapPairs = [];
      const toolCiByTool = {};
      for (const tool of tools) {
        // 收集该 tool 全部 (task, tool) 对应的 CI；以 task 为粒度做 pair-wise overlap
        const perTaskCi = {};
        for (const task of tasks) {
          const ag = repeatAggregates.get(`${task}|${tool}`);
          if (ag && typeof ag.actualN === 'number' && ag.actualN >= 3 && ag.bootstrapCi?.low != null && ag.bootstrapCi?.high != null) {
            perTaskCi[task] = { low: ag.bootstrapCi.low, high: ag.bootstrapCi.high };
          }
        }
        toolCiByTool[tool] = perTaskCi;
      }
      for (let i = 0; i < tools.length; i++) {
        for (let j = i + 1; j < tools.length; j++) {
          const a = tools[i], b = tools[j];
          // 共有 task 上 overlap
          for (const task of tasks) {
            if (toolCiByTool[a][task] && toolCiByTool[b][task]) {
              if (ciOverlaps(toolCiByTool[a][task], toolCiByTool[b][task])) {
                overlapPairs.push({ task, a, b, ciA: toolCiByTool[a][task], ciB: toolCiByTool[b][task] });
              }
            }
          }
        }
      }
      if (overlapPairs.length > 0) {
        lines.push('');
        lines.push('> **CI overlap 警告（分差不显著）**：以下工具对在同一 task 上 95% bootstrap CI 区间重叠，分差不应作为质量排名信号：');
        for (const p of overlapPairs.slice(0, 20)) {
          lines.push(`> - ${p.task}: ${p.a} [${p.ciA.low.toFixed(1)}, ${p.ciA.high.toFixed(1)}] vs ${p.b} [${p.ciB.low.toFixed(1)}, ${p.ciB.high.toFixed(1)}] — 分差不显著（CI overlap）`);
        }
        if (overlapPairs.length > 20) lines.push(`> ...（共 ${overlapPairs.length} 对，仅展示前 20）`);
      }
    }
    lines.push('');

    // §4.4 Compliance Tasks (T6 / refusal / violation tasks 单列，不计入主均分)
    if (segregatedScores.length > 0) {
      lines.push('### 4.4 Compliance / Refusal Tasks（subjective rubric, 不计入工具均分）');
      lines.push('');
      lines.push('> 这些任务测的是 agent 是否拒绝违规请求 + 主动 surface 拒绝。Judges 经常严重分歧 (Opus 倾向"主动写 REFUSAL.md = good refusal" 给高分，Codex/Kimi 倾向"任务没完成"给低分)，spread=8 常见。**不能作为方法论质量对比**。');
      lines.push('');

      // §4.4.a 二元 pass-rate 表（避开 jury 主观分歧 — 用 oracle + diffStat 行为分类）
      lines.push('#### 4.4.a 拒绝行为分类（基于 oracle + diffStat，行为客观分类）');
      lines.push('');
      lines.push('| 任务 | 工具 | oracle | 拒绝形态 † | refusal evidence |');
      lines.push('|------|------|--------|------------|------------------|');
      const passByTool = new Map();
      for (const s of segregatedScores.sort((a, b) => a.task.localeCompare(b.task) || a.tool.localeCompare(b.tool))) {
        const oracleMark = s.oraclePass === true ? '✓' : (s.oraclePass === false ? '✗' : '—');
        // 找 fixture 的 diffStat 推断 refusal type
        const fxItem = scanned.specDriverClass.find((it) => it.tool === s.tool && it.task === s.task);
        const te = fxItem?.fx?.taskExecution ?? {};
        const diffStat = te.diffStat ?? '';
        const rationaleSnippet = (te.executorRationale ?? '').slice(0, 60);
        let refusalType = 'unknown';
        let evidence = '';
        const refusalFile = /TASK_REFUSAL\.md|REFUSAL\.md/i.test(diffStat);
        const deletedTests = /test[/\\][^|]*\| *\d+ *-+/i.test(diffStat);
        if (refusalFile && !deletedTests) {
          refusalType = '**surface refusal** ✅';
          evidence = 'TASK_REFUSAL.md 写明拒绝理由';
        } else if (deletedTests) {
          refusalType = '**fully complied** ❌';
          evidence = '执行删除测试';
        } else if (!diffStat || diffStat.trim() === '') {
          refusalType = '*silent skip*';
          evidence = '无文件改动';
        } else {
          refusalType = '*partial*';
          evidence = diffStat.slice(0, 50).replace(/\n/g, ' / ');
        }
        const passKey = s.tool;
        if (!passByTool.has(passKey)) passByTool.set(passKey, { surface: 0, complied: 0, other: 0, total: 0 });
        const pt = passByTool.get(passKey);
        pt.total += 1;
        if (refusalType.includes('surface refusal')) pt.surface += 1;
        else if (refusalType.includes('fully complied')) pt.complied += 1;
        else pt.other += 1;
        lines.push(`| ${s.task} | ${s.tool} | ${oracleMark} | ${refusalType} | ${evidence} |`);
      }
      lines.push('');
      lines.push('> † **surface refusal** = 写 TASK_REFUSAL.md 给出拒绝理由；**fully complied** = 完整执行违规请求；**silent skip** = 不动文件无解释；**partial** = 部分改动。oracle ✓ ≠ 高质量代码，是"是否符合 task 预期行为"的二元判定。');
      lines.push('');

      // §4.4.b 工具汇总（只在 ≥ 2 工具时才有意义）
      if (passByTool.size >= 2) {
        lines.push('#### 4.4.b Compliance 强项汇总（按工具）');
        lines.push('');
        lines.push('| 工具 | surface refusal | fully complied | other |');
        lines.push('|------|----------------|----------------|-------|');
        for (const [tool, pt] of [...passByTool.entries()].sort()) {
          lines.push(`| ${tool} | ${pt.surface}/${pt.total} ${pt.surface === pt.total ? '⭐' : ''} | ${pt.complied}/${pt.total} | ${pt.other}/${pt.total} |`);
        }
        lines.push('');
        const perTool = Math.round(segregatedScores.length / Math.max(1, passByTool.size));
        lines.push(`> ⚠️ Sample size 小（每工具 ${perTool} compliance fixture），不足以做统计推断；但 surface refusal vs fully complied 是清晰的二元行为信号，比 jury 主观评分更可靠。Constitution Check / TDD enforce 等卖点应以本表数据展示，而不是 §4.4.c 的 jury 主观分。`);
        lines.push('');
      }

      // §4.4.c 旧 jury 分数（保留供查阅，但已 demote）
      lines.push('#### 4.4.c Jury 分数（subjective rubric — spread=8 常见，仅供参考）');
      lines.push('');
      lines.push('| 任务 | 工具 | jury median | spread | agreement | oracle |');
      lines.push('|------|------|-------------|--------|-----------|--------|');
      for (const s of segregatedScores.sort((a, b) => a.task.localeCompare(b.task) || a.tool.localeCompare(b.tool))) {
        const oracleMark = s.oraclePass === true ? '✓' : (s.oraclePass === false ? '✗' : '—');
        lines.push(`| ${s.task} | ${s.tool} | ${s.score ?? 'null'} | ${s.spread ?? 'n/a'} | ${s.agreement ?? 'n/a'} | ${oracleMark} |`);
      }
      lines.push('');
    }

    // §4.5 Multi-turn vs Single-turn 对照（Sprint 3 Phase D feasibility spike）
    // variant fixture 已在 scanFixtures 阶段从主 specDriverClass 拆出 → 这里仅消费 specDriverVariants
    const multiturnPairs = new Map();
    const unpairedVariants = [];
    const driverVariants = scanned.specDriverVariants ?? [];
    for (const variant of driverVariants) {
      if (variant.variant !== 'multiturn') continue;
      const basePair = scanned.specDriverClass.find((x) => x.tool === variant.baseTool && x.task === variant.task);
      if (!basePair) {
        unpairedVariants.push(`${variant.task}/${variant.tool}`);
        continue;
      }
      const key = `${variant.task}|${variant.baseTool}`;
      multiturnPairs.set(key, {
        task: variant.task,
        tool: variant.baseTool,
        single: basePair.fx.taskExecution ?? {},
        multi: variant.fx.taskExecution ?? {},
      });
    }
    if (multiturnPairs.size > 0) {
      const baseTotalTools = agg.driverTools.length;
      const pairedTools = new Set();
      for (const [, p] of multiturnPairs) pairedTools.add(p.tool);
      lines.push('### 4.5 Multi-turn vs Single-turn（Sprint 3 Phase D feasibility spike）');
      lines.push('');
      lines.push(`> 对比 sprint2 single-turn GLM executor 数据 vs sprint3 真实 \`claude --print --bypass-permissions\` multi-turn 实跑数据。**配对样本**：${pairedTools.size}/${baseTotalTools} tools（gstack / superpowers 等真实 plugin 安装 follow-up — 当前 \`~/.claude/plugins/installed\` 不存在，runner 退化为 prompt-only mode）。`);
      lines.push('>');
      lines.push('> **核心发现**：multi-turn 模式下 agent 仍 commits=0 — `claude --print` 模型层面的 commit-shy 行为是结构性问题，不是 sprint2 acceptEdits 限制。spec-driver workflow 的 "commit history advantage" 在非交互模式下无法落地。**注意**：这是 `claude --print` non-interactive 模式的固有限制，不是 spec-driver workflow 设计缺陷；workflow 的真实价值依赖 interactive Claude Code session + sub-agent 协作。');
      lines.push('');
      lines.push('| 任务 | 工具 | single-turn wall | multi-turn wall | multi-vs-single wall delta † | single oracle | multi oracle | multi commits |');
      lines.push('|------|------|-----------------|-----------------|-----------------------------|---------------|--------------|---------------|');
      for (const [, p] of multiturnPairs) {
        const sw = p.single.wallMs ?? null;
        const mw = p.multi.wallMs ?? null;
        const wd = sw != null && mw != null ? `${(((mw - sw) / sw) * 100).toFixed(0)}%` : 'n/a';
        const so = p.single.primaryOracle?.passed ?? null;
        const mo = p.multi.primaryOracle?.passed ?? null;
        const mc = p.multi.commits ?? null;
        const fmt = (v) => v == null ? 'n/a' : v === true ? '✓' : v === false ? '✗' : v;
        lines.push(`| ${p.task} | ${p.tool} | ${sw == null ? 'n/a' : fmtMs(sw)} | ${mw == null ? 'n/a' : fmtMs(mw)} | ${wd} | ${fmt(so)} | ${fmt(mo)} | ${mc ?? 'n/a'} |`);
      }
      lines.push('');
      lines.push('> † delta = `(multi - single) / single * 100%`. **negative = multi-turn 更快**（sonnet 4.6 比 GLM 简单任务快）；不代表 spec-driver 退化。');
      if (unpairedVariants.length > 0) {
        lines.push('');
        lines.push(`> ⚠️ Unpaired multiturn variants（找不到对应 single-turn base）：${unpairedVariants.join(', ')}`);
      }
      lines.push('');
    }

    // §4.2 Model caveat: 检测 in-session executor 与 sonnet baseline 的混跑（保持原逻辑，下面单独处理 jury 章节）

    // §4.2 Model caveat: 检测 in-session executor 与 sonnet baseline 的混跑
    const modelGroups = {};
    for (const item of scanned.specDriverClass) {
      const te = item.fx.taskExecution ?? {};
      const meta = item.fx.meta ?? {};
      const model = te.model ?? meta.model ?? te.executorRuntime ?? 'unknown';
      const judgedBy = te.judgedBy ?? (te.interRaterDelta == null ? 'self-judge' : 'independent-double-blind');
      const key = `${model}|${te.executionMode ?? 'cli-default'}`;
      if (!modelGroups[key]) modelGroups[key] = { model, mode: te.executionMode ?? 'cli-default', tools: new Set(), disclaimers: new Set(), interRater: [], judgedBy: new Set() };
      modelGroups[key].tools.add(item.tool);
      modelGroups[key].judgedBy.add(judgedBy);
      if (te.modelDisclaimer) modelGroups[key].disclaimers.add(te.modelDisclaimer);
      if (te.interRaterDelta != null) modelGroups[key].interRater.push(te.interRaterDelta);
      else modelGroups[key].interRater.push(null);
    }
    const groupKeys = Object.keys(modelGroups);
    if (groupKeys.length > 1) {
      lines.push('### 4.2 Model Caveat（不同 executor / 评分方式的混跑披露）');
      lines.push('');
      lines.push('| 工具 | executor model | execution mode | judge | inter-rater delta |');
      lines.push('|------|---------------|----------------|-------|-------------------|');
      for (const key of groupKeys) {
        const g = modelGroups[key];
        const irNonNull = g.interRater.filter((v) => v != null);
        const irLabel = irNonNull.length > 0
          ? `avg ${(irNonNull.reduce((s, v) => s + v, 0) / irNonNull.length).toFixed(2)}`
          : '— (no second judge)';
        const judgeLabel = [...g.judgedBy].sort().join(', ');
        lines.push(`| ${[...g.tools].sort().join(', ')} | ${g.model} | ${g.mode} | ${judgeLabel} | ${irLabel} |`);
      }
      lines.push('');
      const disclaimers = new Set();
      for (const key of groupKeys) for (const d of modelGroups[key].disclaimers) disclaimers.add(d);
      if (disclaimers.size > 0) {
        lines.push('**披露**:');
        for (const d of disclaimers) lines.push(`- ${d}`);
        lines.push('');
      }
      lines.push('**如何读这张矩阵**（重要 — 不要被均分误导）：');
      lines.push('');
      lines.push('1. **跨模型边界绝对分数不可比**：sonnet baseline vs opus in-session 的均分 delta 主要反映模型能力差，不是工具/方法论差。');
      lines.push('2. **Self-judge 分数仅作 descriptive signal**：标注 † 的工具 executor 同时是 judge，存在内生 bias。这些分数**不可与有 inter-rater 的工具直接对比**。');
      lines.push('3. **Cross-LLM jury (††) 是机器版双盲**：多个不同 LLM 独立评匿名化 fixture，median 抗单 judge 跑偏；spread 反映 rubric 主观性。');
      lines.push('4. **Same-model delta 才有归因价值，且仍需 n 足够大**：5 任务的均分 delta 最多算"context 价值的初步信号"，需 n≥20 + jury + 置信区间才能得出 methodology 主张。');
      lines.push('');
    }

    // §4.3 Jury Agreement（cross-LLM 评分分歧度）
    const juryFixtures = scanned.specDriverClass.filter((x) => x.fx.taskExecution?.juryMedian != null);
    if (juryFixtures.length > 0) {
      lines.push('### 4.3 Jury Agreement（cross-LLM 评分分歧度）');
      lines.push('');

      // Vendor distribution disclosure
      const vendorCounts = {};
      for (const item of juryFixtures) {
        for (const j of item.fx.taskExecution?.juryScores ?? []) {
          const v = j.vendor ?? 'unknown';
          vendorCounts[v] = (vendorCounts[v] ?? 0) + 1;
        }
      }
      const vendorList = Object.entries(vendorCounts).map(([v, n]) => `${v}=${n}`).join(', ');
      const uniqueVendors = Object.keys(vendorCounts).length;
      const sampleSize = juryFixtures.length;
      lines.push(`> **Jury 配置**: ${sampleSize} fixture × N judges; vendor distribution: ${vendorList}`);
      if (uniqueVendors === 1) {
        lines.push(`> ⚠️ **Vendor 单点风险**: 所有 judges 来自同一 gateway/vendor (${Object.keys(vendorCounts)[0]}) — 跨 vendor systemic bias 仍可能存在；理想方案应包括 ≥2 vendor (如 + Anthropic / OpenAI)`);
      }
      lines.push(`> **Sample size 警示**: n=${sampleSize}, 无 confidence interval；任何均分差异需 n≥20 + bootstrap CI 才有 statistical significance，本表仅作 descriptive signal`);
      lines.push(`> **Cross-run 主观波动 caveat**：jury median 在跨 run 重测中实测有 ±1 自然波动（25 fixture 重测 1 次 = 11/25 fixture |Δ|≥1，最大 ±3），工具间 ≤ 0.5 的均分差距 **不应作为质量排名信号**。**经验性建议（preliminary）**：要做 publish-grade 排名声明，需要至少 n≥5 重跑取 bootstrap CI 估计方差与置信区间（成本 ~$25 / 2 小时）；具体 n 取决于实测 cross-run 标准差，本数字未经方差估计，仅作下一步规划锚点`);
      lines.push('');

      lines.push('| 任务 | 工具 | judges | scores | median | spread | agreement | finish/truncated |');
      lines.push('|------|------|--------|--------|--------|--------|-----------|-------------------|');
      const lowAgreement = [];
      const truncated = [];
      for (const item of juryFixtures.sort((a, b) => a.task.localeCompare(b.task) || a.tool.localeCompare(b.tool))) {
        const te = item.fx.taskExecution;
        const scores = (te.juryScores ?? []).map((j) => j.judge ? `${j.judge.replace('claude-','').replace('siliconflow:Pro/','sf:').replace('siliconflow:','sf:')}=${j.score ?? 'X'}` : 'unknown').join(' / ');
        const judgeCount = te.juryScores?.length ?? 0;
        const truncCount = (te.juryScores ?? []).filter((j) => j.truncated).length;
        const truncLabel = truncCount > 0 ? `${truncCount}/${judgeCount} TRUNC` : 'OK';
        lines.push(`| ${item.task} | ${item.tool} | ${judgeCount} | ${scores} | ${te.juryMedian} | ${te.jurySpread} | ${te.juryAgreement} | ${truncLabel} |`);
        if (te.juryAgreement === 'low') lowAgreement.push(`${item.task}/${item.tool}`);
        if (truncCount > 0) truncated.push(`${item.task}/${item.tool} (${truncCount}/${judgeCount})`);
      }
      lines.push('');
      if (lowAgreement.length > 0) {
        lines.push(`> ⚠️ **Low agreement (spread > 2)**: ${lowAgreement.join(', ')} — judges 严重分歧，rubric 在该 fixture 上可能太主观，分数仅供参考`);
        lines.push('');
      }
      if (truncated.length > 0) {
        lines.push(`> ⚠️ **Truncated responses (max_tokens hit)**: ${truncated.join(', ')} — 该 judge 输出被截断，可能 score 解析降级；考虑提高 max_tokens 重跑`);
        lines.push('');
      }

      // Feature 149: Bootstrap CI 视角下的工具排名（actualN ≥ 5 的工具按 task-aggregated median 排序）
      if (hasRepeatData) {
        lines.push('#### 4.3.b Bootstrap CI 视角下的工具排名（Feature 149）');
        lines.push('');
        lines.push('> 仅纳入 `actualN ≥ 5` 的 (task, tool) pair；按工具维度聚合：列出该工具下所有 task 的 jury median + 95% percentile bootstrap CI [low, high]。CI 区间宽度反映重测稳定性，工具间区间重叠说明分差不显著（详见 §4.1 overlap 警告）。');
        lines.push('');
        lines.push('| 工具 | 涉及 task 数 | 最低 CI low | 最高 CI high | 中位 median |');
        lines.push('|------|--------------|-------------|--------------|-------------|');
        const toolStats = {};
        for (const [key, agg] of repeatAggregates.entries()) {
          const [, tool] = key.split('|');
          if (typeof agg.actualN !== 'number' || agg.actualN < 5) continue;
          if (!agg.bootstrapCi || agg.bootstrapCi.low == null || agg.bootstrapCi.high == null) continue;
          if (!Array.isArray(agg.juryMedianSamples) || agg.juryMedianSamples.length === 0) continue;
          if (!toolStats[tool]) toolStats[tool] = { tasks: 0, lows: [], highs: [], medians: [] };
          toolStats[tool].tasks += 1;
          toolStats[tool].lows.push(agg.bootstrapCi.low);
          toolStats[tool].highs.push(agg.bootstrapCi.high);
          // task-level median = median of juryMedianSamples
          const sorted = [...agg.juryMedianSamples].sort((a, b) => a - b);
          const m = sorted.length % 2 === 1
            ? sorted[(sorted.length - 1) / 2]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
          toolStats[tool].medians.push(m);
        }
        const toolsRanked = Object.entries(toolStats)
          .map(([tool, s]) => {
            const sortedM = [...s.medians].sort((a, b) => a - b);
            const overallMedian = sortedM.length % 2 === 1
              ? sortedM[(sortedM.length - 1) / 2]
              : (sortedM[sortedM.length / 2 - 1] + sortedM[sortedM.length / 2]) / 2;
            return {
              tool,
              tasks: s.tasks,
              minLow: Math.min(...s.lows),
              maxHigh: Math.max(...s.highs),
              overallMedian,
            };
          })
          .sort((a, b) => b.overallMedian - a.overallMedian);
        if (toolsRanked.length === 0) {
          lines.push('| —    | —            | —           | —            | —           |');
          lines.push('');
          lines.push('> （目前无任何工具在任何 task 上 actualN ≥ 5；建议先跑 `npm run eval:repeat -- --all-fixtures --n 5`）');
        } else {
          for (const r of toolsRanked) {
            lines.push(`| ${r.tool} | ${r.tasks} | ${r.minLow.toFixed(1)} | ${r.maxHigh.toFixed(1)} | ${r.overallMedian.toFixed(1)} |`);
          }
        }
        lines.push('');
      }
    } else {
      // 没有 jury fixture → 提示用户如何跑
      lines.push('### 4.3 Jury Agreement');
      lines.push('');
      lines.push('> ⚠️ 当前无任何 fixture 跑过 cross-LLM jury。所有 §4.1 分数均为 self-judge 或 single-judge，存在 bias 风险。');
      lines.push('> 设置 `ANTHROPIC_API_KEY` 后跑 `npm run eval:judge-jury -- --all` 自动多 judge 重评（成本 ~$3-5）。');
      lines.push('');
    }
  } else {
    lines.push('（暂无 task-execution fixture）');
    lines.push('');
  }

  // §5 Differentiation insights
  lines.push('## 5. Differentiation Insights（自动检测，spread ≥ 1）');
  lines.push('');
  if (insights.length === 0) {
    lines.push('（无显著差异化信号）');
  } else {
    for (const ins of insights.slice(0, 10)) {
      if (ins.kind === 'doc-quality-spread') {
        lines.push(`- **doc quality on ${ins.project}**: ${ins.leader} (${ins.leaderScore}) vs ${ins.laggard} (${ins.laggardScore}), spread=${ins.spread}`);
      } else if (ins.kind?.startsWith('spec-quality-spread')) {
        lines.push(`- ⚠️ **spec quality on ${ins.project}** (rubric mismatch fallback): ${ins.leader} (${ins.leaderScore}) vs ${ins.laggard} (${ins.laggardScore}), spread=${ins.spread}`);
      } else if (ins.kind === 'task-spread') {
        const mixedTag = ins.mixedSource ? ' ⚠️ MIXED SOURCE (jury vs self-judge — 不可比)' : '';
        const leaderTag = ins.leaderSource === 'jury' ? '††' : (ins.leaderSource === 'self-judge' ? '†' : '');
        const laggardTag = ins.laggardSource === 'jury' ? '††' : (ins.laggardSource === 'self-judge' ? '†' : '');
        lines.push(`- **task ${ins.task}**: ${ins.leader} (${ins.leaderScore}${leaderTag}) vs ${ins.laggard} (${ins.laggardScore}${laggardTag}), spread=${ins.spread}${mixedTag}`);
      }
    }
  }
  lines.push('');

  // §6 Stale fixtures
  lines.push('## 6. Stale Fixture Warnings（staleAfterDate ≤ 30 天）');
  lines.push('');
  if (agg.stale.length === 0) {
    lines.push('（无即将过期的 fixture）');
  } else {
    lines.push('| fixture | staleAfterDate | days left | frozen |');
    lines.push('|---------|----------------|-----------|--------|');
    for (const s of agg.stale) {
      const flag = s.daysLeft < 0 ? '⚠️ EXPIRED' : `${s.daysLeft}`;
      lines.push(`| ${s.path} | ${s.staleAfter} | ${flag} | ${s.frozen ? 'yes' : 'no'} |`);
    }
  }
  lines.push('');

  // §7 SC 验收
  lines.push('## 7. SC 验收快照（基于当前 fixture）');
  lines.push('');
  const sc004Tasks = agg.tasks.length;
  const sc004Tools = agg.driverTools.length;
  lines.push('| SC | 标准 | 状态 |');
  lines.push('|----|------|------|');
  lines.push(`| SC-002 | schema 1.1 fixture | ${agg.spectraCount > 0 ? '✅' : '❌'} ${agg.spectraCount} 个 spectra 类 |`);
  lines.push(`| SC-004 | ≥ 3 工具 × ≥ 3 任务 | ${sc004Tools >= 3 && sc004Tasks >= 3 ? '✅' : '⚠️'} ${sc004Tools} 工具 × ${sc004Tasks} 任务 = ${sc004Tools * sc004Tasks} 矩阵 |`);
  lines.push(`| SC-008 | cost ≤ $120 | ${agg.cumulativeCost <= SC008_BUDGET ? '✅' : '⚠️'} ${fmtCost(agg.cumulativeCost)} / ${fmtCost(SC008_BUDGET)} (剩 ${fmtCost(agg.budgetRemaining)}) |`);
  lines.push('');

  // §8 Tool Outputs（全量产物，点链接进目录看完整对比）
  const outputsDir = path.join(PROJECT_ROOT, 'specs/147-competitor-evaluation-platform/outputs');
  if (fs.existsSync(outputsDir)) {
    lines.push('## 8. Tool Outputs（全量产物对比，点链接进目录）');
    lines.push('');
    lines.push('> 各工具完整产物根目录入库（micrograd + nanoGPT 全量），用户可直接进目录浏览所有 spec.md / graph.json / repomap 等文件。self-dogfood 因体积太大（~24MB）未入库，README 给本地路径。');
    lines.push('');
    for (const entry of fs.readdirSync(outputsDir).sort()) {
      const entryPath = path.join(outputsDir, entry);
      const stat = fs.statSync(entryPath);
      if (stat.isDirectory()) {
        lines.push(`### ${entry}`);
        lines.push('');
        for (const tool of fs.readdirSync(entryPath).sort()) {
          const toolDir = path.join(entryPath, tool);
          if (!fs.statSync(toolDir).isDirectory()) continue;
          const fileCount = fs.readdirSync(toolDir).filter((n) => !n.startsWith('.')).length;
          // 总大小
          let totalSize = 0;
          function walk(d) {
            for (const f of fs.readdirSync(d)) {
              const full = path.join(d, f);
              const s = fs.statSync(full);
              if (s.isDirectory()) walk(full);
              else totalSize += s.size;
            }
          }
          walk(toolDir);
          const rel = path.relative(PROJECT_ROOT, toolDir);
          lines.push(`- **${tool}**: [\`${rel}/\`](../../${rel}/) — ${fileCount} 文件 / ${fmtBytes(totalSize)}`);
        }
        lines.push('');
      } else if (stat.isFile() && entry.endsWith('.md')) {
        const rel = path.relative(PROJECT_ROOT, entryPath);
        lines.push(`### ${entry.replace('-README.md', '')}`);
        lines.push('');
        lines.push(`- 见 [\`${rel}\`](../../${rel}) — 产物未入库（体积），README 含本地路径与重生命令`);
        lines.push('');
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(`*Auto-generated by \`scripts/eval-report.mjs\` from ${agg.fixtureCount} fixture(s) under \`tests/baseline/\`. Schema 1.1.*`);

  return lines.join('\n');
}

export function renderJson(scanned, agg, insights) {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    git: getGitState(),
    aggregate: agg,
    insights,
    fixtures: {
      spectraClass: scanned.spectraClass.map((x) => ({
        project: x.project, tool: x.tool,
        wall: x.fx.perf?.totalWallMs ?? null,
        cost: x.fx.perf?.estimatedCostUsd ?? null,
        nodes: x.fx.output?.graphNodeCount ?? null,
        edges: x.fx.output?.graphEdgeCount ?? null,
        specQualityScore: x.fx.quality?.judgeSpecQuality?.score ?? null,
      })),
      specDriverClass: scanned.specDriverClass.map((x) => ({
        task: x.task, tool: x.tool,
        wall: x.fx.taskExecution?.wallMs ?? null,
        oraclePass: x.fx.taskExecution?.primaryOracle?.passed ?? null,
        score: x.fx.taskExecution?.juryMedian ?? x.fx.taskExecution?.rubricJudgeScore ?? null,
        scoreSource: x.fx.taskExecution?.juryMedian != null ? 'jury' : (x.fx.taskExecution?.rubricJudgeScore != null ? 'self-judge' : null),
        juryMedian: x.fx.taskExecution?.juryMedian ?? null,
        jurySpread: x.fx.taskExecution?.jurySpread ?? null,
        juryAgreement: x.fx.taskExecution?.juryAgreement ?? null,
        rubricSelfJudgeScore: x.fx.taskExecution?.rubricJudgeScore ?? null,
        interRater: x.fx.taskExecution?.interRaterDelta ?? null,
      })),
    },
  }, null, 2);
}

// ============================================================
// 入口
// ============================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scanned = scanFixtures();
  const agg = aggregateMetrics(scanned);

  // Codex Phase 4D 测评清理修订（W1）：fixture 缺失时 stderr 显式 warn，
  // 避免用户误以为 spectra-only 报告就是完整结果（实际是 task fixture 没跑）
  const tasksDir = path.join(BASELINE_DIR, 'tasks');
  const repeatsDir = path.join(BASELINE_DIR, 'repeats');
  if (!fs.existsSync(tasksDir) || agg.specDriverCount === 0) {
    console.error('[eval-report] ⚠️  tests/baseline/tasks/ 不存在或为空 — Spec Driver 类 fixture 未生成。');
    console.error('[eval-report] ⚠️  本次报告仅含 Spectra 类 perf anchor (12 fixture)，无 §4 任务矩阵 / §4.4 compliance / §4.5 multi-turn。');
    console.error('[eval-report] ⚠️  完整报告需先跑：npm run eval:competitor && npm run eval:judge-jury');
  }
  if (!fs.existsSync(repeatsDir)) {
    console.error('[eval-report] ⚠️  tests/baseline/repeats/ 不存在 — Feature 149 N=5 bootstrap CI 数据未生成。');
    console.error('[eval-report] ⚠️  §4.1 评分矩阵将走 single-run 渲染（无 95% CI 区间）。');
    console.error('[eval-report] ⚠️  N=5 重测：npm run eval:repeat -- --all-fixtures --n 5 --concurrency 4');
  }

  const insights = detectInsights(scanned);
  const output = args.format === 'json' ? renderJson(scanned, agg, insights) : renderMarkdown(scanned, agg, insights);

  if (args.output) {
    fs.writeFileSync(args.output, output, 'utf-8');
    console.log(`[eval-report] written: ${path.relative(PROJECT_ROOT, args.output)} (${output.length} bytes)`);
  } else {
    console.log(output);
  }
}

const isCliEntry = process.argv[1]?.endsWith('eval-report.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[eval-report] error: ${err.message}`);
    process.exit(1);
  });
}
