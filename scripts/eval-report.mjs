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
  // Cost：区分 known 和 unknown（in-session fixture 的 cost null != 0）
  let knownCost = 0;
  let unknownCostFixtures = 0;
  for (const x of scanned.spectraClass) {
    const c = x.fx.perf?.estimatedCostUsd;
    if (c == null) unknownCostFixtures++;
    else knownCost += c;
  }
  for (const x of scanned.specDriverClass) {
    const c = x.fx.taskExecution?.costUsd;
    if (c == null) unknownCostFixtures++;
    else knownCost += c;
  }
  const cumulativeCost = knownCost; // 仅 known，不把 null 当 0 加

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
  lines.push(`- Known cost (${agg.knownCostFixtures} metered fixture${agg.knownCostFixtures === 1 ? '' : 's'}): **${fmtCost(agg.cumulativeCost)}**`);
  if (agg.unknownCostFixtures > 0) {
    lines.push(`- Unknown cost: **${agg.unknownCostFixtures} fixture${agg.unknownCostFixtures === 1 ? '' : 's'}** with null cost (in-session executor 无 token metering — 实际成本未计入预算)`);
  }
  lines.push(`- Budget remaining (vs known cost only): ${fmtCost(agg.budgetRemaining)}`);
  lines.push(`- Per-version refresh estimate: ~$5-10`);
  if (agg.unknownCostFixtures > 0) {
    lines.push('');
    lines.push('> ⚠️ SC-008 预算 pass/fail 仅基于已计量 fixture；in-session 执行的 fixture 实际消耗 token 但未被计入。重跑双盲评分时需重新计量。');
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

  lines.push('### 4.1 评分矩阵（juryMedian 优先 / fallback rubricJudgeScore + oracle PASS）');
  lines.push('');
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
    for (const task of tasks) {
      const row = [task];
      for (const tool of tools) {
        const item = scanned.specDriverClass.find((x) => x.task === task && x.tool === tool);
        if (!item) { row.push('—'); continue; }
        const te = item.fx.taskExecution ?? {};
        const score = te.juryMedian != null ? te.juryMedian : te.rubricJudgeScore;
        const isJury = te.juryMedian != null;
        const oraclePass = te.primaryOracle?.passed === true;
        if (score != null) {
          if (isJury) toolAvgJury[tool].push(score); else toolAvgRubric[tool].push(score);
        }
        allPassCount++;
        if (oraclePass) allPassRate++;
        // 每 cell 标 ††（jury）或 †（rubric self-judge）
        const sourceMarker = score == null ? '' : (isJury ? '††' : '†');
        const scoreLabel = isJury ? `**${score}${sourceMarker}**` : (score == null ? 'null' : `${score}${sourceMarker}`);
        row.push(`${scoreLabel} (${oraclePass ? '✓' : '✗'})`);
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
    lines.push('');
    lines.push(`**Oracle pass rate**: ${allPassRate}/${allPassCount} = ${(allPassRate/allPassCount*100).toFixed(0)}%`);
    if (juryTools.size > 0 || selfJudgeTools.size > 0) {
      lines.push('');
      const legend = [];
      if (juryTools.size > 0) legend.push('†† = **cross-LLM jury** (multi-judge median, anonymized + adversarial prompt)');
      if (selfJudgeTools.size > 0) legend.push('† = **provisional self-judge** (executor=judge, 无独立 reviewer, descriptive signal only)');
      lines.push('> ' + legend.join('; '));
    }
    lines.push('');

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
      lines.push('| 任务 | 工具 | judges | scores | median | spread | agreement |');
      lines.push('|------|------|--------|--------|--------|--------|-----------|');
      const lowAgreement = [];
      for (const item of juryFixtures.sort((a, b) => a.task.localeCompare(b.task) || a.tool.localeCompare(b.tool))) {
        const te = item.fx.taskExecution;
        const scores = (te.juryScores ?? []).map((j) => j.judge ? `${j.judge.replace('claude-','')}=${j.score ?? 'X'}` : 'unknown').join(' / ');
        const judgeCount = te.juryScores?.length ?? 0;
        lines.push(`| ${item.task} | ${item.tool} | ${judgeCount} | ${scores} | ${te.juryMedian} | ${te.jurySpread} | ${te.juryAgreement} |`);
        if (te.juryAgreement === 'low') lowAgreement.push(`${item.task}/${item.tool}`);
      }
      lines.push('');
      if (lowAgreement.length > 0) {
        lines.push(`> ⚠️ **Low agreement (spread > 2)**: ${lowAgreement.join(', ')} — judges 严重分歧，rubric 在该 fixture 上可能太主观，分数仅供参考`);
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
