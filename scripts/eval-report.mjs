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

export function scanFixtures(rootDir = BASELINE_DIR) {
  const result = { spectraClass: [], specDriverClass: [] };
  if (!fs.existsSync(rootDir)) return result;

  // Spectra 类: tests/baseline/<project>/<tool>/full.json
  for (const proj of fs.readdirSync(rootDir).filter((n) => !n.startsWith('.') && n !== 'tasks' && n !== 'README.md')) {
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
  const tasksDir = path.join(rootDir, 'tasks');
  if (fs.existsSync(tasksDir)) {
    for (const task of fs.readdirSync(tasksDir)) {
      const taskDir = path.join(tasksDir, task);
      if (!fs.statSync(taskDir).isDirectory()) continue;
      for (const tool of fs.readdirSync(taskDir)) {
        const fixturePath = path.join(taskDir, tool, 'full.json');
        if (!fs.existsSync(fixturePath)) continue;
        try {
          const fx = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
          result.specDriverClass.push({ task, tool, fixturePath, fx });
        } catch (e) {
          console.warn(`[eval-report] skip invalid fixture ${fixturePath}: ${e.message}`);
        }
      }
    }
  }

  return result;
}

// ============================================================
// 聚合指标
// ============================================================

export function aggregateMetrics(scanned) {
  const cumulativeCost = scanned.spectraClass.reduce((s, x) => s + (x.fx.perf?.estimatedCostUsd ?? 0), 0)
    + scanned.specDriverClass.reduce((s, x) => s + (x.fx.taskExecution?.costUsd ?? 0), 0);

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

  return {
    fixtureCount: scanned.spectraClass.length + scanned.specDriverClass.length,
    spectraCount: scanned.spectraClass.length,
    specDriverCount: scanned.specDriverClass.length,
    cumulativeCost: Math.round(cumulativeCost * 100) / 100,
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
  for (const x of scanned.specDriverClass) {
    if (!byTask.has(x.task)) byTask.set(x.task, {});
    byTask.get(x.task)[x.tool] = x.fx.taskExecution?.rubricJudgeScore ?? null;
  }
  for (const [task, scores] of byTask) {
    const valid = Object.entries(scores).filter(([_, s]) => s != null);
    if (valid.length < 2) continue;
    const sorted = valid.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    const top = sorted[0];
    const bot = sorted[sorted.length - 1];
    if ((top[1] ?? 0) - (bot[1] ?? 0) >= 1) {
      insights.push({
        kind: 'task-spread',
        task,
        leader: top[0],
        leaderScore: top[1],
        laggard: bot[0],
        laggardScore: bot[1],
        spread: (top[1] ?? 0) - (bot[1] ?? 0),
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

export function renderMarkdown(scanned, agg, insights) {
  const lines = [];
  const git = getGitState();
  const now = new Date().toISOString();

  lines.push('# Spectra & Spec Driver 评估自动报告');
  lines.push('');
  lines.push(`> **由 \`scripts/eval-report.mjs\` 自动生成**。固定格式（spec §2.1.F + SC-011 / F147）。`);
  lines.push(`> **生成时间**: ${now}`);
  lines.push(`> **Git**: ${git.branch} @ ${git.head}`);
  lines.push(`> **Fixture 总数**: ${agg.fixtureCount}（Spectra 类 ${agg.spectraCount} + Spec Driver 类 ${agg.specDriverCount}）`);
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

  // §2 Cost Summary
  lines.push('## 2. Cost Summary（vs SC-008 预算 $120）');
  lines.push('');
  lines.push(`- Cumulative cost (fixture-level): **${fmtCost(agg.cumulativeCost)}**`);
  lines.push(`- Budget remaining: ${fmtCost(agg.budgetRemaining)}`);
  lines.push(`- Per-version refresh estimate: ~$5-10`);
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

  // Grounding（如 micrograd spectra fixture 含 codingContextGrounding）
  const groundingFx = scanned.spectraClass.find((x) => x.fx.quality?.codingContextGrounding?.allGroupScores);
  if (groundingFx) {
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

  // §4 Spec Driver Task Matrix
  lines.push('## 4. Spec Driver 类任务矩阵');
  lines.push('');
  if (scanned.specDriverClass.length > 0) {
    const tools = [...agg.driverTools].sort();
    const tasks = [...agg.tasks].sort();
    lines.push('| 任务 | ' + tools.join(' | ') + ' |');
    lines.push('|------|' + tools.map(() => '------').join('|') + '|');
    let allPassRate = 0;
    let allPassCount = 0;
    const toolAvg = Object.fromEntries(tools.map((t) => [t, []]));
    for (const task of tasks) {
      const row = [task];
      for (const tool of tools) {
        const item = scanned.specDriverClass.find((x) => x.task === task && x.tool === tool);
        if (!item) { row.push('—'); continue; }
        const te = item.fx.taskExecution ?? {};
        const score = te.rubricJudgeScore;
        const oraclePass = te.primaryOracle?.passed === true;
        if (score != null) toolAvg[tool].push(score);
        allPassCount++;
        if (oraclePass) allPassRate++;
        row.push(`${score ?? 'null'} (${oraclePass ? '✓' : '✗'})`);
      }
      lines.push('| ' + row.join(' | ') + ' |');
    }
    // 均值行
    const avgRow = ['**均分**'];
    for (const tool of tools) {
      const arr = toolAvg[tool];
      const avg = arr.length > 0 ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10 : 'n/a';
      avgRow.push(`**${avg}**`);
    }
    lines.push('| ' + avgRow.join(' | ') + ' |');
    lines.push('');
    lines.push(`**Oracle pass rate**: ${allPassRate}/${allPassCount} = ${(allPassRate/allPassCount*100).toFixed(0)}%`);
    lines.push('');
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
        lines.push(`- **task ${ins.task}**: ${ins.leader} (${ins.leaderScore}) vs ${ins.laggard} (${ins.laggardScore}), spread=${ins.spread}`);
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

  // §8 Sample Outputs（用户可点链接看真实产物）
  const sampleOutputsDir = path.join(PROJECT_ROOT, 'specs/147-competitor-evaluation-platform/sample-outputs');
  if (fs.existsSync(sampleOutputsDir)) {
    lines.push('## 8. Sample Outputs（点链接看真实产物）');
    lines.push('');
    lines.push('> 入库的代表性产物，用于直观对比不同工具产物形态 + 用户/reviewer 自验证 judge 评分合理性。完整产物路径在 `~/.spectra-baselines/<project>-output/<tool>-full/`（本地，gitignored）。');
    lines.push('');
    for (const proj of fs.readdirSync(sampleOutputsDir).sort()) {
      const projDir = path.join(sampleOutputsDir, proj);
      if (!fs.statSync(projDir).isDirectory()) continue;
      lines.push(`### ${proj}`);
      lines.push('');
      for (const tool of fs.readdirSync(projDir).sort()) {
        const toolDir = path.join(projDir, tool);
        if (!fs.statSync(toolDir).isDirectory()) continue;
        const files = fs.readdirSync(toolDir).filter((n) => !n.startsWith('.'));
        if (files.length === 0) continue;
        const linkSuffix = files.map((f) => {
          const full = path.join(toolDir, f);
          const sz = fmtBytes(fs.statSync(full).size);
          const rel = path.relative(PROJECT_ROOT, full);
          return `[${f}](../../${rel}) (${sz})`;
        }).join(' / ');
        lines.push(`- **${tool}**: ${linkSuffix}`);
      }
      lines.push('');
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
        score: x.fx.taskExecution?.rubricJudgeScore ?? null,
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
