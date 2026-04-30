#!/usr/bin/env node
/**
 * Feature 147 Phase 2 T2.4 — Coding-Context Grounding 评估
 *
 * 4 对照组各调 sonnet 跑同一任务（micrograd 加 tanh），加载不同 context：
 *   1. control: 裸 prompt（仅文件名）
 *   2. spectra: 加 spectra spec.md 内容
 *   3. graphify: 加 graphify graph.json 摘要
 *   4. aider-repomap: 加 aider repomap markdown
 *
 * 然后用 opus judge 双盲评分，写回 spectra fixture 的
 * quality.codingContextGrounding 字段。
 *
 * 用法：
 *   node scripts/eval-grounding.mjs --target karpathy/micrograd --task tanh
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { callJudge, parseJudgeOutput, loadRubric } from './eval-judge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SONNET_MODEL = 'claude-sonnet-4-6';
const JUDGE_MODEL = 'claude-opus-4-7';

function getBaselineHome() {
  return process.env.SPECTRA_BASELINE_HOME ?? path.join(os.homedir(), '.spectra-baselines');
}

const TASK_TANH = {
  taskId: 'micrograd-add-tanh',
  prompt: `# 任务

请为 micrograd 仓库的 \`Value\` 类（micrograd/engine.py）新增一个 \`tanh()\` 方法。

要求：
1. tanh(x) 数值正确（双曲正切函数）
2. 实现反向传播闭包（_backward），导数 = 1 - tanh(x)²
3. 风格与现有方法（如 \`relu()\` / \`__add__()\` / \`__mul__()\`）保持一致
4. 添加 1 个简单的使用/测试示例（如 \`assert\` 或 print）

**只输出最终代码，不要解释**。代码格式：

\`\`\`python
# 实现部分（新增到 Value 类的 method）
def tanh(self):
    ...

# 测试/示例部分（独立调用）
if __name__ == "__main__":
    ...
\`\`\``,
};

// ============================================================
// 4 个对照组 context loader
// ============================================================

function loadControl() {
  return {
    label: 'control',
    contextHeader: '## 项目结构\n\nmicrograd/\n  __init__.py\n  engine.py  # Value class\n  nn.py\n',
    contextBytes: 80,
  };
}

function loadSpectraContext() {
  // 取 micrograd spectra fixture 的 spec.md 内容
  const specDir = '/Users/connorlu/.spectra-baselines/micrograd-output/spectra-full/modules';
  if (!fs.existsSync(specDir)) {
    return { label: 'spectra', contextHeader: '## (spectra context unavailable)', contextBytes: 0 };
  }
  const files = fs.readdirSync(specDir).filter((n) => n.endsWith('.spec.md'));
  let content = '## Spectra spec.md content\n\n';
  for (const f of files) {
    const full = fs.readFileSync(path.join(specDir, f), 'utf-8');
    content += `### ${f}\n\n${full.slice(0, 4000)}\n\n---\n\n`;
  }
  return { label: 'spectra', contextHeader: content, contextBytes: content.length };
}

function loadGraphifyContext() {
  // 取 graphify graph.json 摘要（节点 + 边）
  const graphPath = '/Users/connorlu/.spectra-baselines/micrograd-output/graphify-full/graph.json';
  if (!fs.existsSync(graphPath)) {
    return { label: 'graphify', contextHeader: '## (graphify context unavailable)', contextBytes: 0 };
  }
  const g = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
  const nodes = (g.nodes ?? []).slice(0, 50).map((n) => `- ${n.id ?? n.name} (${n.type ?? 'unknown'})`).join('\n');
  const links = (g.links ?? []).slice(0, 50).map((e) => `- ${e.source ?? e.from} → ${e.target ?? e.to} (${e.type ?? e.kind ?? '?'})`).join('\n');
  const content = `## Graphify graph.json summary\n\n### Nodes (top ${Math.min(50, (g.nodes ?? []).length)} of ${(g.nodes ?? []).length})\n${nodes}\n\n### Edges (top ${Math.min(50, (g.links ?? []).length)} of ${(g.links ?? []).length})\n${links}\n`;
  return { label: 'graphify', contextHeader: content, contextBytes: content.length };
}

function loadAiderContext() {
  // 取 aider stdout log（含 markdown ranked symbol list）
  const logPath = '/Users/connorlu/.spectra-baselines/micrograd-output/aider-repomap-full/aider-repomap-stdout.log';
  if (!fs.existsSync(logPath)) {
    return { label: 'aider-repomap', contextHeader: '## (aider context unavailable)', contextBytes: 0 };
  }
  const content = '## Aider repomap markdown\n\n' + fs.readFileSync(logPath, 'utf-8');
  return { label: 'aider-repomap', contextHeader: content, contextBytes: content.length };
}

const CONTEXT_LOADERS = [loadControl, loadSpectraContext, loadGraphifyContext, loadAiderContext];

// ============================================================
// 调用 sonnet 生成实现
// ============================================================

function runSonnetWithContext({ contextHeader, taskPrompt }) {
  const fullPrompt = `${contextHeader}\n\n---\n\n${taskPrompt}`;
  const start = process.hrtime.bigint();
  const r = spawnSync(
    'claude',
    ['--print', '--model', SONNET_MODEL, '--output-format', 'text', '--permission-mode', 'plan', fullPrompt],
    { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 },
  );
  const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
  return {
    durationMs,
    output: r.stdout ?? '',
    stderr: r.stderr ?? '',
    exitCode: r.status,
  };
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  const args = parseArgsLocal(process.argv.slice(2));
  const task = args.task === 'tanh' ? TASK_TANH : null;
  if (!task) throw new Error(`unknown task: ${args.task}`);

  console.log(`[grounding] task=${task.taskId} target=${args.target}`);
  const groupResults = [];

  // Step 1: 4 对照组各跑一次 sonnet
  for (const loader of CONTEXT_LOADERS) {
    const ctx = loader();
    console.log(`[grounding] running ${ctx.label} (context=${ctx.contextBytes}B)...`);
    const r = runSonnetWithContext({ contextHeader: ctx.contextHeader, taskPrompt: task.prompt });
    if (r.exitCode !== 0) {
      console.error(`[grounding] ${ctx.label} sonnet failed: ${r.stderr.slice(0, 200)}`);
    }
    groupResults.push({
      label: ctx.label,
      contextBytes: ctx.contextBytes,
      sonnetDurationMs: r.durationMs,
      sonnetOutput: r.output,
      sonnetExitCode: r.exitCode,
    });
    console.log(`[grounding] ${ctx.label} done: ${r.durationMs}ms, output ${r.output.length}B`);
  }

  // Step 2: 用 grounding rubric 让 opus 双盲评分（每组）
  const rubric = loadRubric('grounding');
  const judgeRuns = [];
  for (const g of groupResults) {
    if (g.sonnetExitCode !== 0 || !g.sonnetOutput.trim()) {
      judgeRuns.push({ label: g.label, score: null, rationale: 'sonnet failed', anonymizedAs: null });
      continue;
    }
    // 双盲：把 label 名替换为占位
    const anonLabel = `<TOOL_${String.fromCharCode(65 + judgeRuns.length)}>`;
    const judgePrompt = `${rubric}

## 候选实现（来自 ${anonLabel}）

\`\`\`
${g.sonnetOutput.slice(0, 8000)}
\`\`\`

---

按 rubric 评分。**严格按以下格式**：

SCORE: <整数 1-10>
RATIONALE: <简短中文 ≤ 200 字>
`;
    console.log(`[grounding-judge] judging ${anonLabel} (real=${g.label})...`);
    const j = callJudge(judgePrompt, { model: JUDGE_MODEL });
    const parsed = parseJudgeOutput(j.rawOutput);
    judgeRuns.push({
      label: g.label,
      anonymizedAs: anonLabel,
      score: parsed.score,
      rationale: parsed.rationale,
      durationMs: j.durationMs,
    });
    console.log(`[grounding-judge] ${anonLabel} (${g.label}): score=${parsed.score}`);
  }

  // Step 3: 写回 spectra fixture 的 codingContextGrounding 段
  const fixturePath = path.join(PROJECT_ROOT, 'tests/baseline/micrograd/spectra/full.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const spectraScore = judgeRuns.find((r) => r.label === 'spectra')?.score ?? null;
  const controlScore = judgeRuns.find((r) => r.label === 'control')?.score ?? null;
  fixture.quality = fixture.quality ?? {};
  fixture.quality.codingContextGrounding = {
    taskId: task.taskId,
    taskScore: spectraScore,
    controlScore: controlScore,
    groundingDelta: spectraScore != null && controlScore != null ? Math.round((spectraScore - controlScore) * 10) / 10 : null,
    judgeRationale: judgeRuns.find((r) => r.label === 'spectra')?.rationale ?? null,
    interRaterDelta: null, // 单 run，未跑 inter-rater
    executionMode: 'non-interactive',
    allGroupScores: judgeRuns.map((r) => ({ label: r.label, score: r.score, contextBytes: groupResults.find((g) => g.label === r.label)?.contextBytes ?? 0 })),
    judgedAt: new Date().toISOString(),
    judgeModel: JUDGE_MODEL,
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf-8');

  // 同时把 sonnet 输出写到 outputDir 供后续审查
  const groundingOutDir = path.join(getBaselineHome(), 'micrograd-output', 'grounding-tanh');
  fs.mkdirSync(groundingOutDir, { recursive: true });
  for (const g of groupResults) {
    fs.writeFileSync(path.join(groundingOutDir, `${g.label}-output.md`), g.sonnetOutput, 'utf-8');
  }

  console.log('\n=== Grounding Summary ===');
  for (const r of judgeRuns) {
    console.log(`  ${r.label.padEnd(15)}: score=${r.score} (anon=${r.anonymizedAs})`);
  }
  console.log(`grounding delta (spectra vs control): ${fixture.quality.codingContextGrounding.groundingDelta}`);
}

function parseArgsLocal(argv) {
  const args = { target: 'karpathy/micrograd', task: 'tanh' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') args.target = argv[++i];
    else if (a === '--task') args.task = argv[++i];
    else if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
  }
  return args;
}

const isCliEntry = process.argv[1]?.endsWith('eval-grounding.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[eval-grounding] error: ${err.message}`);
    process.exit(1);
  });
}
